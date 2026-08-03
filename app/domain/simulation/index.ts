/**
 * 시뮬레이션 엔진 공개 API.
 *
 * 이 디렉터리 밖에서는 이 파일만 import 한다.
 * 엔진은 순수 계산만 담당한다 — 외부 API 호출·시스템 시각 읽기·UI 의존성 없음.
 */
export { simulatePlan, validateSimulationInput } from "./simulatePlan";
export {
  ADJUSTED_PLAN_POLICY,
  ENGINE_VERSION,
  ORIGINAL_PLAN_POLICY,
  PERCENT_DECIMALS,
  POST_TRIGGER_OBSERVATION_DAYS,
  PRICE_DECIMALS,
  monthKeyOf,
  priceAtDrawdown,
  roundTo,
} from "./policies";
export {
  hasExecutableKrRecurringBuy,
  scheduleRecurring,
  type RecurringExecution,
} from "./scheduleRecurring";
export {
  detectThresholdCrossings,
  type CrossingDetection,
  type ThresholdCrossing,
  type ThresholdInitialState,
} from "./detectConditionalCrossings";
export {
  calculatePostTriggerDecline,
  maxAdditionalDeclinePercent,
  type PostTriggerDecline,
} from "./calculatePostTriggerDecline";
export { buildChartSeries } from "./buildChartSeries";
export {
  WEEKDAY_LABEL,
  WEEKEND_ALIASES,
  WEEKEND_REJECTION_MESSAGE,
  normalizeWeekdayInput,
  type WeekdayNormalizeResult,
} from "./weekdayAlias";
export {
  DAY_OF_MONTH_LABEL,
  DAY_OF_MONTH_OPTIONS,
  normalizeDayOfMonthInput,
  type DayOfMonthNormalizeResult,
} from "./dayOfMonthAlias";
export {
  SimulationInputError,
  type AppliedCalculationPolicy,
  type BlockedReason,
  type BudgetExceededCause,
  type BudgetExceededEvent,
  type ChartDataPoint,
  type ConditionalBuyEvent,
  type ConditionalTriggerEvent,
  type DailyCandle,
  type DateRange,
  type DayOfMonth,
  type Market,
  type MonthlySimulationResult,
  type RecurringBuyEvent,
  type RecurringRule,
  type SimulatePlanInput,
  type SimulationEvent,
  type SimulationInputErrorCode,
  type SimulationPlan,
  type SimulationPolicy,
  type SimulationResult,
  type SkippedBuyEvent,
  type Weekday,
} from "./types";
