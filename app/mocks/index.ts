/**
 * 아직 실제 API 로 연결하지 않은 부분을 위한 typed mock data.
 *
 * ⚠️ **실제 API·실제 시세가 아니다.**
 *
 * 남아 있는 목적별 안내:
 *  - `MOCK_QUESTIONS`      → 다음 단계에서 Claude structured output 으로 교체
 *  - `MOCK_AI_REVIEW`      → 다음 단계에서 Claude generate_ai_review 로 교체
 *  - `MOCK_PLAN`           → 개발용 데모 계획(질문을 건너뛰고 화면을 보고 싶을 때)
 *
 * 시장 데이터(종목 검색·현재가·과거 일봉)의 오프라인 데모 provider는 이제
 * `app/mocks/marketProvider.ts` 에 있고, `app/data/market/provider.ts` 를 거쳐서만 쓰인다
 * (`VITE_USE_MOCK_MARKET=true` 일 때만). 이 파일은 더 이상 candles/quote/조정안을 만들지
 * 않는다 — 실제 흐름(`FlowProvider`)과 결과가 갈리는 하드코딩을 남기지 않기 위해서다.
 */
import type { AppPlan } from "@/types/appPlan";

/** 데모 계획. Screen 2 를 건너뛰고 화면을 보고 싶을 때 쓰는 시작값이다. */
export const MOCK_PLAN: AppPlan = {
  originalInput: "애플을 매주 조금씩 사고, 가격이 떨어지면 더 사고 싶어요.",
  asset: { symbol: "AAPL", displayName: "Apple Inc.", market: "US", quoteCurrency: "USD" },
  recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50_000 },
  conditionalBuy: { thresholdPercent: 3, amountKrw: 20_000 },
  guardrails: {
    monthlyBudgetKrw: 200_000,
    maxConditionalExecutionsPerMonth: null,
    reviewDrawdownPercent: null,
  },
  version: 1,
};

/** Claude 가 만들 질문 자리. 지금은 고정 목록이다. */
export interface MockQuestion {
  id: string;
  fieldPath: string;
  question: string;
  reason: string;
  inputType: "select" | "money" | "percent";
  options: Array<{ id: string; label: string; value: number | string }>;
}

export const MOCK_QUESTIONS: MockQuestion[] = [
  {
    id: "q_recurring_amount",
    fieldPath: "recurring.amountKrw",
    question: "매주 얼마씩 살까요?",
    reason: "정기 매수 금액이에요. 나중에 바꿀 수 있어요.",
    inputType: "money",
    options: [
      { id: "a1", label: "30,000원", value: 30_000 },
      { id: "a2", label: "50,000원", value: 50_000 },
      { id: "a3", label: "100,000원", value: 100_000 },
    ],
  },
  {
    id: "q_threshold",
    fieldPath: "conditionalBuy.thresholdPercent",
    question: "몇 % 떨어지면 더 살까요?",
    reason: "평균 매수가 대비 하락률이에요.",
    inputType: "percent",
    options: [
      { id: "c1", label: "3%", value: 3 },
      { id: "c2", label: "5%", value: 5 },
      { id: "c3", label: "10%", value: 10 },
    ],
  },
  {
    id: "q_monthly_budget",
    fieldPath: "guardrails.monthlyBudgetKrw",
    question: "한 달에 최대 얼마까지 쓸까요?",
    reason: "이 금액을 넘는 달이 있는지 알려드릴게요.",
    inputType: "money",
    options: [
      { id: "d1", label: "200,000원", value: 200_000 },
      { id: "d2", label: "300,000원", value: 300_000 },
      { id: "d3", label: "정하지 않을게요", value: 0 },
    ],
  },
];

/** Claude 가 만들 결론 문장 자리. 숫자는 여기서 만들지 않는다. */
export const MOCK_AI_REVIEW = {
  headline: "계획대로라면 월 예산을 넘는 달이 있어요",
  risks: [
    "추가 매수 횟수에 제한이 없어요.",
    "계획을 다시 검토할 기준이 없어요.",
  ],
};
