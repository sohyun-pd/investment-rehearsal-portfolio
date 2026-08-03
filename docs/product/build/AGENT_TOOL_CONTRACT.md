---
title: AI Investment Plan Copilot Agent Tool Contract
status: decided
version: 1.0
updated_at: 2026-07-28
source_prd: 05_Product/PRD_V2.md
source_flow: 05_Product/USER_FLOW_V2.md
source_schema: 05_Product/STRATEGY_SCHEMA_V2.md
---

# AI Investment Plan Copilot Agent Tool Contract

# 1. Purpose

이 문서는 AI Investment Plan Copilot에서
Claude, Market API, TypeScript Simulation Engine이
어떤 순서와 입력·출력으로 연결되는지 정의한다.

목표는 다음과 같다.

- LLM과 코드의 책임을 분리한다.
- 모든 수치 결과를 재현 가능하게 만든다.
- AI가 임의의 가격·횟수·금액을 생성하지 못하게 한다.
- Agent의 실제 도구 실행 과정을 화면에 표시할 수 있게 한다.
- 실패한 API를 예시 데이터로 숨기지 않는다.
- 사용자의 명시적 승인 전에는 분석과 모의 실행을 시작하지 않는다.

---

# 2. Agent Architecture

```text
User
  ↓
Conversation Orchestrator
  ↓
Claude Intent Parser
  ↓
Plan State
  ↓
Clarification Loop
  ↓
User Approval
  ↓
Market Data Adapter
  ↓
TypeScript Simulation Engine
  ↓
Claude Review Generator
  ↓
User Revision Request
  ↓
Claude Constraint Parser
  ↓
TypeScript Alternative Generator
  ↓
TypeScript Simulation Engine
  ↓
Claude Alternative Explainer
  ↓
User Selection
  ↓
TypeScript Replay Builder
```

## 핵심 구조

```text
Claude
- 사용자의 언어를 구조화한다.
- 필요한 질문을 만든다.
- 계산 결과를 설명한다.

Market API
- 종목과 시장 데이터를 제공한다.

TypeScript
- 모든 수치와 이벤트를 계산한다.
- 사용자 제약을 만족하는 조정안을 만든다.
- 변경 전후를 비교한다.

User
- 값을 확인한다.
- 분석 실행을 승인한다.
- 조정안을 선택한다.
- 모의 실행을 승인한다.
```

---

# 3. Orchestrator Responsibilities

Agent Orchestrator는 직접 투자 판단을 하지 않는다.

다음 역할만 수행한다.

1. 현재 `PlanStatus`를 확인한다.
2. 필요한 도구를 순서대로 호출한다.
3. 도구의 입력값을 검증한다.
4. 결과를 올바른 state 필드에 저장한다.
5. 실패한 단계에서 다음 도구 호출을 중단한다.
6. 사용자에게 실제 작업 상태를 전달한다.
7. 사용자 승인 여부를 확인한다.
8. 계획 수정 시 이전 결과를 무효화한다.

## 금지

- 여러 도구를 무조건 병렬로 실행
- 필수 데이터가 없는데 시뮬레이션 실행
- Market API 실패 후 fixture 자동 사용
- Claude가 생성한 수치를 simulation 결과로 저장
- 사용자 승인 없이 분석 또는 모의 실행 시작
- 오류가 난 상태에서 성공 화면으로 이동

---

# 4. Tool Registry

| Tool ID | 담당 | 목적 |
|---|---|---|
| `parse_investment_intent` | Claude | 사용자 입력을 계획 구조로 변환 |
| `generate_clarification` | Claude | 가장 우선순위가 높은 추가 질문 생성 |
| `apply_user_answer` | TypeScript | 사용자 답변을 plan state에 반영 |
| `resolve_asset` | Market API | 회사명·티커 확인 |
| `fetch_market_quote` | Market API | 현재가·직전 종가 조회 |
| `fetch_historical_prices` | Market API | 최근 1년 일별 가격 조회 |
| `run_plan_simulation` | TypeScript | 원래 계획 시뮬레이션 |
| `generate_ai_review` | Claude | 계산 결과 기반 위험 설명 |
| `parse_revision_request` | Claude | 사용자의 수정 제약 구조화 |
| `generate_alternative_candidates` | TypeScript | 사용자 제약을 만족하는 후보 생성 |
| `run_alternative_simulations` | TypeScript | 각 후보를 동일 데이터로 검증 |
| `explain_alternatives` | Claude | 조정안 이름·장단점 설명 |
| `build_plan_comparison` | TypeScript | 기존 계획과 조정안 비교 |
| `build_agent_replay` | TypeScript | 최종 계획의 과거 이벤트 재생 생성 |

---

# 5. Execution Phases

# Phase A. Plan Discovery

```text
사용자 입력
→ parse_investment_intent
→ plan state 업데이트
→ missingFields 확인
→ generate_clarification
→ 사용자 응답
→ apply_user_answer
→ 필수 조건 완료까지 반복
```

# Phase B. Analysis

```text
사용자 분석 승인
→ resolve_asset
→ fetch_market_quote
→ fetch_historical_prices
→ run_plan_simulation
→ generate_ai_review
→ 분석 워크스페이스 표시
```

# Phase C. Revision

```text
사용자 수정 요청
→ parse_revision_request
→ 누락된 제약 확인
→ generate_alternative_candidates
→ run_alternative_simulations
→ 제약 위반 후보 제거
→ explain_alternatives
→ build_plan_comparison
→ 비교 화면 표시
```

# Phase D. Approval and Replay

```text
사용자 조정안 선택
→ 최종 계획 확인
→ 사용자 모의 실행 승인
→ build_agent_replay
→ 과거 Agent Replay 표시
```

---

# 6. Tool Contract: parse_investment_intent

## Tool ID

```text
parse_investment_intent
```

## 담당

Claude

## 목적

사용자의 자연어 투자 생각에서
명시적으로 확인 가능한 값만 추출한다.

## Input

```typescript
type ParseInvestmentIntentInput = {
  userText: string;

  currentPlan: InvestmentPlan | null;

  conversationSummary?: string | null;

  supportedMarket: "US";

  supportedActionTypes: [
    "recurring_buy",
    "conditional_buy",
    "conditional_sell"
  ];
};
```

## Output

```typescript
type ParseInvestmentIntentOutput = {
  extractedFields: ExtractedPlanField[];

  unresolvedExpressions: UnresolvedExpression[];

  missingFields: MissingPlanField[];

  assetQuery: string | null;

  intentSummary: string;

  needsClarification: boolean;
};
```

## Extracted Plan Field

```typescript
type ExtractedPlanField = {
  fieldPath: string;

  value:
    | string
    | number
    | MoneyAmount
    | null;

  sourceText: string;

  confidence: "high" | "medium" | "low";

  status: "ai_extracted";
};
```

## Unresolved Expression

```typescript
type UnresolvedExpression = {
  sourceText: string;

  category:
    | "amount"
    | "frequency"
    | "threshold"
    | "ratio"
    | "timing"
    | "asset";

  reason: string;
};
```

## Example Input

```json
{
  "userText": "애플을 꾸준히 사고 싶은데 가격이 떨어지면 조금 더 사고 싶어.",
  "currentPlan": null,
  "supportedMarket": "US",
  "supportedActionTypes": [
    "recurring_buy",
    "conditional_buy",
    "conditional_sell"
  ]
}
```

## Example Output

```json
{
  "extractedFields": [
    {
      "fieldPath": "asset.query",
      "value": "애플",
      "sourceText": "애플",
      "confidence": "high",
      "status": "ai_extracted"
    },
    {
      "fieldPath": "recurringAction.type",
      "value": "recurring_buy",
      "sourceText": "꾸준히 사고",
      "confidence": "medium",
      "status": "ai_extracted"
    },
    {
      "fieldPath": "conditionalActions[0].type",
      "value": "conditional_buy",
      "sourceText": "가격이 떨어지면 조금 더 사고 싶어",
      "confidence": "medium",
      "status": "ai_extracted"
    }
  ],
  "unresolvedExpressions": [
    {
      "sourceText": "꾸준히",
      "category": "frequency",
      "reason": "정확한 매수 주기가 필요함"
    },
    {
      "sourceText": "떨어지면",
      "category": "threshold",
      "reason": "기준 가격과 하락률이 필요함"
    },
    {
      "sourceText": "조금 더",
      "category": "amount",
      "reason": "추가 매수 금액이 필요함"
    }
  ],
  "missingFields": [
    {
      "fieldPath": "recurringAction.frequency",
      "reason": "required_for_plan",
      "priority": 1
    },
    {
      "fieldPath": "recurringAction.amount",
      "reason": "required_for_plan",
      "priority": 1
    }
  ],
  "assetQuery": "애플",
  "intentSummary": "애플을 정기적으로 매수하고 가격 하락 시 추가 매수하려는 계획",
  "needsClarification": true
}
```

## Validation Rules

- 사용자 문장에 없는 숫자는 생성하지 않는다.
- 종목이 명확하지 않으면 후보를 임의 선택하지 않는다.
- `꾸준히`, `조금`, `많이`, `적당히`를 숫자로 변환하지 않는다.
- 한 문장에서 여러 조건이 확인되면 모두 추출한다.
- 기존 plan이 있으면 수정된 필드만 반환한다.
- 기존 사용자 확정값을 임의로 덮어쓰지 않는다.

---

# 7. Tool Contract: generate_clarification

## Tool ID

```text
generate_clarification
```

## 담당

Claude

## 목적

현재 계획에서 가장 우선순위가 높은
누락 정보 하나에 대한 질문을 만든다.

## Input

```typescript
type GenerateClarificationInput = {
  plan: InvestmentPlan;
  missingFields: MissingPlanField[];
  previousQuestions: ClarificationQuestion[];
};
```

## Output

```typescript
type GenerateClarificationOutput = {
  question: ClarificationQuestion | null;
  planReadyForReview: boolean;
};
```

## Selection Priority

```text
1. 종목
2. 정기 매수 주기와 금액
3. 추가 매수 기준
4. 임계 하락률 또는 상승률
5. 주문 금액 또는 매도 비율
6. 평균 매수가 등 기준 가격
7. 사용자가 직접 언급한 예산 제약
```

## Example Output

```json
{
  "question": {
    "id": "question_recurring_amount",
    "fieldPath": "recurringAction.amount",
    "question": "정기적으로 얼마씩 사고 싶은가요?",
    "reason": "투자 금액을 알면 월별 자금 부담을 계산할 수 있어요.",
    "inputType": "money",
    "required": true,
    "options": [
      {
        "id": "option_30000_weekly",
        "label": "매주 30,000원",
        "value": 30000,
        "unit": "KRW"
      },
      {
        "id": "option_50000_weekly",
        "label": "매주 50,000원",
        "value": 50000,
        "unit": "KRW"
      }
    ]
  },
  "planReadyForReview": false
}
```

## Rules

- 한 번에 질문 하나만 반환한다.
- 같은 필드를 반복 질문하지 않는다.
- 질문 이유는 한 문장으로 작성한다.
- 선택지는 예시이며 사용자가 직접 입력할 수 있어야 한다.
- 빠른 선택값은 투자 추천으로 표현하지 않는다.
- 필수 조건이 완료되면 질문 대신 `planReadyForReview: true`를 반환한다.

---

# 8. Tool Contract: apply_user_answer

## Tool ID

```text
apply_user_answer
```

## 담당

TypeScript

## 목적

사용자의 답변을 검증하고
InvestmentPlan의 정확한 필드에 반영한다.

## Input

```typescript
type ApplyUserAnswerInput = {
  plan: InvestmentPlan;
  question: ClarificationQuestion;
  answer: string | number | MoneyAmount;
};
```

## Output

```typescript
type ApplyUserAnswerOutput = {
  updatedPlan: InvestmentPlan;
  appliedFieldPath: string;
  valid: boolean;
  validationError: string | null;
  invalidationTargets: InvalidationTarget[];
};
```

## Rules

- 숫자 입력은 `FieldValidation`을 따른다.
- 통화 단위를 명시적으로 저장한다.
- 적용한 필드는 `user_confirmed` 상태로 변경한다.
- plan version을 1 증가시킨다.
- 관련 missing field를 제거한다.
- 기존 분석이 있으면 invalidation target을 반환한다.
- 답변이 질문과 맞지 않으면 적용하지 않는다.

---

# 9. Tool Contract: resolve_asset

## Tool ID

```text
resolve_asset
```

## 담당

Market API Adapter

## 목적

사용자가 입력한 회사명 또는 티커를
지원하는 미국주식 종목으로 확인한다.

## Input

```typescript
type ResolveAssetInput = {
  query: string;
  market: "US";
};
```

## Output

```typescript
type ResolveAssetOutput = {
  status:
    | "single_match"
    | "multiple_matches"
    | "not_found";

  matches: AssetCandidate[];

  provider: string;
  fetchedAt: string;
};
```

## Rules

- 단일 결과라도 사용자가 입력한 내용과 명백히 다르면 자동 확정하지 않는다.
- 다중 결과는 사용자에게 선택하게 한다.
- 한글 회사명은 지원 가능한 경우 티커로 해석한다.
- 지원하지 않는 시장은 오류로 반환한다.
- Claude가 종목 티커를 추측해 확정하지 않는다.

## Example

```json
{
  "status": "single_match",
  "matches": [
    {
      "symbol": "AAPL",
      "companyName": "Apple Inc.",
      "exchange": "NASDAQ",
      "market": "US",
      "currency": "USD"
    }
  ],
  "provider": "finnhub",
  "fetchedAt": "2026-07-28T10:20:00+09:00"
}
```

---

# 10. Tool Contract: fetch_market_quote

## Tool ID

```text
fetch_market_quote
```

## 담당

Market API Adapter

## Input

```typescript
type FetchMarketQuoteInput = {
  symbol: string;
};
```

## Output

```typescript
type FetchMarketQuoteOutput = {
  quote: MarketQuote;

  source: MarketDataSource;

  fetchedAt: string;

  isDelayed: boolean;
  delayDescription: string | null;
};
```

## Validation

- 가격은 0보다 커야 한다.
- `marketTimestamp`가 있어야 한다.
- 현재가와 직전 종가를 구분한다.
- API 응답 시각과 시장 데이터 시각을 구분한다.
- 데이터 지연 여부를 UI에 전달한다.

---

# 11. Tool Contract: fetch_historical_prices

## Tool ID

```text
fetch_historical_prices
```

## 담당

Market API Adapter

## 목적

시뮬레이션에 사용할
최근 1년 일별 가격을 조회한다.

## Input

```typescript
type FetchHistoricalPricesInput = {
  symbol: string;

  resolution: "1D";

  requestedRange: DateRange;
};
```

## Output

```typescript
type FetchHistoricalPricesOutput = {
  candles: DailyCandle[];

  requestedRange: DateRange;
  actualRange: DateRange;

  tradingDayCount: number;

  source: MarketDataSource;
  fetchedAt: string;

  completeness:
    | "complete"
    | "partial"
    | "insufficient";
};
```

## Validation

- 날짜 오름차순으로 정렬한다.
- 중복 날짜를 제거한다.
- OHLC 값이 유효한지 검증한다.
- 데이터가 지나치게 부족하면 시뮬레이션을 중단한다.
- 일부 기간만 존재하면 사용자에게 실제 분석 기간을 표시한다.
- 빈 배열을 성공 결과로 처리하지 않는다.

---

# 12. Tool Contract: run_plan_simulation

## Tool ID

```text
run_plan_simulation
```

## 담당

TypeScript Simulation Engine

## 목적

사용자가 승인한 계획을
과거 일별 가격에서 재현 가능하게 실행한다.

## Input

```typescript
type RunPlanSimulationInput = {
  input: SimulationInput;
};
```

## Output

```typescript
type RunPlanSimulationOutput = {
  result: SimulationResult;

  warnings: SimulationWarning[];

  success: boolean;
};
```

## Simulation Warning

```typescript
type SimulationWarning = {
  code:
    | "PARTIAL_MARKET_DATA"
    | "NO_CONDITIONAL_TRIGGER"
    | "MISSING_GUARDRAIL"
    | "BUDGET_EXCEEDED"
    | "REVIEW_TRIGGER_NOT_DEFINED";

  message: string;
};
```

## Calculation Order

각 거래일마다 다음 순서를 따른다.

```text
1. recurring action 확인 및 실행
2. review drawdown 조건 평가
3. review_triggered 이벤트 기록
4. pause 정책이면 같은 날부터 conditional action 정지
5. conditional crossing 평가
6. conditional action 실행 또는 차단
7. 월별 집계 갱신
8. SimulationEvent 저장
```

**재검토 평가가 conditional action 보다 먼저 온다.** 사용자 계약이 "재검토 조건이 발생하면
**추가 매수 전에** 계획을 다시 확인한다"이기 때문이다. conditional action 을 먼저 처리하면
`pause_future_conditional_actions` 정책에서도 재검토 발생일의 추가 매수가 그대로 실행되어
계약과 어긋난다.

평균 매수가 갱신 단계는 없다. §13 "평균 매수가" 의 고정 기준가 정책 때문이다
(사용자 입력값을 시뮬레이션 내내 갱신하지 않는다).

## Review Trigger Behavior

### flag_only

- `review_triggered` 이벤트를 기록한다.
- 같은 날 conditional action 은 기존 정책(월 예산·횟수 제한)에 따라 **실행 가능**하다.
- 이후 conditional action 도 유지된다.

### pause_future_conditional_actions

- `review_triggered` 이벤트를 먼저 기록한다.
- **같은 날 conditional action 부터** `blockedBy: "review_trigger"` 로 차단한다.
- 이후 conditional action 도 계속 차단한다.
- **recurring action 은 계속 실행한다.** 재검토는 추가 매수 판단을 멈추는 장치이고,
  적립식 매수를 멈추는 장치가 아니다.

`conditional_buy_blocked` 는 conditional crossing 이 발생한 날에만 만든다. 정지 상태라도
그 날 조건이 발생하지 않았다면 차단 이벤트를 만들지 않는다.

## Budget Exceeded Cause

`budgetExceededMonthCount` 만 전달하면 AI 가 초과 원인을 잘못 설명할 수 있다. 실데이터
검증에서 실제로 그런 상황이 나왔다 — 월 예산 200,000원 · 매주 월요일 50,000원 계획에서 초과
4개월이 모두 **월요일이 5번 있는 달의 정기 매수만으로** 발생했고, 추가 매수는 관여하지 않았다.

따라서 원인을 **계산 필드로 제공**하고, Claude 는 이 필드를 읽기만 한다. 원인을 추론하지 않는다.

월별 결과(`MonthlySimulationResult`) 판정 — **월 최종 집계** 기준:

```text
1. 예산 미설정                                → budgetExceeded=false, cause=null
2. recurringInvestmentKrw > 예산              → cause="recurring_only"
3. recurring ≤ 예산 && total > 예산           → cause="conditional_action"
4. total ≤ 예산                               → budgetExceeded=false, cause=null
```

한 달에 두 원인이 동시에 기록되지 않는다.

요약(`SimulationSummary`) 불변 조건:

```text
budgetExceededMonthCount
=== recurringOnlyBudgetExceededMonthCount + conditionalCausedBudgetExceededMonthCount
```

`monthly_budget_exceeded` 이벤트는 `cause`, 금액 분해, `triggeredByEventId`(초과 상태를 처음
만든 실행 이벤트)를 함께 담는다. 자세한 정의는
[`STRATEGY_SCHEMA_V2.md`](../STRATEGY_SCHEMA_V2.md) §20–21 참고.

### generate_ai_review 가 구분해야 하는 세 경우

| Case | 읽는 필드 |
| --- | --- |
| A. 정기 매수만으로 초과한 달이 있음 | `recurringOnlyBudgetExceededMonthCount > 0` |
| B. 추가 매수 때문에 초과한 달이 있음 | `conditionalCausedBudgetExceededMonthCount > 0` |
| C. 초과 없음 | `budgetExceededMonthCount === 0` |

## First Candle Handling

첫 candle 처리는 conditional trigger 와 review trigger 가 **다르다.**

### conditional trigger — 기존 정책 유지

첫 candle 의 종가가 conditional threshold 이하여도 **conditional trigger 로 세지 않는다.**
초기 상태로만 기록한다.

### review trigger — 첫 candle 침범을 인정

첫 candle 의 종가가 review trigger price 이하이면:

```text
- review_triggered 이벤트 생성
- initialState: true
- previousClose: null   (비교할 이전 거래일이 없음)
- reviewTriggeredCount 에 포함
- pause 정책이면 첫날부터 conditional action 정지
```

첫 candle 이 review 기준 위에 있으면 이후에는 일반 crossing 방식으로 탐지하며,
그렇게 발생한 이벤트는 `initialState: false` 다.

### 왜 다른가

- **conditional trigger 는 관찰 기간 안에서 새로 발생한 사건**이다. 근거는 "기준가에서 N%
  내려오는 사건"이므로, 관찰 시작 시점에 이미 아래에 있었다면 그 하락은 관찰 구간 안의
  사건이 아니다. 이를 매수 신호로 세면 데이터 시작일을 언제로 잡느냐에 따라 매수 횟수가 달라진다.
- **review trigger 는 지금 이미 재검토가 필요한 상태인지 확인하는 조건**이다. 사건이 아니라
  상태이므로, 손실이 관찰 시작 전에 발생했든 도중에 발생했든 추가 매수 전에 확인이 필요한
  상태는 같다. 시작 시점부터 물려 있는 계획을 "재검토 사유 없음"으로 넘기면 안전장치가 가장
  필요한 경우를 놓친다.

## Required Outputs

- 정기 매수 횟수
- 조건 발생 횟수
- 조건 실행 횟수
- 조건 차단 횟수
- 월별 투자 금액
- 월 최대 투자 금액
- 예산 초과 개월
- **예산 초과 원인 분해** (`recurring_only` / `conditional_action` 개월 수)
- 조건 발생 후 추가 하락폭
- 재검토 이벤트
- 차트 마커
- Replay 생성에 필요한 events

## Rules

- 동일 input은 동일 output을 반환한다.
- Claude API를 호출하지 않는다.
- 시스템 현재 시각에 따라 결과가 달라지지 않게 한다.
- 금액 반올림 정책을 고정한다.
- 시장 휴장일 처리 정책을 고정한다.
- 모든 calculation policy를 결과와 함께 기록한다.

---

# 13. Simulation Calculation Assumptions

프로토타입에서 계산 기준을 숨기지 않는다.

## 이 시뮬레이션의 성격: Historical Condition Replay

정식 백테스트가 아니다. 최근 1년 가격에 현재 조건을 적용해 **조건 발생 시점**과
**모의 실행 이벤트**를 확인한다.

```text
사용자가 입력한 평균 매수가를 고정 기준으로 사용해
최근 가격에서 조건 발생 시점을 확인합니다.
실제 체결 수량, 환율, 평균 매수가 변화는 반영하지 않습니다.
```

구현하지 않는 것: 실제 주식 수량 · 환율 · 동적 평균 매수가 · 실제 체결 · 투자 수익률.

따라서 "이 전략을 1년 동안 실행했다면", "실제 투자 성과", "백테스트 수익률",
"실제 매수 결과", "수익성 검증" 같은 표현을 쓰지 않는다.

## 정기 매수 날짜

```text
사용자가 요일을 지정하지 않으면 월요일을 기본값으로 제안한다.
사용자 승인 전에는 확정하지 않는다.
휴장일이면 다음 거래일에 실행한다.
```

## 매수가

```text
일별 종가를 모의 체결 가격으로 사용한다.
```

## 환율

```text
KRW 주문 금액과 USD 가격 간 실제 주식 수량 계산은 MVP에서 제외한다.
```

따라서 프로토타입의 주요 계산은 다음에 집중한다.

- 실행 횟수
- KRW 투자 금액
- 예산 초과 여부
- 가격 조건 발생 여부

## 평균 매수가 — 고정 기준가

사용자가 입력한 평균 매수가를 **시뮬레이션 내내 갱신하지 않는 고정 기준가**로 사용한다.

MVP는 KRW 투자 금액을 USD 주식 수량으로 환산하지 않는다. 수량을 모르면 가중평균 매수가를
계산할 수 없고, 여기서 임의의 환율이나 수량을 가정하면 사용자에게 근거 없는 숫자를 보여주게
된다. 그래서 갱신을 아예 하지 않는다.

- 정기 매수·추가 매수가 발생해도 기준가는 그대로다.
- conditional buy 와 review drawdown 은 **같은 고정 기준가**를 참조한다.
- 모든 SimulationEvent 에서 `averageCostBefore === averageCostAfter` 다.

이 방식을 사용했다는 사실을 Process 페이지와 분석 화면에 명시한다.

## 조건 발생 후 추가 하락

조건 발생일 이후 일정 기간의 최저 종가를 사용한다.

기본 관찰 기간:

```text
다음 20거래일
```

계산:

```text
(관찰 기간 최저 종가 - 조건 발생일 종가)
÷ 조건 발생일 종가 × 100
```

---

# 14. Tool Contract: generate_ai_review

## Tool ID

```text
generate_ai_review
```

## 담당

Claude

## 목적

InvestmentPlan과 SimulationResult를 바탕으로
사용자가 이해할 수 있는 위험 설명을 만든다.

## Input

```typescript
type GenerateAIReviewInput = {
  plan: InvestmentPlan;

  marketDataSummary: {
    symbol: string;
    companyName: string;
    currentPrice: number;
    previousClose: number;
    changePercent: number;
    marketTimestamp: string;
    isDelayed: boolean;
  };

  simulationSummary: SimulationSummary;

  notableEvents: SimulationEvent[];

  warnings: SimulationWarning[];

  allowedEvidenceRefs: EvidenceReference[];
};
```

## Output

```typescript
type GenerateAIReviewOutput = {
  review: AIReview;

  validation: {
    allClaimsGrounded: boolean;
    invalidEvidenceRefs: string[];
    unsupportedNumericClaims: string[];
  };
};
```

## Required Sections

- 핵심 요약
- 위험 항목
- 계획을 유지할 수 있는 점
- 다시 생각할 점
- 각 문장의 근거 참조

## Rules

- input에 없는 숫자를 생성하지 않는다.
- 미래 가격이나 수익률을 예측하지 않는다.
- 안전·위험을 단정하지 않는다.
- 사용자의 종목 선택을 평가하지 않는다.
- 모든 위험 항목은 `evidenceRefs`를 포함해야 한다.
- 근거가 없는 항목은 출력하지 않는다.
- 계획의 장점과 위험을 균형 있게 보여준다.

## Invalid Example

```text
애플은 앞으로 상승할 가능성이 높아요.
이 계획은 장기적으로 안전한 전략이에요.
```

## Valid Example

```text
최근 1년 가격에서 추가 매수 조건이
한 달에 최대 {maxMonthlyConditionalExecutionCount}번 발생했어요.

현재 계획에는 월별 추가 매수 횟수 제한이 없어
짧은 기간에 투자 금액이 커질 수 있어요.
```

> 중괄호 자리에는 시뮬레이션 결과값이 들어간다. Claude 가 숫자를 만들지 않는다.

---

# 15. Tool Contract: parse_revision_request

## Tool ID

```text
parse_revision_request
```

## 담당

Claude

## 목적

사용자가 유지하려는 조건과
변경하려는 제약을 분리한다.

## Input

```typescript
type ParseRevisionRequestInput = {
  userText: string;

  originalPlan: InvestmentPlan;

  originalSimulation: SimulationResult;
};
```

## Output

```typescript
type ParseRevisionRequestOutput = {
  revisionRequest: RevisionRequest;

  needsClarification: boolean;

  clarificationQuestion: ClarificationQuestion | null;
};
```

## Example Input

```text
정기 매수는 유지하면서
한 달에 20만 원을 넘지 않게 해줘.
```

## Example Output

```json
{
  "revisionRequest": {
    "id": "revision_001",
    "originalText": "정기 매수는 유지하면서 한 달에 20만 원을 넘지 않게 해줘.",
    "preserveConstraints": [
      {
        "type": "preserve_recurring_amount",
        "value": {
          "value": 50000,
          "currency": "KRW",
          "orderUnit": "cash_amount"
        }
      },
      {
        "type": "preserve_recurring_frequency",
        "value": "weekly"
      }
    ],
    "changeConstraints": [
      {
        "type": "monthly_budget_max",
        "value": {
          "value": 200000,
          "currency": "KRW",
          "orderUnit": "cash_amount"
        }
      }
    ],
    "missingConstraints": [],
    "userConfirmed": false
  },
  "needsClarification": false,
  "clarificationQuestion": null
}
```

## Rules

- `유지`, `그대로`, `바꾸지 말고`는 preserve constraint로 분류한다.
- `넘지 않게`, `최대`, `까지만`은 upper constraint로 분류한다.
- `적당히`, `너무 많이`처럼 숫자가 없으면 질문한다.
- 기존 계획에 없는 조건을 사용자 요청 없이 추가하지 않는다.
- 사용자의 요청이 논리적으로 충돌하면 충돌을 반환한다.

---

# 16. Tool Contract: generate_alternative_candidates

## Tool ID

```text
generate_alternative_candidates
```

## 담당

TypeScript Alternative Generator

## 목적

사용자의 제약을 만족할 가능성이 있는
서로 다른 우선순위의 후보 계획을 생성한다.

Claude가 숫자를 직접 결정하지 않는다.

## Input

```typescript
type GenerateAlternativeCandidatesInput = {
  originalPlan: InvestmentPlan;

  revisionRequest: RevisionRequest;

  candidatePolicies: AlternativePolicy[];
};
```

## Alternative Policy

```typescript
type AlternativePolicy =
  | "preserve_recurring_plan"
  | "preserve_conditional_capacity"
  | "minimize_monthly_spend";
```

## Output

```typescript
type GenerateAlternativeCandidatesOutput = {
  candidates: InvestmentPlan[];

  rejectedCandidates: RejectedAlternativeCandidate[];
};
```

## Rejected Candidate

```typescript
type RejectedAlternativeCandidate = {
  policy: AlternativePolicy;
  reason: string;
};
```

## Candidate A: Preserve Recurring Plan

유지 우선순위:

```text
정기 매수 주기
정기 매수 금액
```

조정 가능:

```text
추가 매수 횟수
추가 매수 실행 조건
월 예산 차단 정책
재검토 기준
```

## Candidate B: Preserve Conditional Capacity

유지 우선순위:

```text
추가 매수 금액
추가 매수 기회
```

조정 가능:

```text
정기 매수 금액
정기 매수 주기
월 추가 매수 제한
```

## Rules

- 최소 2개의 서로 다른 후보를 만든다.
- 사용자가 preserve로 지정한 값은 변경하지 않는다.
- 후보의 차이가 숫자 하나에 그치지 않게 한다.
- 임의의 비정상적인 금액 단위를 만들지 않는다.
- 후보 생성 규칙을 코드로 고정한다.
- 모든 후보는 다음 단계에서 다시 시뮬레이션해야 한다.

---

# 17. Tool Contract: run_alternative_simulations

## Tool ID

```text
run_alternative_simulations
```

## 담당

TypeScript Simulation Engine

## Input

```typescript
type RunAlternativeSimulationsInput = {
  candidates: InvestmentPlan[];

  marketData: MarketDataBundle;

  revisionRequest: RevisionRequest;

  simulationPeriod: DateRange;
};
```

## Output

```typescript
type RunAlternativeSimulationsOutput = {
  validAlternatives: PlanAlternative[];

  invalidAlternatives: PlanAlternative[];
};
```

## Validation

각 후보는 다음 조건을 통과해야 한다.

- 사용자의 preserve constraint를 유지함
- 사용자의 change constraint를 만족함
- 시뮬레이션 실행에 필요한 필드가 존재함
- 월 최대 예산을 초과하지 않음
- 음수 또는 0원 주문 금액이 없음
- 실행 불가능한 주기 조합이 없음

## 노출 규칙

다음 조건이면 사용자에게 노출하지 않는다.

```text
satisfiesUserConstraints = false
constraintViolations.length > 0
simulation 실패
원래 계획과 실질적인 차이가 없음
```

---

# 18. Tool Contract: explain_alternatives

## Tool ID

```text
explain_alternatives
```

## 담당

Claude

## 목적

코드로 계산된 조정안에
이름과 장단점을 붙인다.

## Input

```typescript
type ExplainAlternativesInput = {
  originalPlan: InvestmentPlan;
  originalSimulation: SimulationResult;

  alternatives: Array<{
    plan: InvestmentPlan;
    simulation: SimulationResult;
    priority: PlanAlternative["priority"];
    changedFields: ChangedField[];
  }>;
};
```

## Output

```typescript
type ExplainAlternativesOutput = {
  explanations: Array<{
    alternativeId: string;
    name: string;
    summary: string;
    benefit: string;
    tradeOff: string;
  }>;

  validation: {
    unsupportedClaims: string[];
  };
};
```

## Rules

- `최적`, `추천`, `가장 좋은`이라는 표현을 사용하지 않는다.
- 조정안 간 우선순위 차이를 설명한다.
- 변경되지 않은 값은 유지됐다고 설명한다.
- 수익률이나 미래 성과를 비교하지 않는다.
- 코드 계산 결과에 없는 숫자를 추가하지 않는다.
- 장점과 trade-off를 함께 제공한다.

---

# 19. Tool Contract: build_plan_comparison

## Tool ID

```text
build_plan_comparison
```

## 담당

TypeScript

## 목적

원래 계획과 조정안을
동일한 지표 기준으로 비교한다.

## Input

```typescript
type BuildPlanComparisonInput = {
  originalPlan: InvestmentPlan;
  originalSimulation: SimulationResult;

  alternatives: PlanAlternative[];
};
```

## Output

```typescript
type BuildPlanComparisonOutput = {
  comparison: PlanComparison;
};
```

## Required Metrics

- 정기 매수 금액
- 월 최대 투자 금액
- 추가 매수 실행 횟수
- 추가 매수 차단 횟수
- 예산 초과 개월
- 재검토 이벤트 횟수
- 재검토 기준
- 실행되지 않는 조건 수

## Rules

- 모든 계획에 동일한 분석 기간을 사용한다.
- 동일한 market candle 데이터를 사용한다.
- 비교 값은 TypeScript 계산 결과만 사용한다.
- 원래 계획을 숨기지 않는다.
- 자동으로 우승안을 선택하지 않는다.

---

# 20. Tool Contract: build_agent_replay

## Tool ID

```text
build_agent_replay
```

## 담당

TypeScript

## 목적

사용자가 선택한 최종 계획의 SimulationEvent를
이해 가능한 과거 Agent Replay로 변환한다.

## Input

```typescript
type BuildAgentReplayInput = {
  selectedPlan: InvestmentPlan;
  selectedSimulation: SimulationResult;
};
```

## Output

```typescript
type BuildAgentReplayOutput = {
  replay: AgentReplay;
};
```

## Event Mapping

```text
recurring_buy_executed
→ 정기 매수 이벤트

conditional_buy_executed
→ 추가 매수 실행 이벤트

conditional_buy_blocked
→ 안전장치로 실행하지 않은 이벤트

monthly_budget_exceeded
→ 예산 확인 이벤트

review_triggered
→ 계획 재검토 이벤트
```

## Replay Copy Templates

### Recurring Buy

```text
정기 매수일이에요.

{amount} 모의 매수
이번 달 투자 금액 {monthlyInvestment}
```

### Conditional Buy

```text
추가 매수 조건이 발생했어요.

{amount} 모의 매수
이번 달 추가 매수 {executionIndex}회 사용
```

### Blocked by Execution Limit

```text
추가 매수 조건이 다시 발생했어요.

이번 달 추가 매수 한도를 사용해
이번 조건은 실행하지 않아요.
```

### Review Trigger

```text
계획 재검토 조건이 발생했어요.

추가 매수를 멈추고
계획을 다시 확인해야 해요.
```

## Rules

- Replay는 SimulationEvent에서만 생성한다.
- 존재하지 않는 이벤트를 AI가 추가하지 않는다.
- 실행과 차단을 명확히 구분한다.
- 수익 또는 손실 결과를 강조하지 않는다.
- 타임라인은 날짜 오름차순으로 정렬한다.

---

# 21. Human-in-the-Loop Checkpoints

Agent가 자동으로 다음 단계로 넘어가면 안 되는 지점이다.

## Checkpoint 1. 계획 확인

```text
대화로 구조화한 계획이 맞는지 사용자 확인
```

사용자 승인:

```text
실제 데이터로 검토하기
```

## Checkpoint 2. 수정 제약 확인

```text
AI가 해석한 유지 조건과 변경 조건 확인
```

예시:

```text
정기 매수는 유지하고
월 최대 투자 금액은 200,000원으로 제한할게요.
```

## Checkpoint 3. 조정안 선택

```text
AI가 자동 선택하지 않고 사용자가 직접 선택
```

## Checkpoint 4. 모의 실행 승인

```text
과거 시뮬레이션이며 실제 주문이 아니라는 점 확인
```

---

# 22. Agent Activity Events

UI에서 Agent 작업 상태를 보여주기 위한 이벤트다.

```typescript
type AgentActivityEvent = {
  id: string;

  step:
    | "intent_parsing"
    | "asset_resolution"
    | "quote_fetch"
    | "historical_data_fetch"
    | "simulation"
    | "ai_review"
    | "revision_parsing"
    | "alternative_generation"
    | "alternative_simulation"
    | "comparison"
    | "replay_build";

  status:
    | "pending"
    | "running"
    | "completed"
    | "failed";

  label: string;

  tool:
    | "claude"
    | "market_api"
    | "simulation_engine";

  startedAt: string | null;
  completedAt: string | null;

  errorCode?: string | null;
};
```

## UI 표시 문구

```text
애플 AAPL을 확인했어요.
현재 시장 가격을 불러왔어요.
최근 1년 거래일 데이터를 확인했어요.
입력한 조건을 과거 가격에서 실행하고 있어요.
확인할 위험과 조정 방법을 정리하고 있어요.
```

## 원칙

- 실제 상태와 일치해야 한다.
- 완료되지 않은 단계를 완료로 표시하지 않는다.
- 예상 완료 시간을 확정적으로 말하지 않는다.
- 내부 Chain of Thought를 노출하지 않는다.
- 도구 이름과 역할만 표시한다.

---

# 23. Error Handling

## Error Propagation

```text
Tool Error
→ ProductError 생성
→ AgentActivityEvent failed
→ Orchestrator 중단
→ 사용자 오류 화면
→ 재시도 또는 이전 단계 이동
```

## Retry Policy

### Claude

- 일시적 네트워크 오류: 최대 1회 재시도
- JSON 스키마 오류: 형식 수정 요청 1회
- 두 번째 실패: 사용자에게 오류 표시

### Market API

- 일시적 오류: 최대 1회 재시도
- 데이터 없음: 재시도하지 않고 명시적 오류
- rate limit: 오류와 재시도 가능 시점 표시

### Simulation Engine

- 자동 재시도하지 않는다.
- 입력값과 계산 단계 오류를 기록한다.
- 사용자 입력 또는 개발 오류로 분리한다.

## 금지

- 무한 재시도
- 사용자에게 오류를 숨김
- 실제 API 실패 후 fixture 반환
- 빈 응답을 성공으로 처리
- AI 리뷰 실패 시 미리 작성한 리뷰 노출

---

# 24. Security and Privacy

- API 키를 클라이언트 코드에 노출하지 않는다.
- `.env.local`을 Git에 포함하지 않는다.
- 사용자 입력을 로그에 무제한 저장하지 않는다.
- 실제 계좌번호와 개인정보를 수집하지 않는다.
- 프로토타입에 증권 계좌 연결 기능을 넣지 않는다.
- Claude 요청에는 시뮬레이션에 필요한 최소 데이터만 전달한다.
- 기술 로그에 전체 사용자 입력을 반복 노출하지 않는다.
- GitHub README와 Process 페이지에 키 값을 포함하지 않는다.

---

# 25. Observability

각 도구 호출은 다음 정보를 기록한다.

```typescript
type AgentToolLog = {
  id: string;

  toolId: string;
  provider: string;

  startedAt: string;
  completedAt: string | null;

  latencyMs: number | null;

  status:
    | "success"
    | "failure";

  inputSchemaVersion: string;
  outputSchemaVersion: string;

  planId: string | null;
  planVersion: number | null;

  errorCode?: string | null;
};
```

## 기록하지 않는 것

- API 키
- Authorization header
- 전체 Claude 응답 원문
- 불필요한 개인정보
- 내부 Chain of Thought

---

# 26. AI Evaluation Checks

Claude 결과는 화면에 표시하기 전에 검증한다.

## Intent Parsing

- 사용자 문장에 없는 숫자가 생성되지 않았는가
- 종목을 잘못 확정하지 않았는가
- 이미 확인한 사용자 값을 변경하지 않았는가
- 모호한 표현이 질문 대상으로 남았는가

## AI Review

- 모든 수치가 SimulationResult에 존재하는가
- 각 위험에 EvidenceReference가 있는가
- 미래 수익률을 예측하지 않았는가
- 계획을 안전하거나 위험하다고 단정하지 않았는가
- 장점과 위험을 함께 설명했는가

## Revision Parsing

- 유지 조건과 변경 조건이 분리됐는가
- 사용자가 말하지 않은 제약이 추가되지 않았는가
- 숫자가 없는 요청을 임의로 채우지 않았는가

## Alternative Explanation

- 조정안의 실제 변경값과 설명이 일치하는가
- `최적`, `추천` 표현이 없는가
- 각 대안의 trade-off가 포함됐는가
- 사용자 제약을 위반한 조정안을 설명하지 않았는가

---

# 27. Prototype Test Cases

## Test 1. 불완전한 계획

```text
애플을 꾸준히 사고 싶어.
```

기대:

- 종목 애플 추출
- recurring buy 의도 추출
- 주기와 금액 질문
- 숫자 임의 생성 없음

## Test 2. 완성된 계획

```text
애플을 매주 5만 원씩 사고,
평균 매수가보다 3% 떨어지면 2만 원 더 사고 싶어.
```

기대:

- 확인된 조건을 다시 묻지 않음
- 평균 매수가만 질문
- 계획 카드 즉시 구성

## Test 3. 모호한 계획

```text
테슬라를 천천히 모으다가
많이 오르면 좀 팔고 싶어.
```

기대:

- `천천히`, `많이`, `좀`을 숫자로 바꾸지 않음
- 주기, 금액, 상승률, 매도 비율 질문

## Test 4. 예산 조정

```text
정기 매수는 유지하면서
월 20만 원을 넘지 않게 해줘.
```

기대:

- 정기 매수 주기와 금액 preserve
- 월 예산 200,000원 constraint
- 최소 2개 후보 생성
- 모든 노출 후보가 예산 제약 충족

## Test 5. 충돌하는 제약

```text
매주 5만 원씩 사고 싶은데
월 15만 원은 넘지 않게 해줘.
```

기대:

- 조건 충돌 탐지
- 임의로 주기 또는 금액을 변경하지 않음
- 어느 조건을 조정할지 사용자에게 질문

## Test 6. 데이터 실패

기대:

- Market API 실패 상태 표시
- fixture 자동 사용 없음
- 분석 중단
- 재시도 제공

---

# 28. Implementation Order

실제 코드는 다음 순서로 구현한다.

## 1. Types and State

- `InvestmentCopilotState`
- `InvestmentPlan`
- `ConversationState`
- `SimulationResult`
- `RevisionRequest`
- `PlanAlternative`

## 2. Existing Adapter Reuse

기존 기술 스파이크의 다음 코드를 재사용한다.

- Claude provider adapter
- Finnhub search adapter
- Finnhub quote adapter
- structured output validation
- provider switch
- environment variable handling

## 3. Conversation Tools

- `parse_investment_intent`
- `generate_clarification`
- `apply_user_answer`

## 4. Historical Data Spike

- `fetch_historical_prices`
- 데이터 정규화
- completeness 검증

## 5. Simulation Engine

- recurring events
- conditional triggers
- monthly aggregation
- budget and review events
- deterministic tests

## 6. AI Review

- grounded review prompt
- evidence validation
- unsupported numeric claim validation

## 7. Revision Loop

- `parse_revision_request`
- alternative candidate generation
- alternative simulation
- comparison model

## 8. Replay

- simulation event mapping
- playback controls
- timeline UI

---

# 29. Prototype Completion Contract

다음 조건을 모두 충족해야
Agent Prototype이 작동한다고 본다.

- 사용자 입력이 실제 Claude를 통해 구조화된다.
- 누락된 조건만 순차 질문한다.
- 답변이 실제 plan state에 반영된다.
- 사용자가 계획을 확인하고 분석을 승인한다.
- 실제 Market API에서 종목과 현재 시세를 조회한다.
- 실제 최근 가격 데이터를 조회한다.
- TypeScript가 시뮬레이션을 실행한다.
- AI가 코드 계산 결과만 설명한다.
- 사용자가 자연어로 수정 제약을 입력한다.
- TypeScript가 최소 2개의 조정 후보를 만든다.
- 모든 후보를 같은 데이터로 다시 계산한다.
- 제약을 위반한 후보는 노출하지 않는다.
- 사용자가 계획을 직접 선택한다.
- 최종 계획의 이벤트가 Replay로 표시된다.
- 실제 주문은 실행되지 않는다.
- 오류가 정상 화면으로 숨겨지지 않는다.