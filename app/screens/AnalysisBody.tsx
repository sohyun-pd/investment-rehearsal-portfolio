/**
 * 분석 결과 본문 — Screen 4 와 Screen 4-R 이 공유한다.
 *
 * 근거: docs/product/SCREEN_SPEC_V1.md Screen 4 / Screen 4-R
 * (Screen 4-R 은 새 화면을 만들지 않고 이 레이아웃을 재사용한다)
 *
 * §사용자 확정(백테스팅 결과 3차 개편) — 순서를 아래로 고정한다:
 *  [1] 페이지 제목·종목·기간 → [2] 핵심 평가손익 → [2.5] 똑대리 한마디 → [3] 주요 지표 →
 *  [4] 가격 차트 → [5] 조건부 매수 비교(또는 조건 미발생 안내) → [6] 월 한도 보조 정보 →
 *  [7] 세부 내역·계산 가정(기본 접힘). 국내(KRW)·해외(USD) 모두 같은 구조를 쓴다(§사용자
 *  확정 — "USD라는 이유로 평가수익률과 백테스팅 결과 전체를 숨기지 마세요") — 통화 표기만
 *  다르다. 문구는 사용자가 확정한 그대로 쓴다(simulationCopy.ts) — 이 파일에서 새로 짓지
 *  않는다.
 *
 * §똑대리 한마디는 AI 호출 없이 결정적으로 만든다(simulationCopy.ts 의 tokdaeriComment) —
 * 화면에 이미 있는 숫자(총 투자금·평가금액·정기 매수 횟수 등)를 반복하지 않고, 이번 결과의
 * 특징 하나와 다음 비교 행동만 고정 문구 중에서 고른다.
 */
import * as React from "react";
import { SectionHeading } from "@/components/app/AppScreen";
import { ChevronIcon } from "@/components/app/ChevronIcon";
import { DemoDataBadge } from "@/components/app/DemoDataBadge";
import { isMockMarketEnabled } from "@/config/marketDataMode";
import { EventChart } from "@/components/app/EventChart";
import { formatCompanyName } from "@/components/app/PlanCard";
import { MetricRow } from "@/components/app/Metrics";
import { EmptyBlock, NoticeLine } from "@/components/app/StateBlocks";
import type { SimulationResult } from "@/domain/simulation";
import type { FlowError } from "@/flow/appFlowState";
import type { MarketQuoteDto } from "@/data/market/provider";
import {
  assetMetaLine,
  BACKTEST_ASSUMPTIONS,
  BACKTEST_PAGE_TITLE,
  BACKTEST_SUPPORTING_LINE,
  CALC_UNAVAILABLE,
  comparisonHeadline,
  comparisonSupportingLine,
  COMPARISON_SECTION_TITLE,
  CONDITIONAL_NOT_TRIGGERED_BODY,
  CONDITIONAL_NOT_TRIGGERED_TITLE,
  affectedMonthCount,
  formatMoney,
  formatPercentPointDiff,
  formatQuantity,
  formatSignedMoney,
  krMarketDataDisclosure,
  krw,
  lastTradingDateLine,
  monthlyLimitTitle,
  MONTHLY_LIMIT_SUPPORTING_LINE,
  periodMetaLine,
  PROFIT_LOSS_LABEL,
  profitLossUnavailableReason,
  profitLossValue,
  returnAndInvestedLine,
  SHOW_ALL_BUYS_LABEL,
  SHOW_ASSUMPTIONS_LABEL,
  SHOW_MONTHLY_HISTORY_LABEL,
  summaryCountsLine,
  times,
  tokdaeriComment,
  USD_BASIS_NOTICE,
} from "@/lib/simulationCopy";

interface QuoteBlockProps {
  status: "idle" | "loading" | "ready" | "error";
  data: MarketQuoteDto | null;
  error: FlowError | null;
}

interface AnalysisBodyProps {
  result: SimulationResult;
  /** 결과 제목 아래 메타 정보 줄("Apple Inc · AAPL")에 쓴다. 빈 문자열이면 심볼만 보여준다. */
  companyName: string;
  /** 종목 시세 통화 — 금액 표기에 쓴다(§사용자 확정 — 환율 변환 없이 통화 기호만 바꾼다). */
  priceCurrency: "USD" | "KRW";
  quote: QuoteBlockProps;
  onRetryQuote: () => void;
  /** completeness가 "partial"일 때만 true로 전달한다. */
  partialDataNotice?: boolean;
  /** 실제 조회 시각(ISO). */
  marketDataFetchedAt: string;
  /** true 면 실시간 조회가 실패해 서버에 저장된 실제 응답으로 대체된 것이다. */
  marketDataFallbackUsed: boolean;
}

/** "2026-07-29T11:37:22.205Z" → "2026년 7월 29일". */
function formatKoreanDate(isoDate: string): string {
  const [year, month, day] = isoDate.slice(0, 10).split("-");
  if (year === undefined || month === undefined || day === undefined) return isoDate;
  return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

/** 현재가 — 참고용 데이터 기준 정보로만 제한적으로 쓴다(매수 판단 정보 아님). */
function QuoteLine({ status, data, error, onRetry }: QuoteBlockProps & { onRetry: () => void }) {
  if (status === "loading") return <NoticeLine>현재가를 확인하고 있어요 …</NoticeLine>;
  if (status === "error") {
    return (
      <div className="flex items-center justify-between gap-3">
        <NoticeLine>{error?.userMessage ?? "현재가를 불러오지 못했어요."}</NoticeLine>
        {error?.retryable ? (
          <button type="button" onClick={onRetry} className="shrink-0 text-caption font-medium text-action-text underline">
            다시 시도
          </button>
        ) : null}
      </div>
    );
  }
  if (status === "ready" && data !== null) {
    const sign = data.changePercent >= 0 ? "+" : "";
    return (
      <NoticeLine>
        현재가 ${data.currentPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })} (
        {sign}
        {data.changePercent.toFixed(2)}%) · 참고용 정보이며 분석에는 쓰지 않아요.
      </NoticeLine>
    );
  }
  return null;
}

function MarketDataBasisNote({ fetchedAt, fallbackUsed }: { fetchedAt: string; fallbackUsed: boolean }) {
  const dateLabel = fetchedAt !== "" ? formatKoreanDate(fetchedAt) : null;
  if (fallbackUsed) {
    return (
      <p className="text-caption text-text-tertiary">
        {dateLabel !== null ? `${dateLabel}에 저장한 시장 데이터 기준` : "저장한 시장 데이터 기준"} ·
        현재 조회가 원활하지 않아 저장된 데이터로 확인했어요.
      </p>
    );
  }
  return null;
}

/** 클릭하면 열리고 닫히는 접힘 섹션 — "기본 화면에서는 짧게, 눌렀을 때만 전체를 보여준다"
 * (§사용자 확정). */
function CollapsibleSection({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center justify-center gap-1.5 rounded-md bg-surface py-2.5 text-caption font-medium text-text-secondary hover:bg-surface-strong"
      >
        <span className="[word-break:keep-all]">{label}</span>
        <ChevronIcon direction={open ? "up" : "down"} className="shrink-0 text-text-tertiary" />
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

/** 접힘 섹션을 열자마자 긴 리스트 전체가 쏟아지지 않게, 처음엔 최근 항목 몇 개만 보여주고
 * "더보기"를 눌러야 전체를 본다(§사용자 확정). 저장된 순서(오래된 → 최신)를 뒤집어 최신
 * 항목이 위로 오게 한다. */
const RECENT_ITEMS_COUNT = 3;

function ExpandableList<T>({
  items,
  keyOf,
  renderItem,
}: {
  items: T[];
  keyOf: (item: T) => string;
  renderItem: (item: T) => React.ReactNode;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const newestFirst = React.useMemo(() => [...items].reverse(), [items]);
  const visible = expanded ? newestFirst : newestFirst.slice(0, RECENT_ITEMS_COUNT);

  return (
    <>
      <div className="divide-y divide-border rounded-md bg-surface px-4">
        {visible.map((item) => (
          <React.Fragment key={keyOf(item)}>{renderItem(item)}</React.Fragment>
        ))}
      </div>
      {!expanded && newestFirst.length > RECENT_ITEMS_COUNT ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 w-full rounded-md py-2 text-caption font-medium text-text-secondary hover:bg-surface-strong"
        >
          더보기
        </button>
      ) : null}
    </>
  );
}

export function AnalysisBody({
  result,
  companyName,
  priceCurrency,
  quote,
  onRetryQuote,
  partialDataNotice = false,
  marketDataFetchedAt,
  marketDataFallbackUsed,
}: AnalysisBodyProps) {
  const [showMonthly, setShowMonthly] = React.useState(false);
  const [showAllBuys, setShowAllBuys] = React.useState(false);
  const [showAssumptions, setShowAssumptions] = React.useState(false);

  const comparison = result.backtestComparison;
  const hasConditionalPlan = comparison !== null;
  const conditionalTriggered = result.conditionalTriggerCount > 0;
  const canCalculate = result.totalInvested > 0;

  const allBuyEvents = React.useMemo(
    () =>
      result.simulationEvents.filter(
        (event): event is Extract<typeof event, { type: "recurring_buy_executed" | "conditional_buy_executed" }> =>
          event.type === "recurring_buy_executed" || event.type === "conditional_buy_executed"
      ),
    [result.simulationEvents]
  );

  return (
    <>
      <DemoDataBadge visible={isMockMarketEnabled()} className="mb-4" />

      {partialDataNotice ? (
        <div className="mb-6">
          <NoticeLine>확인 가능한 기간이 1년보다 짧아요. 결과는 참고용으로만 봐주세요.</NoticeLine>
        </div>
      ) : null}

      {/* [1] 페이지 제목·종목·기간 */}
      <section className="mb-6">
        <p className="text-caption font-medium text-text-tertiary">{BACKTEST_PAGE_TITLE}</p>
        <p className="mt-1 text-body text-text-secondary [word-break:keep-all]">
          {assetMetaLine(companyName !== "" ? formatCompanyName(companyName) : "", result.symbol)}
        </p>
        <p className="mt-0.5 text-caption text-text-tertiary [word-break:keep-all]">{periodMetaLine(result)}</p>
        <p className="mt-0.5 text-caption text-text-tertiary [word-break:keep-all]">{lastTradingDateLine(result)}</p>
      </section>

      {/* [2] 핵심 평가손익 — 결과 화면에서 가장 먼저, 가장 크게 보여준다(§사용자 확정). */}
      <section className="mb-8">
        <p className="text-caption text-text-tertiary">{PROFIT_LOSS_LABEL}</p>
        <p className="tnum mt-1 whitespace-nowrap text-display tracking-[-1px] text-text-primary">
          {profitLossValue(result, priceCurrency)}
        </p>
        {!canCalculate ? (
          <p className="mt-1.5 whitespace-pre-line text-caption text-text-secondary">{profitLossUnavailableReason(result)}</p>
        ) : (
          <p className="mt-1.5 text-caption text-text-secondary [word-break:keep-all]">
            {returnAndInvestedLine(result, priceCurrency)}
          </p>
        )}
        <p className="mt-3 text-body text-text-secondary [word-break:keep-all]">{BACKTEST_SUPPORTING_LINE}</p>
        <MarketDataBasisNote fetchedAt={marketDataFetchedAt} fallbackUsed={marketDataFallbackUsed} />
      </section>

      {/* [2.5] 똑대리 한마디 — 결과를 요약하지 않는다. 화면에 이미 나온 숫자를 반복하지 않고,
          이번 결과의 특징 하나와 다음 비교 행동만 결정적으로 고른 두 문장으로 보여준다(§똑대리
          한마디 — AI 호출 없이 항상 같은 품질을 보장한다). 주요 지표보다 작고 옅게 — 작은 카드로
          감싸 다른 결과 정보와 시각적으로 구분한다. */}
      <div className="mb-8 rounded-lg bg-surface px-4 py-3">
        <div className="flex items-center gap-1.5">
          <img src="/assets/profile.png" alt="" aria-hidden className="h-4 w-4 shrink-0 rounded-full object-cover" />
          <span className="text-caption font-medium text-text-tertiary">똑대리 한마디</span>
        </div>
        <p className="mt-2 whitespace-pre-line text-caption text-text-secondary [word-break:keep-all]">
          {tokdaeriComment(result, priceCurrency)}
        </p>
      </div>

      {/* [3] 주요 지표 — 2열 리스트 4개만 먼저 보여준다(§사용자 확정 — "월 최대 투자 금액"은
          제외한다). */}
      <section className="mb-8 grid grid-cols-2 gap-x-4 gap-y-4">
        <MetricCell label="총 투자금" value={krwOrUsd(result.totalInvested, priceCurrency)} />
        {/* §국내주식 정수 수량 매수 — endingValue(총수량 × 종가)는 매수가 하나도 없어도
            0 으로 항상 계산 가능하다. canCalculate(=totalInvested>0) 로 가리면 실제로는
            확정적으로 아는 "0원"을 "계산할 수 없어요"로 감추게 된다. */}
        <MetricCell label="마지막 날 평가금액" value={formatMoney(result.endingValue, priceCurrency)} />
        <MetricCell
          label="평균 매수가"
          value={result.averagePurchasePrice !== null ? formatMoney(result.averagePurchasePrice, priceCurrency) : CALC_UNAVAILABLE}
        />
        <MetricCell label="가상 보유 수량" value={formatQuantity(result.totalQuantity, priceCurrency)} />
        <p className="col-span-2 text-caption text-text-tertiary [word-break:keep-all]">{summaryCountsLine(result)}</p>
      </section>

      {/* [4] 가격 차트와 매수 시점 */}
      <section className="mb-8">
        <SectionHeading basis="일별 종가 기준">가격과 매수 시점</SectionHeading>
        <p className="mb-3 text-caption text-text-secondary [word-break:keep-all]">{summaryCountsLine(result)}</p>
        <EventChart series={result.chartSeries} events={result.simulationEvents} priceCurrency={priceCurrency} quantities />
      </section>

      {/* [5] 조건부 매수 비교 — 조건부 매수를 설정한 계획에서만 노출한다. */}
      {hasConditionalPlan ? (
        conditionalTriggered ? (
          <section className="mb-8">
            <SectionHeading>{COMPARISON_SECTION_TITLE}</SectionHeading>
            <p className="whitespace-pre-line text-body text-text-primary [word-break:keep-all]">
              {comparisonHeadline(result, priceCurrency)}
            </p>
            {comparisonSupportingLine(result, priceCurrency) !== null ? (
              <p className="mt-2 whitespace-pre-line text-body text-text-secondary [word-break:keep-all]">
                {comparisonSupportingLine(result, priceCurrency)}
              </p>
            ) : null}
            {/* §사용자 확정 — 대표 영역에는 반드시 이 네 값이 함께 보여야 한다. */}
            <div className="mt-4 space-y-0 divide-y divide-border rounded-md bg-surface px-4">
              <MetricRow label="추가 투자금" value={formatMoney(comparison!.difference.additionalInvested, priceCurrency)} />
              <MetricRow
                label="평가손익 차이"
                value={formatSignedMoney(comparison!.difference.profitLossDifference, priceCurrency)}
              />
              <MetricRow
                label="평가수익률 차이"
                value={
                  comparison!.difference.returnRateDifference !== null
                    ? `${comparison!.difference.returnRateDifference >= 0 ? "+" : "-"}${formatPercentPointDiff(
                        comparison!.difference.returnRateDifference
                      )}`
                    : CALC_UNAVAILABLE
                }
              />
              <MetricRow
                label="평균 매수가 차이"
                value={
                  comparison!.difference.averagePurchasePriceDifference !== null
                    ? formatSignedMoney(comparison!.difference.averagePurchasePriceDifference, priceCurrency)
                    : CALC_UNAVAILABLE
                }
              />
            </div>
          </section>
        ) : (
          <section className="mb-8">
            <EmptyBlock title={CONDITIONAL_NOT_TRIGGERED_TITLE} description={CONDITIONAL_NOT_TRIGGERED_BODY} />
          </section>
        )
      ) : null}

      {/* [6] 월 한도 보조 정보 */}
      <section className="mb-8">
        <SectionHeading>{monthlyLimitTitle(result)}</SectionHeading>
        <p className="text-body text-text-secondary [word-break:keep-all]">{MONTHLY_LIMIT_SUPPORTING_LINE}</p>
        <div className="mt-3 space-y-0 divide-y divide-border rounded-md bg-surface px-4">
          <MetricRow label="실행된 매수" value={times(result.recurringExecutionCount + result.conditionalExecutionCount)} />
          <MetricRow label="실행되지 않은 매수" value={times(result.budgetSkippedEvents.length)} />
          <MetricRow label="영향을 받은 월" value={`${affectedMonthCount(result)}개월`} />
        </div>
      </section>

      {/* [7] 세부 내역과 계산 가정 — 기본적으로 접어 둔다(§사용자 확정 — 페이지 길이 축소). */}
      <section className="space-y-3">
        <CollapsibleSection label={SHOW_MONTHLY_HISTORY_LABEL} open={showMonthly} onToggle={() => setShowMonthly((v) => !v)}>
          <ExpandableList
            items={result.monthlyResults}
            keyOf={(month) => month.month}
            renderItem={(month) => <MetricRow label={month.month} value={krw(month.totalInvestmentKrw)} tone="muted" />}
          />
        </CollapsibleSection>

        <CollapsibleSection label={SHOW_ALL_BUYS_LABEL} open={showAllBuys} onToggle={() => setShowAllBuys((v) => !v)}>
          <ExpandableList
            items={allBuyEvents}
            keyOf={(event) => event.id}
            renderItem={(event) => (
              <div className="flex items-baseline justify-between gap-4 py-3">
                <span className="text-body text-text-secondary [word-break:keep-all]">
                  {formatKoreanDate(event.date)} ·{" "}
                  {event.type === "recurring_buy_executed" ? "정기 매수" : "추가 매수"}
                </span>
                <span className="tnum whitespace-nowrap text-body font-medium text-text-primary">
                  {krw(event.amountKrw)}
                </span>
              </div>
            )}
          />
        </CollapsibleSection>

        <CollapsibleSection label={SHOW_ASSUMPTIONS_LABEL} open={showAssumptions} onToggle={() => setShowAssumptions((v) => !v)}>
          <div className="space-y-2 rounded-lg border border-border bg-bg px-4 py-4">
            {priceCurrency === "KRW" ? (
              <>
                <NoticeLine>국내 가격 데이터는 Yahoo Finance의 일별 시장 데이터를 사용해요.</NoticeLine>
                <NoticeLine>
                  {krMarketDataDisclosure(
                    marketDataFallbackUsed,
                    result.period.from,
                    result.period.to,
                    new Date().toISOString().slice(0, 10)
                  )}
                </NoticeLine>
              </>
            ) : (
              <NoticeLine>{USD_BASIS_NOTICE}</NoticeLine>
            )}
            {BACKTEST_ASSUMPTIONS.map((assumption) => (
              <NoticeLine key={assumption}>{assumption}</NoticeLine>
            ))}
            <QuoteLine {...quote} onRetry={onRetryQuote} />
          </div>
        </CollapsibleSection>
      </section>
    </>
  );
}

function krwOrUsd(value: number, currency: "USD" | "KRW"): string {
  return formatMoney(value, currency);
}

/** 주요 지표 카드 하나 — 라벨 위·값 아래, 숫자와 단위가 줄바꿈으로 갈라지지 않게 한다
 * (§사용자 확정). */
function MetricCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-caption text-text-tertiary [word-break:keep-all]">{label}</p>
      <p className="tnum mt-1 whitespace-nowrap text-card text-text-primary">{value}</p>
    </div>
  );
}
