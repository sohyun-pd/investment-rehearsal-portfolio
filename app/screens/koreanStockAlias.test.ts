/**
 * 한글 종목 별칭 정규화 단위 테스트 (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:alias
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { normalizeSearchQuery } from "./koreanStockAlias";

test("애플 → Apple", () => {
  assert.equal(normalizeSearchQuery("애플"), "Apple");
});

test("테슬라 → Tesla", () => {
  assert.equal(normalizeSearchQuery("테슬라"), "Tesla");
});

test("앞뒤 공백·중복 공백이 있어도 별칭을 인식한다", () => {
  assert.equal(normalizeSearchQuery("  애플   "), "Apple");
});

test("영문 입력은 그대로 유지한다(기존 검색 정상 동작)", () => {
  assert.equal(normalizeSearchQuery("Apple"), "Apple");
  assert.equal(normalizeSearchQuery("AAPL"), "AAPL");
});

test("별칭 사전에 없는 한글 문자열은 원문 그대로 반환한다(검색 실패는 API 단계에서 결정)", () => {
  assert.equal(normalizeSearchQuery("가나다라"), "가나다라");
});

test("구글과 알파벳 모두 Alphabet으로 정규화한다", () => {
  assert.equal(normalizeSearchQuery("구글"), "Alphabet");
  assert.equal(normalizeSearchQuery("알파벳"), "Alphabet");
});
