/**
 * ScreenChat 순수 함수 단위 테스트 (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:screenchat
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveQuestionUiKind } from "./ScreenChat";
import type { PlanInterpretNextQuestion } from "@/types/planInterpret";

const QUESTION: PlanInterpretNextQuestion = {
  fieldPath: "guardrails.monthlyBudgetKrw",
  question: "월 최대 투자 예산을 정하시겠어요?",
  reason: "월별 지출 한도를 설정할지 확인이 필요합니다.",
  inputType: "select",
  required: false,
};

test("collecting 이 아니면 무조건 none 이다", () => {
  assert.equal(resolveQuestionUiKind(false, false, true, QUESTION), "none");
});

test("[회귀] 답변 직후(interpreting 중)에는 currentQuestion 이 아직 남아있어도 none 이다 — 이전 선택지가 화면에 남지 않는다", () => {
  // answer_field_start 는 interpretStatus 를 loading 으로 바꾸지만 currentQuestion 은
  // 다음 응답이 올 때까지 그대로 있다 — isInterpreting=true 를 여기서 직접 걸러야 한다.
  assert.equal(resolveQuestionUiKind(true, true, false, QUESTION), "none");
});

test("interpreting 이 끝나면(false) currentQuestion 이 있는 그대로 structured_question 을 보여준다", () => {
  assert.equal(resolveQuestionUiKind(true, false, false, QUESTION), "structured_question");
});

test("needsAssetSearch 가 true 면 currentQuestion 유무와 무관하게 asset_search 가 우선이다", () => {
  assert.equal(resolveQuestionUiKind(true, false, true, QUESTION), "asset_search");
  assert.equal(resolveQuestionUiKind(true, false, true, null), "asset_search");
});

test("아무 조건도 해당하지 않으면 none 이다", () => {
  assert.equal(resolveQuestionUiKind(true, false, false, null), "none");
});
