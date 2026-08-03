# Simulation Engine Spec

AI Investment Plan Copilot 의 순수 TypeScript 시뮬레이션 엔진 명세.

- 구현 위치: `app/domain/simulation/`
- 공개 API: `app/domain/simulation/index.ts`
- 엔진 버전: `simulation-engine-1.0.0`
- 근거 계약: [`AGENT_TOOL_CONTRACT.md`](./AGENT_TOOL_CONTRACT.md) §12–13,
  [`STRATEGY_SCHEMA_V2.md`](../STRATEGY_SCHEMA_V2.md) §17–22
- 데이터 검증: [`TECH_SPIKE_2B_RESULT.md`](../../../spikes/historical-market-data-twelve-data/TECH_SPIKE_2B_RESULT.md),
  [`ADJUSTMENT_CHECK_RESULT.md`](../../../spikes/historical-market-data-twelve-data/ADJUSTMENT_CHECK_RESULT.md)

> 문서 위치: 과제에서는 `06_Build/SIMULATION_ENGINE_SPEC.md` 로 지정됐으나, 이 저장소의
> build 문서는 `docs/product/build/` 에 모여 있어 같은 폴더에 두었다.

---

## 0. 이 엔진이 계산하는 것: Historical Condition Replay

정식 백테스트가 아니다. **최근 1년 가격에 현재 조건을 적용해 조건 발생 시점과 모의 실행
이벤트를 확인**하는 과거 조건 시뮬레이션이다.

```text
사용자가 입력한 평균 매수가를 고정 기준으로 사용해
최근 가격에서 조건 발생 시점을 확인합니다.
실제 체결 수량, 환율, 평균 매수가 변화는 반영하지 않습니다.
```

구현하지 않는 것: 실제 주식 수량 · 환율 · 동적 평균 매수가 · 실제 체결 · 투자 수익률.

그래서 "이 전략을 1년 동안 실행했다면", "실제 투자 성과", "백테스트 수익률",
"실제 매수 결과", "수익성 검증" 같은 표현을 쓰지 않는다. 대신 "최근 1년 가격에 현재 조건을
적용하면", "조건 발생 시점", "모의 실행 이벤트" 로 쓴다.

---

## 1. 원칙

- 엔진은 **순수 함수**다. 외부 API 를 호출하지 않고, 시스템 현재 시각을 읽지 않는다.
- `calculatedAt` 을 제외하면 **동일 입력 → 동일 출력**이다.
- 잘못된 입력을 기본값으로 보정하지 않는다. `SimulationInputError` 로 즉시 실패한다.
- MVP 범위에서 **하지 않는 것**: 환율 변환, 주식 수량 계산, 수익률 계산, 평균 매수가 갱신,
  실제 주문. 가짜 환율이나 가짜 수량을 만들지 않는다.
- 계산 기준을 숨기지 않는다. 적용된 정책과 파생 가격을 결과(`appliedPolicy`)에 함께 담는다.

---

## 2. 입력

### SimulationPlan

```typescript
type SimulationPlan = {
  symbol: string;

  recurring: {
    frequency: "weekly";
    weekday: "monday";
    amountKrw: number;
  } | null;

  conditionalBuy: {
    averageCostUsd: number;      // 고정 기준가 (갱신하지 않음)
    thresholdPercent: number;
    amountKrw: number;
  } | null;

  guardrails: {
    monthlyBudgetKrw: number | null;
    maxConditionalExecutionsPerMonth: number | null;
    reviewDrawdownPercent: number | null;
  };
};
```

### SimulationPolicy

```typescript
type SimulationPolicy = {
  monthlyBudgetBehavior: "allow_and_flag" | "block_action_when_exceeded";
  reviewTriggerBehavior: "flag_only" | "pause_future_conditional_actions";
  conditionalTriggerMode: "crossing";
  sameDayEventOrder: "recurring_first";
  postTriggerObservationDays: 20;
};
```

정책 상수 (`policies.ts`):

| 상수 | monthlyBudgetBehavior | reviewTriggerBehavior | 용도 |
| --- | --- | --- | --- |
| `ORIGINAL_PLAN_POLICY` | `allow_and_flag` | `flag_only` | 원래 계획 분석 — 위험을 드러내는 것이 목적이므로 막지 않고 표시 |
| `ADJUSTED_PLAN_POLICY` | `block_action_when_exceeded` | `pause_future_conditional_actions` | 조정안 분석 — 안전장치가 실제로 작동한 결과를 확인 |

**같은 엔진 + 다른 정책**으로 두 분석을 수행한다. 정책을 코드 분기로 심지 않고 값으로 주입하는
이유는, 어떤 정책이 적용됐는지 결과에 그대로 기록해야 하기 때문이다.

### 호출 시그니처

```typescript
simulatePlan({
  plan: SimulationPlan,
  policy: SimulationPolicy,
  candles: DailyCandle[],
  calculatedAt?: string,   // 주입 전용. 생략하면 결과의 calculatedAt 은 null
}): SimulationResult
```

### 데이터 기준

- `candles` 는 **날짜 오름차순**이며 중복·invalid 는 adapter 단계에서 제거된 상태로 들어온다.
  엔진은 이를 신뢰하지 않고 재검증한다(위반 시 오류).
- **split-adjusted OHLC** 를 사용한다 (`adjust=splits`, 실제 검증 완료).
- **dividend adjustment 는 사용하지 않는다.**
- 가격 판단·모의 체결은 **일별 종가(`close`)만** 사용한다. intraday high/low 를 쓰지 않는다.
- inclusive 종료일 → exclusive API `end_date` 변환은 **adapter 책임**이다. 엔진은 이미 확정된
  candle 배열만 받는다.

### 입력 검증

| 오류 코드 | 조건 |
| --- | --- |
| `invalid_symbol` | `symbol` 이 빈 문자열 |
| `empty_candles` | `candles` 가 빈 배열 |
| `candles_not_ascending` | 날짜가 오름차순이 아님 |
| `duplicate_candle_date` | 날짜 중복 |
| `invalid_candle` | `close` 가 0 이하이거나 유한수가 아님 |
| `invalid_recurring_amount` | `recurring.amountKrw` ≤ 0 또는 비유한수 |
| `invalid_conditional_amount` | `conditionalBuy.amountKrw` ≤ 0 또는 비유한수 |
| `invalid_average_cost` | `averageCostUsd` ≤ 0 또는 비유한수 |
| `invalid_threshold_percent` | `thresholdPercent` ≤ 0 또는 ≥ 100 또는 비유한수 |
| `invalid_monthly_budget` | `monthlyBudgetKrw` 가 null 이 아니면서 ≤ 0 |
| `invalid_max_conditional_executions` | 정수가 아니거나 음수 |
| `invalid_review_drawdown_percent` | ≤ 0 또는 ≥ 100 |
| `review_requires_average_cost` | `reviewDrawdownPercent` 는 있는데 `conditionalBuy` 가 없음 |

`thresholdPercent` 상한을 100 미만으로 두는 이유: 100 이상이면 임계 가격이 0 이하가 되어
어떤 종가로도 도달할 수 없다. 0 이면 기준가 자체가 임계선이 된다.

`review_requires_average_cost`: 재검토 조건은 `averageCostUsd` 대비 하락률이므로 기준가 없이는
평가할 수 없다. 조용히 건너뛰지 않고 명시적으로 실패한다.

---

## 3. 출력

```typescript
type SimulationResult = {
  symbol: string;
  period: DateRange;
  tradingDayCount: number;

  recurringExecutionCount: number;

  conditionalTriggerCount: number;      // 가격 조건이 발생한 횟수
  conditionalExecutionCount: number;    // 안전장치 적용 후 실제 실행된 횟수
  conditionalBlockedCount: number;      // 조건은 발생했으나 차단된 횟수

  totalRecurringInvestmentKrw: number;
  totalConditionalInvestmentKrw: number;
  totalInvestmentKrw: number;

  maxMonthlyInvestmentKrw: number;
  maxMonthlyConditionalExecutionCount: number;

  budgetExceededMonthCount: number;
  recurringOnlyBudgetExceededMonthCount: number;
  conditionalCausedBudgetExceededMonthCount: number;

  reviewTriggeredCount: number;

  maxAdditionalDeclineAfterTriggerPercent: number | null;

  monthlyResults: MonthlySimulationResult[];
  simulationEvents: SimulationEvent[];
  chartSeries: ChartDataPoint[];

  appliedPolicy: AppliedCalculationPolicy;

  engineVersion: string;
  calculatedAt: string | null;
};
```

`conditionalTriggerCount` = `conditionalExecutionCount` + `conditionalBlockedCount` 가 항상 성립한다.

`reviewTriggeredCount` 는 crossing 으로 발생한 재검토와 첫 candle initial breach(§9)를 모두
포함한다.

`budgetExceededMonthCount === recurringOnlyBudgetExceededMonthCount +
conditionalCausedBudgetExceededMonthCount` 가 항상 성립한다(§7).

### 결정성

`calculatedAt` 은 **호출자가 주입**한다. 주입하지 않으면 `null` 이다. 엔진이 시스템 시각을
읽지 않으므로 테스트에서 결과 전체를 그대로 비교할 수 있다.

### 반올림

| 대상 | 자릿수 |
| --- | --- |
| 파생 가격 (trigger price, review price) | 소수점 6자리 (`PRICE_DECIMALS`) |
| 퍼센트 (추가 하락) | 소수점 2자리 (`PERCENT_DECIMALS`) |
| KRW 금액 | 입력값의 정수 합계 — 별도 반올림 없음 |

파생 가격은 `reference × (100 - percent) / 100` 로 계산한다. `reference × (1 - percent/100)` 보다
부동소수 오차가 작다.

### 스키마 이름 대응

`STRATEGY_SCHEMA_V2.md` §18–22 는 금액을 `MoneyAmount` 객체로, 요약을 `summary` 중첩으로 둔다.
엔진은 이번 단계 과제 명세에 맞춰 **평탄한 `...Krw` 숫자 필드**를 쓴다. adapter 에서 매핑한다.

| 엔진 필드 | 스키마 필드 |
| --- | --- |
| `totalRecurringInvestmentKrw` | `summary.totalRecurringInvestment: MoneyAmount` |
| `totalConditionalInvestmentKrw` | `summary.totalConditionalInvestment` |
| `maxMonthlyInvestmentKrw` | `summary.maxMonthlyInvestment` |
| `simulationEvents` | `events` |
| `event.amountKrw` | `event.amount: MoneyAmount` |
| `chartSeries[].hasConditionalTrigger` | (엔진 확장 — 조건 발생과 실행을 차트에서 구분) |

`app/types/strategy.ts` 의 V1 타입은 동적 평균 매수가·주문 수량을 전제하므로 재사용하지 않고
엔진 전용 타입을 정의했다.

---

## 4. 이벤트 처리 순서

`sameDayEventOrder: "recurring_first"`. 각 거래일에 다음 순서로 처리한다.

```text
1. 정기 매수 해당일 확인 → 실행 → 월 집계 반영 → 예산 초과 확인
2. 재검토(review drawdown) 조건 평가 → review_triggered 기록
                                    → (pause 정책이면) 즉시 정지 설정
3. 조건부 매수 crossing 평가 → conditional_triggered 기록
4. 차단 사유 확인 (재검토 정지 → 월 실행 횟수 → 월 예산)
   → 조건부 실행 또는 차단 → 월 집계 반영 → 예산 초과 확인
5. 월별 집계 저장
```

**재검토 평가가 조건부 매수보다 먼저 온다.** 사용자 계약이
"재검토 조건이 발생하면 **추가 매수 전에** 계획을 다시 확인한다"이기 때문이다.
조건부 매수를 먼저 처리하면 `pause_future_conditional_actions` 정책에서도 재검토 발생일의
추가 매수가 그대로 실행되어 계약과 어긋난다.
`AGENT_TOOL_CONTRACT` §12 의 Calculation Order 도 이 순서로 갱신했다(두 문서 일치).

평균 매수가 갱신 단계(§12 의 3번)는 고정 기준가 정책이므로 **수행하지 않는다**.

정기 매수는 이 순서 변경과 무관하게 **항상 실행된다**. 재검토는 추가 매수 판단을 멈추게 하는
장치이고, 적립식 매수를 멈추는 장치가 아니다.

### 이벤트 타입

| 타입 | 발생 시점 |
| --- | --- |
| `recurring_buy_executed` | 정기 매수 실행 (`scheduledDate`, `rolledForward` 포함) |
| `monthly_budget_exceeded` | 금액 분해(`recurringInvestmentKrw`/`conditionalInvestmentKrw`), `cause`, `triggeredByEventId` 포함 (§7) |
| `conditional_triggered` | 가격 조건 발생 (실행 여부와 무관하게 항상 기록) |
| `conditional_buy_executed` | 조건부 매수 실행 (`monthlyExecutionIndex` 포함) |
| `conditional_buy_blocked` | 안전장치로 차단 (`blockedBy`: `monthly_budget` \| `monthly_execution_limit` \| `review_trigger`) |
| `monthly_budget_exceeded` | 해당 월 누적 투자금이 예산을 처음 넘은 시점 (월 1회) |
| `review_triggered` | 재검토 조건 도달 (`initialState: boolean`, `previousClose: number \| null`) |

`conditional_buy_blocked` 는 **conditional crossing 이 발생한 날에만** 만든다. 정지 상태라도
그 날 조건이 발생하지 않았다면 차단 이벤트를 만들지 않는다. 차단은 "발생한 조건을 막았다"는
기록이지 "정지 중"이라는 상태 표시가 아니다.

이벤트 id 는 발생 순서대로 `evt_0001` 형식이며 결정적이다. `chartSeries[].eventIds` 가 이 id 를
참조하고, 모든 이벤트는 정확히 한 차트 포인트에 연결된다.

`conditional_triggered` 는 조건이 발생한 모든 날짜에 기록된다. 차단된 경우에도 남는다 —
"조건은 발생했지만 안전장치가 막았다"를 UI 에서 설명하기 위해서다.

---

## 5. 고정 평균 매수가 정책

**`averageCostUsd` 는 사용자가 입력한 값으로 고정되며 시뮬레이션 내내 갱신되지 않는다.**

이유: MVP 는 주문 금액이 KRW, 주가가 USD 인데 환율과 실제 매수 수량을 계산하지 않는다.
수량을 모르면 가중평균 매수가를 계산할 수 없다. 여기서 임의의 환율이나 수량을 가정하면
사용자에게 근거 없는 숫자를 보여주게 되므로, 갱신을 아예 하지 않는다.

- 정기 매수·추가 매수가 발생해도 기준가는 그대로다.
- 모든 이벤트에서 `averageCostBefore === averageCostAfter === averageCostUsd` 다.
  (이벤트 스트림 자체가 "갱신하지 않았다"는 사실을 증언하도록 두 필드를 남긴다)
- `appliedPolicy.averageCostUpdated === false` 로 결과에 명시된다.
- 조건부 매수와 재검토 조건은 **같은 고정 기준가**를 참조한다.

이 정책은 UI(Process 페이지 등)에 반드시 표시해야 한다 — 계산 기준을 숨기지 않는다.

---

## 6. crossing 및 re-arm 정책

`conditionalTriggerMode: "crossing"`. 임계 가격:

```text
triggerPrice = averageCostUsd × (100 - thresholdPercent) / 100
```

예: 평균 매수가 320 USD, 하락 조건 3% → trigger price 310.40 USD

판정 규칙 — **단 하나**:

```text
이전 거래일 종가 > triggerPrice  AND  현재 거래일 종가 <= triggerPrice
```

이 규칙 하나로 요구사항 세 개가 동시에 만족된다.

| 요구사항 | 동작 |
| --- | --- |
| 반복 trigger 금지 | 임계선 아래에 머물면 이전 종가도 아래이므로 조건 불성립 |
| re-arm | 종가가 임계선 위로 회복하면 다음 하락에서 자동으로 조건 성립 |
| 첫 candle 예외 | 비교할 이전 거래일이 없어 trigger 하지 않음 |

첫 candle 이 이미 임계선 이하이면 trigger 하지 않고 초기 상태로만 기록한다:
`appliedPolicy.conditionalInitialState = "at_or_below_threshold"`.

별도의 `armed` 플래그를 두지 않는다. 상태 변수와 비교 규칙이 갈라지면 두 곳을 동시에 맞춰야
하는데, 이전 종가 비교만으로 이미 동일한 결과가 나온다.

### 첫 candle 정책이 조건부 매수와 재검토에서 다른 이유

같은 crossing 규칙을 쓰지만 **첫 candle 처리만 다르다.**

| | 첫 candle 이 이미 임계선 이하일 때 |
| --- | --- |
| 조건부 매수 | trigger 하지 않는다. 초기 상태로만 기록 |
| 재검토 | `review_triggered` 를 발생시킨다 (`initialState: true`) |

두 조건이 답하는 질문이 다르기 때문이다.

- 조건부 매수는 **"지금 새로 사야 하는가"** 를 묻는다. 근거는 "기준가에서 N% 내려오는 사건"이다.
  관찰 시작 시점에 이미 아래에 있었다면 그 하락은 관찰 구간 안에서 일어난 사건이 아니다.
  이걸 매수 신호로 세면, 데이터 시작일을 언제로 잡느냐에 따라 매수 횟수가 달라진다.
- 재검토는 **"계획을 다시 봐야 하는 상태인가"** 를 묻는다. 사건이 아니라 **상태**다.
  손실이 시작 전에 발생했든 관찰 중에 발생했든, 지금 기준가 대비 N% 아래라면 추가 매수 전에
  확인이 필요한 상태는 똑같다. 시작 시점부터 물려 있는 계획을 "재검토 사유 없음"으로 넘기면
  안전장치가 가장 필요한 경우를 놓친다.

첫 candle 이 재검토 기준 **위**에 있으면 이후에는 일반 crossing 방식으로 탐지한다.
`initialState` 는 첫 candle 침범으로 발생한 이벤트만 `true` 이고, crossing 으로 발생한
이벤트는 `false` 다. `initialState: true` 인 이벤트는 비교할 이전 거래일이 없으므로
`previousClose` 가 `null` 이다.

---

## 7. 월 예산 처리

월 투자 금액 = 해당 월의 **recurring amount + conditional amount** (KRW 현금 금액 합계).

- 월 구분은 `date.slice(0, 7)` (`YYYY-MM`) 이다.
- `monthlyResults` 는 candles 에 실제로 존재하는 월만 포함한다(없는 달을 합성하지 않는다).
- **정기 매수는 월 예산으로 차단하지 않는다.** 월 예산 차단은 conditional action 에만 적용한다.
- `monthly_budget_exceeded` 는 월 1회만 기록한다. `budgetExceededMonthCount` 는 초과한 개월 수다.

### allow_and_flag

예산을 넘어도 실행하고 초과를 기록한다.

```text
실행 → 월 누적 갱신 → 누적 > 예산이면 monthly_budget_exceeded (해당 월 첫 1회)
```

### block_action_when_exceeded

**해당 실행으로 예산을 넘긴다면** conditional action 을 차단한다.

```text
월 누적 + conditional amount > 예산  →  conditional_buy_blocked (blockedBy: monthly_budget)
```

차단하면 누적이 늘지 않으므로 `monthly_budget_exceeded` 도 발생하지 않는다.
단, 정기 매수만으로 예산을 넘는 경우에는 이 정책에서도 초과가 기록된다(정기 매수는 차단 대상이
아니기 때문). 이때 그 달의 이후 conditional action 은 모두 `monthly_budget` 으로 차단된다.

### 예산 초과 원인 분류

`budgetExceededMonthCount` 만으로는 초과 원인을 알 수 없다. **실데이터 검증에서 실제로 문제가
됐다**: 월 예산 200,000원 · 매주 월요일 50,000원 계획에서 초과 4개월이 발생했는데, 4개월 모두
월요일이 5번 있는 달에 **정기 매수만으로** 250,000원이 사용된 결과였다. 추가 매수는 관여하지
않았다. 이 상태로 AI 에게 넘기면 추가 매수를 원인으로 잘못 설명할 수 있다.

그래서 원인을 추론하게 두지 않고 계산 필드로 못박는다. 판정은 **월 최종 집계**로 한다.

| # | 조건 | `budgetExceeded` | `budgetExceededCause` | `recurringAloneExceededBudget` | `conditionalCausedBudgetExceed` |
| --- | --- | --- | --- | --- | --- |
| 1 | 예산 미설정 (`null`) | false | `null` | false | false |
| 2 | `recurringInvestmentKrw > 예산` | true | `"recurring_only"` | true | false |
| 3 | `recurring ≤ 예산` 이고 `totalInvestmentKrw > 예산` | true | `"conditional_action"` | false | true |
| 4 | `total ≤ 예산` | false | `null` | false | false |

- 규칙 2가 3보다 먼저 평가되므로 **한 달에 두 원인이 동시에 기록되지 않는다.**
- 왜 최종 집계인가: 루프 도중에 판정하면 그 시점의 부분 합계로 원인이 결정된다. 월요일이
  5번인 달에서 초과가 4번째 정기 매수 시점에 발생하면 그 순간의 정기 매수 합계는 예산 이하이지만,
  그 달 전체로 보면 정기 매수만으로 이미 예산을 넘는다. AI 가 읽는 값은 후자여야 한다.
- `monthly_budget_exceeded` 이벤트의 `cause` 는 그 달의 `budgetExceededCause` 와 항상 같다
  (루프가 끝난 뒤 최종 집계로 맞춘다).
- 이벤트의 `triggeredByEventId` 는 그 달의 초과 상태를 **처음 만든 실행 이벤트**다. `cause` 와
  다른 질문에 답한다 — 전자는 "어느 실행이 그 순간 넘겼나", 후자는 "그 달의 원인이 무엇인가".
  정기 매수 4회로 예산에 딱 맞는 달에 추가 매수가 섞이면, 마지막 정기 매수가 초과 순간을
  만들었더라도 원인은 `conditional_action` 이다(추가 매수가 없었다면 예산 안이었으므로).

### AI 가 결과 타입만으로 구분할 수 있어야 하는 세 경우

| Case | 읽는 필드 | 설명 문장 |
| --- | --- | --- |
| A | `recurringOnlyBudgetExceededMonthCount > 0` | "추가 매수와 관계없이 정기 매수 일정만으로 월 예산을 넘은 달이 있었어요." |
| B | `conditionalCausedBudgetExceededMonthCount > 0` | "정기 매수는 월 예산 안이었지만 추가 매수가 실행되면서 예산을 넘은 달이 있었어요." |
| C | `budgetExceededMonthCount === 0` | "정기 매수와 추가 매수를 합해도 월 예산을 넘지 않았어요." |

A 와 B 는 달마다 원인이 다르면 동시에 성립할 수 있다.

---

## 8. 횟수 제한

`maxConditionalExecutionsPerMonth` 가 있으면, 해당 월의 **실행 횟수**가 제한에 도달한 이후의
conditional action 을 차단한다.

- 비교 대상은 실행 횟수(`conditionalExecutionCount`)다. 차단된 건은 세지 않는다.
- 매월 초기화된다.
- 차단 사유는 `monthly_execution_limit`.
- `0` 도 유효한 값이다(그 달의 모든 conditional action 이 차단된다).
- 조건 발생 자체(`conditional_triggered`)는 제한과 무관하게 기록된다.

### 차단 사유 우선순위

하나의 trigger 에 대해 차단 사유는 **하나만** 기록한다. 우선순위:

```text
1. review_trigger          (재검토로 정지된 계획은 더 평가하지 않는다)
2. monthly_execution_limit (사용자가 정한 횟수 제한)
3. monthly_budget          (금액 제한)
```

---

## 9. 재검토 정책

재검토 가격:

```text
reviewPrice = averageCostUsd × (100 - reviewDrawdownPercent) / 100
```

도달 판정은 조건부 매수와 **같은 crossing 규칙**을 쓴다(이전 종가 > reviewPrice AND 현재 종가
≤ reviewPrice). 임계선 아래에 머무는 동안 매일 `review_triggered` 를 쏟아내지 않기 위해서다.
`reviewTriggeredCount` 가 세는 값도 "재검토가 필요해진 국면의 횟수"가 된다.

단, **첫 candle 처리만 조건부 매수와 다르다.** 첫 candle 의 종가가 이미 `reviewPrice` 이하이면
`review_triggered` 를 발생시키고 `initialState: true` 로 표시한다. `reviewTriggeredCount` 에도
포함된다. 이유는 §6 "첫 candle 정책이 조건부 매수와 재검토에서 다른 이유" 참고.

재검토 평가는 **같은 날의 조건부 매수보다 먼저** 실행된다(§4).

### flag_only

- `review_triggered` 이벤트만 기록한다.
- 같은 날의 conditional action 도 기존 정책(예산·횟수 제한)에 따라 **실행 가능**하다.
- 이후 conditional action 도 계속 유지된다.
- 첫 candle initial breach 인 경우에도 이후 re-arm 된 crossing 은 정상 실행된다.

### pause_future_conditional_actions

- `review_triggered` 를 먼저 기록한다.
- **같은 날부터** conditional action 을 `blockedBy: review_trigger` 로 차단한다.
- 이후 conditional action 도 계속 차단한다. 한 번 정지되면 시뮬레이션 종료까지 해제되지 않는다.
- 첫 candle initial breach 인 경우 **첫 거래일부터** 조건부 매수가 중단된다.
- **정기 매수는 계속 실행한다.**

### 두 정책의 차이 요약

| | flag_only | pause_future_conditional_actions |
| --- | --- | --- |
| `review_triggered` 기록 | O | O |
| 같은 날 conditional 실행 | 가능 | 차단 (`review_trigger`) |
| 이후 conditional 실행 | 가능 | 차단 |
| 첫 candle initial breach 이후 | 유지 | 첫 거래일부터 차단 |
| 정기 매수 | 유지 | 유지 |
| 용도 | 원래 계획 분석 — 위험을 드러낸다 | 조정안 분석 — 안전장치가 작동한 결과를 본다 |

---

## 10. 추가 하락 계산

각 conditional trigger 날짜 **이후** 최대 20거래일(`postTriggerObservationDays`)의 최저 종가를
확인한다.

```text
(minCloseAfterTrigger - triggerDayClose) ÷ triggerDayClose × 100
```

- 관찰 창은 조건 발생일 **다음** 거래일부터 시작한다(발생일 자신은 제외).
- 관찰 가능한 거래일이 20개보다 적으면 남아 있는 거래일만 사용한다.
- 조건 발생일이 마지막 candle 이면 관찰 거래일이 0개이므로 해당 trigger 는 `null` 이다.
- 종가만 사용한다(intraday low 미사용).
- **실행 여부와 무관하게 모든 trigger** 를 대상으로 한다. 차단된 조건도 "그때 사지 않은 것이
  결과적으로 어땠는지"를 보여줘야 하기 때문이다.
- `maxAdditionalDeclineAfterTriggerPercent` = 모든 trigger 값 중 **가장 작은 값**(가장 큰 하락).
  하락이면 음수다. 관찰 가능한 trigger 가 하나도 없으면 `null`.
- 소수점 2자리로 반올림한다.

---

## 11. 정기 매수 일정

- 주기 `weekly`, 요일 `monday`.
- 첫 예정일은 첫 candle 날짜 **이후(포함)** 의 첫 월요일이다.
- 예정일이 휴장일이면 **다음 거래일**에 실행한다. 월 경계를 넘어가도 다음 실제 거래일에
  실행하며, 집계는 **실제 실행일이 속한 월**에 반영된다.
- 마지막 candle 날짜보다 뒤인 월요일은 관찰 가능한 거래일이 없으므로 열거하지 않는다.
- 이벤트에 `scheduledDate`(원래 예정일)와 `rolledForward` 를 남겨 밀린 사실을 추적할 수 있게 한다.
- 날짜 계산은 전부 UTC 기준이다. 로컬 타임존에 따라 결과가 달라지지 않게 하기 위해서다.

---

## 12. 파일 구성

| 파일 | 책임 |
| --- | --- |
| `types.ts` | 입력·출력·이벤트 타입, `SimulationInputError` |
| `policies.ts` | 정책 상수, 반올림, 임계 가격 계산 |
| `scheduleRecurring.ts` | 정기 매수 일정 (휴장일 롤포워드) |
| `detectConditionalCrossings.ts` | crossing 탐지 (조건부 매수·재검토 공용) |
| `calculatePostTriggerDecline.ts` | 조건 발생 후 추가 하락 |
| `buildChartSeries.ts` | 차트 시계열 + 이벤트 마커 |
| `simulatePlan.ts` | 입력 검증 + 일별 순회 + 집계 |
| `index.ts` | 공개 API |
| `simulatePlan.test.ts` | 단위 테스트 (Node 내장 test runner) |

실행: `npm run test:simulation`

테스트는 작은 명시적 candle fixture 로 계산 규칙만 검증한다. 실데이터(AAPL) 결과를
하드코딩하지 않는다. 이 fixture 는 테스트 전용이며 production 경로의 fallback 으로 쓰지 않는다.

---

## 13. 알려진 한계

### 계산 범위

- **환율·주식 수량·수익률을 계산하지 않는다.** 따라서 "얼마 벌었나"에 답할 수 없다.
  답할 수 있는 것은 실행 횟수, KRW 투자 금액, 예산 초과 여부, 가격 조건 발생 여부다.
- 평균 매수가가 고정이므로, 실제로 여러 번 매수한 사용자의 실질 평단과는 다르다.
  기준가가 낡을수록 조건 발생 빈도가 실제와 벌어진다.
- 매도·수수료·세금·슬리피지·부분 체결을 다루지 않는다.
- 배당을 반영하지 않는다(dividend adjustment 미사용).

### 가격·체결

- 종가만 사용하므로 장중에 임계선을 스쳤다가 종가가 회복한 날은 조건 발생으로 보지 않는다.
  실제 지정가 주문과 결과가 다를 수 있다.
- 모의 체결가도 종가다. 실제로는 조건 감지 후 다음 시점에 체결된다.

### 일정·주기

- `weekly` / `monday` 만 지원한다. `daily`·`monthly`, 다른 요일, 시작일 지정은 미구현이다.
- 시장이 한 주 이상 연속 휴장하면 두 개의 예정일이 같은 거래일로 밀려 그 날 정기 매수가
  2건 실행된다(각 예정일이 각각 롤포워드되므로). 실제로는 거의 발생하지 않지만 규칙은 이렇다.
- 휴장일 판단은 별도 캘린더가 아니라 **candle 존재 여부**로 한다. adapter 가 넘긴 거래일 목록이
  곧 개장일이다.

### 조건

- 조건부 **매수** 하나, 방향은 하락 하나만 지원한다. 조건부 매도와 상승 조건은 미구현이다.
- 여러 개의 조건부 액션(예: -3%, -5%, -10% 단계 매수)을 동시에 다루지 않는다.
- 재검토 트리거는 `price_drawdown` 만 구현했다. 스키마의 `monthly_budget_exceeded`·
  `execution_count_exceeded` 트리거는 미구현이다.

### 그 외

- `SimulationWarning`(`AGENT_TOOL_CONTRACT` §12: `PARTIAL_MARKET_DATA`,
  `NO_CONDITIONAL_TRIGGER` 등)은 아직 생성하지 않는다. 필요한 원시 지표는 결과에 다 있어서
  adapter 단계에서 만들 수 있다.
- 월 예산은 달력 월 기준이다. 사용자의 급여일 주기와 다를 수 있다.
- 부분 실행(예산 잔액만큼만 매수)을 하지 않는다. 실행 아니면 차단, 둘 중 하나다.
