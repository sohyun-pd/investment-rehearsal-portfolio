import { cn } from "@/lib/utils";

export type StepState = "done" | "active" | "pending";

export interface Step {
  label: string;
  state: StepState;
}

/**
 * 세로 진행 스텝퍼. 단순 스피너를 쓰지 않는다.
 * 현재 진행 단계에만 노란색(action)을 사용한다.
 */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        return (
          <li key={step.label} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-caption font-semibold",
                  step.state === "done" && "bg-action-soft text-action-text",
                  step.state === "active" && "bg-action text-action-text",
                  step.state === "pending" && "bg-surface-strong text-text-tertiary"
                )}
                aria-hidden
              >
                {step.state === "done" ? "✓" : i + 1}
              </span>
              {!isLast ? <span className="mt-1 h-6 w-px bg-border" /> : null}
            </div>
            <span
              className={cn(
                "pt-0.5 text-body",
                step.state === "pending" ? "text-text-tertiary" : "text-text-primary",
                step.state === "active" && "font-semibold"
              )}
            >
              {step.label}
              {step.state === "active" ? (
                <span className="ml-1 inline-flex gap-0.5 align-middle" aria-hidden>
                  <span className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary [animation-delay:-0.2s]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary [animation-delay:-0.1s]" />
                  <span className="h-1 w-1 animate-bounce rounded-full bg-text-tertiary" />
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
