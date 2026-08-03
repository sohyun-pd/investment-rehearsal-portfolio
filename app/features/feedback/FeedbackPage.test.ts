/**
 * FeedbackPage 의 진입 상태 분기(resolveInitialFeedbackPageState) 단위 테스트.
 *
 * 실행: npm run test:feedbackpage
 *
 * §사용자 확정 — navigate(-1) 에만 기대면 안 된다: 새로고침·직접 접근·히스토리 없는 새 탭은
 * 모두 simulation===null 로 귀결되고(§session/planStorage.ts, 계산 결과는 저장하지 않는다),
 * 그때는 이미 제출했는지 여부와 무관하게 "결과를 먼저 확인해주세요"가 최우선이어야 한다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveInitialFeedbackPageState } from "./FeedbackPage";

test("[회귀] 결과가 없으면(새로고침·직접 접근) 이미 제출했어도 no_result 가 최우선이다", () => {
  assert.equal(resolveInitialFeedbackPageState(false, true), "no_result");
  assert.equal(resolveInitialFeedbackPageState(false, false), "no_result");
});

test("결과가 있고 아직 제출하지 않았으면 form 이다", () => {
  assert.equal(resolveInitialFeedbackPageState(true, false), "form");
});

test("결과가 있고 이미 제출했으면 already_submitted 다", () => {
  assert.equal(resolveInitialFeedbackPageState(true, true), "already_submitted");
});
