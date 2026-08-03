import { useState } from "react";
import { ScreenShell } from "@/components/ScreenShell";
import { CtaButton } from "@/components/CtaButton";
import { cn } from "@/lib/utils";
import { DEMO_DEFAULT_INPUT, DEMO_EXAMPLE_PROMPTS } from "@/fixtures/demo";

/** Screen 1. 투자 계획 입력 */
export function PlanInput() {
  const [value, setValue] = useState(DEMO_DEFAULT_INPUT);

  return (
    <ScreenShell
      title="어떤 투자 계획을 갖고 있나요?"
      subtitle="평소 생각하던 매수·매도 계획을 말하듯이 적어주세요."
      footer={
        <CtaButton to="/analyzing" disabled={value.trim().length === 0}>
          투자 조건으로 정리하기
        </CtaButton>
      }
    >
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-36 w-full resize-none rounded-md border border-border bg-bg px-4 py-3 text-body text-text-primary placeholder:text-text-tertiary focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-action-soft"
        placeholder="예) 애플을 매주 5만 원씩 사고, 3% 떨어지면 더 사고 싶어요."
      />

      <section className="space-y-3">
        <p className="text-caption text-text-secondary">이렇게 적어도 좋아요</p>
        {DEMO_EXAMPLE_PROMPTS.map((example) => {
          const selected = value.trim() === example;
          return (
            <button
              key={example}
              type="button"
              onClick={() => setValue(example)}
              className={cn(
                "w-full rounded-md border px-4 py-3 text-left text-body",
                selected
                  ? "border-action bg-action-soft text-text-primary"
                  : "border-border bg-surface text-text-secondary hover:bg-surface-strong"
              )}
            >
              {example}
            </button>
          );
        })}
      </section>

      <p className="text-caption text-text-secondary">
        이 서비스는 투자 추천이 아니라, 말해주신 계획을 조건으로 정리하는 도구예요.
      </p>
    </ScreenShell>
  );
}
