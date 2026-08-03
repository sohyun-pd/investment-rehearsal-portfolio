/**
 * Finnhub adapter 단위 테스트 (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:market
 *
 * HTTP 계층만 주입으로 대체한다. adapter 는 실패 시 어떤 경우에도 대체 데이터를 반환하지 않는다
 * (항상 MarketDataError, 검색 결과 0건은 예외 — 빈 배열은 실패가 아니다).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createFinnhubAdapter, type FetchLike } from "./finnhubAdapter";
import { MarketDataError } from "./types";

const API_KEY = "test-key-do-not-log";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
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

test("빈 검색어는 네트워크 호출 없이 빈 배열을 반환한다", async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error("호출되면 안 됩니다");
  };
  const adapter = createFinnhubAdapter({ apiKey: API_KEY, fetchImpl });

  const result = await adapter.searchSymbols({ query: "" });
  assert.deepEqual(result, []);

  const whitespaceOnly = await adapter.searchSymbols({ query: "   " });
  assert.deepEqual(whitespaceOnly, []);
});

test("미국 보통주를 우선 필터링하고 US 마켓/USD 로 정규화한다", async () => {
  const adapter = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () =>
      jsonResponse({
        count: 3,
        result: [
          { symbol: "AAPL", description: "Apple Inc", type: "Common Stock" },
          { symbol: "AAPL.MX", description: "Apple Inc (Mexico)", type: "Common Stock" },
          { symbol: "AAPLW", description: "Apple Warrant", type: "Warrant" },
        ],
      }),
  });

  const result = await adapter.searchSymbols({ query: "apple" });

  assert.deepEqual(result, [
    { symbol: "AAPL", companyName: "Apple Inc", exchange: null, market: "US", currency: "USD" },
  ]);
});

// [회귀] 이 provider 는 market/currency 를 항상 US/USD 로 못박아 반환한다 — 미국 외 종목
// (예: "AAPL.MX", 멕시코 상장)이 섞여 나오면 실제로는 다른 통화인 가격을 USD 로 잘못
// 표시하게 된다. "지원하지 않는 종목/시장은 지원하는 척하지 않는다"는 원칙에 따라, 이제는
// 다른 시장으로 조용히 대체하지 않고 빈 배열을 돌려준다 — 화면은 "그 이름으로 종목을 찾지
// 못했어요"로 정확히 안내한다.
test("[회귀] 미국 보통주가 하나도 없으면 빈 배열을 돌려준다(다른 시장으로 대체하지 않는다)", async () => {
  const adapter = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () =>
      jsonResponse({
        result: [{ symbol: "AAPL.MX", description: "Apple Inc (Mexico)", type: "Common Stock" }],
      }),
  });

  const result = await adapter.searchSymbols({ query: "apple" });
  assert.equal(result.length, 0);
});

test("검색 결과 0건은 실패가 아니라 빈 배열이다", async () => {
  const adapter = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse({ count: 0, result: [] }),
  });

  const result = await adapter.searchSymbols({ query: "존재하지않는종목이름" });
  assert.deepEqual(result, []);
});

test("현재가를 정규화한다", async () => {
  const adapter = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () =>
      jsonResponse({ c: 213.55, pc: 210.1, d: 3.45, dp: 1.6421, t: 1753650000 }),
  });

  const quote = await adapter.fetchQuote({ symbol: "AAPL" });

  assert.equal(quote.currentPrice, 213.55);
  assert.equal(quote.previousClose, 210.1);
  assert.equal(quote.changeValue, 3.45);
  assert.equal(quote.changePercent, 1.6421);
  assert.equal(quote.marketTimestamp, new Date(1753650000 * 1000).toISOString());
});

test("c 나 t 가 없으면 no_data 로 실패한다(상장폐지·무료티어 제한)", async () => {
  const adapter = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () => jsonResponse({ c: 0, pc: 0, d: 0, dp: 0, t: 0 }),
  });

  await expectError(() => adapter.fetchQuote({ symbol: "DELISTED" }), "no_data");
});

test("HTTP 오류 상태를 코드로 분류한다", async () => {
  const cases: Array<[number, MarketDataError["code"]]> = [
    [401, "unauthorized"],
    [403, "forbidden_or_plan_restriction"],
    [429, "rate_limited"],
    [404, "no_data"],
    [500, "network_failure"],
  ];

  for (const [status, expected] of cases) {
    const adapter = createFinnhubAdapter({
      apiKey: API_KEY,
      fetchImpl: async () => new Response("error body", { status }),
    });
    await expectError(() => adapter.searchSymbols({ query: "apple" }), expected);
  }
});

test("API 키가 없으면 명시적으로 실패한다 (대체 데이터 없음)", async () => {
  const adapter = createFinnhubAdapter({
    apiKey: "",
    fetchImpl: async () => {
      throw new Error("호출되면 안 됩니다");
    },
  });

  await expectError(() => adapter.fetchQuote({ symbol: "AAPL" }), "api_key_missing");
});

test("오류 메시지에 API 키가 남지 않는다", async () => {
  const adapter = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () => new Response(`token ${API_KEY} invalid`, { status: 401 }),
  });

  const error = await expectError(() => adapter.fetchQuote({ symbol: "AAPL" }), "unauthorized");
  assert.equal(error.message.includes(API_KEY), false);
  assert.equal(error.message.includes("***REDACTED***"), true);
});

test("네트워크 실패와 JSON 파싱 실패를 구분한다", async () => {
  const throwing = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED");
    },
  });
  await expectError(() => throwing.fetchQuote({ symbol: "AAPL" }), "network_failure");

  const malformed = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () => new Response("<html>not json</html>", { status: 200 }),
  });
  await expectError(() => malformed.fetchQuote({ symbol: "AAPL" }), "malformed_response");
});

test("빈 symbol 은 invalid_request 로 거부한다", async () => {
  const adapter = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () => {
      throw new Error("호출되면 안 됩니다");
    },
  });
  await expectError(() => adapter.fetchQuote({ symbol: "" }), "invalid_request");
});

test("[회귀] \"Apple\" 검색 시 Finnhub 가 Apple Hospitality REIT 를 먼저 돌려줘도 Apple Inc 를 앞에 둔다", async () => {
  // 실제로 겪은 순서를 그대로 재현한다 — Finnhub 자체 응답 순서가 관련도 순이 아니다.
  const adapter = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () =>
      jsonResponse({
        count: 3,
        result: [
          { symbol: "APLE", description: "Apple Hospitality REIT Inc", type: "Common Stock" },
          { symbol: "AAPL", description: "Apple Inc", type: "Common Stock" },
          { symbol: "AAPI", description: "Apple iSports Group Inc", type: "Common Stock" },
        ],
      }),
  });

  const result = await adapter.searchSymbols({ query: "Apple" });
  assert.equal(result[0]?.symbol, "AAPL", "종목명이 검색어와 가장 가까운 Apple Inc 가 1순위여야 한다");
});

test("검색어와 티커가 완전히 같으면(예: \"AAPL\") 그 종목이 최우선이다", async () => {
  const adapter = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () =>
      jsonResponse({
        count: 2,
        result: [
          { symbol: "AAPI", description: "Apple iSports Group Inc", type: "Common Stock" },
          { symbol: "AAPL", description: "Apple Inc", type: "Common Stock" },
        ],
      }),
  });

  const result = await adapter.searchSymbols({ query: "AAPL" });
  assert.equal(result[0]?.symbol, "AAPL");
});

test("종목명이 검색어와 완전히 같으면 최우선이다(대소문자 무관)", async () => {
  const adapter = createFinnhubAdapter({
    apiKey: API_KEY,
    fetchImpl: async () =>
      jsonResponse({
        count: 2,
        result: [
          { symbol: "TSLB", description: "Tesla Extended Corp", type: "Common Stock" },
          { symbol: "TSLA", description: "Tesla, Inc.", type: "Common Stock" },
        ],
      }),
  });

  const result = await adapter.searchSymbols({ query: "Tesla" });
  // "Tesla, Inc." 는 쉼표가 있어 완전 일치는 아니지만, "시작 일치" 중에서는 가장 짧다 —
  // 순위가 뒤집히지 않는지만 확인한다(TSLB 보다 먼저 와야 한다).
  assert.equal(result[0]?.symbol, "TSLA");
});
