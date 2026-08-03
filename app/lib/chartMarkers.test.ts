/**
 * buildBuyMarkers 단위 테스트.
 *
 * 실행: npm run test:chartmarkers
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBuyMarkers, findNearestMarker, type BuyMarker } from "./chartMarkers";
import type { ChartDataPoint, SimulationEvent } from "@/domain/simulation";

function point(date: string, closePrice: number, eventIds: string[] = []): ChartDataPoint {
  return {
    date,
    closePrice,
    eventIds,
    hasRecurringBuy: false,
    hasConditionalTrigger: false,
    hasConditionalBuy: false,
    hasBlockedAction: false,
    hasBudgetExceeded: false,
    hasReviewTrigger: false,
  };
}

test("정기 매수만 있으면 RECURRING_BUY 마커만 date·price·amount 와 함께 만든다", () => {
  const series = [point("2025-08-04", 210), point("2025-08-05", 211), point("2025-08-06", 213.25)];
  const events: SimulationEvent[] = [
    {
      id: "evt_1",
      date: "2025-08-06",
      symbol: "AAPL",
      closePrice: 213.25,
      priceCurrency: "USD",
      averageCostBefore: null,
      averageCostAfter: null,
      type: "recurring_buy_executed",
      amountKrw: 200_000,
      scheduledDate: "2025-08-04",
      rolledForward: true,
      quantity: 200_000 / 213.25,
    },
  ];

  const markers = buildBuyMarkers(series, events);

  assert.equal(markers.length, 1);
  assert.deepEqual(markers[0], {
    type: "RECURRING_BUY",
    date: "2025-08-06",
    index: 2,
    price: 213.25,
    amountKrw: 200_000,
    quantity: 200_000 / 213.25,
  });
});

test("조건 발생 + 실제 매수 실행이 같은 날이면 dropPercent 와 amountKrw 를 함께 채운다", () => {
  const series = [point("2025-11-17", 220), point("2025-11-18", 176.4)];
  const events: SimulationEvent[] = [
    {
      id: "evt_trigger",
      date: "2025-11-18",
      symbol: "AAPL",
      closePrice: 176.4,
      priceCurrency: "USD",
      averageCostBefore: 220,
      averageCostAfter: 220,
      type: "conditional_triggered",
      referencePrice: 220,
      thresholdPercent: 20,
      triggerPrice: 176,
      previousClose: 178,
    },
    {
      id: "evt_buy",
      date: "2025-11-18",
      symbol: "AAPL",
      closePrice: 176.4,
      priceCurrency: "USD",
      averageCostBefore: 220,
      averageCostAfter: 220,
      type: "conditional_buy_executed",
      amountKrw: 200_000,
      monthlyExecutionIndex: 1,
      quantity: 200_000 / 176.4,
    },
  ];

  const markers = buildBuyMarkers(series, events);

  assert.equal(markers.length, 1);
  assert.deepEqual(markers[0], {
    type: "CONDITIONAL_BUY",
    date: "2025-11-18",
    index: 1,
    price: 176.4,
    amountKrw: 200_000,
    dropPercent: 20,
    quantity: 200_000 / 176.4,
  });
});

test("[회귀] 조건은 발생했지만 예산 초과로 실제 매수가 막히면 amountKrw 를 지어내지 않고 null 로 둔다", () => {
  const series = [point("2025-11-18", 176.4)];
  const events: SimulationEvent[] = [
    {
      id: "evt_trigger",
      date: "2025-11-18",
      symbol: "AAPL",
      closePrice: 176.4,
      priceCurrency: "USD",
      averageCostBefore: 220,
      averageCostAfter: 220,
      type: "conditional_triggered",
      referencePrice: 220,
      thresholdPercent: 20,
      triggerPrice: 176,
      previousClose: 178,
    },
    {
      id: "evt_blocked",
      date: "2025-11-18",
      symbol: "AAPL",
      closePrice: 176.4,
      priceCurrency: "USD",
      averageCostBefore: 220,
      averageCostAfter: 220,
      type: "conditional_buy_blocked",
      blockedBy: "monthly_budget",
      attemptedAmountKrw: 200_000,
    },
  ];

  const markers = buildBuyMarkers(series, events);

  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.type, "CONDITIONAL_BUY");
  assert.equal((markers[0] as { amountKrw: number | null }).amountKrw, null);
});

test("[회귀] 같은 날 정기 매수와 조건부 매수가 함께 발생하면 두 마커 모두 누락 없이 만든다", () => {
  const series = [point("2025-09-01", 200)];
  const events: SimulationEvent[] = [
    {
      id: "evt_recurring",
      date: "2025-09-01",
      symbol: "AAPL",
      closePrice: 200,
      priceCurrency: "USD",
      averageCostBefore: null,
      averageCostAfter: null,
      type: "recurring_buy_executed",
      amountKrw: 100_000,
      scheduledDate: "2025-09-01",
      rolledForward: false,
      quantity: 100_000 / 200,
    },
    {
      id: "evt_trigger",
      date: "2025-09-01",
      symbol: "AAPL",
      closePrice: 200,
      priceCurrency: "USD",
      averageCostBefore: 220,
      averageCostAfter: 220,
      type: "conditional_triggered",
      referencePrice: 220,
      thresholdPercent: 10,
      triggerPrice: 198,
      previousClose: 205,
    },
    {
      id: "evt_conditional_buy",
      date: "2025-09-01",
      symbol: "AAPL",
      closePrice: 200,
      priceCurrency: "USD",
      averageCostBefore: 220,
      averageCostAfter: 220,
      type: "conditional_buy_executed",
      amountKrw: 300_000,
      monthlyExecutionIndex: 1,
      quantity: 300_000 / 200,
    },
  ];

  const markers = buildBuyMarkers(series, events);

  assert.equal(markers.length, 2, "정기 매수·조건부 매수 두 마커 모두 있어야 한다");
  assert.ok(markers.some((m) => m.type === "RECURRING_BUY" && m.amountKrw === 100_000));
  assert.ok(markers.some((m) => m.type === "CONDITIONAL_BUY" && m.amountKrw === 300_000 && m.dropPercent === 10));
});

test("조건 발생이 0회면 마커도 0개다(임의로 만들지 않는다)", () => {
  const series = [point("2025-08-04", 210), point("2025-08-05", 211)];
  assert.deepEqual(buildBuyMarkers(series, []), []);
});

test("[회귀] 이벤트는 배열 순서가 아니라 date 로 candle 과 연결된다(index 로 잘못 짝지어지지 않는다)", () => {
  // series 의 실제 순서와 무관하게, event.date 와 정확히 같은 date 의 candle 에만 마커가 붙어야
  // 한다 — events 배열을 series 와 다른 순서로 흩어 둬도 결과가 같아야 한다.
  const series = [
    point("2025-01-01", 100),
    point("2025-01-02", 101),
    point("2025-01-03", 102),
    point("2025-01-06", 105),
  ];
  const events: SimulationEvent[] = [
    {
      id: "evt_1",
      date: "2025-01-03",
      symbol: "AAPL",
      closePrice: 102,
      priceCurrency: "USD",
      averageCostBefore: null,
      averageCostAfter: null,
      type: "recurring_buy_executed",
      amountKrw: 50_000,
      scheduledDate: "2025-01-03",
      rolledForward: false,
      quantity: 50_000 / 102,
    },
  ];

  const markers = buildBuyMarkers(series, events);
  assert.equal(markers.length, 1);
  assert.equal(markers[0]?.date, "2025-01-03");
  assert.equal(markers[0]?.index, 2, "series 안에서 실제 date 가 있는 위치(2번, 1월 3일)를 가리켜야 한다");
  assert.equal(markers[0]?.price, 102, "그 날짜 candle 의 종가를 써야 한다(다른 index 의 가격이 섞이면 안 된다)");
});

function recurringMarker(index: number): BuyMarker {
  return { type: "RECURRING_BUY", date: `d${index}`, index, price: 100, amountKrw: 10_000, quantity: 100 };
}

test("findNearestMarker: 마커가 없으면 null 이다", () => {
  assert.equal(findNearestMarker([], 50, (i) => i), null);
});

test("findNearestMarker: 52개 마커가 촘촘히 몰려 있어도(간격 6.3 단위) 클릭 x 에 가장 가까운 하나만 고른다", () => {
  // 320 단위 폭에 52개 마커 — 간격이 32 단위 히트 영역보다 훨씬 좁아 겹쳤던 실제 시나리오.
  const markers = Array.from({ length: 52 }, (_, i) => recurringMarker(i));
  const xAt = (index: number) => (index / 51) * 320;

  // index 30 의 x 좌표(약 188.2)에 아주 가까운 지점을 클릭하면 index 30 이 선택돼야 한다.
  const nearest = findNearestMarker(markers, xAt(30) + 1, xAt);
  assert.equal(nearest?.index, 30, "겹치는 히트 영역과 무관하게 클릭 지점에 가장 가까운 실제 이벤트 날짜가 선택돼야 한다");
});

test("findNearestMarker: 두 마커 사이 정중앙이면 배열상 먼저 나온 마커를 고른다(결정적 동작)", () => {
  const markers = [recurringMarker(0), recurringMarker(10)];
  const xAt = (index: number) => index * 10; // 0, 100
  const nearest = findNearestMarker(markers, 50, xAt); // 정중앙
  assert.equal(nearest?.index, 0, "동률이면 먼저 나온 마커를 고르는 결정적 규칙이어야 한다(매번 같은 결과)");
});
