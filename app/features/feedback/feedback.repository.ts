/**
 * 설문 제출 — POST /api/feedback 하나만 호출한다. 성공 여부를 절대 지어내지 않는다
 * (§사용자 확정 — 저장 endpoint 가 준비되지 않았으면 명확한 실패를 그대로 알린다).
 */
import type { FeedbackSubmissionPayload } from "./feedback.types";

export type FeedbackSubmitResult =
  | { ok: true }
  | { ok: false; userMessage: string; retryable: boolean };

export async function submitFeedback(payload: FeedbackSubmissionPayload): Promise<FeedbackSubmitResult> {
  let response: Response;
  try {
    response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, userMessage: "의견을 보내지 못했어요. 잠시 후 다시 시도해주세요.", retryable: true };
  }

  if (response.ok) return { ok: true };

  let userMessage = "의견을 보내지 못했어요. 잠시 후 다시 시도해주세요.";
  let retryable = true;
  try {
    const body = (await response.json()) as { error?: { userMessage?: string; retryable?: boolean } };
    if (typeof body.error?.userMessage === "string") userMessage = body.error.userMessage;
    if (typeof body.error?.retryable === "boolean") retryable = body.error.retryable;
  } catch {
    // 응답 본문을 읽지 못해도 기본 메시지로 충분히 정직하다.
  }
  return { ok: false, userMessage, retryable };
}
