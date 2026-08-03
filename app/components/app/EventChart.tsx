/**
 * 결과 차트 — 종가 1선 + 모든 매수 이벤트를 가격선 위 원형 마커로 표시.
 *
 * v2(§사용자 확정 최종 폴리시): 마커를 이전 버전보다 훨씬 절제된 크기로 그린다. 정기 매수는
 * 저채도 회색 점(지름 3~4px, opacity 0.45~0.55)으로 가격선에 거의 묻히게, 조건부(추가) 매수만
 * 흰 테두리를 두른 노란 점(7~8px)으로 도드라지게, 선택된 점만 검은 원 + 흰 halo(10px)로 강조한다.
 * 레일(하단 세로 막대)은 어떤 버전에서도 쓰지 않는다.
 *
 * 초기 진입 시에는 아무 점도 자동 선택하지 않는다(§사용자 확정 — 이전 버전의 "가장 최근 매수
 * 자동 선택" 동작을 명시적으로 제거) — 사용자가 직접 누르거나 화살표 키로 넘겨야 정보 패널이 뜬다.
 *
 * 마커 선택 방식: 마커 하나하나에 클릭 영역을 주지 않는다. 정기 매수만 최대 52개(주간)까지 있을
 * 수 있는데, 인접 마커끼리 히트 영역이 겹치면 항상 DOM 순서상 마지막 마커만 눌리는 문제가
 * 생긴다. 대신 차트 전체를 덮는 투명 레이어 하나에 클릭/키보드 핸들러를 두고, 클릭한 x 좌표에
 * 가장 가까운 이벤트 하나만 고른다(findNearestMarker).
 */
import * as React from "react";
import type { ChartDataPoint, SimulationEvent } from "@/domain/simulation";
import { buildBuyMarkers, findNearestMarker, type BuyMarker } from "@/lib/chartMarkers";
import { formatQuantity, NO_CONDITIONAL_CHART_NOTE, RECURRING_RAIL_EXPLAINER } from "@/lib/simulationCopy";
import { cn } from "@/lib/utils";

const VIEW_WIDTH = 320;
const VIEW_HEIGHT = 158;
const PLOT_TOP = 16;
const PLOT_BOTTOM = 118;
// 첫·마지막 데이터 포인트가 뷰박스 가장자리에서 잘려 보이지 않도록 좌우에 여백을 둔다.
const PLOT_LEFT = 6;
const PLOT_RIGHT = VIEW_WIDTH - 6;

const RECURRING_RADIUS = 1.75; // 지름 3.5px
const CONDITIONAL_RADIUS = 3.75; // 지름 7.5px
const SELECTED_RADIUS = 5; // 지름 10px, 종류 무관 공통

const LINE_COLOR = "#5c5c5c";
/** 정기 매수 점 — 회색, 저opacity 로 가격선 위에 은은하게. */
const RECURRING_FILL = "#7a7a7a";
const RECURRING_OPACITY = 0.5;
/** 조건부 매수 원형 마커 — 앱의 액션 블루 토큰과 같은 색이다(브랜드 일관성). 흰 테두리로 가격선과 분리한다. */
const CONDITIONAL_FILL = "#3182f6";
const CONDITIONAL_STROKE = "#ffffff";
/** 선택된 이벤트 — 종류와 무관하게 검은 원 + 흰색 halo. */
const SELECTED_FILL = "#111111";
const SELECTED_HALO = "#ffffff";

function formatKoreanDate(iso: string): string {
  return iso.replaceAll("-", ".");
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatKrw(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

/** 가격(종가)·매수 금액 공용 표시 — 종목 통화에 따라 달러/원을 고른다(§사용자 확정 — 국내·
 * 미국 주식 통화 일치, 환율 변환 없이 종목 통화 기호만 쓴다). 매수 금액도 종가와 같은
 * 종목이므로 항상 같은 통화다 — 둘을 다른 통화로 표시하지 않는다. */
function formatPrice(value: number, currency: "USD" | "KRW"): string {
  return currency === "KRW" ? formatKrw(Math.round(value)) : formatUsd(value);
}

interface EventChartProps {
  series: ChartDataPoint[];
  events: SimulationEvent[];
  /** 가격(종가) 표시 통화 — 매수 금액(원)과 별개로, 종목 자체의 시세 통화다. */
  priceCurrency: "USD" | "KRW";
  /** true 면 선택한 매수 정보에 가상 매수 수량을 같이 보여준다(§사용자 확정 — 국내 종목
   * 백테스팅 결과 전용, 해외 종목은 환율 근거 없이 수량을 표시하지 않는다). */
  quantities?: boolean;
  className?: string;
}

export function EventChart({ series, events, priceCurrency, quantities = false, className }: EventChartProps) {
  const markers = React.useMemo(() => buildBuyMarkers(series, events), [series, events]);
  // 초기 진입 시 선택 없음(§사용자 확정 — 자동 선택 제거). 사용자가 누르거나 화살표 키로
  // 넘겨야만 값이 채워진다.
  const [selected, setSelected] = React.useState<BuyMarker | null>(null);

  React.useEffect(() => {
    setSelected(null);
  }, [series, events]);

  const geometry = React.useMemo(() => {
    if (series.length === 0) return null;

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let minIndex = 0;
    let maxIndex = 0;

    series.forEach((point, index) => {
      if (point.closePrice < min) {
        min = point.closePrice;
        minIndex = index;
      }
      if (point.closePrice > max) {
        max = point.closePrice;
        maxIndex = index;
      }
    });

    const span = max - min || 1;
    const lastIndex = Math.max(1, series.length - 1);
    const xAt = (index: number): number => PLOT_LEFT + (index / lastIndex) * (PLOT_RIGHT - PLOT_LEFT);
    const yAt = (price: number): number =>
      PLOT_BOTTOM - ((price - min) / span) * (PLOT_BOTTOM - PLOT_TOP);

    const path = series
      .map((point, index) => `${index === 0 ? "M" : "L"}${xAt(index).toFixed(2)},${yAt(point.closePrice).toFixed(2)}`)
      .join(" ");

    return { min, max, minIndex, maxIndex, xAt, yAt, path };
  }, [series]);

  if (geometry === null) return null;

  const recurringMarkers = markers.filter((marker): marker is Extract<BuyMarker, { type: "RECURRING_BUY" }> =>
    marker.type === "RECURRING_BUY"
  );
  const conditionalMarkers = markers.filter(
    (marker): marker is Extract<BuyMarker, { type: "CONDITIONAL_BUY" }> => marker.type === "CONDITIONAL_BUY"
  );

  const first = series[0];
  const last = series[series.length - 1];
  const mid = series[Math.floor((series.length - 1) / 2)];

  const accessibleSummary =
    `최근 1년 가격 차트. 정기 매수 ${recurringMarkers.length}회, 추가 매수 ${conditionalMarkers.length}회.` +
    ` 최고 ${formatPrice(geometry.max, priceCurrency)}, 최저 ${formatPrice(geometry.min, priceCurrency)}.`;

  // index 오름차순 — 키보드 화살표로 순서대로 넘길 때 쓴다.
  const orderedMarkers = [...markers].sort((a, b) => a.index - b.index);
  const markerKey = (marker: BuyMarker): string => `${marker.type}-${marker.index}`;
  const xAt = geometry.xAt;

  // 빈 공간을 눌렀을 때는 아무 점도 선택하지 않는다(§사용자 확정 — 매수점·데이터 포인트를
  // 선택했을 때만 선택 상태를 만든다). 정기 매수가 촘촘한 구간(최대 52개)까지는 여전히 관대한
  // 터치 영역을 유지하되, 클릭 지점에서 가장 가까운 마커까지의 거리가 이 값을 넘으면 "빈
  // 공간"으로 본다.
  const EMPTY_SPACE_THRESHOLD = 8;

  function selectAtClientX(clientX: number, target: SVGRectElement) {
    const bounds = target.getBoundingClientRect();
    if (bounds.width === 0) return;
    const viewBoxX = ((clientX - bounds.left) / bounds.width) * VIEW_WIDTH;
    const nearest = findNearestMarker(orderedMarkers, viewBoxX, xAt);
    if (nearest === null) {
      setSelected(null);
      return;
    }
    const distance = Math.abs(xAt(nearest.index) - viewBoxX);
    setSelected(distance <= EMPTY_SPACE_THRESHOLD ? nearest : null);
  }

  function selectByKeyboard(direction: 1 | -1) {
    if (orderedMarkers.length === 0) return;
    const currentIndex = selected === null ? -1 : orderedMarkers.findIndex((m) => markerKey(m) === markerKey(selected));
    const nextIndex =
      currentIndex === -1
        ? direction === 1
          ? 0
          : orderedMarkers.length - 1
        : Math.min(orderedMarkers.length - 1, Math.max(0, currentIndex + direction));
    setSelected(orderedMarkers[nextIndex] ?? null);
  }

  /** 정기·조건부 공통 — 선택 여부에 따라 채움색·테두리·반지름을 정한다. 선택되면 종류와
   * 무관하게 검은 원 + 흰색 halo 로 그린다. */
  function markerVisual(
    marker: BuyMarker,
    isSelected: boolean
  ): { r: number; fill: string; stroke: string | undefined; strokeWidth: number; opacity: number } {
    if (isSelected) {
      return { r: SELECTED_RADIUS, fill: SELECTED_FILL, stroke: SELECTED_HALO, strokeWidth: 3, opacity: 1 };
    }
    if (marker.type === "RECURRING_BUY") {
      return { r: RECURRING_RADIUS, fill: RECURRING_FILL, stroke: undefined, strokeWidth: 0, opacity: RECURRING_OPACITY };
    }
    return { r: CONDITIONAL_RADIUS, fill: CONDITIONAL_FILL, stroke: CONDITIONAL_STROKE, strokeWidth: 2, opacity: 1 };
  }

  return (
    <div className={cn("space-y-3", className)}>
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
        className="w-full"
        role="img"
        aria-label={accessibleSummary}
      >
        {/* 종가 라인 (단일 계열이므로 범례 없이 제목이 계열을 설명한다) */}
        <path d={geometry.path} fill="none" stroke={LINE_COLOR} strokeWidth={2} strokeLinejoin="round" />

        {/* 최고 · 최저 값 라벨 */}
        <circle cx={geometry.xAt(geometry.maxIndex)} cy={geometry.yAt(geometry.max)} r={2.5} fill={LINE_COLOR} />
        <circle cx={geometry.xAt(geometry.minIndex)} cy={geometry.yAt(geometry.min)} r={2.5} fill={LINE_COLOR} />

        {/* 선택된 이벤트에서 x축까지 잇는 세로 가이드(§사용자 확정 — "선택한 점에서 x축까지
            세로 가이드 표시"). */}
        {selected !== null ? (
          <line
            x1={geometry.xAt(selected.index)}
            x2={geometry.xAt(selected.index)}
            y1={geometry.yAt(selected.price)}
            y2={PLOT_BOTTOM}
            stroke="#cccccc"
            strokeWidth={1}
            strokeDasharray="2,2"
            pointerEvents="none"
          />
        ) : null}

        {/* 정기 매수 — 가격선 위에 거의 묻히는 저opacity 회색 점(3.5px). 마커 자체는 클릭
            핸들러가 없다 — 선택은 아래 단일 오버레이가 가장 가까운 마커를 찾아 처리한다. */}
        {recurringMarkers.map((marker) => {
          const isSelected = selected !== null && markerKey(selected) === markerKey(marker);
          const visual = markerVisual(marker, isSelected);
          return (
            <circle
              key={markerKey(marker)}
              cx={geometry.xAt(marker.index)}
              cy={geometry.yAt(marker.price)}
              r={visual.r}
              fill={visual.fill}
              fillOpacity={visual.opacity}
              stroke={visual.stroke}
              strokeWidth={visual.strokeWidth}
              pointerEvents="none"
            />
          );
        })}

        {/* 조건부(추가) 매수 — 흰 테두리를 두른 노란 점(7.5px). 정기 매수보다 항상 크고 진하게
            그려 구분한다. */}
        {conditionalMarkers.map((marker) => {
          const isSelected = selected !== null && markerKey(selected) === markerKey(marker);
          const visual = markerVisual(marker, isSelected);
          return (
            <circle
              key={markerKey(marker)}
              cx={geometry.xAt(marker.index)}
              cy={geometry.yAt(marker.price)}
              r={visual.r}
              fill={visual.fill}
              fillOpacity={visual.opacity}
              stroke={visual.stroke}
              strokeWidth={visual.strokeWidth}
              pointerEvents="none"
            />
          );
        })}

        {/* 마커 선택을 처리하는 단일 투명 레이어 — 마커별 히트 영역을 겹치지 않게 하려고
            클릭 x 좌표에 가장 가까운 이벤트 하나만 고른다. */}
        {orderedMarkers.length > 0 ? (
          <rect
            x={0}
            y={PLOT_TOP}
            width={VIEW_WIDTH}
            height={PLOT_BOTTOM - PLOT_TOP}
            fill="transparent"
            className="cursor-pointer outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-strong"
            role="button"
            tabIndex={0}
            aria-label="매수 시점 선택. 화살표 키로 이전·다음 이벤트로 이동, Enter 나 클릭으로 선택하세요."
            onClick={(e) => selectAtClientX(e.clientX, e.currentTarget)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") {
                e.preventDefault();
                selectByKeyboard(1);
              } else if (e.key === "ArrowLeft") {
                e.preventDefault();
                selectByKeyboard(-1);
              } else if (e.key === "Escape") {
                setSelected(null);
              }
            }}
          />
        ) : null}
      </svg>

      {/* 사용법 안내 — 매수 횟수는 차트 제목 바로 아래(AnalysisBody 의 summaryCountsLine)에서
          이미 한 번 보여주므로 여기서 다시 세지 않는다(§사용자 확정 — 횟수·조건 미발생 문구를
          한 번씩만 표시). */}
      <div className="space-y-1">
        <p className="text-caption text-text-secondary">{RECURRING_RAIL_EXPLAINER}</p>
        {conditionalMarkers.length === 0 ? (
          <p className="text-caption text-text-tertiary">{NO_CONDITIONAL_CHART_NOTE}</p>
        ) : null}
      </div>

      {/* x축 — 시작일·중간·종료일 세 지점만 표시한다(§사용자 확정). */}
      <div className="flex justify-between text-caption text-text-tertiary">
        <span>{first?.date ?? ""}</span>
        <span>{mid?.date ?? ""}</span>
        <span>{last?.date ?? ""}</span>
      </div>
      <p className="text-right text-caption tnum text-text-tertiary">
        최저 {formatPrice(geometry.min, priceCurrency)} · 최고 {formatPrice(geometry.max, priceCurrency)}
      </p>

      {/* 범례 — 실제 마커와 정확히 같은 모양·색으로 그린다("선택한 매수"도 별도 항목으로
          둬서 검은 원이 무엇을 뜻하는지 알 수 있게 한다). 추가 매수가 0회여도 범례 자체는
          유지한다 — 차트에 실제로 그리는 노란 점만 없을 뿐이다. 폭이 좁으면 자연스럽게 줄바꿈된다. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        <li className="flex items-center gap-1.5 text-caption text-text-secondary">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <circle cx="6" cy="6" r="2" fill={RECURRING_FILL} fillOpacity={RECURRING_OPACITY} />
          </svg>
          정기 매수
        </li>
        <li className="flex items-center gap-1.5 text-caption text-text-secondary">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <circle cx="6" cy="6" r="4" fill={CONDITIONAL_FILL} stroke={CONDITIONAL_STROKE} strokeWidth="2" />
          </svg>
          추가 매수
        </li>
        <li className="flex items-center gap-1.5 text-caption text-text-secondary">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <circle cx="6" cy="6" r="4" fill={SELECTED_FILL} stroke={SELECTED_HALO} strokeWidth="2" />
          </svg>
          선택한 매수
        </li>
      </ul>

      {selected !== null ? (
        <div className="rounded-md bg-surface px-4 py-3" aria-live="polite">
          <p className="text-caption text-text-tertiary">{formatKoreanDate(selected.date)}</p>
          {selected.type === "RECURRING_BUY" ? (
            <>
              <p className="mt-1 text-body text-text-primary">정기 매수 · {formatPrice(selected.amountKrw, priceCurrency)}</p>
              <p className="text-caption text-text-tertiary">당일 종가 {formatPrice(selected.price, priceCurrency)}</p>
              {quantities ? (
                <p className="text-caption text-text-tertiary">가상 매수 수량 {formatQuantity(selected.quantity, priceCurrency)}</p>
              ) : null}
            </>
          ) : (
            <>
              <p className="mt-1 text-body text-text-primary">
                추가 매수{selected.amountKrw !== null ? ` · ${formatPrice(selected.amountKrw, priceCurrency)}` : " · 실행 안 함"}
              </p>
              <p className="text-caption text-text-tertiary">기준 가격보다 {selected.dropPercent}% 하락</p>
              <p className="text-caption text-text-tertiary">당일 종가 {formatPrice(selected.price, priceCurrency)}</p>
              {quantities && selected.quantity !== null ? (
                <p className="text-caption text-text-tertiary">가상 매수 수량 {formatQuantity(selected.quantity, priceCurrency)}</p>
              ) : null}
            </>
          )}
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mt-2 text-caption text-text-secondary underline underline-offset-4"
          >
            닫기
          </button>
        </div>
      ) : null}
    </div>
  );
}
