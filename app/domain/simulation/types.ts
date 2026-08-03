/**
 * 시뮬레이션 엔진 전용 타입.
 *
 * 정식 스키마: docs/product/STRATEGY_SCHEMA_V2.md §17–22,
 *             docs/product/build/AGENT_TOOL_CONTRACT.md §12–13.
 * 스펙 문서: docs/product/build/SIMULATION_ENGINE_SPEC.md
 *
 * app/types/strategy.ts 의 타입은 V1 스키마와 이름이 겹쳐 그대로 재사용하면 필드 의미가
 * 충돌한다. 그래서 엔진 전용 타입을 정의하고, 스키마 이름과의 대응은 SPEC 문서에 표로 기록한다.
 *
 * 금액은 모두 KRW 현금 금액(cash_amount)이다. 환율 변환은 하지 않는다.
 *
 * §국내주식 정수 수량 매수(§사용자 확정 — P0 계산 오류 수정) — "가상 소수점 수량 매수"는
 * 미국주식(`market: "US"`)에만 적용된다. 국내 증권사 공개 서비스에서 소수점 거래는
 * 해외주식에만 안내되므로, 국내주식(`market: "KR"`)은 항상 `Math.floor(금액 / 종가)` 로
 * 정수 주만 매수한다 — 그 금액으로 1주도 살 수 없으면 그 매수는 실행하지 않고
 * `SkippedBuyEvent`(reason: "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE")로만 기록한다(남은 금액은
 * 다음 매수로 이월하지 않는다). `resolveBuyQuantity()`(simulatePlan.ts)가 이 분기를 전담한다.
 *
 * §사용자 확정(백테스팅 결과 개편) — 월 예산은 더 이상 "계산 후 경고만 하는 값"이 아니라
 * 실행 자체를 막는 제약이다 — 그 달 누적 투자금이 예산을 넘기게 되는 매수는 실행하지 않고
 * `SkippedBuyEvent`(reason: "MONTHLY_BUDGET_EXCEEDED")로만 기록한다(투자금·수량·평가금액
 * 계산에서 제외). 이 변경 덕분에 기존 "월 예산 초과" 판정(`classifyBudgetCause` 등)은 이제
 * 구조적으로 항상 미초과로 나온다 — 초과가 발생하기 전에 미리 막기 때문이다. 이 필드들은
 * 하위 호환을 위해 그대로 남겨 둔다.
 *
 * §동적 평균 매수가(§사용자 확정) — 평균 매수가(추가 매수 기준)는 사용자가 입력하는 값이
 * 아니다. 실행된 매수(정기+조건부)의 누적 투자금 ÷ 누적 수량으로 엔진이 직접 계산한다.
 * 첫 정기 매수가 실행되기 전에는 평균 매수가가 없으므로(null) 조건부 매수는 절대 트리거되지
 * 않는다 — 정기 매수 없이 조건부 매수만 있는 계획은 평균 매수가가 영영 생기지 않아 추가
 * 매수가 한 번도 실행되지 않는다. 이후 매수가 실행될 때마다(정기·조건부 모두) 평균 매수가가
 * 갱신되고, 그 뒤로 거래일 가격이 그 시점의 평균 매수가 대비 설정 비율만큼 하락하면 조건이
 * 충족된다 — 임계 가격은 최초 한 번만 계산하는 고정값이 아니라 매수가 있을 때마다 같이
 * 움직인다.
 */

/** 일봉. split-adjusted OHLC 기준. adapter 단계에서 중복·invalid 가 제거된 상태로 들어온다. */
export interface DailyCandle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface DateRange {
  from: string;
  to: string;
}

/** 정기 매수 요일. 거래일이 없는 토·일은 절대 포함하지 않는다(§거래일 재선택 안내). */
export type Weekday = "monday" | "tuesday" | "wednesday" | "thursday" | "friday";

/** 정기 매수 매달 실행일. "last"는 그 달의 마지막 날(28~31일, 달마다 다름)을 뜻한다 — 실제
 * 숫자로 고정하지 않는다(§매주·매달 실행일 모델 분리). */
export type DayOfMonth = 1 | 15 | 25 | "last";

/** 매주(weekday) 또는 매달(dayOfMonth) 중 하나만 성립하는 정기 매수 규칙 — 판별 유니온이라
 * frequency 가 "weekly"면 weekday 만, "monthly"면 dayOfMonth 만 존재하고 반대쪽 필드는 아예
 * 타입에 없다(§매주·매달 실행일 모델 분리 — "매달"인데 요일을 요구하거나 저장하지 않는다). */
export type RecurringRule =
  | { frequency: "weekly"; weekday: Weekday; amountKrw: number }
  | { frequency: "monthly"; dayOfMonth: DayOfMonth; amountKrw: number };

/** 국내(KR)·미국(US) 두 시장만 다룬다 — `app/types/appPlan.ts` 의 `Market` 과 같은 값이다.
 * 매수 수량 계산 방식 자체가 이 값 하나로만 갈린다(§사용자 확정 — 국내주식 정수 수량 매수
 * 버그 수정). 화면 문구나 종목명 문자열로 시장을 추측하지 않는다. */
export type Market = "US" | "KR";

export interface SimulationPlan {
  symbol: string;
  market: Market;

  recurring: RecurringRule | null;

  conditionalBuy: {
    thresholdPercent: number;
    amountKrw: number;
  } | null;

  guardrails: {
    monthlyBudgetKrw: number | null;
    maxConditionalExecutionsPerMonth: number | null;
    reviewDrawdownPercent: number | null;
  };
}

export interface SimulationPolicy {
  monthlyBudgetBehavior: "allow_and_flag" | "block_action_when_exceeded";

  reviewTriggerBehavior: "flag_only" | "pause_future_conditional_actions";

  conditionalTriggerMode: "crossing";
  sameDayEventOrder: "recurring_first";
  postTriggerObservationDays: 20;
}

/** §국내주식 정수 수량 매수(§사용자 확정) — "insufficient_amount_for_one_share" 는 국내주식
 * 조건부 매수 금액으로 1주도 살 수 없을 때만 쓴다(미국주식은 소수점 매수라 해당 없음). */
export type BlockedReason =
  | "monthly_budget"
  | "monthly_execution_limit"
  | "review_trigger"
  | "insufficient_amount_for_one_share";

export interface BaseSimulationEvent {
  id: string;
  date: string;
  symbol: string;

  closePrice: number;
  priceCurrency: "USD";

  /** §동적 평균 매수가 — 이 이벤트 직전/직후의 평균 매수가(누적 투자금 ÷ 누적 수량). 아직
   * 매수가 하나도 실행되지 않았으면 null. 매수 이벤트는 자신이 실행되며 평균 매수가를 바꾸므로
   * before !== after 일 수 있다. */
  averageCostBefore: number | null;
  averageCostAfter: number | null;
}

export type RecurringBuyEvent = BaseSimulationEvent & {
  type: "recurring_buy_executed";
  amountKrw: number;
  /** 원래 예정일(정기 매수 요일). 휴장일이면 date 와 달라진다. */
  scheduledDate: string;
  rolledForward: boolean;
  /** 미국주식: amountKrw / closePrice(가상 소수점 수량). 국내주식: Math.floor(amountKrw /
   * closePrice)(정수 주, §국내주식 정수 수량 매수). */
  quantity: number;
};

export type ConditionalTriggerEvent = BaseSimulationEvent & {
  type: "conditional_triggered";
  referencePrice: number;
  thresholdPercent: number;
  triggerPrice: number;
  previousClose: number;
};

export type ConditionalBuyEvent = BaseSimulationEvent & {
  type: "conditional_buy_executed";
  amountKrw: number;
  /** 해당 월의 조건부 실행 순번(1부터). */
  monthlyExecutionIndex: number;
  /** 미국주식: amountKrw / closePrice(가상 소수점 수량). 국내주식: Math.floor(amountKrw /
   * closePrice)(정수 주, §국내주식 정수 수량 매수). */
  quantity: number;
};

export type ConditionalBlockedEvent = BaseSimulationEvent & {
  type: "conditional_buy_blocked";
  blockedBy: BlockedReason;
  attemptedAmountKrw: number;
};

/**
 * 월 예산 초과의 원인. 한 달에 두 원인이 동시에 기록되지 않는다.
 *
 *  - `recurring_only`     — 정기 매수만으로 이미 예산을 넘었다(추가 매수와 무관).
 *  - `conditional_action` — 정기 매수는 예산 안이었고, 추가 매수가 더해져 넘었다.
 *  - `null`               — 초과하지 않았거나 예산이 설정되지 않았다.
 */
export type BudgetExceededCause = "recurring_only" | "conditional_action" | null;

export type BudgetExceededEvent = BaseSimulationEvent & {
  type: "monthly_budget_exceeded";
  month: string;
  monthlyInvestmentKrw: number;
  monthlyBudgetKrw: number;

  /** 해당 월 최종 집계. AI 가 원인을 추론하지 않도록 분해값을 함께 담는다. */
  recurringInvestmentKrw: number;
  conditionalInvestmentKrw: number;

  /** 해당 월 `MonthlySimulationResult.budgetExceededCause` 와 항상 동일하다. */
  cause: "recurring_only" | "conditional_action";

  /** 그 달의 예산 초과 상태를 처음 만든 실행 이벤트 id (recurring 또는 conditional). */
  triggeredByEventId: string;
};

export type ReviewTriggeredEvent = BaseSimulationEvent & {
  type: "review_triggered";
  trigger: "price_drawdown";
  referencePrice: number;
  thresholdValue: number;
  reviewPrice: number;
  /**
   * 첫 candle 이 이미 재검토 기준 이하여서 발생한 이벤트인지.
   * true 면 비교할 이전 거래일이 없으므로 previousClose 는 null 이다.
   */
  initialState: boolean;
  previousClose: number | null;
};

export type SimulationEvent =
  | RecurringBuyEvent
  | ConditionalTriggerEvent
  | ConditionalBuyEvent
  | ConditionalBlockedEvent
  | BudgetExceededEvent
  | ReviewTriggeredEvent;

/** 월 예산 때문에 실행 자체를 하지 않은 매수(§사용자 확정 — "결과를 계산한 뒤 경고만 하는
 * 값이 아니라 실행 자체를 막는 제약"). `SimulationEvent` 유니언에 넣지 않고 별도 배열로만
 * 둔다 — 차트·매수 횟수 등 "실행된 매수" 를 다루는 기존 코드가 실수로 이걸 매수로 세지
 * 않도록(§사용자 확정 — "budgetSkippedEvent 는 매수점으로 표시하지 마세요"). */
export interface SkippedBuyEvent {
  date: string;
  type: "RECURRING" | "CONDITIONAL";
  requestedAmount: number;
  /** §국내주식 정수 수량 매수(§사용자 확정) — "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE" 는 국내주식
   * 매수 금액으로 그날 종가 기준 1주도 살 수 없을 때만 쓴다. 월 예산과 무관하게 발생할 수
   * 있어(월 한도가 충분해도 1주 가격 미달이면 스킵) `monthlyBudget` 이 null 일 수 있다. */
  reason: "MONTHLY_BUDGET_EXCEEDED" | "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE";
  monthlySpentBefore: number;
  monthlyBudget: number | null;
}

/** 실제 매수 이벤트·가격 데이터로만 계산한 백테스팅 요약(§사용자 확정). AI 는 이 숫자를
 * 만들지 않는다 — TypeScript 결정적 계산만 쓴다. */
export interface BacktestSummary {
  totalInvested: number;
  totalQuantity: number;
  endingValue: number;
  profitLoss: number;
  returnRate: number | null;
  averagePurchasePrice: number | null;
  lastClose: number;
  lastTradingDate: string;
  recurringExecutedCount: number;
  conditionalExecutedCount: number;
  budgetSkippedCount: number;
}

/** 조건부 추가 매수가 있을 때만 계산한다 — "정기 매수만 했다면" 기준 계획과 현재 계획을
 * 같은 가격 데이터로 각각 계산해 차이만 보여준다(§사용자 확정 — 어느 쪽이 "더 좋다"고
 * 판정하지 않는다). */
export interface BacktestComparison {
  baseline: BacktestSummary;
  current: BacktestSummary;
  difference: {
    additionalInvested: number;
    endingValueDifference: number;
    profitLossDifference: number;
    returnRateDifference: number | null;
    averagePurchasePriceDifference: number | null;
  };
}

export interface MonthlySimulationResult {
  month: string; // YYYY-MM

  recurringInvestmentKrw: number;
  conditionalInvestmentKrw: number;
  totalInvestmentKrw: number;

  recurringExecutionCount: number;
  conditionalTriggerCount: number;
  conditionalExecutionCount: number;
  conditionalBlockedCount: number;

  budgetExceeded: boolean;

  /**
   * 예산 초과 원인. 판정은 **월 최종 집계**로 한다.
   *  1. 예산 미설정                                        → false / null / false / false
   *  2. recurringInvestmentKrw > 예산                      → true / "recurring_only" / true / false
   *  3. recurring ≤ 예산 && totalInvestmentKrw > 예산      → true / "conditional_action" / false / true
   *  4. total ≤ 예산                                       → false / null / false / false
   */
  budgetExceededCause: BudgetExceededCause;
  recurringAloneExceededBudget: boolean;
  conditionalCausedBudgetExceed: boolean;

  reviewTriggered: boolean;
}

export interface ChartDataPoint {
  date: string;
  closePrice: number;

  eventIds: string[];

  hasRecurringBuy: boolean;
  /** 스키마 §22 확장: 조건 발생과 실제 실행을 차트에서 구분하기 위해 추가. */
  hasConditionalTrigger: boolean;
  hasConditionalBuy: boolean;
  hasBlockedAction: boolean;
  hasBudgetExceeded: boolean;
  hasReviewTrigger: boolean;
}

/** 결과와 함께 기록하는 계산 기준(AGENT_TOOL_CONTRACT §12 "모든 calculation policy를 결과와 함께 기록").
 * §동적 평균 매수가 — 평균 매수가·임계 가격은 더 이상 결과 전체에서 하나로 고정된 값이 아니라
 * 매수가 있을 때마다 바뀐다. 그 값이 필요하면 `SimulationResult.averagePurchasePrice`(마지막
 * 값)나 각 이벤트의 `averageCostBefore`/`averageCostAfter`(그 시점 값)를 본다 — 여기에는
 * 시간에 따라 바뀌지 않는 정책 값만 남긴다. */
export interface AppliedCalculationPolicy {
  policy: SimulationPolicy;
  priceField: "close";
  marketHolidayHandling: "next_trading_day";
  priceDecimals: number;
  percentDecimals: number;
  /**
   * 평균 매수가가 처음 생긴 날(첫 정기 매수 실행일) 그 시점 가격이 이미 임계선 이하인지.
   * trigger 로 세지 않고 초기 상태로만 기록한다. 평균 매수가가 끝내 생기지 않았거나(정기 매수
   * 없이 조건부 매수만 있는 계획) 해당 조건이 없으면 null.
   */
  conditionalInitialState: "above_threshold" | "at_or_below_threshold" | null;
  reviewInitialState: "above_threshold" | "at_or_below_threshold" | null;
}

export interface SimulationResult {
  symbol: string;
  period: DateRange;
  tradingDayCount: number;

  recurringExecutionCount: number;

  conditionalTriggerCount: number;
  conditionalExecutionCount: number;
  conditionalBlockedCount: number;

  totalRecurringInvestmentKrw: number;
  totalConditionalInvestmentKrw: number;
  totalInvestmentKrw: number;

  maxMonthlyInvestmentKrw: number;
  maxMonthlyConditionalExecutionCount: number;

  budgetExceededMonthCount: number;
  /**
   * 예산 초과 개월을 원인별로 분해한다. 불변 조건:
   * `budgetExceededMonthCount === recurringOnlyBudgetExceededMonthCount
   *                            + conditionalCausedBudgetExceededMonthCount`
   */
  recurringOnlyBudgetExceededMonthCount: number;
  conditionalCausedBudgetExceededMonthCount: number;

  reviewTriggeredCount: number;

  maxAdditionalDeclineAfterTriggerPercent: number | null;

  monthlyResults: MonthlySimulationResult[];
  simulationEvents: SimulationEvent[];
  /** 월 예산 때문에 실행하지 않은 매수 — 위 개수·투자금·수량 계산에서 전부 제외돼 있다. */
  budgetSkippedEvents: SkippedBuyEvent[];
  chartSeries: ChartDataPoint[];

  // --- 백테스팅 요약(§사용자 확정) — 실제 매수 이벤트·가격으로만 계산한다. quoteCurrency 가
  // KRW 인 종목에서만 화면에 표시한다(§해외 종목은 환율 근거 없이 평가손익을 만들지 않는다 —
  // 이 필드 자체는 통화와 무관하게 항상 계산되지만, 화면 표시 여부는 UI 레이어가 결정한다).
  totalInvested: number;
  totalQuantity: number;
  endingValue: number;
  profitLoss: number;
  returnRate: number | null;
  averagePurchasePrice: number | null;
  lastClose: number;
  lastTradingDate: string;
  /** 조건부 추가 매수가 있을 때만 값이 있다 — "정기 매수만" 기준과의 비교. */
  backtestComparison: BacktestComparison | null;

  appliedPolicy: AppliedCalculationPolicy;

  engineVersion: string;
  /** 호출자가 주입한다. 주입하지 않으면 null — 엔진은 시스템 시각을 읽지 않는다. */
  calculatedAt: string | null;
}

export interface SimulatePlanInput {
  plan: SimulationPlan;
  policy: SimulationPolicy;
  candles: DailyCandle[];
  /** 주입 전용. 생략하면 결과의 calculatedAt 은 null 이다. */
  calculatedAt?: string;
}

export type SimulationInputErrorCode =
  | "invalid_symbol"
  | "empty_candles"
  | "candles_not_ascending"
  | "duplicate_candle_date"
  | "invalid_candle"
  | "invalid_recurring_amount"
  | "invalid_conditional_amount"
  | "invalid_threshold_percent"
  | "invalid_monthly_budget"
  | "invalid_max_conditional_executions"
  | "invalid_review_drawdown_percent"
  | "review_requires_average_cost";

/** 입력 검증 실패. 엔진은 잘못된 입력을 추정값으로 보정하지 않고 즉시 던진다. */
export class SimulationInputError extends Error {
  readonly code: SimulationInputErrorCode;

  constructor(code: SimulationInputErrorCode, message: string) {
    super(message);
    this.name = "SimulationInputError";
    this.code = code;
  }
}
