/**
 * Yahoo Finance 국내(KR) 과거 일봉 adapter 단위 테스트.
 *
 * 실행: npm run test:yahookr
 *
 * HTTP 계층만 주입으로 대체한다(twelveDataHistoricalAdapter.test.ts 와 같은 관례) — 실제
 * Yahoo 응답 형태(§실측 확인, 2026-07-30 curl)를 그대로 흉내 낸 fixture 를 쓴다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { createYahooKoreanAdapter, toYahooProviderSymbol, type FetchLike } from "./yahooKoreanAdapter";
import { MarketDataError } from "./types";

const FIXED_NOW = new Date("2026-07-30T00:00:00.000Z");
const FROM = "2025-07-29";
const TO = "2026-07-27";

interface Captured {
  urls: string[];
}

function makeAdapter(respond: (url: string) => Response, captured: Captured = { urls: [] }) {
  const fetchImpl: FetchLike = async (url) => {
    captured.urls.push(url);
    return respond(url);
  };
  return { adapter: createYahooKoreanAdapter({ fetchImpl, now: () => FIXED_NOW }), captured };
}

/** 실측 Yahoo 응답 형태 그대로 — timestamp·quote·adjclose 가 같은 index 로 연결된다. */
function chartOkResponse(opts: {
  timestamps: number[];
  close: (number | null)[];
  open?: (number | null)[];
  high?: (number | null)[];
  low?: (number | null)[];
  volume?: (number | null)[];
  adjclose?: (number | null)[];
}): Response {
  const n = opts.timestamps.length;
  const body = {
    chart: {
      result: [
        {
          meta: { currency: "KRW", symbol: "005930.KS" },
          timestamp: opts.timestamps,
          indicators: {
            quote: [
              {
                open: opts.open ?? opts.close,
                high: opts.high ?? opts.close,
                low: opts.low ?? opts.close,
                close: opts.close,
                volume: opts.volume ?? Array(n).fill(1000),
              },
            ],
            ...(opts.adjclose !== undefined ? { adjclose: [{ adjclose: opts.adjclose }] } : {}),
          },
        },
      ],
      error: null,
    },
  };
  return new Response(JSON.stringify(body), { status: 200 });
}

function notFoundResponse(): Response {
  return new Response(
    JSON.stringify({ chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } }),
    { status: 404 }
  );
}

/** 2025-07-29 09:00:00 UTC == 2025-07-29 18:00 Asia/Seoul(같은 날짜) — 날짜 변환 검증용 고정값. */
function unixSecondsFor(dateOnly: string): number {
  return Math.floor(Date.parse(`${dateOnly}T09:00:00Z`) / 1000);
}

function daysOfRange(count: number, startDate = "2025-08-01"): number[] {
  const start = Date.parse(`${startDate}T09:00:00Z`);
  return Array.from({ length: count }, (_, i) => Math.floor((start + i * 86_400_000) / 1000));
}

test("종목코드 → provider symbol: KOSPI 는 .KS, KOSDAQ 은 .KQ — 앞자리 0 을 유지한다", () => {
  assert.equal(toYahooProviderSymbol("005930", "KOSPI"), "005930.KS");
  assert.equal(toYahooProviderSymbol("247540", "KOSDAQ"), "247540.KQ");
});

test("정상 응답: adjclose 가 있으면 open/high/low 에 같은 비율(adjustedClose/rawClose)을 곱하고, close 는 adjustedClose 를 쓴다", async () => {
  const timestamps = daysOfRange(220);
  const rawClose = timestamps.map((_, i) => 70000 + i * 10);
  // 마지막 날만 배당락으로 조정 비율이 0.95 라고 가정 — 나머지는 조정 없음(비율 1)과 동일하게 만든다.
  const adjclose = rawClose.map((c) => c);
  adjclose[adjclose.length - 1] = rawClose[rawClose.length - 1]! * 0.95;

  const { adapter } = makeAdapter(() => chartOkResponse({ timestamps, close: rawClose, adjclose }));
  const result = await adapter.fetchHistoricalCandles({
    symbol: "005930",
    exchange: "KOSPI",
    fromInclusive: FROM,
    toInclusive: TO,
  });

  const last = result.candles[result.candles.length - 1]!;
  const expectedRatio = 0.95;
  assert.ok(Math.abs(last.close - rawClose[rawClose.length - 1]! * expectedRatio) < 0.001);
  assert.ok(Math.abs(last.open - rawClose[rawClose.length - 1]! * expectedRatio) < 0.001, "open 도 같은 비율로 조정돼야 한다");

  const first = result.candles[0]!;
  assert.equal(first.close, rawClose[0], "조정 비율이 1인 날은 raw 값 그대로여야 한다");
});

test("[회귀] adjclose 가 아예 없으면 ratio=1 로 raw OHLC 를 그대로 쓴다(지어내지 않는다)", async () => {
  const timestamps = daysOfRange(220);
  const close = timestamps.map((_, i) => 50000 + i);
  const { adapter } = makeAdapter(() => chartOkResponse({ timestamps, close })); // adjclose 없음

  const result = await adapter.fetchHistoricalCandles({
    symbol: "006400",
    exchange: "KOSPI",
    fromInclusive: FROM,
    toInclusive: TO,
  });

  assert.equal(result.candles[0]!.close, close[0]);
  assert.equal(result.candles[0]!.open, close[0]);
});

test("null 행(휴장·데이터 누락)은 건너뛴다 — 지어내지 않는다", async () => {
  const timestamps = daysOfRange(230);
  const close: Array<number | null> = timestamps.map((_, i) => 60000 + i);
  close[5] = null; // 중간에 결측치 하나
  const { adapter } = makeAdapter(() => chartOkResponse({ timestamps, close }));

  const result = await adapter.fetchHistoricalCandles({
    symbol: "005930",
    exchange: "KOSPI",
    fromInclusive: FROM,
    toInclusive: TO,
  });

  assert.equal(result.candles.length, timestamps.length - 1, "null 인 날은 결과에서 빠져야 한다");
});

test("요청 URL 에 앞자리 0 이 유지된 provider symbol(005930.KS)이 들어간다", async () => {
  const timestamps = daysOfRange(220);
  const close = timestamps.map((_, i) => 70000 + i);
  const { adapter, captured } = makeAdapter(() => chartOkResponse({ timestamps, close }));

  await adapter.fetchHistoricalCandles({ symbol: "005930", exchange: "KOSPI", fromInclusive: FROM, toInclusive: TO });

  // "005930.KS" 자체가 "5930.KS" 를 부분 문자열로 포함하므로(끝 6자리), substring 검사로는
  // 앞자리 0 이 제거됐는지 구분할 수 없다(§이 테스트 자체의 첫 버전 실수) — URL 경로에서
  // 심볼 구간만 정확히 뽑아 완전 일치로 확인한다.
  const match = captured.urls[0]?.match(/\/chart\/([^?]+)/);
  const symbolInUrl = match ? decodeURIComponent(match[1]!) : null;
  assert.equal(symbolInUrl, "005930.KS");
});

test("[회귀] 잘못된 종목(HTTP 404 + Not Found) → kr_symbol_not_found, 재시도 대상 아님", async () => {
  const { adapter } = makeAdapter(() => notFoundResponse());

  await assert.rejects(
    () => adapter.fetchHistoricalCandles({ symbol: "0000000", exchange: "KOSPI", fromInclusive: FROM, toInclusive: TO }),
    (error: unknown) => {
      assert.ok(error instanceof MarketDataError);
      assert.equal(error.code, "kr_symbol_not_found");
      assert.equal(error.provider, "yahoo_kr");
      return true;
    }
  );
});

test("서버 오류(HTTP 500) → kr_provider_request_failed", async () => {
  const { adapter } = makeAdapter(() => new Response("internal error", { status: 500 }));

  await assert.rejects(
    () => adapter.fetchHistoricalCandles({ symbol: "005930", exchange: "KOSPI", fromInclusive: FROM, toInclusive: TO }),
    (error: unknown) => {
      assert.ok(error instanceof MarketDataError);
      assert.equal(error.code, "kr_provider_request_failed");
      return true;
    }
  );
});

test("결과가 비어 있으면(chart.result 없음) kr_empty_response", async () => {
  const { adapter } = makeAdapter(
    () => new Response(JSON.stringify({ chart: { result: [], error: null } }), { status: 200 })
  );

  await assert.rejects(
    () => adapter.fetchHistoricalCandles({ symbol: "005930", exchange: "KOSPI", fromInclusive: FROM, toInclusive: TO }),
    (error: unknown) => {
      assert.ok(error instanceof MarketDataError);
      assert.equal(error.code, "kr_empty_response");
      return true;
    }
  );
});

test("[회귀] 유효 거래일이 부족하면(30일 미만) 성공 화면 대신 kr_insufficient_history", async () => {
  const timestamps = daysOfRange(10);
  const close = timestamps.map((_, i) => 70000 + i);
  const { adapter } = makeAdapter(() => chartOkResponse({ timestamps, close }));

  await assert.rejects(
    () => adapter.fetchHistoricalCandles({ symbol: "005930", exchange: "KOSPI", fromInclusive: FROM, toInclusive: TO }),
    (error: unknown) => {
      assert.ok(error instanceof MarketDataError);
      assert.equal(error.code, "kr_insufficient_history");
      return true;
    }
  );
});

test("날짜 오름차순 정렬 + 요청 범위(fromInclusive~toInclusive) 밖 데이터는 제외한다", async () => {
  // 요청 범위보다 훨씬 이른 날짜 하나를 섞어 넣는다 — 최종 결과에는 포함되면 안 된다.
  const outOfRangeTs = Math.floor(Date.parse("2020-01-02T09:00:00Z") / 1000);
  const timestamps = [outOfRangeTs, ...daysOfRange(220)];
  const close = timestamps.map((_, i) => 70000 + i);
  const { adapter } = makeAdapter(() => chartOkResponse({ timestamps, close }));

  const result = await adapter.fetchHistoricalCandles({
    symbol: "005930",
    exchange: "KOSPI",
    fromInclusive: FROM,
    toInclusive: TO,
  });

  assert.ok(
    result.candles.every((c) => c.date >= FROM && c.date <= TO),
    "요청 범위 밖 날짜가 섞여 있으면 안 된다"
  );
  const dates = result.candles.map((c) => c.date);
  const sorted = [...dates].sort();
  assert.deepEqual(dates, sorted, "날짜는 오름차순이어야 한다");
});
