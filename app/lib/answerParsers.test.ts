/**
 * 금액·퍼센트 로컬 파서 단위 테스트.
 *
 * 실행: npm run test:parsers
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  amountTooLowMessage,
  currencyMismatchMessage,
  hasMismatchedCurrencyMarker,
  minAmountFor,
  parseMoneyKrw,
  parseMoneyUsd,
  parsePercent,
  parseValidAmount,
} from "./answerParsers";

test("parseMoneyKrw: 숫자+만원 표기를 파싱한다", () => {
  assert.equal(parseMoneyKrw("5만원"), 50_000);
  assert.equal(parseMoneyKrw("50만원"), 500_000);
  assert.equal(parseMoneyKrw("100만 원"), 1_000_000);
  assert.equal(parseMoneyKrw("150만원"), 1_500_000);
});

test("parseMoneyKrw: 백만 결합 표기를 파싱한다", () => {
  assert.equal(parseMoneyKrw("1백만원"), 1_000_000);
});

test("parseMoneyKrw: 순우리말 숫자+만원을 파싱한다", () => {
  assert.equal(parseMoneyKrw("오십만원"), 500_000);
});

test("parseMoneyKrw: 콤마가 있는 순수 숫자를 파싱한다(chip 상한을 넘는 값도 그대로 허용)", () => {
  assert.equal(parseMoneyKrw("1,000,000원"), 1_000_000);
  assert.equal(parseMoneyKrw("82,300원"), 82_300);
  assert.equal(parseMoneyKrw("3,000,000원"), 3_000_000, "300만원 chip 이 없어도 직접 입력은 그대로 저장된다");
});

test("parseMoneyKrw: 알아볼 수 없는 값은 null(임의로 0 등을 채우지 않는다)", () => {
  assert.equal(parseMoneyKrw("잘모르겠어요"), null);
  assert.equal(parseMoneyKrw(""), null);
});

test("parseMoneyUsd: 달러 표기와 $ 접두사를 파싱한다", () => {
  assert.equal(parseMoneyUsd("220달러"), 220);
  assert.equal(parseMoneyUsd("245.5달러"), 245.5);
  assert.equal(parseMoneyUsd("$220"), 220);
});

test("parsePercent: %·퍼센트·프로 표기와 뒤에 붙는 말을 모두 처리한다", () => {
  assert.equal(parsePercent("5%"), 5);
  assert.equal(parsePercent("7.5%"), 7.5);
  assert.equal(parsePercent("12% 하락"), 12);
  assert.equal(parsePercent("20퍼센트"), 20);
  assert.equal(parsePercent("15프로"), 15);
  assert.equal(parsePercent("12.5% 하락"), 12.5);
});

test("parsePercent: 알아볼 수 없는 값은 null", () => {
  assert.equal(parsePercent("많이"), null);
});

// ---------------------------------------------------------------------------
// 통화별 금액 처리(§사용자 확정 — 국내·미국 주식 통화 일치, 0원·최소 금액 미만 거부).
// ---------------------------------------------------------------------------

test("minAmountFor: 국내 1,000원, 미국 1달러", () => {
  assert.equal(minAmountFor("KRW"), 1_000);
  assert.equal(minAmountFor("USD"), 1);
});

test("parseValidAmount: 0원·음수·최소 금액 미만은 거부한다", () => {
  assert.equal(parseValidAmount("0원", "KRW"), null);
  assert.equal(parseValidAmount("500원", "KRW"), null, "1,000원 미만은 무효");
  assert.equal(parseValidAmount("1000원", "KRW"), 1000);
  assert.equal(parseValidAmount("0달러", "USD"), null);
  assert.equal(parseValidAmount("$0.5", "USD"), null, "1달러 미만은 무효");
  assert.equal(parseValidAmount("$1", "USD"), 1);
});

test("parseValidAmount: 알아볼 수 없는 값은 null", () => {
  assert.equal(parseValidAmount("잘모르겠어요", "KRW"), null);
});

test("hasMismatchedCurrencyMarker: 미국 주식에 원화 표기를 쓰면 감지한다", () => {
  assert.equal(hasMismatchedCurrencyMarker("5만원", "USD"), true);
  assert.equal(hasMismatchedCurrencyMarker("50달러", "USD"), false);
  assert.equal(hasMismatchedCurrencyMarker("50", "USD"), false, "통화 표기가 없으면 불일치로 보지 않는다");
});

test("hasMismatchedCurrencyMarker: 국내 주식에 달러 표기를 쓰면 감지한다", () => {
  assert.equal(hasMismatchedCurrencyMarker("50달러", "KRW"), true);
  assert.equal(hasMismatchedCurrencyMarker("$50", "KRW"), true);
  assert.equal(hasMismatchedCurrencyMarker("5만원", "KRW"), false);
});

test("currencyMismatchMessage: 정확히 이 문구를 돌려준다(§사용자 확정)", () => {
  assert.deepEqual(currencyMismatchMessage("USD"), {
    title: "미국 주식은 달러 기준으로 계산해요.\n매수 금액을 달러로 입력해주세요.",
    example: "예) 매주 화요일 50달러",
  });
});

test("amountTooLowMessage: 통화별 정확한 문구", () => {
  assert.equal(amountTooLowMessage("KRW"), "매수 금액은 1,000원 이상 입력해주세요.");
  assert.equal(amountTooLowMessage("USD"), "매수 금액은 1달러 이상 입력해주세요.");
});
