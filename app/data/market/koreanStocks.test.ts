/**
 * 국내 종목 로컬 검색 인덱스 단위 테스트.
 *
 * 실행: npm run test:koreanstocks
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isMalformedCode, isSixDigitCode, searchKoreanStocks } from "./koreanStocks";

test('"삼성" 검색 시 삼성전자·삼성SDI·삼성중공업 3개가 나온다(오류 아님)', () => {
  const results = searchKoreanStocks("삼성");
  assert.equal(results.length, 3);
  assert.deepEqual(
    results.map((r) => r.symbol),
    ["005930", "006400", "010140"]
  );
});

test('"삼성" 검색 결과에서 별칭 완전 일치(삼성전자)가 이름 시작 일치(삼성SDI·삼성중공업)보다 먼저 나온다', () => {
  const results = searchKoreanStocks("삼성");
  assert.equal(results[0]?.symbol, "005930");
});

test('"삼성전자" 검색 시 이름 완전 일치만 나온다', () => {
  const results = searchKoreanStocks("삼성전자");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.symbol, "005930");
});

test('[§자유 입력 실패 처리 전면 수정] "삼전"(삼성전자 줄임말) 검색 시 삼성전자만 나온다', () => {
  const results = searchKoreanStocks("삼전");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.symbol, "005930");
});

test('"005930" 검색 시 삼성전자가 나온다(종목코드 일치)', () => {
  const results = searchKoreanStocks("005930");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.nameKo, "삼성전자");
});

test('"카카오" 검색 시 카카오(035720)가 나온다', () => {
  const results = searchKoreanStocks("카카오");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.symbol, "035720");
});

test('"네이버" 검색 시 NAVER(035420)가 나온다', () => {
  const results = searchKoreanStocks("네이버");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.symbol, "035420");
});

test('"NAVER" 영문으로도 같은 종목을 찾는다', () => {
  const results = searchKoreanStocks("NAVER");
  assert.equal(results[0]?.symbol, "035420");
});

test('"SK하이닉스" 검색 시 000660이 나온다', () => {
  const results = searchKoreanStocks("SK하이닉스");
  assert.equal(results.length, 1);
  assert.equal(results[0]?.symbol, "000660");
});

test("존재하지 않는 검색어는 빈 배열을 돌려준다(오류 아님, empty 상태 판단은 호출자 몫)", () => {
  const results = searchKoreanStocks("존재하지않는종목이름");
  assert.deepEqual(results, []);
});

test("빈 문자열·공백만 있는 검색어는 빈 배열을 돌려준다", () => {
  assert.deepEqual(searchKoreanStocks(""), []);
  assert.deepEqual(searchKoreanStocks("   "), []);
});

test("영문 대소문자를 구분하지 않는다", () => {
  const lower = searchKoreanStocks("samsung");
  const upper = searchKoreanStocks("SAMSUNG");
  assert.equal(lower[0]?.symbol, "005930");
  assert.equal(upper[0]?.symbol, "005930");
});

test("isSixDigitCode: 순수 숫자 6자리만 true", () => {
  assert.equal(isSixDigitCode("005930"), true);
  assert.equal(isSixDigitCode("5930"), false);
  assert.equal(isSixDigitCode("삼성전자"), false);
  assert.equal(isSixDigitCode("00593a"), false);
});

test("isMalformedCode: 숫자로만 이루어졌지만 6자리가 아닐 때만 true(한글 검색어는 해당 없음)", () => {
  assert.equal(isMalformedCode("59930"), true, "5자리 숫자는 형식 오류");
  assert.equal(isMalformedCode("005930"), false, "6자리는 정상");
  assert.equal(isMalformedCode("삼성"), false, "일반 한글 검색어는 형식 오류가 아니다");
  assert.equal(isMalformedCode("AAPL"), false, "영문 티커는 형식 오류가 아니다");
});
