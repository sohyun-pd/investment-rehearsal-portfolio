/**
 * 정기 매수 매달 실행일 표현 정규화 — "1일"·"15일"·"25일"·"말일"만 지원한다.
 *
 * 근거: §매주·매달 실행일 모델 분리 — weekdayAlias.ts 와 같은 원칙(정규화하지 못하면
 * unrecognized, 임의로 가까운 값으로 치환하지 않는다)을 매달 실행일에도 그대로 적용한다.
 */
import type { DayOfMonth } from "./types";

const DAY_OF_MONTH_ALIASES: Record<string, DayOfMonth> = {
  "1일": 1,
  "1": 1,
  "15일": 15,
  "15": 15,
  "25일": 25,
  "25": 25,
  말일: "last",
  마지막날: "last",
  마지막: "last",
};

export const DAY_OF_MONTH_LABEL: Record<DayOfMonth, string> = {
  1: "1일",
  15: "15일",
  25: "25일",
  last: "말일",
};

export const DAY_OF_MONTH_OPTIONS: readonly DayOfMonth[] = [1, 15, 25, "last"];

export type DayOfMonthNormalizeResult = { kind: "dayOfMonth"; value: DayOfMonth } | { kind: "unrecognized" };

function stripDayOfMonthFillers(text: string): string {
  return text.replace(/매달/g, "").replace(/마다/g, "").trim();
}

export function normalizeDayOfMonthInput(raw: string): DayOfMonthNormalizeResult {
  const key = stripDayOfMonthFillers(raw).toLowerCase();
  const dayOfMonth = DAY_OF_MONTH_ALIASES[key];
  if (dayOfMonth !== undefined) return { kind: "dayOfMonth", value: dayOfMonth };
  return { kind: "unrecognized" };
}
