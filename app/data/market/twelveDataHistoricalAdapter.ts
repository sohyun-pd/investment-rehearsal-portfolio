/**
 * Twelve Data 과거 일봉 adapter (production).
 *
 * 검증 근거:
 *  - `TECH_SPIKE_2B_RESULT.md` — AAPL 최근 1년 250 거래일, invalid 0, duplicate 0, complete
 *  - `ADJUSTMENT_CHECK_RESULT.md` — `adjust=splits` 실측 확인, `end_date` exclusive 확인
 *
 * 규칙:
 *  - `adjust=splits` 를 **명시**한다. API 기본값에 의존하지 않는다.
 *  - dividend adjustment 는 사용하지 않는다.
 *  - `toInclusive + 1일` 을 `end_date` 로 보낸다. exclusive 동작을 호출부에 노출하지 않는다.
 *  - HTTP 200 이어도 body 의 `status="error"` / `code` 를 검사한다.
 *  - candle 0개를 성공으로 처리하지 않는다.
 *  - 실패 시 mock/fixture 로 대체하지 않고 `MarketDataError` 를 던진다.
 *  - API 키와 요청 URL 을 로그·오류 메시지에 남기지 않는다.
 *
 * 보안: 이 adapter 는 API 키를 사용하므로 **브라우저 번들에서 직접 호출하면 키가 노출된다.**
 * 앱 연동 단계에서는 서버(또는 BFF)에서 호출하고 결과만 클라이언트로 내려야 한다.
 * 그래서 키를 `import.meta.env.VITE_*` 로 읽지 않는다.
 */
import { fetchWithTimeout } from "./httpTimeout";
import {
  classifyCompleteness,
  parseTwelveDataValues,
  partitionValidCandles,
  sortAndDedupeCandles,
  toExclusiveEndDate,
  isValidDateString,
} from "./normalizeCandles";
import {
  MarketDataError,
  type FetchHistoricalCandlesInput,
  type HistoricalCandlesResult,
  type TwelveDataTimeSeriesResponse,
} from "./types";

const PROVIDER = "twelve_data" as const;
const BASE_URL = "https://api.twelvedata.com";
const INTERVAL = "1day";
const ORDER = "asc";
const ADJUST = "splits";
const OUTPUTSIZE = 5000;

export type FetchLike = (url: string) => Promise<Response>;

export interface TwelveDataHistoricalConfig {
  /** 호출자가 주입한다. 이 파일이 환경변수를 직접 읽지 않는 편이 테스트·보안 모두 유리하다. */
  apiKey: string;
  /** 테스트에서 HTTP 계층을 대체하기 위한 주입점. production 에서는 생략한다. */
  fetchImpl?: FetchLike;
  /** `fetchedAt` 생성기. 테스트에서 고정값을 넣기 위한 주입점. */
  now?: () => Date;
}

export interface HistoricalMarketDataPort {
  fetchHistoricalCandles(input: FetchHistoricalCandlesInput): Promise<HistoricalCandlesResult>;
}

function fail(
  code: MarketDataError["code"],
  message: string,
  detail: { httpStatus?: number | null; apiStatus?: string | null; apiCode?: number | null } = {}
): never {
  throw new MarketDataError(code, message, { provider: PROVIDER, ...detail });
}

/** 사유 문자열에 크레딧 소진 신호가 있는지. */
function looksLikeCreditsExceeded(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("credit") || lower.includes("quota") || lower.includes("daily limit");
}

/** Twelve Data 는 "이 종목은 현재 요금제(Basic)에서 지원하지 않는다"는 사실도 HTTP 404 로
 * 알린다(예: 국내 KRX 종목의 quote·time_series — 실제로 확인함, 메시지: "This symbol is
 * available starting with the Pro or Venture plan."). 이걸 그냥 404 로만 보고 "no_data"(해당
 * 기간 데이터를 찾지 못했어요)로 분류하면, "이 시장은 아직 연결 안 됐다"는 진짜 원인이
 * "그 기간엔 데이터가 없다"는 다른 오류처럼 보인다(§재발했던 회귀). */
function looksLikePlanRestricted(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("plan") || lower.includes("subscription") || lower.includes("upgrade");
}

/**
 * HTTP status 와 body `code` 를 같은 규칙으로 해석한다.
 * Twelve Data 는 두 경로로 오류를 알리기 때문이다.
 */
function classifyCode(code: number, message: string): MarketDataError["code"] {
  if (code === 401) return "unauthorized";
  if (code === 402 || code === 403 || code === 432 || code === 433) {
    return "forbidden_or_plan_restriction";
  }
  if (code === 429) {
    return looksLikeCreditsExceeded(message) ? "credits_exceeded" : "rate_limited";
  }
  if (code === 404) return looksLikePlanRestricted(message) ? "market_not_supported" : "no_data";
  if (code >= 500) return "network_failure";
  return "malformed_response";
}

function validateInput(input: FetchHistoricalCandlesInput): void {
  if (typeof input.symbol !== "string" || input.symbol.trim() === "") {
    fail("invalid_request", "symbol 이 비어 있습니다.");
  }
  if (!isValidDateString(input.fromInclusive) || !isValidDateString(input.toInclusive)) {
    fail("invalid_request", "fromInclusive / toInclusive 는 YYYY-MM-DD 형식이어야 합니다.");
  }
  if (input.fromInclusive > input.toInclusive) {
    fail("invalid_request", "fromInclusive 가 toInclusive 보다 뒤입니다.");
  }
}

export function createTwelveDataHistoricalAdapter(
  config: TwelveDataHistoricalConfig
): HistoricalMarketDataPort {
  const { apiKey } = config;
  const doFetch: FetchLike = config.fetchImpl ?? ((url) => fetchWithTimeout(url));
  const now = config.now ?? (() => new Date());

  /** 문자열에서 키를 가려준다. 오류 메시지에 키가 새지 않게 하는 마지막 방어선. */
  const redact = (text: string): string =>
    apiKey === "" ? text : text.split(apiKey).join("***REDACTED***");

  return {
    async fetchHistoricalCandles(
      input: FetchHistoricalCandlesInput
    ): Promise<HistoricalCandlesResult> {
      if (apiKey === "") {
        fail("api_key_missing", "TWELVE_DATA_API_KEY 가 설정되지 않았습니다.");
      }
      validateInput(input);

      const params = new URLSearchParams({
        symbol: input.symbol,
        interval: INTERVAL,
        start_date: input.fromInclusive,
        // end_date 는 exclusive 다. 사용자 기준 종료일 + 1일을 보낸다.
        end_date: toExclusiveEndDate(input.toInclusive),
        order: ORDER,
        format: "JSON",
        outputsize: String(OUTPUTSIZE),
        adjust: ADJUST,
        apikey: apiKey,
      });
      // URL 은 키를 포함한다. 로그·오류 메시지에 절대 넣지 않는다.
      const url = `${BASE_URL}/time_series?${params.toString()}`;

      let response: Response;
      try {
        response = await doFetch(url);
      } catch (error) {
        fail(
          "network_failure",
          redact(error instanceof Error ? error.message : String(error))
        );
      }

      const bodyText = await response.text().catch(() => "");

      let json: TwelveDataTimeSeriesResponse;
      try {
        json = JSON.parse(bodyText) as TwelveDataTimeSeriesResponse;
      } catch {
        fail(
          response.ok ? "malformed_response" : classifyCode(response.status, bodyText),
          redact((bodyText.slice(0, 300) || response.statusText).trim()),
          { httpStatus: response.status }
        );
      }

      const apiStatus = typeof json.status === "string" ? json.status : null;
      const apiCode = typeof json.code === "number" ? json.code : null;
      const apiMessage = typeof json.message === "string" ? json.message : "";

      // HTTP 200 이어도 body 의 status=error 를 오류로 처리한다.
      if (!response.ok || apiStatus === "error" || apiCode !== null) {
        fail(
          classifyCode(apiCode ?? response.status, apiMessage),
          redact((apiMessage || bodyText.slice(0, 300) || response.statusText).trim()),
          { httpStatus: response.status, apiStatus, apiCode }
        );
      }

      if (!Array.isArray(json.values)) {
        fail("malformed_response", `values 배열이 없습니다 (status=${String(apiStatus)}).`, {
          httpStatus: response.status,
          apiStatus,
        });
      }

      const parsed = parseTwelveDataValues(json.values);
      const { candles: unique } = sortAndDedupeCandles(parsed);
      const { valid, invalidRowCount } = partitionValidCandles(unique);

      const first = valid[0];
      const last = valid[valid.length - 1];

      // candle 0개를 성공으로 처리하지 않는다.
      if (first === undefined || last === undefined) {
        fail(
          "no_data",
          `유효한 candle 이 0개입니다 (raw=${parsed.length}, invalid=${invalidRowCount}).`,
          { httpStatus: response.status, apiStatus }
        );
      }

      return {
        provider: PROVIDER,
        symbol: input.symbol,
        requestedRange: { from: input.fromInclusive, to: input.toInclusive },
        actualRange: { from: first.date, to: last.date },
        candles: valid,
        fetchedAt: now().toISOString(),
        adjustment: ADJUST,
        dividendAdjusted: false,
        completeness: classifyCompleteness(valid.length),
      };
    },
  };
}

/**
 * 환경변수에서 키를 읽는다.
 *
 * `process` 를 직접 참조하지 않고 `globalThis` 를 통해 조회한다. 브라우저 번들에서
 * `process` 가 없어도 안전하고, 앱 tsconfig 에 node 타입을 넣지 않아도 되기 때문이다.
 * 브라우저에서는 키가 없으므로 `api_key_missing` 으로 명시 실패한다(조용한 fallback 금지).
 */
export function resolveTwelveDataApiKey(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  return env?.TWELVE_DATA_API_KEY ?? "";
}

/** 기본 adapter. 키는 환경변수에서 해석한다. */
export async function fetchHistoricalCandles(
  input: FetchHistoricalCandlesInput
): Promise<HistoricalCandlesResult> {
  const adapter = createTwelveDataHistoricalAdapter({ apiKey: resolveTwelveDataApiKey() });
  return adapter.fetchHistoricalCandles(input);
}
