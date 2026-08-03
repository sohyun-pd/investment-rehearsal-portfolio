/**
 * 차트용 시계열 생성 (순수 함수).
 *
 * candle 하나당 데이터 포인트 하나. 그 날짜에 발생한 이벤트 id 와 마커 플래그를 붙인다.
 * 이벤트가 없는 날도 포인트를 만든다(가격선이 끊기지 않도록).
 */
import type { ChartDataPoint, DailyCandle, SimulationEvent } from "./types";

export function buildChartSeries(
  candles: DailyCandle[],
  events: SimulationEvent[]
): ChartDataPoint[] {
  const byDate = new Map<string, SimulationEvent[]>();
  for (const event of events) {
    const bucket = byDate.get(event.date);
    if (bucket === undefined) byDate.set(event.date, [event]);
    else bucket.push(event);
  }

  return candles.map((candle) => {
    const dayEvents = byDate.get(candle.date) ?? [];
    const point: ChartDataPoint = {
      date: candle.date,
      closePrice: candle.close,
      eventIds: dayEvents.map((event) => event.id),
      hasRecurringBuy: false,
      hasConditionalTrigger: false,
      hasConditionalBuy: false,
      hasBlockedAction: false,
      hasBudgetExceeded: false,
      hasReviewTrigger: false,
    };

    for (const event of dayEvents) {
      switch (event.type) {
        case "recurring_buy_executed":
          point.hasRecurringBuy = true;
          break;
        case "conditional_triggered":
          point.hasConditionalTrigger = true;
          break;
        case "conditional_buy_executed":
          point.hasConditionalBuy = true;
          break;
        case "conditional_buy_blocked":
          point.hasBlockedAction = true;
          break;
        case "monthly_budget_exceeded":
          point.hasBudgetExceeded = true;
          break;
        case "review_triggered":
          point.hasReviewTrigger = true;
          break;
      }
    }

    return point;
  });
}
