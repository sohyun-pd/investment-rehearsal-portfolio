/**
 * 국내(KR) 과거 일봉 — Yahoo Finance chart 임시 provider.
 *
 * 근거: 사용자 확정 — 공공데이터포털 신규 활용신청이 점검 기간이라 오늘 `DATA_GO_KR_SERVICE_KEY`
 * 를 발급받을 수 없다. 오늘 제출용 프로토타입에서는 Yahoo Finance 의 실제 일별 가격을 국내
 * provider 로 연결하고, 추후 공공데이터포털 provider 로 교체 가능한 adapter 구조로 분리한다
 * (README 에 명시). mock 가격 생성·임의 OHLC 생성·미국 가격 대입은 하지 않는다 — 실제 Yahoo
 * 응답이 성공한 경우에만 결과를 만든다.
 *
 * 실측 확인(curl, 2026-07-30):
 *  - GET https://query1.finance.yahoo.com/v8/finance/chart/005930.KS?period1=...&period2=...
 *    &interval=1d → HTTP 200, meta.currency="KRW", quote.close/open/high/low/volume 과
 *    indicators.adjclose[0].adjclose 가 timestamp 와 같은 index 로 연결됨.
 *  - 잘못된 symbol(예: 0000000.KS) → HTTP 404, `{chart:{result:null,error:{code:"Not Found",
 *    description:"No data found, symbol may be delisted"}}}`.
 *  - User-Agent 헤더 없이도 응답은 오지만, 실제 브라우저처럼 명시적으로 보낸다(차단 방지).
 *
 * 종목코드 → provider symbol 변환(KOSPI→.KS, KOSDAQ→.KQ)은 이 adapter 내부에서만 한다 —
 * canonical `symbol`(예: 005930)은 앞자리 0 을 유지한 채로 그대로 결과에 남는다(§사용자 확정).
 *
 * 분할 조정: 미국 가격(Twelve Data adjust=splits)과 같은 기준으로 맞추기 위해 각 날짜의
 * `adjustmentRatio = adjustedClose / rawClose` 를 open·high·low 에도 곱한다. adjustedClose 가
 * 없으면(배당·분할 이벤트가 없는 구간 등) ratio=1 로 raw OHLC 를 그대로 쓴다.
 */
import { fetchWithTimeout } from "./httpTimeout";
import {
  classifyCompleteness,
  isValidDateString,
  partitionValidCandles,
  sortAndDedupeCandles,
} from "./normalizeCandles";
import {
  MarketDataError,
  type FetchHistoricalCandlesInput,
  type HistoricalCandlesResult,
  type YahooChartResponse,
} from "./types";
import type { DailyCandle } from "@/domain/simulation";

const PROVIDER = "yahoo_kr" as const;
const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DAY_SECONDS = 86_400;
const SEOUL_OFFSET_MS = 9 * 60 * 60 * 1000; // Asia/Seoul, UTC+9, DST 없음

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface YahooKoreanAdapterConfig {
  fetchImpl?: FetchLike;
  now?: () => Date;
}

export interface KoreanCandlesInput extends FetchHistoricalCandlesInput {
  /** KOSPI → `.KS`, KOSDAQ → `.KQ` — 검색 결과에서 받은 exchange 값만 쓴다(문자열 추측 금지). */
  exchange: "KOSPI" | "KOSDAQ";
}

export interface KoreanMarketDataPort {
  fetchHistoricalCandles(input: KoreanCandlesInput): Promise<HistoricalCandlesResult>;
}

/** 종목코드 앞자리 0 을 유지한다 — `005930` → `5930` 으로 바뀌면 안 된다(§사용자 확정). 단순
 * 문자열 접합이라 이 규칙이 코드만 봐도 명확하다. */
export function toYahooProviderSymbol(symbol: string, exchange: "KOSPI" | "KOSDAQ"): string {
  return `${symbol}${exchange === "KOSPI" ? ".KS" : ".KQ"}`;
}

function fail(
  code: Extract<
    import("./types").MarketDataErrorCode,
    "invalid_request" | "kr_provider_request_failed" | "kr_symbol_not_found" | "kr_empty_response" | "kr_insufficient_history" | "kr_normalization_failed" | "network_failure"
  >,
  message: string,
  detail: { httpStatus?: number | null } = {}
): never {
  throw new MarketDataError(code, message, { provider: PROVIDER, ...detail });
}

function toUnixSeconds(dateOnly: string): number {
  return Math.floor(Date.parse(`${dateOnly}T00:00:00Z`) / 1000);
}

/** Yahoo timestamp(UTC epoch seconds, 거래소 현지 자정 근방)를 Asia/Seoul 기준 날짜로 바꾼다.
 * KRX 거래일은 Seoul 자정~자정이므로, UTC epoch 에 +9시간을 더한 뒤 날짜만 자른다. */
function toSeoulDateString(unixSeconds: number): string {
  return new Date(unixSeconds * 1000 + SEOUL_OFFSET_MS).toISOString().slice(0, 10);
}

function looksLikeNotFound(description: string | undefined, httpStatus: number): boolean {
  if (httpStatus === 404) return true;
  const lower = (description ?? "").toLowerCase();
  return lower.includes("no data") || lower.includes("delisted") || lower.includes("not found");
}

export function createYahooKoreanAdapter(config: YahooKoreanAdapterConfig = {}): KoreanMarketDataPort {
  const fetchImpl = config.fetchImpl ?? fetchWithTimeout;
  const now = config.now ?? (() => new Date());

  return {
    async fetchHistoricalCandles(input: KoreanCandlesInput): Promise<HistoricalCandlesResult> {
      const symbol = input.symbol.trim();
      if (symbol === "") fail("invalid_request", "symbol 이 필요해요.");
      if (!isValidDateString(input.fromInclusive) || !isValidDateString(input.toInclusive)) {
        fail("invalid_request", "from · to 날짜 형식이 올바르지 않아요.");
      }

      const providerSymbol = toYahooProviderSymbol(symbol, input.exchange);
      const period1 = toUnixSeconds(input.fromInclusive);
      // toInclusive 당일 거래 데이터까지 확실히 받도록 하루치 여유를 더한다(Yahoo 의 period2
      // 포함/제외 경계가 Twelve Data 의 exclusive 관례처럼 문서화돼 있지 않아, 실측 기준 여유를
      // 둔 뒤 아래에서 요청 범위로 다시 잘라낸다).
      const period2 = toUnixSeconds(input.toInclusive) + DAY_SECONDS;

      const url =
        `${BASE_URL}/${encodeURIComponent(providerSymbol)}` +
        `?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;

      let response: Response;
      try {
        response = await fetchImpl(url, { headers: { "User-Agent": USER_AGENT } });
      } catch {
        fail("network_failure", "Yahoo Finance 요청에 실패했어요.");
      }

      // HTTP 상태를 JSON 파싱보다 먼저 본다 — 서버 오류(5xx 등)는 본문이 JSON 이 아닐 수 있고,
      // 그 경우 "본문을 못 읽었다"(kr_normalization_failed, "정상 응답인데 구조가 이상하다"는
      // 뜻)가 아니라 "요청 자체가 실패했다"(kr_provider_request_failed)로 분류해야 원인이
      // 정확하다(§실제로 재현한 테스트 실패 — 500 응답의 텍스트 본문을 JSON 파싱하려다 실패해
      // 엉뚱하게 normalization_failed 로 분류됐었다).
      let rawBody: unknown;
      try {
        rawBody = await response.json();
      } catch {
        if (!response.ok) {
          fail("kr_provider_request_failed", `Yahoo Finance HTTP ${response.status}`, {
            httpStatus: response.status,
          });
        }
        fail("kr_normalization_failed", "Yahoo Finance 응답을 읽지 못했어요.", { httpStatus: response.status });
      }
      const body = rawBody as YahooChartResponse;

      if (body.chart.error !== null && body.chart.error !== undefined) {
        const description = body.chart.error.description;
        if (looksLikeNotFound(description, response.status)) {
          fail("kr_symbol_not_found", description ?? "종목을 찾지 못했어요.", { httpStatus: response.status });
        }
        fail("kr_provider_request_failed", description ?? "Yahoo Finance 요청이 실패했어요.", {
          httpStatus: response.status,
        });
      }
      if (!response.ok) {
        fail("kr_provider_request_failed", `Yahoo Finance HTTP ${response.status}`, { httpStatus: response.status });
      }

      const result = body.chart.result?.[0];
      if (result === undefined) fail("kr_empty_response", "Yahoo Finance 응답에 결과가 없어요.");

      const timestamps = result.timestamp;
      const quote = result.indicators.quote[0];
      if (timestamps === undefined || timestamps.length === 0 || quote === undefined) {
        fail("kr_empty_response", "가격 데이터가 비어 있어요.");
      }

      const adjClose = result.indicators.adjclose?.[0]?.adjclose;

      const rawCandles: DailyCandle[] = [];
      for (let i = 0; i < timestamps.length; i++) {
        const rawOpen = quote.open[i];
        const rawHigh = quote.high[i];
        const rawLow = quote.low[i];
        const rawClose = quote.close[i];
        const volume = quote.volume[i] ?? null;

        // null 행(휴장·데이터 누락) 은 조용히 건너뛴다 — 지어내지 않는다.
        if (
          rawOpen === null ||
          rawOpen === undefined ||
          rawHigh === null ||
          rawHigh === undefined ||
          rawLow === null ||
          rawLow === undefined ||
          rawClose === null ||
          rawClose === undefined ||
          rawClose <= 0
        ) {
          continue;
        }

        const adjustedCloseRaw = adjClose?.[i];
        const hasAdjustment =
          adjustedCloseRaw !== null && adjustedCloseRaw !== undefined && Number.isFinite(adjustedCloseRaw);
        const ratio = hasAdjustment ? adjustedCloseRaw / rawClose : 1;

        rawCandles.push({
          date: toSeoulDateString(timestamps[i]!),
          open: rawOpen * ratio,
          high: rawHigh * ratio,
          low: rawLow * ratio,
          close: hasAdjustment ? adjustedCloseRaw : rawClose,
          volume,
        });
      }

      const { candles: deduped } = sortAndDedupeCandles(rawCandles);
      const { valid } = partitionValidCandles(deduped);
      const inRange = valid.filter((c) => c.date >= input.fromInclusive && c.date <= input.toInclusive);

      const completeness = classifyCompleteness(inRange.length);
      if (completeness === "insufficient") {
        fail("kr_insufficient_history", "최근 1년 전체를 계산하기에 가격 데이터가 부족해요.");
      }

      return {
        provider: PROVIDER,
        symbol,
        requestedRange: { from: input.fromInclusive, to: input.toInclusive },
        actualRange: {
          from: inRange[0]?.date ?? input.fromInclusive,
          to: inRange[inRange.length - 1]?.date ?? input.toInclusive,
        },
        candles: inRange,
        fetchedAt: now().toISOString(),
        adjustment: "splits",
        dividendAdjusted: false,
        completeness,
      };
    },
  };
}
