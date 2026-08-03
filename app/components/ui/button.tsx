import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost";
type Size = "lg" | "md" | "sm";

const variantClass: Record<Variant, string> = {
  // 블루 액션 + 흰 텍스트 (그림자·그라데이션 없음)
  primary:
    "bg-action text-action-text hover:bg-action-hover active:bg-action-pressed disabled:bg-surface disabled:text-text-tertiary",
  secondary:
    "bg-surface text-text-primary border border-border hover:bg-surface-strong active:bg-surface-strong disabled:text-text-tertiary",
  ghost: "bg-transparent text-text-secondary hover:bg-surface active:bg-surface-strong",
};

const sizeClass: Record<Size, string> = {
  lg: "h-14 px-5 text-body font-semibold", // 56px, 주요 CTA
  md: "h-12 px-5 text-body font-semibold", // 48px, secondary
  sm: "h-11 px-3 text-caption font-medium", // 44px(최소 터치)
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "lg", loading = false, type = "button", children, disabled, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex w-full items-center justify-center rounded-button transition-[transform,background-color] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong disabled:cursor-not-allowed disabled:active:scale-100",
        variantClass[variant],
        sizeClass[size],
        className
      )}
      {...props}
    >
      {loading ? (
        <span
          className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
          aria-hidden
        />
      ) : (
        children
      )}
    </button>
  );
});
