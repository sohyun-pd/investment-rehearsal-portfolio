/**
 * Finnhub adapter (production) — 종목 검색 · 현재가.
 *
 * 검증 근거: spikes/market-api/adapters.ts (FinnhubMarketProvider) — 검색·현재가 조회 가능 확인.
 * 이 파일은 그 검증을 production 표준(명시적 오류 타입·키 redaction·주입 가능한 fetch)으로 옮긴 것이다.
 *
 * 규칙:
 *  - 미국 보통주 위주로 필터링한다(`type === "Common Stock"`, 거래소 접미사(`.`) 없는 심볼 우선).
 *  - 빈 검색어는 네트워크 호출 없이 빈 배열을 반환한다.
 *  - 실패 시 mock/fixture 로 대체하지 않고 `MarketDataError` 를 던진다.
 *  - API 키와 요청 URL 을 로그·오류 메시지에 남기지 않는다.
 *
 * 보안: 이 adapter 는 API 키를 사용하므로 **브라우저 번들에서 직접 호출하면 키가 노출된다.**
 * server/BFF 에서만 호출한다. 그래서 키를 `import.meta.env.VITE_*` 로 읽지 않는다.
 */
import { fetchWithTimeout } from "./httpTimeout";
import {
  MarketDataError,
  type FetchQuoteInput,
  type FetchSymbolSearchInput,
  type FinnhubQuoteRawResponse,
  type FinnhubSearchRawItem,
  type FinnhubSearchRawResponse,
  type MarketDataErrorCode,
  type MarketQuoteResult,
  type SymbolSearchResult,
} from "./types";

const PROVIDER = "finnhub" as const;
const BASE_URL = "https://finnhub.io/api/v1";
const MAX_SEARCH_RESULTS = 8;

export type FetchLike = (url: string) => Promise<Response>;

export interface FinnhubConfig {
  /** 호출자가 주입한다. 이 파일이 환경변수를 직접 읽지 않는 편이 테스트·보안 모두 유리하다. */
  apiKey: string;
  /** 테스트에서 HTTP 계층을 대체하기 위한 주입점. production 에서는 생략한다. */
  fetchImpl?: FetchLike;
}

export interface FinnhubMarketPort {
  searchSymbols(input: FetchSymbolSearchInput): Promise<SymbolSearchResult[]>;
  fetchQuote(input: FetchQuoteInput): Promise<MarketQuoteResult>;
}

function fail(
  code: MarketDataErrorCode,
  message: string,
  detail: { httpStatus?: number | null } = {}
): never {
  throw new MarketDataError(code, message, { provider: PROVIDER, ...detail });
}

function looksLikeCreditsExceeded(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("credit") || lower.includes("quota") || lower.includes("limit exceeded");
}

function classifyHttpStatus(status: number, message: string): MarketDataErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden_or_plan_restriction";
  if (status === 429) return looksLikeCreditsExceeded(message) ? "credits_exceeded" : "rate_limited";
  if (status === 404) return "no_data";
  if (status >= 500) return "network_failure";
  return "malformed_response";
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isUsCommonStock(row: FinnhubSearchRawItem): boolean {
  return row.type === "Common Stock" && typeof row.symbol === "string" && !row.symbol.includes(".");
}

/** 검색어와 얼마나 가깝게 일치하는지 순위를 매긴다(낮을수록 좋음). Finnhub 자체 검색 순서는
 * 관련도 순이 아니다(예: "Apple" 검색 시 "Apple Hospitality REIT Inc"가 "Apple Inc"보다
 * 먼저 오기도 한다) — 화면이 그 순서를 그대로 보여주면 사용자가 엉뚱한 종목을 고르게 된다
 * (§사용자 확정 — APLE/AAPL 오선택 회귀). 종목명 완전 일치 > 티커 완전 일치 > 이름 시작
 * 일치(짧을수록 우선) > 이름 포함 순으로 정렬한다. */
function relevanceRank(row: FinnhubSearchRawItem, query: string): [tier: number, nameLength: number] {
  const q = query.trim().toLowerCase();
  const name = (row.description ?? "").toLowerCase();
  const symbol = (typeof row.symbol === "string" ? row.symbol : "").toLowerCase();
  if (name === q) return [1, name.length];
  if (symbol === q) return [2, name.length];
  if (name.startsWith(q)) return [3, name.length];
  if (name.includes(q)) return [4, name.length];
  return [5, name.length];
}

function compareRelevance(a: FinnhubSearchRawItem, b: FinnhubSearchRawItem, query: string): number {
  const [tierA, lengthA] = relevanceRank(a, query);
  const [tierB, lengthB] = relevanceRank(b, query);
  if (tierA !== tierB) return tierA - tierB;
  return lengthA - lengthB;
}

export function createFinnhubAdapter(config: FinnhubConfig): FinnhubMarketPort {
  const { apiKey } = config;
  const doFetch: FetchLike = config.fetchImpl ?? ((url) => fetchWithTimeout(url));

  /** 문자열에서 키를 가려준다. 오류 메시지에 키가 새지 않게 하는 마지막 방어선. */
  const redact = (text: string): string =>
    apiKey === "" ? text : text.split(apiKey).join("***REDACTED***");

  async function request(path: string, params: URLSearchParams): Promise<unknown> {
    if (apiKey === "") {
      fail("api_key_missing", "FINNHUB_API_KEY 가 설정되지 않았습니다.");
    }
    params.set("token", apiKey);
    // URL 은 키를 포함한다. 로그·오류 메시지에 절대 넣지 않는다.
    const url = `${BASE_URL}${path}?${params.toString()}`;

    let response: Response;
    try {
      response = await doFetch(url);
    } catch (error) {
      fail("network_failure", redact(error instanceof Error ? error.message : String(error)));
    }

    const bodyText = await response.text().catch(() => "");

    if (!response.ok) {
      fail(
        classifyHttpStatus(response.status, bodyText),
        redact((bodyText.slice(0, 300) || response.statusText).trim()),
        { httpStatus: response.status }
      );
    }

    try {
      return JSON.parse(bodyText) as unknown;
    } catch {
      fail(
        "malformed_response",
        redact((bodyText.slice(0, 300) || response.statusText).trim()),
        { httpStatus: response.status }
      );
    }
  }

  return {
    async searchSymbols(input: FetchSymbolSearchInput): Promise<SymbolSearchResult[]> {
      const query = input.query.trim();
      // 빈 검색어 — 네트워크 호출 없이 빈 결과를 돌려준다.
      if (query === "") return [];

      const json = (await request(
        "/search",
        new URLSearchParams({ q: query })
      )) as FinnhubSearchRawResponse;

      const rows = Array.isArray(json.result) ? json.result : [];
      const withSymbol = rows.filter((row) => typeof row.symbol === "string");
      // 이 provider 는 미국 보통주만 지원한다 — market/currency 를 항상 US/USD 로 못박아
      // 반환하기 때문에, 미국 외 종목(예: "035420.KS")이 섞여 들어오면 실제로는 원화인
      // 가격을 달러로 잘못 표시하게 된다(§사용자 확정 — 지원하지 않는 종목/시장은 지원하는
      // 척하지 않고 "그 이름으로 종목을 찾지 못했어요"로 정확히 안내한다). 미국 보통주가
      // 하나도 없으면 다른 시장으로 조용히 대체하지 않고 빈 배열을 돌려준다.
      const picked = withSymbol
        .filter(isUsCommonStock)
        .sort((a, b) => compareRelevance(a, b, query))
        .slice(0, MAX_SEARCH_RESULTS);

      return picked.map((row) => ({
        symbol: row.symbol as string,
        companyName: row.description ?? (row.symbol as string),
        exchange: null,
        market: "US" as const,
        currency: "USD" as const,
      }));
    },

    async fetchQuote(input: FetchQuoteInput): Promise<MarketQuoteResult> {
      const symbol = input.symbol.trim();
      if (symbol === "") {
        fail("invalid_request", "symbol 이 비어 있습니다.");
      }

      const json = (await request(
        "/quote",
        new URLSearchParams({ symbol })
      )) as FinnhubQuoteRawResponse;

      // 상장폐지·무료 티어 제한 등으로 시세가 없는 경우 c=0, t=0 이 온다.
      if (typeof json.c !== "number" || json.c <= 0 || typeof json.t !== "number" || json.t <= 0) {
        fail("no_data", `현재가를 확인할 수 없습니다 (symbol=${symbol}).`);
      }

      const previousClose = typeof json.pc === "number" && json.pc > 0 ? json.pc : json.c;
      const changeValue = typeof json.d === "number" ? json.d : round2(json.c - previousClose);
      const changePercent =
        typeof json.dp === "number"
          ? json.dp
          : previousClose > 0
            ? round2(((json.c - previousClose) / previousClose) * 100)
            : 0;

      return {
        currentPrice: json.c,
        previousClose,
        changeValue,
        changePercent,
        marketTimestamp: new Date(json.t * 1000).toISOString(),
      };
    },
  };
}

/**
 * 환경변수에서 키를 읽는다.
 *
 * `process` 를 직접 참조하지 않고 `globalThis` 를 통해 조회한다(twelveDataHistoricalAdapter.ts 와
 * 같은 이유). 브라우저에서는 키가 없으므로 `api_key_missing` 으로 명시 실패한다.
 */
export function resolveFinnhubApiKey(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.FINNHUB_API_KEY ?? "";
}

/** 기본 adapter. 키는 환경변수에서 해석한다. */
export async function searchSymbols(
  input: FetchSymbolSearchInput
): Promise<SymbolSearchResult[]> {
  const adapter = createFinnhubAdapter({ apiKey: resolveFinnhubApiKey() });
  return adapter.searchSymbols(input);
}

export async function fetchQuote(input: FetchQuoteInput): Promise<MarketQuoteResult> {
  const adapter = createFinnhubAdapter({ apiKey: resolveFinnhubApiKey() });
  return adapter.fetchQuote(input);
}
