/**
 * Historical market data 스파이크 (Tech Spike 2).
 *
 * 목적: 현재 Finnhub 키로 AAPL 최근 약 1년 일별 OHLCV(candle) 를 실제로 조회 가능한지 검증.
 * 실행: npm run spike:history
 *
 * 정책(AGENT_TOOL_CONTRACT §11, §23):
 *  - 실제 endpoint 호출. 실패 시 mock/fixture 대체 금지, 다른 provider 자동 전환 금지.
 *  - 오류 상태를 7종으로 명시 구분. 빈 배열을 성공으로 처리하지 않음.
 *  - API 키를 출력/로그에 남기지 않음(요청 URL 미출력, 메시지 redact).
 */
import "../env.ts";
import { classifyCompleteness, finnhubToCandles, partitionValid, sortAndDedupe } from "./normalize.ts";
import type {
  DailyCandle,
  DateRange,
  FinnhubCandleResponse,
  HistoricalFetchErrorCode,
  HistoricalFetchResult,
} from "./types.ts";

const SYMBOL = "AAPL";
const REQUESTED: DateRange = { from: "2025-07-28", to: "2026-07-27" };
const BASE = "https://finnhub.io/api/v1";

function toUnix(date: string, endOfDay = false): number {
  return Math.floor(Date.parse(`${date}T${endOfDay ? "23:59:59" : "00:00:00"}Z`) / 1000);
}

/** 문자열에서 토큰을 가려주는 함수 생성. */
function makeRedactor(token: string): (s: string) => string {
  return (s) => (token ? s.split(token).join("***REDACTED***") : s);
}

function classifyHttp(status: number): HistoricalFetchErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 402 || status === 403) return "forbidden_or_plan_restriction";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "network_failure";
  return "malformed_response";
}

async function fetchHistorical(): Promise<HistoricalFetchResult> {
  const token = process.env.FINNHUB_API_KEY ?? "";
  const redact = makeRedactor(token);

  if (!token) {
    return {
      ok: false,
      provider: "finnhub",
      symbol: SYMBOL,
      statusCode: null,
      errorCode: "api_key_missing",
      message: "FINNHUB_API_KEY 가 .env.local 에 없습니다.",
      latencyMs: null,
    };
  }

  const from = toUnix(REQUESTED.from);
  const to = toUnix(REQUESTED.to, true);
  // URL 은 토큰을 포함하므로 절대 출력하지 않는다.
  const url = `${BASE}/stock/candle?symbol=${encodeURIComponent(SYMBOL)}&resolution=D&from=${from}&to=${to}&token=${token}`;

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url);
  } catch (err) {
    return {
      ok: false,
      provider: "finnhub",
      symbol: SYMBOL,
      statusCode: null,
      errorCode: "network_failure",
      message: redact(err instanceof Error ? err.message : String(err)),
      latencyMs: Date.now() - started,
    };
  }
  const latencyMs = Date.now() - started;
  const status = res.status;

  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      provider: "finnhub",
      symbol: SYMBOL,
      statusCode: status,
      errorCode: classifyHttp(status),
      message: redact((body.slice(0, 300) || res.statusText).trim()),
      latencyMs,
    };
  }

  let json: FinnhubCandleResponse;
  try {
    json = (await res.json()) as FinnhubCandleResponse;
  } catch (err) {
    return {
      ok: false,
      provider: "finnhub",
      symbol: SYMBOL,
      statusCode: status,
      errorCode: "malformed_response",
      message: redact(err instanceof Error ? err.message : String(err)),
      latencyMs,
    };
  }

  if (json.s === "no_data") {
    return {
      ok: false,
      provider: "finnhub",
      symbol: SYMBOL,
      statusCode: status,
      errorCode: "no_data",
      message: "Finnhub 응답 s=no_data (해당 기간 데이터 없음).",
      latencyMs,
    };
  }
  if (json.s !== "ok" || !Array.isArray(json.c) || !Array.isArray(json.t)) {
    return {
      ok: false,
      provider: "finnhub",
      symbol: SYMBOL,
      statusCode: status,
      errorCode: "malformed_response",
      message: `예상치 못한 응답 형태 (s=${String(json.s)}).`,
      latencyMs,
    };
  }

  // 성공 응답 정규화
  const raw = finnhubToCandles(json);
  const { candles: unique, duplicateRowCount } = sortAndDedupe(raw);
  const { valid, invalidRowCount } = partitionValid(unique);
  const first = valid[0] ?? null;
  const last = valid.length > 0 ? valid[valid.length - 1]! : null;
  const actualRange: DateRange | null = first && last ? { from: first.date, to: last.date } : null;

  return {
    ok: true,
    provider: "finnhub",
    symbol: SYMBOL,
    statusCode: status,
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
    console.log(`status code         : ${r.statusCode ?? "(none)"}`);
    console.log(`error code          : ${r.errorCode}`);
    console.log(`message             : ${r.message}`);
    console.log(`latency             : ${r.latencyMs ?? "(n/a)"}ms`);
    console.log(`completeness        : insufficient (no valid data)`);
    return false;
  }

  console.log(`status code         : ${r.statusCode}`);
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
  console.log("[spike:history] Finnhub historical candle 검증\n");
  const result = await fetchHistorical();
  const pass = printResult(result);
  console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}`);
  console.log("→ 상세 결론은 spikes/historical-market-data/TECH_SPIKE_2_RESULT.md 에 기록");
  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error("[spike:history] 실행 실패:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
