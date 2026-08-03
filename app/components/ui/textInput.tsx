/**
 * 폼 입력 공통 atom — TextInput · FieldMessage · Spinner.
 *
 * 근거: 사용자 확정 — 종목 검색 화면 전용 스타일을 페이지 안에 흩어놓지 않고, 상태(기본·focus·
 * 오류·경고)마다 색상을 새로 만들지 않는다. 지금은 종목 검색(StockSearchField)에서만 쓰지만
 * 이름·스타일 모두 특정 화면에 묶여 있지 않아 다른 입력 폼에도 그대로 재사용할 수 있다.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export type FieldTone = "default" | "error" | "warning";

const RING_CLASS_BY_TONE: Record<FieldTone, string> = {
  default: "border-border focus-visible:border-border-focus focus-visible:ring-border-focus/12",
  error: "border-error focus-visible:border-error focus-visible:ring-error/12",
  warning: "border-warning focus-visible:border-warning focus-visible:ring-warning/12",
};

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  tone?: FieldTone;
  /** 오른쪽에 스피너·아이콘 등을 겹쳐 보여줄 때 쓴다(레이아웃 크기는 바뀌지 않는다). */
  endAdornment?: React.ReactNode;
}

export const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { className, tone = "default", endAdornment, ...props },
  ref
) {
  return (
    <div className="relative">
      <input
        ref={ref}
        className={cn(
          "h-14 w-full rounded-input border bg-bg px-4 text-body text-text-primary placeholder:text-text-placeholder",
          "outline-none transition-colors focus-visible:ring-[3px]",
          RING_CLASS_BY_TONE[tone],
          endAdornment ? "pr-11" : undefined,
          className
        )}
        {...props}
      />
      {endAdornment ? (
        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center">{endAdornment}</div>
      ) : null}
    </div>
  );
});

export interface FieldMessageProps {
  tone: FieldTone;
  children: React.ReactNode;
  id?: string;
  /** invalid/error 는 즉시 알려야 하는 오류라 role="alert", 결과 없음 같은 안내는 polite. */
  live?: "polite" | "assertive" | "off";
}

const MESSAGE_COLOR_BY_TONE: Record<FieldTone, string> = {
  default: "text-text-secondary",
  error: "text-error",
  warning: "text-warning",
};

export function FieldMessage({ tone, children, id, live = "polite" }: FieldMessageProps) {
  return (
    <p
      id={id}
      role={tone === "error" ? "alert" : undefined}
      aria-live={tone === "error" ? undefined : live}
      className={cn("mt-2 text-caption leading-[1.5]", MESSAGE_COLOR_BY_TONE[tone])}
    >
      {children}
    </p>
  );
}

/** 버튼의 `loading` prop 과 같은 시각 문법(회전하는 원 4분의 3) — 입력창 오른쪽 등 버튼이 아닌
 * 자리에서도 같은 스피너가 필요해 별도로 뺐다. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "block h-4 w-4 animate-spin rounded-full border-2 border-text-tertiary border-t-transparent",
        className
      )}
      aria-hidden
    />
  );
}
