/**
 * Mock 일봉 생성 (결정적).
 *
 * ⚠️ 실제 시장 데이터가 아니다. 1차 UI 구현 단계의 화면 확인용 합성 데이터다.
 * 실제 연결 단계에서 `app/data/market` adapter 응답으로 교체한다.
 *
 * - 결정적이다: `Math.random()` 을 쓰지 않는다(seeded LCG). 같은 입력 → 같은 candles.
 * - 주말과 고정 휴장일을 제외해 거래일만 만든다(엔진의 "휴장일 = candle 없음" 규칙과 맞춤).
 * - 가격은 제어점 사이 선형 보간 + 소폭 노이즈. 실제 종목의 실제 가격이 아니다.
 */
import type { DailyCandle } from "@/domain/simulation";

const DAY_MS = 86_400_000;

export const MOCK_RANGE = {
  from: "2025-07-28",
  to: "2026-07-27",
} as const;

/** 고정 휴장일(합성). 실제 거래소 캘린더가 아니다. */
const MOCK_HOLIDAYS = new Set([
  "2025-09-01",
  "2025-11-27",
  "2025-12-25",
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-04-03",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
]);

/** 가격 제어점 — (진행률 0~1, 종가). 조건 발생이 몇 번 일어나도록 초반에 하락 구간을 둔다. */
const PRICE_PATH: Array<[number, number]> = [
  [0.0, 214],
  [0.06, 205],
  [0.1, 219],
  [0.14, 208],
  [0.2, 228],
  [0.45, 262],
  [0.6, 250],
  [0.75, 295],
  [0.9, 320],
  [1.0, 337],
];

/** 결정적 의사난수(LCG). 시드 고정. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0xffff_ffff;
  };
}

function toDateString(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function interpolate(progress: number): number {
  for (let i = 1; i < PRICE_PATH.length; i++) {
    const prev = PRICE_PATH[i - 1];
    const next = PRICE_PATH[i];
    if (prev === undefined || next === undefined) continue;
    if (progress <= next[0]) {
      const span = next[0] - prev[0];
      const t = span === 0 ? 0 : (progress - prev[0]) / span;
      return prev[1] + (next[1] - prev[1]) * t;
    }
  }
  return PRICE_PATH[PRICE_PATH.length - 1]?.[1] ?? 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 거래일 날짜 목록(주말·휴장일 제외). */
function tradingDates(): string[] {
  const start = Date.parse(`${MOCK_RANGE.from}T00:00:00Z`);
  const end = Date.parse(`${MOCK_RANGE.to}T00:00:00Z`);
  const dates: string[] = [];

  for (let ms = start; ms <= end; ms += DAY_MS) {
    const weekday = new Date(ms).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const date = toDateString(ms);
    if (MOCK_HOLIDAYS.has(date)) continue;
    dates.push(date);
  }
  return dates;
}

/**
 * Mock 일봉 배열. 날짜 오름차순, 중복 없음, OHLC 유효(엔진 검증 통과).
 */
export function createMockCandles(): DailyCandle[] {
  const dates = tradingDates();
  const random = createRandom(20_260_728);
  const lastIndex = Math.max(1, dates.length - 1);

  return dates.map((date, index) => {
    const base = interpolate(index / lastIndex);
    const noise = (random() - 0.5) * base * 0.02;
    const close = round2(base + noise);

    const spread = round2(close * 0.008);
    const open = round2(close - spread * (random() - 0.5));
    const high = round2(Math.max(open, close) + spread * random());
    const low = round2(Math.min(open, close) - spread * random());

    return {
      date,
      open,
      high,
      low,
      close,
      volume: Math.round(30_000_000 + random() * 20_000_000),
    };
  });
}
