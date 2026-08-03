/**
 * Market data BFF 클라이언트 — 브라우저에서 쓰는 유일한 진입점.
 *
 * 근거: docs/product/STATE_FLOW_V1.md §18 #4.
 *
 * 이 파일은 **API 키를 다루지 않는다.** `/api/*` 상대 경로만 호출하고, 실패 시
 * `MarketClientError`(ProductError 와 같은 모양)를 던진다. mock 으로 대체하지 않는다.
 */
export type MarketClientErrorStage = "asset_resolution" | "market_quote" | "historical_data";

export interface MarketClientError {
  stage: MarketClientErrorStage;
  code: string;
  userMessage: string;
  retryable: boolean;
}

function isMarketClientError(value: unknown): value is MarketClientError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { userMessage?: unknown }).userMessage === "string" &&
    typeof (value as { retryable?: unknown }).retryable === "boolean"
  );
}

function networkError(stage: MarketClientErrorStage): MarketClientError {
  return {
    stage,
    code: "network_failure",
    userMessage: "연결이 원활하지 않아요. 다시 시도해주세요.",
    retryable: true,
  };
}

async function getJson<T>(
  url: string,
  stage: MarketClientErrorStage,
  signal?: AbortSignal
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw networkError(stage);
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok || body === null) {
    const apiError = (body as { error?: unknown } | null)?.error;
    throw isMarketClientError(apiError) ? apiError : networkError(stage);
  }

  return body as T;
}

export interface SymbolSearchResultDto {
  symbol: string;
  companyName: string;
  exchange: string | null;
  market: "US";
  currency: "USD";
}

export interface MarketQuoteDto {
  currentPrice: number;
  previousClose: number;
  changeValue: number;
  changePercent: number;
  marketTimestamp: string;
}

export interface DailyCandleDto {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export interface HistoricalCandlesDto {
  symbol: string;
  requestedRange: { from: string; to: string };
  actualRange: { from: string; to: string };
  candles: DailyCandleDto[];
  fetchedAt: string;
  adjustment: "splits";
  dividendAdjusted: false;
  completeness: "complete" | "partial" | "insufficient";
  /** true 면 실시간 조회가 실패해 서버에 저장된 실제 응답으로 대체된 것이다(§사용자 확정 —
   * 가짜 데이터가 아니라 실제로 조회했던 데이터, 그 사실을 화면에 그대로 알린다). */
  fallbackUsed: boolean;
  /** fallbackUsed 일 때만 의미가 있다 — 저장된 스냅샷이 실제로 covering 하는 마지막 거래일. */
  asOfDate?: string;
}

/** 종목 검색. 빈 검색어는 서버가 네트워크 호출 없이 빈 배열을 돌려준다. */
export async function searchSymbolsClient(
  query: string,
  signal?: AbortSignal
): Promise<SymbolSearchResultDto[]> {
  const params = new URLSearchParams({ q: query });
  const body = await getJson<{ results: SymbolSearchResultDto[] }>(
    `/api/symbols?${params.toString()}`,
    "asset_resolution",
    signal
  );
  return body.results;
}

/** 현재가. 실패해도 분석(과거 일봉 기반) 흐름을 막지 않는 용도로만 쓴다. */
export async function fetchQuoteClient(
  symbol: string,
  signal?: AbortSignal
): Promise<MarketQuoteDto> {
  const params = new URLSearchParams({ symbol });
  const body = await getJson<{ quote: MarketQuoteDto }>(
    `/api/quote?${params.toString()}`,
    "market_quote",
    signal
  );
  return body.quote;
}

/** 최근 1년 일별 종가(adjust=splits, 미국 — Twelve Data). 실패 시 분석을 진행하지 않는다(치명). */
export async function fetchCandlesClient(
  symbol: string,
  fromInclusive: string,
  toInclusive: string,
  signal?: AbortSignal
): Promise<HistoricalCandlesDto> {
  const params = new URLSearchParams({ symbol, from: fromInclusive, to: toInclusive });
  const body = await getJson<{ result: HistoricalCandlesDto }>(
    `/api/candles?${params.toString()}`,
    "historical_data",
    signal
  );
  return body.result;
}

/** 최근 1년 일별 종가(국내 — Yahoo Finance 임시 provider, §공공데이터포털 발급 전까지). 종목
 * 코드는 캐노니컬 그대로(005930) 넘긴다 — provider 심볼 변환(`.KS`/`.KQ`)은 서버에서만 한다. */
export async function fetchCandlesKrClient(
  symbol: string,
  exchange: "KOSPI" | "KOSDAQ",
  fromInclusive: string,
  toInclusive: string,
  signal?: AbortSignal
): Promise<HistoricalCandlesDto> {
  const params = new URLSearchParams({ symbol, exchange, from: fromInclusive, to: toInclusive });
  const body = await getJson<{ result: HistoricalCandlesDto }>(
    `/api/candles/kr?${params.toString()}`,
    "historical_data",
    signal
  );
  return body.result;
}
