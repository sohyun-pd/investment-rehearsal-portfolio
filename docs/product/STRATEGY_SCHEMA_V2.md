---
title: AI Investment Plan Copilot Strategy Schema
status: decided
version: 2.0
updated_at: 2026-07-28
source_prd: 05_Product/PRD_V2.md
source_flow: 05_Product/USER_FLOW_V2.md
previous_version: 05_Product/STRATEGY_SCHEMA_V1_ARCHIVE.md
---

# AI Investment Plan Copilot Strategy Schema

# 1. Schema Principles

## 1.1 AI가 만든 값과 계산된 값을 구분한다

- 사용자의 의도를 해석한 값은 `aiExtracted`
- 사용자가 직접 입력하거나 승인한 값은 `userConfirmed`
- 시장 API에서 가져온 값은 `marketData`
- TypeScript가 계산한 값은 `simulationResult`

하나의 필드에 출처가 다른 값을 덮어쓰지 않는다.

## 1.2 불확실한 숫자는 null로 유지한다

다음 값을 AI가 추정하지 않는다.

- 투자 금액
- 투자 주기
- 하락률
- 상승률
- 평균 매수가
- 월 최대 예산
- 추가 매수 최대 횟수
- 재검토 기준

확인되지 않은 값은 `null`과 `needsClarification`으로 관리한다.

## 1.3 원본 사용자 입력을 보존한다

AI가 구조화한 결과와 별도로
사용자의 원문과 대화 이력을 저장한다.

## 1.4 계산 결과는 수정하지 않는다

Claude는 `SimulationResult` 값을 생성하거나 수정하지 않는다.

Claude는 계산 결과를 읽고
사용자가 이해할 수 있는 설명을 생성한다.

## 1.5 계획 수정 시 관련 결과를 무효화한다

다음 값이 변경되면 기존 분석 결과를 다시 계산한다.

- 종목
- 매수 주기
- 매수 금액
- 기준 가격
- 하락률 또는 상승률
- 추가 매수 금액
- 월 최대 예산
- 추가 매수 횟수
- 재검토 기준

---

# 2. Root State

```typescript
type InvestmentCopilotState = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;

  status: PlanLifecycleStatus;

  conversation: ConversationState;
  plan: InvestmentPlan;
  marketData: MarketDataBundle | null;
  simulation: SimulationResult | null;
  aiReview: AIReview | null;

  revisionRequest: RevisionRequest | null;
  alternatives: PlanAlternative[];
  selectedAlternativeId: string | null;

  replay: AgentReplay | null;

  errors: ProductError[];
};
```

---

# 3. Plan Lifecycle Status

> **AppFlowState 와 통합하지 않는다.**
> `PlanLifecycleStatus` 는 **계획 데이터의 수명주기**를 나타낸다.
> UI 흐름 상태는 [`STATE_FLOW_V1.md`](./STATE_FLOW_V1.md) 의 `AppFlowState`(13개)가 담당한다.
> 두 체계는 **명시적 mapping 만** 사용하며 서로를 대체하지 않는다.

```typescript
type PlanLifecycleStatus =
  | "onboarding"
  | "collecting_intent"
  | "needs_clarification"
  | "ready_for_review"
  | "awaiting_analysis_approval"
  | "fetching_market_data"
  | "running_simulation"
  | "generating_review"
  | "analysis_ready"
  | "collecting_revision"
  | "generating_alternatives"
  | "comparison_ready"
  | "awaiting_final_approval"
  | "mock_active"
  | "error";
```

## 상태 전환

```text
onboarding
→ collecting_intent
→ needs_clarification
→ ready_for_review
→ awaiting_analysis_approval
→ fetching_market_data
→ running_simulation
→ generating_review
→ analysis_ready
→ collecting_revision
→ generating_alternatives
→ comparison_ready
→ awaiting_final_approval
→ mock_active
```

---

# 4. Conversation State

```typescript
type ConversationState = {
  messages: ConversationMessage[];
  currentQuestion: ClarificationQuestion | null;
  completedQuestionIds: string[];
  skippedQuestionIds: string[];
  quickReplies: QuickReply[];
};
```

## Conversation Message

```typescript
type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  type:
    | "text"
    | "question"
    | "plan_summary"
    | "tool_status"
    | "error";
  content: string;
  createdAt: string;

  relatedFieldPaths?: string[];
  sourceMessageId?: string | null;
};
```

## Quick Reply

```typescript
type QuickReply = {
  id: string;
  label: string;
  value: string | number;
  fieldPath: string;
  unit?: MoneyCurrency | "%" | "times" | null;
};
```

## Clarification Question

```typescript
type ClarificationQuestion = {
  id: string;
  fieldPath: string;

  question: string;
  reason: string;

  inputType:
    | "text"
    | "number"
    | "money"
    | "percent"
    | "select"
    | "date";

  required: boolean;

  options?: ClarificationOption[];
  validation?: FieldValidation | null;
};
```

## Clarification Option

```typescript
type ClarificationOption = {
  id: string;
  label: string;
  value: string | number;
  unit?: MoneyCurrency | "%" | "times" | null;
};
```

## Field Validation

```typescript
type FieldValidation = {
  min?: number;
  max?: number;
  integerOnly?: boolean;
  allowedValues?: Array<string | number>;
};
```

---

# 5. Investment Plan

```typescript
type InvestmentPlan = {
  id: string;
  version: number;

  originalInput: string;
  userConfirmed: boolean;

  asset: AssetSelection;

  recurringAction: RecurringAction | null;
  conditionalActions: ConditionalAction[];

  guardrails: PlanGuardrails;

  missingFields: MissingPlanField[];
  assumptions: PlanAssumption[];

  createdAt: string;
  updatedAt: string;
};
```

---

# 6. Asset Selection

```typescript
type AssetSelection = {
  query: string;
  symbol: string | null;
  companyName: string | null;
  market: "US";
  exchange: string | null;
  currency: "USD";

  resolutionStatus:
    | "unresolved"
    | "candidate_found"
    | "confirmed"
    | "not_found";

  candidates?: AssetCandidate[];
};
```

## Asset Candidate

```typescript
type AssetCandidate = {
  symbol: string;
  companyName: string;
  exchange: string;
  market: "US";
  currency: "USD";
};
```

---

# 7. Recurring Action

```typescript
type RecurringAction = {
  id: string;
  type: "recurring_buy";

  frequency: RecurringFrequency;
  amount: MoneyAmount | null;

  startDate: string | null;
  weekday: Weekday | null;
  dayOfMonth: number | null;

  status: FieldStatus;
};
```

## Recurring Frequency

```typescript
type RecurringFrequency =
  | "daily"
  | "weekly"
  | "monthly";
```

## Weekday

```typescript
type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday";
```

---

# 8. Conditional Actions

```typescript
type ConditionalAction =
  | ConditionalBuyAction
  | ConditionalSellAction;
```

## Conditional Buy

```typescript
type ConditionalBuyAction = {
  id: string;
  type: "conditional_buy";

  reference: PriceReference;
  trigger: PriceTrigger;

  amount: MoneyAmount | null;

  status: FieldStatus;
};
```

## Conditional Sell

```typescript
type ConditionalSellAction = {
  id: string;
  type: "conditional_sell";

  reference: PriceReference;
  trigger: PriceTrigger;

  sellAmountType: "position_ratio" | "share_quantity";
  sellRatio: number | null;
  shareQuantity: number | null;

  status: FieldStatus;
};
```

---

# 9. Price Reference

```typescript
type PriceReference = {
  type:
    | "average_cost"
    | "market_price_at_creation"
    | "previous_close";

  price: number | null;
  currency: "USD";
  timestamp: string | null;

  source:
    | "user"
    | "market_api"
    | "simulation"
    | null;

  status: FieldStatus;
};
```

## 규칙

- `average_cost`는 사용자가 입력하거나 계좌 데이터가 있어야 한다.
- 현재 MVP에는 계좌 연동이 없으므로 사용자가 직접 입력한다.
- `market_price_at_creation`은 가격과 시각을 함께 저장한다.
- `previous_close`는 Market API에서 조회한다.

---

# 10. Price Trigger

```typescript
type PriceTrigger = {
  direction: "up" | "down";
  thresholdPercent: number | null;
  operator: "gte" | "lte";

  status: FieldStatus;
};
```

## 예시

평균 매수가보다 3% 하락:

```typescript
{
  direction: "down",
  thresholdPercent: 3,
  operator: "lte",
  status: "confirmed"
}
```

---

# 11. Money

```typescript
type MoneyCurrency = "KRW" | "USD";
```

```typescript
type MoneyAmount = {
  value: number;
  currency: MoneyCurrency;
  orderUnit: "cash_amount";
};
```

## 원칙

미국주식 가격 단위와
사용자가 투자하는 금액 단위를 분리한다.

예시:

```typescript
const referencePrice = {
  value: 320,
  currency: "USD"
};

const buyAmount = {
  value: 50000,
  currency: "KRW",
  orderUnit: "cash_amount"
};
```

환율 계산은 현재 MVP에서 제외한다.

---

# 12. Plan Guardrails

```typescript
type PlanGuardrails = {
  monthlyBudget: MoneyAmount | null;

  maxConditionalExecutionsPerMonth: number | null;

  reviewTrigger: ReviewTrigger | null;

  periodicReview: PeriodicReview | null;
};
```

## Review Trigger

```typescript
type ReviewTrigger =
  | PriceDrawdownReviewTrigger
  | BudgetReviewTrigger
  | ExecutionCountReviewTrigger;
```

## Price Drawdown Review Trigger

```typescript
type PriceDrawdownReviewTrigger = {
  type: "price_drawdown";
  referenceType: "average_cost";
  thresholdPercent: number;
  action: "pause_and_review";
};
```

## Budget Review Trigger

```typescript
type BudgetReviewTrigger = {
  type: "monthly_budget_exceeded";
  action: "pause_and_review";
};
```

## Execution Count Review Trigger

```typescript
type ExecutionCountReviewTrigger = {
  type: "execution_count_exceeded";
  maxExecutions: number;
  action: "pause_and_review";
};
```

## Periodic Review

```typescript
type PeriodicReview = {
  frequency: "weekly" | "monthly" | "quarterly";
};
```

---

# 13. Field Status

```typescript
type FieldStatus =
  | "unknown"
  | "ai_extracted"
  | "user_confirmed"
  | "api_resolved"
  | "calculated";
```

---

# 14. Missing Fields

```typescript
type MissingPlanField = {
  fieldPath: string;
  reason:
    | "required_for_plan"
    | "required_for_market_data"
    | "required_for_simulation"
    | "ambiguous_user_expression";

  priority: 1 | 2 | 3;
};
```

## 예시

```typescript
{
  fieldPath: "conditionalActions[0].trigger.thresholdPercent",
  reason: "ambiguous_user_expression",
  priority: 1
}
```

---

# 15. Plan Assumption

```typescript
type PlanAssumption = {
  id: string;
  fieldPath: string;
  description: string;
  confirmedByUser: boolean;
};
```

## 원칙

MVP에서는 가능한 한 assumption을 만들지 않는다.

기술적 기본값이 필요한 경우에만 사용한다.

예시:

- 정기 매수 요일을 월요일로 설정
- 휴장일이면 다음 거래일에 실행

이 경우에도 최종 확인 화면에서 사용자에게 노출한다.

---

# 16. Market Data Bundle

```typescript
type MarketDataBundle = {
  asset: ResolvedAsset;
  quote: MarketQuote;
  candles: DailyCandle[];

  source: MarketDataSource;
  fetchedAt: string;

  requestedRange: DateRange;
  actualRange: DateRange;

  isDelayed: boolean;
  delayDescription: string | null;
};
```

## Resolved Asset

```typescript
type ResolvedAsset = {
  symbol: string;
  companyName: string;
  exchange: string;
  market: "US";
  currency: "USD";
};
```

## Market Quote

```typescript
type MarketQuote = {
  currentPrice: number;
  previousClose: number;
  changeValue: number;
  changePercent: number;

  marketTimestamp: string;
};
```

## Daily Candle

```typescript
type DailyCandle = {
  date: string;

  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
};
```

## Market Data Source

```typescript
type MarketDataSource = {
  symbolSearch: "finnhub";
  quote: "finnhub";
  historicalCandles: "twelve_data";
};
```

용도별로 provider 를 분리해 기록한다. 하나의 `provider` 필드로는 현재 구현을 표현할 수 없다.

- **Finnhub** — 종목 검색, 현재가
- **Twelve Data** — 과거 일봉 (`adjust=splits`, 배당 미반영)

근거: [`TECH_SPIKE_2_RESULT.md`](../../spikes/historical-market-data/TECH_SPIKE_2_RESULT.md)
(Finnhub historical candle 접근 불가),
[`ADJUSTMENT_CHECK_RESULT.md`](../../spikes/historical-market-data-twelve-data/ADJUSTMENT_CHECK_RESULT.md).

두 provider 의 가격이 미세하게 다를 수 있다. 현재가와 과거 종가를 같은 계산에 섞지 않는다.

## Date Range

```typescript
type DateRange = {
  from: string;
  to: string;
};
```

---

# 17. Simulation Input

```typescript
type SimulationInput = {
  planId: string;
  planVersion: number;

  asset: ResolvedAsset;
  recurringAction: RecurringAction | null;
  conditionalActions: ConditionalAction[];
  guardrails: PlanGuardrails;

  candles: DailyCandle[];

  simulationPeriod: DateRange;

  executionPolicy: ExecutionPolicy;
};
```

## Execution Policy

```typescript
type ExecutionPolicy = {
  marketHolidayHandling: "next_trading_day";
  sameDayEventOrder:
    | "recurring_first"
    | "conditional_first";

  monthlyBudgetBehavior:
    | "block_action_when_exceeded"
    | "allow_and_flag";

  reviewTriggerBehavior:
    | "pause_future_conditional_actions"
    | "flag_only";
};
```

## MVP 기본 정책

```typescript
const defaultExecutionPolicy: ExecutionPolicy = {
  marketHolidayHandling: "next_trading_day",
  sameDayEventOrder: "recurring_first",
  monthlyBudgetBehavior: "allow_and_flag",
  reviewTriggerBehavior: "flag_only"
};
```

초기 계획 분석에서는 위험을 발견해야 하므로
예산 초과와 재검토 조건을 막지 않고 표시한다.

조정안 시뮬레이션에서는 사용자가 정한 제한에 따라
실행 차단 정책을 적용할 수 있다.

---

# 18. Simulation Result

```typescript
type SimulationResult = {
  planId: string;
  planVersion: number;

  period: DateRange;
  tradingDayCount: number;

  summary: SimulationSummary;

  monthlyResults: MonthlySimulationResult[];
  events: SimulationEvent[];

  chartSeries: ChartDataPoint[];

  calculatedAt: string;
  engineVersion: string;
};
```

---

# 19. Simulation Summary

```typescript
type SimulationSummary = {
  recurringExecutionCount: number;

  conditionalTriggerCount: number;
  conditionalExecutionCount: number;
  conditionalBlockedCount: number;

  totalRecurringInvestment: MoneyAmount;
  totalConditionalInvestment: MoneyAmount;
  totalInvestment: MoneyAmount;

  maxMonthlyInvestment: MoneyAmount;
  maxMonthlyConditionalExecutionCount: number;

  budgetExceededMonthCount: number;
  recurringOnlyBudgetExceededMonthCount: number;
  conditionalCausedBudgetExceededMonthCount: number;

  reviewTriggeredCount: number;

  maxAdditionalDeclineAfterTriggerPercent: number | null;
};
```

## 예산 초과 개월의 원인 분해

불변 조건:

```text
budgetExceededMonthCount
===
recurringOnlyBudgetExceededMonthCount
+
conditionalCausedBudgetExceededMonthCount
```

`budgetExceededMonthCount` 는 하위 호환을 위해 유지한다. 원인별 분해값은 §20 의 판정 규칙을
월 단위로 센 것이다.

## 지표 구분

### Trigger Count

가격 조건이 발생한 횟수

### Execution Count

예산·횟수·재검토 제한을 적용한 뒤
실제로 실행된 모의 이벤트 횟수

### Blocked Count

조건은 발생했지만 안전장치로 실행되지 않은 횟수

---

# 20. Monthly Simulation Result

```typescript
type BudgetExceededCause =
  | "recurring_only"
  | "conditional_action"
  | null;

type MonthlySimulationResult = {
  month: string;

  recurringInvestment: MoneyAmount;
  conditionalInvestment: MoneyAmount;
  totalInvestment: MoneyAmount;

  recurringExecutionCount: number;
  conditionalTriggerCount: number;
  conditionalExecutionCount: number;
  conditionalBlockedCount: number;

  budgetExceeded: boolean;

  budgetExceededCause: BudgetExceededCause;
  recurringAloneExceededBudget: boolean;
  conditionalCausedBudgetExceed: boolean;

  reviewTriggered: boolean;
};
```

## 예산 초과 원인 판정

판정은 **월 최종 집계**로 한다. 루프 도중의 부분 합계로 판정하면, 같은 달에 정기 매수가 더
남아 있을 때 최종 집계와 결론이 갈릴 수 있다.

| # | 조건 | `budgetExceeded` | `budgetExceededCause` | `recurringAloneExceededBudget` | `conditionalCausedBudgetExceed` |
| --- | --- | --- | --- | --- | --- |
| 1 | `monthlyBudgetKrw === null` | false | `null` | false | false |
| 2 | `recurringInvestment > 예산` | true | `"recurring_only"` | true | false |
| 3 | `recurringInvestment ≤ 예산` 이고 `totalInvestment > 예산` | true | `"conditional_action"` | false | true |
| 4 | `totalInvestment ≤ 예산` | false | `null` | false | false |

**한 달에 두 원인이 동시에 기록되지 않는다.** 규칙 2가 규칙 3보다 먼저 평가되므로
정기 매수만으로 이미 초과한 달은 추가 매수 여부와 무관하게 `recurring_only` 다.

### 왜 필요한가

실데이터 검증에서 드러난 문제다. 월 예산 200,000원 · 매주 월요일 50,000원 계획에서 예산 초과가
4개월 발생했는데, 4개월 모두 **월요일이 5번 있는 달에 정기 매수만으로 250,000원이 사용**되어
발생한 것이었다. `budgetExceededMonthCount` 만 보면 AI 가 추가 매수를 원인으로 잘못 설명할 수
있다. 원인을 추론하게 두지 않고 계산 필드로 못박는다.

### AI 가 구분해야 하는 세 경우

| Case | 조건 | 설명 |
| --- | --- | --- |
| A | `recurringOnlyBudgetExceededMonthCount > 0` | "추가 매수와 관계없이 정기 매수 일정만으로 월 예산을 넘은 달이 있었어요." |
| B | `conditionalCausedBudgetExceededMonthCount > 0` | "정기 매수는 월 예산 안이었지만 추가 매수가 실행되면서 예산을 넘은 달이 있었어요." |
| C | `budgetExceededMonthCount === 0` | "정기 매수와 추가 매수를 합해도 월 예산을 넘지 않았어요." |

A 와 B 는 동시에 성립할 수 있다(달마다 원인이 다를 수 있음). 한 **달**에 두 원인이 함께
기록되지 않는다는 것과는 다른 이야기다.

---

# 21. Simulation Events

```typescript
type SimulationEvent =
  | RecurringBuyEvent
  | ConditionalTriggerEvent
  | ConditionalBuyEvent
  | ConditionalBlockedEvent
  | BudgetExceededEvent
  | ReviewTriggeredEvent;
```

## Base Event

```typescript
type BaseSimulationEvent = {
  id: string;
  date: string;
  symbol: string;

  closePrice: number;
  priceCurrency: "USD";

  averageCostBefore: number | null;
  averageCostAfter: number | null;
};
```

## Recurring Buy Event

```typescript
type RecurringBuyEvent = BaseSimulationEvent & {
  type: "recurring_buy_executed";
  amount: MoneyAmount;
};
```

## Conditional Trigger Event

```typescript
type ConditionalTriggerEvent = BaseSimulationEvent & {
  type: "conditional_triggered";

  referencePrice: number;
  thresholdPercent: number;
};
```

## Conditional Buy Event

```typescript
type ConditionalBuyEvent = BaseSimulationEvent & {
  type: "conditional_buy_executed";

  amount: MoneyAmount;
  monthlyExecutionIndex: number;
};
```

## Conditional Blocked Event

```typescript
type ConditionalBlockedEvent = BaseSimulationEvent & {
  type: "conditional_buy_blocked";

  blockedBy:
    | "monthly_budget"
    | "monthly_execution_limit"
    | "review_trigger";

  attemptedAmount: MoneyAmount;
};
```

## Budget Exceeded Event

```typescript
type BudgetExceededEvent = BaseSimulationEvent & {
  type: "monthly_budget_exceeded";

  month: string;                    // YYYY-MM

  monthlyInvestmentKrw: number;
  monthlyBudgetKrw: number;

  recurringInvestmentKrw: number;
  conditionalInvestmentKrw: number;

  cause:
    | "recurring_only"
    | "conditional_action";

  triggeredByEventId: string;
};
```

## 필드 설명

- `recurringInvestmentKrw` / `conditionalInvestmentKrw` — 그 달 최종 집계를 분해한 값이다.
  AI 가 원인을 추론하지 않고 읽을 수 있게 함께 담는다.
- `cause` — 그 달 `MonthlySimulationResult.budgetExceededCause` 와 **항상 동일하다**
  (판정 규칙은 §20 참고).
- `triggeredByEventId` — 그 달의 예산 초과 상태를 **처음 만든 실행 이벤트** id 다.
  정기 매수로 처음 넘으면 recurring event id, 추가 매수로 처음 넘으면 conditional event id 다.
- 월별 예산 초과 이벤트는 **한 달에 한 번만** 생성한다.

> `triggeredByEventId` 와 `cause` 는 서로 다른 질문에 답한다. 전자는 "어느 실행이 그 순간
> 예산을 넘겼나", 후자는 "그 달의 초과 원인이 무엇인가"다. 정기 매수 4회로 예산에 딱 맞는 달에
> 추가 매수가 섞이면, 마지막 정기 매수가 초과 순간을 만들었더라도 원인은
> `conditional_action` 이다(추가 매수가 없었다면 예산 안이었으므로).

## Review Triggered Event

```typescript
type ReviewTriggeredEvent = BaseSimulationEvent & {
  type: "review_triggered";

  trigger: "price_drawdown";

  referencePrice: number;   // 고정 평균 매수가
  thresholdValue: number;   // reviewDrawdownPercent
  reviewPrice: number;      // referencePrice × (100 - thresholdValue) / 100

  initialState: boolean;
  previousClose: number | null;
};
```

## 필드 설명

- `initialState: true` — **첫 candle 부터 재검토 기준 이하인 상태**에서 발생한 이벤트다.
  crossing 으로 발생한 이벤트는 `false` 다.
- `previousClose: null` — `initialState: true` 인 경우 비교할 이전 거래일이 존재하지 않는다.
  crossing 으로 발생한 경우에는 직전 거래일 종가가 들어간다.
- `reviewTriggeredCount` 는 crossing 발생과 첫 candle 침범을 **모두** 포함한다.

## conditional trigger 와 review trigger 의 첫 candle 정책이 다르다

| | 첫 candle 이 이미 임계선 이하일 때 |
| --- | --- |
| conditional trigger | trigger 로 세지 않는다. 초기 상태로만 기록 |
| review trigger | `review_triggered` 를 발생시킨다 (`initialState: true`) |

- **conditional trigger 는 관찰 기간 안에서 새로 발생한 사건**이다. 관찰 시작 시점에 이미
  아래에 있었다면 그 하락은 관찰 구간 안의 사건이 아니다. 이를 매수 신호로 세면 데이터
  시작일을 언제로 잡느냐에 따라 매수 횟수가 달라진다.
- **review trigger 는 지금 이미 재검토가 필요한 상태인지 확인하는 조건**이다. 사건이 아니라
  상태이므로, 손실이 관찰 시작 전에 발생했든 도중에 발생했든 추가 매수 전에 확인이 필요한
  상태는 같다.

> 변경 이력: `trigger` 의 `monthly_budget_exceeded` · `execution_count_exceeded` 변형은
> 제거했다. 현재 엔진은 가격 하락(`price_drawdown`)만 재검토 트리거로 구현한다. 예산 초과와
> 횟수 초과는 각각 `monthly_budget_exceeded` 이벤트와 `conditional_buy_blocked` 이벤트로
> 별도 표현되므로 재검토 트리거에 중복해 두지 않는다.

---

# 22. Chart Data

```typescript
type ChartDataPoint = {
  date: string;
  closePrice: number;

  eventIds: string[];

  hasRecurringBuy: boolean;
  hasConditionalBuy: boolean;
  hasBlockedAction: boolean;
  hasBudgetExceeded: boolean;
  hasReviewTrigger: boolean;
};
```

---

# 23. AI Review

```typescript
type AIReview = {
  summary: AIReviewSummary;

  risks: AIReviewItem[];
  strengths: AIReviewItem[];
  counterEvidence: AIReviewItem[];

  generatedAt: string;
  model: string;

  basedOnPlanVersion: number;
  basedOnSimulationEngineVersion: string;
};
```

## AI Review Summary

```typescript
type AIReviewSummary = {
  headline: string;
  description: string;
};
```

## AI Review Item

```typescript
type AIReviewItem = {
  id: string;

  category:
    | "budget"
    | "repetition"
    | "drawdown"
    | "missing_guardrail"
    | "execution_behavior";

  title: string;
  description: string;

  severity: "info" | "attention" | "high";

  evidenceRefs: EvidenceReference[];
};
```

## Evidence Reference

```typescript
type EvidenceReference = {
  sourceType:
    | "simulation_metric"
    | "simulation_event"
    | "market_data";

  fieldPath?: string;
  eventId?: string;
  label: string;
};
```

## 원칙

AI가 다음과 같은 문장을 만들면 안 된다.

```text
이 전략은 수익성이 높아요.
앞으로 상승할 가능성이 커요.
안전한 투자 계획이에요.
```

AI는 입력된 계산 결과와 데이터 범위 안에서만 설명한다.

---

# 24. Revision Request

```typescript
type RevisionRequest = {
  id: string;

  originalText: string;

  preserveConstraints: PlanConstraint[];
  changeConstraints: PlanConstraint[];

  missingConstraints: MissingRevisionConstraint[];

  userConfirmed: boolean;
};
```

## Plan Constraint

```typescript
type PlanConstraint =
  | MoneyConstraint
  | FrequencyConstraint
  | ExecutionLimitConstraint
  | ReviewConstraint;
```

## Money Constraint

```typescript
type MoneyConstraint = {
  type:
    | "preserve_recurring_amount"
    | "monthly_budget_max"
    | "conditional_amount_max";

  value: MoneyAmount;
};
```

## Frequency Constraint

```typescript
type FrequencyConstraint = {
  type: "preserve_recurring_frequency";
  value: RecurringFrequency;
};
```

## Execution Limit Constraint

```typescript
type ExecutionLimitConstraint = {
  type: "conditional_execution_limit";
  maxPerMonth: number;
};
```

## Review Constraint

```typescript
type ReviewConstraint = {
  type: "drawdown_review_trigger";
  thresholdPercent: number;
};
```

## Missing Revision Constraint

```typescript
type MissingRevisionConstraint = {
  fieldPath: string;
  question: string;
};
```

---

# 25. Plan Alternative

```typescript
type PlanAlternative = {
  id: string;

  name: string;
  priority:
    | "preserve_recurring_plan"
    | "preserve_conditional_capacity"
    | "minimize_monthly_spend"
    | "custom";

  plan: InvestmentPlan;
  simulation: SimulationResult;

  explanation: AlternativeExplanation;

  satisfiesUserConstraints: boolean;
  constraintViolations: ConstraintViolation[];
};
```

## Alternative Explanation

```typescript
type AlternativeExplanation = {
  summary: string;
  benefit: string;
  tradeOff: string;

  changedFields: ChangedField[];
  preservedFields: string[];
};
```

## Changed Field

```typescript
type ChangedField = {
  fieldPath: string;
  before: string | number | null;
  after: string | number | null;
};
```

## Constraint Violation

```typescript
type ConstraintViolation = {
  constraintType: string;
  expected: string | number;
  actual: string | number;
};
```

## 노출 규칙

`constraintViolations`가 하나라도 있거나
`satisfiesUserConstraints`가 false이면
사용자에게 조정안으로 노출하지 않는다.

---

# 26. Comparison Model

```typescript
type PlanComparison = {
  originalPlanId: string;
  alternativeIds: string[];

  metrics: ComparisonMetric[];
};
```

## Comparison Metric

```typescript
type ComparisonMetric = {
  key:
    | "recurring_amount"
    | "max_monthly_investment"
    | "conditional_execution_count"
    | "conditional_blocked_count"
    | "budget_exceeded_month_count"
    | "review_trigger_count";

  label: string;

  originalValue: string | number;
  alternativeValues: Record<string, string | number>;
};
```

---

# 27. Agent Replay

```typescript
type AgentReplay = {
  planId: string;
  planVersion: number;

  period: DateRange;

  summary: ReplaySummary;
  events: ReplayEvent[];

  currentEventIndex: number;
  playbackStatus: "idle" | "playing" | "paused" | "completed";
  playbackSpeed: 1 | 2;
};
```

## Replay Summary

```typescript
type ReplaySummary = {
  recurringExecutionCount: number;
  conditionalExecutionCount: number;
  conditionalBlockedCount: number;
  reviewTriggeredCount: number;
};
```

## Replay Event

```typescript
type ReplayEvent = {
  id: string;
  date: string;

  type:
    | "recurring_buy"
    | "conditional_buy"
    | "conditional_blocked"
    | "budget_guardrail"
    | "review_required";

  title: string;
  description: string;

  relatedSimulationEventId: string;

  monthlyInvestment?: MoneyAmount;
  amount?: MoneyAmount;
};
```

## 원칙

Replay의 문장만 AI가 임의 생성하지 않는다.

기본 문장은 이벤트 타입별 템플릿으로 생성하고,
AI가 필요하면 표현만 다듬는다.

---

# 28. Product Errors

```typescript
type ProductError = {
  id: string;

  stage:
    | "conversation"
    | "plan_structure"
    | "asset_resolution"
    | "market_quote"
    | "historical_data"
    | "simulation"
    | "ai_review"
    | "alternative_generation";

  code: string;
  userMessage: string;
  technicalMessage?: string;

  retryable: boolean;
  createdAt: string;
};
```

## 금지

- API 오류 시 fixture 자동 노출
- 오류를 성공 상태로 변환
- 실제 API 데이터와 예시 데이터를 혼합
- AI가 누락된 가격을 임의 생성

---

# 29. Data Invalidation Rules

```typescript
type InvalidationTarget =
  | "market_data"
  | "simulation"
  | "ai_review"
  | "alternatives"
  | "replay";
```

## 종목 변경

무효화:

```text
market_data
simulation
ai_review
alternatives
replay
```

## 매수 조건 변경

무효화:

```text
simulation
ai_review
alternatives
replay
```

## 안전장치 변경

무효화:

```text
simulation
ai_review
alternatives
replay
```

## AI 설명 문구 수정

무효화하지 않음:

```text
market_data
simulation
alternatives
```

---

# 30. Example State

```typescript
const exampleState: InvestmentCopilotState = {
  sessionId: "session_demo_001",
  createdAt: "2026-07-28T09:00:00+09:00",
  updatedAt: "2026-07-28T09:10:00+09:00",

  status: "analysis_ready",

  conversation: {
    messages: [],
    currentQuestion: null,
    completedQuestionIds: [],
    skippedQuestionIds: [],
    quickReplies: []
  },

  plan: {
    id: "plan_001",
    version: 1,

    originalInput:
      "애플을 꾸준히 사고 싶은데 가격이 떨어질 때 조금 더 사고 싶어.",

    userConfirmed: true,

    asset: {
      query: "애플",
      symbol: "AAPL",
      companyName: "Apple Inc.",
      market: "US",
      exchange: "NASDAQ",
      currency: "USD",
      resolutionStatus: "confirmed"
    },

    recurringAction: {
      id: "action_recurring_001",
      type: "recurring_buy",
      frequency: "weekly",
      amount: {
        value: 50000,
        currency: "KRW",
        orderUnit: "cash_amount"
      },
      startDate: null,
      weekday: "monday",
      dayOfMonth: null,
      status: "user_confirmed"
    },

    conditionalActions: [
      {
        id: "action_conditional_001",
        type: "conditional_buy",

        reference: {
          type: "average_cost",
          price: 320,
          currency: "USD",
          timestamp: null,
          source: "user",
          status: "user_confirmed"
        },

        trigger: {
          direction: "down",
          thresholdPercent: 3,
          operator: "lte",
          status: "user_confirmed"
        },

        amount: {
          value: 20000,
          currency: "KRW",
          orderUnit: "cash_amount"
        },

        status: "user_confirmed"
      }
    ],

    guardrails: {
      monthlyBudget: {
        value: 200000,
        currency: "KRW",
        orderUnit: "cash_amount"
      },
      maxConditionalExecutionsPerMonth: null,
      reviewTrigger: null,
      periodicReview: null
    },

    missingFields: [],
    assumptions: [],

    createdAt: "2026-07-28T09:00:00+09:00",
    updatedAt: "2026-07-28T09:10:00+09:00"
  },

  marketData: null,
  simulation: null,
  aiReview: null,

  revisionRequest: null,
  alternatives: [],
  selectedAlternativeId: null,

  replay: null,
  errors: []
};
```

---

# 31. Implementation Boundaries

## MVP에서 실제 구현

- ConversationState
- InvestmentPlan
- MarketDataBundle
- SimulationInput
- SimulationResult
- AIReview
- RevisionRequest
- PlanAlternative
- PlanComparison
- AgentReplay
- ProductError

## MVP에서 단순화 가능

- 사용자 세션은 localStorage 사용 가능
- 계획 버전은 숫자 증가 방식
- Replay는 SimulationEvent를 변환해 생성
- 뉴스 데이터는 필수 아님
- 환율 계산은 제외
- 주식 수량 대신 투자 금액 기준만 지원

## MVP에서 구현하지 않음

- 실제 주문 객체
- 증권 계좌
- 보유 수량
- 실현·평가 손익
- 실제 백그라운드 스케줄러
- 푸시 알림
- 서버 장기 저장