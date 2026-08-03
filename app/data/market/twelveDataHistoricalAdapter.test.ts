/**
 * Twelve Data 과거 일봉 adapter 단위 테스트 (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:market
 *
 * HTTP 계층만 주입으로 대체한다. 이는 production fallback fixture 가 아니라
 * 네트워크 경계를 끊기 위한 테스트 더블이다. adapter 는 실패 시 어떤 경우에도
 * 대체 데이터를 반환하지 않는다(항상 MarketDataError).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createTwelveDataHistoricalAdapter,
  type FetchLike,
} from "./twelveDataHistoricalAdapter";
import { MarketDataError, type TwelveDataValue } from "./types";

const API_KEY = "test-key-do-not-log";
const FIXED_NOW = new Date("2026-07-28T00:00:00.000Z");

interface Captured {
  urls: string[];
}

function makeAdapter(
  respond: (url: string) => Response,
  captured: Captured = { urls: [] }
): { adapter: ReturnType<typeof createTwelveDataHistoricalAdapter>; captured: Captured } {
  const fetchImpl: FetchLike = async (url) => {
    captured.urls.push(url);
    return respond(url);
  };
  return {
    adapter: createTwelveDataHistoricalAdapter({
      apiKey: API_KEY,
      fetchImpl,
      now: () => FIXED_NOW,
    }),
    captured,
  };
}

function okResponse(values: TwelveDataValue[]): Response {
  return new Response(JSON.stringify({ meta: { symbol: "AAPL" }, values, status: "ok" }), {
    status: 200,
  });
}

function value(date: string, close: number, volume = "1000"): TwelveDataValue {
  const price = String(close);
  return { datetime: date, open: price, high: price, low: price, close: price, volume };
}

function generateValues(count: number): TwelveDataValue[] {
  const start = Date.parse("2025-08-01T00:00:00Z");
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
    return value(date, 100 + index);
  });
}

async function expectError(
  fn: () => Promise<unknown>,
  code: MarketDataError["code"]
): Promise<MarketDataError> {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof MarketDataError, `MarketDataError 가 아니에요: ${String(error)}`);
    assert.equal(error.code, code);
    return error;
  }
  throw new Error(`오류가 발생하지 않았습니다 (기대: ${code})`);
}

test("inclusive 종료일을 exclusive end_date 로 변환한다", async () => {
  const { adapter, captured } = makeAdapter(() => okResponse([value("2026-07-27", 100)]));

  await adapter.fetchHistoricalCandles({
    symbol: "AAPL",
    fromInclusive: "2025-07-28",
    toInclusive: "2026-07-27",
  });

  const params = new URLSearchParams(captured.urls[0]!.split("?")[1]);
  assert.equal(params.get("start_date"), "2025-07-28");
  assert.equal(params.get("end_date"), "2026-07-28", "toInclusive + 1일");
});

test("interval·order·adjust 를 명시하고 API 기본값에 의존하지 않는다", async () => {
  const { adapter, captured } = makeAdapter(() => okResponse([value("2026-07-27", 100)]));

  await adapter.fetchHistoricalCandles({
    symbol: "AAPL",
    fromInclusive: "2026-07-01",
    toInclusive: "2026-07-27",
  });

  const params = new URLSearchParams(captured.urls[0]!.split("?")[1]);
  assert.equal(params.get("interval"), "1day");
  assert.equal(params.get("order"), "asc");
  assert.equal(params.get("adjust"), "splits");
  assert.equal(params.get("format"), "JSON");
  assert.equal(params.get("outputsize"), "5000");
});

test("문자열 OHLCV 를 Number 로 변환하고 결과 메타를 채운다", async () => {
  const { adapter } = makeAdapter(() =>
    okResponse([
      {
        datetime: "2026-07-24",
        open: "321.79001",
        high: "334.37",
        low: "321.62",
        close: "333.019989",
        volume: "47443900",
      },
    ])
  );

  const result = await adapter.fetchHistoricalCandles({
    symbol: "AAPL",
    fromInclusive: "2026-07-01",
    toInclusive: "2026-07-27",
  });

  assert.deepEqual(result.candles, [
    {
      date: "2026-07-24",
      open: 321.79001,
      high: 334.37,
      low: 321.62,
      close: 333.019989,
      volume: 47443900,
    },
  ]);
  assert.equal(result.provider, "twelve_data");
  assert.equal(result.adjustment, "splits");
  assert.equal(result.dividendAdjusted, false);
  assert.equal(result.fetchedAt, FIXED_NOW.toISOString());
  assert.deepEqual(result.requestedRange, { from: "2026-07-01", to: "2026-07-27" });
  assert.deepEqual(result.actualRange, { from: "2026-07-24", to: "2026-07-24" });
});

test("날짜 오름차순으로 정렬하고 중복을 제거한다", async () => {
  const { adapter } = makeAdapter(() =>
    okResponse([
      value("2026-07-03", 103),
      value("2026-07-01", 101),
      value("2026-07-02", 102),
      value("2026-07-02", 999), // 중복 — 먼저 나온 값 유지
    ])
  );

  const result = await adapter.fetchHistoricalCandles({
    symbol: "AAPL",
    fromInclusive: "2026-07-01",
    toInclusive: "2026-07-03",
  });

  assert.deepEqual(
    result.candles.map((candle) => candle.date),
    ["2026-07-01", "2026-07-02", "2026-07-03"]
  );
  assert.equal(result.candles[1]?.close, 102, "중복은 먼저 나온 행을 유지한다");
});

test("OHLC 유효성 위반 행을 제거한다", async () => {
  const { adapter } = makeAdapter(() =>
    okResponse([
      value("2026-07-01", 100),
      { datetime: "2026-07-02", open: "10", high: "5", low: "8", close: "9", volume: "1" }, // high < low
      { datetime: "2026-07-03", open: "10", high: "12", low: "8", close: "0", volume: "1" }, // close = 0
      { datetime: "not-a-date", open: "10", high: "12", low: "8", close: "11", volume: "1" },
      value("2026-07-06", 106),
    ])
  );

  const result = await adapter.fetchHistoricalCandles({
    symbol: "AAPL",
    fromInclusive: "2026-07-01",
    toInclusive: "2026-07-06",
  });

  assert.deepEqual(
    result.candles.map((candle) => candle.date),
    ["2026-07-01", "2026-07-06"]
  );
});

test("volume 이 없으면 null 로 둔다", async () => {
  const { adapter } = makeAdapter(() =>
    okResponse([{ datetime: "2026-07-01", open: "10", high: "12", low: "8", close: "11" }])
  );

  const result = await adapter.fetchHistoricalCandles({
    symbol: "AAPL",
    fromInclusive: "2026-07-01",
    toInclusive: "2026-07-01",
  });

  assert.equal(result.candles[0]?.volume, null);
});

test("completeness 를 거래일 수로 분류한다", async () => {
  const cases: Array<[number, string]> = [
    [250, "complete"],
    [200, "complete"],
    [199, "partial"],
    [30, "partial"],
    [29, "insufficient"],
  ];

  for (const [count, expected] of cases) {
    const { adapter } = makeAdapter(() => okResponse(generateValues(count)));
    const result = await adapter.fetchHistoricalCandles({
      symbol: "AAPL",
      fromInclusive: "2025-08-01",
      toInclusive: "2026-07-27",
    });
    assert.equal(result.completeness, expected, `${count}개 → ${expected}`);
    assert.equal(result.candles.length, count);
  }
});

test("유효한 candle 이 0개면 성공으로 처리하지 않는다", async () => {
  const { adapter } = makeAdapter(() => okResponse([]));
  await expectError(
    () =>
      adapter.fetchHistoricalCandles({
        symbol: "AAPL",
        fromInclusive: "2026-07-01",
        toInclusive: "2026-07-27",
      }),
    "no_data"
  );

  // 모든 행이 invalid 인 경우도 마찬가지다.
  const { adapter: allInvalid } = makeAdapter(() =>
    okResponse([{ datetime: "2026-07-01", open: "x", high: "y", low: "z", close: "w" }])
  );
  await expectError(
    () =>
      allInvalid.fetchHistoricalCandles({
        symbol: "AAPL",
        fromInclusive: "2026-07-01",
        toInclusive: "2026-07-27",
      }),
    "no_data"
  );
});

test("HTTP 200 이어도 body status=error 를 오류로 처리한다", async () => {
  const { adapter } = makeAdapter(
    () =>
      new Response(
        JSON.stringify({ code: 401, message: "Invalid API key", status: "error" }),
        { status: 200 }
      )
  );

  const error = await expectError(
    () =>
      adapter.fetchHistoricalCandles({
        symbol: "AAPL",
        fromInclusive: "2026-07-01",
        toInclusive: "2026-07-27",
      }),
    "unauthorized"
  );
  assert.equal(error.httpStatus, 200);
  assert.equal(error.apiStatus, "error");
  assert.equal(error.apiCode, 401);
});

test("body code 를 오류 코드로 분류한다", async () => {
  const cases: Array<[number, string, MarketDataError["code"]]> = [
    [403, "plan restriction", "forbidden_or_plan_restriction"],
    [432, "plan restricted symbol", "forbidden_or_plan_restriction"],
    [429, "too many requests", "rate_limited"],
    [429, "You have run out of API credits", "credits_exceeded"],
    [404, "symbol not found", "no_data"],
    // 실제로 국내(KRX) 종목에서 확인한 응답 그대로 — "데이터 없음"이 아니라 "이 요금제에서
    // 지원하지 않는 종목"이다(§재발했던 회귀: 이걸 no_data 로 분류해 "해당 기간 데이터를
    // 찾지 못했어요"라고 잘못 안내했다).
    [404, "This symbol is available starting with the Pro or Venture plan.", "market_not_supported"],
    [500, "server error", "network_failure"],
    [400, "bad request", "malformed_response"],
  ];

  for (const [code, message, expected] of cases) {
    const { adapter } = makeAdapter(
      () => new Response(JSON.stringify({ code, message, status: "error" }), { status: 200 })
    );
    await expectError(
      () =>
        adapter.fetchHistoricalCandles({
          symbol: "AAPL",
          fromInclusive: "2026-07-01",
          toInclusive: "2026-07-27",
        }),
      expected
    );
  }
});

test("네트워크 실패와 JSON 파싱 실패를 구분한다", async () => {
  const throwing = createTwelveDataHistoricalAdapter({
    apiKey: API_KEY,
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });
  await expectError(
    () =>
      throwing.fetchHistoricalCandles({
        symbol: "AAPL",
        fromInclusive: "2026-07-01",
        toInclusive: "2026-07-27",
      }),
    "network_failure"
  );

  const { adapter } = makeAdapter(() => new Response("<html>not json</html>", { status: 200 }));
  await expectError(
    () =>
      adapter.fetchHistoricalCandles({
        symbol: "AAPL",
        fromInclusive: "2026-07-01",
        toInclusive: "2026-07-27",
      }),
    "malformed_response"
  );
});

test("API 키가 없으면 명시적으로 실패한다 (대체 데이터 없음)", async () => {
  const adapter = createTwelveDataHistoricalAdapter({
    apiKey: "",
    fetchImpl: async () => {
      throw new Error("호출되면 안 됩니다");
    },
  });

  await expectError(
    () =>
      adapter.fetchHistoricalCandles({
        symbol: "AAPL",
        fromInclusive: "2026-07-01",
        toInclusive: "2026-07-27",
      }),
    "api_key_missing"
  );
});

test("잘못된 입력을 거부한다", async () => {
  const { adapter } = makeAdapter(() => okResponse([value("2026-07-01", 100)]));

  await expectError(
    () => adapter.fetchHistoricalCandles({ symbol: "", fromInclusive: "2026-07-01", toInclusive: "2026-07-02" }),
    "invalid_request"
  );
  await expectError(
    () =>
      adapter.fetchHistoricalCandles({
        symbol: "AAPL",
        fromInclusive: "2026/07/01",
        toInclusive: "2026-07-02",
      }),
    "invalid_request"
  );
  await expectError(
    () =>
      adapter.fetchHistoricalCandles({
        symbol: "AAPL",
        fromInclusive: "2026-07-05",
        toInclusive: "2026-07-01",
      }),
    "invalid_request"
  );
});

test("오류 메시지에 API 키가 남지 않는다", async () => {
  const { adapter } = makeAdapter(
    () =>
      new Response(
        JSON.stringify({
          code: 401,
          message: `apikey ${API_KEY} is not valid`,
          status: "error",
        }),
        { status: 200 }
      )
  );

  const error = await expectError(
    () =>
      adapter.fetchHistoricalCandles({
        symbol: "AAPL",
        fromInclusive: "2026-07-01",
        toInclusive: "2026-07-27",
      }),
    "unauthorized"
  );

  assert.equal(error.message.includes(API_KEY), false);
  assert.equal(error.message.includes("***REDACTED***"), true);
});
