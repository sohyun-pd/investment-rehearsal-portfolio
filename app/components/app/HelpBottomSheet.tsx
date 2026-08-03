/**
 * 도움말 bottom sheet — 헤더 "?" 를 누르면 연다.
 *
 * 근거: 사용자 확정 — "투자 리허설"이 무엇을 확인해주고, 무엇은 하지 않는지(종목 추천·
 * 미래 예측·실제 주문 아님)를 서비스 사용법 수준에서 안내한다. 새 투자 방법 만들기와는
 * 역할이 다르다 — 이 sheet 는 어떤 대화 상태도 바꾸지 않는다(열고 닫아도 conversation·
 * currentFields·currentQuestion·plan/session 저장·진행 중 API 요청에 영향 없음).
 *
 * 접근성: dialog role · aria-modal · aria-labelledby, 열릴 때 sheet 내부로 포커스 이동,
 * 닫히면 "?" 버튼(triggerRef)으로 포커스 복귀, 열려 있는 동안 배경 스크롤 잠금, Tab 포커스는
 * sheet 안에서만 순환(focus trap), Esc 로 닫기.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";

const CHECK_ITEMS = [
  "조건이 발생한 시점",
  "매수 횟수와 투자 금액",
  "월 예산을 넘는 구간",
  "조건을 바꿨을 때 달라지는 결과",
];

const EXCLUDED_ITEMS = ["종목 추천", "미래 수익 예측", "실제 주문", "투자 성과 보장"];

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface HelpBottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** 닫힌 뒤 포커스를 되돌려줄 대상("?" 버튼). */
  triggerRef: React.RefObject<HTMLElement | null>;
}

export function HelpBottomSheet({ open, onClose, triggerRef }: HelpBottomSheetProps) {
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();

  React.useEffect(() => {
    if (!open) return;

    const sheet = sheetRef.current;
    const getFocusable = () => Array.from(sheet?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);

    const raf = window.requestAnimationFrame(() => {
      getFocusable()[0]?.focus();
    });

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = getFocusable();
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      triggerRef.current?.focus();
    };
  }, [open, onClose, triggerRef]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <div className="absolute inset-0 bg-text-primary/40" onClick={onClose} role="presentation" />
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[85vh] w-full max-w-[440px] flex-col rounded-t-2xl bg-bg"
      >
        <div className="shrink-0 px-5 pt-5">
          <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-border-strong" aria-hidden />
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-card text-text-primary">
              투자 리허설은 무엇을 확인하나요?
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="닫기"
              className="-mr-1.5 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-text-tertiary hover:bg-surface"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3">
          <p className="whitespace-pre-line text-body text-text-secondary">
            {"말로 설명한 투자 방법을 종목, 금액, 주기와 조건으로 정리하고,\n최근 1년 실제 가격에 적용해 매수 시점과 예산을 확인해요."}
          </p>

          <section className="mt-6">
            <h3 className="mb-2 text-caption font-medium text-text-tertiary">이런 걸 확인해요</h3>
            <ul className="space-y-2">
              {CHECK_ITEMS.map((item) => (
                <li key={item} className="flex items-start gap-2 text-body text-text-primary">
                  <span aria-hidden className="mt-0.5 shrink-0 text-text-tertiary">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-6">
            <h3 className="mb-2 text-caption font-medium text-text-tertiary">이런 기능은 없어요</h3>
            <ul className="space-y-2">
              {EXCLUDED_ITEMS.map((item) => (
                <li key={item} className="flex items-start gap-2 text-body text-text-secondary">
                  <span aria-hidden className="mt-0.5 shrink-0 text-text-tertiary">
                    –
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </section>

          <p className="mb-2 mt-6 whitespace-pre-line text-caption text-text-tertiary">
            {"실제 시장의 과거 가격을 기준으로\n투자 방법을 확인하는 기능이에요.\n\n현재 또는 미래의 투자 결과를 보장하지 않아요."}
          </p>
        </div>

        <div
          className="shrink-0 px-5 pt-4"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
        >
          <Button onClick={onClose}>알겠어요</Button>
        </div>
      </div>
    </div>
  );
}
