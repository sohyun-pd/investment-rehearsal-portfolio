/**
 * 정기 매수 매달 실행일 정규화 단위 테스트.
 *
 * 실행: npm run test:simulation (app/domain/simulation/*.test.ts 글롭에 포함됨)
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { DAY_OF_MONTH_LABEL, DAY_OF_MONTH_OPTIONS, normalizeDayOfMonthInput } from "./dayOfMonthAlias";

test("1일·15일·25일·말일을 정규화한다", () => {
  assert.deepEqual(normalizeDayOfMonthInput("1일"), { kind: "dayOfMonth", value: 1 });
  assert.deepEqual(normalizeDayOfMonthInput("15일"), { kind: "dayOfMonth", value: 15 });
  assert.deepEqual(normalizeDayOfMonthInput("25일"), { kind: "dayOfMonth", value: 25 });
  assert.deepEqual(normalizeDayOfMonthInput("말일"), { kind: "dayOfMonth", value: "last" });
});

test("자유 입력에서 흔한 수식어(매달·마다)가 붙어도 정규화한다", () => {
  assert.deepEqual(normalizeDayOfMonthInput("매달 15일"), { kind: "dayOfMonth", value: 15 });
  assert.deepEqual(normalizeDayOfMonthInput("말일마다"), { kind: "dayOfMonth", value: "last" });
});

test("지원하지 않는 날짜(예: 10일)는 임의로 가까운 값으로 치환하지 않고 unrecognized 다", () => {
  assert.equal(normalizeDayOfMonthInput("10일").kind, "unrecognized");
  assert.equal(normalizeDayOfMonthInput("20일").kind, "unrecognized");
  assert.equal(normalizeDayOfMonthInput("아무말").kind, "unrecognized");
});

test("DAY_OF_MONTH_LABEL·DAY_OF_MONTH_OPTIONS 는 네 값을 정확히 담는다", () => {
  assert.deepEqual(DAY_OF_MONTH_OPTIONS, [1, 15, 25, "last"]);
  assert.equal(DAY_OF_MONTH_LABEL[1], "1일");
  assert.equal(DAY_OF_MONTH_LABEL[15], "15일");
  assert.equal(DAY_OF_MONTH_LABEL[25], "25일");
  assert.equal(DAY_OF_MONTH_LABEL.last, "말일");
});
