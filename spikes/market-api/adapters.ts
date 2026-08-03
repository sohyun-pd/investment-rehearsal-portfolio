/**
 * 시장 데이터 어댑터 - 교체 가능한 구조.
 *
 * 공통 인터페이스(MarketDataProvider) + 정규화 타입만 고정하고
 * 구현은 환경변수(MARKET_PROVIDER)로 교체한다.
 *  - mock         : 키 없이 sample-response.json 사용
 *  - finnhub      : 실제 조회 (검색 + 현재가)
 *  - alphavantage : 실제 조회 (검색 + 현재가)
 *
 * 스파이크 검증 항목: 종목 검색 / 현재가 / 전일 대비 / 데이터 기준 시각.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 종목 검색 결과 1건. */
export interface SymbolMatch {
  symbol: string;
  description: string;
}

/** provider 무관 정규화된 시세. */
export interface Quote {
  symbol: string;
  name: string;
  currency: string;
  price: number; // 현재가
  previousClose: number; // 전일 종가
  changePercent: number; // 전일 대비 변동률(%)
  timestamp: string; // 데이터 기준 시각(ISO)
}

export interface MarketDataProvider {
  readonly name: string;
  search(query: string): Promise<SymbolMatch[]>;
  getQuote(symbol: string): Promise<Quote>;
}

/** 현재가/전일종가로 변동률을 계산해 Quote 를 완성한다. */
function withChange(q: Omit<Quote, "changePercent">): Quote {
  const changePercent =
    q.previousClose !== 0
      ? Number((((q.price - q.previousClose) / q.previousClose) * 100).toFixed(2))
      : 0;
  return { ...q, changePercent };
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`[market] HTTP ${res.status} ${res.statusText} — ${url.split("?")[0]}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

interface RawQuote {
  symbol: string;
  name: string;
  currency: string;
  price: number;
  previousClose: number;
  timestamp: string;
}

/** Mock 구현: 네트워크 없이 sample-response.json 을 정규화. */
export class MockMarketProvider implements MarketDataProvider {
  readonly name = "mock";
  private readonly quotes: Record<string, RawQuote>;

  constructor() {
    const raw = readFileSync(join(__dirname, "sample-response.json"), "utf8");
    this.quotes = (JSON.parse(raw) as { quotes: Record<string, RawQuote> }).quotes;
  }

  async search(query: string): Promise<SymbolMatch[]> {
    const q = query.toLowerCase();
    return Object.values(this.quotes)
      .filter((r) => r.name.toLowerCase().includes(q) || r.symbol.toLowerCase().includes(q))
      .map((r) => ({ symbol: r.symbol, description: r.name }));
  }

  async getQuote(symbol: string): Promise<Quote> {
    const raw = this.quotes[symbol];
    if (!raw) throw new Error(`[market] mock 데이터에 심볼 없음: "${symbol}"`);
    return withChange(raw);
  }
}

// ---------------------------------------------------------------------------
// Finnhub  (https://finnhub.io) — 무료 티어에서 검색 + 현재가 제공
// ---------------------------------------------------------------------------

export class FinnhubMarketProvider implements MarketDataProvider {
  readonly name = "finnhub";
  private readonly base = "https://finnhub.io/api/v1";

  private token(): string {
    const t = process.env.FINNHUB_API_KEY;
    if (!t) throw new Error("[market] FINNHUB_API_KEY 가 없습니다. .env.local 에 넣으세요.");
    return t;
  }

  async search(query: string): Promise<SymbolMatch[]> {
    const url = `${this.base}/search?q=${encodeURIComponent(query)}&token=${this.token()}`;
    const data = await fetchJson(url);
    const rows: any[] = data.result ?? [];
    // 미국 주식 위주: 공통주 + 거래소 접미사 없는 심볼(예: AAPL) 우선.
    const usStocks = rows.filter(
      (r) => r.type === "Common Stock" && typeof r.symbol === "string" && !r.symbol.includes(".")
    );
    const picked = (usStocks.length > 0 ? usStocks : rows).slice(0, 5);
    return picked.map((r: any) => ({ symbol: r.symbol, description: r.description }));
  }

  async getQuote(symbol: string): Promise<Quote> {
    const url = `${this.base}/quote?symbol=${encodeURIComponent(symbol)}&token=${this.token()}`;
    const d = await fetchJson(url);
    if (d.c == null || d.t == null) {
      throw new Error(`[market] finnhub 응답에 시세 없음: "${symbol}" (상장폐지/무료티어 제한?)`);
    }
    return withChange({
      symbol,
      name: symbol,
      currency: "USD",
      price: Number(d.c),
      previousClose: Number(d.pc),
      timestamp: new Date(Number(d.t) * 1000).toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Alpha Vantage (https://www.alphavantage.co) — 무료 티어 25 req/day
// ---------------------------------------------------------------------------

export class AlphaVantageMarketProvider implements MarketDataProvider {
  readonly name = "alphavantage";
  private readonly base = "https://www.alphavantage.co/query";

  private key(): string {
    const k = process.env.ALPHAVANTAGE_API_KEY;
    if (!k) throw new Error("[market] ALPHAVANTAGE_API_KEY 가 없습니다. .env.local 에 넣으세요.");
    return k;
  }

  private assertNoLimit(d: any): void {
    if (d?.Note || d?.Information) {
      throw new Error(`[market] alphavantage 레이트리밋/안내: ${d.Note ?? d.Information}`);
    }
  }

  async search(query: string): Promise<SymbolMatch[]> {
    const url = `${this.base}?function=SYMBOL_SEARCH&keywords=${encodeURIComponent(query)}&apikey=${this.key()}`;
    const d = await fetchJson(url);
    this.assertNoLimit(d);
    return (d.bestMatches ?? []).slice(0, 5).map((m: any) => ({
      symbol: m["1. symbol"],
      description: m["2. name"],
    }));
  }

  async getQuote(symbol: string): Promise<Quote> {
    const url = `${this.base}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${this.key()}`;
    const d = await fetchJson(url);
    this.assertNoLimit(d);
    const q = d["Global Quote"];
    if (!q || q["05. price"] == null) {
      throw new Error(`[market] alphavantage 응답에 시세 없음: "${symbol}"`);
    }
    return withChange({
      symbol,
      name: symbol,
      currency: "USD",
      price: Number(q["05. price"]),
      previousClose: Number(q["08. previous close"]),
      timestamp: q["07. latest trading day"], // 거래일(YYYY-MM-DD)
    });
  }
}

/** 환경변수(MARKET_PROVIDER)에 따라 어댑터를 고른다. */
export function createMarketProvider(
  provider: string = process.env.MARKET_PROVIDER ?? "mock"
): MarketDataProvider {
  switch (provider) {
    case "mock":
      return new MockMarketProvider();
    case "finnhub":
      return new FinnhubMarketProvider();
    case "alphavantage":
      return new AlphaVantageMarketProvider();
    default:
      throw new Error(`[market] 알 수 없는 MARKET_PROVIDER: "${provider}"`);
  }
}
