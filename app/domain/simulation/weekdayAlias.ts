/**
 * 요일 표현 정규화 — 한글 약칭·전체 명칭·영문 모두 받는다.
 *
 * 근거: 사용자 확정 — 정기 매수 요일은 월요일로 고정하지 않는다. 클라이언트(초기 자연어
 * 해석의 요일 답변)와 서버(`planReviseRoute.ts`의 계획 수정 요청) 양쪽에서 같은 규칙을
 * 쓰기 위해 여기 하나로 뺐다 — 앞서 서버에만 있던 로직을 복제하지 않고 재사용한다.
 *
 * AI 가 이미 정규화해 보낼 수도 있어 영문 키도 그대로 인정한다(방어적).
 * 정규화하지 못하면 unrecognized(다시 묻는다) — 임의로 월요일 등으로 치환하지 않는다.
 */
import type { Weekday } from "./types";

const WEEKDAY_ALIASES: Record<string, Weekday> = {
  월: "monday",
  월요일: "monday",
  monday: "monday",
  화: "tuesday",
  화요일: "tuesday",
  tuesday: "tuesday",
  수: "wednesday",
  수요일: "wednesday",
  wednesday: "wednesday",
  목: "thursday",
  목요일: "thursday",
  thursday: "thursday",
  금: "friday",
  금요일: "friday",
  friday: "friday",
};

/** 거래일이 없는 주말 — 임의로 금요일·월요일로 치환하지 않고 평일 재선택을 안내한다. */
export const WEEKEND_ALIASES: ReadonlySet<string> = new Set([
  "토",
  "토요일",
  "saturday",
  "일",
  "일요일",
  "sunday",
]);

export const WEEKDAY_LABEL: Record<Weekday, string> = {
  monday: "월요일",
  tuesday: "화요일",
  wednesday: "수요일",
  thursday: "목요일",
  friday: "금요일",
};

export const WEEKEND_REJECTION_MESSAGE = "주식 시장이 열리는 평일 중 하나를 선택해주세요.";

export type WeekdayNormalizeResult =
  | { kind: "weekday"; value: Weekday }
  | { kind: "weekend" }
  | { kind: "unrecognized" };

/** "매주 수요일"·"수요일마다" 처럼 앞뒤에 흔한 수식어가 붙어도 정규화되게, 조회 전에 이런
 * 필러만 제거한다("수" 같은 한 글자 약칭까지 잘라내지 않도록 별도 단어로만 제거한다). */
function stripWeekdayFillers(text: string): string {
  return text.replace(/매주/g, "").replace(/마다/g, "").trim();
}

export function normalizeWeekdayInput(raw: string): WeekdayNormalizeResult {
  const key = stripWeekdayFillers(raw).toLowerCase();
  const weekday = WEEKDAY_ALIASES[key];
  if (weekday !== undefined) return { kind: "weekday", value: weekday };
  if (WEEKEND_ALIASES.has(key)) return { kind: "weekend" };
  return { kind: "unrecognized" };
}
