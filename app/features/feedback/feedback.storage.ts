/**
 * 같은 세션에서 설문을 반복 제출하지 않도록 하는 최소 중복 방지 — sessionId 수준으로만
 * 쓴다. localStorage 만으로 영구적인 사용자 식별을 시도하지 않는다(§사용자 확정).
 */
const KEY_PREFIX = "feedback_submitted_";

export function hasSubmittedFeedback(sessionId: string): boolean {
  try {
    return localStorage.getItem(`${KEY_PREFIX}${sessionId}`) === "true";
  } catch {
    return false;
  }
}

export function markFeedbackSubmitted(sessionId: string): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${sessionId}`, "true");
  } catch {
    // localStorage 를 못 쓰는 환경(사생활 보호 모드 등)이면 조용히 넘어간다 — 중복 방지는
    // best-effort 이지 핵심 기능이 아니다.
  }
}
