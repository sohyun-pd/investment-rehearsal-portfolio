/**
 * 사용성 피드백 설문 타입 — 투자 계획·결과 상태(FlowProvider)와 완전히 분리한다.
 *
 * 근거: 사용자 확정 — InvestmentPlan·ConversationPhase·revisionState 에 설문 관련 필드를
 * 추가하지 않는다. 개인정보·실제 투자 정보(종목·금액·대화 전문·계정 정보)를 담지 않는다.
 */

export type InvestmentExperience = "none" | "under_1_year" | "1_to_3_years" | "over_3_years";

export type ProductUnderstanding =
  | "recommendation"
  | "prediction"
  | "historical_rehearsal"
  | "automatic_order"
  | "unknown";

export type HardestStep =
  | "input"
  | "asset_search"
  | "conditional_rule"
  | "plan_confirmation"
  | "result"
  | "none";

export type OrderCapabilityUnderstanding = "yes" | "no" | "unknown";

export const MAX_OPEN_FEEDBACK_LENGTH = 500;

/** 설문 작성 중인 draft — 아직 답하지 않은 필수 문항은 null 이다(임의로 채우지 않는다). */
export interface FeedbackDraft {
  investmentExperience: InvestmentExperience | null;
  productUnderstanding: ProductUnderstanding | null;
  reachedResult: boolean | null;
  hardestStep: HardestStep | null;
  resultComprehensionScore: 1 | 2 | 3 | 4 | 5 | null;
  orderCapabilityUnderstanding: OrderCapabilityUnderstanding | null;
  openFeedback: string;
}

export function emptyFeedbackDraft(): FeedbackDraft {
  return {
    investmentExperience: null,
    productUnderstanding: null,
    reachedResult: null,
    hardestStep: null,
    resultComprehensionScore: null,
    orderCapabilityUnderstanding: null,
    openFeedback: "",
  };
}

/** 필수 문항(1~6)이 모두 채워졌는지 — 자유 의견(7)은 선택이다. */
export function isFeedbackDraftComplete(
  draft: FeedbackDraft
): draft is FeedbackDraft & {
  investmentExperience: InvestmentExperience;
  productUnderstanding: ProductUnderstanding;
  reachedResult: boolean;
  hardestStep: HardestStep;
  resultComprehensionScore: 1 | 2 | 3 | 4 | 5;
  orderCapabilityUnderstanding: OrderCapabilityUnderstanding;
} {
  return (
    draft.investmentExperience !== null &&
    draft.productUnderstanding !== null &&
    draft.reachedResult !== null &&
    draft.hardestStep !== null &&
    draft.resultComprehensionScore !== null &&
    draft.orderCapabilityUnderstanding !== null
  );
}

export interface FeedbackSubmissionPayload {
  sessionId: string;
  investmentExperience: InvestmentExperience;
  productUnderstanding: ProductUnderstanding;
  reachedResult: boolean;
  hardestStep: HardestStep;
  resultComprehensionScore: 1 | 2 | 3 | 4 | 5;
  orderCapabilityUnderstanding: OrderCapabilityUnderstanding;
  openFeedback?: string;
}
