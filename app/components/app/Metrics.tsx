/**
 * 지표 표시 — 한 화면에 큰 숫자 하나 + 보조 지표.
 *
 * 근거: docs/product/DESIGN_SYSTEM.md 원칙 3 · Visual Direction
 *
 * 모든 값은 simulation result 에서 온다. 이 컴포넌트는 숫자를 만들지 않는다.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

/** 화면에서 가장 큰 숫자. 한 화면에 하나만 쓴다. */
export function MetricHero({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div>
      <p className="text-caption text-text-tertiary">{label}</p>
      <p className="tnum mt-1 text-display text-text-primary">{value}</p>
      {note ? <p className="mt-1.5 text-caption text-text-secondary">{note}</p> : null}
    </div>
  );
}

/** 보조 지표 행. 라벨 좌측 · 값 우측. */
export function MetricRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "muted";
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <span className="text-body text-text-secondary">{label}</span>
      <span
        className={cn(
          "tnum text-body font-medium",
          tone === "muted" ? "text-text-tertiary" : "text-text-primary"
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function MetricList({ children }: { children: React.ReactNode }) {
  return <div className="divide-y divide-border">{children}</div>;
}

/**
 * 비교 행 — 값 여러 개를 한 행에서 비교한다(3열 표 대신).
 * 근거: 자사 UX Baseline 의 "수익률 비교" 목록형 비교.
 */
export function ComparisonRow({
  label,
  values,
  highlightIndex,
}: {
  label: string;
  values: string[];
  highlightIndex?: number;
}) {
  return (
    <div className="py-3">
      <p className="text-caption text-text-tertiary">{label}</p>
      <div className="mt-1.5 flex items-baseline justify-between gap-2">
        {values.map((value, index) => (
          <span
            key={`${label}-${index}`}
            className={cn(
              "tnum flex-1 text-body",
              index === 0 ? "text-left" : index === values.length - 1 ? "text-right" : "text-center",
              highlightIndex === index ? "font-semibold text-text-primary" : "text-text-secondary"
            )}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 변경 전 → 후 한 줄. Screen 4-R 비교 요약용. */
export function BeforeAfterRow({
  label,
  before,
  after,
  changed,
}: {
  label: string;
  before: string;
  after: string;
  changed: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-body text-text-secondary">{label}</span>
      <span className="flex items-baseline gap-2">
        <span className="tnum text-body text-text-tertiary line-through">{before}</span>
        <span aria-hidden className="text-caption text-text-tertiary">
          →
        </span>
        <span
          className={cn(
            "tnum text-body font-semibold",
            changed ? "text-text-primary" : "text-text-secondary"
          )}
        >
          {after}
        </span>
      </span>
    </div>
  );
}
