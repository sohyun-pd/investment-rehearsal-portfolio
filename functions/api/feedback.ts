/**
 * Cloudflare Pages Function — POST /api/feedback
 *
 * Production BFF. 로직은 `server/feedbackRoute.ts`(런타임 무관, Vite 미들웨어와 공유)에 있다.
 * Google Apps Script Web App URL·토큰은 `context.env`(Cloudflare Pages 서버 환경변수)에서만
 * 읽는다 — 설정되지 않았으면 성공한 것처럼 속이지 않고 정직한 오류를 돌려준다. 클라이언트는
 * Apps Script 를 직접 호출하지 않는다 — 이 Function 이 유일한 경로다.
 */
import { handleFeedbackRoute } from "../../server/feedbackRoute";
import { parseJsonBodyWithLimit } from "../../server/pagesFunctionHelpers";
import { extractErrorCode, logRequestOutcome, nextRequestId } from "../../server/requestLog";

interface Env {
  FEEDBACK_APPS_SCRIPT_URL?: string;
  FEEDBACK_API_TOKEN?: string;
}

const ROUTE = "POST /api/feedback";

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const requestId = nextRequestId();
  const startedAt = Date.now();
  const body = await parseJsonBodyWithLimit(context.request);

  const result = await handleFeedbackRoute(
    body,
    {
      appsScriptUrl: context.env.FEEDBACK_APPS_SCRIPT_URL ?? "",
      token: context.env.FEEDBACK_API_TOKEN ?? "",
    },
    { userAgent: context.request.headers.get("user-agent") ?? "" }
  );
  logRequestOutcome(requestId, {
    route: ROUTE,
    status: result.status,
    durationMs: Date.now() - startedAt,
    errorCode: extractErrorCode(result.body),
  });
  return Response.json(result.body, { status: result.status });
};
