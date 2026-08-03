/**
 * Historical market data 스파이크 타입.
 *
 * 근거: docs/product/build/AGENT_TOOL_CONTRACT.md §11 fetch_historical_prices.
 * DailyCandle / completeness / 출력 구조를 계약과 과제 명세에 맞춘다.
 */

export type Resolution = "1D";
export type MarketDataSource = "finnhub";
export type Completeness = "complete" | "partial" | "insufficient";

/** YYYY-MM-DD 범위. */
export interface DateRange {
  from: string;
  to: string;
}

export interface DailyCandle {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/** 명시적으로 구분하는 실패 상태. */
export type HistoricalFetchErrorCode =
  | "api_key_missing"
  | "unauthorized"
  | "forbidden_or_plan_restriction"
  | "rate_limited"
  | "no_data"
  | "malformed_response"
  | "network_failure";

export interface HistoricalFetchSuccess {
  ok: true;
  provider: MarketDataSource;
  symbol: string;
  statusCode: number;
  requestedRange: DateRange;
  actualRange: DateRange | null;
  tradingDayCount: number;
  candles: DailyCandle[];
  firstCandle: DailyCandle | null;
  lastCandle: DailyCandle | null;
  invalidRowCount: number;
  duplicateRowCount: number;
  latencyMs: number;
  completeness: Completeness;
}

export interface HistoricalFetchFailure {
  ok: false;
  provider: MarketDataSource;
  symbol: string;
  statusCode: number | null;
  errorCode: HistoricalFetchErrorCode;
  message: string;
  latencyMs: number | null;
}

export type HistoricalFetchResult = HistoricalFetchSuccess | HistoricalFetchFailure;

/** Finnhub /stock/candle 원시 응답(부분). */
export interface FinnhubCandleResponse {
  s?: string; // "ok" | "no_data"
  c?: number[]; // close
  h?: number[]; // high
  l?: number[]; // low
  o?: number[]; // open
  t?: number[]; // unix seconds
  v?: number[]; // volume
}
