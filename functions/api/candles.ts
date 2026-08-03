/**
 * Cloudflare Pages Function — GET /api/candles?symbol=&from=&to=
 *
 * Production BFF. 로직은 `server/marketRoutes.ts`(런타임 무관, Vite 미들웨어와 공유)에 있다.
 * API 키는 `context.env`(Cloudflare Pages 서버 환경변수)에서만 읽는다.
 *
 * 같은 종목·기간의 반복 요청을 줄이기 위해 Cloudflare Cache API 를 쓴다(§production 안정성 —
 * `functions/api/candles/kr.ts` 와 같은 정책: 실시간 조회가 실제로 성공한 응답만 24시간
 * 캐시하고, 오류·스냅샷 폴백 응답(fallbackUsed:true)은 캐시하지 않는다 — 폴백을 캐시하면
 * Twelve Data 가 복구된 뒤에도 최대 24시간 동안 오래된 스냅샷만 보여주게 된다).
 */
import { handleCandlesRoute } from "../../server/marketRoutes";
import { extractErrorCode, logRequestOutcome, nextRequestId } from "../../server/requestLog";

interface Env {
  TWELVE_DATA_API_KEY: string;
}

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const ROUTE = "GET /api/candles";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const requestId = nextRequestId();
  const startedAt = Date.now();
  const url = new URL(context.request.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached !== undefined) {
    logRequestOutcome(requestId, { route: ROUTE, status: cached.status, durationMs: Date.now() - startedAt });
    return cached;
  }

  const result = await handleCandlesRoute(symbol, from, to, context.env.TWELVE_DATA_API_KEY ?? "");
  const response = new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json" },
  });

  const body = result.body as { result?: { fallbackUsed?: boolean } };
  const fallbackUsed = body.result?.fallbackUsed === true;
  const isLiveSuccess = result.status === 200 && !fallbackUsed;
  if (isLiveSuccess) {
    response.headers.set("Cache-Control", `public, max-age=${CACHE_TTL_SECONDS}`);
    context.waitUntil(cache.put(cacheKey, response.clone()));
  }

  logRequestOutcome(requestId, {
    route: ROUTE,
    status: result.status,
    durationMs: Date.now() - startedAt,
    errorCode: extractErrorCode(result.body),
    fallbackUsed,
  });
  return response;
};
