/**
 * Cloudflare Pages Function — GET /api/quote?symbol=
 *
 * Production BFF. 로직은 `server/marketRoutes.ts`(런타임 무관, Vite 미들웨어와 공유)에 있다.
 * API 키는 `context.env`(Cloudflare Pages 서버 환경변수)에서만 읽는다.
 */
import { handleQuoteRoute } from "../../server/marketRoutes";
import { extractErrorCode, logRequestOutcome, nextRequestId } from "../../server/requestLog";

interface Env {
  FINNHUB_API_KEY: string;
}

const ROUTE = "GET /api/quote";

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const requestId = nextRequestId();
  const startedAt = Date.now();
  const url = new URL(context.request.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const result = await handleQuoteRoute(symbol, context.env.FINNHUB_API_KEY ?? "");
  logRequestOutcome(requestId, {
    route: ROUTE,
    status: result.status,
    durationMs: Date.now() - startedAt,
    errorCode: extractErrorCode(result.body),
  });
  return Response.json(result.body, { status: result.status });
};
