/**
 * Twelve Data split adjustment 검증 (Tech Spike 2B 후속).
 *
 * 목적: /time_series 의 adjust=splits 가 주식 분할 전후 가격을 하나의 일관된 주식 단위로
 *       연결해 주는지 실제 호출로 확인한다. AAPL 은 2020-08-31 에 4-for-1 split 이 있었다.
 * 실행: npm run spike:history:adjustment
 *
 * 정책:
 *  - 실제 endpoint 호출. mock/fixture 대체 금지.
 *  - 특정 가격을 하드코딩해 PASS 처리하지 않는다. 두 응답의 **차이**로만 판단한다.
 *  - API 키와 전체 요청 URL 을 출력하지 않는다.
 *
 * end_date 는 exclusive 임이 확인됐으므로(README "알려진 동작") 사용자 기준 inclusive 종료일
 * 2020-09-04 를 얻기 위해 실제 요청에는 2020-09-05 를 보낸다.
 */
import "../env.ts";
import { partitionValid, sortAndDedupe, twelveDataToCandles } from "./normalize.ts";
import type { DailyCandle, TwelveDataTimeSeriesResponse } from "./types.ts";

const SYMBOL = "AAPL";
const INTERVAL = "1day";
const START_DATE = "2020-08-24";
const INCLUSIVE_END = "2020-09-04";
const API_END_DATE = "2020-09-05"; // exclusive 보정
const OUTPUTSIZE = 5000;
const BASE = "https://api.twelvedata.com";

/** split 경계 비교에 쓰는 두 날짜 (AAPL 4-for-1 split 효력일: 2020-08-31). */
const BEFORE_DATE = "2020-08-28";
const AFTER_DATE = "2020-08-31";

/**
 * "비정상적 가격 단절" 판정 임계값.
 * 인접 거래일 종가 비율이 이 값을 넘으면 단절로 본다. 일반적인 일간 변동(수 %)과
 * 분할로 인한 단위 변화(2배 이상)를 구분하기 위한 값이며, 특정 가격에 의존하지 않는다.
 */
const DISCONTINUITY_RATIO = 1.5;

type AdjustMode = "none" | "splits";

interface SeriesResult {
  mode: AdjustMode;
  httpStatus: number | null;
  apiStatus: string | null;
  apiCode: number | null;
  errorMessage: string | null;
  latencyMs: number | null;
  candles: DailyCandle[];
  invalidRowCount: number;
  duplicateRowCount: number;
}

function makeRedactor(key: string): (s: string) => string {
  return (s) => (key ? s.split(key).join("***REDACTED***") : s);
}

async function fetchSeries(mode: AdjustMode, apiKey: string): Promise<SeriesResult> {
  const redact = makeRedactor(apiKey);
  const base: SeriesResult = {
    mode,
    httpStatus: null,
    apiStatus: null,
    apiCode: null,
    errorMessage: null,
    latencyMs: null,
    candles: [],
    invalidRowCount: 0,
    duplicateRowCount: 0,
  };

  const params = new URLSearchParams({
    symbol: SYMBOL,
    interval: INTERVAL,
    start_date: START_DATE,
    end_date: API_END_DATE,
    order: "asc",
    format: "JSON",
    outputsize: String(OUTPUTSIZE),
    adjust: mode,
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
      ...base,
      latencyMs: Date.now() - started,
      errorMessage: redact(err instanceof Error ? err.message : String(err)),
    };
  }
  const latencyMs = Date.now() - started;
  const bodyText = await res.text().catch(() => "");

  let json: TwelveDataTimeSeriesResponse;
  try {
    json = JSON.parse(bodyText) as TwelveDataTimeSeriesResponse;
  } catch {
    return {
      ...base,
      httpStatus: res.status,
      latencyMs,
      errorMessage: redact((bodyText.slice(0, 300) || res.statusText).trim()),
    };
  }

  const apiStatus = typeof json.status === "string" ? json.status : null;
  const apiCode = typeof json.code === "number" ? json.code : null;

  // HTTP 200 이어도 body 의 status=error / code 를 오류로 처리한다.
  if (!res.ok || apiStatus === "error" || apiCode !== null) {
    return {
      ...base,
      httpStatus: res.status,
      apiStatus,
      apiCode,
      latencyMs,
      errorMessage: redact(
        (json.message ?? bodyText.slice(0, 300) ?? res.statusText).trim()
      ),
    };
  }

  const raw = twelveDataToCandles(json);
  const { candles: unique, duplicateRowCount } = sortAndDedupe(raw);
  const { valid, invalidRowCount } = partitionValid(unique);

  return {
    mode,
    httpStatus: res.status,
    apiStatus,
    apiCode,
    errorMessage: null,
    latencyMs,
    candles: valid,
    invalidRowCount,
    duplicateRowCount,
  };
}

function findCandle(candles: DailyCandle[], date: string): DailyCandle | null {
  return candles.find((c) => c.date === date) ?? null;
}

function fmtCandle(c: DailyCandle | null): string {
  if (!c) return "(none)";
  return `${c.date} O:${c.open} H:${c.high} L:${c.low} C:${c.close} V:${c.volume ?? "null"}`;
}

/** 인접 거래일 종가 비율의 최대값(항상 ≥1)과 그 위치. 시계열 전체의 단절 탐지용. */
function maxAdjacentCloseRatio(
  candles: DailyCandle[]
): { ratio: number; from: string; to: string } | null {
  let worst: { ratio: number; from: string; to: string } | null = null;
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1]!;
    const cur = candles[i]!;
    if (prev.close <= 0 || cur.close <= 0) continue;
    const ratio = Math.max(prev.close / cur.close, cur.close / prev.close);
    if (!worst || ratio > worst.ratio) {
      worst = { ratio, from: prev.date, to: cur.date };
    }
  }
  return worst;
}

function printSeries(r: SeriesResult): void {
  console.log(`--- adjust=${r.mode} ---`);
  console.log(`http status         : ${r.httpStatus ?? "(none)"}`);
  console.log(
    `api response status : ${r.apiStatus ?? "(none)"}${r.apiCode !== null ? ` (code=${r.apiCode})` : ""}`
  );
  if (r.errorMessage !== null) {
    console.log(`error message       : ${r.errorMessage}`);
  }

  const first = r.candles[0] ?? null;
  const last = r.candles.length > 0 ? r.candles[r.candles.length - 1]! : null;
  console.log(
    `actual range        : ${first && last ? `${first.date} ~ ${last.date}` : "(none)"}`
  );
  console.log(`trading day count   : ${r.candles.length}`);

  const before = findCandle(r.candles, BEFORE_DATE);
  const after = findCandle(r.candles, AFTER_DATE);
  console.log(`${BEFORE_DATE} candle   : ${fmtCandle(before)}`);
  console.log(`${AFTER_DATE} candle   : ${fmtCandle(after)}`);

  const ratio =
    before && after && after.close > 0 ? before.close / after.close : null;
  console.log(
    `close ratio         : ${ratio === null ? "(n/a)" : `${ratio.toFixed(6)} (${BEFORE_DATE} close / ${AFTER_DATE} close)`}`
  );

  const worst = maxAdjacentCloseRatio(r.candles);
  console.log(
    `max adjacent ratio  : ${worst === null ? "(n/a)" : `${worst.ratio.toFixed(6)} (${worst.from} → ${worst.to})`}`
  );
  console.log(`invalid row count   : ${r.invalidRowCount}`);
  console.log(`duplicate row count : ${r.duplicateRowCount}`);
  console.log(`latency             : ${r.latencyMs ?? "(n/a)"}ms`);
  console.log("");
}

interface Judgement {
  pass: boolean;
  lines: string[];
}

/**
 * 판단은 두 응답의 데이터에서만 도출한다(가격 하드코딩 없음).
 *  1) 두 요청 모두 성공하고 유효 행이 있어야 한다.
 *  2) adjust=none 은 split 경계에서 가격 단위가 달라져야 한다(비율이 1에서 크게 벗어남).
 *  3) adjust=splits 는 split 경계 비율이 1 근처여야 한다(동일 주식 단위로 연결).
 *  4) adjust=splits 시계열 어디에도 비정상적 가격 단절이 없어야 한다.
 */
function judge(none: SeriesResult, splits: SeriesResult): Judgement {
  const lines: string[] = [];
  let pass = true;

  const check = (ok: boolean, label: string, detail: string): void => {
    if (!ok) pass = false;
    lines.push(`[${ok ? "OK" : "NG"}] ${label}: ${detail}`);
  };

  for (const r of [none, splits]) {
    check(
      r.httpStatus === 200 && r.apiStatus === "ok" && r.errorMessage === null,
      `adjust=${r.mode} 응답`,
      `http=${r.httpStatus ?? "(none)"} apiStatus=${r.apiStatus ?? "(none)"}${r.errorMessage ? ` msg=${r.errorMessage}` : ""}`
    );
    check(
      r.candles.length > 0 && r.invalidRowCount === 0,
      `adjust=${r.mode} 데이터 품질`,
      `valid=${r.candles.length} invalid=${r.invalidRowCount} duplicate=${r.duplicateRowCount}`
    );
  }

  if (!pass) {
    lines.push("→ 응답 자체가 실패했으므로 split 보정 판정을 진행할 수 없다.");
    return { pass: false, lines };
  }

  const nBefore = findCandle(none.candles, BEFORE_DATE);
  const nAfter = findCandle(none.candles, AFTER_DATE);
  const sBefore = findCandle(splits.candles, BEFORE_DATE);
  const sAfter = findCandle(splits.candles, AFTER_DATE);

  check(
    nBefore !== null && nAfter !== null && sBefore !== null && sAfter !== null,
    "비교 대상 날짜 존재",
    `none: ${BEFORE_DATE}=${nBefore ? "y" : "n"} ${AFTER_DATE}=${nAfter ? "y" : "n"} / splits: ${BEFORE_DATE}=${sBefore ? "y" : "n"} ${AFTER_DATE}=${sAfter ? "y" : "n"}`
  );
  if (!nBefore || !nAfter || !sBefore || !sAfter) {
    return { pass: false, lines };
  }

  const noneRatio = nBefore.close / nAfter.close;
  const splitsRatio = sBefore.close / sAfter.close;

  check(
    noneRatio >= DISCONTINUITY_RATIO || noneRatio <= 1 / DISCONTINUITY_RATIO,
    "adjust=none 은 분할 전후 가격 단위가 다름",
    `close ratio=${noneRatio.toFixed(6)} (임계 ${DISCONTINUITY_RATIO}배)`
  );

  check(
    splitsRatio < DISCONTINUITY_RATIO && splitsRatio > 1 / DISCONTINUITY_RATIO,
    "adjust=splits 는 분할 전후가 동일 주식 단위로 연결됨",
    `close ratio=${splitsRatio.toFixed(6)}`
  );

  const worstSplits = maxAdjacentCloseRatio(splits.candles);
  check(
    worstSplits !== null && worstSplits.ratio < DISCONTINUITY_RATIO,
    "adjust=splits 시계열에 비정상적 가격 단절 없음",
    worstSplits === null
      ? "비교 가능한 인접 쌍 없음"
      : `max adjacent ratio=${worstSplits.ratio.toFixed(6)} (${worstSplits.from} → ${worstSplits.to})`
  );

  // 참고 지표: 두 비율의 몫은 관찰된 분할 계수에 해당한다(하드코딩 없이 데이터에서 도출).
  if (splitsRatio !== 0) {
    lines.push(
      `[info] 관찰된 분할 계수(none ratio / splits ratio) = ${(noneRatio / splitsRatio).toFixed(6)}`
    );
  }

  return { pass, lines };
}

async function main(): Promise<void> {
  console.log("[spike:history:adjustment] Twelve Data split adjustment 검증\n");
  console.log(`symbol              : ${SYMBOL}`);
  console.log(`interval            : ${INTERVAL}`);
  console.log(`requested range     : ${START_DATE} ~ ${INCLUSIVE_END} (inclusive 기준)`);
  console.log(`api end_date sent   : ${API_END_DATE} (exclusive 보정)\n`);

  const apiKey = process.env.TWELVE_DATA_API_KEY ?? "";
  if (!apiKey) {
    console.log("error code          : api_key_missing");
    console.log("message             : TWELVE_DATA_API_KEY 가 .env.local 에 없습니다.");
    console.log("\nRESULT: FAIL");
    process.exitCode = 1;
    return;
  }

  // 두 요청을 순차 실행한다(rate limit 여유 확보).
  const none = await fetchSeries("none", apiKey);
  const splits = await fetchSeries("splits", apiKey);

  printSeries(none);
  printSeries(splits);

  const { pass, lines } = judge(none, splits);
  console.log("--- judgement ---");
  for (const line of lines) console.log(line);

  console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}`);
  console.log(
    "→ 상세 결론은 spikes/historical-market-data-twelve-data/ADJUSTMENT_CHECK_RESULT.md 에 기록"
  );
  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error(
    "[spike:history:adjustment] 실행 실패:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
