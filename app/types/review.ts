/**
 * POST /api/review — 요청·응답 타입(순수 타입, 런타임 로직 없음).
 *
 * 원칙(사용자 확정):
 *  - AI 는 새 숫자를 만들지 않는다. 전달받은 숫자만 문장에 쓸 수 있다(서버가 검증한다,
 *    `server/reviewRoute.ts`).
 *  - budgetExceededCause 는 simulation 엔진 결과에서만 결정한다 — AI 는 원인을 추론하지 않고
 *    이미 확정된 `causeSentence` 를 그대로 쓰거나 다듬는다.
 *  - 미래 가격·수익률·추천·매수 판단 문구를 쓰지 않는다.
 */

export type BudgetExceededCauseBucket = "recurring_only" | "conditional_action" | "mixed" | "none";

export interface ReviewPlanSummary {
  symbol: string;
  companyName: string;
  hasRecurring: boolean;
  hasConditionalBuy: boolean;
  monthlyBudgetKrw: number | null;
  currency: "USD" | "KRW";
}

/** SimulationResult 에서 이 화면 설명에 필요한 필드만 뽑는다(원본 전체를 보내지 않는다). */
export interface ReviewSimulationSummary {
  maxMonthlyInvestmentKrw: number;
  budgetExceededMonthCount: number;
  recurringOnlyBudgetExceededMonthCount: number;
  conditionalCausedBudgetExceededMonthCount: number;
  conditionalTriggerCount: number;
  conditionalExecutionCount: number;
  conditionalBlockedCount: number;
  recurringExecutionCount: number;
  reviewTriggeredCount: number;
  maxAdditionalDeclineAfterTriggerPercent: number | null;
  totalInvestmentKrw: number;
  /** 조건부 매수가 있을 때만 값이 있다("정기 매수만" 기준과 비교) — §AI 설명에 예산 상태만
   * 반복하지 않고 실제 손익·수익률 변화를 해석시키기 위해 추가했다. */
  additionalInvested: number | null;
  profitLossDifference: number | null;
  returnRateDifference: number | null;
}

export interface ReviewRequest {
  /** §production 안정성 — 세션별 rate limit 키로만 쓴다(Cloudflare Pages Function 에서만
   * 읽는다). 리뷰 생성 로직 자체는 이 값을 보지 않는다. */
  sessionId: string;
  locale: "ko-KR";
  plan: ReviewPlanSummary;
  summary: ReviewSimulationSummary;
  period: { from: string; to: string; tradingDayCount: number };
  /** simulation 결과에서만 결정된 값(엔진 판정 규칙 그대로) — AI 는 이걸 바꾸지 않는다. */
  budgetExceededCause: BudgetExceededCauseBucket;
  /** `app/lib/simulationCopy.ts` 의 `budgetCauseSentence()` 로 이미 만든 문장. AI 가 참고·인용한다. */
  causeSentence: string;
  quoteStatus: "ok" | "failed" | "unavailable";
}

export interface ReviewResponse {
  headline: string;
  /** 최대 3문장. */
  explanation: string[];
  evidenceLabels: string[];
  caution: string;
}
