/**
 * sanitizeChange() 단위 테스트 (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:revise
 *
 * 다루는 회귀:
 *  - before === after 인 제안은 "변경"으로 보여주지도, 적용하지도 않는다(§조건부 매수금액
 *    수정 요청이 다른 필드로 잘못 반영되던 문제의 연장 — "50,000원 → 50,000원" 오표시).
 *  - 정기 매수 요일("매주 수요일에 살래요")은 "지원되지 않는 필드"가 아니라 기존 정기 매수
 *    규칙의 수정 가능한 하위 필드다.
 *  - 토요일·일요일은 임의로 금요일/월요일로 치환하지 않고 평일 재선택을 안내한다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { sanitizeChange } from "./planReviseRoute";
import type { PlanReviseSnapshot } from "../app/types/planRevise";

function planWith(overrides: Partial<PlanReviseSnapshot> = {}): PlanReviseSnapshot {
  return {
    symbol: "AAPL",
    companyName: "Apple Inc",
    recurring: { frequency: "weekly", amountKrw: 50000, weekday: "monday" },
    conditionalBuy: null,
    guardrails: { monthlyBudgetKrw: null },
    ...overrides,
  };
}

test("before === after 인 정기 매수 금액 제안은 noop 으로 걸러진다", () => {
  const result = sanitizeChange({ fieldPath: "recurring.amountKrw", after: 50000 }, planWith());
  assert.equal(result.kind, "noop");
});

test("실제로 값이 다른 정기 매수 금액 제안은 정상적으로 change 로 반환된다", () => {
  const result = sanitizeChange({ fieldPath: "recurring.amountKrw", after: 70000 }, planWith());
  assert.equal(result.kind, "change");
  if (result.kind === "change") {
    assert.equal(result.change.before, 50000);
    assert.equal(result.change.after, 70000);
  }
});

test("종목(assetQuery) 제안도 이전 심볼과 같은 문자열이면 noop 이다", () => {
  const result = sanitizeChange({ fieldPath: "assetQuery", after: "AAPL" }, planWith());
  assert.equal(result.kind, "noop");
});

test("정기 매수 요일: 월요일 → 수요일 변경을 정상적으로 인식한다", () => {
  const result = sanitizeChange({ fieldPath: "recurring.weekday", after: "수요일" }, planWith());
  assert.equal(result.kind, "change");
  if (result.kind === "change") {
    assert.equal(result.change.before, "monday");
    assert.equal(result.change.after, "wednesday");
  }
});

test("정기 매수 요일: '금' 처럼 축약형도 정규화한다(매주 금요일로 바꿔줘)", () => {
  const result = sanitizeChange({ fieldPath: "recurring.weekday", after: "금" }, planWith());
  assert.equal(result.kind, "change");
  if (result.kind === "change") assert.equal(result.change.after, "friday");
});

test("정기 매수 요일: 영문 키를 그대로 줘도(방어적) 정규화한다", () => {
  const result = sanitizeChange({ fieldPath: "recurring.weekday", after: "wednesday" }, planWith());
  assert.equal(result.kind, "change");
  if (result.kind === "change") assert.equal(result.change.after, "wednesday");
});

test("정기 매수 요일: 이미 같은 요일이면 noop 이다", () => {
  const result = sanitizeChange({ fieldPath: "recurring.weekday", after: "월요일" }, planWith());
  assert.equal(result.kind, "noop");
});

test("정기 매수 요일: 토요일은 적용하지 않고 평일 재선택을 안내한다(임의 치환 금지)", () => {
  const result = sanitizeChange({ fieldPath: "recurring.weekday", after: "토요일" }, planWith());
  assert.equal(result.kind, "rejected");
  if (result.kind === "rejected") {
    assert.equal(result.rejected.question, "주식 시장이 열리는 평일 중 하나를 선택해주세요.");
  }
});

test("정기 매수 요일: 일요일도 동일하게 거절한다(금요일/월요일로 임의 치환하지 않음)", () => {
  const result = sanitizeChange({ fieldPath: "recurring.weekday", after: "일요일" }, planWith());
  assert.equal(result.kind, "rejected");
  if (result.kind === "rejected") {
    assert.equal(result.rejected.question, "주식 시장이 열리는 평일 중 하나를 선택해주세요.");
  }
});

test("정기 매수 요일: 인식할 수 없는 값은 다시 묻는다", () => {
  const result = sanitizeChange({ fieldPath: "recurring.weekday", after: "언젠가" }, planWith());
  assert.equal(result.kind, "rejected");
});
