/**
 * 로딩 · 빈 상태 · 오류 상태 골격.
 *
 * 근거: docs/product/SCREEN_SPEC_V1.md (각 화면의 Loading/Empty/Error State)
 *
 * 원칙:
 *  - 로딩은 **무엇을 기다리는지** 말한다.
 *  - 오류는 사유와 **재시도 가능 여부**를 함께 보여준다.
 *  - 부분 실패를 전체 실패로 만들지 않는다.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FlowError } from "@/flow/appFlowState";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-surface-strong", className)} aria-hidden />;
}

/** 단계별 로딩. 지금 어느 단계인지 표시한다. */
export function LoadingSteps({ steps, activeIndex }: { steps: string[]; activeIndex: number }) {
  return (
    <ul className="space-y-3" aria-live="polite">
      {steps.map((label, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <li key={label} className="flex items-center gap-3">
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border",
                done && "border-transparent bg-text-primary",
                active && "border-transparent bg-action",
                !done && !active && "border-border bg-bg"
              )}
              aria-hidden
            >
              {done ? (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path
                    d="M2.5 6.2l2.4 2.4L9.5 4"
                    stroke="#ffffff"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : active ? (
                <span className="h-2 w-2 animate-pulse rounded-full bg-action-text" />
              ) : null}
            </span>
            <span
              className={cn(
                "text-body",
                active ? "text-text-primary" : done ? "text-text-secondary" : "text-text-tertiary"
              )}
            >
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** 결과 화면 skeleton — 결론 1줄 + 지표 + 차트 자리. */
export function AnalysisSkeleton() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-7 w-4/5" />
        <Skeleton className="h-7 w-3/5" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-9 w-48" />
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

/** 빈 상태 — 값이 없다는 사실과 그 의미를 함께 말한다. */
export function EmptyBlock({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-surface px-5 py-6">
      <p className="text-card text-text-primary">{title}</p>
      {description ? (
        <p className="mt-2 text-body text-text-secondary">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** 오류 블록. `retryable` 이면 재시도 버튼을, 아니면 대체 경로를 노출한다. */
export function ErrorBlock({
  error,
  onRetry,
  secondary,
}: {
  error: FlowError;
  onRetry?: () => void;
  secondary?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-5 py-6" role="alert">
      <p className="text-card text-text-primary">{error.userMessage}</p>
      <p className="mt-2 text-caption text-text-tertiary">
        {error.retryable
          ? "잠시 후 다시 시도할 수 있어요."
          : "다시 시도해도 같은 결과가 나와요. 조건을 확인해 주세요."}
      </p>
      <div className="mt-4 space-y-2">
        {error.retryable && onRetry ? (
          <Button variant="secondary" size="md" onClick={onRetry}>
            다시 시도
          </Button>
        ) : null}
        {secondary}
      </div>
    </div>
  );
}

/** ⓘ 한 줄 안내 — 계산 기준·한계를 결과 옆에 둔다. */
export function NoticeLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 text-caption text-text-secondary">
      <span aria-hidden className="shrink-0">
        ⓘ
      </span>
      <span>{children}</span>
    </p>
  );
}

/** AI 가 쓴 문장임을 표시하는 배지. 항상 기준 시각과 함께 쓴다. 결과의 예산 초과 여부·횟수·
 * 금액은 deterministic replay engine 이 계산한 값이라 이 배지를 붙이지 않는다 — 이 배지는
 * 별도로 로드되는 AI 자연어 설명에만 붙는다(§사용자 확정 — "AI 해석"이 결과 제목에 붙어
 * 전체가 AI 계산처럼 보이던 문제). */
export function AiBadge({ basis }: { basis?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-flex items-center gap-1 rounded-full bg-action-soft px-2.5 py-1 text-caption font-medium text-action-text">
        <span aria-hidden>✦</span> 똑대리 해석
      </span>
      {basis ? <span className="text-caption text-text-tertiary">{basis}</span> : null}
    </span>
  );
}
