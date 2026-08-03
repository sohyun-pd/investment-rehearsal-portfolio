/**
 * Cloudflare Pages Function — POST /api/review
 *
 * Production BFF. 로직은 `server/reviewRoute.ts`(런타임 무관, Vite 미들웨어와 공유)에 있다.
 * API 키는 `context.env`(Cloudflare Pages 서버 환경변수)에서만 읽는다.
 */
import { handleReviewRoute } from "../../server/reviewRoute";
import { parseJsonBodyWithLimit } from "../../server/pagesFunctionHelpers";
import { checkAiRateLimit, type RateLimitKvBinding } from "../../server/rateLimit";
import { extractErrorCode, logRequestOutcome, nextRequestId } from "../../server/requestLog";

interface Env {
  ANTHROPIC_API_KEY: string;
  LLM_MODEL?: string;
  AI_RATE_LIMIT_KV?: RateLimitKvBinding;
}

const ROUTE = "POST /api/review";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const requestId = nextRequestId();
  const startedAt = Date.now();
  const body = await parseJsonBodyWithLimit(context.request);

  const sessionId = body !== null && typeof body === "object" ? (body as Record<string, unknown>).sessionId : undefined;
  const clientIp = context.request.headers.get("CF-Connecting-IP");
  const limited = await checkAiRateLimit(context.env.AI_RATE_LIMIT_KV, sessionId, clientIp);
  if (limited !== null) {
    logRequestOutcome(requestId, { route: ROUTE, status: limited.status, durationMs: Date.now() - startedAt, errorCode: "rate_limited" });
    return Response.json(limited.body, { status: limited.status });
  }

  const result = await handleReviewRoute(
    body,
    context.env.ANTHROPIC_API_KEY ?? "",
    context.env.LLM_MODEL || "claude-sonnet-5"
  );
  logRequestOutcome(requestId, {
    route: ROUTE,
    status: result.status,
    durationMs: Date.now() - startedAt,
    errorCode: extractErrorCode(result.body),
  });
  return Response.json(result.body, { status: result.status });
};
