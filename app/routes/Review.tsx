import { ScreenShell } from "@/components/ScreenShell";
import { CtaButton } from "@/components/CtaButton";
import { QuoteCard } from "@/components/QuoteCard";
import { ConditionCard } from "@/components/ConditionCard";
import { DemoDataNote } from "@/components/DemoDataNote";
import { Badge } from "@/components/ui/badge";
import { DEMO_STRATEGY_READY } from "@/fixtures/demo";

/** Screen 4. 전략 검토 및 수정 */
export function Review() {
  const strategy = DEMO_STRATEGY_READY;

  return (
    <ScreenShell
      title="이렇게 이해했어요"
      subtitle="다르게 생각한 부분이 있다면 숫자를 눌러 바로 바꿀 수 있어요."
      footer={<CtaButton to="/confirm">이 조건으로 확인하기</CtaButton>}
    >
      {strategy.marketData ? <QuoteCard data={strategy.marketData} /> : null}

      <section className="space-y-3">
        <Badge tone="info">AI가 정리한 조건</Badge>
        {strategy.conditions.map((condition) => (
          <ConditionCard key={condition.id} condition={condition} editable />
        ))}
      </section>

      <div className="space-y-3">
        <p className="text-caption text-text-secondary">
          이 조건으로 정기 매수와 추가 매수 주문이 만들어져요. 실제 주문은 실행되지 않아요.
        </p>
        <DemoDataNote />
      </div>
    </ScreenShell>
  );
}
