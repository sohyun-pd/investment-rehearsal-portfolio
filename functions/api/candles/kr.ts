/**
 * Cloudflare Pages Function — GET /api/candles/kr?symbol=&exchange=&from=&to=
 *
 * 국내(KR) 과거 일봉 — Yahoo Finance 임시 provider(§공공데이터포털 발급 전까지, README 참고).
 * 로직은 `server/marketRoutes.ts`(런타임 무관)에 있다. Yahoo 는 API 키가 필요 없다 — 다만
 * "브라우저에서 직접 요청하지 않는다"는 원칙은 그대로 지킨다(§사용자 확정 — 이 Function 이
 * 유일한 호출 경로다).
 *
 * 같은 종목·기간의 반복 요청을 줄이기 위해 Cloudflare Cache API 를 쓴다(§사용자 확정 — "성공
 * 응답은 Cloudflare Cache API에 최소 24시간 캐시") — Yahoo 실시간 조회가 실제로 성공한 응답만
 * 24시간 캐시한다. 빈 응답·오류·**스냅샷 폴백 응답(fallbackUsed:true)**은 캐시하지 않는다 —
 * 폴백을 캐시해 버리면 Yahoo 가 복구된 뒤에도 최대 24시간 동안 계속 오래된 스냅샷만 보여주게
 * 되므로, 매 요청마다 항상 실시간 조회를 먼저 다시 시도한다(§사용자 확정 — "Yahoo Finance
 * live request를 먼저 시도").
 */
import { handleKoreanCandlesRoute } from "../../../server/marketRoutes";
import { extractErrorCode, logRequestOutcome, nextRequestId } from "../../../server/requestLog";

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const ROUTE = "GET /api/candles/kr";

export const onRequestGet: PagesFunction = async (context) => {
  const requestId = nextRequestId();
  const startedAt = Date.now();
  const url = new URL(context.request.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const exchange = url.searchParams.get("exchange") ?? "";
  const from = url.searchParams.get("from") ?? "";
  const to = url.searchParams.get("to") ?? "";

  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached !== undefined) {
    logRequestOutcome(requestId, { route: ROUTE, status: cached.status, durationMs: Date.now() - startedAt });
    return cached;
  }

  const result = await handleKoreanCandlesRoute(symbol, exchange, from, to);
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
