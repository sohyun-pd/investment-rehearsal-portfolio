/**
 * 시뮬레이션 엔진 본체 (순수 함수).
 *
 * 스펙: docs/product/build/SIMULATION_ENGINE_SPEC.md
 * 계약: docs/product/build/AGENT_TOOL_CONTRACT.md §12–13, docs/product/STRATEGY_SCHEMA_V2.md §17–22
 *
 * 이 파일은 외부 API 를 호출하지 않고, 시스템 현재 시각도 읽지 않는다.
 * calculatedAt 을 제외하면 동일 입력 → 동일 출력이다.
 *
 * MVP 범위에서 하지 않는 것:
 *  - 환율 변환
 *
 * §동적 평균 매수가(§사용자 확정) — 평균 매수가는 사용자 입력이 아니라 실행된 매수(정기+조건부)의
 * 누적 투자금 ÷ 누적 수량으로 이 파일이 직접 계산한다. 첫 정기 매수 전에는 값이 없다(null).
 * `app/domain/simulation/types.ts` 상단 주석에 전체 규칙이 있다.
 */
import { buildChartSeries } from "./buildChartSeries";
import {
  calculatePostTriggerDecline,
  maxAdditionalDeclinePercent,
  type PostTriggerDecline,
} from "./calculatePostTriggerDecline";
import {
  ENGINE_VERSION,
  PERCENT_DECIMALS,
  PRICE_DECIMALS,
  monthKeyOf,
  priceAtDrawdown,
} from "./policies";
import { scheduleRecurring, type RecurringExecution } from "./scheduleRecurring";
import {
  SimulationInputError,
  type AppliedCalculationPolicy,
  type BacktestComparison,
  type BacktestSummary,
  type BlockedReason,
  type BudgetExceededEvent,
  type DailyCandle,
  type MonthlySimulationResult,
  type SimulatePlanInput,
  type SimulationEvent,
  type SimulationPlan,
  type SimulationResult,
  type SkippedBuyEvent,
} from "./types";

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** §국내주식 정수 수량 매수(§사용자 확정 — P0 계산 오류 수정) — 국내주식은 국내 증권사
 * 공개 서비스에서 소수점 거래가 안내되지 않는 해외주식 전용 기능이라, 정수 주 단위로만
 * 매수한다. 그 금액으로 그날 종가 기준 1주도 살 수 없으면 매수 자체를 실행하지 않는다(남은
 * 금액은 다음 매수로 이월하지 않는다 — §현재 제품 범위가 아닌 누적 매수를 새로 만들지 않는다).
 * 미국주식은 기존 소수점 매수를 그대로 유지한다. `executedAmount` 는 실제로 체결된 금액이다
 * (국내주식은 `주가 × 정수 수량` 이라 요청 금액보다 작을 수 있다 — 총 투자금은 항상 이
 * 값으로만 누적해야 한다). */
function resolveBuyQuantity(
  requestedAmountKrw: number,
  closePrice: number,
  market: SimulationPlan["market"]
): { quantity: number; executedAmount: number } | null {
  if (market === "US") {
    return { quantity: requestedAmountKrw / closePrice, executedAmount: requestedAmountKrw };
  }
  const shares = Math.floor(requestedAmountKrw / closePrice);
  if (shares <= 0) return null;
  return { quantity: shares, executedAmount: shares * closePrice };
}

/**
 * 입력 검증. 잘못된 값을 0 이나 기본값으로 보정하지 않고 즉시 던진다.
 * 조용히 보정하면 사용자가 잘못 입력한 계획이 정상 결과처럼 보이기 때문이다.
 */
export function validateSimulationInput(plan: SimulationPlan, candles: DailyCandle[]): void {
  if (typeof plan.symbol !== "string" || plan.symbol.trim() === "") {
    throw new SimulationInputError("invalid_symbol", "symbol 이 비어 있습니다.");
  }

  if (candles.length === 0) {
    throw new SimulationInputError("empty_candles", "candles 가 비어 있습니다.");
  }

  let previousDate = "";
  for (const candle of candles) {
    if (!isPositiveFinite(candle.close)) {
      throw new SimulationInputError(
        "invalid_candle",
        `close 가 유효하지 않습니다 (date=${candle.date}).`
      );
    }
    if (candle.date === previousDate) {
      throw new SimulationInputError(
        "duplicate_candle_date",
        `candle 날짜가 중복입니다 (date=${candle.date}). adapter 단계에서 제거되어야 합니다.`
      );
    }
    if (candle.date < previousDate) {
      throw new SimulationInputError(
        "candles_not_ascending",
        `candles 가 날짜 오름차순이 아닙니다 (${previousDate} → ${candle.date}).`
      );
    }
    previousDate = candle.date;
  }

  if (plan.recurring !== null && !isPositiveFinite(plan.recurring.amountKrw)) {
    throw new SimulationInputError(
      "invalid_recurring_amount",
      "recurring.amountKrw 는 0보다 큰 값이어야 합니다."
    );
  }

  if (plan.conditionalBuy !== null) {
    const { thresholdPercent, amountKrw } = plan.conditionalBuy;

    if (!isPositiveFinite(amountKrw)) {
      throw new SimulationInputError(
        "invalid_conditional_amount",
        "conditionalBuy.amountKrw 는 0보다 큰 값이어야 합니다."
      );
    }
    // 0 이면 평균 매수가 자체가 임계선이 되고, 100 이상이면 임계 가격이 0 이하가 된다.
    if (!isPositiveFinite(thresholdPercent) || thresholdPercent >= 100) {
      throw new SimulationInputError(
        "invalid_threshold_percent",
        "conditionalBuy.thresholdPercent 는 0보다 크고 100보다 작아야 합니다."
      );
    }
  }

  const { monthlyBudgetKrw, maxConditionalExecutionsPerMonth, reviewDrawdownPercent } =
    plan.guardrails;

  if (monthlyBudgetKrw !== null && !isPositiveFinite(monthlyBudgetKrw)) {
    throw new SimulationInputError(
      "invalid_monthly_budget",
      "guardrails.monthlyBudgetKrw 는 null 이거나 0보다 큰 값이어야 합니다."
    );
  }

  if (
    maxConditionalExecutionsPerMonth !== null &&
    (!Number.isInteger(maxConditionalExecutionsPerMonth) || maxConditionalExecutionsPerMonth < 0)
  ) {
    throw new SimulationInputError(
      "invalid_max_conditional_executions",
      "guardrails.maxConditionalExecutionsPerMonth 는 null 이거나 0 이상 정수여야 합니다."
    );
  }

  if (
    reviewDrawdownPercent !== null &&
    (!isPositiveFinite(reviewDrawdownPercent) || reviewDrawdownPercent >= 100)
  ) {
    throw new SimulationInputError(
      "invalid_review_drawdown_percent",
      "guardrails.reviewDrawdownPercent 는 null 이거나 0보다 크고 100보다 작아야 합니다."
    );
  }

  // 재검토 조건은 조건부 매수와 같은 평균 매수가 기준을 공유한다 — conditionalBuy 설정 자체가
  // 없으면 재검토도 함께 켤 수 없다.
  if (reviewDrawdownPercent !== null && plan.conditionalBuy === null) {
    throw new SimulationInputError(
      "review_requires_average_cost",
      "reviewDrawdownPercent 를 쓰려면 conditionalBuy 설정이 필요합니다."
    );
  }
}

function emptyMonth(month: string): MonthlySimulationResult {
  return {
    month,
    recurringInvestmentKrw: 0,
    conditionalInvestmentKrw: 0,
    totalInvestmentKrw: 0,
    recurringExecutionCount: 0,
    conditionalTriggerCount: 0,
    conditionalExecutionCount: 0,
    conditionalBlockedCount: 0,
    budgetExceeded: false,
    budgetExceededCause: null,
    recurringAloneExceededBudget: false,
    conditionalCausedBudgetExceed: false,
    reviewTriggered: false,
  };
}

/**
 * 예산 초과 원인 판정. **월 최종 집계**로만 판단한다.
 *
 * 왜 최종 집계인가: 루프 도중에 판정하면 그 시점의 부분 합계로 원인이 결정되어, 같은 달에
 * 정기 매수가 더 남아 있을 때 최종 집계와 결론이 갈릴 수 있다. 예를 들어 월요일이 5번인 달에
 * 초과가 4번째 정기 매수 시점에 발생하면 그 순간의 정기 매수 합계는 예산 이하이지만,
 * 그 달 전체로 보면 정기 매수만으로 이미 예산을 넘는다. AI 가 읽는 값은 후자여야 한다.
 */
function classifyBudgetCause(
  monthly: MonthlySimulationResult,
  monthlyBudgetKrw: number | null
): {
  budgetExceeded: boolean;
  budgetExceededCause: MonthlySimulationResult["budgetExceededCause"];
  recurringAloneExceededBudget: boolean;
  conditionalCausedBudgetExceed: boolean;
} {
  const notExceeded = {
    budgetExceeded: false,
    budgetExceededCause: null,
    recurringAloneExceededBudget: false,
    conditionalCausedBudgetExceed: false,
  } as const;

  if (monthlyBudgetKrw === null) return { ...notExceeded };

  if (monthly.recurringInvestmentKrw > monthlyBudgetKrw) {
    return {
      budgetExceeded: true,
      budgetExceededCause: "recurring_only",
      recurringAloneExceededBudget: true,
      conditionalCausedBudgetExceed: false,
    };
  }

  if (monthly.totalInvestmentKrw > monthlyBudgetKrw) {
    return {
      budgetExceeded: true,
      budgetExceededCause: "conditional_action",
      recurringAloneExceededBudget: false,
      conditionalCausedBudgetExceed: true,
    };
  }

  return { ...notExceeded };
}

/** candles 에 존재하는 월만 만든다(없는 달을 합성하지 않는다). */
function initMonthlyResults(candles: DailyCandle[]): Map<string, MonthlySimulationResult> {
  const months = new Map<string, MonthlySimulationResult>();
  for (const candle of candles) {
    const month = monthKeyOf(candle.date);
    if (!months.has(month)) months.set(month, emptyMonth(month));
  }
  return months;
}

/** 비교용 "정기 매수만" 기준 계획을 실제로 실행해 얻은 결과에서 백테스팅 요약만 뽑아낸다. */
function toBacktestSummary(result: SimulationResult): BacktestSummary {
  return {
    totalInvested: result.totalInvested,
    totalQuantity: result.totalQuantity,
    endingValue: result.endingValue,
    profitLoss: result.profitLoss,
    returnRate: result.returnRate,
    averagePurchasePrice: result.averagePurchasePrice,
    lastClose: result.lastClose,
    lastTradingDate: result.lastTradingDate,
    recurringExecutedCount: result.recurringExecutionCount,
    conditionalExecutedCount: result.conditionalExecutionCount,
    budgetSkippedCount: result.budgetSkippedEvents.length,
  };
}

function buildBacktestComparison(baseline: SimulationResult, current: SimulationResult): BacktestComparison {
  const baselineSummary = toBacktestSummary(baseline);
  const currentSummary = toBacktestSummary(current);
  return {
    baseline: baselineSummary,
    current: currentSummary,
    difference: {
      additionalInvested: currentSummary.totalInvested - baselineSummary.totalInvested,
      endingValueDifference: currentSummary.endingValue - baselineSummary.endingValue,
      profitLossDifference: currentSummary.profitLoss - baselineSummary.profitLoss,
      returnRateDifference:
        currentSummary.returnRate !== null && baselineSummary.returnRate !== null
          ? currentSummary.returnRate - baselineSummary.returnRate
          : null,
      averagePurchasePriceDifference:
        currentSummary.averagePurchasePrice !== null && baselineSummary.averagePurchasePrice !== null
          ? currentSummary.averagePurchasePrice - baselineSummary.averagePurchasePrice
          : null,
    },
  };
}

/** 조건부 추가 매수가 있으면, 같은 가격 데이터로 "정기 매수만" 기준 계획을 한 번 더 실행해
 * 비교 기준을 만든다(§사용자 확정 — 어느 쪽이 "더 좋다"고 판정하지 않고 차이만 보여준다).
 * 재귀 호출이지만 baseline 쪽은 항상 conditionalBuy 가 null 이라 한 번만 더 돈다. */
export function simulatePlan(input: SimulatePlanInput): SimulationResult {
  const result = computeSimulationResult(input);
  if (input.plan.conditionalBuy === null) {
    return { ...result, backtestComparison: null };
  }
  const baseline = computeSimulationResult({
    ...input,
    plan: {
      ...input.plan,
      conditionalBuy: null,
      // reviewDrawdownPercent 는 conditionalBuy 설정이 있어야만 유효하다(§validateSimulationInput
      // "review_requires_average_cost") — 기준 계획에서는 조건부 매수 자체를 뺐으므로 같이 비운다.
      guardrails: { ...input.plan.guardrails, reviewDrawdownPercent: null },
    },
  });
  return { ...result, backtestComparison: buildBacktestComparison(baseline, result) };
}

function computeSimulationResult(input: SimulatePlanInput): SimulationResult {
  const { plan, policy, candles } = input;
  validateSimulationInput(plan, candles);

  const firstCandle = candles[0]!;
  const lastCandle = candles[candles.length - 1]!;
  const symbol = plan.symbol;

  // --- 사전 계산 -------------------------------------------------------------
  const recurringExecutions = scheduleRecurring(candles, plan.recurring);
  const recurringByDate = new Map<string, RecurringExecution[]>();
  for (const execution of recurringExecutions) {
    const bucket = recurringByDate.get(execution.executionDate);
    if (bucket === undefined) recurringByDate.set(execution.executionDate, [execution]);
    else bucket.push(execution);
  }

  const reviewDrawdownPercent = plan.guardrails.reviewDrawdownPercent;

  // --- 일별 순회 -------------------------------------------------------------
  const monthlyResults = initMonthlyResults(candles);
  const events: SimulationEvent[] = [];
  /** 월 예산 초과 이벤트는 월 1회만 만든다. cause 는 루프가 끝난 뒤 최종 집계로 채운다.
   * §사용자 확정 개편 이후로는 정기·조건부 매수 모두 예산을 넘기 전에 실행 자체를 막기
   * 때문에(아래 budgetSkippedEvents), 이 이벤트는 이제 구조적으로 생성되지 않는다 — 지우지는
   * 않는다(하위 호환, 다른 화면이 이 필드를 계속 읽을 수 있다). */
  const budgetExceededEvents = new Map<string, BudgetExceededEvent>();
  /** 월 예산 때문에 실행하지 않은 매수(§사용자 확정 — "결과를 계산한 뒤 경고만 하는 값이
   * 아니라 실행 자체를 막는 제약"). 투자금·수량·평가금액 계산에서 전부 제외한다. */
  const budgetSkippedEvents: SkippedBuyEvent[] = [];
  let totalQuantity = 0;

  // §동적 평균 매수가 — 실행된 모든 매수(정기+조건부)의 누적 투자금 ÷ 누적 수량을 매수가
  // 있을 때마다 다시 계산한다. 첫 매수 전에는 null 이다.
  let cumulativeInvested = 0;
  let cumulativeQuantity = 0;
  let averageCost: number | null = null;
  const recordExecutedBuy = (amountKrw: number, quantity: number): void => {
    cumulativeInvested += amountKrw;
    cumulativeQuantity += quantity;
    averageCost = cumulativeQuantity > 0 ? cumulativeInvested / cumulativeQuantity : null;
  };

  // 조건부 매수·재검토 crossing 상태 — 임계 가격이 평균 매수가와 함께 매번 바뀌므로, 전체
  // candle 을 대상으로 미리 한 번에 계산해 두지 않고 그날그날의 평균 매수가로 매일 다시
  // 계산해 상태(직전 평가가 임계선 위였는지)만 이어간다. null 은 "아직 평균 매수가가 없어
  // 평가 대상조차 아니다"를 뜻한다.
  let conditionalWasAboveThreshold: boolean | null = null;
  let conditionalInitialState: "above_threshold" | "at_or_below_threshold" | null = null;
  let reviewWasAboveThreshold: boolean | null = null;
  let reviewInitialState: "above_threshold" | "at_or_below_threshold" | null = null;
  /** calculatePostTriggerDecline 용 — 실행 여부와 무관하게 조건 발생일 인덱스를 전부 모은다. */
  const conditionalTriggerIndices: number[] = [];

  let eventSequence = 0;
  const nextEventId = (): string => {
    eventSequence++;
    return `evt_${String(eventSequence).padStart(4, "0")}`;
  };

  /** 재검토 조건이 발생한 **당일부터** 적용된다(같은 날 조건부 매수도 차단). */
  let conditionalPaused = false;

  const monthlyBudgetKrw = plan.guardrails.monthlyBudgetKrw;
  const maxConditionalPerMonth = plan.guardrails.maxConditionalExecutionsPerMonth;

  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index]!;
    const month = monthKeyOf(candle.date);
    const monthly = monthlyResults.get(month)!;

    const baseFields = (averageCostBefore: number | null, averageCostAfter: number | null) => ({
      date: candle.date,
      symbol,
      closePrice: candle.close,
      priceCurrency: "USD" as const,
      averageCostBefore,
      averageCostAfter,
    });

    /**
     * 월 예산 초과는 월 1회만 기록한다. 정기 매수는 예산으로 차단하지 않는다.
     * `triggeredByEventId` 는 그 달의 초과 상태를 처음 만든 실행 이벤트다.
     * 금액 분해와 `cause` 는 루프가 끝난 뒤 최종 집계로 채운다.
     */
    const flagBudgetIfExceeded = (triggeredByEventId: string): void => {
      if (monthlyBudgetKrw === null) return;
      if (monthly.totalInvestmentKrw <= monthlyBudgetKrw) return;
      if (budgetExceededEvents.has(month)) return;

      const event: BudgetExceededEvent = {
        ...baseFields(averageCost, averageCost),
        id: nextEventId(),
        type: "monthly_budget_exceeded",
        month,
        monthlyInvestmentKrw: monthly.totalInvestmentKrw,
        monthlyBudgetKrw,
        // 아래 세 값은 finalize 단계에서 최종 집계로 덮어쓴다.
        recurringInvestmentKrw: monthly.recurringInvestmentKrw,
        conditionalInvestmentKrw: monthly.conditionalInvestmentKrw,
        cause: "recurring_only",
        triggeredByEventId,
      };
      budgetExceededEvents.set(month, event);
      events.push(event);
    };

    // 1) 정기 매수 (sameDayEventOrder: recurring_first). §사용자 확정 — 그 달 누적 투자금이
    // 이 매수까지 실행하면 월 예산을 넘기게 되면 실행하지 않고 SkippedBuyEvent 로만 기록한다
    // (계획 확인 단계에서 이미 "1회 금액 자체가 예산보다 큰" 계획은 막아 두므로, 여기서 막히는
    // 경우는 "같은 달에 여러 번 실행되며 누적으로 넘는" 경우뿐이다). 정기 매수가 실행되며
    // 평균 매수가가 갱신된다 — 첫 실행이면 이때 처음 생긴다.
    if (plan.recurring !== null) {
      const amountKrw = plan.recurring.amountKrw;
      for (const execution of recurringByDate.get(candle.date) ?? []) {
        // §국내주식 정수 수량 매수 — 1주도 살 수 없으면(국내주식) 월 예산과 무관하게 매수
        // 자체를 실행하지 않는다. 남은 금액은 다음 매수로 이월하지 않는다.
        const resolved = resolveBuyQuantity(amountKrw, candle.close, plan.market);
        if (resolved === null) {
          budgetSkippedEvents.push({
            date: candle.date,
            type: "RECURRING",
            requestedAmount: amountKrw,
            reason: "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE",
            monthlySpentBefore: monthly.totalInvestmentKrw,
            monthlyBudget: monthlyBudgetKrw,
          });
          continue;
        }
        const { quantity, executedAmount } = resolved;
        if (monthlyBudgetKrw !== null && monthly.totalInvestmentKrw + executedAmount > monthlyBudgetKrw) {
          budgetSkippedEvents.push({
            date: candle.date,
            type: "RECURRING",
            requestedAmount: amountKrw,
            reason: "MONTHLY_BUDGET_EXCEEDED",
            monthlySpentBefore: monthly.totalInvestmentKrw,
            monthlyBudget: monthlyBudgetKrw,
          });
          continue;
        }
        monthly.recurringExecutionCount++;
        monthly.recurringInvestmentKrw += executedAmount;
        monthly.totalInvestmentKrw += executedAmount;
        totalQuantity += quantity;
        const averageCostBefore = averageCost;
        recordExecutedBuy(executedAmount, quantity);
        const recurringEventId = nextEventId();
        events.push({
          ...baseFields(averageCostBefore, averageCost),
          id: recurringEventId,
          type: "recurring_buy_executed",
          amountKrw: executedAmount,
          scheduledDate: execution.scheduledDate,
          rolledForward: execution.rolledForward,
          quantity,
        });
        flagBudgetIfExceeded(recurringEventId);
      }
    }

    // 2) 재검토 조건 — 같은 날의 조건부 매수보다 **먼저** 평가한다. 평균 매수가가 아직 없으면
    // (첫 정기 매수 전) 평가 대상이 아니다. 조건부 매수와 달리, 평균 매수가가 생긴 뒤 첫
    // 평가일부터 이미 재검토 기준 이하이면 그 자체로 재검토 사유다("추가 매수 전에 계획을
    // 다시 확인한다"는 계약이므로 시작 시점의 손실도 확인 대상이다).
    if (plan.conditionalBuy !== null && reviewDrawdownPercent !== null && averageCost !== null) {
      const reviewPrice = priceAtDrawdown(averageCost, reviewDrawdownPercent);
      const isAtOrBelow = candle.close <= reviewPrice;
      const isFirstEvaluation = reviewWasAboveThreshold === null;
      if (isFirstEvaluation) {
        reviewInitialState = isAtOrBelow ? "at_or_below_threshold" : "above_threshold";
      }
      if (isFirstEvaluation ? isAtOrBelow : reviewWasAboveThreshold === true && isAtOrBelow) {
        monthly.reviewTriggered = true;
        events.push({
          ...baseFields(averageCost, averageCost),
          id: nextEventId(),
          type: "review_triggered",
          trigger: "price_drawdown",
          referencePrice: averageCost,
          thresholdValue: reviewDrawdownPercent,
          reviewPrice,
          initialState: isFirstEvaluation,
          previousClose: isFirstEvaluation ? null : candles[index - 1]!.close,
        });
        if (policy.reviewTriggerBehavior === "pause_future_conditional_actions") {
          conditionalPaused = true;
        }
      }
      reviewWasAboveThreshold = !isAtOrBelow;
    }

    // 3) 조건부 매수 — 평균 매수가가 아직 없으면(첫 정기 매수 전, 또는 정기 매수 자체가 없는
    // 계획) 평가하지 않는다(§평균 매수가가 없는 상태에서 추가 매수만 실행하지 않음). 조건부
    // 매수가 실행되면 그 매수도 평균 매수가에 반영되어, 이후 평가일의 임계 가격이 함께
    // 낮아진다.
    if (plan.conditionalBuy !== null && averageCost !== null) {
      const { amountKrw, thresholdPercent } = plan.conditionalBuy;
      const triggerPrice = priceAtDrawdown(averageCost, thresholdPercent);
      const isAtOrBelow = candle.close <= triggerPrice;
      const isFirstEvaluation = conditionalWasAboveThreshold === null;
      if (isFirstEvaluation) {
        conditionalInitialState = isAtOrBelow ? "at_or_below_threshold" : "above_threshold";
      }
      // 첫 평가일은 비교할 이전 평가가 없으므로(§기존 규칙 — "첫 candle 은 trigger 하지
      // 않는다"의 동적 버전) 초기 상태만 기록하고 trigger 하지 않는다.
      const crossed = !isFirstEvaluation && conditionalWasAboveThreshold === true && isAtOrBelow;
      conditionalWasAboveThreshold = !isAtOrBelow;

      if (crossed) {
        conditionalTriggerIndices.push(index);
        monthly.conditionalTriggerCount++;
        events.push({
          ...baseFields(averageCost, averageCost),
          id: nextEventId(),
          type: "conditional_triggered",
          referencePrice: averageCost,
          thresholdPercent,
          triggerPrice,
          previousClose: candles[index - 1]!.close,
        });

        // §국내주식 정수 수량 매수 — 이 금액으로 1주도 살 수 없으면(국내주식) 다른 어떤
        // 이유보다 먼저 막는다. 재검토·월 실행 횟수·월 예산은 전부 "살 수 있는데 정책상
        // 막는" 사유라, "애초에 살 수 없다"는 더 근본적인 사실이 우선이다.
        const resolved = resolveBuyQuantity(amountKrw, candle.close, plan.market);

        // 차단 사유 우선순위: 1주 미만 → 재검토 정지 → 월 실행 횟수 → 월 예산. §사용자 확정
        // 개편 — 월 예산 차단은 이제 policy 와 무관하게 항상 적용한다("결과를 계산한 뒤
        // 경고만 하는 값이 아니라 실행 자체를 막는 제약"이어야 하므로 ORIGINAL_PLAN_POLICY
        // 에서도 켠다). 예산 비교는 실제 체결 금액(resolved.executedAmount)으로 한다 —
        // 국내주식은 정수 주로 내림되어 요청 금액보다 작을 수 있고, 그 실제 금액 기준으로
        // 예산을 넘는지 판단해야 "예산은 충분한데 반올림 전 금액으로 오판" 하지 않는다.
        let blockedBy: BlockedReason | null = null;
        if (resolved === null) {
          blockedBy = "insufficient_amount_for_one_share";
        } else if (conditionalPaused) {
          blockedBy = "review_trigger";
        } else if (
          maxConditionalPerMonth !== null &&
          monthly.conditionalExecutionCount >= maxConditionalPerMonth
        ) {
          blockedBy = "monthly_execution_limit";
        } else if (monthlyBudgetKrw !== null && monthly.totalInvestmentKrw + resolved.executedAmount > monthlyBudgetKrw) {
          blockedBy = "monthly_budget";
        }

        if (blockedBy !== null) {
          monthly.conditionalBlockedCount++;
          events.push({
            ...baseFields(averageCost, averageCost),
            id: nextEventId(),
            type: "conditional_buy_blocked",
            blockedBy,
            attemptedAmountKrw: amountKrw,
          });
          if (blockedBy === "monthly_budget" || blockedBy === "insufficient_amount_for_one_share") {
            budgetSkippedEvents.push({
              date: candle.date,
              type: "CONDITIONAL",
              requestedAmount: amountKrw,
              reason:
                blockedBy === "monthly_budget" ? "MONTHLY_BUDGET_EXCEEDED" : "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE",
              monthlySpentBefore: monthly.totalInvestmentKrw,
              monthlyBudget: monthlyBudgetKrw,
            });
          }
        } else {
          const { quantity, executedAmount } = resolved!;
          monthly.conditionalExecutionCount++;
          monthly.conditionalInvestmentKrw += executedAmount;
          monthly.totalInvestmentKrw += executedAmount;
          totalQuantity += quantity;
          const averageCostBefore = averageCost;
          recordExecutedBuy(executedAmount, quantity);
          const conditionalEventId = nextEventId();
          events.push({
            ...baseFields(averageCostBefore, averageCost),
            id: conditionalEventId,
            type: "conditional_buy_executed",
            amountKrw: executedAmount,
            monthlyExecutionIndex: monthly.conditionalExecutionCount,
            quantity,
          });
          flagBudgetIfExceeded(conditionalEventId);
        }
      }
    }
  }

  // --- 집계 -----------------------------------------------------------------
  const months = [...monthlyResults.values()];

  // 예산 초과 원인을 월 최종 집계로 확정한다. 이벤트의 cause 도 같은 값으로 맞춘다.
  for (const monthly of months) {
    const verdict = classifyBudgetCause(monthly, monthlyBudgetKrw);
    monthly.budgetExceeded = verdict.budgetExceeded;
    monthly.budgetExceededCause = verdict.budgetExceededCause;
    monthly.recurringAloneExceededBudget = verdict.recurringAloneExceededBudget;
    monthly.conditionalCausedBudgetExceed = verdict.conditionalCausedBudgetExceed;

    const event = budgetExceededEvents.get(monthly.month);
    if (event !== undefined && verdict.budgetExceededCause !== null) {
      event.cause = verdict.budgetExceededCause;
      event.monthlyInvestmentKrw = monthly.totalInvestmentKrw;
      event.recurringInvestmentKrw = monthly.recurringInvestmentKrw;
      event.conditionalInvestmentKrw = monthly.conditionalInvestmentKrw;
    }
  }

  let recurringExecutionCount = 0;
  let conditionalTriggerCount = 0;
  let conditionalExecutionCount = 0;
  let conditionalBlockedCount = 0;
  let totalRecurringInvestmentKrw = 0;
  let totalConditionalInvestmentKrw = 0;
  let maxMonthlyInvestmentKrw = 0;
  let maxMonthlyConditionalExecutionCount = 0;
  let budgetExceededMonthCount = 0;
  let recurringOnlyBudgetExceededMonthCount = 0;
  let conditionalCausedBudgetExceededMonthCount = 0;

  for (const monthly of months) {
    recurringExecutionCount += monthly.recurringExecutionCount;
    conditionalTriggerCount += monthly.conditionalTriggerCount;
    conditionalExecutionCount += monthly.conditionalExecutionCount;
    conditionalBlockedCount += monthly.conditionalBlockedCount;
    totalRecurringInvestmentKrw += monthly.recurringInvestmentKrw;
    totalConditionalInvestmentKrw += monthly.conditionalInvestmentKrw;
    if (monthly.totalInvestmentKrw > maxMonthlyInvestmentKrw) {
      maxMonthlyInvestmentKrw = monthly.totalInvestmentKrw;
    }
    if (monthly.conditionalExecutionCount > maxMonthlyConditionalExecutionCount) {
      maxMonthlyConditionalExecutionCount = monthly.conditionalExecutionCount;
    }
    if (monthly.budgetExceeded) budgetExceededMonthCount++;
    if (monthly.budgetExceededCause === "recurring_only") recurringOnlyBudgetExceededMonthCount++;
    if (monthly.budgetExceededCause === "conditional_action") {
      conditionalCausedBudgetExceededMonthCount++;
    }
  }

  const reviewTriggeredCount = events.filter((event) => event.type === "review_triggered").length;

  // 추가 하락은 실행 여부와 무관하게 모든 조건 발생일을 대상으로 계산한다.
  const declines: PostTriggerDecline[] = conditionalTriggerIndices.map((index) =>
    calculatePostTriggerDecline(candles, index, policy.postTriggerObservationDays)
  );

  const appliedPolicy: AppliedCalculationPolicy = {
    policy,
    priceField: "close",
    marketHolidayHandling: "next_trading_day",
    priceDecimals: PRICE_DECIMALS,
    percentDecimals: PERCENT_DECIMALS,
    conditionalInitialState,
    reviewInitialState,
  };

  // --- 백테스팅 요약(§사용자 확정) — 실제로 실행된 매수(스킵 제외)로만 계산한다. ------------
  const totalInvested = totalRecurringInvestmentKrw + totalConditionalInvestmentKrw;
  const lastClose = lastCandle.close;
  const lastTradingDate = lastCandle.date;
  const endingValue = totalQuantity * lastClose;
  const profitLoss = endingValue - totalInvested;
  const returnRate = totalInvested > 0 ? (profitLoss / totalInvested) * 100 : null;
  const averagePurchasePrice = totalQuantity > 0 ? totalInvested / totalQuantity : null;

  return {
    symbol,
    period: { from: firstCandle.date, to: lastCandle.date },
    tradingDayCount: candles.length,

    recurringExecutionCount,
    conditionalTriggerCount,
    conditionalExecutionCount,
    conditionalBlockedCount,

    totalRecurringInvestmentKrw,
    totalConditionalInvestmentKrw,
    totalInvestmentKrw: totalInvested,

    maxMonthlyInvestmentKrw,
    maxMonthlyConditionalExecutionCount,

    budgetExceededMonthCount,
    recurringOnlyBudgetExceededMonthCount,
    conditionalCausedBudgetExceededMonthCount,
    reviewTriggeredCount,

    maxAdditionalDeclineAfterTriggerPercent: maxAdditionalDeclinePercent(declines),

    monthlyResults: months,
    simulationEvents: events,
    budgetSkippedEvents,
    chartSeries: buildChartSeries(candles, events),

    totalInvested,
    totalQuantity,
    endingValue,
    profitLoss,
    returnRate,
    averagePurchasePrice,
    lastClose,
    lastTradingDate,
    backtestComparison: null,

    appliedPolicy,

    engineVersion: ENGINE_VERSION,
    calculatedAt: input.calculatedAt ?? null,
  };
}
