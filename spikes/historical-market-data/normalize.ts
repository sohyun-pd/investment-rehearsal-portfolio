/**
 * 순수 정규화/검증 함수 (네트워크 없음, 결정적).
 * Finnhub 원시 응답 → DailyCandle[] → 정렬·중복제거·유효성검사·completeness.
 */
import type { Completeness, DailyCandle, FinnhubCandleResponse } from "./types.ts";

/** unix(sec) → "YYYY-MM-DD" (UTC 기준). */
function unixToDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10);
}

/** Finnhub 병렬 배열 응답을 DailyCandle[] 로 변환. */
export function finnhubToCandles(raw: FinnhubCandleResponse): DailyCandle[] {
  const { c, h, l, o, t, v } = raw;
  if (
    !Array.isArray(c) ||
    !Array.isArray(h) ||
    !Array.isArray(l) ||
    !Array.isArray(o) ||
    !Array.isArray(t)
  ) {
    return [];
  }
  const n = Math.min(c.length, h.length, l.length, o.length, t.length);
  const out: DailyCandle[] = [];
  for (let i = 0; i < n; i++) {
    const ts = t[i];
    const close = c[i];
    const high = h[i];
    const low = l[i];
    const open = o[i];
    if (ts === undefined || close === undefined || high === undefined || low === undefined || open === undefined) {
      continue;
    }
    const vol = Array.isArray(v) ? v[i] : undefined;
    out.push({
      date: unixToDate(ts),
      open,
      high,
      low,
      close,
      volume: vol === undefined ? null : vol,
    });
  }
  return out;
}

/** 날짜 오름차순 정렬 + 중복 날짜 제거(먼저 나온 것 유지). */
export function sortAndDedupe(candles: DailyCandle[]): {
  candles: DailyCandle[];
  duplicateRowCount: number;
} {
  const sorted = [...candles].sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0
  );
  const seen = new Set<string>();
  const unique: DailyCandle[] = [];
  let duplicateRowCount = 0;
  for (const cd of sorted) {
    if (seen.has(cd.date)) {
      duplicateRowCount++;
      continue;
    }
    seen.add(cd.date);
    unique.push(cd);
  }
  return { candles: unique, duplicateRowCount };
}

export function isValidDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
}

/**
 * OHLC 유효성:
 *  close>0, high>=low, high>=open, high>=close, low<=open, low<=close, 유효 날짜.
 */
export function isValidCandle(c: DailyCandle): boolean {
  return (
    Number.isFinite(c.open) &&
    Number.isFinite(c.high) &&
    Number.isFinite(c.low) &&
    Number.isFinite(c.close) &&
    c.close > 0 &&
    c.high >= c.low &&
    c.high >= c.open &&
    c.high >= c.close &&
    c.low <= c.open &&
    c.low <= c.close &&
    isValidDate(c.date)
  );
}

export function partitionValid(candles: DailyCandle[]): {
  valid: DailyCandle[];
  invalidRowCount: number;
} {
  const valid: DailyCandle[] = [];
  let invalidRowCount = 0;
  for (const c of candles) {
    if (isValidCandle(c)) valid.push(c);
    else invalidRowCount++;
  }
  return { valid, invalidRowCount };
}

/** complete ≥200, partial ≥30 & <200, insufficient <30. */
export function classifyCompleteness(validCount: number): Completeness {
  if (validCount >= 200) return "complete";
  if (validCount >= 30) return "partial";
  return "insufficient";
}
