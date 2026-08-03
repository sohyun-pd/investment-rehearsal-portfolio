/**
 * Market data BFF — 공통 라우트 로직(런타임 무관).
 *
 * 근거: docs/product/STATE_FLOW_V1.md §18 #4 — Finnhub·Twelve Data 는 반드시 server/BFF
 * 경유. 브라우저 번들에 API key 를 포함하지 않는다.
 *
 * 이 파일은 Web 표준 API(fetch·URL·URLSearchParams·JSON)만 쓴다. `process`·`node:*` 를
 * 참조하지 않는다 — 그래야 Node(Vite dev/preview, `server/apiPlugin.ts`)와 Cloudflare Pages
 * Functions(Workers 런타임, `functions/api/*.ts`) 양쪽에서 **같은 코드**로 재사용할 수 있다.
 * API 키는 항상 호출자가 넘겨준다(Node 는 `process.env`, Pages Functions 는 `context.env`).
 *
 * 라우트:
 *  - GET /api/symbols?q=        → Finnhub 종목 검색
 *  - GET /api/quote?symbol=     → Finnhub 현재가
 *  - GET /api/candles?symbol=&from=&to= → Twelve Data 과거 일봉(adjust=splits, 미국)
 *  - GET /api/candles/kr?symbol=&exchange=&from=&to= → Yahoo Finance 과거 일봉(국내, §임시
 *    provider — 공공데이터포털 신규 활용신청 점검 기간이라 오늘은 발급 불가. README 참고)
 *
 * 응답 형태:
 *  - 성공 { status: 200, body: { results } | { quote } | { result } }
 *  - 실패 { status, body: { error: { stage, code, userMessage, retryable } } }
 *    (STRATEGY_SCHEMA_V2 ProductError 와 같은 모양). 실패해도 mock/fixture 로 대체하지 않는다.
 */
import {
  createFinnhubAdapter,
  createTwelveDataHistoricalAdapter,
  createYahooKoreanAdapter,
  MarketDataError,
  type HistoricalCandlesResult,
  type MarketDataErrorCode,
} from "../app/data/market";
import { AAPL_CANDLES_FALLBACK } from "./marketFallback/aaplCandlesFallback";
import { getKrSnapshot } from "./marketFallback/krCandlesFallback";

/** 실시간 조회가 실패했을 때만 쓰는 최후 수단 — 실제로 조회했던 응답을 그대로 저장해 둔
 * 스냅샷이다(가짜 데이터 아님). 지금은 AAPL 하나뿐이다 — 여기 없는 심볼은 그대로 원래
 * 오류를 보여준다(§지원하지 않는 걸 지원하는 척하지 않는다 — 다른 심볼로 조용히 대체하지
 * 않는다). 새 심볼을 추가하려면 실제 /api/candles 응답을 그대로 저장한다. */
const CANDLES_FALLBACK_BY_SYMBOL: Readonly<Record<string, HistoricalCandlesResult>> = {
  AAPL: AAPL_CANDLES_FALLBACK,
};

export type ApiErrorStage = "asset_resolution" | "market_quote" | "historical_data";

export interface ApiProductError {
  stage: ApiErrorStage;
  code: string;
  userMessage: string;
  retryable: boolean;
}

export interface RouteResult {
  status: number;
  body: unknown;
}

/** STATE_FLOW_V1 §15.5 재시도 가능 코드. KR_* 는 §사용자 확정 — "일시 요청 실패"에서만
 * "가격 다시 불러오기"를 보여준다. 종목을 못 찾거나(symbol_not_found) 데이터가 비어 있거나
 * (empty_response) 기간이 부족한 경우(insufficient_history)는 같은 요청을 반복해도 결과가
 * 바뀌지 않으므로 재시도 대상이 아니다. */
const RETRYABLE_CODES: ReadonlySet<MarketDataErrorCode> = new Set([
  "network_failure",
  "rate_limited",
  "credits_exceeded",
  "kr_provider_request_failed",
  "kr_normalization_failed",
]);

/** STATE_FLOW_V1 §15.5 문구 방향을 그대로 따른다. */
const USER_MESSAGE_BY_CODE: Record<MarketDataErrorCode, string> = {
  api_key_missing: "서버 설정 문제로 데이터를 불러오지 못했어요.",
  invalid_request: "요청 형식이 올바르지 않아요.",
  unauthorized: "데이터 이용 권한 문제로 불러오지 못했어요. 다시 시도할 수 없어요.",
  forbidden_or_plan_restriction: "데이터 이용 권한 문제로 불러오지 못했어요. 다시 시도할 수 없어요.",
  market_not_supported: "국내 종목의 가격 데이터는 아직 준비 중이에요.\n계획은 만들 수 있지만, 현재는 국내 종목의 최근 1년 가격에 적용할 수 없어요.",
  rate_limited: "요청이 많아 잠시 후 다시 시도해주세요.",
  credits_exceeded: "오늘 조회 한도를 넘었어요. 잠시 후 다시 시도해주세요.",
  no_data: "해당 기간 데이터를 찾지 못했어요.",
  malformed_response: "데이터를 읽지 못했어요.",
  network_failure: "연결이 원활하지 않아요. 다시 시도해주세요.",
  // --- KR_* (Yahoo Finance 임시 provider) — §사용자 확정 문구. Yahoo endpoint·query·upstream
  // 응답 본문은 절대 노출하지 않는다. ---
  kr_provider_request_failed: "가격 데이터를 불러오지 못했어요.\n잠시 후 다시 시도해주세요.",
  kr_symbol_not_found: "가격 데이터를 찾지 못했어요.\n종목 정보를 다시 확인해주세요.",
  kr_empty_response: "가격 데이터를 찾지 못했어요.\n종목 정보를 다시 확인해주세요.",
  kr_insufficient_history: "최근 1년 전체를 계산하기에 가격 데이터가 부족해요.\n확인 가능한 기간으로 다시 계산해주세요.",
  kr_normalization_failed: "가격 데이터를 불러오지 못했어요.\n잠시 후 다시 시도해주세요.",
};

function toApiError(error: unknown, stage: ApiErrorStage): ApiProductError {
  if (error instanceof MarketDataError) {
    return {
      stage,
      code: error.code,
      userMessage: USER_MESSAGE_BY_CODE[error.code],
      retryable: RETRYABLE_CODES.has(error.code),
    };
  }
  // 예기치 못한 예외. 원본 메시지는 노출하지 않는다(키·내부 경로가 섞여 있을 수 있음).
  return { stage, code: "unknown", userMessage: "알 수 없는 오류가 발생했어요.", retryable: true };
}

function badRequest(stage: ApiErrorStage, userMessage: string): RouteResult {
  return {
    status: 400,
    body: { error: { stage, code: "invalid_request", userMessage, retryable: false } satisfies ApiProductError },
  };
}

export async function handleSymbolsRoute(query: string, finnhubApiKey: string): Promise<RouteResult> {
  try {
    const adapter = createFinnhubAdapter({ apiKey: finnhubApiKey });
    // 빈 검색어는 adapter 가 네트워크 호출 없이 빈 배열을 돌려준다(결과 없음과 같은 모양).
    const results = await adapter.searchSymbols({ query });
    return { status: 200, body: { results } };
  } catch (error) {
    const apiError = toApiError(error, "asset_resolution");
    return { status: apiError.retryable ? 502 : 400, body: { error: apiError } };
  }
}

export async function handleQuoteRoute(symbol: string, finnhubApiKey: string): Promise<RouteResult> {
  const trimmed = symbol.trim();
  if (trimmed === "") return badRequest("market_quote", "symbol 이 필요해요.");

  try {
    const adapter = createFinnhubAdapter({ apiKey: finnhubApiKey });
    const quote = await adapter.fetchQuote({ symbol: trimmed });
    return { status: 200, body: { quote } };
  } catch (error) {
    const apiError = toApiError(error, "market_quote");
    return { status: apiError.retryable ? 502 : 400, body: { error: apiError } };
  }
}

export async function handleCandlesRoute(
  symbol: string,
  fromInclusive: string,
  toInclusive: string,
  twelveDataApiKey: string
): Promise<RouteResult> {
  const s = symbol.trim();
  const f = fromInclusive.trim();
  const t = toInclusive.trim();
  if (s === "" || f === "" || t === "") {
    return badRequest("historical_data", "symbol · from · to 가 모두 필요해요.");
  }

  try {
    const adapter = createTwelveDataHistoricalAdapter({ apiKey: twelveDataApiKey });
    const result = await adapter.fetchHistoricalCandles({ symbol: s, fromInclusive: f, toInclusive: t });
    return { status: 200, body: { result: { ...result, fallbackUsed: false } } };
  } catch (error) {
    const apiError = toApiError(error, "historical_data");
    const fallback = selectCandlesFallback(s, apiError);
    if (fallback !== undefined) {
      return { status: 200, body: { result: { ...fallback, fallbackUsed: true } } };
    }
    return { status: apiError.retryable ? 502 : 400, body: { error: apiError } };
  }
}

/** 실시간 조회가 실패했을 때 저장된 KR 스냅샷으로 대체할지 결정한다(순수 함수 — US 경로의
 * selectCandlesFallback 과 같은 패턴). 일시적 장애로 보이는 오류(retryable)이고, 이 심볼의
 * 실제 저장 스냅샷이 있을 때만 대체한다(§사용자 확정 — "fallback은 우선 삼성전자 005930만
 * 지원", "지원하지 않는 국내 종목은 가짜 결과 없이 오류 표시"). */
export function selectKrCandlesFallback(
  symbol: string,
  apiError: ApiProductError
): HistoricalCandlesResult | undefined {
  if (!apiError.retryable) return undefined;
  const snapshot = getKrSnapshot(symbol.trim());
  if (snapshot === undefined) return undefined;
  return {
    provider: "yahoo_kr_snapshot",
    symbol: symbol.trim(),
    requestedRange: { from: snapshot.metadata.rangeStart, to: snapshot.metadata.rangeEnd },
    actualRange: { from: snapshot.metadata.rangeStart, to: snapshot.metadata.rangeEnd },
    candles: snapshot.candles,
    fetchedAt: snapshot.metadata.capturedAt,
    adjustment: "splits",
    dividendAdjusted: false,
    completeness: "complete",
    fallbackUsed: true,
    asOfDate: snapshot.metadata.rangeEnd,
  };
}

/** 국내(KR) 과거 일봉 — Yahoo Finance 임시 provider(§공공데이터포털 발급 전까지, README 참고).
 * API 키가 필요 없어 미국 경로(handleCandlesRoute)와 달리 호출자에게 키를 받지 않는다.
 *
 * 순서: 매 요청마다 Yahoo 실시간 조회를 먼저 시도한다(§사용자 확정 — "Yahoo Finance live
 * request를 먼저 시도"). 429·timeout·5xx 등 일시적 장애(retryable)로 실패하면, 저장된 실제
 * 스냅샷이 있는 심볼(현재 삼성전자 005930)에 한해 그 스냅샷으로 대체한다. 스냅샷이 없거나
 * (다른 심볼) 오류 자체가 재시도 대상이 아니면(예: 종목 없음) 대체하지 않고 원래 오류를
 * 그대로 보여준다 — 지원하지 않는 걸 지원하는 척하지 않는다. */
export async function handleKoreanCandlesRoute(
  symbol: string,
  exchange: string,
  fromInclusive: string,
  toInclusive: string,
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>
): Promise<RouteResult> {
  const s = symbol.trim();
  const f = fromInclusive.trim();
  const t = toInclusive.trim();
  if (s === "" || f === "" || t === "") {
    return badRequest("historical_data", "symbol · from · to 가 모두 필요해요.");
  }
  if (exchange !== "KOSPI" && exchange !== "KOSDAQ") {
    return badRequest("historical_data", "exchange 는 KOSPI 또는 KOSDAQ 이어야 해요.");
  }

  try {
    const adapter = createYahooKoreanAdapter(fetchImpl !== undefined ? { fetchImpl } : {});
    const result = await adapter.fetchHistoricalCandles({ symbol: s, exchange, fromInclusive: f, toInclusive: t });
    return { status: 200, body: { result: { ...result, fallbackUsed: false } } };
  } catch (error) {
    const apiError = toApiError(error, "historical_data");
    const fallback = selectKrCandlesFallback(s, apiError);
    if (fallback !== undefined) {
      return { status: 200, body: { result: fallback } };
    }
    return { status: apiError.retryable ? 502 : 400, body: { error: apiError } };
  }
}

/** 실시간 조회가 실패했을 때 저장 데이터로 대체할지 결정한다(순수 함수 — 테스트 가능하게
 * 분리했다). 일시적 장애로 보이는 오류(retryable)이고, 이 심볼의 실제 저장 데이터가 있을
 * 때만 대체한다. 잘못된 심볼처럼 요청 자체의 문제라면 대체하지 않는다 — 대체 데이터가 없으면
 * 호출자가 원래 오류를 그대로 보여준다(§가짜로 지원하는 척 금지). */
export function selectCandlesFallback(
  symbol: string,
  apiError: ApiProductError
): HistoricalCandlesResult | undefined {
  if (!apiError.retryable) return undefined;
  return CANDLES_FALLBACK_BY_SYMBOL[symbol.trim().toUpperCase()];
}

/** 예기치 못한 예외(핸들러 밖)를 위한 공통 폴백. */
export const UNKNOWN_ERROR_RESULT: RouteResult = {
  status: 500,
  body: {
    error: {
      stage: "historical_data",
      code: "unknown",
      userMessage: "알 수 없는 오류가 발생했어요.",
      retryable: true,
    } satisfies ApiProductError,
  },
};
