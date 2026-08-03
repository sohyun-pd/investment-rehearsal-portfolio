/**
 * 정기 매수 일정 계산 (순수 함수).
 *
 * 규칙(§매주·매달 실행일 모델 분리 — weekly 는 weekday, monthly 는 dayOfMonth 만 쓴다. 서로의
 * 필드를 요구하거나 저장하지 않는다):
 *  - weekly: 요일은 `recurring.weekday`(월~금 중 하나 — 수정 가능한 필드다. §서버
 *    planReviseRoute.ts 의 "정기 매수 요일" 변경이 이 값을 바꾼다). 첫 예정일은 첫 candle
 *    날짜 이후(포함)의 그 요일 첫 날짜.
 *  - monthly: 실행일은 `recurring.dayOfMonth`(1일/15일/25일/말일). 첫 예정일은 첫 candle
 *    날짜가 속한 달부터 시작해, 그 달의 실행일이 이미 지났으면 다음 달로 넘어간다. "말일"은
 *    달마다 실제 마지막 날짜(28~31일)로 계산한다 — 31로 고정하지 않는다.
 *  - 두 주기 모두: 예정일이 휴장일이면 **다음 거래일**에 실행한다. 월 경계를 넘어도 다음 실제
 *    거래일에 실행한다. 마지막 candle 날짜보다 뒤인 예정일은 관찰 가능한 거래일이 없으므로
 *    열거하지 않는다.
 *
 * 날짜 계산은 전부 UTC 기준이다. 로컬 타임존에 따라 결과가 달라지지 않게 하기 위해서다.
 */
import type { DailyCandle, DayOfMonth, SimulationPlan, Weekday } from "./types";

const DAY_MS = 86_400_000;

/** 0=일 … 6=토. 거래일이 없는 토·일은 애초에 `Weekday` 타입에 없으므로 여기 없다. */
const WEEKDAY_INDEX: Record<Weekday, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
};

export interface RecurringExecution {
  /** 원래 예정일(정기 매수 요일 기준). */
  scheduledDate: string;
  /** 실제 실행 거래일. */
  executionDate: string;
  /** 휴장일 때문에 뒤로 밀렸는지. */
  rolledForward: boolean;
}

function toUtcMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function toDateString(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** 그 달(UTC 기준, monthIndex 는 0=1월)의 실제 마지막 날짜(28~31). */
function lastDayOfMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** dayOfMonth 를 그 달에 실제로 존재하는 날짜 숫자로 바꾼다 — "말일"은 달마다 다르고, 고정
 * 숫자(1/15/25)는 그 달에 없을 일이 없어(31일보다 항상 작다) 그대로 쓴다. */
function resolveDayOfMonth(dayOfMonth: DayOfMonth, year: number, monthIndex: number): number {
  return dayOfMonth === "last" ? lastDayOfMonth(year, monthIndex) : dayOfMonth;
}

/** 예정일 이후(포함) 첫 거래일을 찾아 실행 이벤트로 남긴다 — 없으면(마지막 candle 보다 뒤)
 * 아무것도 남기지 않는다. `searchFrom` 은 다음 호출의 시작 위치로, 항상 앞으로만 이동한다
 * (candles 가 오름차순이므로). */
function tryExecute(
  candles: DailyCandle[],
  scheduledDate: string,
  searchFrom: number
): { execution: RecurringExecution | null; nextSearchFrom: number } {
  let index = searchFrom;
  while (index < candles.length) {
    const candidate = candles[index];
    if (candidate !== undefined && candidate.date >= scheduledDate) break;
    index++;
  }
  const candle = candles[index];
  if (candle === undefined) return { execution: null, nextSearchFrom: searchFrom };
  return {
    execution: { scheduledDate, executionDate: candle.date, rolledForward: candle.date !== scheduledDate },
    // 다음 예정일도 같은 거래일로 밀릴 수 있다(장기 휴장). index 를 소비하지 않는다.
    nextSearchFrom: index,
  };
}

function scheduleWeekly(
  candles: DailyCandle[],
  firstMs: number,
  lastMs: number,
  weekday: Weekday
): RecurringExecution[] {
  const targetWeekday = WEEKDAY_INDEX[weekday];
  // 첫 candle 날짜 이후(포함) 그 요일의 첫 날짜로 이동.
  const offset = (targetWeekday - new Date(firstMs).getUTCDay() + 7) % 7;
  let cursorMs = firstMs + offset * DAY_MS;

  const executions: RecurringExecution[] = [];
  let searchFrom = 0;

  while (cursorMs <= lastMs) {
    const scheduledDate = toDateString(cursorMs);
    const { execution, nextSearchFrom } = tryExecute(candles, scheduledDate, searchFrom);
    if (execution !== null) executions.push(execution);
    searchFrom = nextSearchFrom;
    cursorMs += 7 * DAY_MS;
  }

  return executions;
}

function scheduleMonthly(
  candles: DailyCandle[],
  firstMs: number,
  lastMs: number,
  dayOfMonth: DayOfMonth
): RecurringExecution[] {
  const firstDate = new Date(firstMs);
  let year = firstDate.getUTCFullYear();
  let monthIndex = firstDate.getUTCMonth();

  const executions: RecurringExecution[] = [];
  let searchFrom = 0;

  for (;;) {
    const scheduledMs = Date.UTC(year, monthIndex, resolveDayOfMonth(dayOfMonth, year, monthIndex));
    if (scheduledMs > lastMs) break;
    // 그 달의 실행일이 이미 첫 candle 이전이면(예: 첫 candle 이 10일인데 1일이 실행일) 그 달은
    // 건너뛰고 다음 달부터 시작한다 — 이미 지난 날짜를 관측 범위 밖에서 실행한 것처럼 만들지
    // 않는다.
    if (scheduledMs >= firstMs) {
      const scheduledDate = toDateString(scheduledMs);
      const { execution, nextSearchFrom } = tryExecute(candles, scheduledDate, searchFrom);
      if (execution !== null) executions.push(execution);
      searchFrom = nextSearchFrom;
    }
    monthIndex += 1;
    if (monthIndex > 11) {
      monthIndex = 0;
      year += 1;
    }
  }

  return executions;
}

export function scheduleRecurring(
  candles: DailyCandle[],
  recurring: SimulationPlan["recurring"]
): RecurringExecution[] {
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (recurring === null || first === undefined || last === undefined) return [];

  const firstMs = toUtcMs(first.date);
  const lastMs = toUtcMs(last.date);

  return recurring.frequency === "weekly"
    ? scheduleWeekly(candles, firstMs, lastMs, recurring.weekday)
    : scheduleMonthly(candles, firstMs, lastMs, recurring.dayOfMonth);
}

/** §국내주식 0회 계획 사전 판정(Screen3PlanConfirm) — 예정된 정기 매수일 중 단 하루라도 그날
 * 종가 기준 1주를 살 수 있으면 true(§국내주식 정수 수량 매수와 같은 규칙, `simulatePlan.ts`
 * 의 `resolveBuyQuantity` 참고). candles·예정일이 없으면 판정할 근거가 없으므로 true(경고를
 * 보여주지 않음)로 본다 — "실행 가능한 날이 없다"는 적극적인 주장이라, 알 수 없을 때는
 * 보수적으로 경고하지 않는다. */
export function hasExecutableKrRecurringBuy(
  candles: DailyCandle[],
  recurring: SimulationPlan["recurring"],
  amountKrw: number
): boolean {
  if (recurring === null || candles.length === 0) return true;
  const executions = scheduleRecurring(candles, recurring);
  if (executions.length === 0) return true;
  const closeByDate = new Map(candles.map((candle) => [candle.date, candle.close]));
  return executions.some((execution) => {
    const close = closeByDate.get(execution.executionDate);
    return close !== undefined && Math.floor(amountKrw / close) > 0;
  });
}
