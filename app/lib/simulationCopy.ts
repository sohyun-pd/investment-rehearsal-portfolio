/**
 * 시뮬레이션 결과 → 화면 문구.
 *
 * 근거: docs/product/SCREEN_SPEC_V1.md Screen 4, docs/product/build/SIMULATION_ENGINE_SPEC.md §7
 *
 * **예산 초과 원인 문구는 simulation result 에서만 생성한다.** AI 가 원인을 추론하지 않는다.
 * 여기서 새로운 숫자를 만들지 않고 결과 필드를 문장에 끼워 넣기만 한다.
 */
import type { SimulationResult } from "@/domain/simulation";

export function krw(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function times(value: number): string {
  return `${value.toLocaleString("ko-KR")}회`;
}

export function months(value: number): string {
  return `${value.toLocaleString("ko-KR")}개월`;
}

/** 예산 초과 섹션 제목 — 실제로 넘긴 달이 있을 때만 "왜 생겼는지"를 묻는 제목을 쓴다(§재발했던
 * 회귀: 하나도 넘지 않았는데 "예산은 왜 넘었나요?"가 고정으로 표시됨). */
export function budgetSectionHeading(result: SimulationResult): string {
  return result.budgetExceededMonthCount > 0 ? "예산을 넘긴 달은 왜 생겼나요?" : "월 예산 안에서 실행됐어요";
}

/**
 * 예산 초과 원인 문장.
 * Case A(recurring_only) / Case B(conditional_action) / Case C(초과 없음) 를
 * 계산 필드로만 구분한다.
 */
export function budgetCauseSentence(result: SimulationResult): string {
  const { budgetExceededMonthCount: total } = result;
  const recurringOnly = result.recurringOnlyBudgetExceededMonthCount;
  const conditional = result.conditionalCausedBudgetExceededMonthCount;

  if (total === 0) {
    return "정기 매수와 추가 매수를 합해도 월 예산을 넘지 않았어요.";
  }

  const parts: string[] = [];
  if (recurringOnly > 0) {
    parts.push(
      `추가 매수와 관계없이 정기 매수 일정만으로 월 예산을 넘은 달이 ${months(recurringOnly)} 있었어요.`
    );
  }
  if (conditional > 0) {
    parts.push(
      `정기 매수는 월 예산 안이었지만 추가 매수가 실행되면서 예산을 넘은 달이 ${months(conditional)} 있었어요.`
    );
  }
  return parts.join(" ");
}

/** 예산 초과가 정기 매수 주기 때문일 때의 보충 설명. 월별 결과에서 근거를 찾는다. */
export function budgetCauseDetail(result: SimulationResult): string | null {
  if (result.recurringOnlyBudgetExceededMonthCount === 0) return null;

  const sample = result.monthlyResults.find((month) => month.budgetExceededCause === "recurring_only");
  if (sample === undefined) return null;

  return `${sample.month.replace("-", "년 ")}월처럼 정기 매수가 ${times(sample.recurringExecutionCount)} 있는 달에는 ${krw(sample.recurringInvestmentKrw)}이 쓰여요.`;
}

/** 조건 발생이 한 번도 없을 때의 안내. 0 을 "안전"으로 읽지 않게 한다. */
export const NO_TRIGGER_NOTICE =
  "조건이 안전하다는 의미는 아니며, 과거 작동 사례가 부족해 판단이 제한될 수 있어요.";

/** 결과 화면 대표 제목 — 짧고 결정적이다. AI 가 만들지 않는다(§사용자 확정 — "AI 해석" 배지가
 * 붙은 길고 시스템이 생성한 것 같은 문장 대신, replay engine 이 이미 계산한
 * budgetExceededMonthCount 하나만 반영하면 되므로 AI 호출 없이 이 함수가 직접 만든다). */
export function resultHeadline(result: SimulationResult): string {
  return result.budgetExceededMonthCount > 0
    ? `최근 1년 가격에 적용했을 때\n월 예산을 넘긴 달이 ${months(result.budgetExceededMonthCount)} 있었어요`
    : "최근 1년 가격에 적용했을 때\n월 예산을 넘지 않았어요";
}

/** "2025-07-28" → "2025.07.28". 결과 제목 아래 메타 정보 줄 전용 표기(§사용자 확정 예시 —
 * 종목과 기간을 제목 문장에서 분리해 별도 줄로 둔다). */
export function formatMetaDate(isoDate: string): string {
  return isoDate.replaceAll("-", ".");
}

/** 저장된 스냅샷의 마지막 거래일이 "오늘" 기준 이 값(일) 이상 벌어지면 "최근" 이라는 인상을
 * 주는 짧은 문구 대신 실제 기간을 그대로 보여준다(§사용자 확정 — "저장 데이터의 rangeEnd가
 * 현재 기준 최근 영업일과 크게 다르면 `최근 1년 가격`이라고 표시하지 말고 실제 기간을 표시").
 * 평일 기준 정상적인 provider 지연(주말·공휴일 포함)은 길어도 며칠 수준이라, 이보다 훨씬 큰
 * 값을 "명백히 오래됐다"는 기준으로 쓴다. */
const STALE_SNAPSHOT_THRESHOLD_DAYS = 10;

function daysBetween(isoA: string, isoB: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.abs(Date.parse(isoB) - Date.parse(isoA)) / msPerDay;
}

/** 국내(KR) 결과 화면 하단에 낮은 위계로 보여줄 데이터 출처 한 줄(§사용자 확정).
 *  - 실시간 성공: "국내 가격 데이터 · 최근 영업일 종가 기준"
 *  - 폴백(스냅샷)인데 최근 데이터: "저장된 실제 시장 데이터 · {asOfDate} 기준"
 *  - 폴백인데 스냅샷이 오래됨: "{rangeStart}~{rangeEnd} 실제 가격 기준" (예: "2024.07.29~
 *    2025.07.28 실제 가격 기준") — "최근" 이라는 표현으로 오해하게 두지 않는다.
 * todayIso 는 테스트 가능하도록 호출부가 명시적으로 넘긴다(내부에서 `new Date()` 를 부르지
 * 않는다). */
export function krMarketDataDisclosure(
  fallbackUsed: boolean,
  periodFrom: string,
  periodTo: string,
  todayIso: string
): string {
  if (!fallbackUsed) return "국내 가격 데이터 · 최근 영업일 종가 기준";
  if (daysBetween(periodTo, todayIso) > STALE_SNAPSHOT_THRESHOLD_DAYS) {
    return `${formatMetaDate(periodFrom)}~${formatMetaDate(periodTo)} 실제 가격 기준`;
  }
  return `저장된 실제 시장 데이터 · ${formatMetaDate(periodTo)} 기준`;
}

/** 차트 제목 아래 한 줄 요약 — 정기 매수 마커(rail)·조건부 매수 마커(원)가 정확히 몇 개인지
 * 숫자로도 먼저 알려준다(§사용자 확정 — 제목만 보고도 차트가 무엇을 표시하는지 알아야 한다). */
export function chartSummaryLine(result: SimulationResult): string {
  return `정기 매수 ${times(result.recurringExecutionCount)} · 추가 매수 ${times(result.conditionalTriggerCount)}`;
}

/** 조건부 매수(추가 매수) 발생이 0회일 때 차트 바로 아래에 붙이는 짧은 안내 — 임의 마커를
 * 만들지 않는 대신, 차트 아래 세로선(정기 매수)이 무엇인지는 짚어 준다. */
export const NO_CONDITIONAL_CHART_NOTE = "최근 1년 동안 추가 매수 조건은 발생하지 않았어요.";
export const RECURRING_RAIL_EXPLAINER = "매수점을 누르면 날짜와 금액을 확인할 수 있어요.";

/** 추가 하락 표시. null 은 0% 가 아니라 "계산할 수 없음"이다. */
export function additionalDeclineText(result: SimulationResult): string {
  const value = result.maxAdditionalDeclineAfterTriggerPercent;
  if (value === null) return "계산할 수 없음";
  return `${value.toFixed(2)}%`;
}

/** 데이터 기준 한 줄. */
export function basisLine(result: SimulationResult): string {
  return `${result.period.from} ~ ${result.period.to} · ${result.tradingDayCount.toLocaleString("ko-KR")} 거래일`;
}

// ---------------------------------------------------------------------------
// 백테스팅 결과 문구(§사용자 확정 — "사용자가 말한 투자 규칙을 실제 과거 가격에 적용한
// 백테스팅 결과" 중심으로 결과 화면을 재구성. 2차 개편에서 문구·순서를 사용자가 준 그대로
// 고정했다 — 이 파일은 아래 문구를 임의로 다시 쓰지 않는다). 숫자는 전부 SimulationResult 의
// 결정적 계산 값을 그대로 문장에 끼워 넣기만 한다 — AI 도, 이 파일도 새 숫자를 만들지 않는다.
// "예상 수익률"·"AI 수익 예측" 같은 표현은 쓰지 않는다.
// ---------------------------------------------------------------------------

type PriceCurrency = "USD" | "KRW";

/** "$5,200,000" — 소수점은 실제 값이 있을 때만(최대 2자리). */
function formatUsdUnsigned(value: number): string {
  return `$${Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** "+$5,200" / "-$5,200" / "$0". */
function formatUsdSigned(value: number): string {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatUsdUnsigned(value)}`;
}

/** 부호 없는 금액 — 종목 시세 통화에 맞춰 원/달러를 고른다(§사용자 확정 — "USD라는 이유로
 * 평가수익률과 백테스팅 결과 전체를 숨기지 마세요"). 실제 환율 변환은 하지 않는다 — 이미
 * 계산된 같은 숫자를 통화 기호만 바꿔 보여준다. */
export function formatMoney(value: number, currency: PriceCurrency): string {
  return currency === "KRW" ? krw(Math.round(value)) : formatUsdUnsigned(value);
}

/** "+530,000원" / "-530,000원" / "0원". */
export function formatSignedKrw(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toLocaleString("ko-KR")}원`;
}

/** 부호 있는 금액 — 통화에 맞춰 원/달러를 고른다. */
export function formatSignedMoney(value: number, currency: PriceCurrency): string {
  return currency === "KRW" ? formatSignedKrw(value) : formatUsdSigned(value);
}

/** "+10.2%" / "-3.4%" / "0.0%". */
export function formatSignedPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : "";
  return `${sign}${Math.abs(rounded).toFixed(1)}%`;
}

/** "0.9%p" — 두 수익률의 차이(퍼센트포인트)를 절댓값으로 보여준다. 방향은 문장의 동사
 * ("높아졌어요"/"낮아졌어요")로 표현한다. */
export function formatPercentPointDiff(value: number): string {
  return `${Math.abs(Math.round(value * 10) / 10).toFixed(1)}%p`;
}

/** 미국주식: "78.2894주"(가상 소수점 수량, 최대 4자리). 국내주식: "2주"(§국내주식 정수 수량
 * 매수 — 소수점 보유가 존재하면 안 된다). 종목 시세 통화로 시장을 구분한다(§사용자 확정 —
 * KRW·KR 시장은 항상 같이 다닌다, 환율 변환이 없는 이 앱에서는 통화 자체가 시장 판단
 * 근거로 안전하다). */
export function formatQuantity(value: number, currency: PriceCurrency): string {
  if (currency === "KRW") return `${Math.round(value).toLocaleString("ko-KR")}주`;
  return `${value.toFixed(4)}주`;
}

/** 값이 없으면(null) 오류 숫자를 만들지 않고 이 문구를 그대로 쓴다(§사용자 확정). */
export const CALC_UNAVAILABLE = "계산할 수 없어요";

// --- [1]~[2] 페이지 제목·핵심 평가손익 --------------------------------------

export const BACKTEST_PAGE_TITLE = "최근 1년 백테스팅 결과";

export function assetMetaLine(companyName: string, symbol: string): string {
  return companyName !== "" ? `${companyName} · ${symbol}` : symbol;
}

export function periodMetaLine(result: SimulationResult): string {
  return `${formatMetaDate(result.period.from)}–${formatMetaDate(result.period.to)} · ${result.tradingDayCount.toLocaleString("ko-KR")}거래일`;
}

export function lastTradingDateLine(result: SimulationResult): string {
  return `${formatMetaDate(result.lastTradingDate)} 종가 기준`;
}

export const PROFIT_LOSS_LABEL = "마지막 날 기준 평가손익";

/** 매수가 하나도 실행되지 않아 계산할 수 없으면(totalInvested=0) 임의의 숫자를 만들지
 * 않는다(§사용자 확정 — "0원 투자에 손익 0원이나 수익률 0%를 표시하지 마세요"). */
export function profitLossValue(result: SimulationResult, currency: PriceCurrency): string {
  if (result.totalInvested === 0) return CALC_UNAVAILABLE;
  return formatSignedMoney(result.profitLoss, currency);
}

/** §국내주식 정수 수량 매수(§사용자 확정 — P0 계산 오류 수정) — 매수 금액으로 국내주식 1주도
 * 살 수 없어 실행된 매수가 하나도 없으면, 그 정확한 이유를 말한다(일반적인 "실행된 매수가
 * 없어 계산할 수 없어요"로 뭉뚱그리지 않는다 — §"UI 문구로 덮지 말고" 원칙과 별개로, 이유가
 * 이미 다르면 다르게 말해야 한다). 정기 매수·조건부 매수 중 실제로 막힌 쪽의 이름으로 말한다. */
export function profitLossUnavailableReason(result: SimulationResult): string | null {
  if (result.totalInvested > 0) return null;
  const insufficientRecurring = result.budgetSkippedEvents.some(
    (e) => e.type === "RECURRING" && e.reason === "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE"
  );
  if (insufficientRecurring) {
    return "설정한 금액으로 1주를 살 수 없어\n정기 매수가 실행되지 않았어요.\n국내주식은 1주 단위로 계산해요.";
  }
  const insufficientConditional = result.budgetSkippedEvents.some(
    (e) => e.type === "CONDITIONAL" && e.reason === "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE"
  );
  if (insufficientConditional) {
    return "설정한 금액으로 1주를 살 수 없어\n추가 매수가 실행되지 않았어요.\n국내주식은 1주 단위로 계산해요.";
  }
  return "실행된 매수가 없어 계산할 수 없어요.";
}

/** 평가손익 바로 아래 한 줄: "평가수익률 {rate} · 총 투자금 {total}". */
export function returnAndInvestedLine(result: SimulationResult, currency: PriceCurrency): string | null {
  if (result.totalInvested === 0) return null;
  const rate = result.returnRate !== null ? formatSignedPercent(result.returnRate) : CALC_UNAVAILABLE;
  return `평가수익률 ${rate} · 총 투자금 ${formatMoney(result.totalInvested, currency)}`;
}

export const BACKTEST_SUPPORTING_LINE = "최근 1년 실제 가격에 이 계획을 적용한 결과예요.";

// --- [3] 주요 지표 -----------------------------------------------------------

export function summaryCountsLine(result: SimulationResult): string {
  return `정기 매수 ${times(result.recurringExecutionCount)} · 추가 매수 ${times(result.conditionalExecutionCount)}`;
}

// --- [5] 조건부 매수 비교 -----------------------------------------------------

export const COMPARISON_SECTION_TITLE = "추가 매수 조건을 적용한 결과";

/** 조건부 매수가 있을 때의 비교 문장 — "정기 매수만" 기준과 비교해 가장 중요한 차이를
 * 자연어로 명확히 설명한다(§사용자 확정 — 중립적으로 숨기지 않는다. "더 좋다"고 추천하지도
 * 않는다). 이 문장은 페이지 대표 메시지가 아니라 비교 섹션 안에서만 쓴다. */
export function comparisonHeadline(result: SimulationResult, currency: PriceCurrency): string {
  if (result.conditionalTriggerCount === 0) {
    return "지난 1년에는 추가 매수 조건이 발생하지 않아\n정기 매수만 한 결과와 같았어요.";
  }
  const comparison = result.backtestComparison;
  if (comparison === null) return "";

  const { profitLossDifference, returnRateDifference } = comparison.difference;

  if (profitLossDifference > 0) {
    if (returnRateDifference !== null && returnRateDifference < 0) {
      return (
        `평가손익은 ${formatMoney(profitLossDifference, currency)} 늘었지만,\n` +
        `투자금 대비 수익률은 ${formatPercentPointDiff(returnRateDifference)} 낮아졌어요.`
      );
    }
    return (
      `지난 1년 가격에 적용했을 때,\n` +
      `추가 매수 조건이 평가손익을 ${formatMoney(profitLossDifference, currency)} 높였어요.`
    );
  }
  if (profitLossDifference < 0) {
    return `추가 매수 조건을 적용했을 때\n평가손익이 ${formatMoney(Math.abs(profitLossDifference), currency)} 낮아졌어요.`;
  }
  return "지난 1년에는 추가 매수 조건이 결과에 차이를 만들지 않았어요.";
}

/** comparisonHeadline 바로 아래에 붙는 보조 설명 — 추가 투자금·평가손익 차이·평가수익률 차이를
 * 항상 함께 보여준다(§사용자 확정 문장 예시 — "추가 매수로 40만 원을 더 투자했고, 마지막 날
 * 평가손익은 7,091원 낮았어요. 평가수익률은 0.3%p 낮아졌어요."). 예산 때문에 일부가 실행되지
 * 않았으면 그 사실도 덧붙인다. 조건이 아예 발생하지 않았으면(대표 메시지가 이미 그 사실을
 * 말하므로) 보조 설명은 없다. */
export function comparisonSupportingLine(result: SimulationResult, currency: PriceCurrency): string | null {
  const comparison = result.backtestComparison;
  if (comparison === null || result.conditionalTriggerCount === 0) return null;

  const { additionalInvested, profitLossDifference, returnRateDifference } = comparison.difference;
  const profitWord = profitLossDifference >= 0 ? "높았어요" : "낮았어요";

  let sentence =
    `추가 매수로 ${formatMoney(additionalInvested, currency)}을 더 투자했고,\n` +
    `마지막 날 평가손익은 ${formatMoney(Math.abs(profitLossDifference), currency)} ${profitWord}`;

  if (returnRateDifference !== null) {
    const rateWord = returnRateDifference >= 0 ? "높아졌어요" : "낮아졌어요";
    sentence += `.\n평가수익률은 ${formatPercentPointDiff(returnRateDifference)} ${rateWord}`;
  } else {
    sentence += ".";
  }

  // §국내주식 정수 수량 매수 — comparison.current.budgetSkippedCount 는 정기+조건부, 월 한도+
  // 1주 가격 미달을 모두 합친 값이라 "월 예산 때문에"라고 단정하면 국내주식에서는 틀린
  // 설명이 된다. 실제 conditional_buy_blocked 이벤트의 사유별로만 센다.
  const conditionalBudgetBlocked = result.simulationEvents.filter(
    (e) => e.type === "conditional_buy_blocked" && e.blockedBy === "monthly_budget"
  ).length;
  const conditionalShareBlocked = result.simulationEvents.filter(
    (e) => e.type === "conditional_buy_blocked" && e.blockedBy === "insufficient_amount_for_one_share"
  ).length;

  if (conditionalBudgetBlocked > 0 || conditionalShareBlocked > 0) {
    const reasons: string[] = [];
    if (conditionalBudgetBlocked > 0) reasons.push(`월 예산 때문에 ${times(conditionalBudgetBlocked)}`);
    if (conditionalShareBlocked > 0) reasons.push(`1주 가격 미달로 ${times(conditionalShareBlocked)}`);
    sentence += `\n\n추가 매수 조건은 ${times(result.conditionalTriggerCount)} 발생했지만,\n${reasons.join(", ")}는 실행되지 않았어요.`;
  }

  return sentence;
}

/** 추가 매수 조건이 한 번도 발생하지 않았을 때 — 핵심 결과 카드가 아니라 별도 영역에 둔다
 * (§사용자 확정). 추상적인 경고는 쓰지 않는다. */
export const CONDITIONAL_NOT_TRIGGERED_TITLE = "최근 1년 동안 추가 매수 조건이 발생하지 않았어요";
export const CONDITIONAL_NOT_TRIGGERED_BODY = "설정한 가격 조건에 해당하는 날이 없어\n추가 매수는 실행되지 않았어요.";

// --- [2.5] 똑대리 한마디 — 결과 요약이 아니라 특징 하나 + 다음 비교 행동만 짧게 -------------

/** §똑대리 한마디 — 화면에 이미 나온 숫자(총 투자금·평가금액·정기 매수 횟수 등)를 다시
 * 읽어주지 않는다. 이번 결과에서 확인되는 가장 눈에 띄는 특징 하나와, 조건을 바꾸면 무엇을
 * 비교할 수 있는지만 정확히 두 문장(70자 내외)으로 고정 문구 중에서 고른다 — AI 호출 없이
 * 결정적으로 판단한다(추천·평가 표현을 절대 쓰지 않기 위해, 그리고 매번 정확히 같은 품질을
 * 보장하기 위해 결정형으로 만든다). */
export function tokdaeriComment(result: SimulationResult, currency: PriceCurrency): string {
  // 0. §국내주식 정수 수량 매수(§사용자 확정 — P0 계산 오류 수정) — 실행된 매수가 하나도
  // 없으면(totalInvested === 0) 평균 매수가 자체가 없다. 아래 profitLoss 기준 분기를 그대로
  // 타면 "마지막 가격이 평균 매수가보다 낮았어요"처럼 실제로 없던 매수·하락을 지어낸 것처럼
  // 읽힌다 — 반드시 이 분기보다 먼저 걸러낸다. 화면 위쪽에 이미 나온 이유 문장
  // (profitLossUnavailableReason)을 그대로 반복하지 않고, 다음 행동만 짧게 안내한다.
  if (result.totalInvested === 0) {
    return "설정한 금액으로는 매수가 실행되지 않았어요.\n금액을 늘리면 같은 기간에서 결과를 비교해볼 수 있어요.";
  }

  // backtestComparison 은 조건부 매수가 있을 때만 계산된다(§엔진 — "조건부 추가 매수가 있을
  // 때만 계산한다") — 별도 플래그 없이 이 값의 존재 여부만으로 조건부 매수 설정 여부를 안다.
  const hasConditionalBuy = result.backtestComparison !== null;

  // 1. 추가 매수 조건은 발생했지만 월 한도 때문에 일부가 실행되지 않은 경우 — 가장 구체적인
  //    특징이라 우선 안내한다.
  if (hasConditionalBuy && result.backtestComparison !== null && result.backtestComparison.current.budgetSkippedCount > 0) {
    return (
      "월 투자 한도로 일부 추가 매수가 실행되지 않았어요.\n" +
      "한도를 바꾸면 같은 조건에서 결과가 어떻게 달라지는지 확인할 수 있어요."
    );
  }

  // 2. 추가 매수 조건을 설정했지만 이번 기간에는 한 번도 발생하지 않은 경우.
  if (hasConditionalBuy && result.conditionalTriggerCount === 0) {
    return (
      "이번 기간에는 설정한 하락 조건이 발생하지 않았어요.\n" +
      "기준을 낮추면 같은 기간에서 추가 매수 효과를 비교할 수 있어요."
    );
  }

  // 3. 추가 매수가 실제로 실행됐다 — 손익·수익률이 같은 방향인지 다른 방향인지가 특징이다.
  if (hasConditionalBuy && result.conditionalTriggerCount > 0 && result.backtestComparison !== null) {
    const { profitLossDifference, returnRateDifference } = result.backtestComparison.difference;
    if (profitLossDifference > 0 && (returnRateDifference === null || returnRateDifference >= 0)) {
      return (
        "추가 매수한 구간이 이후 상승으로 이어지며 수익률도 함께 높아졌어요.\n" +
        "다만 늘어난 투자금까지 함께 비교해보세요."
      );
    }
    if (profitLossDifference > 0 && returnRateDifference !== null && returnRateDifference < 0) {
      return (
        "평가손익은 늘었지만 투자금이 더 크게 증가해 수익률은 낮아졌어요.\n" +
        "수익 금액과 투자 효율을 함께 볼 필요가 있어요."
      );
    }
    // 3-1. 수익률은 높아졌지만(추가 매수분의 투자 효율 자체는 좋았지만), 늘어난 투자금
    //      때문에 평가손익(또는 평가손실) 절대 금액은 더 커진 경우 — 가장 헷갈리기 쉬운
    //      트레이드오프라 정확한 방향과 실제 델타로만 짚어준다(§사용자 확정 — "좋은 전략"·
    //      "합리적"·"추천" 같은 평가 언어 금지, 새 숫자 계산 금지, 화면 표시값과 반올림 일치).
    if (profitLossDifference < 0 && returnRateDifference !== null && returnRateDifference > 0) {
      const isLoss = result.backtestComparison.current.profitLoss < 0;
      const amountLabel = isLoss ? "평가손실은" : "평가손익은";
      const amountWord = isLoss ? "더 커졌어요" : "더 낮아졌어요";
      return (
        `추가 매수로 수익률은 ${formatPercentPointDiff(returnRateDifference)} 높아졌지만,\n` +
        `투자금이 늘어 ${amountLabel} ${formatMoney(Math.abs(profitLossDifference), currency)} ${amountWord}`
      );
    }
    return (
      "추가 매수가 이번 결과 개선으로 이어지지 않았어요.\n" +
      "조건을 조정해 같은 기간에서 다시 비교해볼 수 있어요."
    );
  }

  // 4. 추가 매수 조건 자체를 설정하지 않은 계획 — 정기 매수만으로 난 결과의 방향이 특징이다.
  if (result.profitLoss > 0) {
    return (
      "이번 1년은 정기 매수만으로도 수익이 크게 난 구간이었어요.\n" +
      "추가 매수 조건을 넣으면 같은 기간에서 결과 차이를 확인할 수 있어요."
    );
  }
  return (
    "정기적으로 나눠 샀지만 마지막 가격이 평균 매수가보다 낮았어요.\n" +
    "매수 주기나 추가 매수 조건을 바꿔 같은 기간에서 다시 비교할 수 있어요."
  );
}

// --- [6] 월 한도 보조 정보 ----------------------------------------------------

/** §실행 자체를 막는 제약으로 바뀌었으므로 "예산 초과 0개월"처럼 항상 0인 값은 화면에
 * 보여주지 않는다(§사용자 확정) — 대신 몇 번 건너뛰었는지로만 말한다.
 *
 * §국내주식 정수 수량 매수 — "월 투자 한도 때문에 실행되지 않은 경우와 1주 가격보다 금액이
 * 낮아 실행되지 않은 경우를 구분하세요"(§사용자 확정). 두 사유를 합쳐 "월 한도로"라고
 * 뭉뚱그리면 국내주식에서는 원인을 잘못 설명하게 된다. */
export function monthlyLimitTitle(result: SimulationResult): string {
  const budgetSkipped = result.budgetSkippedEvents.filter((e) => e.reason === "MONTHLY_BUDGET_EXCEEDED").length;
  const shareSkipped = result.budgetSkippedEvents.filter(
    (e) => e.reason === "INSUFFICIENT_AMOUNT_FOR_ONE_SHARE"
  ).length;

  if (budgetSkipped === 0 && shareSkipped === 0) return "월 한도 안에서 모두 실행됐어요";
  if (shareSkipped === 0) return `월 한도로 ${budgetSkipped.toLocaleString("ko-KR")}번의 매수가 실행되지 않았어요`;
  if (budgetSkipped === 0) return `1주 가격 미달로 ${shareSkipped.toLocaleString("ko-KR")}번의 매수가 실행되지 않았어요`;
  return `월 한도·1주 가격 미달로 ${(budgetSkipped + shareSkipped).toLocaleString("ko-KR")}번의 매수가 실행되지 않았어요`;
}

export const MONTHLY_LIMIT_SUPPORTING_LINE = "실행 순서대로 월 투자금에 반영했어요.";

/** 월 한도 스킵이 몇 개의 달에 영향을 줬는지 — 새 숫자를 만들지 않고 실제 스킵 이벤트의
 * 날짜에서 월만 뽑아 센다. */
export function affectedMonthCount(result: SimulationResult): number {
  return new Set(result.budgetSkippedEvents.map((e) => e.date.slice(0, 7))).size;
}

// --- [7] 세부 내역과 계산 가정 ------------------------------------------------

export const SHOW_MONTHLY_HISTORY_LABEL = "월별 투자 내역 보기";
export const SHOW_ALL_BUYS_LABEL = "전체 매수 내역 보기";
export const SHOW_ASSUMPTIONS_LABEL = "계산 기준 보기";

/** 계산 가정 — 사용자가 준 문구를 그대로 쓴다(§사용자 확정, 임의로 다시 쓰지 않는다). */
export const BACKTEST_ASSUMPTIONS: readonly string[] = [
  "가상 소수점 수량으로 계산했어요.",
  "거래 수수료와 세금은 반영하지 않았어요.",
  "배당과 슬리피지는 반영하지 않았어요.",
  "매수일의 종가를 기준으로 계산했어요.",
  "월 한도를 넘는 매수는 실행하지 않았어요.",
  "과거 가격에 적용한 결과이며 미래 수익을 예측하지 않아요.",
];

/** 해외(USD) 종목 — 환율 변환 없이 원래 숫자를 달러 기호로만 보여준다는 안내(§사용자 확정 —
 * "모든 금액은 USD 기준이에요. 환율을 반영한 원화 환산 금액은 제공하지 않아요."). */
export const USD_BASIS_NOTICE = "모든 금액은 USD 기준이에요.\n환율을 반영한 원화 환산 금액은 제공하지 않아요.";

// ---------------------------------------------------------------------------
// 계산 중 진행 상태(§사용자 확정) — ChatGPT 처럼 현재 단계 문구 하나만 보여주고 교체한다.
// 문구를 임의로 다시 쓰지 않는다. 실제 비동기 처리 단계와 연결한다(가짜 타이머로 진행률을
// 만들지 않는다) — 각 단계 사이 최소 표시 시간만 소비자(FlowProvider)가 보장한다.
// ---------------------------------------------------------------------------

export const PROCESSING_STEPS: readonly string[] = [
  "계획을 확인했어요",
  "최근 1년 실제 가격을 불러오고 있어요",
  "매수 시점을 계산하고 있어요",
  "평가손익과 수익률을 계산하고 있어요",
  "결과를 정리하고 있어요",
];

export const PROCESSING_DONE_MESSAGE = "계산이 끝났어요.\n결과를 보여드릴게요.";
