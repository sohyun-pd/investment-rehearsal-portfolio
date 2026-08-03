/**
 * 범용 바텀시트 — 결과 화면의 "조건 바꿔 다시 확인하기"가 계기였다(§사용자 확정 — 클릭해도
 * 페이지 맨 아래에 폼이 조용히 삽입될 뿐이라 스크롤·포커스 이동이 없어 버튼이 고장 난 것처럼
 * 보였다). 기존 PlanBottomSheet/StartOverConfirmSheet 는 진짜 focus trap·스크롤 잠금·ESC·
 * 모바일 뒤로가기 처리가 없었다 — 그 둘은 그대로 두고, 이 컴포넌트만 새로 만든다.
 *
 * 처리하는 것:
 *  - 열릴 때 body 스크롤 잠금, 시트 안 첫 포커스 가능한 요소로 자동 포커스.
 *  - 닫힐 때 스크롤 잠금 해제, 원래 포커스(예: CTA 버튼)로 복귀.
 *  - Tab/Shift+Tab 이 시트 밖으로 나가지 않게 순환한다(focus trap).
 *  - ESC · 배경 클릭 · 모바일 "뒤로가기" 를 모두 같은 취소로 처리한다(`dismissible=false` 면
 *    셋 다 무시 — 제출 중 임의로 닫히지 않게 한다).
 *  - "뒤로가기"는 실제 URL 을 바꾸지 않는 가상 history entry 하나로 가로챈다 — 시트를 다른
 *    방식(버튼·배경·ESC)으로 닫으면 그 entry 를 되돌려 놓아 history 가 어긋나지 않게 한다.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  titleId: string;
  title: React.ReactNode;
  children: React.ReactNode;
  /** false 면 ESC·배경 클릭·뒤로가기로 닫히지 않는다(제출 중). 기본값 true. */
  dismissible?: boolean;
  className?: string;
}

const FOCUSABLE_SELECTOR = 'textarea, input, button, [tabindex]:not([tabindex="-1"])';

export function BottomSheet({
  open,
  onClose,
  titleId,
  title,
  children,
  dismissible = true,
  className,
}: BottomSheetProps) {
  const sheetRef = React.useRef<HTMLDivElement>(null);
  const previouslyFocusedRef = React.useRef<HTMLElement | null>(null);

  // onClose·dismissible 을 ref 로 들고 있는 이유: 호출부(ReviseRequestPanel 의 `close`)는
  // 렌더마다 새 함수 참조를 만든다(useCallback 없이 인라인 정의) — 이 값들을 그대로 effect
  // dependency 에 넣으면 textarea 에 한 글자만 쳐도(부모가 리렌더될 때마다) history/popstate
  // effect 가 매번 정리·재실행된다. 그 정리(cleanup)가 history.back() 을 부르는데, 이게 비동기로
  // popstate 를 발생시켜(§실제로 재현한 버그 — 시트가 열리자마자 아주 잠깐 보였다가 스스로
  // 닫혔다) 시트가 열리자마자 저절로 닫혀 버렸다. ref 로 최신값만 읽으면 이 effect 는 `open`
  // 이 바뀔 때만 실행된다.
  const latestRef = React.useRef({ onClose, dismissible });
  React.useEffect(() => {
    latestRef.current = { onClose, dismissible };
  });

  React.useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const raf = requestAnimationFrame(() => {
      // textarea 가 있으면 그걸 우선 포커스한다(예시 chip 버튼이 textarea 보다 앞에 있어도
      // "입력창 자동 포커스"가 실제 목표이지 "첫 번째 포커스 가능한 요소"가 목표가 아니다).
      const textarea = sheetRef.current?.querySelector<HTMLElement>("textarea");
      (textarea ?? sheetRef.current?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR))?.focus();
    });

    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, [open]);

  React.useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (latestRef.current.dismissible) latestRef.current.onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = sheetRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (focusables === undefined || focusables.length === 0) return;
      const list = Array.from(focusables).filter((el) => !el.hasAttribute("disabled"));
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // React.StrictMode(개발 모드)는 effect 를 "마운트 → cleanup → 다시 마운트"로 한 번 더
  // 검증 삼아 즉시 재실행한다 — 부수효과가 없는 순수한 구독이면 문제없지만, 여기서는 cleanup
  // 이 실제 history.back() 이라는 진짜 부수효과를 부른다. 그대로 두면: 1차 mount(push) → 1차
  // cleanup(back 예약) → 2차 mount(같은 open=true, push) 순으로 동기적으로 실행된 뒤, 예약해
  // 둔 back() 이 비동기로 실제 발동해 "방금 진짜로 닫힌 것"처럼 popstate 가 발생하고, 그 시점에
  // 붙어 있던(2차 mount 의) 리스너가 이걸 "사용자가 뒤로가기를 눌렀다"고 오인해 시트를 실제로
  // 닫아 버린다(§실제로 재현한 버그 — 시트가 열리자마자 아주 잠깐 보였다가 스스로 닫혔다).
  // back() 을 다음 tick 으로 미뤄 두고, 그 사이 effect 가 같은 open=true 로 다시 실행되면
  // (StrictMode 의 가짜 재마운트 신호) 예약을 취소한다 — 진짜 언마운트/닫힘이면 아무도 취소하지
  // 않으니 그대로 실행된다.
  const pendingBackRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    if (!open) return;

    if (pendingBackRef.current !== null) {
      clearTimeout(pendingBackRef.current);
      pendingBackRef.current = null;
    } else {
      window.history.pushState({ bottomSheet: true }, "");
    }

    let poppedByUser = false;
    function handlePopState() {
      if (!latestRef.current.dismissible) {
        // 제출 중에는 뒤로가기로도 닫히지 않는다 — 가로챈 entry 를 즉시 다시 넣어 계속 막는다.
        window.history.pushState({ bottomSheet: true }, "");
        return;
      }
      poppedByUser = true;
      latestRef.current.onClose();
    }

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      if (!poppedByUser) {
        pendingBackRef.current = setTimeout(() => {
          pendingBackRef.current = null;
          window.history.back();
        }, 0);
      }
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-text-primary/40"
        onClick={dismissible ? onClose : undefined}
        role="presentation"
      />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative max-h-[85vh] w-full max-w-[440px] overflow-y-auto rounded-t-2xl bg-bg px-5 pt-5",
          className
        )}
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 shrink-0 rounded-full bg-border-strong" aria-hidden />
        <h2 id={titleId} className="mb-1 text-card text-text-primary">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
