/**
 * POST /api/plan/interpret 브라우저 클라이언트.
 *
 * 근거: 사용자 확정 — server/BFF(Cloudflare Pages Functions)만 Claude 를 호출한다.
 * 이 파일은 키를 다루지 않는다. 실패 시 mock 으로 자동 전환하지 않는다(호출부가 결정).
 *
 * `conversation`(Claude 호출 자체 실패)과 `plan_structure`(구조화 출력 검증 실패)를
 * 서버가 이미 구분해 보내므로, 여기서는 그 stage 를 그대로 옮긴다.
 */
import type { PlanInterpretRequest, PlanInterpretResponse } from "@/types/planInterpret";

export interface PlanInterpretClientError {
  stage: "conversation" | "plan_structure";
  code: string;
  userMessage: string;
  retryable: boolean;
}

function isPlanInterpretClientError(value: unknown): value is PlanInterpretClientError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { stage?: unknown }).stage !== undefined &&
    typeof (value as { userMessage?: unknown }).userMessage === "string" &&
    typeof (value as { retryable?: unknown }).retryable === "boolean"
  );
}

function networkError(): PlanInterpretClientError {
  return {
    stage: "conversation",
    code: "network_failure",
    userMessage: "연결이 원활하지 않아요. 다시 시도해주세요.",
    retryable: true,
  };
}

export async function interpretPlanClient(
  request: PlanInterpretRequest,
  signal?: AbortSignal
): Promise<PlanInterpretResponse> {
  let response: Response;
  try {
    response = await fetch("/api/plan/interpret", {
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
    throw isPlanInterpretClientError(apiError) ? apiError : networkError();
  }

  return body as PlanInterpretResponse;
}
