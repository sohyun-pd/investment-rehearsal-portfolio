import * as React from "react";
import { cn } from "@/lib/utils";

// 상태 전달 전용(장식 금지). radius full.
type Tone = "neutral" | "info" | "delayed" | "error";

const toneClass: Record<Tone, string> = {
  neutral: "bg-surface-strong text-text-secondary",
  info: "bg-action-soft text-action-text", // AI가 정리한 조건 / 모의 전략 등 (노랑 계열)
  delayed: "bg-surface-strong text-warning",
  error: "bg-surface-strong text-error",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-caption font-medium",
        toneClass[tone],
        className
      )}
      {...props}
    />
  );
}
