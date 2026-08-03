/**
 * 화면 공통 셸 — 상단 헤더 · 본문 · 하단 고정 CTA.
 *
 * 근거: docs/product/DESIGN_SYSTEM.md (한 화면에 primary CTA 하나, 넓은 여백, 흰 배경)
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { TOTAL_STEPS } from "@/flow/appFlowState";

interface AppHeaderProps {
  /** 뒤로가기. 없으면 버튼을 숨긴다. */
  onBack?: (() => void) | undefined;
  title?: string | undefined;
  step?: number | null | undefined;
  /** 전체 단계 수 — 기본값은 TOTAL_STEPS(5) 다. 예산 초과가 없어 비교(5단계)로 이어지지 않는
   * 결과 화면은 4 를 넘겨 "4/4"로 보여준다(§사용자 확정 — 존재하지 않는 다음 단계를 약속하지
   * 않는다). */
  totalSteps?: number;
  right?: React.ReactNode;
  /** 뒤로가기 버튼의 aria-label. 화면마다 의미가 다르면(예: "이전 질문으로 돌아가기") 넘긴다. */
  backLabel?: string;
}

export function AppHeader({ onBack, title, step, totalSteps = TOTAL_STEPS, right, backLabel = "뒤로" }: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg">
      <div className="flex h-14 items-center gap-2 px-3">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label={backLabel}
            className="-ml-1 flex h-11 w-11 items-center justify-center rounded-full text-text-primary hover:bg-surface active:bg-surface-strong"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path
                d="M12.5 4L6.5 10l6 6"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : (
          <span className="h-11 w-11" aria-hidden />
        )}

        <div className="min-w-0 flex-1 text-center">
          {title ? (
            <p className="truncate text-card text-text-primary">{title}</p>
          ) : null}
        </div>

        <div className="flex h-11 min-w-11 items-center justify-end pr-1">
          {right ?? (step != null ? (
            <span className="tnum text-caption text-text-tertiary">
              {step}/{totalSteps}
            </span>
          ) : null)}
        </div>
      </div>
    </header>
  );
}

interface AppScreenProps {
  header?: React.ReactNode;
  children: React.ReactNode;
  /** 하단 고정 영역. 화면당 primary CTA 하나. */
  footer?: React.ReactNode;
  className?: string;
  /** true 면 본문(main)이 자체 스크롤 영역이 된다(채팅형 화면 전용) — 문서 스크롤 대신
   * main 안에서만 스크롤해, header/footer 는 항상 같은 자리에 남는다. 다른 화면은 기존과
   * 동일하게 문서 스크롤을 그대로 쓴다(생략 시 기본값 false, 시각적으로 이전과 동일). */
  scrollable?: boolean;
  /** `scrollable` 일 때 실제 스크롤 컨테이너(main) DOM 노드를 넘겨받는다(자동 스크롤 제어용). */
  onMainRef?: (el: HTMLElement | null) => void;
}

/** 문서 스크롤 모드(!scrollable)에서는 footer 가 `sticky bottom-0`이라, main 이 문서 흐름상
 * footer 의 실제 자리에 도달하기 전까지 footer 가 화면 아래쪽에 떠서 main 의 마지막 내용
 * 위에 겹쳐 보인다(§사용자 확정 — "하단 안내가 고정 CTA에 가려짐"). footer 는 버튼 개수·안내
 * 문구 유무에 따라 높이가 달라지므로 고정 padding 으로는 못 맞춘다 — 실제 렌더된 높이를
 * ResizeObserver 로 재서 main 의 padding-bottom 에 그대로 반영한다(+24px 여유). */
const EXTRA_BOTTOM_GAP_PX = 24;

export function AppScreen({ header, children, footer, className, scrollable = false, onMainRef }: AppScreenProps) {
  const footerRef = React.useRef<HTMLElement | null>(null);
  const [footerHeight, setFooterHeight] = React.useState(0);

  React.useEffect(() => {
    if (footer === undefined || footer === null || scrollable) {
      setFooterHeight(0);
      return;
    }
    const node = footerRef.current;
    if (node === null) return;

    // offsetHeight 는 padding·border 를 포함한 실제 렌더 높이라, footer 자체의
    // safe-area-inset-bottom 여백까지 그대로 잡힌다(ResizeObserver 의 기본 contentRect 는
    // padding 을 빼므로 여기선 쓰지 않는다).
    const updateHeight = () => setFooterHeight(node.offsetHeight);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [footer, scrollable]);

  return (
    <div
      className={cn(
        "flex flex-col bg-bg",
        // flex-1 은 flex-basis:0% 를 강제해 명시적 height 를 무시하게 만든다(flex-grow 로 채워
        // 버려 100dvh 클리핑이 무력화됨) — scrollable 모드에서는 flex-1 을 빼고 h-[100dvh] 가
        // 실제 크기로 적용되게 한다. 일반 모드는 기존 그대로 flex-1 로 부모를 채운다.
        scrollable ? "h-[100dvh] min-h-0 overflow-hidden" : "min-h-full flex-1"
      )}
    >
      {header}
      <main
        ref={onMainRef}
        className={cn(
          scrollable ? "min-h-0 flex-1 overflow-y-auto overscroll-contain" : "flex-1",
          "px-5 pt-6",
          // footer 가 있는 문서 스크롤 화면만 실측 높이로 인라인 padding 을 준다 — 나머지는
          // 기존 그대로 고정 pb-8.
          !scrollable && footer ? undefined : "pb-8",
          className
        )}
        style={!scrollable && footer ? { paddingBottom: `${footerHeight + EXTRA_BOTTOM_GAP_PX}px` } : undefined}
      >
        {children}
      </main>
      {footer ? (
        <footer
          ref={footerRef}
          className={cn(!scrollable && "sticky bottom-0", "border-t border-border bg-bg px-5 pt-4")}
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
        >
          {footer}
        </footer>
      ) : null}
    </div>
  );
}

/** 화면 제목(본문 최상단). 헤더 타이틀과 달리 크게 쓴다. */
export function ScreenTitle({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-page text-text-primary">{children}</h1>
      {sub ? <p className="mt-3 whitespace-pre-line text-body text-text-secondary">{sub}</p> : null}
    </div>
  );
}

/** 섹션 제목 + 우측 기준 라벨(계산 기준을 숨기지 않는다). */
export function SectionHeading({
  children,
  basis,
}: {
  children: React.ReactNode;
  basis?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-card text-text-primary">{children}</h2>
      {basis ? <span className="shrink-0 text-caption text-text-tertiary">{basis}</span> : null}
    </div>
  );
}

/** 보조 행동은 텍스트 링크로 낮춘다(주 CTA 와 경쟁시키지 않는다). */
export function TextLink({
  onClick,
  children,
  className,
}: {
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-h-11 text-body font-medium text-text-secondary underline underline-offset-4 hover:text-text-primary",
        className
      )}
    >
      {children}
    </button>
  );
}
