/**
 * "지금까지 정리한 계획" 바텀시트 — 두 가지 맥락에서 재사용한다.
 *
 * 1. 실시간 대화 중 최종 확인(§FlowProvider `readyToConfirm`) — "최근 1년 가격에 적용하기"가 Screen 3
 *    로 넘어가는 유일한 통로다(`advance_plan_ready`). 이 경우 계획은 이미 완성돼 있다.
 * 2. 새로고침 등으로 저장된 계획을 복구한 직후("restorePending") — 완성/미완성 모두 여기서
 *    시작한다. 미완성이면 "최근 1년 가격에 적용하기" 버튼 자체를 보여주지 않고, "새로 시작하기"로
 *    저장된 계획을 통째로 지울 수 있다.
 */
import { PlanCard } from "@/components/app/PlanCard";
import { Button } from "@/components/ui/button";
import { TextLink } from "@/components/app/AppScreen";
import type { AppPlan } from "@/types/appPlan";

interface PlanBottomSheetProps {
  open: boolean;
  plan: AppPlan;
  onConfirm: () => void;
  onDismiss: () => void;
  confirmDisabledReason?: string | null;
  /** false 면 "최근 1년 가격에 적용하기" 버튼을 아예 렌더하지 않는다(미완성 계획 복구 시). */
  showConfirmButton?: boolean;
  /** 지정하면 "계속 수정하기" 아래에 "새로 시작하기" 링크를 추가로 보여준다(복구 전용). */
  onStartOver?: () => void;
  /** ghost 버튼 문구 — 복구 중엔 "계속 수정하기"(미완성이면 이어서 질문), 완성된 계획을
   * 최종 확인할 때는 "계획 수정하기"(자연어 수정으로 진입)로 맥락에 맞게 바꾼다. */
  dismissLabel?: string;
  /** 시트 제목 — 복구 중엔 "지금까지 정리한 계획", 계획 생성이 막 끝난 최종 확인 시점에는
   * "이 계획으로 확인할까요?"로 맥락에 맞게 바꾼다. */
  title?: string;
  /** false 면 dimmed 배경을 눌러도 닫히지 않는다 — 계획 생성 완료 직후의 확인 시트는 반드시
   * "최근 1년 가격에 적용하기"/"계획 수정하기" 중 하나를 명시적으로 선택해야 한다(§사용자 확정 —
   * 배경을 탭했을 뿐인데 조용히 수정 모드로 들어가던 회귀를 고쳤다). 복구(restorePending)
   * 시트는 계속 기본값(true)을 쓴다 — 배경 탭이 "계속 수정하기"와 같은, 안전한 기본 동작이다. */
  dismissible?: boolean;
}

export function PlanBottomSheet({
  open,
  plan,
  onConfirm,
  onDismiss,
  confirmDisabledReason = null,
  showConfirmButton = true,
  onStartOver,
  dismissLabel = "계속 수정하기",
  title = "지금까지 정리한 계획",
  dismissible = true,
}: PlanBottomSheetProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-end justify-center">
      <div
        className="absolute inset-0 bg-text-primary/40"
        onClick={dismissible ? onDismiss : undefined}
        role="presentation"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative max-h-[80vh] w-full max-w-[440px] overflow-y-auto rounded-t-2xl bg-bg px-5 pt-5"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)" }}
      >
        <div className="mx-auto mb-4 h-1 w-10 shrink-0 rounded-full bg-border-strong" aria-hidden />

        <h2 className="mb-4 text-card text-text-primary">{title}</h2>

        <PlanCard plan={plan} />

        <div className="mt-5 space-y-2">
          {showConfirmButton ? (
            <Button onClick={onConfirm} disabled={confirmDisabledReason !== null}>
              {confirmDisabledReason ?? "최근 1년 가격에 적용하기"}
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onDismiss}>
            {dismissLabel}
          </Button>
          {onStartOver !== undefined ? (
            <div className="pt-1 text-center">
              <TextLink onClick={onStartOver}>새로 시작하기</TextLink>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
