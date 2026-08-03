---
title: Strategy Schema
status: decided
---
# 안전 원칙

- 입력되지 않은 숫자는 null로 유지한다.
- null 필드는 사용자에게 추가 질문한다.
- referencePrice는 referenceType과 함께 저장한다.
- 시장 가격 기준 조건은 가격과 timestamp를 함께 고정한다.
- API 오류 시 임의 데이터를 넣지 않는다.

# Strategy

```typescript
type Strategy = { id: string; originalInput: string; symbol: string | null; companyName: string | null; market: "US"; currency: "KRW" | "USD"; conditions: StrategyCondition[]; clarificationQuestions: ClarificationQuestion[]; marketData: MarketData | null; status: "draft" | "needs_clarification" | "ready" | "mock_active"; };```
# Strategy Condition

```typescript
type StrategyCondition =
  | RecurringBuyCondition
  | ConditionalBuyCondition
  | ConditionalSellCondition;
```

# Recurring Buy
```typescript
type RecurringBuyCondition = {
  id: string;
  type: "recurring_buy";
  frequency: "daily" | "weekly" | "monthly";
  amount: number;
  currency: "KRW" | "USD";
  weekday?: number | null;
  startDate?: string | null;
};
```

# Conditional Buy

```typescript
type ConditionalBuyCondition = {
  id: string;
  type: "conditional_buy";
  referenceType:
    | "average_cost"
    | "market_price_at_creation"
    | "previous_close";
  referencePrice: number | null;
  referenceCurrency: "USD";
  direction: "down";
  thresholdPercent: number | null;
  amount: number | null;
  amountCurrency: "KRW" | "USD";
};
```

# Conditional Sell

```typescript
type ConditionalSellCondition = {
  id: string;
  type: "conditional_sell";
  referenceType:
    | "average_cost"
    | "market_price_at_creation"
    | "previous_close";
  referencePrice: number | null;
  referenceCurrency: "USD";
  direction: "up" | "down";
  thresholdPercent: number | null;
  sellRatio: number | null;
};
```

# Clarification Question

```typescript
type ClarificationQuestion = {
  id: string;
  fieldPath: string;
  question: string;
  inputType: "number" | "date" | "select" | "text";
  unit?: "KRW" | "USD" | "%" | null;
  required: true;
};
```

# Market Data


```typescript
type MarketData = {
  symbol: string;
  companyName: string;
  currentPrice: number;
  previousClose: number;
  changePercent: number;
  currency: "USD";
  timestamp: string;
  delayed: boolean;
  source: "finnhub";
};
```
