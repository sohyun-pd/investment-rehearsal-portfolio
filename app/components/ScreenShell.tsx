import * as React from "react";
import { cn } from "@/lib/utils";

interface ScreenShellProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /** 하단 고정 주 행동 영역(한 화면에 하나의 주 행동). */
  footer?: React.ReactNode;
  className?: string;
}

/** 화면 공통 레이아웃: 헤더 · 본문(세로 흐름) · 하단 고정 CTA. */
export function ScreenShell({ title, subtitle, children, footer, className }: ScreenShellProps) {
  return (
    <div className={cn("flex min-h-full flex-1 flex-col bg-bg", className)}>
      {/* Top content padding 24 / horizontal 20 */}
      <header className="px-5 pt-6 pb-4">
        <h1 className="text-page text-text-primary">{title}</h1>
        {subtitle ? <p className="mt-3 text-body text-text-secondary">{subtitle}</p> : null}
      </header>

      {/* Section gap 32 */}
      <main className="flex-1 space-y-8 px-5 pb-6">{children}</main>

      {footer ? (
        <footer
          className="sticky bottom-0 border-t border-border bg-bg px-5 pt-4"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}
        >
          {footer}
        </footer>
      ) : null}
    </div>
  );
}
