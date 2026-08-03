/**
 * Twelve Data historical market data 스파이크 타입 (Tech Spike 2B).
 *
 * 근거: docs/product/build/AGENT_TOOL_CONTRACT.md §11 fetch_historical_prices.
 * Finnhub 스파이크(spikes/historical-market-data/)와 동일한 DailyCandle/completeness
 * 계약을 쓰되, provider 와 원시 응답 형태만 Twelve Data 에 맞춘다.
 */

export type Resolution = "1day";
export type MarketDataSource = "twelve_data";
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
  | "credits_exceeded"
  | "no_data"
  | "malformed_response"
  | "network_failure";

export interface HistoricalFetchSuccess {
  ok: true;
  provider: MarketDataSource;
  symbol: string;
  statusCode: number;
  /** 응답 body 의 status 필드 ("ok" 등). HTTP status 와 별개로 기록한다. */
  apiStatus: string | null;
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
  /** 응답 body 의 status 필드 ("error" 등). */
  apiStatus: string | null;
  /** 응답 body 의 code 필드 (Twelve Data 는 HTTP 200 + body code 로 오류를 알리기도 한다). */
  apiCode: number | null;
  errorCode: HistoricalFetchErrorCode;
  message: string;
  latencyMs: number | null;
}

export type HistoricalFetchResult = HistoricalFetchSuccess | HistoricalFetchFailure;

/** Twelve Data /time_series 값 한 줄(원시: 모든 수치가 문자열). */
export interface TwelveDataValue {
  datetime?: string;
  open?: string;
  high?: string;
  low?: string;
  close?: string;
  volume?: string;
}

/** Twelve Data /time_series 원시 응답(부분). 성공/오류 형태가 한 스키마에 섞여 온다. */
export interface TwelveDataTimeSeriesResponse {
  meta?: {
    symbol?: string;
    interval?: string;
    exchange?: string;
    currency?: string;
  };
  values?: TwelveDataValue[];
  status?: string; // "ok" | "error"
  code?: number; // 오류 시 body 에 담기는 코드
  message?: string; // 오류 시 사유
}
