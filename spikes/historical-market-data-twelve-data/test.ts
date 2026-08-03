/**
 * Twelve Data historical market data 스파이크 (Tech Spike 2B).
 *
 * 목적: 현재 Twelve Data 키로 AAPL 최근 약 1년 일별 OHLCV 를 실제로 조회 가능한지 검증.
 * 배경: Finnhub historical candle 은 현재 계정/키에서 HTTP 403 으로 거부됐다
 *       (spikes/historical-market-data/TECH_SPIKE_2_RESULT.md). Finnhub 의 symbol search 와
 *       current quote 는 유지하고, 과거 일봉 전용 provider 만 여기서 별도 검증한다.
 * 실행: npm run spike:history:twelve
 *
 * 정책(AGENT_TOOL_CONTRACT §11, §23):
 *  - 실제 endpoint 호출. 실패 시 mock/fixture/Finnhub 데이터로 대체 금지, provider 자동 전환 금지.
 *  - 오류 상태를 8종으로 명시 구분. 빈 배열을 성공으로 처리하지 않음.
 *  - Twelve Data 는 HTTP 200 으로도 body 에 status="error" 를 실어 보내므로 body 를 반드시 검사.
 *  - API 키를 출력/로그에 남기지 않음(요청 URL 미출력, 메시지 redact).
 */
import "../env.ts";
import {
  classifyCompleteness,
  partitionValid,
  sortAndDedupe,
  twelveDataToCandles,
} from "./normalize.ts";
import type {
  DailyCandle,
  DateRange,
  HistoricalFetchErrorCode,
  HistoricalFetchResult,
  TwelveDataTimeSeriesResponse,
} from "./types.ts";

const PROVIDER = "twelve_data" as const;
const SYMBOL = "AAPL";
const INTERVAL = "1day";
const OUTPUTSIZE = 5000;
const REQUESTED: DateRange = { from: "2025-07-28", to: "2026-07-27" };
const BASE = "https://api.twelvedata.com";

/** 문자열에서 키를 가려주는 함수 생성. */
function makeRedactor(key: string): (s: string) => string {
  return (s) => (key ? s.split(key).join("***REDACTED***") : s);
}

/** 사유 문자열에 크레딧 소진 신호가 있는지. */
function looksLikeCreditsExceeded(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("credit") || m.includes("quota") || m.includes("daily limit");
}

/**
 * 오류 코드 분류. Twelve Data 는 HTTP status 와 body code 두 경로로 오류를 알린다.
 * 둘 다 같은 규칙으로 해석하기 위해 코드 + 메시지를 함께 본다.
 */
function classifyCode(code: number, message: string): HistoricalFetchErrorCode {
  if (code === 401) return "unauthorized";
  if (code === 402 || code === 403 || code === 432 || code === 433) {
    return "forbidden_or_plan_restriction";
  }
  if (code === 429) {
    return looksLikeCreditsExceeded(message) ? "credits_exceeded" : "rate_limited";
  }
  if (code === 404) return "no_data";
  if (code >= 500) return "network_failure";
  return "malformed_response";
}

async function fetchHistorical(): Promise<HistoricalFetchResult> {
  const apiKey = process.env.TWELVE_DATA_API_KEY ?? "";
  const redact = makeRedactor(apiKey);

  if (!apiKey) {
    return {
      ok: false,
      provider: PROVIDER,
      symbol: SYMBOL,
      statusCode: null,
      apiStatus: null,
      apiCode: null,
      errorCode: "api_key_missing",
      message: "TWELVE_DATA_API_KEY 가 .env.local 에 없습니다.",
      latencyMs: null,
    };
  }

  const params = new URLSearchParams({
    symbol: SYMBOL,
    interval: INTERVAL,
    start_date: REQUESTED.from,
    end_date: REQUESTED.to,
    order: "asc",
    format: "JSON",
    outputsize: String(OUTPUTSIZE),
    apikey: apiKey,
  });
  // URL 은 키를 포함하므로 절대 출력하지 않는다.
  const url = `${BASE}/time_series?${params.toString()}`;

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return {
      ok: false,
      provider: PROVIDER,
      symbol: SYMBOL,
      statusCode: null,
      apiStatus: null,
      apiCode: null,
      errorCode: "network_failure",
      message: redact(err instanceof Error ? err.message : String(err)),
      latencyMs: Date.now() - started,
    };
  }
  const latencyMs = Date.now() - started;
  const status = res.status;

  const bodyText = await res.text().catch(() => "");

  let json: TwelveDataTimeSeriesResponse;
  try {
    json = JSON.parse(bodyText) as TwelveDataTimeSeriesResponse;
  } catch {
    // JSON 이 아니면 HTTP status 로만 분류한다.
    return {
      ok: false,
      provider: PROVIDER,
      symbol: SYMBOL,
      statusCode: status,
      apiStatus: null,
      apiCode: null,
      errorCode: res.ok ? "malformed_response" : classifyCode(status, bodyText),
      message: redact((bodyText.slice(0, 300) || res.statusText).trim()),
      latencyMs,
    };
  }

  const apiStatus = typeof json.status === "string" ? json.status : null;
  const apiCode = typeof json.code === "number" ? json.code : null;
  const apiMessage = typeof json.message === "string" ? json.message : "";

  // HTTP 200 이어도 body 의 status=error 를 오류로 처리한다.
  if (!res.ok || apiStatus === "error" || apiCode !== null) {
    const code = apiCode ?? status;
    return {
      ok: false,
      provider: PROVIDER,
      symbol: SYMBOL,
      statusCode: status,
      apiStatus,
      apiCode,
      errorCode: classifyCode(code, apiMessage),
      message: redact((apiMessage || bodyText.slice(0, 300) || res.statusText).trim()),
      latencyMs,
    };
  }

  if (!Array.isArray(json.values)) {
    return {
      ok: false,
      provider: PROVIDER,
      symbol: SYMBOL,
      statusCode: status,
      apiStatus,
      apiCode,
      errorCode: "malformed_response",
      message: `values 배열이 없습니다 (status=${String(apiStatus)}).`,
      latencyMs,
    };
  }

  if (json.values.length === 0) {
    return {
      ok: false,
      provider: PROVIDER,
      symbol: SYMBOL,
      statusCode: status,
      apiStatus,
      apiCode,
      errorCode: "no_data",
      message: "values 배열이 비어 있습니다 (해당 기간 데이터 없음).",
      latencyMs,
    };
  }

  // 정규화: 문자열 → number, 정렬, 중복 제거, 유효성 검사
  const raw = twelveDataToCandles(json);
  const { candles: unique, duplicateRowCount } = sortAndDedupe(raw);
  const { valid, invalidRowCount } = partitionValid(unique);

  // 빈 배열을 성공으로 처리하지 않는다.
  if (valid.length === 0) {
    return {
      ok: false,
      provider: PROVIDER,
      symbol: SYMBOL,
      statusCode: status,
      apiStatus,
      apiCode,
      errorCode: "malformed_response",
      message: `유효한 candle 이 0개입니다 (raw=${raw.length}, invalid=${invalidRowCount}).`,
      latencyMs,
    };
  }

  const first = valid[0] ?? null;
  const last = valid.length > 0 ? valid[valid.length - 1]! : null;
  const actualRange: DateRange | null = first && last ? { from: first.date, to: last.date } : null;

  return {
    ok: true,
    provider: PROVIDER,
    symbol: SYMBOL,
    statusCode: status,
    apiStatus,
    requestedRange: REQUESTED,
    actualRange,
    tradingDayCount: valid.length,
    candles: valid,
    firstCandle: first,
    lastCandle: last,
    invalidRowCount,
    duplicateRowCount,
    latencyMs,
    completeness: classifyCompleteness(valid.length),
  };
}

function fmtCandle(c: DailyCandle | null): string {
  if (!c) return "(none)";
  return `${c.date} O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume ?? "null"}`;
}

function printResult(r: HistoricalFetchResult): boolean {
  console.log(`provider            : ${r.provider}`);
  console.log(`symbol              : ${r.symbol}`);
  console.log(`requested range     : ${REQUESTED.from} ~ ${REQUESTED.to}`);

  if (!r.ok) {
    console.log(`http status         : ${r.statusCode ?? "(none)"}`);
    console.log(`api response status : ${r.apiStatus ?? "(none)"}${r.apiCode !== null ? ` (code=${r.apiCode})` : ""}`);
    console.log(`error code          : ${r.errorCode}`);
    console.log(`message             : ${r.message}`);
    console.log(`actual range        : (none)`);
    console.log(`trading day count   : 0`);
    console.log(`first candle        : (none)`);
    console.log(`last candle         : (none)`);
    console.log(`invalid row count   : (n/a)`);
    console.log(`duplicate row count : (n/a)`);
    console.log(`latency             : ${r.latencyMs ?? "(n/a)"}ms`);
    console.log(`completeness        : insufficient (no valid data)`);
    return false;
  }

  console.log(`http status         : ${r.statusCode}`);
  console.log(`api response status : ${r.apiStatus ?? "(none)"}`);
  console.log(`actual range        : ${r.actualRange ? `${r.actualRange.from} ~ ${r.actualRange.to}` : "(none)"}`);
  console.log(`trading day count   : ${r.tradingDayCount}`);
  console.log(`first candle        : ${fmtCandle(r.firstCandle)}`);
  console.log(`last candle         : ${fmtCandle(r.lastCandle)}`);
  console.log(`invalid row count   : ${r.invalidRowCount}`);
  console.log(`duplicate row count : ${r.duplicateRowCount}`);
  console.log(`latency             : ${r.latencyMs}ms`);
  console.log(`completeness        : ${r.completeness}`);
  return r.completeness !== "insufficient";
}

async function main(): Promise<void> {
  console.log("[spike:history:twelve] Twelve Data historical daily candle 검증\n");
  const result = await fetchHistorical();
  const pass = printResult(result);
  console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}`);
  console.log(
    "→ 상세 결론은 spikes/historical-market-data-twelve-data/TECH_SPIKE_2B_RESULT.md 에 기록"
  );
  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error(
    "[spike:history:twelve] 실행 실패:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
