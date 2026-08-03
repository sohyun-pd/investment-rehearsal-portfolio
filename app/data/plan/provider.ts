/**
 * 계획 해석·수정 provider 선택 — 앱(FlowProvider)이 부르는 유일한 진입점.
 *
 * `@/data/market/provider.ts` 와 같은 패턴: `VITE_USE_MOCK_AI=true` 일 때만
 * 오프라인 데모 provider(`@/mocks/planInterpret`·`@/mocks/planRevise`)로 분기한다.
 * 실패는 이 분기를 바꾸지 않는다.
 */
import { isMockAiEnabled } from "@/config/aiMode";
import { interpretPlanClient } from "./client";
import { revisePlanClient } from "./reviseClient";
import { interpretPlanMock } from "@/mocks/planInterpret";
import { revisePlanMock } from "@/mocks/planRevise";
import type { PlanInterpretRequest, PlanInterpretResponse } from "@/types/planInterpret";
import type { PlanReviseRequest, PlanReviseResponse } from "@/types/planRevise";

export function interpretPlan(request: PlanInterpretRequest): Promise<PlanInterpretResponse> {
  return isMockAiEnabled() ? interpretPlanMock(request) : interpretPlanClient(request);
}

export function revisePlan(request: PlanReviseRequest): Promise<PlanReviseResponse> {
  return isMockAiEnabled() ? revisePlanMock(request) : revisePlanClient(request);
}
