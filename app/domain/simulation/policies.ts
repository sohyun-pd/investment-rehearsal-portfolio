/**
 * 시뮬레이션 계산 정책 상수와 고정 반올림 규칙.
 *
 * 원래 계획 분석과 조정안 분석은 **같은 엔진 + 다른 정책**으로 처리한다.
 * 정책을 코드에 분기로 심지 않고 값으로 주입하는 이유는, 결과에 어떤 정책이
 * 적용됐는지 그대로 기록해야 하기 때문이다(AGENT_TOOL_CONTRACT §12).
 */
import type { SimulationPolicy } from "./types";

// §국내주식 정수 수량 매수(§사용자 확정 — P0 계산 오류 수정) — 국내주식 매수 수량 계산이
// 바뀌어 버전을 올린다. 이 값은 화면 표시용일 뿐 캐시 무효화 게이트로 쓰이지 않는다 —
// 시뮬레이션 결과 자체를 저장·복원하지 않으므로(app/session/planStorage.ts, "candles·quote·
// simulation·alternatives 는 저장하지 않는다") 매번 최신 엔진으로 새로 계산된다.
export const ENGINE_VERSION = "simulation-engine-1.1.0";

/** 조건 발생 후 관찰하는 거래일 수. */
export const POST_TRIGGER_OBSERVATION_DAYS = 20;

/** 가격 반올림 자릿수. Twelve Data 일봉이 소수점 6자리까지 오므로 동일하게 고정한다. */
export const PRICE_DECIMALS = 6;

/** 퍼센트 반올림 자릿수. */
export const PERCENT_DECIMALS = 2;

/**
 * 원래 계획 분석 정책.
 * 위험을 드러내는 것이 목적이므로 막지 않고 표시한다.
 */
export const ORIGINAL_PLAN_POLICY: SimulationPolicy = {
  monthlyBudgetBehavior: "allow_and_flag",
  reviewTriggerBehavior: "flag_only",
  conditionalTriggerMode: "crossing",
  sameDayEventOrder: "recurring_first",
  postTriggerObservationDays: POST_TRIGGER_OBSERVATION_DAYS,
};

/**
 * 조정안 분석 정책.
 * 사용자가 정한 안전장치가 실제로 작동했을 때의 결과를 본다.
 */
export const ADJUSTED_PLAN_POLICY: SimulationPolicy = {
  monthlyBudgetBehavior: "block_action_when_exceeded",
  reviewTriggerBehavior: "pause_future_conditional_actions",
  conditionalTriggerMode: "crossing",
  sameDayEventOrder: "recurring_first",
  postTriggerObservationDays: POST_TRIGGER_OBSERVATION_DAYS,
};

/** 고정 반올림. 부동소수 잔여값이 결과에 새지 않게 모든 파생 수치에 적용한다. */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  // Math.round(-0.5) 는 -0 이 되므로 +0 으로 정규화한다(결정성 확보).
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/**
 * 기준가에서 하락률만큼 내린 가격.
 * `avg * (1 - p/100)` 대신 `avg * (100 - p) / 100` 을 쓰는 이유는 부동소수 오차가 작기 때문이다.
 */
export function priceAtDrawdown(referencePrice: number, drawdownPercent: number): number {
  return roundTo((referencePrice * (100 - drawdownPercent)) / 100, PRICE_DECIMALS);
}

/** YYYY-MM-DD → YYYY-MM. */
export function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}
