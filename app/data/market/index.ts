/**
 * Market data 공개 API.
 *
 * 앱 코드는 `spikes/` 를 import 하지 않고 이 모듈만 사용한다.
 */
export {
  createTwelveDataHistoricalAdapter,
  fetchHistoricalCandles,
  resolveTwelveDataApiKey,
  type FetchLike,
  type HistoricalMarketDataPort,
  type TwelveDataHistoricalConfig,
} from "./twelveDataHistoricalAdapter";
export {
  createFinnhubAdapter,
  fetchQuote,
  resolveFinnhubApiKey,
  searchSymbols,
  type FinnhubConfig,
  type FinnhubMarketPort,
} from "./finnhubAdapter";
export {
  createYahooKoreanAdapter,
  toYahooProviderSymbol,
  type KoreanCandlesInput,
  type KoreanMarketDataPort,
} from "./yahooKoreanAdapter";
// 참고: finnhubAdapter 의 `FetchLike` 는 twelveDataHistoricalAdapter 의 것과 모양이 같다.
// 중복 export 충돌을 피하기 위해 여기서는 twelveData 쪽 이름만 공개한다.
export {
  classifyCompleteness,
  isValidDailyCandle,
  isValidDateString,
  parseTwelveDataValues,
  partitionValidCandles,
  sortAndDedupeCandles,
  toExclusiveEndDate,
  COMPLETE_MIN_TRADING_DAYS,
  PARTIAL_MIN_TRADING_DAYS,
} from "./normalizeCandles";
export {
  MarketDataError,
  type Completeness,
  type DailyCandle,
  type FetchHistoricalCandlesInput,
  type FetchQuoteInput,
  type FetchSymbolSearchInput,
  type HistoricalCandlesResult,
  type MarketDataErrorCode,
  type MarketDataProvider,
  type MarketQuoteResult,
  type SymbolSearchResult,
  type TwelveDataTimeSeriesResponse,
  type TwelveDataValue,
} from "./types";
