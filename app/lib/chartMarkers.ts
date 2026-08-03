/**
 * 결과 차트가 그릴 매수 이벤트를 정기 매수(RECURRING_BUY)·조건부 매수(CONDITIONAL_BUY)
 * 두 종류로 분리한다(§사용자 확정 — "차트 아래 세로 막대가 무엇인지 알아보기 어렵다",
 * "정기 매수와 조건부 매수의 시각적 구분이 불명확하다").
 *
 * 가격·이벤트를 배열 index 로 짝짓지 않고, buildChartSeries 가 이미 date 기준으로 만들어 둔
 * ChartDataPoint(candle 하나당 하나, 그날 이벤트 id 포함)를 그대로 순회해 date 로만 연결한다.
 *
 * 순수 함수라 SVG 렌더링 없이도 이 파일 자체를 단위 테스트할 수 있다(이 저장소에는 컴포넌트
 * 렌더링 테스트 도구가 없다 — EventChart.tsx 는 이 함수의 결과를 좌표로 바꿔 그리기만 한다).
 */
import type {
  ChartDataPoint,
  ConditionalBuyEvent,
  ConditionalTriggerEvent,
  RecurringBuyEvent,
  SimulationEvent,
} from "@/domain/simulation";

export interface RecurringBuyMarker {
  type: "RECURRING_BUY";
  date: string;
  /** series 안에서의 위치 — x 좌표 계산에 쓴다. */
  index: number;
  price: number;
  amountKrw: number;
  /** amountKrw / closePrice — 가상 소수점 수량(§사용자 확정 백테스팅 개편). */
  quantity: number;
}

export interface ConditionalBuyMarker {
  type: "CONDITIONAL_BUY";
  date: string;
  index: number;
  price: number;
  /** 조건은 발생했지만(트리거) 월 예산·횟수 제한으로 실제 매수가 막혔으면 null 이다 — 지어내지
   * 않는다. */
  amountKrw: number | null;
  dropPercent: number;
  /** 실행되지 않았으면(amountKrw === null) 수량도 없다. */
  quantity: number | null;
}

export type BuyMarker = RecurringBuyMarker | ConditionalBuyMarker;

function isRecurringBuyEvent(event: SimulationEvent): event is RecurringBuyEvent {
  return event.type === "recurring_buy_executed";
}

function isConditionalTriggerEvent(event: SimulationEvent): event is ConditionalTriggerEvent {
  return event.type === "conditional_triggered";
}

function isConditionalBuyEvent(event: SimulationEvent): event is ConditionalBuyEvent {
  return event.type === "conditional_buy_executed";
}

/** 여러 마커가 서로 가까이 있으면(예: 정기 매수 52개가 320px 폭에 촘촘히 몰려 있는 경우) 마커
 * 하나하나에 32×32 히트 영역을 주면 서로 겹쳐서 "가장 마지막에 그린 마커만 눌린다"는 문제가
 * 생긴다(§사용자 확정 — 52개 겹치는 투명 요소 대신, 클릭 x 좌표에 가장 가까운 이벤트 하나를
 * 고르는 단일 핸들러를 쓴다). 이 함수는 순수 계산이라 DOM 없이 바로 단위 테스트할 수 있다. */
export function findNearestMarker(
  markers: BuyMarker[],
  targetX: number,
  xAt: (index: number) => number
): BuyMarker | null {
  if (markers.length === 0) return null;

  let nearest = markers[0]!;
  let nearestDistance = Math.abs(xAt(nearest.index) - targetX);

  for (const marker of markers.slice(1)) {
    const distance = Math.abs(xAt(marker.index) - targetX);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = marker;
    }
  }

  return nearest;
}

export function buildBuyMarkers(series: ChartDataPoint[], events: SimulationEvent[]): BuyMarker[] {
  const eventsByDate = new Map<string, SimulationEvent[]>();
  for (const event of events) {
    const bucket = eventsByDate.get(event.date);
    if (bucket === undefined) eventsByDate.set(event.date, [event]);
    else bucket.push(event);
  }

  const markers: BuyMarker[] = [];

  series.forEach((point, index) => {
    const dayEvents = eventsByDate.get(point.date) ?? [];

    const recurring = dayEvents.find(isRecurringBuyEvent);
    if (recurring !== undefined) {
      markers.push({
        type: "RECURRING_BUY",
        date: point.date,
        index,
        price: point.closePrice,
        amountKrw: recurring.amountKrw,
        quantity: recurring.quantity,
      });
    }

    const trigger = dayEvents.find(isConditionalTriggerEvent);
    if (trigger !== undefined) {
      const executed = dayEvents.find(isConditionalBuyEvent);
      markers.push({
        type: "CONDITIONAL_BUY",
        date: point.date,
        index,
        price: point.closePrice,
        amountKrw: executed?.amountKrw ?? null,
        dropPercent: trigger.thresholdPercent,
        quantity: executed?.quantity ?? null,
      });
    }
  });

  return markers;
}
