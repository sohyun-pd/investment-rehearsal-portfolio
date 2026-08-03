/**
 * Production market data 타입.
 *
 * `spikes/` 코드는 검증 기록이므로 production 에서 import 하지 않는다.
 * 필요한 순수 로직은 이 디렉터리에 production 코드로 둔다.
 *
 * 검증 근거:
 *  - spikes/historical-market-data-twelve-data/TECH_SPIKE_2B_RESULT.md (조회 가능성·완전성)
 *  - spikes/historical-market-data-twelve-data/ADJUSTMENT_CHECK_RESULT.md (adjust=splits)
 */

/** 시뮬레이션 엔진과 같은 candle 계약을 쓴다(도메인 타입 재사용). */
export type { DailyCandle } from "../../domain/simulation";

export type MarketDataProvider = "twelve_data" | "finnhub" | "yahoo_kr" | "yahoo_kr_snapshot";

export type Completeness = "complete" | "partial" | "insufficient";

export interface FetchHistoricalCandlesInput {
  symbol: string;
  /** 사용자 기준 시작일(포함). */
  fromInclusive: string;
  /** 사용자 기준 종료일(포함). API 의 exclusive end_date 변환은 adapter 내부에서 처리한다. */
  toInclusive: string;
}

export interface HistoricalCandlesResult {
  provider: "twelve_data" | "yahoo_kr" | "yahoo_kr_snapshot";
  symbol: string;

  requestedRange: {
    from: string;
    to: string;
  };

  actualRange: {
    from: string;
    to: string;
  };

  candles: import("../../domain/simulation").DailyCandle[];

  fetchedAt: string;

  adjustment: "splits";
  dividendAdjusted: false;

  completeness: Completeness;

  /** true 면 실시간 조회가 실패해 저장해 둔 실제 응답으로 대체한 것이다. 어댑터(이 파일이 만드는
   * 값)는 이 필드를 채우지 않는다 — server/marketRoutes.ts 의 라우트 계층에서만 명시적으로
   * 채운다(어댑터는 "지금 막 조회했다"는 사실만 알 뿐, 그게 실시간인지 폴백인지는 모른다). */
  fallbackUsed?: boolean;

  /** fallbackUsed 일 때만 의미가 있다 — 저장된 스냅샷이 실제로 covering 하는 마지막 거래일
   * (actualRange.to 와 같은 값). fetchedAt(스냅샷을 "캡처한" 시각)과는 다른 개념이라 별도
   * 필드로 명시한다(§사용자 확정 — 결과 화면에 "그 데이터가 언제까지의 실제 가격인지" 를
   * 정확히 알려야 한다). */
  asOfDate?: string;
}

export type MarketDataErrorCode =
  | "api_key_missing"
  | "invalid_request"
  | "unauthorized"
  | "forbidden_or_plan_restriction"
  /** 이 종목 자체는 검색·확정까지 되지만, 가격(quote·time_series) provider 가 이 시장을 아직
   * 지원하지 않는다(예: 국내 KRX 종목은 검색은 되지만 Twelve Data Basic 요금제에서 시세를
   * 주지 않는다 — 실제 응답으로 확인함). "그 기간엔 데이터가 없다"(no_data)와는 다른 원인이라
   * 문구를 분리한다(§재발했던 회귀 — 국내 provider 미연결을 데이터 없음으로 잘못 안내). */
  | "market_not_supported"
  | "rate_limited"
  | "credits_exceeded"
  | "no_data"
  | "malformed_response"
  | "network_failure"
  // --- 국내(KR) 임시 provider(Yahoo Finance) 전용 — §사용자 확정: 공공데이터포털 신규
  // 활용신청 점검 기간이라 오늘 발급이 불가해, 프로토타입 제출용으로 Yahoo Finance 실제 일별
  // 가격을 임시로 연결한다(추후 공공데이터포털 provider 로 교체 예정, README 참고). ---
  | "kr_provider_request_failed"
  | "kr_symbol_not_found"
  | "kr_empty_response"
  | "kr_insufficient_history"
  | "kr_normalization_failed";

/**
 * 과거 시세 조회 실패. mock/fixture 로 대체하지 않고 던진다.
 * message 에는 API 키가 절대 포함되지 않는다(요청 URL 미기록, 응답 메시지 redact).
 */
export class MarketDataError extends Error {
  readonly code: MarketDataErrorCode;
  readonly provider: MarketDataProvider;
  readonly httpStatus: number | null;
  readonly apiStatus: string | null;
  readonly apiCode: number | null;

  constructor(
    code: MarketDataErrorCode,
    message: string,
    detail: {
      provider: MarketDataProvider;
      httpStatus?: number | null;
      apiStatus?: string | null;
      apiCode?: number | null;
    }
  ) {
    super(message);
    this.name = "MarketDataError";
    this.code = code;
    this.provider = detail.provider;
    this.httpStatus = detail.httpStatus ?? null;
    this.apiStatus = detail.apiStatus ?? null;
    this.apiCode = detail.apiCode ?? null;
  }
}

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
  status?: string;
  code?: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// Yahoo Finance chart — 국내(KR) 임시 provider(§공공데이터포털 발급 전까지). 실측 확인:
// GET https://query1.finance.yahoo.com/v8/finance/chart/{005930.KS 등} → HTTP 200,
// currency:"KRW", quote 배열(open/high/low/close/volume)과 indicators.adjclose 가
// timestamp 와 같은 index 로 연결된다.
// ---------------------------------------------------------------------------

export interface YahooChartQuote {
  open: Array<number | null>;
  high: Array<number | null>;
  low: Array<number | null>;
  close: Array<number | null>;
  volume: Array<number | null>;
}

export interface YahooChartResult {
  meta?: { currency?: string; symbol?: string };
  timestamp?: number[];
  indicators: {
    quote: YahooChartQuote[];
    adjclose?: Array<{ adjclose: Array<number | null> }>;
  };
}

/** 성공("result" 채움) · 실패("error" 채움)가 같은 스키마에 섞여 온다(실측 확인: 잘못된
 * symbol 은 HTTP 404 + `{chart:{result:null,error:{code,description}}}`). */
export interface YahooChartResponse {
  chart: {
    result: YahooChartResult[] | null;
    error: { code?: string; description?: string } | null;
  };
}

// ---------------------------------------------------------------------------
// Finnhub — 종목 검색 · 현재가 (STRATEGY_SCHEMA_V2 §16 MarketDataSource)
// ---------------------------------------------------------------------------

export interface FetchSymbolSearchInput {
  query: string;
}

/** STRATEGY_SCHEMA_V2 §6 AssetCandidate 와 같은 모양. */
export interface SymbolSearchResult {
  symbol: string;
  companyName: string;
  exchange: string | null;
  market: "US";
  currency: "USD";
}

export interface FetchQuoteInput {
  symbol: string;
}

/** STRATEGY_SCHEMA_V2 §16 MarketQuote 와 같은 모양. */
export interface MarketQuoteResult {
  currentPrice: number;
  previousClose: number;
  changeValue: number;
  changePercent: number;
  marketTimestamp: string;
}

/** Finnhub /search 원시 응답 항목(부분). */
export interface FinnhubSearchRawItem {
  symbol?: string;
  description?: string;
  displaySymbol?: string;
  type?: string;
}

export interface FinnhubSearchRawResponse {
  count?: number;
  result?: FinnhubSearchRawItem[];
}

/** Finnhub /quote 원시 응답(부분). c=현재가, pc=전일종가, d=변동값, dp=변동률(%), t=unix seconds. */
export interface FinnhubQuoteRawResponse {
  c?: number;
  pc?: number;
  d?: number;
  dp?: number;
  t?: number;
}
