import { ScreenShell } from "@/components/ScreenShell";
import { CtaButton } from "@/components/CtaButton";
import { Card, CardContent } from "@/components/ui/card";
import { DEMO_CLARIFY_HINTS, DEMO_STRATEGY_NEEDS_CLARIFY } from "@/fixtures/demo";

/** Screen 3. 누락 조건 확인 (숫자를 임의로 만들지 않고 한 질문씩 묻는다) */
export function Clarify() {
  const { clarificationQuestions } = DEMO_STRATEGY_NEEDS_CLARIFY;

  return (
    <ScreenShell
      title="실행하려면 평균 매수가가 필요해요"
      subtitle="말해주신 계획만으로는 정할 수 없는 값이라, 지어내지 않고 여쭤봐요."
      footer={<CtaButton to="/review">빠진 조건 입력하기</CtaButton>}
    >
      {clarificationQuestions.map((q) => {
        const hint = DEMO_CLARIFY_HINTS[q.id];
        return (
          <Card key={q.id}>
            <CardContent>
              <label htmlFor={q.id} className="block text-card text-text-primary">
                {q.question}
              </label>
              <div className="mt-3 flex items-center gap-2">
                <input
                  id={q.id}
                  type={q.inputType === "number" ? "number" : "text"}
                  inputMode={q.inputType === "number" ? "decimal" : undefined}
                  placeholder={hint?.placeholder}
                  className="tnum h-13 w-full rounded-md border border-border bg-bg px-4 text-body text-text-primary placeholder:text-text-tertiary focus:border-border-strong focus:outline-none focus:ring-2 focus:ring-action-soft"
                />
                {q.unit ? (
                  <span className="shrink-0 text-body font-medium text-text-secondary">{q.unit}</span>
                ) : null}
              </div>
              {hint?.helper ? (
                <p className="mt-2 text-caption text-text-secondary">{hint.helper}</p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </ScreenShell>
  );
}
