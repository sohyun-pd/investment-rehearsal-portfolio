/**
 * AI 계획 해석 provider 선택 — 시장 데이터와 같은 패턴(`@/config/marketDataMode`).
 *
 * `VITE_USE_MOCK_AI=true` 일 때만 오프라인 데모 질문 흐름(`app/mocks/planInterpret.ts`)을
 * 쓴다. 기본값은 false(실제 Claude 호출). API 실패가 이 값을 자동으로 켜지 않는다.
 * 배포 환경에서는 이 플래그를 설정하지 않는다.
 */
export function isMockAiEnabled(): boolean {
  return import.meta.env.VITE_USE_MOCK_AI === "true";
}
