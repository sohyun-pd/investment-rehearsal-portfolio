/**
 * "새 투자 방법 만들기" 확인 바텀시트 — 곧바로 지우지 않고 한 번 더 확인한다.
 *
 * `PlanBottomSheet`("지금까지 정리한 계획")와는 목적이 다르다 — 여기는 계획 내용을 보여주지
 * 않고, "정말 지울지"만 묻는다(§사용자 확정 — 진행 중 실수로 전부 잃는 걸 막는다).
 */
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/app/AppScreen";

interface StartOverConfirmSheetProps {
  open: boolean;
  onKeepEditing: () => void;
  onStartOver: () => void;
}

export function StartOverConfirmSheet({ open, onKeepEditing, onStartOver }: StartOverConfirmSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-text-primary/40"
        onClick={onKeepEditing}
        role="presentation"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="새로운 계획을 만들까요?"
        className="relative w-full max-w-[440px] rounded-t-2xl bg-bg px-5 pt-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 shrink-0 rounded-full bg-border-strong" aria-hidden />

        <h2 className="mb-2 text-card text-text-primary">새로운 계획을 만들까요?</h2>
        <p className="mb-5 text-body text-text-secondary">지금까지 입력한 투자 조건은 모두 지워져요.</p>

        <div className="space-y-2">
          <Button variant="secondary" onClick={onKeepEditing}>
            계속 작성하기
          </Button>
          <div className="pt-1 text-center">
            <TextLink onClick={onStartOver}>새로 시작하기</TextLink>
          </div>
        </div>
      </div>
    </div>
  );
}
