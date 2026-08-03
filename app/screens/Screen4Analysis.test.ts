/**
 * Screen4Analysis 의 화면 분기 로직(resolveAnalysisScreenKind) + 문구 상수 단위 테스트.
 *
 * 실행: npm run test:analysis
 *
 * 이 저장소에는 컴포넌트 렌더링 테스트 도구(jsdom·React Testing Library 등)가 없다 — 그래서
 * "어떤 화면을 그릴지" 결정하는 순수 함수를 분리해 그 로직만 단위 테스트한다. 실제 화면에
 * 그 문구·버튼이 정확히 나타나는지는 이 테스트만으로 보장되지 않는다(§완료 보고에 명시).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MARKET_NOT_SUPPORTED_DESCRIPTION,
  MARKET_NOT_SUPPORTED_TITLE,
  resolveAnalysisScreenKind,
  resolveResultCtaCopy,
} from "./Screen4Analysis";
import { TOTAL_STEPS } from "@/flow/appFlowState";
import type { FlowError } from "@/flow/appFlowState";
import type { SimulationResult } from "@/domain/simulation";

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

function marketNotSupportedError(): FlowError {
  return {
    stage: "historical_data",
    code: "market_not_supported",
    userMessage: "국내 종목의 가격 데이터는 아직 준비 중이에요.",
    retryable: false,
  };
}

test("[회귀] 국내 종목 market_not_supported 오류는 market_not_supported 화면으로 간다(일반 오류·재시도 화면이 아니다)", () => {
  const kind = resolveAnalysisScreenKind(marketNotSupportedError(), "analysis_ready", null);
  assert.equal(kind, "market_not_supported");
});

test("market_not_supported 는 simulation 이 있어도(이미 결과가 있었더라도) 항상 우선한다", () => {
  const kind = resolveAnalysisScreenKind(marketNotSupportedError(), "analysis_ready", baseResult());
  assert.equal(kind, "market_not_supported", "가격 데이터 오류가 있으면 결과 화면으로 새지 않아야 한다");
});

test("같은 historical_data 단계라도 다른 코드(no_data 등)는 일반 fatal_error 화면으로 간다", () => {
  const noDataError: FlowError = {
    stage: "historical_data",
    code: "no_data",
    userMessage: "해당 기간 데이터를 찾지 못했어요.",
    retryable: true,
  };
  assert.equal(resolveAnalysisScreenKind(noDataError, "analysis_ready", null), "fatal_error");
});

test("simulation 단계 오류도 fatal_error 로 처리한다(market_not_supported 전용 분기와 구분)", () => {
  const simError: FlowError = {
    stage: "simulation",
    code: "invalid_average_cost",
    userMessage: "계산에 실패했어요.",
    retryable: true,
  };
  assert.equal(resolveAnalysisScreenKind(simError, "analysis_ready", null), "fatal_error");
});

test("오류가 없고 simulation 이 아직 없으면 loading 이다", () => {
  assert.equal(resolveAnalysisScreenKind(null, "loading_market_data", null), "loading");
  assert.equal(resolveAnalysisScreenKind(null, "simulating", null), "loading");
  assert.equal(resolveAnalysisScreenKind(null, "analysis_ready", null), "loading", "flowState 만 ready 여도 simulation 이 없으면 loading 이다");
});

test("오류가 없고 flowState 가 analysis_ready 이며 simulation 이 있으면 ready 다", () => {
  assert.equal(resolveAnalysisScreenKind(null, "analysis_ready", baseResult()), "ready");
});

test("[회귀] market_not_supported 화면 문구는 provider·요금제명을 노출하지 않는 정확히 이 텍스트여야 한다", () => {
  assert.equal(MARKET_NOT_SUPPORTED_TITLE, "국내 종목의 가격 데이터는 아직 준비 중이에요");
  assert.equal(
    MARKET_NOT_SUPPORTED_DESCRIPTION,
    "계획은 만들 수 있지만, 현재는 국내 종목의 최근 1년 가격에 적용할 수 없어요."
  );
  for (const forbidden of ["twelve data", "finnhub", "basic", "plan", "api key", "provider"]) {
    assert.ok(
      !MARKET_NOT_SUPPORTED_TITLE.toLowerCase().includes(forbidden) &&
        !MARKET_NOT_SUPPORTED_DESCRIPTION.toLowerCase().includes(forbidden),
      `문구에 내부 용어("${forbidden}")가 노출되면 안 된다`
    );
  }
});

test("예산 초과가 없으면 4/4 로 이 결과가 마지막 단계임을 보여주고, CTA 는 조건 수정·새 계획 만들기다", () => {
  const copy = resolveResultCtaCopy(false);
  assert.equal(copy.totalSteps, 4, "존재하지 않는 5단계(비교)를 진행 표시에 약속하면 안 된다");
  assert.equal(copy.primaryLabel, "조건 바꿔 다시 확인하기");
  assert.equal(copy.secondaryLabel, "새 투자 방법 만들기");
});

test("예산 초과가 있으면 4/5 를 유지하고, CTA 는 예산 조정안 보기·조건 직접 고치기다", () => {
  const copy = resolveResultCtaCopy(true);
  assert.equal(copy.totalSteps, TOTAL_STEPS, "비교(5단계)로 이어지는 경우 전체 단계 수는 그대로 5여야 한다");
  assert.equal(copy.primaryLabel, "예산 조정안 보기");
  assert.equal(copy.secondaryLabel, "조건 직접 고치기");
});
