/**
 * 완료 화면 — 모의 실행 저장 결과.
 *
 * 근거: docs/product/STATE_FLOW_V1.md §14 `completed`
 * "현재 계획 유지" 로 들어오면 재시뮬레이션 없이 기존 결과를 그대로 쓴다.
 */
import { AppHeader, AppScreen, ScreenTitle, TextLink } from "@/components/app/AppScreen";
import { MetricList, MetricRow } from "@/components/app/Metrics";
import { PlanCard } from "@/components/app/PlanCard";
import { NoticeLine } from "@/components/app/StateBlocks";
import { Button } from "@/components/ui/button";
import { useFlow } from "@/flow/FlowProvider";
import { krw, months, times } from "@/lib/simulationCopy";

export function ScreenCompleted() {
  const { plan, selectedAlternative, selectedSimulation, reset } = useFlow();

  const finalPlan = selectedAlternative?.plan ?? plan;

  return (
    <AppScreen
      header={<AppHeader title="모의 실행" />}
      footer={
        <div className="space-y-3">
          <Button onClick={reset}>새 계획 만들기</Button>
          <div className="text-center">
            <TextLink onClick={reset}>처음으로</TextLink>
          </div>
        </div>
      }
    >
      <ScreenTitle sub="실제 주문은 실행되지 않았어요. 조건과 계산 결과만 저장했어요.">
        모의 계획으로
        <br />
        저장했어요
      </ScreenTitle>

      <PlanCard plan={finalPlan} />

      {selectedSimulation !== null ? (
        <section className="mt-8">
          <MetricList>
            <MetricRow
              label="월 최대 투자 금액"
              value={krw(selectedSimulation.maxMonthlyInvestmentKrw)}
            />
            <MetricRow
              label="월 예산 초과"
              value={months(selectedSimulation.budgetExceededMonthCount)}
            />
            <MetricRow
              label="정기 매수"
              value={times(selectedSimulation.recurringExecutionCount)}
            />
            <MetricRow
              label="추가 매수 실행"
              value={times(selectedSimulation.conditionalExecutionCount)}
            />
          </MetricList>
        </section>
      ) : null}

      <div className="mt-8 space-y-2">
        <NoticeLine>
          과거 가격에 조건을 적용한 결과예요. 미래 수익을 예측하거나 보장하지 않아요.
        </NoticeLine>
        {selectedSimulation !== null ? (
          <NoticeLine>
            계산 엔진 {selectedSimulation.engineVersion} · {selectedSimulation.period.from} ~{" "}
            {selectedSimulation.period.to}
          </NoticeLine>
        ) : null}
      </div>
    </AppScreen>
  );
}
