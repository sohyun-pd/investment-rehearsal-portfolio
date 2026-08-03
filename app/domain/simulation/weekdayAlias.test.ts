/**
 * 요일 정규화 단위 테스트.
 *
 * 실행: npm run test:simulation (app/domain/simulation/*.test.ts 글롭에 포함됨)
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeWeekdayInput, WEEKDAY_LABEL } from "./weekdayAlias";

function expectWeekday(input: string): string {
  const result = normalizeWeekdayInput(input);
  assert.equal(result.kind, "weekday");
  return result.kind === "weekday" ? result.value : "";
}

test("한글 약칭·전체 명칭·영문 모두 같은 요일로 정규화한다", () => {
  assert.equal(expectWeekday("수"), "wednesday");
  assert.equal(expectWeekday("수요일"), "wednesday");
  assert.equal(expectWeekday("wednesday"), "wednesday");
  assert.equal(expectWeekday("WEDNESDAY"), "wednesday");
});

test("자유 입력에서 흔한 수식어(매주·마다)가 붙어도 정규화한다", () => {
  assert.equal(expectWeekday("매주 수요일"), "wednesday");
  assert.equal(expectWeekday("수요일마다"), "wednesday");
  assert.equal(expectWeekday("매주 수요일마다"), "wednesday");
});

test("월~금 전부 정규화된다(월요일만 지원하는 하드코딩 없음)", () => {
  const cases: [string, string][] = [
    ["월요일", "monday"],
    ["화요일", "tuesday"],
    ["수요일", "wednesday"],
    ["목요일", "thursday"],
    ["금요일", "friday"],
  ];
  for (const [input, expected] of cases) {
    const result = normalizeWeekdayInput(input);
    assert.equal(result.kind, "weekday");
    assert.equal(result.value, expected);
  }
});

test("토요일·일요일은 weekend 로 구분하고 임의로 평일로 치환하지 않는다", () => {
  assert.equal(normalizeWeekdayInput("토요일").kind, "weekend");
  assert.equal(normalizeWeekdayInput("일요일").kind, "weekend");
  assert.equal(normalizeWeekdayInput("saturday").kind, "weekend");
});

test("인식할 수 없는 값은 unrecognized 다(임의로 월요일 등을 대입하지 않는다)", () => {
  assert.equal(normalizeWeekdayInput("아무말").kind, "unrecognized");
  assert.equal(normalizeWeekdayInput("").kind, "unrecognized");
});

test("WEEKDAY_LABEL 은 다섯 요일 전부를 커버한다", () => {
  assert.equal(WEEKDAY_LABEL.monday, "월요일");
  assert.equal(WEEKDAY_LABEL.tuesday, "화요일");
  assert.equal(WEEKDAY_LABEL.wednesday, "수요일");
  assert.equal(WEEKDAY_LABEL.thursday, "목요일");
  assert.equal(WEEKDAY_LABEL.friday, "금요일");
});
