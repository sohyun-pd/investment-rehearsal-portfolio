/**
 * 시뮬레이션 결과 → 화면 문구 단위 테스트.
 *
 * 실행: npm run test:simulationcopy
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { SimulationResult } from "@/domain/simulation";
import type { BacktestComparison } from "@/domain/simulation/types";
import {
  budgetSectionHeading,
  chartSummaryLine,
  formatMetaDate,
  formatQuantity,
  krMarketDataDisclosure,
  monthlyLimitTitle,
  profitLossUnavailableReason,
  profitLossValue,
  resultHeadline,
  tokdaeriComment,
} from "./simulationCopy";

function baseResult(overrides: Partial<SimulationResult> = {}): SimulationResult {
  return {
    symbol: "AAPL",
    period: { from: "2025-07-29", to: "2026-07-28" },
    tradingDayCount: 250,
    recurringExecutionCount: 52,
    conditionalTriggerCount: 0,
    conditionalExecutionCount: 0,
    conditionalBlockedCount: 0,
    totalRecurringInvestmentKrw: 5_200_000,
    totalConditionalInvestmentKrw: 0,
    totalInvestmentKrw: 5_200_000,
    maxMonthlyInvestmentKrw: 500_000,
    maxMonthlyConditionalExecutionCount: 0,
    budgetExceededMonthCount: 0,
    recurringOnlyBudgetExceededMonthCount: 0,
    conditionalCausedBudgetExceededMonthCount: 0,
    reviewTriggeredCount: 0,
    maxAdditionalDeclineAfterTriggerPercent: null,
    monthlyResults: [],
    simulationEvents: [],
    chartSeries: [],
    appliedPolicy: {
      policy: "original" as SimulationResult["appliedPolicy"]["policy"],
      priceField: "close",
      marketHolidayHandling: "next_trading_day",
      priceDecimals: 6,
      percentDecimals: 2,
      conditionalInitialState: null,
      reviewInitialState: null,
    },
    engineVersion: "test",
    calculatedAt: null,
    ...overrides,
  };
}

test("[회귀] 예산을 넘긴 달이 하나도 없으면 '왜 넘었나요' 제목을 쓰지 않는다", () => {
  const result = baseResult({ budgetExceededMonthCount: 0 });
  assert.equal(budgetSectionHeading(result), "월 예산 안에서 실행됐어요");
});

test("예산을 넘긴 달이 있으면 원인을 묻는 제목을 쓴다", () => {
  const result = baseResult({ budgetExceededMonthCount: 2 });
  assert.equal(budgetSectionHeading(result), "예산을 넘긴 달은 왜 생겼나요?");
});

test("[회귀] resultHeadline: 예산을 넘기지 않았으면 짧고 결정적인 제목을 쓴다(ticker·시작일·종료일을 욱여넣지 않는다)", () => {
  const result = baseResult({ budgetExceededMonthCount: 0 });
  assert.equal(resultHeadline(result), "최근 1년 가격에 적용했을 때\n월 예산을 넘지 않았어요");
});

test("resultHeadline: 예산을 넘긴 달이 있으면 그 개월 수를 그대로 반영한다", () => {
  const result = baseResult({ budgetExceededMonthCount: 3 });
  assert.equal(resultHeadline(result), "최근 1년 가격에 적용했을 때\n월 예산을 넘긴 달이 3개월 있었어요");
});

test("formatMetaDate: 하이픈 표기를 점 표기로 바꾼다", () => {
  assert.equal(formatMetaDate("2025-07-28"), "2025.07.28");
});

test("chartSummaryLine: 정기 매수·추가 매수 횟수를 한 줄로 요약한다", () => {
  const result = baseResult({ recurringExecutionCount: 52, conditionalTriggerCount: 0 });
  assert.equal(chartSummaryLine(result), "정기 매수 52회 · 추가 매수 0회");

  const withConditional = baseResult({ recurringExecutionCount: 52, conditionalTriggerCount: 3 });
  assert.equal(chartSummaryLine(withConditional), "정기 매수 52회 · 추가 매수 3회");
});

// ---------------------------------------------------------------------------
// krMarketDataDisclosure() — 국내 결과 화면 하단 데이터 출처 한 줄(§사용자 확정)
// ---------------------------------------------------------------------------

test("krMarketDataDisclosure: 실시간 성공이면 항상 같은 고정 문구를 보여준다", () => {
  assert.equal(
    krMarketDataDisclosure(false, "2025-07-29", "2026-07-28", "2026-07-30"),
    "국내 가격 데이터 · 최근 영업일 종가 기준"
  );
});

test("krMarketDataDisclosure: 폴백인데 스냅샷이 최근(오늘과 며칠 차이)이면 asOfDate 기준 문구를 보여준다", () => {
  assert.equal(
    krMarketDataDisclosure(true, "2025-07-30", "2026-07-28", "2026-07-30"),
    "저장된 실제 시장 데이터 · 2026.07.28 기준"
  );
});

test("krMarketDataDisclosure: 폴백이고 스냅샷이 크게 오래됐으면(10일 초과) 실제 기간을 그대로 보여준다", () => {
  assert.equal(
    krMarketDataDisclosure(true, "2024-07-29", "2025-07-28", "2026-07-30"),
    "2024.07.29~2025.07.28 실제 가격 기준"
  );
});

test("krMarketDataDisclosure: 경계값(정확히 10일 차이)은 아직 '오래됨'이 아니다", () => {
  assert.equal(
    krMarketDataDisclosure(true, "2025-07-30", "2026-07-20", "2026-07-30"),
    "저장된 실제 시장 데이터 · 2026.07.20 기준"
  );
});

// ---------------------------------------------------------------------------
// tokdaeriComment() — §2.5 똑대리 한마디(§사용자 확정 — AI 호출 없이 결정형 문구만 고른다)
// ---------------------------------------------------------------------------

function backtestSummary(overrides: Partial<BacktestComparison["current"]> = {}): BacktestComparison["current"] {
  return {
    totalInvested: 5_200_000,
    totalQuantity: 10,
    endingValue: 5_500_000,
    profitLoss: 300_000,
    returnRate: 5.8,
    averagePurchasePrice: 520_000,
    lastClose: 550_000,
    lastTradingDate: "2026-07-28",
    recurringExecutedCount: 12,
    conditionalExecutedCount: 0,
    budgetSkippedCount: 0,
    ...overrides,
  };
}

function comparisonFixture(overrides: {
  budgetSkippedCount?: number;
  profitLossDifference?: number;
  returnRateDifference?: number | null;
  currentProfitLoss?: number;
}): BacktestComparison {
  return {
    baseline: backtestSummary(),
    current: backtestSummary({
      budgetSkippedCount: overrides.budgetSkippedCount ?? 0,
      ...(overrides.currentProfitLoss !== undefined ? { profitLoss: overrides.currentProfitLoss } : {}),
    }),
    difference: {
      additionalInvested: 400_000,
      endingValueDifference: overrides.profitLossDifference ?? 0,
      profitLossDifference: overrides.profitLossDifference ?? 0,
      returnRateDifference: overrides.returnRateDifference ?? null,
      averagePurchasePriceDifference: null,
    },
  };
}

test("[회귀→§국내주식 1주 미만 계획] profitLossValue: 실행된 매수가 없으면(totalInvested=0) 0원 손익을 만들어내지 않고 '계산할 수 없어요'를 보여준다", () => {
  const result = baseResult({ totalInvested: 0, profitLoss: 0 });
  assert.equal(
    profitLossValue(result, "KRW"),
    "계산할 수 없어요",
    "0원 투자에 손익 0원(또는 수익률 0%)을 표시하면 안 된다"
  );
});

test("[회귀→§국내주식 정수 수량] tokdaeriComment: 실행된 매수가 하나도 없으면(totalInvested=0) '가격이 평균 매수가보다 낮았다'처럼 있지도 않은 매수·하락을 지어내지 않는다", () => {
  const result = baseResult({
    backtestComparison: null,
    conditionalTriggerCount: 0,
    totalInvested: 0,
    profitLoss: 0,
    budgetSkippedEvents: [
      {
        date: "2026-01-05",
        type: "RECURRING",
        requestedAmount: 1_000,
        reason: "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE",
        monthlySpentBefore: 0,
        monthlyBudget: 500_000,
      },
    ],
  });
  assert.equal(
    tokdaeriComment(result, "KRW"),
    "설정한 금액으로는 매수가 실행되지 않았어요.\n금액을 늘리면 같은 기간에서 결과를 비교해볼 수 있어요."
  );
});

test("tokdaeriComment: 조건부 매수 없이 정기 매수만으로 수익이 났으면(삼성전자 시나리오) 고정 문구를 그대로 쓴다", () => {
  const result = baseResult({ backtestComparison: null, conditionalTriggerCount: 0, profitLoss: 300_000 });
  assert.equal(
    tokdaeriComment(result, "KRW"),
    "이번 1년은 정기 매수만으로도 수익이 크게 난 구간이었어요.\n" +
      "추가 매수 조건을 넣으면 같은 기간에서 결과 차이를 확인할 수 있어요."
  );
});

test("tokdaeriComment: 조건부 매수 없이 마지막 가격이 평균 매수가보다 낮으면(전체 손실) 고정 문구를 쓴다", () => {
  const result = baseResult({ backtestComparison: null, conditionalTriggerCount: 0, profitLoss: -120_000 });
  assert.equal(
    tokdaeriComment(result, "KRW"),
    "정기적으로 나눠 샀지만 마지막 가격이 평균 매수가보다 낮았어요.\n" +
      "매수 주기나 추가 매수 조건을 바꿔 같은 기간에서 다시 비교할 수 있어요."
  );
});

test("tokdaeriComment: 추가 매수 조건을 설정했지만 한 번도 발생하지 않았으면 0회 문구를 쓴다", () => {
  const result = baseResult({
    conditionalTriggerCount: 0,
    backtestComparison: comparisonFixture({ profitLossDifference: 0, returnRateDifference: 0 }),
  });
  assert.equal(
    tokdaeriComment(result, "KRW"),
    "이번 기간에는 설정한 하락 조건이 발생하지 않았어요.\n" +
      "기준을 낮추면 같은 기간에서 추가 매수 효과를 비교할 수 있어요."
  );
});

test("tokdaeriComment: 추가 매수 후 평가손익·수익률이 함께 올랐으면 상승 문구를 쓴다", () => {
  const result = baseResult({
    conditionalTriggerCount: 2,
    backtestComparison: comparisonFixture({ profitLossDifference: 150_000, returnRateDifference: 1.2 }),
  });
  assert.equal(
    tokdaeriComment(result, "KRW"),
    "추가 매수한 구간이 이후 상승으로 이어지며 수익률도 함께 높아졌어요.\n" + "다만 늘어난 투자금까지 함께 비교해보세요."
  );
});

test("tokdaeriComment: 평가손익은 늘었지만 투자금이 더 크게 늘어 수익률이 낮아졌으면 그 문구를 쓴다", () => {
  const result = baseResult({
    conditionalTriggerCount: 2,
    backtestComparison: comparisonFixture({ profitLossDifference: 150_000, returnRateDifference: -0.3 }),
  });
  assert.equal(
    tokdaeriComment(result, "KRW"),
    "평가손익은 늘었지만 투자금이 더 크게 증가해 수익률은 낮아졌어요.\n" + "수익 금액과 투자 효율을 함께 볼 필요가 있어요."
  );
});

test("tokdaeriComment: 수익률은 높아졌지만 투자금이 늘어 평가손실이 더 커졌으면 그 트레이드오프를 실제 델타로 알려준다", () => {
  const result = baseResult({
    conditionalTriggerCount: 2,
    backtestComparison: comparisonFixture({ profitLossDifference: -620_000, returnRateDifference: 3.4, currentProfitLoss: -150_000 }),
  });
  assert.equal(
    tokdaeriComment(result, "KRW"),
    "추가 매수로 수익률은 3.4%p 높아졌지만,\n" + "투자금이 늘어 평가손실은 620,000원 더 커졌어요"
  );
});

test("tokdaeriComment: 추가 매수 조건 발생 후 평가손익이 오히려 낮아졌으면 개선 아님 문구를 쓴다", () => {
  const result = baseResult({
    conditionalTriggerCount: 2,
    backtestComparison: comparisonFixture({ profitLossDifference: -80_000, returnRateDifference: -0.5 }),
  });
  assert.equal(
    tokdaeriComment(result, "KRW"),
    "추가 매수가 이번 결과 개선으로 이어지지 않았어요.\n" + "조건을 조정해 같은 기간에서 다시 비교해볼 수 있어요."
  );
});

test("tokdaeriComment: 월 투자 한도로 일부 추가 매수가 실행되지 않았으면 다른 조건보다 우선해 그 문구를 쓴다", () => {
  const result = baseResult({
    conditionalTriggerCount: 2,
    backtestComparison: comparisonFixture({
      budgetSkippedCount: 1,
      profitLossDifference: 150_000,
      returnRateDifference: 1.2,
    }),
  });
  assert.equal(
    tokdaeriComment(result, "KRW"),
    "월 투자 한도로 일부 추가 매수가 실행되지 않았어요.\n" +
      "한도를 바꾸면 같은 조건에서 결과가 어떻게 달라지는지 확인할 수 있어요."
  );
});

test("tokdaeriComment: 응답은 항상 최대 2문장(줄바꿈 1개)이고 70자를 크게 넘지 않는다", () => {
  const scenarios: SimulationResult[] = [
    baseResult({ backtestComparison: null, conditionalTriggerCount: 0, profitLoss: 300_000 }),
    baseResult({ backtestComparison: null, conditionalTriggerCount: 0, profitLoss: -1 }),
    baseResult({ conditionalTriggerCount: 0, backtestComparison: comparisonFixture({}) }),
    baseResult({
      conditionalTriggerCount: 2,
      backtestComparison: comparisonFixture({ profitLossDifference: 1, returnRateDifference: 1 }),
    }),
    baseResult({
      conditionalTriggerCount: 2,
      backtestComparison: comparisonFixture({ profitLossDifference: 1, returnRateDifference: -1 }),
    }),
    baseResult({
      conditionalTriggerCount: 2,
      backtestComparison: comparisonFixture({ profitLossDifference: -1, returnRateDifference: -1 }),
    }),
    baseResult({
      conditionalTriggerCount: 2,
      backtestComparison: comparisonFixture({ profitLossDifference: -620_000, returnRateDifference: 3.4, currentProfitLoss: -150_000 }),
    }),
    baseResult({
      conditionalTriggerCount: 2,
      backtestComparison: comparisonFixture({ budgetSkippedCount: 1 }),
    }),
  ];

  for (const result of scenarios) {
    const comment = tokdaeriComment(result, "KRW");
    const sentences = comment.split("\n").filter((line) => line !== "");
    assert.ok(sentences.length <= 2, `2문장 이하여야 함: ${comment}`);
    assert.ok(comment.length <= 80, `70자 내외를 크게 넘으면 안 됨(80자 상한): ${comment}`);
  }
});

// ---------------------------------------------------------------------------
// §국내주식 정수 수량 매수(§사용자 확정 — P0 계산 오류 수정) — formatQuantity·
// profitLossUnavailableReason·monthlyLimitTitle 이 시장(통화)별로 올바르게 갈리는지 검증한다.
// ---------------------------------------------------------------------------

test("formatQuantity: 국내주식(KRW)은 정수 '주'로, 미국주식(USD)은 소수점 4자리로 표시한다", () => {
  assert.equal(formatQuantity(2, "KRW"), "2주");
  assert.equal(formatQuantity(0, "KRW"), "0주");
  assert.equal(formatQuantity(1234, "KRW"), "1,234주");
  assert.equal(formatQuantity(78.2894, "USD"), "78.2894주");
});

test("profitLossUnavailableReason: 국내주식 정기 매수가 1주 가격 미달로 전부 스킵되면 그 사유를 정확히 말한다", () => {
  const result = baseResult({
    totalInvested: 0,
    budgetSkippedEvents: [
      {
        date: "2026-01-05",
        type: "RECURRING",
        requestedAmount: 1_000,
        reason: "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE",
        monthlySpentBefore: 0,
        monthlyBudget: 500_000,
      },
    ],
  });
  assert.equal(
    profitLossUnavailableReason(result),
    "설정한 금액으로 1주를 살 수 없어\n정기 매수가 실행되지 않았어요.\n국내주식은 1주 단위로 계산해요."
  );
});

test("profitLossUnavailableReason: 국내주식 추가 매수가 1주 가격 미달로 스킵되면 '추가 매수'로 정확히 말한다", () => {
  const result = baseResult({
    totalInvested: 0,
    budgetSkippedEvents: [
      {
        date: "2026-01-07",
        type: "CONDITIONAL",
        requestedAmount: 1_000,
        reason: "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE",
        monthlySpentBefore: 0,
        monthlyBudget: null,
      },
    ],
  });
  assert.equal(
    profitLossUnavailableReason(result),
    "설정한 금액으로 1주를 살 수 없어\n추가 매수가 실행되지 않았어요.\n국내주식은 1주 단위로 계산해요."
  );
});

test("[회귀] profitLossUnavailableReason: 스킵 사유가 없으면(예: 조건부 매수만 있는 계획) 기존 일반 문구를 그대로 쓴다", () => {
  const result = baseResult({ totalInvested: 0, budgetSkippedEvents: [] });
  assert.equal(profitLossUnavailableReason(result), "실행된 매수가 없어 계산할 수 없어요.");
});

test("monthlyLimitTitle: §국내주식 정수 수량 — 월 한도 스킵과 1주 가격 미달 스킵을 구분해 말한다", () => {
  const skip = (reason: "MONTHLY_BUDGET_EXCEEDED" | "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE") => ({
    date: "2026-01-05",
    type: "RECURRING" as const,
    requestedAmount: 1_000,
    reason,
    monthlySpentBefore: 0,
    monthlyBudget: 500_000,
  });

  assert.equal(monthlyLimitTitle(baseResult({ budgetSkippedEvents: [] })), "월 한도 안에서 모두 실행됐어요");
  assert.equal(
    monthlyLimitTitle(baseResult({ budgetSkippedEvents: [skip("MONTHLY_BUDGET_EXCEEDED")] })),
    "월 한도로 1번의 매수가 실행되지 않았어요"
  );
  assert.equal(
    monthlyLimitTitle(baseResult({ budgetSkippedEvents: [skip("INSUFFICIENT_AMOUNT_FOR_ONE_SHARE")] })),
    "1주 가격 미달로 1번의 매수가 실행되지 않았어요",
    "월 한도가 원인이 아닐 때 '월 한도로'라고 말하면 안 된다"
  );
  assert.equal(
    monthlyLimitTitle(
      baseResult({ budgetSkippedEvents: [skip("MONTHLY_BUDGET_EXCEEDED"), skip("INSUFFICIENT_AMOUNT_FOR_ONE_SHARE")] })
    ),
    "월 한도·1주 가격 미달로 2번의 매수가 실행되지 않았어요"
  );
});
