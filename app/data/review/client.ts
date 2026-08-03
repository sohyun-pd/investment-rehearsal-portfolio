/**
 * POST /api/review 브라우저 클라이언트.
 *
 * `app/data/plan/client.ts` 와 같은 패턴 — 키를 다루지 않고, 서버 stage(`ai_review`)를
 * 그대로 옮긴다. 실패 시 mock 으로 자동 전환하지 않는다(호출부가 deterministic fallback 을
 * 쓸지 결정 — `app/lib/reviewFallback.ts`).
 */
import type { ReviewRequest, ReviewResponse } from "@/types/review";

export interface ReviewClientError {
  stage: "ai_review";
  code: string;
  userMessage: string;
  retryable: boolean;
}

function isReviewClientError(value: unknown): value is ReviewClientError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { stage?: unknown }).stage !== undefined &&
    typeof (value as { userMessage?: unknown }).userMessage === "string" &&
    typeof (value as { retryable?: unknown }).retryable === "boolean"
  );
}

function networkError(): ReviewClientError {
  return {
    stage: "ai_review",
    code: "network_failure",
    userMessage: "연결이 원활하지 않아요. 다시 시도해주세요.",
    retryable: true,
  };
}

export async function getReviewClient(
  request: ReviewRequest,
  signal?: AbortSignal
): Promise<ReviewResponse> {
  let response: Response;
  try {
    response = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw networkError();
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok || body === null) {
    const apiError = (body as { error?: unknown } | null)?.error;
    throw isReviewClientError(apiError) ? apiError : networkError();
  }

  return body as ReviewResponse;
}
