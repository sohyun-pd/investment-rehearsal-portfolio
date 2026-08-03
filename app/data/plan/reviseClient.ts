/**
 * POST /api/plan/revise 브라우저 클라이언트.
 *
 * `app/data/plan/client.ts`(interpret)와 같은 패턴 — 키를 다루지 않고, 서버가 구분해 보낸
 * stage(conversation/plan_structure)를 그대로 옮긴다. 실패 시 mock 으로 자동 전환하지 않는다.
 */
import type { PlanReviseRequest, PlanReviseResponse } from "@/types/planRevise";

export interface PlanReviseClientError {
  stage: "conversation" | "plan_structure";
  code: string;
  userMessage: string;
  retryable: boolean;
}

function isPlanReviseClientError(value: unknown): value is PlanReviseClientError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { stage?: unknown }).stage !== undefined &&
    typeof (value as { userMessage?: unknown }).userMessage === "string" &&
    typeof (value as { retryable?: unknown }).retryable === "boolean"
  );
}

function networkError(): PlanReviseClientError {
  return {
    stage: "conversation",
    code: "network_failure",
    userMessage: "연결이 원활하지 않아요. 다시 시도해주세요.",
    retryable: true,
  };
}

export async function revisePlanClient(
  request: PlanReviseRequest,
  signal?: AbortSignal
): Promise<PlanReviseResponse> {
  let response: Response;
  try {
    response = await fetch("/api/plan/revise", {
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
    throw isPlanReviseClientError(apiError) ? apiError : networkError();
  }

  return body as PlanReviseResponse;
}
