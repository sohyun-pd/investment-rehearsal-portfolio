/**
 * BFF — Vite dev/preview 서버 middleware.
 *
 * ⚠️ 로컬 개발용이다. **production BFF 는 Cloudflare Pages Functions**(`functions/api/**`)이며
 * 그쪽이 source of truth 다. 이 파일은 `npm run dev` / `npm run preview` 로 로컬에서 화면을 볼 때만
 * 쓴다 — `vite build` 결과물(`dist/`)에는 포함되지 않고, 정적 호스팅에 그대로 배포하면 이 미들웨어는
 * 실행되지 않는다.
 *
 * 라우트 판별·오류 매핑 등 실제 로직은 `./marketRoutes.ts`·`./planInterpretRoute.ts`(런타임 무관,
 * Pages Functions 와 공유)에 있다. 이 파일은 Node `http` 요청/응답을 그 공통 로직에 맞춰
 * 변환하기만 한다.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

import { resolveFinnhubApiKey, resolveTwelveDataApiKey } from "../app/data/market";
import { loadServerEnv } from "./loadEnv";
import {
  handleCandlesRoute,
  handleKoreanCandlesRoute,
  handleQuoteRoute,
  handleSymbolsRoute,
  UNKNOWN_ERROR_RESULT,
  type RouteResult,
} from "./marketRoutes";
import { handleFeedbackRoute } from "./feedbackRoute";
import { handlePlanInterpretRoute } from "./planInterpretRoute";
import { handlePlanReviseRoute } from "./planReviseRoute";
import { handleReviewRoute } from "./reviewRoute";

function sendJson(res: ServerResponse, result: RouteResult): void {
  res.statusCode = result.status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(result.body));
}

function readQuery(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? "", "http://localhost");
  return url.searchParams;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (text.trim() === "") {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

/** `LLM_MODEL` 이 비어 있으면 기본 모델로 떨어진다. 앱 다른 곳(spikes)과 같은 관례다. */
function resolveAnthropicModel(): string {
  return process.env.LLM_MODEL || "claude-sonnet-5";
}

function resolveAnthropicApiKey(): string {
  return process.env.ANTHROPIC_API_KEY ?? "";
}

function resolveFeedbackStorageConfig(): { appsScriptUrl: string; token: string } {
  return {
    appsScriptUrl: process.env.FEEDBACK_APPS_SCRIPT_URL ?? "",
    token: process.env.FEEDBACK_API_TOKEN ?? "",
  };
}

const GET_ROUTES: Record<string, (req: IncomingMessage) => Promise<RouteResult>> = {
  "/api/symbols": (req) => handleSymbolsRoute(readQuery(req).get("q") ?? "", resolveFinnhubApiKey()),
  "/api/quote": (req) =>
    handleQuoteRoute(readQuery(req).get("symbol") ?? "", resolveFinnhubApiKey()),
  "/api/candles": (req) => {
    const params = readQuery(req);
    return handleCandlesRoute(
      params.get("symbol") ?? "",
      params.get("from") ?? "",
      params.get("to") ?? "",
      resolveTwelveDataApiKey()
    );
  },
  // 로컬 dev 서버에는 Cloudflare Cache API 가 없다 — 캐싱은 functions/api/candles/kr.ts
  // (Pages Functions, 실제 배포 환경)에서만 한다.
  "/api/candles/kr": (req) => {
    const params = readQuery(req);
    return handleKoreanCandlesRoute(
      params.get("symbol") ?? "",
      params.get("exchange") ?? "",
      params.get("from") ?? "",
      params.get("to") ?? ""
    );
  },
};

const POST_ROUTES: Record<string, (req: IncomingMessage) => Promise<RouteResult>> = {
  "/api/plan/interpret": async (req) => {
    const body = await readJsonBody(req);
    return handlePlanInterpretRoute(body, resolveAnthropicApiKey(), resolveAnthropicModel());
  },
  "/api/plan/revise": async (req) => {
    const body = await readJsonBody(req);
    return handlePlanReviseRoute(body, resolveAnthropicApiKey(), resolveAnthropicModel());
  },
  "/api/review": async (req) => {
    const body = await readJsonBody(req);
    return handleReviewRoute(body, resolveAnthropicApiKey(), resolveAnthropicModel());
  },
  "/api/feedback": async (req) => {
    const body = await readJsonBody(req);
    return handleFeedbackRoute(body, resolveFeedbackStorageConfig(), {
      userAgent: req.headers["user-agent"] ?? "",
    });
  },
};

function genericFailure(stage: string): RouteResult {
  return {
    status: 500,
    body: { error: { stage, code: "unknown", userMessage: "알 수 없는 오류가 발생했어요.", retryable: true } },
  };
}

function registerMiddleware(server: ViteDevServer | PreviewServer): void {
  server.middlewares.use((req, res, next) => {
    const pathname = (req.url ?? "").split("?")[0];
    const method = req.method;
    const isGet = method === "GET" && pathname !== undefined;
    const isPost = method === "POST" && pathname !== undefined;

    if (isGet && pathname in GET_ROUTES) {
      GET_ROUTES[pathname]!(req)
        .then((result) => sendJson(res, result))
        .catch(() => sendJson(res, UNKNOWN_ERROR_RESULT));
      return;
    }
    if (isPost && pathname in POST_ROUTES) {
      POST_ROUTES[pathname]!(req)
        .then((result) => sendJson(res, result))
        .catch(() => sendJson(res, genericFailure("conversation")));
      return;
    }
    next();
  });
}

/** Vite plugin — dev(`vite dev`)와 preview(`vite preview`) 서버 모두에 BFF 라우트를 등록한다. */
export function bffApiPlugin(): Plugin {
  loadServerEnv();

  return {
    name: "bff-api",
    configureServer(server) {
      registerMiddleware(server);
    },
    configurePreviewServer(server) {
      registerMiddleware(server);
    },
  };
}
