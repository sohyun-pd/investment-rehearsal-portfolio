/**
 * 과거 일봉 정규화·검증 (순수 함수, 네트워크 없음).
 *
 * spike 의 normalize 로직을 production 위치로 옮긴 것이다. spike 파일을 import 하지 않는다.
 *
 * Twelve Data 는 OHLCV 를 모두 **문자열**로 반환하므로 Number 변환이 필수다.
 * 변환 실패(NaN)는 여기서 조용히 버리지 않고 유효성 검사 단계에서 invalid 로 센다.
 */
import type { Completeness, DailyCandle, TwelveDataValue } from "./types";

const DAY_MS = 86_400_000;

/** completeness 기준. 최근 1년 미국 주식 거래일은 약 250일이다. */
export const COMPLETE_MIN_TRADING_DAYS = 200;
export const PARTIAL_MIN_TRADING_DAYS = 30;

export function isValidDateString(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return !Number.isNaN(Date.parse(`${date}T00:00:00Z`));
}

/**
 * Twelve Data 의 `end_date` 는 **exclusive** 다(ADJUSTMENT_CHECK_RESULT.md 에서 실측 확인).
 * 사용자 기준 inclusive 종료일을 API 용 exclusive 종료일로 바꾼다.
 */
export function toExclusiveEndDate(toInclusive: string): string {
  const ms = Date.parse(`${toInclusive}T00:00:00Z`);
  return new Date(ms + DAY_MS).toISOString().slice(0, 10);
}

/** 문자열 수치 → number. 없거나 파싱 불가면 NaN (유효성 단계에서 invalid 처리). */
function toNumber(raw: string | undefined): number {
  if (raw === undefined || raw === null || raw.trim() === "") return Number.NaN;
  return Number(raw);
}

/** volume 은 없을 수 있다. 없거나 파싱 불가면 null. */
function toVolume(raw: string | undefined): number | null {
  const value = toNumber(raw);
  return Number.isFinite(value) ? value : null;
}

/** "2026-07-27" 또는 "2026-07-27 00:00:00" → "2026-07-27". */
function toDateOnly(raw: string | undefined): string {
  if (raw === undefined) return "";
  return raw.trim().slice(0, 10);
}

export function parseTwelveDataValues(values: TwelveDataValue[]): DailyCandle[] {
  const candles: DailyCandle[] = [];
  for (const value of values) {
    if (value === null || typeof value !== "object") continue;
    candles.push({
      date: toDateOnly(value.datetime),
      open: toNumber(value.open),
      high: toNumber(value.high),
      low: toNumber(value.low),
      close: toNumber(value.close),
      volume: toVolume(value.volume),
    });
  }
  return candles;
}

/**
 * 날짜 오름차순 정렬 + 중복 날짜 제거(먼저 나온 것 유지).
 * 요청에 `order=asc` 를 붙이지만 응답 순서를 신뢰하지 않고 여기서 다시 보장한다.
 */
export function sortAndDedupeCandles(candles: DailyCandle[]): {
  candles: DailyCandle[];
  duplicateRowCount: number;
} {
  const sorted = [...candles].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const seen = new Set<string>();
  const unique: DailyCandle[] = [];
  let duplicateRowCount = 0;

  for (const candle of sorted) {
    if (seen.has(candle.date)) {
      duplicateRowCount++;
      continue;
    }
    seen.add(candle.date);
    unique.push(candle);
  }

  return { candles: unique, duplicateRowCount };
}

/**
 * OHLC 유효성:
 *  close>0, high>=low, high>=open, high>=close, low<=open, low<=close, 유효 날짜.
 */
export function isValidDailyCandle(candle: DailyCandle): boolean {
  return (
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close) &&
    candle.close > 0 &&
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close &&
    isValidDateString(candle.date)
  );
}

export function partitionValidCandles(candles: DailyCandle[]): {
  valid: DailyCandle[];
  invalidRowCount: number;
} {
  const valid: DailyCandle[] = [];
  let invalidRowCount = 0;

  for (const candle of candles) {
    if (isValidDailyCandle(candle)) valid.push(candle);
    else invalidRowCount++;
  }

  return { valid, invalidRowCount };
}

/** complete ≥200, partial ≥30 & <200, insufficient <30. */
export function classifyCompleteness(validCount: number): Completeness {
  if (validCount >= COMPLETE_MIN_TRADING_DAYS) return "complete";
  if (validCount >= PARTIAL_MIN_TRADING_DAYS) return "partial";
  return "insufficient";
}
