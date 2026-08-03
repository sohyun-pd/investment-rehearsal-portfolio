/**
 * ⚠️ 정적 데모 데이터 — 실제 API(Claude/Finnhub) 응답이 아님.
 *
 * USER_FLOW.md 의 애플 시나리오를 그대로 옮긴 고정 예시값이다.
 * 네트워크/어댑터와 분리되어 있으며, 실제 연동은 다음 단계에서 spikes/ 어댑터로 대체한다.
 * 모든 export 는 `DEMO_` 접두어.
 */
import type { MarketData, Strategy } from "@/types/strategy";

/** 이 파일이 데모 데이터임을 코드에서 식별하기 위한 플래그. */
export const IS_DEMO_DATA = true as const;

/** Screen 1 기본 입력값. */
export const DEMO_DEFAULT_INPUT =
  "애플을 매주 5만 원씩 사고, 평균 매수가보다 3% 떨어지면 2만 원 더 사고 싶어.";

/** Screen 1 예시 문장. */
export const DEMO_EXAMPLE_PROMPTS: readonly string[] = [
  "엔비디아가 10% 오르면 절반을 팔고 싶어.",
  "테슬라를 매주 30달러씩 모으고 싶어.",
  "마이크로소프트가 5% 떨어지면 50달러 추가 매수하고 싶어.",
];

/** Screen 4 시세(AAPL 지연 시세). */
export const DEMO_MARKET: MarketData = {
  symbol: "AAPL",
  companyName: "Apple Inc.",
  currentPrice: 336.91,
  previousClose: 333.02,
  changePercent: 1.17,
  currency: "USD",
  timestamp: "2026-07-27T20:00:00.000Z", // 직전 미국 정규장 마감 → 05:00 KST
  delayed: true,
  source: "finnhub",
};

/**
 * Screen 3 — 아직 평균 매수가가 비어 추가 질문이 필요한 상태.
 * (referencePrice = null, status = needs_clarification)
 */
export const DEMO_STRATEGY_NEEDS_CLARIFY: Strategy = {
  id: "demo-aapl",
  originalInput: DEMO_DEFAULT_INPUT,
  symbol: "AAPL",
  companyName: "Apple Inc.",
  market: "US",
  currency: "KRW",
  conditions: [
    {
      id: "c1",
      type: "recurring_buy",
      frequency: "weekly",
      amount: 50000,
      currency: "KRW",
      weekday: 1, // 월요일
      startDate: null,
    },
    {
      id: "c2",
      type: "conditional_buy",
      referenceType: "average_cost",
      referencePrice: null, // 사용자 입력 필요
      referenceCurrency: "USD",
      direction: "down",
      thresholdPercent: 3,
      amount: 20000,
      amountCurrency: "KRW",
    },
  ],
  clarificationQuestions: [
    {
      id: "q1",
      fieldPath: "conditions.c2.referencePrice",
      question: "현재 애플의 평균 매수가는 얼마인가요?",
      inputType: "number",
      unit: "USD",
      required: true,
    },
  ],
  marketData: DEMO_MARKET,
  status: "needs_clarification",
};

/** Screen 3 질문별 보조 문구/예시값(스키마 외 화면 표시용). */
export const DEMO_CLARIFY_HINTS: Record<string, { placeholder: string; helper: string }> = {
  q1: {
    placeholder: "320",
    helper: "평균 매수가보다 3% 떨어졌을 때 추가로 사는 조건을 계산하는 데 필요해요.",
  },
};

/**
 * Screen 4·5·6 — 평균 매수가($320)까지 채워진 확정 직전 상태.
 */
export const DEMO_STRATEGY_READY: Strategy = {
  ...DEMO_STRATEGY_NEEDS_CLARIFY,
  conditions: [
    DEMO_STRATEGY_NEEDS_CLARIFY.conditions[0]!,
    {
      id: "c2",
      type: "conditional_buy",
      referenceType: "average_cost",
      referencePrice: 320,
      referenceCurrency: "USD",
      direction: "down",
      thresholdPercent: 3,
      amount: 20000,
      amountCurrency: "KRW",
    },
  ],
  clarificationQuestions: [],
  status: "ready",
};
