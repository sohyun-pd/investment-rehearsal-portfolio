/**
 * Cloudflare Pages Function — GET /api/symbols?q=
 *
 * Production BFF. `npm run dev`/`npm run preview` 로 볼 때만 쓰는 Vite 미들웨어와 로직을
 * 공유한다(`server/marketRoutes.ts`, 런타임 무관) — 여기서 다시 구현하지 않는다.
 * API 키는 이 함수의 `context.env`(Cloudflare Pages 서버 환경변수)에서만 읽는다.
 * 브라우저에는 전달되지 않는다.
 *
 * 같은 검색어의 반복 요청을 줄이기 위해 Cloudflare Cache API 를 쓴다(§production 안정성) —
 * 종목명·티커 매핑은 자주 바뀌지 않는 공용 데이터라 사용자별 계획과 달리 캐시해도 안전하다.
 * 성공 응답만 캐시한다(빈 검색어 결과도 "성공"이라 그대로 캐시된다 — 매번 같은 빈 배열이라
 * 문제 없다).
 */
import { handleSymbolsRoute } from "../../server/marketRoutes";
import { extractErrorCode, logRequestOutcome, nextRequestId } from "../../server/requestLog";

interface Env {
  FINNHUB_API_KEY: string;
}

const CACHE_TTL_SECONDS = 60 * 60;
const ROUTE = "GET /api/symbols";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const requestId = nextRequestId();
  const startedAt = Date.now();
  const url = new URL(context.request.url);
  const query = url.searchParams.get("q") ?? "";

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached !== undefined) {
    logRequestOutcome(requestId, { route: ROUTE, status: cached.status, durationMs: Date.now() - startedAt });
    return cached;
  }

  const result = await handleSymbolsRoute(query, context.env.FINNHUB_API_KEY ?? "");
  const response = new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json" },
  });

  if (result.status === 200) {
    response.headers.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }

  logRequestOutcome(requestId, {
    route: ROUTE,
    status: result.status,
    durationMs: Date.now() - startedAt,
    errorCode: extractErrorCode(result.body),
  });
  return response;
};
