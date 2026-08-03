/**
 * 제품 도메인 타입.
 *
 * 정식 스키마: docs/product/STRATEGY_SCHEMA.md.
 * 안전 원칙: 입력되지 않은 숫자는 null 유지 → 사용자에게 추가 질문.
 *            기준가 조건은 가격과 timestamp 를 함께 고정. API 오류 시 임의 데이터 금지.
 */

export type Market = "US";
export type Currency = "KRW" | "USD";
export type Frequency = "daily" | "weekly" | "monthly";
export type ReferenceType = "average_cost" | "market_price_at_creation" | "previous_close";

export interface RecurringBuyCondition {
  id: string;
  type: "recurring_buy";
  frequency: Frequency;
  amount: number;
  currency: Currency;
  weekday?: number | null; // 0=일 … 6=토
  startDate?: string | null;
}

export interface ConditionalBuyCondition {
  id: string;
  type: "conditional_buy";
  referenceType: ReferenceType;
  referencePrice: number | null;
  referenceCurrency: "USD";
  direction: "down";
  thresholdPercent: number | null;
  amount: number | null;
  amountCurrency: Currency;
}

export interface ConditionalSellCondition {
  id: string;
  type: "conditional_sell";
  referenceType: ReferenceType;
  referencePrice: number | null;
  referenceCurrency: "USD";
  direction: "up" | "down";
  thresholdPercent: number | null;
  sellRatio: number | null;
}

export type StrategyCondition =
  | RecurringBuyCondition
  | ConditionalBuyCondition
  | ConditionalSellCondition;

export type ClarificationInputType = "number" | "date" | "select" | "text";

export interface ClarificationQuestion {
  id: string;
  fieldPath: string;
  question: string;
  inputType: ClarificationInputType;
  unit?: "KRW" | "USD" | "%" | null;
  required: true;
}

/** 시세는 가격과 기준 시각/지연 여부를 함께 고정한다(화면에서 숨기지 않음). */
export interface MarketData {
  symbol: string;
  companyName: string;
  currentPrice: number;
  previousClose: number;
  changePercent: number;
  currency: "USD";
  timestamp: string; // ISO
  delayed: boolean;
  source: "finnhub";
}

export type StrategyStatus = "draft" | "needs_clarification" | "ready" | "mock_active";

export interface Strategy {
  id: string;
  originalInput: string;
  symbol: string | null;
  companyName: string | null;
  market: Market;
  currency: Currency;
  conditions: StrategyCondition[];
  clarificationQuestions: ClarificationQuestion[];
  marketData: MarketData | null;
  status: StrategyStatus;
}
