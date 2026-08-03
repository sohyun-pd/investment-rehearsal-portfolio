/**
 * selectCandlesFallback() / selectKrCandlesFallback() / handleKoreanCandlesRoute() 단위 테스트
 * (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:marketroutes
 *
 * 다루는 원칙(§사용자 확정):
 *  - 실시간 API 가 기본 경로다. 실패했을 때만, 그것도 일시적 장애로 보일 때만 저장된 실제
 *    데이터로 대체한다.
 *  - 저장 데이터가 없는 심볼은 조용히 다른 심볼로 대체하지 않는다 — 원래 오류를 그대로 보여준다.
 *  - 잘못된 심볼처럼 요청 자체의 문제(재시도 불가능한 오류)는 저장 데이터로 가리지 않는다.
 *  - KR 스냅샷(§사용자 확정 — "오늘 제출이 목표이므로 국내 종목 결과를 외부 provider의
 *    일시적인 429에 전적으로 의존하지 않게 한다")은 실제 Yahoo 재호출 없이 fixture 로만
 *    검증한다 — fetchImpl 을 주입해 429·500·200·404 를 그대로 흉내 낸다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { handleKoreanCandlesRoute, selectCandlesFallback, selectKrCandlesFallback } from "./marketRoutes";
import type { ApiProductError } from "./marketRoutes";

const RETRYABLE_ERROR: ApiProductError = {
  stage: "historical_data",
  code: "network_failure",
  userMessage: "연결이 원활하지 않아요. 다시 시도해주세요.",
  retryable: true,
};

const NON_RETRYABLE_ERROR: ApiProductError = {
  stage: "historical_data",
  code: "invalid_request",
  userMessage: "요청 형식이 올바르지 않아요.",
  retryable: false,
};

test("일시적 장애(retryable)이고 저장 데이터가 있는 심볼(AAPL)이면 대체 데이터를 반환한다", () => {
  const fallback = selectCandlesFallback("AAPL", RETRYABLE_ERROR);
  assert.notEqual(fallback, undefined);
  assert.equal(fallback?.symbol, "AAPL");
  assert.ok(fallback !== undefined && fallback.candles.length > 0, "실제로 저장된 거래일 데이터가 있어야 한다");
});

test("소문자로 요청해도 심볼을 대소문자 구분 없이 찾는다", () => {
  const fallback = selectCandlesFallback("aapl", RETRYABLE_ERROR);
  assert.notEqual(fallback, undefined);
});

test("저장 데이터가 없는 심볼(TSLA)은 다른 심볼로 대체하지 않는다", () => {
  const fallback = selectCandlesFallback("TSLA", RETRYABLE_ERROR);
  assert.equal(fallback, undefined, "저장 데이터가 없으면 조용히 다른 심볼로 대체하면 안 된다");
});

test("재시도 불가능한 오류(예: 잘못된 심볼)는 저장 데이터가 있어도 대체하지 않는다", () => {
  const fallback = selectCandlesFallback("AAPL", NON_RETRYABLE_ERROR);
  assert.equal(fallback, undefined, "요청 자체의 문제는 저장 데이터로 가리면 안 된다");
});

// ---------------------------------------------------------------------------
// selectKrCandlesFallback() — KR 스냅샷 대체 여부 결정 (§사용자 확정, 위와 같은 원칙)
// ---------------------------------------------------------------------------

test("KR: 일시적 장애이고 스냅샷이 있는 심볼(005930)이면 대체 데이터를 반환한다", () => {
  const fallback = selectKrCandlesFallback("005930", RETRYABLE_ERROR);
  assert.notEqual(fallback, undefined);
  assert.equal(fallback?.provider, "yahoo_kr_snapshot");
  assert.equal(fallback?.symbol, "005930", "앞자리 0 이 유지돼야 한다");
  assert.equal(fallback?.fallbackUsed, true);
  assert.ok(fallback !== undefined && fallback.candles.length > 0, "실제로 저장된 거래일 데이터가 있어야 한다");
  assert.equal(fallback?.asOfDate, fallback?.actualRange.to, "asOfDate 는 스냅샷의 마지막 실제 거래일이어야 한다");
});

test("KR: 스냅샷이 없는 심볼(006400)은 조용히 다른 심볼로 대체하지 않는다", () => {
  const fallback = selectKrCandlesFallback("006400", RETRYABLE_ERROR);
  assert.equal(fallback, undefined, "지원하지 않는 국내 종목은 가짜 결과 없이 오류를 그대로 보여줘야 한다");
});

test("KR: 재시도 불가능한 오류(예: 종목 없음)는 스냅샷이 있어도 대체하지 않는다", () => {
  const fallback = selectKrCandlesFallback("005930", NON_RETRYABLE_ERROR);
  assert.equal(fallback, undefined, "요청 자체의 문제(종목 없음 등)는 스냅샷으로 가리면 안 된다");
});

// ---------------------------------------------------------------------------
// handleKoreanCandlesRoute() — 실시간 우선 + 실패 시 스냅샷 대체 (라우트 전체 동작)
// ---------------------------------------------------------------------------

function fakeYahooOkResponse(): Response {
  const timestamps = Array.from({ length: 220 }, (_, i) => Math.floor(Date.parse("2026-01-01T09:00:00Z") / 1000) + i * 86_400);
  const close = timestamps.map((_, i) => 70000 + i * 10);
  return new Response(
    JSON.stringify({
      chart: {
        result: [
          {
            meta: { currency: "KRW", symbol: "005930.KS" },
            timestamp: timestamps,
            indicators: { quote: [{ open: close, high: close, low: close, close, volume: close.map(() => 1000) }] },
          },
        ],
        error: null,
      },
    }),
    { status: 200 }
  );
}

test("KR route: 실시간 조회가 성공하면 스냅샷을 참조하지 않는다", async () => {
  const result = await handleKoreanCandlesRoute(
    "005930",
    "KOSPI",
    "2025-07-29",
    "2026-07-28",
    async () => fakeYahooOkResponse()
  );
  assert.equal(result.status, 200);
  const body = result.body as { result: { provider: string; fallbackUsed: boolean } };
  assert.equal(body.result.provider, "yahoo_kr");
  assert.equal(body.result.fallbackUsed, false);
});

test("KR route: 실시간 조회가 429(일시 장애)면 삼성전자는 저장된 스냅샷으로 대체한다", async () => {
  const result = await handleKoreanCandlesRoute(
    "005930",
    "KOSPI",
    "2025-07-29",
    "2026-07-28",
    async () => new Response("Too Many Requests", { status: 429 })
  );
  assert.equal(result.status, 200, "폴백이 있으면 사용자에게는 오류가 아니라 정상 결과로 보여야 한다");
  const body = result.body as {
    result: { provider: string; fallbackUsed: boolean; symbol: string; asOfDate?: string };
  };
  assert.equal(body.result.provider, "yahoo_kr_snapshot");
  assert.equal(body.result.fallbackUsed, true);
  assert.equal(body.result.symbol, "005930");
  assert.equal(typeof body.result.asOfDate, "string");
});

test("KR route: 실시간 조회가 5xx 여도 스냅샷이 없는 종목(006400)은 정직한 오류를 그대로 보여준다", async () => {
  const result = await handleKoreanCandlesRoute(
    "006400",
    "KOSPI",
    "2025-07-29",
    "2026-07-28",
    async () => new Response("internal error", { status: 500 })
  );
  assert.equal(result.status, 502, "재시도 가능한 오류는 502 로 응답해야 한다");
  const body = result.body as { error: { code: string; retryable: boolean } };
  assert.equal(body.error.code, "kr_provider_request_failed");
  assert.equal(body.error.retryable, true);
});

test("KR route: 종목을 찾지 못하면(404) 스냅샷이 있어도 대체하지 않고 정직한 오류를 보여준다", async () => {
  const result = await handleKoreanCandlesRoute(
    "005930",
    "KOSPI",
    "2025-07-29",
    "2026-07-28",
    async () =>
      new Response(
        JSON.stringify({ chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } }),
        { status: 404 }
      )
  );
  assert.equal(result.status, 400, "재시도 불가능한 오류는 502 가 아니라 400 이어야 한다");
  const body = result.body as { error: { code: string; retryable: boolean } };
  assert.equal(body.error.code, "kr_symbol_not_found");
  assert.equal(body.error.retryable, false);
});
