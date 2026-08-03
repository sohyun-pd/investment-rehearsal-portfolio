/**
 * 계획 확인 화면의 개별 필드 수정 시트 — 공통 셸.
 *
 * 근거: 사용자 확정 — PlanCard 의 "수정" 버튼들이 전부 종목 검색으로 이어지던 회귀를 고치며,
 * 종목 이외 항목(정기 매수·조건부 매수·월 예산)은 각자 전용 화면을 열어야 한다. 형태(제목 +
 * 내용 + "변경 내용 적용하기"/"취소")는 공통이라 셸만 공유하고, 필드별 입력 UI는 호출부
 * (children)가 채운다.
 */
import { Button } from "@/components/ui/button";

interface FieldEditSheetProps {
  open: boolean;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
  confirmDisabled?: boolean;
  confirmLabel?: string;
  children: React.ReactNode;
}

export function FieldEditSheet({
  open,
  title,
  onCancel,
  onConfirm,
  confirmDisabled = false,
  confirmLabel = "변경 내용 적용하기",
  children,
}: FieldEditSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <div className="absolute inset-0 bg-text-primary/40" onClick={onCancel} role="presentation" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-[440px] rounded-t-2xl bg-bg px-5 pt-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 shrink-0 rounded-full bg-border-strong" aria-hidden />
        <h2 className="mb-4 text-card text-text-primary">{title}</h2>
        <div className="mb-5">{children}</div>
        <div className="space-y-2">
          <Button onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            취소
          </Button>
        </div>
      </div>
    </div>
  );
}
