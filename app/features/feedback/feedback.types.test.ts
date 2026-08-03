/**
 * feedback.types.ts 단위 테스트.
 *
 * 실행: npm run test:feedbacktypes
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyFeedbackDraft, isFeedbackDraftComplete } from "./feedback.types";

test("emptyFeedbackDraft 는 모든 필수 문항이 null 이라 완성되지 않은 상태다", () => {
  assert.equal(isFeedbackDraftComplete(emptyFeedbackDraft()), false);
});

test("[회귀] 자유 의견(7번)은 선택이라 비어 있어도 나머지 6개 문항만 채우면 완성된 것으로 본다", () => {
  const draft = {
    ...emptyFeedbackDraft(),
    investmentExperience: "1_to_3_years" as const,
    productUnderstanding: "historical_rehearsal" as const,
    reachedResult: true,
    hardestStep: "conditional_rule" as const,
    resultComprehensionScore: 4 as const,
    orderCapabilityUnderstanding: "no" as const,
  };
  assert.equal(draft.openFeedback, "", "자유 의견은 여전히 빈 문자열이어야 한다");
  assert.equal(isFeedbackDraftComplete(draft), true);
});

test("필수 문항이 하나라도 비어 있으면 완성되지 않은 것으로 본다", () => {
  const almostComplete = {
    ...emptyFeedbackDraft(),
    investmentExperience: "none" as const,
    productUnderstanding: "unknown" as const,
    reachedResult: false,
    hardestStep: "result" as const,
    resultComprehensionScore: 2 as const,
    // orderCapabilityUnderstanding 만 비워 둔다.
  };
  assert.equal(isFeedbackDraftComplete(almostComplete), false);
});

test("reachedResult 는 boolean 이라 false 도 유효한 응답이다(누락과 구분한다)", () => {
  const draft = {
    ...emptyFeedbackDraft(),
    investmentExperience: "none" as const,
    productUnderstanding: "unknown" as const,
    reachedResult: false,
    hardestStep: "none" as const,
    resultComprehensionScore: 1 as const,
    orderCapabilityUnderstanding: "unknown" as const,
  };
  assert.equal(isFeedbackDraftComplete(draft), true, "reachedResult=false 는 미응답이 아니라 정상 응답이어야 한다");
});
