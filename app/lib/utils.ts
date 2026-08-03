import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge 는 이 프로젝트의 커스텀 @theme 토큰(font-size 스케일 · 시맨틱 텍스트 색상)을
 * 모른다 — 기본 설정에서는 `text-body`(폰트 크기)와 `text-action-text`(글자색)를 같은
 * "text color" 충돌 그룹으로 오인해, cn() 으로 두 클래스를 함께 넘기면 먼저 온 클래스를
 * 조용히 지워버린다(§실사용 회귀 — 전송 버튼 글자색이 흰색 대신 상속된 본문 색으로 보임).
 * 두 그룹을 명시적으로 분리해 이 문제를 근본적으로 막는다.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": ["text-display", "text-page", "text-section", "text-card", "text-body", "text-caption", "text-num"],
      "text-color": [
        "text-action-text",
        "text-text-primary",
        "text-text-secondary",
        "text-text-tertiary",
        "text-text-placeholder",
        "text-positive",
        "text-negative",
        "text-warning",
        "text-error",
        "text-success",
      ],
    },
  },
});

/** Tailwind 클래스 병합 유틸(shadcn 스타일). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
