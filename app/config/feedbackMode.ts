/**
 * 사용성 피드백 설문 기능 플래그 — 단 하나의 명시적 스위치.
 *
 * `VITE_ENABLE_FEEDBACK=true` 일 때만 결과 화면에 "사용성 피드백 남기기" 버튼을 보여주고
 * `/feedback` route 접근을 허용한다. 기본값은 false — 설문 UI 자체가 완성되지 않았거나
 * 검증되지 않은 배포에서는 절대 노출하지 않는다(§사용자 확정 — 눌러도 아무 일도 없거나
 * 실제로 존재하지 않는 화면으로 보내는 버튼을 만들지 않는다).
 */
let hasLoggedEffectiveValue = false;

export function isFeedbackEnabled(): boolean {
  const enabled = import.meta.env.VITE_ENABLE_FEEDBACK === "true";

  // 어느 환경(로컬 dev, .env 파일이 바뀌기 전부터 떠 있던 오래된 dev server, 실제 배포)에서
  // CTA 가 보였는지 헷갈릴 때 콘솔로 바로 확인할 수 있게, 실제 적용된 값을 딱 한 번만 찍는다
  // (§사용자 확정 — 수동 테스트에서 CTA 가 보였는데 .env.local 은 false 였던 사고 재발 방지).
  // import.meta.env 접근은 이 함수가 실제로 호출될 때만 일어난다 — 모듈 최상단에서 바로
  // 접근하면 Vite 런타임이 없는 Node 테스트 러너(tsx --test)에서 import 만 해도 죽는다
  // (§회귀 — Screen4Analysis.test.ts 가 이 모듈을 간접 import 하는 것만으로 깨졌었다).
  // 민감한 값(endpoint·토큰)은 절대 여기서 찍지 않는다 — boolean 하나뿐이다.
  if (!hasLoggedEffectiveValue) {
    hasLoggedEffectiveValue = true;
    console.log(`[feedback] enabled=${enabled}`);
  }

  return enabled;
}

