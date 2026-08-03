/**
 * 시뮬레이션 엔진 단위 테스트 (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:simulation
 *
 * 원칙:
 *  - 실데이터(AAPL) 결과를 하드코딩하지 않는다. 계산 규칙을 검증할 수 있는 작은 candle fixture 만 쓴다.
 *  - fixture 는 테스트 전용이다. production 경로의 fallback 으로 쓰지 않는다.
 *
 * §동적 평균 매수가 — 평균 매수가는 더 이상 plan 의 입력값이 아니라 실행된 매수(정기+조건부)의
 * 누적 투자금 ÷ 누적 수량으로 엔진이 계산한다. 조건부 매수 crossing 을 검증하는 테스트는 첫
 * 캔들(월요일)에 정기 매수 1회를 심어(seed) 그 날 종가로 평균 매수가를 즉시 확정한다 — 매수가
 * 1회뿐이면 평균 매수가는 항상 그 매수의 체결가와 정확히 같다. seed 금액은 이후 조건부 매수
 * 금액보다 충분히 크게 잡아(기본 10배) 조건부 매수 체결이 평균 매수가를 크게 흔들지 않게 한다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { calculatePostTriggerDecline } from "./calculatePostTriggerDecline";
import { ADJUSTED_PLAN_POLICY, ORIGINAL_PLAN_POLICY } from "./policies";
import { simulatePlan } from "./simulatePlan";
import {
  SimulationInputError,
  type DailyCandle,
  type SimulationEvent,
  type SimulationInputErrorCode,
  type SimulationPlan,
  type SimulationResult,
} from "./types";

const DAY_MS = 86_400_000;

/** 날짜를 명시해 candle 을 만든다(정기 매수 요일 검증용). */
function daily(dates: string[], closes: number[]): DailyCandle[] {
  assert.equal(dates.length, closes.length, "fixture 의 dates 와 closes 길이가 달라요");
  return dates.map((date, index) => {
    const close = closes[index]!;
    return { date, open: close, high: close, low: close, close, volume: 1_000 };
  });
}

/** 연속 캘린더 날짜를 거래일로 사용한다. 2026-01-05 는 월요일이라 index 0 이 항상 seed 정기
 * 매수와 맞아떨어진다. */
function consecutive(startDate: string, closes: number[]): DailyCandle[] {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  return closes.map((close, index) => {
    const date = new Date(startMs + index * DAY_MS).toISOString().slice(0, 10);
    return { date, open: close, high: close, low: close, close, volume: 1_000 };
  });
}

const NO_GUARDRAILS: SimulationPlan["guardrails"] = {
  monthlyBudgetKrw: null,
  maxConditionalExecutionsPerMonth: null,
  reviewDrawdownPercent: null,
};

function recurringOnlyPlan(amountKrw: number): SimulationPlan {
  return {
    symbol: "TEST",
    market: "US",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw },
    conditionalBuy: null,
    guardrails: { ...NO_GUARDRAILS },
  };
}

/** 정기 매수 없이 조건부 매수만 있는 계획 — 입력 검증 테스트, 그리고 "평균 매수가가 없으면
 * 절대 실행되지 않는다" 회귀 테스트 전용이다. crossing 동작 자체를 보려면 `seededConditionalPlan`
 * 을 쓴다(평균 매수가가 없으면 crossing 을 평가조차 하지 않기 때문). */
function conditionalPlan(
  thresholdPercent: number,
  amountKrw: number,
  guardrails: Partial<SimulationPlan["guardrails"]> = {}
): SimulationPlan {
  return {
    symbol: "TEST",
    market: "US",
    recurring: null,
    conditionalBuy: { thresholdPercent, amountKrw },
    guardrails: { ...NO_GUARDRAILS, ...guardrails },
  };
}

/** crossing 동작을 검증하기 위한 표준 계획 — 첫 캔들(월요일)에 정기 매수 1회를 심어 평균
 * 매수가를 그 날 종가로 즉시 확정한다. */
function seededConditionalPlan(
  thresholdPercent: number,
  amountKrw: number,
  guardrails: Partial<SimulationPlan["guardrails"]> = {},
  seedAmountKrw = amountKrw * 10
): SimulationPlan {
  return {
    symbol: "TEST",
    market: "US",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: seedAmountKrw },
    conditionalBuy: { thresholdPercent, amountKrw },
    guardrails: { ...NO_GUARDRAILS, ...guardrails },
  };
}

function eventsOfType<T extends SimulationEvent["type"]>(
  result: SimulationResult,
  type: T
): Extract<SimulationEvent, { type: T }>[] {
  return result.simulationEvents.filter(
    (event): event is Extract<SimulationEvent, { type: T }> => event.type === type
  );
}

function assertInputError(fn: () => unknown, code: SimulationInputErrorCode): void {
  assert.throws(fn, (error: unknown) => {
    assert.ok(error instanceof SimulationInputError, `SimulationInputError 가 아니에요: ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });
}

// 1. 매주 월요일 정기 매수
test("정기 매수는 매주 월요일에 실행된다", () => {
  const dates = [
    "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", // Mon–Fri
    "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16",
    "2026-01-19", "2026-01-20", "2026-01-21", "2026-01-22", "2026-01-23",
  ];
  const candles = daily(dates, dates.map(() => 100));

  const result = simulatePlan({
    plan: recurringOnlyPlan(100_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  const buys = eventsOfType(result, "recurring_buy_executed");
  assert.deepEqual(buys.map((event) => event.date), ["2026-01-05", "2026-01-12", "2026-01-19"]);
  assert.equal(buys.every((event) => event.rolledForward === false), true);
  assert.equal(result.recurringExecutionCount, 3);
  assert.equal(result.totalRecurringInvestmentKrw, 300_000);
  assert.equal(result.totalInvestmentKrw, 300_000);
  assert.equal(result.conditionalTriggerCount, 0);
});

// 2. 월요일 휴장 시 다음 거래일 실행
test("월요일이 휴장일이면 다음 거래일에 실행하고, 월 경계도 넘어간다", () => {
  // 2026-01-12(월) 휴장 → 01-13(화) 실행.
  const dates = [
    "2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09",
    "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16",
    "2026-01-19",
  ];
  const result = simulatePlan({
    plan: recurringOnlyPlan(100_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles: daily(dates, dates.map(() => 100)),
  });

  const buys = eventsOfType(result, "recurring_buy_executed");
  assert.deepEqual(buys.map((event) => event.date), ["2026-01-05", "2026-01-13", "2026-01-19"]);
  assert.deepEqual(buys.map((event) => event.scheduledDate), [
    "2026-01-05",
    "2026-01-12",
    "2026-01-19",
  ]);
  assert.deepEqual(buys.map((event) => event.rolledForward), [false, true, false]);

  // 월 경계: 2026-03-30(월)·03-31(화) 휴장 → 04-01(수) 실행. 4월 집계에 들어간다.
  const crossMonthDates = ["2026-03-25", "2026-03-26", "2026-03-27", "2026-04-01", "2026-04-02"];
  const crossMonth = simulatePlan({
    plan: recurringOnlyPlan(50_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles: daily(crossMonthDates, crossMonthDates.map(() => 100)),
  });

  const crossBuys = eventsOfType(crossMonth, "recurring_buy_executed");
  assert.deepEqual(crossBuys.map((event) => [event.scheduledDate, event.date]), [
    ["2026-03-30", "2026-04-01"],
  ]);
  const april = crossMonth.monthlyResults.find((month) => month.month === "2026-04");
  assert.equal(april?.recurringExecutionCount, 1);
  assert.equal(april?.recurringInvestmentKrw, 50_000);
});

// --- §동적 평균 매수가 -------------------------------------------------------

test("[동적 평균 매수가] 정기 매수 없이 조건부 매수만 있으면 평균 매수가가 없어 절대 실행되지 않는다", () => {
  const plan: SimulationPlan = {
    symbol: "TEST",
    market: "US",
    recurring: null,
    conditionalBuy: { thresholdPercent: 10, amountKrw: 100_000 },
    guardrails: { ...NO_GUARDRAILS },
  };
  // 종가가 100 → 50 → 10 으로 급락해도 비교할 평균 매수가 자체가 없다.
  const result = simulatePlan({ plan, policy: ORIGINAL_PLAN_POLICY, candles: consecutive("2026-01-05", [100, 50, 10]) });

  assert.equal(result.conditionalTriggerCount, 0);
  assert.equal(result.conditionalExecutionCount, 0);
  assert.equal(result.totalConditionalInvestmentKrw, 0);
  assert.equal(result.appliedPolicy.conditionalInitialState, null);
  assert.equal(result.simulationEvents.length, 0);
});

test("[동적 평균 매수가] 평균 매수가가 생긴 첫 평가일은(=첫 정기 매수 체결일) 절대 조건을 충족하지 않는다", () => {
  // 첫 매수 체결가가 곧 평균 매수가이므로, 하락률이 0.01% 처럼 극단적으로 작아도 그 날은
  // 항상 "above_threshold" 다 — 자기 자신의 체결가보다 낮을 수는 없다.
  const result = simulatePlan({
    plan: seededConditionalPlan(0.01, 100_000, {}, 10_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles: consecutive("2026-01-05", [100]),
  });

  assert.equal(result.conditionalTriggerCount, 0);
  assert.equal(result.appliedPolicy.conditionalInitialState, "above_threshold");
});

test("[동적 평균 매수가] 매수가 실행될 때마다 평균 매수가가 새로 계산된다(고정 기준가가 아니다)", () => {
  const candles = consecutive("2026-01-05", [100, 94, 96, 94]);
  const result = simulatePlan({
    plan: seededConditionalPlan(5, 100_000, {}, 10_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  const seedBuy = eventsOfType(result, "recurring_buy_executed")[0]!;
  assert.equal(seedBuy.averageCostBefore, null, "첫 매수 전에는 평균 매수가가 없다");
  assert.equal(seedBuy.averageCostAfter, 100, "첫 매수 직후 평균 매수가는 그 매수의 체결가와 같다");

  const conditionalBuy = eventsOfType(result, "conditional_buy_executed")[0]!;
  assert.equal(conditionalBuy.averageCostBefore, 100);
  assert.ok(
    conditionalBuy.averageCostAfter !== null && conditionalBuy.averageCostAfter < 100,
    "더 낮은 가격에 매수하면 평균 매수가가 내려가야 한다"
  );
  assert.equal(result.averagePurchasePrice, conditionalBuy.averageCostAfter, "마지막 평균 매수가는 최종 백테스팅 요약과 같다");
});

// 3. threshold 를 처음 하향 돌파할 때 1회 trigger
test("threshold 를 처음 하향 돌파할 때 1회만 trigger 한다", () => {
  // seed 로 평균 매수가 100 확정, 하락 10% → trigger price 90
  const candles = consecutive("2026-01-05", [100, 95, 89]);
  const result = simulatePlan({
    plan: seededConditionalPlan(10, 100_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  const triggers = eventsOfType(result, "conditional_triggered");
  assert.deepEqual(triggers.map((event) => event.date), ["2026-01-07"]);
  assert.equal(triggers[0]?.triggerPrice, 90);
  assert.equal(result.conditionalTriggerCount, 1);
  assert.equal(result.conditionalExecutionCount, 1);
  assert.equal(result.totalConditionalInvestmentKrw, 100_000);
});

// 4. threshold 아래에 계속 머물 때 반복 trigger 없음
test("threshold 아래에 머무는 동안 반복 trigger 하지 않는다", () => {
  const candles = consecutive("2026-01-05", [100, 89, 88, 87]);
  const result = simulatePlan({
    plan: seededConditionalPlan(10, 100_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  assert.equal(result.conditionalTriggerCount, 1);
  assert.equal(result.conditionalExecutionCount, 1);
});

// 5. threshold 위로 회복한 뒤 다시 하락하면 재trigger
test("threshold 위로 회복 후 다시 하락하면 재trigger 한다", () => {
  const candles = consecutive("2026-01-05", [100, 89, 95, 88]);
  const result = simulatePlan({
    plan: seededConditionalPlan(10, 100_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  const triggers = eventsOfType(result, "conditional_triggered");
  assert.deepEqual(triggers.map((event) => event.date), ["2026-01-06", "2026-01-08"]);
  assert.equal(result.conditionalTriggerCount, 2);
  assert.equal(result.conditionalExecutionCount, 2);
  // 두 번째 trigger 는 첫 실행으로 낮아진 평균 매수가를 기준으로 한다 — 첫 trigger 와 같은
  // 임계 가격(90)이 아니다(§동적 평균 매수가).
  assert.equal(triggers[0]?.triggerPrice, 90);
  assert.notEqual(triggers[1]?.triggerPrice, 90);
});

// 6. allow_and_flag 에서 예산 초과 실행 및 flag
// §사용자 확정 개편 — 월 예산은 이제 policy 와 무관하게 항상 실행 자체를 막는 제약이다
// ("결과를 계산한 뒤 경고만 하는 값이 아니다"). ORIGINAL_PLAN_POLICY(allow_and_flag)에서도
// 예산을 넘길 conditional action 은 실행하지 않고 SkippedBuyEvent 로만 남는다.
test("[개편] ORIGINAL_PLAN_POLICY 에서도 예산을 넘길 conditional action 은 실행하지 않는다", () => {
  // trigger price 95. 두 번 발생(재무장 뒤 더 깊게 하락) → 실행하면 200,000 KRW, 예산 150,000 KRW
  // (seed 는 예산 안에 들어가는 작은 값).
  const candles = consecutive("2026-01-05", [100, 94, 96, 60]);
  const result = simulatePlan({
    plan: seededConditionalPlan(5, 100_000, { monthlyBudgetKrw: 150_000 }, 10_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  assert.equal(result.conditionalTriggerCount, 2, "조건 발생 자체는 그대로 센다");
  assert.equal(result.conditionalExecutionCount, 1, "예산 안에서 실행 가능한 만큼만 실행한다");
  assert.equal(result.conditionalBlockedCount, 1);
  assert.equal(result.totalConditionalInvestmentKrw, 100_000);
  assert.equal(result.budgetExceededMonthCount, 0, "넘기기 전에 막으므로 초과 자체가 발생하지 않는다");

  assert.equal(result.budgetSkippedEvents.length, 1);
  assert.equal(result.budgetSkippedEvents[0]?.type, "CONDITIONAL");
  assert.equal(result.budgetSkippedEvents[0]?.requestedAmount, 100_000);
  assert.equal(result.budgetSkippedEvents[0]?.monthlyBudget, 150_000);
});

// 7. block_action_when_exceeded 에서 conditional action 차단
test("block_action_when_exceeded 는 예산을 넘길 conditional action 을 차단한다", () => {
  const candles = consecutive("2026-01-05", [100, 94, 96, 60]);
  const result = simulatePlan({
    plan: seededConditionalPlan(5, 100_000, { monthlyBudgetKrw: 150_000 }, 10_000),
    policy: ADJUSTED_PLAN_POLICY,
    candles,
  });

  assert.equal(result.conditionalTriggerCount, 2, "조건 발생 자체는 그대로 센다");
  assert.equal(result.conditionalExecutionCount, 1);
  assert.equal(result.conditionalBlockedCount, 1);
  assert.equal(result.totalConditionalInvestmentKrw, 100_000);
  assert.equal(result.budgetExceededMonthCount, 0, "차단했으므로 예산을 넘지 않는다");

  const blocked = eventsOfType(result, "conditional_buy_blocked");
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0]?.blockedBy, "monthly_budget");
  assert.equal(blocked[0]?.attemptedAmountKrw, 100_000);
});

// 8. 월별 추가 매수 횟수 제한 (연속 날짜로 4주 뒤 월요일까지 이어가 롤포워드 중복을 피한다)
test("월 실행 횟수 제한에 도달하면 차단하고, 다음 달에 초기화된다", () => {
  const closes = Array.from({ length: 30 }, () => 200);
  closes[0] = 100; // 월(seed)
  closes[1] = 94; // 화 — cross1, 1월 실행
  closes[2] = 100; // 수 — 재무장
  closes[3] = 80; // 목 — cross2, 1월엔 이미 1회 실행했으니 차단
  closes[29] = 60; // 2026-02-03(화) — cross3, 2월엔 리셋되어 실행
  const result = simulatePlan({
    plan: seededConditionalPlan(5, 100_000, { maxConditionalExecutionsPerMonth: 1 }, 10_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles: consecutive("2026-01-05", closes),
  });

  assert.equal(result.conditionalTriggerCount, 3);
  assert.equal(result.conditionalExecutionCount, 2);
  assert.equal(result.conditionalBlockedCount, 1);
  assert.equal(result.maxMonthlyConditionalExecutionCount, 1);

  const blocked = eventsOfType(result, "conditional_buy_blocked");
  assert.equal(blocked[0]?.blockedBy, "monthly_execution_limit");
  assert.equal(blocked[0]?.date, "2026-01-08");

  const january = result.monthlyResults.find((month) => month.month === "2026-01");
  const february = result.monthlyResults.find((month) => month.month === "2026-02");
  assert.equal(january?.conditionalExecutionCount, 1);
  assert.equal(january?.conditionalBlockedCount, 1);
  assert.equal(february?.conditionalExecutionCount, 1);
  assert.equal(february?.conditionalBlockedCount, 0);
});

// 9. review flag_only — 재검토 발생 후에도 이후 conditional 은 계속 실행돼야 한다(re-arm 뒤 재하락).
test("flag_only 는 재검토 이벤트만 기록하고 이후 실행을 유지한다", () => {
  // 조건부 5% / 재검토 20% — 얕은 하락(94)은 조건부만, 깊은 하락(70)은 재검토도 함께 건드린다.
  const candles = consecutive("2026-01-05", [100, 94, 70, 96, 60]);
  const result = simulatePlan({
    plan: seededConditionalPlan(5, 100_000, { reviewDrawdownPercent: 20 }, 10_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  assert.equal(result.reviewTriggeredCount, 2);
  assert.equal(result.conditionalTriggerCount, 2);
  assert.equal(result.conditionalExecutionCount, 2, "flag_only 는 재검토 이후에도 실행을 막지 않는다");
  assert.equal(result.conditionalBlockedCount, 0);
});

// 10. review pause_future_conditional_actions — 재검토 이후의 conditional 은 차단돼야 한다.
test("pause_future_conditional_actions 는 이후 conditional 만 막고 정기 매수는 유지한다", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12"];
  const plan: SimulationPlan = {
    symbol: "TEST",
    market: "US",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 10_000 },
    conditionalBuy: { thresholdPercent: 5, amountKrw: 100_000 },
    guardrails: {
      monthlyBudgetKrw: null,
      maxConditionalExecutionsPerMonth: null,
      reviewDrawdownPercent: 20,
    },
  };

  const result = simulatePlan({
    plan,
    policy: ADJUSTED_PLAN_POLICY,
    candles: daily(dates, [100, 94, 70, 96, 60, 94]),
  });

  assert.equal(result.reviewTriggeredCount, 2);
  assert.equal(result.conditionalTriggerCount, 2);
  assert.equal(result.conditionalExecutionCount, 1, "재검토 발생 전 실행은 유지된다");
  assert.equal(result.conditionalBlockedCount, 1);

  const blocked = eventsOfType(result, "conditional_buy_blocked");
  assert.equal(blocked[0]?.blockedBy, "review_trigger");
  assert.equal(blocked[0]?.date, "2026-01-09");

  // 정기 매수는 재검토 이후에도 계속된다(2026-01-05, 2026-01-12).
  assert.deepEqual(
    eventsOfType(result, "recurring_buy_executed").map((event) => event.date),
    ["2026-01-05", "2026-01-12"]
  );
  assert.equal(result.recurringExecutionCount, 2);
});

// 11. 20거래일 추가 하락 계산 (관찰 window 밖의 값은 window 안 최저보다 낮지만 재trigger 는
// 안 나게 근처 값으로 둔다 — 이 테스트는 "trigger 1회의 하락 계산"만 본다).
test("조건 발생 후 최대 20거래일의 최저 종가로 추가 하락을 계산한다", () => {
  // index0=seed(100), index1=90(trigger,전 종가 대비 -10%내지-5%지만 실제 threshold95),
  // index2..21(20거래일)=89, index22-23=87(window 밖, 재trigger 안 나게).
  const closes = [100, 90, ...Array.from({ length: 20 }, () => 89), 87, 87];
  assert.equal(closes.length, 24);

  const candles = consecutive("2026-01-05", closes);
  const result = simulatePlan({
    plan: seededConditionalPlan(5, 100_000, {}, 10_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  assert.equal(result.conditionalTriggerCount, 1);
  assert.equal(
    result.maxAdditionalDeclineAfterTriggerPercent,
    -1.11,
    "관찰 창 밖의 더 낮은 종가는 포함하지 않는다"
  );

  // 남은 거래일이 20개보다 적으면 남아 있는 거래일만 사용한다.
  const shortWindow = calculatePostTriggerDecline(consecutive("2026-01-05", [100, 90, 81]), 1, 20);
  assert.equal(shortWindow.observedTradingDays, 1);
  assert.equal(shortWindow.minCloseAfterTrigger, 81);
  assert.equal(shortWindow.additionalDeclinePercent, -10);

  // 조건 발생일이 마지막 candle 이면 관찰 가능한 거래일이 없다.
  const noWindow = calculatePostTriggerDecline(consecutive("2026-01-05", [100, 90]), 1, 20);
  assert.equal(noWindow.observedTradingDays, 0);
  assert.equal(noWindow.additionalDeclinePercent, null);
});

// 12. 조건이 한 번도 발생하지 않은 경우
test("조건이 한 번도 발생하지 않으면 추가 하락은 null 이다", () => {
  const candles = consecutive("2026-01-05", [100, 99, 98]);
  const result = simulatePlan({
    plan: seededConditionalPlan(10, 100_000, {}, 10_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  assert.equal(result.conditionalTriggerCount, 0);
  assert.equal(result.conditionalExecutionCount, 0);
  assert.equal(result.conditionalBlockedCount, 0);
  assert.equal(result.totalConditionalInvestmentKrw, 0);
  assert.equal(result.maxAdditionalDeclineAfterTriggerPercent, null);
  assert.equal(result.appliedPolicy.conditionalInitialState, "above_threshold");
});

// 13. 동일 입력의 deterministic result
test("동일 입력은 동일 결과를 반환한다", () => {
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09", "2026-01-12"];
  const plan: SimulationPlan = {
    symbol: "TEST",
    market: "US",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50_000 },
    conditionalBuy: { thresholdPercent: 5, amountKrw: 100_000 },
    guardrails: {
      monthlyBudgetKrw: 120_000,
      maxConditionalExecutionsPerMonth: 2,
      reviewDrawdownPercent: 20,
    },
  };
  const candles = daily(dates, [100, 94, 89, 96, 94, 94]);

  const first = simulatePlan({ plan, policy: ORIGINAL_PLAN_POLICY, candles });
  const second = simulatePlan({ plan, policy: ORIGINAL_PLAN_POLICY, candles });
  assert.deepStrictEqual(first, second);

  // 엔진은 시스템 시각을 읽지 않는다. 주입하지 않으면 null.
  assert.equal(first.calculatedAt, null);
  const injected = simulatePlan({
    plan,
    policy: ORIGINAL_PLAN_POLICY,
    candles,
    calculatedAt: "2026-07-28T00:00:00.000Z",
  });
  assert.equal(injected.calculatedAt, "2026-07-28T00:00:00.000Z");
  assert.deepStrictEqual({ ...injected, calculatedAt: null }, first);
});

// 14. 0 또는 음수 금액 입력 거부
test("0 또는 음수 금액 입력을 거부한다", () => {
  const candles = consecutive("2026-01-05", [100, 90]);
  const run = (plan: SimulationPlan) => () =>
    simulatePlan({ plan, policy: ORIGINAL_PLAN_POLICY, candles });

  assertInputError(run(recurringOnlyPlan(0)), "invalid_recurring_amount");
  assertInputError(run(recurringOnlyPlan(-100_000)), "invalid_recurring_amount");
  assertInputError(run(recurringOnlyPlan(Number.NaN)), "invalid_recurring_amount");

  assertInputError(run(conditionalPlan(10, 0)), "invalid_conditional_amount");
  assertInputError(run(conditionalPlan(10, -1)), "invalid_conditional_amount");

  assertInputError(
    run(conditionalPlan(10, 100_000, { monthlyBudgetKrw: 0 })),
    "invalid_monthly_budget"
  );
  assertInputError(
    run(conditionalPlan(10, 100_000, { maxConditionalExecutionsPerMonth: -1 })),
    "invalid_max_conditional_executions"
  );
  assertInputError(
    run(conditionalPlan(10, 100_000, { maxConditionalExecutionsPerMonth: 1.5 })),
    "invalid_max_conditional_executions"
  );

  assertInputError(
    () => simulatePlan({ plan: recurringOnlyPlan(100_000), policy: ORIGINAL_PLAN_POLICY, candles: [] }),
    "empty_candles"
  );
});

// 15. thresholdPercent·재검토 하락률 입력 검증
test("thresholdPercent 와 reviewDrawdownPercent 를 검증한다", () => {
  const candles = consecutive("2026-01-05", [100, 90]);
  const run = (plan: SimulationPlan) => () =>
    simulatePlan({ plan, policy: ORIGINAL_PLAN_POLICY, candles });

  assertInputError(run(conditionalPlan(0, 100_000)), "invalid_threshold_percent");
  assertInputError(run(conditionalPlan(-5, 100_000)), "invalid_threshold_percent");
  assertInputError(run(conditionalPlan(100, 100_000)), "invalid_threshold_percent");
  assertInputError(run(conditionalPlan(120, 100_000)), "invalid_threshold_percent");
  assertInputError(run(conditionalPlan(Number.NaN, 100_000)), "invalid_threshold_percent");

  assertInputError(
    run(conditionalPlan(10, 100_000, { reviewDrawdownPercent: 0 })),
    "invalid_review_drawdown_percent"
  );
  assertInputError(
    run(conditionalPlan(10, 100_000, { reviewDrawdownPercent: 100 })),
    "invalid_review_drawdown_percent"
  );

  // 재검토 조건은 조건부 매수와 같은 평균 매수가 기준을 공유한다 — conditionalBuy 없이 쓸 수 없다.
  assertInputError(
    run({
      symbol: "TEST",
      market: "US",
      recurring: null,
      conditionalBuy: null,
      guardrails: { ...NO_GUARDRAILS, reviewDrawdownPercent: 10 },
    }),
    "review_requires_average_cost"
  );
});

// 15b. 같은 날 재검토 + 조건부 crossing — pause 정책 (조건부 5%·재검토 20%, 75 는 둘 다 하향 돌파)
test("pause 정책은 같은 날 재검토가 발생하면 그 날의 conditional buy 부터 차단한다", () => {
  const candles = consecutive("2026-01-05", [100, 75]);
  const result = simulatePlan({
    plan: seededConditionalPlan(5, 100_000, { reviewDrawdownPercent: 20 }, 10_000),
    policy: ADJUSTED_PLAN_POLICY,
    candles,
  });

  // 같은 날 처리 순서: 재검토 먼저 → 조건 발생 → 차단.
  assert.deepEqual(
    result.simulationEvents.map((event) => [event.type, event.date]),
    [
      ["recurring_buy_executed", "2026-01-05"],
      ["review_triggered", "2026-01-06"],
      ["conditional_triggered", "2026-01-06"],
      ["conditional_buy_blocked", "2026-01-06"],
    ]
  );
  assert.equal(result.reviewTriggeredCount, 1);
  assert.equal(result.conditionalTriggerCount, 1);
  assert.equal(result.conditionalExecutionCount, 0);
  assert.equal(result.conditionalBlockedCount, 1);
  assert.equal(result.totalConditionalInvestmentKrw, 0);
  assert.equal(eventsOfType(result, "conditional_buy_blocked")[0]?.blockedBy, "review_trigger");
});

// 15c. 같은 날 재검토 + 조건부 crossing — flag_only 정책
test("flag_only 는 같은 날 재검토가 발생해도 conditional buy 를 실행한다", () => {
  const candles = consecutive("2026-01-05", [100, 75]);
  const result = simulatePlan({
    plan: seededConditionalPlan(5, 100_000, { reviewDrawdownPercent: 20 }, 10_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  assert.deepEqual(
    result.simulationEvents.map((event) => event.type),
    ["recurring_buy_executed", "review_triggered", "conditional_triggered", "conditional_buy_executed"]
  );
  assert.equal(result.reviewTriggeredCount, 1);
  assert.equal(result.conditionalExecutionCount, 1);
  assert.equal(result.conditionalBlockedCount, 0);
  assert.equal(result.totalConditionalInvestmentKrw, 100_000);
});

test("[동적 평균 매수가] 평균 매수가가 생긴 첫 평가일은 재검토도 절대 충족하지 않는다", () => {
  // 재검토 역시 조건부 매수와 같은 평균 매수가를 쓴다 — 첫 평가일(=첫 매수 체결일)에는 절대
  // 자기 자신의 체결가보다 낮을 수 없다.
  const result = simulatePlan({
    plan: seededConditionalPlan(5, 100_000, { reviewDrawdownPercent: 0.01 }, 10_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles: consecutive("2026-01-05", [100]),
  });

  assert.equal(result.reviewTriggeredCount, 0);
  assert.equal(result.appliedPolicy.reviewInitialState, "above_threshold");
});

// --- 예산 초과 원인 분류 -----------------------------------------------------
//
// 실데이터 스모크에서 드러난 문제: 예산 초과 4개월이 전부 정기 매수 주기(월요일 5번) 때문이었는데
// budgetExceededMonthCount 만 보면 추가 매수 탓으로 설명될 수 있다. AI 가 원인을 추론하지 않도록
// 명시적 계산 필드로 구분한다.

/** 월요일이 5번 있는 달(2026-03)의 거래일. 정기 매수만으로 250,000원이 된다. */
const FIVE_MONDAY_MONTH_DATES = [
  "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06",
  "2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13",
  "2026-03-16", "2026-03-17", "2026-03-18", "2026-03-19", "2026-03-20",
  "2026-03-23", "2026-03-24", "2026-03-25", "2026-03-26", "2026-03-27",
  "2026-03-30", "2026-03-31",
];

// 15g. [개편] 정기 매수만으로 누적 예산을 넘기면 넘기는 순간부터 스킵한다
test("[개편] 정기 매수 누적이 예산을 넘기게 되면 그 시점부터 스킵하고 초과 자체가 생기지 않는다", () => {
  // 월요일 5회 × 50,000원. 4회까지 200,000원(예산과 정확히 같음), 5회째부터 스킵된다.
  const plan: SimulationPlan = {
    symbol: "TEST",
    market: "US",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50_000 },
    conditionalBuy: null,
    guardrails: {
      monthlyBudgetKrw: 200_000,
      maxConditionalExecutionsPerMonth: null,
      reviewDrawdownPercent: null,
    },
  };
  const result = simulatePlan({
    plan,
    policy: ORIGINAL_PLAN_POLICY,
    candles: daily(FIVE_MONDAY_MONTH_DATES, FIVE_MONDAY_MONTH_DATES.map(() => 120)),
  });

  const march = result.monthlyResults.find((month) => month.month === "2026-03");
  assert.equal(march?.recurringExecutionCount, 4, "예산 안에서 실행 가능한 만큼만 실행한다");
  assert.equal(march?.recurringInvestmentKrw, 200_000);
  assert.equal(march?.budgetExceeded, false, "넘기기 전에 막으므로 초과가 발생하지 않는다");
  assert.equal(march?.budgetExceededCause, null);

  assert.equal(result.budgetExceededMonthCount, 0);
  assert.equal(result.budgetSkippedEvents.length, 1, "5번째 실행 1건만 스킵된다");
  assert.equal(result.budgetSkippedEvents[0]?.type, "RECURRING");
  assert.equal(result.budgetSkippedEvents[0]?.monthlySpentBefore, 200_000);
  assert.equal(result.budgetSkippedEvents[0]?.requestedAmount, 50_000);
});

// 15h. [개편] 정기 매수로 예산을 다 채운 뒤 발생한 추가 매수는 스킵한다
test("[개편] 정기 매수로 예산을 다 채운 뒤 발생한 추가 매수는 스킵한다", () => {
  // 월요일 4회 × 50,000원 = 200,000원(예산과 정확히 같음) — 전부 월 마지막 월요일까지 먼저
  // 소진되고, 그 다음 날 조건이 발생해야 "정기 매수가 이미 예산을 다 썼다"는 시나리오가
  // 시간 순서상으로도 성립한다.
  const dates = ["2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23", "2026-02-24"];
  // 2026-02-24 에 조건 하향 돌파(평균 매수가는 정기 매수 종가 120 으로 확정, -5% → 114) — 마지막
  // 정기 매수 다음 날.
  const closes = [120, 120, 120, 120, 94];

  const plan: SimulationPlan = {
    symbol: "TEST",
    market: "US",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50_000 },
    conditionalBuy: { thresholdPercent: 5, amountKrw: 20_000 },
    guardrails: {
      monthlyBudgetKrw: 200_000,
      maxConditionalExecutionsPerMonth: null,
      reviewDrawdownPercent: null,
    },
  };

  const result = simulatePlan({ plan, policy: ORIGINAL_PLAN_POLICY, candles: daily(dates, closes) });

  const february = result.monthlyResults.find((month) => month.month === "2026-02");
  assert.equal(february?.recurringExecutionCount, 4);
  assert.equal(february?.recurringInvestmentKrw, 200_000);
  assert.equal(february?.conditionalInvestmentKrw, 0, "예산을 넘기므로 추가 매수는 실행하지 않는다");
  assert.equal(february?.totalInvestmentKrw, 200_000);
  assert.equal(february?.budgetExceeded, false);
  assert.equal(february?.budgetExceededCause, null);

  assert.equal(result.budgetExceededMonthCount, 0);
  assert.equal(result.budgetSkippedEvents.length, 1);
  assert.equal(result.budgetSkippedEvents[0]?.type, "CONDITIONAL");
  assert.equal(result.budgetSkippedEvents[0]?.requestedAmount, 20_000);
  assert.equal(result.budgetSkippedEvents[0]?.monthlySpentBefore, 200_000);
});

// 15i. 정기 + conditional 모두 예산 이내
test("정기 매수와 추가 매수를 합해도 예산 이내면 cause=null 이다", () => {
  const dates = ["2026-02-02", "2026-02-03", "2026-02-09", "2026-02-16"];
  const result = simulatePlan({
    plan: {
      symbol: "TEST",
      market: "US",
      recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50_000 },
      conditionalBuy: { thresholdPercent: 5, amountKrw: 20_000 },
      guardrails: {
        monthlyBudgetKrw: 500_000,
        maxConditionalExecutionsPerMonth: null,
        reviewDrawdownPercent: null,
      },
    },
    policy: ORIGINAL_PLAN_POLICY,
    candles: daily(dates, [120, 94, 120, 120]),
  });

  const february = result.monthlyResults.find((month) => month.month === "2026-02");
  assert.equal(february?.conditionalExecutionCount, 1);
  assert.equal(february?.budgetExceeded, false);
  assert.equal(february?.budgetExceededCause, null);
  assert.equal(february?.recurringAloneExceededBudget, false);
  assert.equal(february?.conditionalCausedBudgetExceed, false);

  assert.equal(result.budgetExceededMonthCount, 0);
  assert.equal(result.recurringOnlyBudgetExceededMonthCount, 0);
  assert.equal(result.conditionalCausedBudgetExceededMonthCount, 0);
  assert.equal(
    result.simulationEvents.filter((event) => event.type === "monthly_budget_exceeded").length,
    0
  );
});

// 15j. 예산이 null 인 경우
test("예산이 null 이면 초과 판정과 원인 분류를 하지 않는다", () => {
  const result = simulatePlan({
    plan: {
      symbol: "TEST",
      market: "US",
      recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50_000 },
      conditionalBuy: { thresholdPercent: 5, amountKrw: 20_000 },
      guardrails: {
        monthlyBudgetKrw: null,
        maxConditionalExecutionsPerMonth: null,
        reviewDrawdownPercent: null,
      },
    },
    policy: ORIGINAL_PLAN_POLICY,
    candles: daily(FIVE_MONDAY_MONTH_DATES, FIVE_MONDAY_MONTH_DATES.map(() => 120)),
  });

  const march = result.monthlyResults.find((month) => month.month === "2026-03");
  assert.equal(march?.recurringInvestmentKrw, 250_000, "금액은 그대로 집계한다");
  assert.equal(march?.budgetExceeded, false);
  assert.equal(march?.budgetExceededCause, null);
  assert.equal(march?.recurringAloneExceededBudget, false);
  assert.equal(march?.conditionalCausedBudgetExceed, false);

  assert.equal(result.budgetExceededMonthCount, 0);
  assert.equal(result.recurringOnlyBudgetExceededMonthCount, 0);
  assert.equal(result.conditionalCausedBudgetExceededMonthCount, 0);
});

// 15k. 여러 달에 원인이 다른 경우
test("[개편] 여러 달에 걸쳐 예산을 다 쓰면 각 달마다 독립적으로 스킵이 발생한다", () => {
  // 2026-02: 월요일 4회(200,000원) + 추가 매수 시도(스킵)
  // 2026-03: 월요일 5회(250,000원) → 5번째가 스킵
  const dates = [
    "2026-02-02", "2026-02-03", "2026-02-09", "2026-02-16", "2026-02-23",
    ...FIVE_MONDAY_MONTH_DATES,
  ];
  const closes = [120, 94, 120, 120, 120, ...FIVE_MONDAY_MONTH_DATES.map(() => 120)];

  const result = simulatePlan({
    plan: {
      symbol: "TEST",
      market: "US",
      recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50_000 },
      conditionalBuy: { thresholdPercent: 5, amountKrw: 20_000 },
      guardrails: {
        monthlyBudgetKrw: 200_000,
        maxConditionalExecutionsPerMonth: null,
        reviewDrawdownPercent: null,
      },
    },
    policy: ORIGINAL_PLAN_POLICY,
    candles: daily(dates, closes),
  });

  // [개편] 넘기기 전에 막으므로 어느 달도 "초과"로 분류되지 않는다 — 대신 각 달에서 예산을
  // 채운 뒤 시도된 실행이 스킵으로 남는다.
  for (const month of result.monthlyResults) {
    assert.equal(month.budgetExceeded, false);
    assert.equal(month.budgetExceededCause, null);
  }
  assert.equal(result.budgetExceededMonthCount, 0);

  const skippedByMonth = new Map<string, number>();
  for (const skipped of result.budgetSkippedEvents) {
    const month = skipped.date.slice(0, 7);
    skippedByMonth.set(month, (skippedByMonth.get(month) ?? 0) + 1);
  }
  assert.equal(skippedByMonth.get("2026-02"), 1, "2월도 예산을 다 쓰고 한 건은 스킵된다");
  assert.equal(skippedByMonth.get("2026-03"), 1, "3월도 예산을 다 쓰고 한 건은 스킵된다");
});

// 15l. [개편] 스킵 이벤트는 실행 직전 그 달까지의 누적 지출을 정확히 기록한다
test("[개편] 스킵 이벤트는 시도 시점까지의 월 누적 지출·요청 금액을 정확히 기록한다", () => {
  const dates = ["2026-02-02", "2026-02-09", "2026-02-16", "2026-02-23", "2026-02-24"];
  const closes = [120, 120, 120, 120, 94]; // 마지막 날 조건 하향 돌파(평균 매수가 120, -5% → 114).

  const result = simulatePlan({
    plan: {
      symbol: "TEST",
      market: "US",
      recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50_000 },
      conditionalBuy: { thresholdPercent: 5, amountKrw: 20_000 },
      guardrails: {
        monthlyBudgetKrw: 200_000,
        maxConditionalExecutionsPerMonth: null,
        reviewDrawdownPercent: null,
      },
    },
    policy: ORIGINAL_PLAN_POLICY,
    candles: daily(dates, closes),
  });

  assert.equal(result.budgetSkippedEvents.length, 1);
  const skipped = result.budgetSkippedEvents[0]!;
  assert.equal(skipped.date, "2026-02-24");
  assert.equal(skipped.type, "CONDITIONAL");
  assert.equal(skipped.requestedAmount, 20_000);
  assert.equal(skipped.monthlySpentBefore, 200_000, "정기 매수 4회(200,000원)까지 실행된 뒤 시도됐다");
  assert.equal(skipped.monthlyBudget, 200_000);

  // 스킵된 매수는 실행된 이벤트로도, 투자금·수량 계산에도 들어가지 않는다.
  assert.equal(result.conditionalExecutionCount, 0);
  assert.equal(result.totalConditionalInvestmentKrw, 0);
  assert.equal(
    result.simulationEvents.some((event) => event.type === "conditional_buy_executed"),
    false
  );
});

// 17. 차트 시계열
test("차트 시계열은 candle 하나당 한 포인트이고 이벤트 마커를 붙인다", () => {
  const candles = consecutive("2026-01-05", [100, 94, 96, 60]);
  const result = simulatePlan({
    plan: seededConditionalPlan(5, 100_000, { monthlyBudgetKrw: 150_000 }, 10_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  assert.equal(result.chartSeries.length, candles.length);
  assert.deepEqual(
    result.chartSeries.map((point) => point.date),
    candles.map((candle) => candle.date)
  );

  const triggerDay = result.chartSeries.find((point) => point.date === "2026-01-06");
  assert.equal(triggerDay?.hasConditionalTrigger, true);
  assert.equal(triggerDay?.hasConditionalBuy, true);
  assert.equal(triggerDay?.hasBudgetExceeded, false);

  // [개편] 두 번째 조건 발생(01-08)은 실행하면 첫 실행(100,000)과 합쳐 예산 150,000 을 넘기므로
  // 실행 자체가 막힌다(hasBlockedAction) — monthly_budget_exceeded 이벤트는 넘기기 전에 막으므로
  // 구조적으로 생기지 않는다.
  const blockedDay = result.chartSeries.find((point) => point.date === "2026-01-08");
  assert.equal(blockedDay?.hasBudgetExceeded, false);
  assert.equal(blockedDay?.hasBlockedAction, true);
  assert.equal(result.budgetSkippedEvents.length, 1);
  assert.equal(result.budgetSkippedEvents[0]?.date, "2026-01-08");

  // 모든 이벤트 id 가 정확히 한 포인트에 연결된다.
  const linked = result.chartSeries.flatMap((point) => point.eventIds).sort();
  const emitted = result.simulationEvents.map((event) => event.id).sort();
  assert.deepEqual(linked, emitted);
});

// --- 백테스팅 요약(§사용자 확정 — "사용자가 말한 투자 규칙을 실제 과거 가격에 적용한
// 백테스팅 결과") -------------------------------------------------------------
//
// 원칙: 가상 소수점 수량 매수(quantity = executedAmount / closePrice). AI 는 숫자를 만들지
// 않는다 — 전부 TypeScript 결정적 계산이다. 스킵된 매수는 이 계산에서 전부 제외한다.

test("totalInvested·totalQuantity·averagePurchasePrice: 실행된 매수 금액과 수량만 합산한다", () => {
  // 정기 매수 2회, 각 100,000원. 종가 100 → 1주, 종가 50 → 2주.
  const candles = consecutive("2026-01-05", [100, 50, 50, 50]); // 월요일 2회(01-05, 01-12는 없음)
  const result = simulatePlan({
    plan: recurringOnlyPlan(100_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  // 이 fixture 에서 월요일은 01-05 하루뿐이다(연속 날짜라 요일이 하나만 걸린다) — 실제 값은
  // "실행된 매수만큼만" 합산되는지가 검증 대상이므로, 실제 실행 횟수를 기준으로 계산한다.
  const executed = result.simulationEvents.filter((e) => e.type === "recurring_buy_executed");
  const expectedInvested = executed.length * 100_000;
  const expectedQuantity = executed.reduce((sum, e) => sum + e.amountKrw / e.closePrice, 0);

  assert.equal(result.totalInvested, expectedInvested);
  assert.ok(Math.abs(result.totalQuantity - expectedQuantity) < 1e-9);
  if (result.totalQuantity > 0) {
    assert.ok(Math.abs((result.averagePurchasePrice ?? 0) - expectedInvested / expectedQuantity) < 1e-9);
  }
});

test("endingValue·profitLoss·returnRate: 마지막 거래일 종가 기준으로 계산한다(수익 케이스)", () => {
  // 100원에 100,000원 매수 → 1,000주. 마지막 종가 150원 → 평가금액 150,000원, 손익 +50,000원.
  const candles = consecutive("2026-01-05", [100]); // 월요일 1회만
  const result = simulatePlan({ plan: recurringOnlyPlan(100_000), policy: ORIGINAL_PLAN_POLICY, candles });

  assert.equal(result.lastClose, 100);
  assert.equal(result.lastTradingDate, "2026-01-05");
  assert.equal(result.totalQuantity, 1000);
  assert.equal(result.endingValue, 100_000);
  assert.equal(result.profitLoss, 0);
  assert.equal(result.returnRate, 0);
});

test("[손실 케이스] 마지막 종가가 매수가보다 낮으면 평가손익이 음수다", () => {
  const candles = consecutive("2026-01-05", [100, 80, 80, 80, 60]); // 월요일 01-05, 01-12
  const result = simulatePlan({ plan: recurringOnlyPlan(100_000), policy: ORIGINAL_PLAN_POLICY, candles });

  assert.ok(result.profitLoss < 0, "종가가 계속 떨어졌으므로 평가손익은 음수여야 한다");
  assert.ok(result.returnRate !== null && result.returnRate < 0);
  assert.equal(result.endingValue, result.totalQuantity * result.lastClose);
  assert.equal(result.profitLoss, result.endingValue - result.totalInvested);
});

test("returnRate·averagePurchasePrice: 매수가 하나도 실행되지 않으면 null 이다(0 으로 나누지 않는다)", () => {
  // 정기 매수 없이 조건부 매수만 있으면 평균 매수가가 없어 절대 실행되지 않는다(§동적 평균
  // 매수가) — 종가가 계속 올라도(200,210,220) 마찬가지다.
  const candles = consecutive("2026-01-05", [200, 210, 220]);
  const result = simulatePlan({
    plan: conditionalPlan(5, 100_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  });

  assert.equal(result.totalInvested, 0);
  assert.equal(result.totalQuantity, 0);
  assert.equal(result.returnRate, null);
  assert.equal(result.averagePurchasePrice, null);
});

test("동일 입력이면 백테스팅 요약도 항상 동일하다(결정적 계산)", () => {
  const candles = consecutive("2026-01-05", [100, 94, 96, 94, 90]);
  const input = {
    plan: seededConditionalPlan(5, 100_000, { monthlyBudgetKrw: 300_000 }, 10_000),
    policy: ORIGINAL_PLAN_POLICY,
    candles,
  };
  const a = simulatePlan(input);
  const b = simulatePlan(input);

  assert.equal(a.totalInvested, b.totalInvested);
  assert.equal(a.totalQuantity, b.totalQuantity);
  assert.equal(a.endingValue, b.endingValue);
  assert.equal(a.profitLoss, b.profitLoss);
  assert.equal(a.returnRate, b.returnRate);
  assert.equal(a.averagePurchasePrice, b.averagePurchasePrice);
});

// --- 정기 매수만 기준 계획과 현재 계획 비교(backtestComparison) ----------------------

test("조건부 매수가 없으면 backtestComparison 은 null 이다", () => {
  const candles = consecutive("2026-01-05", [100, 94, 96, 94]);
  const result = simulatePlan({ plan: recurringOnlyPlan(50_000), policy: ORIGINAL_PLAN_POLICY, candles });
  assert.equal(result.backtestComparison, null);
});

test("조건부 매수가 있으면 '정기 매수만' 기준과 비교한 backtestComparison 을 만든다", () => {
  // 정기 매수 100원에 1회(01-05, 01-12는 없음), 조건부 매수 하나(94 하향 돌파, 100,000원).
  const candles = consecutive("2026-01-05", [100, 94, 94]);
  const plan: SimulationPlan = {
    symbol: "TEST",
    market: "US",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 100_000 },
    conditionalBuy: { thresholdPercent: 5, amountKrw: 100_000 },
    guardrails: { monthlyBudgetKrw: null, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
  };
  const result = simulatePlan({ plan, policy: ORIGINAL_PLAN_POLICY, candles });

  assert.notEqual(result.backtestComparison, null);
  const comparison = result.backtestComparison!;

  // baseline(정기 매수만)은 조건부 매수를 전혀 실행하지 않는다.
  assert.equal(comparison.baseline.conditionalExecutedCount, 0);
  // current(현재 계획)는 조건부 매수 1회를 포함한다.
  assert.equal(comparison.current.conditionalExecutedCount, 1);

  assert.equal(comparison.difference.additionalInvested, comparison.current.totalInvested - comparison.baseline.totalInvested);
  assert.equal(
    comparison.difference.profitLossDifference,
    comparison.current.profitLoss - comparison.baseline.profitLoss
  );
  assert.ok(comparison.difference.additionalInvested > 0, "조건부 매수만큼 투자금이 더 많아야 한다");

  // baseline 자체도 정상적인 SimulationResult 계산 규칙을 그대로 따른다(다른 값을 지어내지 않는다).
  assert.equal(comparison.baseline.recurringExecutedCount, result.recurringExecutionCount);
});

test("[개편] 스킵된 매수는 매수 횟수·투자금·수량 어디에도 포함되지 않는다", () => {
  const dates = ["2026-02-02", "2026-02-09"];
  const closes = [100, 100];
  const plan: SimulationPlan = {
    symbol: "TEST",
    market: "US",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 100_000 },
    conditionalBuy: null,
    guardrails: { monthlyBudgetKrw: 100_000, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
  };
  const result = simulatePlan({ plan, policy: ORIGINAL_PLAN_POLICY, candles: daily(dates, closes) });

  // 두 번째 매수는 예산(100,000원)을 넘겨 스킵된다.
  assert.equal(result.recurringExecutionCount, 1);
  assert.equal(result.totalInvested, 100_000);
  assert.equal(result.totalQuantity, 1000);
  assert.equal(result.budgetSkippedEvents.length, 1);

  // 차트에 연결된 이벤트 id 에도 스킵된 매수는 없다(가짜 매수점을 그리지 않는다).
  const recurringExecutedIds = result.simulationEvents
    .filter((e) => e.type === "recurring_buy_executed")
    .map((e) => e.id);
  assert.equal(recurringExecutedIds.length, 1);
});

// ---------------------------------------------------------------------------
// §국내주식 정수 수량 매수(§사용자 확정 — P0 계산 오류 수정) — 국내주식은 소수점 거래를
// 지원하지 않는다. 매수 금액으로 1주도 살 수 없으면 실행하지 않는다(남은 금액은 이월하지
// 않는다). 미국주식은 기존 소수점 매수를 그대로 유지한다.
// ---------------------------------------------------------------------------

test("[국내주식 정수 수량] 삼성전자 매주 1,000원(재현 사례): 주가가 금액보다 높으면 단 한 번도 실행되지 않는다", () => {
  // 재현 사례와 동일하게 실제 삼성전자 근사 가격대(13만원대)로 52주를 채운다.
  const dates: string[] = [];
  const closes: number[] = [];
  let cursorMs = Date.parse("2026-01-05T00:00:00Z"); // 월요일
  for (let week = 0; week < 52; week++) {
    dates.push(new Date(cursorMs).toISOString().slice(0, 10));
    closes.push(131_390);
    cursorMs += 7 * DAY_MS;
  }
  const plan: SimulationPlan = {
    symbol: "005930",
    market: "KR",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 1_000 },
    conditionalBuy: null,
    guardrails: { monthlyBudgetKrw: 500_000, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
  };
  const result = simulatePlan({ plan, policy: ORIGINAL_PLAN_POLICY, candles: daily(dates, closes) });

  assert.equal(result.recurringExecutionCount, 0, "실행된 매수는 0회여야 한다");
  assert.equal(result.totalInvested, 0);
  assert.equal(result.totalQuantity, 0, "0.3958주 같은 소수점 보유가 생기면 안 된다");
  assert.equal(result.endingValue, 0);
  assert.equal(result.profitLoss, 0);
  assert.equal(result.returnRate, null, "0원 투자에서 수익률을 0%로 표시하면 안 된다 — null(분모 0)이어야 한다");
  assert.equal(result.averagePurchasePrice, null);
  assert.equal(result.budgetSkippedEvents.length, 52, "52번 모두 스킵 기록이 남아야 한다");
  assert.ok(
    result.budgetSkippedEvents.every((e) => e.reason === "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE"),
    "스킵 사유는 월 한도가 아니라 1주 가격 미달이어야 한다(월 한도는 충분했다)"
  );
  assert.ok(
    result.simulationEvents.every((e) => e.type !== "recurring_buy_executed"),
    "실행된 매수 이벤트가 하나도 없어야 매수점이 차트에 찍히지 않는다"
  );
});

test("[국내주식 정수 수량] 매주 300,000원(주가 131,390원): 정수 주만 매수하고 남은 금액은 다음 주로 이월하지 않는다", () => {
  const plan: SimulationPlan = {
    symbol: "005930",
    market: "KR",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 300_000 },
    conditionalBuy: null,
    guardrails: { ...NO_GUARDRAILS },
  };
  // floor(300000 / 131390) = 2주, 체결 금액 262,780원 — 매주 정확히 같은 금액만 반복된다.
  const result = simulatePlan({
    plan,
    policy: ORIGINAL_PLAN_POLICY,
    candles: consecutive("2026-01-05", [131_390, 131_390, 131_390, 131_390, 131_390, 131_390, 131_390, 131_390]),
  });

  assert.equal(result.recurringExecutionCount, 2, "8일 중 월요일은 2026-01-05, 2026-01-12 두 번뿐이다");
  assert.equal(result.totalQuantity, 4, "매 실행마다 2주씩, 정수여야 한다");
  assert.ok(Number.isInteger(result.totalQuantity), "국내주식 보유 수량은 항상 정수여야 한다");
  assert.equal(result.totalInvested, 2 * 2 * 131_390, "총 투자금은 실제 체결 수량 × 체결가 합계여야 한다(요청 금액 300,000원이 아니다)");
  const executed = eventsOfType(result, "recurring_buy_executed");
  for (const event of executed) {
    assert.equal(event.quantity, 2);
    assert.equal(event.amountKrw, 262_780, "이벤트에 남는 37,220원이 반영되면 안 된다(이월 금지)");
  }
});

test("[국내주식 정수 수량] 미국주식(market: US)은 같은 조건에서도 기존 소수점 매수를 그대로 유지한다", () => {
  const basePlan = {
    symbol: "TEST",
    recurring: { frequency: "weekly" as const, weekday: "monday" as const, amountKrw: 300_000 },
    conditionalBuy: null,
    guardrails: { ...NO_GUARDRAILS },
  };
  const candles = consecutive("2026-01-05", [131_390]);

  const usResult = simulatePlan({ plan: { ...basePlan, market: "US" }, policy: ORIGINAL_PLAN_POLICY, candles });
  const krResult = simulatePlan({ plan: { ...basePlan, market: "KR" }, policy: ORIGINAL_PLAN_POLICY, candles });

  assert.equal(usResult.totalQuantity, 300_000 / 131_390, "미국주식은 소수점 수량을 그대로 유지해야 한다");
  assert.equal(usResult.totalInvested, 300_000, "미국주식은 요청 금액을 전액 그대로 투자한다");
  assert.equal(krResult.totalQuantity, 2, "같은 조건이라도 국내주식은 정수 주로 내림된다");
  assert.notEqual(usResult.totalQuantity, krResult.totalQuantity, "시장에 따라 수량 계산 방식이 달라야 한다");
});

test("[국내주식 정수 수량] 국내주식 조건부 매수: 조건은 발생했지만 금액으로 1주도 못 사면 실행하지 않는다(조건 미발생과 구분)", () => {
  // 첫 캔들(월요일)에 정기 매수를 심어 평균 매수가를 즉시 확정한다(seed). 이후 가격이 하락해
  // 조건부 매수 조건은 발생하지만, 조건부 매수 금액(1,000원)으로는 하락한 가격에서도 1주를
  // 살 수 없다.
  const plan: SimulationPlan = {
    symbol: "005930",
    market: "KR",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 1_000_000 },
    conditionalBuy: { thresholdPercent: 10, amountKrw: 1_000 },
    guardrails: { ...NO_GUARDRAILS },
  };
  // 100,000 → 100,000(평균 매수가 확정) → 80,000(10% 이상 하락, crossing 발생).
  const result = simulatePlan({
    plan,
    policy: ORIGINAL_PLAN_POLICY,
    candles: consecutive("2026-01-05", [100_000, 100_000, 80_000]),
  });

  assert.equal(result.conditionalTriggerCount, 1, "조건 자체는 발생해야 한다");
  assert.equal(result.conditionalExecutionCount, 0, "1주도 살 수 없으니 실행되지 않아야 한다");
  assert.equal(result.conditionalBlockedCount, 1);

  const blocked = eventsOfType(result, "conditional_buy_blocked");
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0]!.blockedBy, "insufficient_amount_for_one_share");

  const skipped = result.budgetSkippedEvents.filter((e) => e.type === "CONDITIONAL");
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0]!.reason, "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE");
});

test("[국내주식 정수 수량] 월 한도는 충분해도 1주 가격 미달이면 매수는 실행되지 않는다(월 한도 원인과 구분)", () => {
  const plan: SimulationPlan = {
    symbol: "005930",
    market: "KR",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 1_000 },
    conditionalBuy: null,
    guardrails: { monthlyBudgetKrw: 10_000_000, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
  };
  const result = simulatePlan({ plan, policy: ORIGINAL_PLAN_POLICY, candles: consecutive("2026-01-05", [131_390]) });

  assert.equal(result.recurringExecutionCount, 0);
  assert.equal(result.budgetSkippedEvents.length, 1);
  assert.equal(
    result.budgetSkippedEvents[0]!.reason,
    "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE",
    "월 한도가 넉넉해도 원인은 월 한도가 아니라 1주 가격 미달이어야 한다"
  );
  assert.equal(result.budgetExceededMonthCount, 0, "예산 초과로 판정되면 안 된다 — 애초에 실행되지 않았다");
});
