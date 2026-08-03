/**
 * 오프라인 데모 수정 요청 해석 — `VITE_USE_MOCK_AI=true` 일 때만 쓴다.
 *
 * 자연어를 실제로 해석할 능력이 없다 — 항상 재질문으로 응답한다. 이 mock이 임의로 필드를
 * 바꾸는 것보다, 데모 모드의 한계를 정직하게 보여주는 편이 안전하다(임의 mock 파싱 금지).
 */
import type { PlanReviseRequest, PlanReviseResponse } from "@/types/planRevise";

const MOCK_DELAY_MS = 500;

export async function revisePlanMock(_request: PlanReviseRequest): Promise<PlanReviseResponse> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

  return {
    understoodRequest: "데모 모드에서는 수정 요청을 실제로 해석할 수 없어요.",
    proposedChanges: [],
    unchangedFields: [],
    unresolvedFields: [
      {
        fieldPath: "general",
        question: "데모 데이터 모드예요. 실제 AI 연결 후 다시 시도해주세요.",
      },
    ],
    confirmationCopy: "적용할 변경 사항이 없어요.",
    warnings: [],
  };
}
