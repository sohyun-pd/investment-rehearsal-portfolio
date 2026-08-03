/**
 * Screen 4-R. 수정안 결과 — **Screen 4 레이아웃 재사용**.
 *
 * 근거: docs/product/SCREEN_SPEC_V1.md Screen 4-R
 *
 * 새 화면을 만들지 않는다. 상단에 변경 전/후 비교 요약만 얹고, 본문은 Screen 4 와 같다.
 * 재계산·재조회를 하지 않는다. 이미 계산된 두 결과를 읽어서 비교한다.
 */
import { AppHeader, AppScreen, SectionHeading } from "@/components/app/AppScreen";
import { BeforeAfterRow } from "@/components/app/Metrics";
import { Button } from "@/components/ui/button";
import { useFlow } from "@/flow/FlowProvider";
import { krw, months, times } from "@/lib/simulationCopy";
import { AnalysisBody } from "@/screens/AnalysisBody";

export function Screen4RevisedResult() {
  const { plan, simulation, selectedAlternative, quote, marketData, back, finish, retryQuote } = useFlow();

  const revised = selectedAlternative?.simulation ?? null;

  if (revised === null || simulation === null) {
    // 선택 결과가 없으면 비교 화면으로 되돌린다.
    return (
      <AppScreen header={<AppHeader onBack={back} step={4} />}>
        <p className="text-body text-text-secondary">비교할 결과를 찾지 못했어요.</p>
      </AppScreen>
    );
  }

  return (
    <AppScreen
      header={<AppHeader onBack={back} step={4} />}
      footer={<Button onClick={finish}>모의 실행 마치기</Button>}
    >
      {/* Screen 4 대비 추가되는 유일한 블록 */}
      <section className="mb-8 rounded-lg bg-surface px-5 py-4">
        <SectionHeading>{selectedAlternative?.rule.name ?? "조정안"}으로 바뀐 부분</SectionHeading>
        <div className="divide-y divide-border-strong/40">
          <BeforeAfterRow
            label="월 최대 투자 금액"
            before={krw(simulation.maxMonthlyInvestmentKrw)}
            after={krw(revised.maxMonthlyInvestmentKrw)}
            changed={simulation.maxMonthlyInvestmentKrw !== revised.maxMonthlyInvestmentKrw}
          />
          <BeforeAfterRow
            label="월 예산 초과"
            before={months(simulation.budgetExceededMonthCount)}
            after={months(revised.budgetExceededMonthCount)}
            changed={simulation.budgetExceededMonthCount !== revised.budgetExceededMonthCount}
          />
          <BeforeAfterRow
            label="추가 매수 실행"
            before={times(simulation.conditionalExecutionCount)}
            after={times(revised.conditionalExecutionCount)}
            changed={simulation.conditionalExecutionCount !== revised.conditionalExecutionCount}
          />
          <BeforeAfterRow
            label="총 투자 금액"
            before={krw(simulation.totalInvestmentKrw)}
            after={krw(revised.totalInvestmentKrw)}
            changed={simulation.totalInvestmentKrw !== revised.totalInvestmentKrw}
          />
        </div>
      </section>

      <AnalysisBody
        result={revised}
        companyName={plan.asset.displayName}
        priceCurrency={plan.asset.quoteCurrency}
        quote={quote}
        onRetryQuote={retryQuote}
        partialDataNotice={marketData?.completeness === "partial"}
        marketDataFetchedAt={marketData?.fetchedAt ?? ""}
        marketDataFallbackUsed={marketData?.fallbackUsed ?? false}
      />
    </AppScreen>
  );
}
