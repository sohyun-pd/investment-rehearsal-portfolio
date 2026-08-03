/**
 * Screen 5. 조정안 비교와 승인
 *
 * 근거: docs/product/SCREEN_SPEC_V1.md Screen 5, STATE_FLOW_V1.md §19
 * Primary CTA: 이 계획으로 모의 실행하기
 * Secondary: 현재 계획 유지 (재시뮬레이션하지 않음)
 *
 * 조정안은 2개 고정이며 값은 TypeScript 규칙으로 계산한다. AI 는 trade-off 설명만 만든다.
 * 3열 표 대신 지표별 비교 목록을 쓴다.
 */
import { AppHeader, AppScreen, SectionHeading, ScreenTitle, TextLink } from "@/components/app/AppScreen";
import { ComparisonRow } from "@/components/app/Metrics";
import { ErrorBlock, NoticeLine, Skeleton } from "@/components/app/StateBlocks";
import { Button } from "@/components/ui/button";
import { useFlow, type SelectionId } from "@/flow/FlowProvider";
import { krw, months, times } from "@/lib/simulationCopy";
import { cn } from "@/lib/utils";
import type { SimulationResult } from "@/domain/simulation";

export function Screen5Compare() {
  const {
    flowState,
    plan,
    simulation,
    alternatives,
    selectedId,
    select,
    approve,
    back,
    editPlan,
    error,
    retry,
    requestAlternatives,
  } = useFlow();

  const header = <AppHeader onBack={back} step={5} />;

  // --- 오류: Screen 4 결과는 유지하고 이 화면만 실패로 ---
  if (error !== null && error.stage === "alternative_generation") {
    return (
      <AppScreen header={header}>
        <ErrorBlock
          error={error}
          onRetry={() => {
            retry();
            requestAlternatives();
          }}
          secondary={
            <div className="space-y-2">
              <Button variant="secondary" size="md" onClick={() => select("current")}>
                현재 계획 유지
              </Button>
              <Button variant="ghost" size="md" onClick={editPlan}>
                조건 직접 고치기
              </Button>
            </div>
          }
        />
      </AppScreen>
    );
  }

  // --- 로딩 ---
  if (flowState === "generating_alternatives" || alternatives.length === 0 || simulation === null) {
    return (
      <AppScreen header={header}>
        <p className="text-body text-text-secondary">조건을 만족하는 계획을 찾고 있어요</p>
        <div className="mt-6 space-y-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      </AppScreen>
    );
  }

  const options: Array<{
    id: SelectionId;
    name: string;
    headline: string;
    recurringKrw: number | null;
    simulation: SimulationResult;
    benefit: string;
    cost: string;
    budgetLabel: string | null;
    withinBudget: boolean;
  }> = [
    {
      id: "current",
      name: "현재 계획",
      headline: "지금 조건을 그대로 둬요",
      recurringKrw: plan.recurring?.amountKrw ?? null,
      simulation,
      // 부정형 문장이 연속되지 않도록 유지 쪽은 긍정형으로 쓴다(§사용자 확정).
      benefit: "정기 매수 금액과 조건을 그대로 유지해요.",
      // 실제로 넘긴 달이 있을 때만 그렇게 말한다 — 고정 문구로 사실과 다르게 말하지 않는다
      // (§재발했던 회귀: 예산을 넘지 않았는데도 "그대로 남아요"라고 표시됨).
      cost:
        simulation.budgetExceededMonthCount > 0
          ? `월 예산을 넘는 달은 ${months(simulation.budgetExceededMonthCount)}이에요.`
          : "월 예산을 넘는 달은 없어요.",
      budgetLabel: null,
      withinBudget: false,
    },
    ...alternatives.map((alt) => ({
      id: alt.rule.id as SelectionId,
      name: alt.rule.name,
      headline: alt.rule.headline,
      recurringKrw: alt.plan.recurring?.amountKrw ?? null,
      simulation: alt.simulation,
      benefit: alt.tradeOff.benefit,
      cost: alt.tradeOff.cost,
      budgetLabel: alt.rule.budgetLabel,
      withinBudget: alt.rule.budgetPosture === "within_budget",
    })),
  ];

  const selectedIndex = options.findIndex((option) => option.id === selectedId);
  const disabled = selectedId === null;

  return (
    <AppScreen
      header={header}
      footer={
        <div className="space-y-3">
          <Button disabled={disabled} onClick={approve}>
            {disabled ? "비교할 계획을 하나 골라주세요" : "이 계획으로 모의 실행하기"}
          </Button>
          <div className="flex justify-center gap-5">
            <TextLink
              onClick={() => {
                select("current");
                approve();
              }}
            >
              현재 계획 유지
            </TextLink>
            <TextLink onClick={editPlan}>조건 직접 고치기</TextLink>
          </div>
        </div>
      }
    >
      <ScreenTitle sub="정기 매수 금액을 조정한 계획이에요. 예산을 지키는 정도가 서로 달라요.">
        어떤 계획으로
        <br />
        모의 실행할까요?
      </ScreenTitle>

      <div className="space-y-3">
        {options.map((option, index) => {
          const active = option.id === selectedId;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => select(option.id)}
              aria-pressed={active}
              className={cn(
                "w-full rounded-lg border px-5 py-4 text-left",
                active ? "border-text-primary bg-bg" : "border-border bg-bg hover:bg-surface"
              )}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-card text-text-primary">{option.name}</span>
                <span className="tnum text-caption text-text-tertiary">
                  {option.recurringKrw === null ? "정기 매수 없음" : `매주 ${krw(option.recurringKrw)}`}
                </span>
              </div>
              {option.budgetLabel !== null ? (
                <span
                  className={cn(
                    "mt-2 inline-flex rounded-full px-2.5 py-1 text-caption font-medium",
                    option.withinBudget
                      ? "bg-surface-strong text-text-secondary"
                      : "bg-surface-strong text-warning"
                  )}
                >
                  {option.budgetLabel}
                </span>
              ) : null}
              <p className="mt-2 text-body text-text-secondary">{option.headline}</p>
              <div className="mt-3 space-y-1">
                <p className="text-caption text-text-secondary">{option.benefit}</p>
                <p className="text-caption text-text-tertiary">{option.cost}</p>
              </div>
              {index === 0 ? null : (
                <p className="mt-3 tnum text-caption text-text-tertiary">
                  월 최대 {krw(option.simulation.maxMonthlyInvestmentKrw)} · 예산 초과{" "}
                  {months(option.simulation.budgetExceededMonthCount)}
                </p>
              )}
            </button>
          );
        })}
      </div>

      <section className="mt-8">
        <SectionHeading basis="같은 기간·같은 가격 기준">지표 비교</SectionHeading>
        <div className="divide-y divide-border">
          <ComparisonRow
            label="월 최대 투자 금액"
            values={options.map((option) => krw(option.simulation.maxMonthlyInvestmentKrw))}
            highlightIndex={selectedIndex >= 0 ? selectedIndex : undefined}
          />
          <ComparisonRow
            label="월 예산 초과"
            values={options.map((option) => months(option.simulation.budgetExceededMonthCount))}
            highlightIndex={selectedIndex >= 0 ? selectedIndex : undefined}
          />
          <ComparisonRow
            label="추가 매수 실행"
            values={options.map((option) => times(option.simulation.conditionalExecutionCount))}
            highlightIndex={selectedIndex >= 0 ? selectedIndex : undefined}
          />
          <ComparisonRow
            label="실행하지 않은 조건"
            values={options.map((option) => times(option.simulation.conditionalBlockedCount))}
            highlightIndex={selectedIndex >= 0 ? selectedIndex : undefined}
          />
          <ComparisonRow
            label="총 투자 금액"
            values={options.map((option) => krw(option.simulation.totalInvestmentKrw))}
            highlightIndex={selectedIndex >= 0 ? selectedIndex : undefined}
          />
        </div>
        <p className="mt-2 text-caption text-text-tertiary">
          왼쪽부터 {options.map((option) => option.name).join(" · ")}
        </p>
      </section>

      <div className="mt-8 space-y-2">
        <NoticeLine>
          실제 주문은 실행되지 않아요. 모의 계획으로 저장돼요.
        </NoticeLine>
        <NoticeLine>
          과거 가격에 조건을 적용한 결과이며 미래 수익을 예측하거나 보장하지 않아요.
        </NoticeLine>
      </div>
    </AppScreen>
  );
}
