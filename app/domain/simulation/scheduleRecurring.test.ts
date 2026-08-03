/**
 * scheduleRecurring() 단위 테스트 (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:simulation (app/domain/simulation/*.test.ts 글롭에 포함됨)
 *
 * 다루는 회귀: 정기 매수 요일이 지금까지 "monday"로 하드코딩돼 있었다 — 이 테스트는 엔진의
 * 날짜 계산 로직 자체가 요일에 무관하게 이미 일반적이었음(WEEKDAY_INDEX 조회 테이블만 넓히면
 * 됨)을 증명한다. 즉 "정기 매수 요일 변경"은 replay engine 을 새로 만들 필요 없이 이미 있는
 * 스케줄링 로직이 그대로 재사용된다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { hasExecutableKrRecurringBuy, scheduleRecurring } from "./scheduleRecurring";
import type { DailyCandle } from "./types";

/** 2024-01-01 은 월요일이다 — 3주치 평일(월~금) candle 을 만든다. */
function weekdayCandles(skipDates: string[] = []): DailyCandle[] {
  const dates = [
    "2024-01-01", // Mon
    "2024-01-02", // Tue
    "2024-01-03", // Wed
    "2024-01-04", // Thu
    "2024-01-05", // Fri
    "2024-01-08", // Mon
    "2024-01-09", // Tue
    "2024-01-10", // Wed
    "2024-01-11", // Thu
    "2024-01-12", // Fri
    "2024-01-15", // Mon
    "2024-01-16", // Tue
    "2024-01-17", // Wed
    "2024-01-18", // Thu
    "2024-01-19", // Fri
  ];
  return dates
    .filter((date) => !skipDates.includes(date))
    .map((date) => ({ date, open: 100, high: 100, low: 100, close: 100, volume: 1000 }));
}

test("정기 매수 요일 monday: 매주 월요일에 실행된다(기존 동작 유지)", () => {
  const executions = scheduleRecurring(weekdayCandles(), {
    frequency: "weekly",
    weekday: "monday",
    amountKrw: 50000,
  });
  assert.deepEqual(
    executions.map((e) => e.executionDate),
    ["2024-01-01", "2024-01-08", "2024-01-15"]
  );
  assert.ok(executions.every((e) => !e.rolledForward));
});

test("정기 매수 요일 wednesday: 매주 수요일에 실행된다(새로 지원하는 요일)", () => {
  const executions = scheduleRecurring(weekdayCandles(), {
    frequency: "weekly",
    weekday: "wednesday",
    amountKrw: 50000,
  });
  assert.deepEqual(
    executions.map((e) => e.executionDate),
    ["2024-01-03", "2024-01-10", "2024-01-17"]
  );
});

test("정기 매수 요일 friday: 매주 금요일에 실행된다", () => {
  const executions = scheduleRecurring(weekdayCandles(), {
    frequency: "weekly",
    weekday: "friday",
    amountKrw: 50000,
  });
  assert.deepEqual(
    executions.map((e) => e.executionDate),
    ["2024-01-05", "2024-01-12", "2024-01-19"]
  );
});

test("요일 변경 후에도 휴장일 보정 규칙(다음 거래일)은 그대로 적용된다", () => {
  // 1/10(수)이 휴장일이라고 가정 — 기존 "다음 거래일" 규칙대로 1/11(목)로 밀려야 한다.
  const executions = scheduleRecurring(weekdayCandles(["2024-01-10"]), {
    frequency: "weekly",
    weekday: "wednesday",
    amountKrw: 50000,
  });
  const rolled = executions.find((e) => e.scheduledDate === "2024-01-10");
  assert.ok(rolled !== undefined, "예정일 1/10 이 실행 목록에서 사라지면 안 된다");
  assert.equal(rolled?.executionDate, "2024-01-11");
  assert.equal(rolled?.rolledForward, true);
});

test("정기 매수가 없으면(null) 빈 배열을 반환한다", () => {
  assert.deepEqual(scheduleRecurring(weekdayCandles(), null), []);
});

// ---------------------------------------------------------------------------
// §매주·매달 실행일 모델 분리 — 매달(monthly) 스케줄링.
// ---------------------------------------------------------------------------

/** 2024-01-01 ~ 2024-03-31 매일을 거래일로 가정한다(주말 구분은 이 테스트의 관심사가
 * 아니다 — 휴장일 보정 로직 자체는 weekly 테스트에서 이미 검증했다). */
function dailyCandles(fromDate: string, toDate: string, skipDates: string[] = []): DailyCandle[] {
  const dates: string[] = [];
  let cursor = new Date(`${fromDate}T00:00:00Z`);
  const end = new Date(`${toDate}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return dates
    .filter((date) => !skipDates.includes(date))
    .map((date) => ({ date, open: 100, high: 100, low: 100, close: 100, volume: 1000 }));
}

test("매달 1일: 매달 1일에 실행된다", () => {
  const executions = scheduleRecurring(dailyCandles("2024-01-01", "2024-03-31"), {
    frequency: "monthly",
    dayOfMonth: 1,
    amountKrw: 100_000_000,
  });
  assert.deepEqual(
    executions.map((e) => e.executionDate),
    ["2024-01-01", "2024-02-01", "2024-03-01"]
  );
});

test("매달 15일: 매달 15일에 실행된다", () => {
  const executions = scheduleRecurring(dailyCandles("2024-01-01", "2024-03-31"), {
    frequency: "monthly",
    dayOfMonth: 15,
    amountKrw: 100_000_000,
  });
  assert.deepEqual(
    executions.map((e) => e.executionDate),
    ["2024-01-15", "2024-02-15", "2024-03-15"]
  );
});

test("매달 말일: 그 달의 실제 마지막 날짜로 계산한다(31일 고정 아님 — 2월은 29일)", () => {
  // 2024년은 윤년이라 2월이 29일까지 있다.
  const executions = scheduleRecurring(dailyCandles("2024-01-01", "2024-03-31"), {
    frequency: "monthly",
    dayOfMonth: "last",
    amountKrw: 100_000_000,
  });
  assert.deepEqual(
    executions.map((e) => e.executionDate),
    ["2024-01-31", "2024-02-29", "2024-03-31"]
  );
});

test("매달 실행일이 첫 candle 날짜보다 이전이면 그 달은 건너뛰고 다음 달부터 시작한다", () => {
  // 첫 candle 이 1/10 인데 실행일이 1일이면, 1월 1일은 관측 범위 밖이라 건너뛴다.
  const executions = scheduleRecurring(dailyCandles("2024-01-10", "2024-03-31"), {
    frequency: "monthly",
    dayOfMonth: 1,
    amountKrw: 100_000_000,
  });
  assert.deepEqual(
    executions.map((e) => e.executionDate),
    ["2024-02-01", "2024-03-01"]
  );
});

test("매달 실행일도 휴장일 보정 규칙(다음 거래일)을 그대로 따른다", () => {
  // 1/15 가 휴장일이라고 가정 — 1/16 로 밀려야 한다.
  const executions = scheduleRecurring(dailyCandles("2024-01-01", "2024-03-31", ["2024-01-15"]), {
    frequency: "monthly",
    dayOfMonth: 15,
    amountKrw: 100_000_000,
  });
  const rolled = executions.find((e) => e.scheduledDate === "2024-01-15");
  assert.ok(rolled !== undefined, "예정일 1/15 가 실행 목록에서 사라지면 안 된다");
  assert.equal(rolled?.executionDate, "2024-01-16");
  assert.equal(rolled?.rolledForward, true);
});

// ---------------------------------------------------------------------------
// hasExecutableKrRecurringBuy — §국내주식 0회 계획 사전 판정
// ---------------------------------------------------------------------------

test("[§국내주식 0회 계획 사전 판정] 매수 금액이 종가보다 낮으면(예: 5만원 vs 종가 10만원 전부) 실행 가능한 날이 없다고 판정한다", () => {
  const candles = weekdayCandles().map((c) => ({ ...c, close: 100_000 }));
  const recurring = { frequency: "monthly" as const, dayOfMonth: 1 as const, amountKrw: 50_000 };
  assert.equal(hasExecutableKrRecurringBuy(candles, recurring, 50_000), false);
});

test("[§국내주식 0회 계획 사전 판정] 단 하루라도 1주를 살 수 있으면 true 다", () => {
  const candles = weekdayCandles().map((c) => ({ ...c, close: 30_000 }));
  const recurring = { frequency: "weekly" as const, weekday: "monday" as const, amountKrw: 50_000 };
  assert.equal(hasExecutableKrRecurringBuy(candles, recurring, 50_000), true);
});

test("[§국내주식 0회 계획 사전 판정] recurring 이 없거나 candles 가 비어 있으면 판정할 근거가 없으므로 true(경고 없음)다", () => {
  assert.equal(hasExecutableKrRecurringBuy([], { frequency: "monthly", dayOfMonth: 1, amountKrw: 50_000 }, 50_000), true);
  assert.equal(hasExecutableKrRecurringBuy(weekdayCandles(), null, 50_000), true);
});
