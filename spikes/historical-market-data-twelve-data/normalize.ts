/**
 * 순수 정규화/검증 함수 (네트워크 없음, 결정적).
 * Twelve Data 원시 응답 → DailyCandle[] → 정렬·중복제거·유효성검사·completeness.
 *
 * Twelve Data 는 OHLCV 를 모두 **문자열**로 반환하므로 Number 변환이 필수다.
 * 변환 실패(NaN)는 여기서 버리지 않고 유효성 검사 단계에서 invalid 로 세도록 남긴다.
 */
import type {
  Completeness,
  DailyCandle,
  TwelveDataTimeSeriesResponse,
  TwelveDataValue,
} from "./types.ts";

/** 문자열 수치 → number. 없거나 파싱 불가면 NaN (유효성 단계에서 invalid 처리). */
function toNumber(raw: string | undefined): number {
  if (raw === undefined || raw === null || raw.trim() === "") return Number.NaN;
  return Number(raw);
}

/** volume 은 없을 수 있다(지수 등). 없거나 파싱 불가면 null. */
function toVolume(raw: string | undefined): number | null {
  const n = toNumber(raw);
  return Number.isFinite(n) ? n : null;
}

/** "2026-07-27" 또는 "2026-07-27 00:00:00" → "2026-07-27". */
function toDateOnly(raw: string | undefined): string {
  if (!raw) return "";
  return raw.trim().slice(0, 10);
}

/** Twelve Data values[] 를 DailyCandle[] 로 변환. */
export function twelveDataToCandles(raw: TwelveDataTimeSeriesResponse): DailyCandle[] {
  const values: TwelveDataValue[] = Array.isArray(raw.values) ? raw.values : [];
  const out: DailyCandle[] = [];
  for (const v of values) {
    if (v === null || typeof v !== "object") continue;
    out.push({
      date: toDateOnly(v.datetime),
      open: toNumber(v.open),
      high: toNumber(v.high),
      low: toNumber(v.low),
      close: toNumber(v.close),
      volume: toVolume(v.volume),
    });
  }
  return out;
}

/**
 * 날짜 오름차순 정렬 + 중복 날짜 제거(먼저 나온 것 유지).
 * 요청에 order=asc 를 붙이지만 응답 순서를 신뢰하지 않고 여기서 다시 보장한다.
 */
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
