/**
 * Market data provider 선택 — 앱(FlowProvider·Screen2 등)이 부르는 **유일한 진입점**.
 *
 * 근거: 사용자 결정 — "실제 데이터와 mock 데이터가 동일 인터페이스를 사용하도록 구성".
 *
 * `VITE_USE_MOCK_MARKET=true` 일 때만 오프라인 데모 provider(`@/mocks/marketProvider`)를
 * 쓴다. 그 외에는 항상 실제 BFF(`@/data/market/client`)를 호출한다. API 실패가 이 분기를
 * 바꾸지 않는다 — 실패는 실패로 던진다.
 *
 * `fetchCandles` 는 시장별로 provider 를 명시적으로 분리한다(§사용자 확정) — 판단은 항상
 * `AssetRef.market`(검색에서 확정된 값) 하나로만 하고, 화면 문구나 종목명으로 추측하지 않는다.
 *  - KR → Yahoo Finance 임시 provider(`fetchCandlesKrClient`, §공공데이터포털 발급 전까지)
 *  - US → 기존 Twelve Data 경로(`fetchCandlesClient`) 그대로 유지
 */
import { isMockMarketEnabled } from "@/config/marketDataMode";
import {
  fetchCandlesClient,
  fetchCandlesKrClient,
  fetchQuoteClient,
  searchSymbolsClient,
  type HistoricalCandlesDto,
  type MarketQuoteDto,
  type SymbolSearchResultDto,
} from "./client";
import { fetchCandlesMock, fetchQuoteMock, searchSymbolsMock } from "@/mocks/marketProvider";
import type { AssetRef } from "@/types/appPlan";

export type { HistoricalCandlesDto, MarketQuoteDto, SymbolSearchResultDto } from "./client";
export type { MarketClientError, MarketClientErrorStage } from "./client";

export function searchSymbols(
  query: string,
  signal?: AbortSignal
): Promise<SymbolSearchResultDto[]> {
  return isMockMarketEnabled() ? searchSymbolsMock(query) : searchSymbolsClient(query, signal);
}

export function fetchQuote(symbol: string, signal?: AbortSignal): Promise<MarketQuoteDto> {
  return isMockMarketEnabled() ? fetchQuoteMock() : fetchQuoteClient(symbol, signal);
}

export function fetchCandles(
  asset: AssetRef,
  fromInclusive: string,
  toInclusive: string,
  signal?: AbortSignal
): Promise<HistoricalCandlesDto> {
  if (isMockMarketEnabled()) return fetchCandlesMock(asset.symbol);

  if (asset.market === "KR") {
    // KOSPI/KOSDAQ 이 아닌 exchange 값은 검색 단계(koreanStocks.ts)에서 이미 걸러진다 —
    // 여기서 다시 한번 확인해 provider 요청 시점에 잘못된 문자열이 새지 않게 한다.
    if (asset.exchange !== "KOSPI" && asset.exchange !== "KOSDAQ") {
      return Promise.reject(
        new Error(`국내 종목의 exchange 정보(KOSPI/KOSDAQ)가 없어요: ${asset.symbol}`)
      );
    }
    return fetchCandlesKrClient(asset.symbol, asset.exchange, fromInclusive, toInclusive, signal);
  }

  return fetchCandlesClient(asset.symbol, fromInclusive, toInclusive, signal);
}
