/**
 * 오프라인 데모 market data provider.
 *
 * `VITE_USE_MOCK_MARKET=true` 일 때만 `app/data/market/provider.ts` 가 이 모듈을 쓴다.
 * 실제 provider(`app/data/market/client.ts`)와 **같은 DTO 모양**을 반환하므로 호출부는
 * 어느 쪽을 쓰는지 분기하지 않는다.
 *
 * ⚠️ 실제 시장 데이터가 아니다. 결정적 합성 candles(`app/mocks/candles.ts`)를 실제
 * simulation engine 에 그대로 주입해서 화면 골격을 확인하는 용도다.
 */
import { createMockCandles, MOCK_RANGE } from "@/mocks/candles";
import type {
  HistoricalCandlesDto,
  MarketQuoteDto,
  SymbolSearchResultDto,
} from "@/data/market/client";

/** 검색 데모용 최소 후보 목록. 실제 Finnhub 검색 결과를 대체하지 않는다. */
const MOCK_SYMBOL_CANDIDATES: SymbolSearchResultDto[] = [
  { symbol: "AAPL", companyName: "Apple Inc.", exchange: null, market: "US", currency: "USD" },
  { symbol: "MSFT", companyName: "Microsoft Corporation", exchange: null, market: "US", currency: "USD" },
  { symbol: "GOOGL", companyName: "Alphabet Inc.", exchange: null, market: "US", currency: "USD" },
];

let cachedCandles: ReturnType<typeof createMockCandles> | null = null;

/** 결정적 합성 candles. 모듈 내에서 한 번만 만들고 재사용한다(호출마다 같은 값). */
function mockCandles() {
  if (cachedCandles === null) cachedCandles = createMockCandles();
  return cachedCandles;
}

export async function searchSymbolsMock(query: string): Promise<SymbolSearchResultDto[]> {
  const q = query.trim().toLowerCase();
  if (q === "") return [];
  return MOCK_SYMBOL_CANDIDATES.filter(
    (candidate) =>
      candidate.symbol.toLowerCase().includes(q) || candidate.companyName.toLowerCase().includes(q)
  );
}

export async function fetchQuoteMock(): Promise<MarketQuoteDto> {
  const candles = mockCandles();
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const currentPrice = last?.close ?? 0;
  const previousClose = prev?.close ?? currentPrice;
  const changeValue = Number((currentPrice - previousClose).toFixed(2));
  const changePercent =
    previousClose > 0 ? Number((((currentPrice - previousClose) / previousClose) * 100).toFixed(2)) : 0;

  return {
    currentPrice,
    previousClose,
    changeValue,
    changePercent,
    marketTimestamp: `${MOCK_RANGE.to}T20:00:00Z`,
  };
}

export async function fetchCandlesMock(symbol: string): Promise<HistoricalCandlesDto> {
  const candles = mockCandles();
  return {
    symbol,
    requestedRange: { from: MOCK_RANGE.from, to: MOCK_RANGE.to },
    actualRange: {
      from: candles[0]?.date ?? MOCK_RANGE.from,
      to: candles[candles.length - 1]?.date ?? MOCK_RANGE.to,
    },
    candles,
    fetchedAt: `${MOCK_RANGE.to}T20:05:00Z`,
    adjustment: "splits",
    dividendAdjusted: false,
    completeness: "complete",
    fallbackUsed: false,
  };
}
