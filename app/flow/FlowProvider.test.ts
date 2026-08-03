/**
 * FlowProvider 리듀서 단위 테스트 (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:flow
 *
 * 재발했던 회귀: 종목이 아직 확정되지 않았는데 AI 의 다음 질문(예: 월 예산)이 대화 로그에
 * 먼저 나타나 버려서, 채팅은 "다음 질문으로 넘어간 것"처럼 보이는데 입력 UI 는 여전히
 * 종목 검색을 요구하는 모순이 생겼다. 종목 확정 전까지는 다음 질문을 대화 로그에 알리지
 * 않고, 확정되는 순간 이어서 보여줘야 한다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  applyFieldAnswer,
  applyReviseChanges,
  initialState,
  planToInterpretFields,
  reducer,
  type Action,
  type FlowState,
} from "./FlowProvider";
import { emptyPlan } from "@/types/appPlan";
import { emptyPlanInterpretFields } from "@/types/planInterpret";
import type { PlanReviseResponse, ReviseFieldChange } from "@/types/planRevise";

const BUDGET_QUESTION = {
  fieldPath: "guardrails.monthlyBudgetKrw" as const,
  question: "월 최대 매수 예산을 정하시겠어요?",
  reason: "월별 지출 한도를 설정할지 확인이 필요합니다.",
  inputType: "select" as const,
  required: false,
};

function interpretReadyAction(overrides: Partial<Action & { type: "interpret_ready" }> = {}): Action {
  return {
    type: "interpret_ready",
    fields: {
      assetQuery: "애플",
      recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
      conditionalBuy: null,
      guardrails: { monthlyBudgetKrw: null },
    },
    skippedFieldPaths: [],
    nextQuestion: BUDGET_QUESTION,
    selectableAnswers: [
      { label: "정하지 않을게요", value: 0 },
      { label: "20만 원", value: 200000 },
    ],
    missingFieldsCount: 1,
    isPlanReady: false,
    isFreshIntent: true,
    hasRecognizableIntent: true,
    ...overrides,
  };
}

function withSubmittedIntent(): FlowState {
  return reducer(initialState(), { type: "submit_intent", input: "애플을 매주 5만 원씩 살래요" });
}

test("종목이 아직 확정되지 않았으면 currentQuestion 은 항상 null 이고 clarifying 으로 대기한다(종목 검색 UI 가 이어서 뜬다)", () => {
  const submitted = withSubmittedIntent();
  const next = reducer(submitted, interpretReadyAction());

  assert.equal(next.plan.asset.symbol, "", "종목은 아직 확정되지 않아야 함");
  assert.equal(next.currentQuestion, null, "§입력 방식 재설계 — 채팅으로 하나씩 되묻지 않는다");
  assert.equal(next.flowState, "clarifying");
});

test("[§종목 선택은 AI 재해석 없이 처리] 종목을 확정하면(resolve_asset) 대화 로그에 선택한 종목 메시지가 정확히 한 번만 남고, 나머지 질문은 남기지 않는다", () => {
  const submitted = withSubmittedIntent();
  const afterInterpret = reducer(submitted, interpretReadyAction());
  const afterResolve = reducer(afterInterpret, {
    type: "resolve_asset",
    asset: { symbol: "AAPL", displayName: "APPLE INC", market: "US", quoteCurrency: "USD" },
  });

  assert.equal(afterResolve.plan.asset.symbol, "AAPL");
  assert.equal(afterResolve.currentQuestion, null);
  const selectionTurns = afterResolve.conversationLog.filter((turn) => turn.text.includes("AAPL"));
  assert.equal(selectionTurns.length, 1, "선택한 종목 메시지는 정확히 한 번만 남아야 한다(§중복 선택 방지)");
  assert.ok(
    !afterResolve.conversationLog.some((turn) => turn.text.includes("월 최대 매수 예산")),
    "정기 매수·조건부 매수·월 예산은 채팅으로 되묻지 않는다(계획 카드에서 채운다)"
  );
});

test("종목이 확정된 뒤 이어지는 interpret_ready 는 곧바로 계획 카드(plan_ready)로 넘어간다", () => {
  let state = withSubmittedIntent();
  state = reducer(state, { type: "resolve_asset", asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" } });
  const next = reducer(state, interpretReadyAction({ isFreshIntent: false }));

  assert.equal(next.flowState, "plan_ready");
  assert.equal(next.currentQuestion, null);
  assert.equal(next.plan.recurring?.amountKrw, 50000, "AI 가 추출한 값은 그대로 반영된다");
  assert.ok(
    !next.conversationLog.some((t) => t.text.includes("월 최대 매수 예산")),
    "채팅에 다음 질문을 남기지 않는다 — 빠진 값은 계획 카드에서 확인한다"
  );
});

test("무효 입력은 종목 확정 여부와 무관하게 즉시 거절 메시지를 대화 로그에 남긴다", () => {
  const submitted = withSubmittedIntent();
  const next = reducer(submitted, {
    type: "interpret_ready",
    fields: {
      assetQuery: null,
      recurring: null,
      conditionalBuy: null,
      guardrails: { monthlyBudgetKrw: null },
    },
    skippedFieldPaths: [],
    nextQuestion: null,
    selectableAnswers: [],
    missingFieldsCount: 0,
    isPlanReady: false,
    isFreshIntent: true,
    hasRecognizableIntent: false,
  });

  assert.equal(next.invalidInputStreak, 1);
  assert.ok(next.conversationLog.at(-1)?.text.includes("투자 조건을 찾지 못했어요"));
});

test("[§자유 입력 실패 처리 전면 수정] API 호출 실패 시 아무것도 알아낸 게 없으면 '찾지 못했어요' 안내만 남긴다", () => {
  const submitted = withSubmittedIntent();
  const failed = reducer(submitted, {
    type: "fail",
    error: { stage: "plan_structure", code: "parse_failed", userMessage: "이해한 내용을 정리하지 못했어요.", retryable: true },
  });

  assert.equal(failed.plan.asset.symbol, "");
  assert.ok(failed.conversationLog.at(-1)?.text.includes("투자 조건을 찾지 못했어요"));
  assert.ok(!failed.conversationLog.at(-1)?.text.includes("실패"), "'실패' 표현을 쓰지 않는다");
  assert.ok(!failed.conversationLog.at(-1)?.text.includes("다시 시도"), "'다시 시도' 표현을 쓰지 않는다");
});

test("[§자유 입력 실패 처리 전면 수정] API 호출이 실패해도 이미 알아낸 값(종목 등)은 그대로 지킨다", () => {
  let state = withSubmittedIntent();
  state = reducer(state, { type: "resolve_asset", asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" } });
  const failed = reducer(state, {
    type: "fail",
    error: { stage: "conversation", code: "network_failure", userMessage: "연결이 원활하지 않아요.", retryable: true },
  });

  assert.equal(failed.plan.asset.symbol, "AAPL", "이미 확정된 종목이 사라지면 안 된다");
  assert.ok(!failed.conversationLog.at(-1)?.text.includes("투자 조건을 찾지 못했어요"), "이미 값이 있으면 '아무것도 못 찾았다'는 문구를 쓰면 안 된다");
  assert.ok(!failed.conversationLog.at(-1)?.text.includes("실패"), "'실패' 표현을 쓰지 않는다");
  assert.ok(!failed.conversationLog.at(-1)?.text.includes("다시 시도"), "'다시 시도' 표현을 쓰지 않는다");
});

test("[회귀] 값이 하나도 추출되지 않아도 의도가 분명하면(hasRecognizableIntent) 잘못된 입력으로 취급하지 않는다", () => {
  // "한 달 예산 안에서 투자하고 싶어요" — 구체적인 숫자·종목이 없어 extractedFields 는 전부
  // null 이지만, AI 는 의도를 분명히 이해했다(hasRecognizableIntent). 종목이 아직 없으므로
  // clarifying 으로 대기하되(자유 입력을 계속 받는다), hasAnyExtractedField 만 보면 잘못된
  // 입력과 구분이 안 되던 회귀를 고쳤다.
  const submitted = withSubmittedIntent();
  const next = reducer(submitted, {
    type: "interpret_ready",
    fields: {
      assetQuery: null,
      recurring: null,
      conditionalBuy: null,
      guardrails: { monthlyBudgetKrw: null },
    },
    skippedFieldPaths: [],
    nextQuestion: null,
    selectableAnswers: [],
    missingFieldsCount: 1,
    isPlanReady: false,
    isFreshIntent: true,
    hasRecognizableIntent: true,
  });

  assert.equal(next.invalidInputStreak, 0, "잘못된 입력으로 취급되면 안 된다");
  assert.equal(next.currentQuestion, null, "채팅으로 되묻지 않는다");
  assert.equal(next.flowState, "clarifying");
  assert.ok(
    !next.conversationLog.at(-1)?.text.includes("투자 조건을 찾지 못했어요"),
    "거절 메시지가 대화 로그에 남으면 안 된다"
  );
});

// ---------------------------------------------------------------------------
// 문제 1 — 종목이 이미 확정된 뒤 AI 가 다시 assetQuery 질문을 만들어내는 경우의 구조적 방어.
// ---------------------------------------------------------------------------

test("종목이 확정된 뒤 nextQuestion 이 다시 assetQuery 를 가리키면 대화 로그·화면에 절대 노출하지 않는다", () => {
  let state = withSubmittedIntent();
  state = reducer(state, { type: "resolve_asset", asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" } });
  assert.equal(state.plan.asset.symbol, "AAPL");
  const logLengthBeforeBogus = state.conversationLog.length;

  // AI 가 실수로 종목을 다시 묻는 응답을 흉내낸다 — interpret_ready 리듀서 자체가 동기적으로
  // 걸러야 한다(별도 effect 가 뒤늦게 지우는 방식이면 대화 로그에 한 번 찍히고 만다).
  const bogus = reducer(
    state,
    interpretReadyAction({
      isFreshIntent: false,
      nextQuestion: {
        fieldPath: "assetQuery",
        question: "어떤 종목을 추가 매수하고 싶으신가요?",
        reason: "추가 매수 대상 확인",
        inputType: "text",
        required: true,
      },
    })
  );

  assert.equal(bogus.currentQuestion, null, "assetQuery 재질문은 currentQuestion 에 절대 반영되면 안 됨");
  assert.equal(
    bogus.conversationLog.length,
    logLengthBeforeBogus,
    "assetQuery 재질문 텍스트가 대화 로그에 한 번이라도 찍히면 안 됨"
  );
  assert.equal(bogus.pendingAutoRetrySkip, "assetQuery", "재요청 effect 가 볼 깃발이 세워져야 함");
  assert.equal(bogus.interpretStatus, "loading");

  // effect 가 실제 재요청을 보낸 뒤 auto_skip_field 로 깃발을 내린다 — 그 결과만 검증한다
  // (비동기 재요청 자체는 통합 테스트/Playwright 로 검증).
  const skipped = reducer(bogus, { type: "auto_skip_field", fieldPath: "assetQuery" });
  assert.equal(skipped.pendingAutoRetrySkip, null);
  assert.ok(skipped.skippedFieldPaths.includes("assetQuery"));
});

test("종목이 확정되기 전 이미 추출된 다른 필드(예: 조건부 매수 하락률·금액)는 종목 확정 후에도 그대로 유지된다", () => {
  // "가격이 떨어지면 10% 하락 시 10만 원 더 사고 싶어요" 같은 입력은 assetQuery 는 비어 있어도
  // conditionalBuy 의도가 있어 종목 검색으로 먼저 넘어간다. 종목을 확정한 뒤에도 이미 추출돼
  // 있던 하락률·금액이 사라지지 않고 interpretFields 에 남아야 한다(§입력 방식 재설계 —
  // 채팅으로 되묻지 않고 계획 카드에서 채운다). §동적 평균 매수가 — 평균 매수가는 더 이상
  // plan.conditionalBuy 의 전제 조건이 아니다(엔진이 실행된 매수 내역으로 직접 계산한다) —
  // 하락률·금액만 유효하면 plan.conditionalBuy 가 그대로 채워진다.
  let state = withSubmittedIntent();
  state = reducer(
    state,
    interpretReadyAction({
      fields: {
        assetQuery: null,
        recurring: null,
        conditionalBuy: { thresholdPercent: 10, amountKrw: 100000 },
        guardrails: { monthlyBudgetKrw: null },
      },
      nextQuestion: null,
    })
  );
  assert.equal(state.plan.asset.symbol, "", "이 시점엔 아직 종목 미확정");
  assert.equal(state.currentQuestion, null);
  assert.equal(state.flowState, "clarifying");
  assert.equal(state.plan.conditionalBuy?.thresholdPercent, 10);
  assert.equal(state.plan.conditionalBuy?.amountKrw, 100000);
  assert.equal(state.interpretFields.conditionalBuy?.thresholdPercent, 10);
  assert.equal(state.interpretFields.conditionalBuy?.amountKrw, 100000);

  // §국내 통화 입력 후 미국 종목 선택 회귀와 뒤섞이지 않도록, 이 테스트는 원문에 통화 단위가
  // 아예 없는 경우로 검증한다(순수한 "필드 유지" 검증 — 통화 불일치 처리는 별도 테스트에서 본다).
  const resolved = reducer(
    { ...state, plan: { ...state.plan, originalInput: "떨어지면 더 사고 싶어요" } },
    { type: "resolve_asset", asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" } }
  );

  assert.equal(resolved.plan.asset.symbol, "AAPL");
  assert.equal(resolved.currentQuestion, null);
  assert.equal(resolved.interpretFields.conditionalBuy?.thresholdPercent, 10, "종목 확정 후에도 유지된다");
  assert.equal(resolved.interpretFields.conditionalBuy?.amountKrw, 100000);
});

// ---------------------------------------------------------------------------
// 문제 3 — 세션 복구 시 plan 에서 currentFields/완성도를 다시 계산한다.
// ---------------------------------------------------------------------------

test("planToInterpretFields: 완성된 plan 을 currentFields 모양으로 되살린다", () => {
  const plan = {
    ...emptyPlan("애플을 매주 5만 원씩 살래요"),
    asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" },
    recurring: { frequency: "weekly" as const, weekday: "monday" as const, amountKrw: 50000 },
  };
  const fields = planToInterpretFields(plan);
  assert.equal(fields.assetQuery, "AAPL");
  assert.deepEqual(fields.recurring, { frequency: "weekly", weekday: "monday", dayOfMonth: null, amountKrw: 50000 });
  assert.equal(fields.conditionalBuy, null);
  assert.equal(fields.guardrails.monthlyBudgetKrw, null);
});

test("저장된 계획이 있으면 완성/미완성과 무관하게 항상 restorePending 으로만 진입한다(deriveNextQuestion 호출 금지)", () => {
  const incompletePlan = {
    ...emptyPlan("애플을 매주 5만 원씩 살래요"),
    asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" },
    // recurring/conditionalBuy 둘 다 없음 — missingPlanRequirements 상 미완성
  };
  const restoredIncomplete = reducer(initialState(), {
    type: "restore",
    plan: incompletePlan,
    flowState: "idle",
    sessionId: "sess_test",
  });
  assert.equal(restoredIncomplete.chatPhase, "restorePending");
  assert.equal(restoredIncomplete.interpretStatus, "ready", "restorePending 에서는 절대 loading 이 아니다(자동 호출 없음)");
  assert.equal(restoredIncomplete.currentQuestion, null, "restorePending 에서 currentQuestion 은 반드시 null");
  assert.equal(
    restoredIncomplete.interpretFields.assetQuery,
    null,
    "restorePending 에서는 currentFields 도 아직 계산하지 않는다(계속 수정하기를 눌러야 계산)"
  );

  const completePlan = {
    ...incompletePlan,
    recurring: { frequency: "weekly" as const, weekday: "monday" as const, amountKrw: 50000 },
  };
  const restoredComplete = reducer(initialState(), {
    type: "restore",
    plan: completePlan,
    flowState: "idle",
    sessionId: "sess_test",
  });
  assert.equal(restoredComplete.chatPhase, "restorePending", "완성된 계획도 restorePending 부터 시작한다");
  assert.equal(restoredComplete.interpretStatus, "ready");
  assert.equal(restoredComplete.currentQuestion, null);
});

test("Screen 3 이후로 복구되는 경우(flowState !== idle)는 plan/flowState 만 복구한다", () => {
  const plan = {
    ...emptyPlan("애플을 매주 5만 원씩 살래요"),
    asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US" as const, quoteCurrency: "USD" as const },
  };
  const restored = reducer(initialState(), {
    type: "restore",
    plan,
    flowState: "plan_ready",
    sessionId: "sess_test",
  });

  assert.equal(restored.flowState, "plan_ready");
  assert.equal(restored.plan.asset.symbol, "AAPL");
});

test("continue_restored_plan(미완성): restorePending → collecting 로 전환하고 loading 상태로 실제 재요청을 준비한다", () => {
  const incompletePlan = {
    ...emptyPlan("애플을 매주 5만 원씩 살래요"),
    asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" },
  };
  const restored = reducer(initialState(), {
    type: "restore",
    plan: incompletePlan,
    flowState: "idle",
    sessionId: "sess_test",
  });
  const fields = planToInterpretFields(incompletePlan);
  const continued = reducer(restored, { type: "continue_restored_plan", interpretFields: fields, incomplete: true });

  assert.equal(continued.chatPhase, "collecting");
  assert.equal(continued.interpretStatus, "loading", "이 시점부터 실제 재요청이 나가야 한다(effect/context 메서드가 이어서 처리)");
  assert.equal(continued.interpretFields.assetQuery, "AAPL");
  assert.equal(continued.currentQuestion, null);
});

test("continue_restored_plan(완성): restorePending → editableReview 로 전환하고 수정 진입 문구를 한 번 남긴다", () => {
  const completePlan = {
    ...emptyPlan("애플을 매주 5만 원씩 살래요"),
    asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" },
    recurring: { frequency: "weekly" as const, weekday: "monday" as const, amountKrw: 50000 },
  };
  const restored = reducer(initialState(), {
    type: "restore",
    plan: completePlan,
    flowState: "idle",
    sessionId: "sess_test",
  });
  const fields = planToInterpretFields(completePlan);
  const continued = reducer(restored, { type: "continue_restored_plan", interpretFields: fields, incomplete: false });

  assert.equal(continued.chatPhase, "editableReview");
  assert.equal(continued.interpretStatus, "ready", "완성된 계획은 추가 API 호출 없이 바로 수정 상태로 들어간다");
  assert.ok(continued.conversationLog.at(-1)?.text.includes("투자 방법을 어떻게 바꿀까요?"));
  assert.equal(continued.revise.status, "editing", "editableReview 진입과 동시에 수정 입력창이 열린다");
});

test("초기 상태(empty)는 currentQuestion 이 null 이고, submit_intent 를 거쳐야 collecting 으로 전환된다", () => {
  const fresh = initialState();
  assert.equal(fresh.chatPhase, "empty");
  assert.equal(fresh.currentQuestion, null);

  const submitted = reducer(fresh, { type: "submit_intent", input: "애플을 매주 5만 원씩 살래요" });
  assert.equal(submitted.chatPhase, "collecting");
});

/** 종목 확정 → (§입력 방식 재설계) 채팅으로 되묻지 않고 나머지 항목이 곧바로 계획에 반영되어
 * plan_ready 에 이르는 상태를 만든다("back" 회귀 테스트 공용). */
function buildFullyAnsweredState(): FlowState {
  let state = withSubmittedIntent();

  // 종목이 아직 확정되지 않은 첫 응답 — 채팅으로 되묻지 않고 종목 검색으로 넘어간다.
  state = reducer(
    state,
    interpretReadyAction({
      fields: { assetQuery: "애플", recurring: null, conditionalBuy: null, guardrails: { monthlyBudgetKrw: null } },
      nextQuestion: null,
      selectableAnswers: [],
      missingFieldsCount: 2,
    })
  );
  assert.equal(state.plan.asset.symbol, "");

  state = reducer(state, { type: "resolve_asset", asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" } });
  assert.equal(state.plan.asset.symbol, "AAPL");
  assert.equal(state.questionHistory.length, 1);

  // 종목 확정 뒤 이어지는 interpret_ready — 정기 매수·월 예산이 채팅 없이 곧바로 계획에
  // 반영되고 계획 카드(plan_ready)로 넘어간다.
  state = reducer(
    state,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: 200000 },
      },
      nextQuestion: null,
      selectableAnswers: [],
      missingFieldsCount: 0,
      isPlanReady: true,
      isFreshIntent: false,
    })
  );
  assert.equal(state.plan.recurring?.amountKrw, 50000);
  assert.equal(state.plan.guardrails.monthlyBudgetKrw, 200000);
  assert.equal(state.currentQuestion, null);
  assert.equal(state.flowState, "plan_ready");

  return state;
}

test("back: plan_ready 에서 뒤로 가면 종목 확정 직전(clarifying)으로 되돌아간다", () => {
  const state = buildFullyAnsweredState();

  const afterBack = reducer(state, { type: "back" });
  assert.equal(afterBack.flowState, "clarifying");
  assert.equal(afterBack.plan.asset.symbol, "", "종목 확정 자체가 되돌아간다");
  assert.equal(afterBack.currentQuestion, null);
  assert.equal(afterBack.questionHistory.length, 0);
});

test("back 여러 번 반복: 종목 확정 이전으로 되돌아간 뒤 다시 back 하면 완전히 empty 로 리셋된다", () => {
  const state = buildFullyAnsweredState();

  const back1 = reducer(state, { type: "back" });
  assert.equal(back1.flowState, "clarifying");
  assert.equal(back1.plan.asset.symbol, "");

  const back2 = reducer(back1, { type: "back" });
  assert.equal(back2.chatPhase, "empty", "더 되돌릴 게 없으면 완전히 처음(empty)으로 리셋된다");
  assert.equal(back2.currentQuestion, null, "empty 불변식: currentQuestion 은 반드시 null");
  assert.equal(back2.plan.asset.symbol, "");
  assert.equal(back2.plan.originalInput, "");
  assert.equal(back2.conversationLog.length, 1, "안내 메시지 하나만 남는다");
});

test("enter_editable_review: 수정 진입 안내 말풍선을 한 번만 남긴다(중복 방지)", () => {
  const once = reducer(initialState(), { type: "enter_editable_review" });
  assert.ok(once.conversationLog.at(-1)?.text.includes("투자 방법을 어떻게 바꿀까요?"));

  const twice = reducer(once, { type: "enter_editable_review" });
  assert.equal(
    twice.conversationLog.length,
    once.conversationLog.length,
    "이미 마지막 메시지가 같은 문구면 중복 추가하지 않는다"
  );
});

// ---------------------------------------------------------------------------
// RevisionStatus 상태 전환 (§재발했던 회귀: 적용 완료 후에도 수정 입력창이 다시 나타났다)
// ---------------------------------------------------------------------------

function reviseResponse(overrides: Partial<PlanReviseResponse> = {}): PlanReviseResponse {
  return {
    understoodRequest: "이해한 요청",
    proposedChanges: [],
    unchangedFields: [],
    unresolvedFields: [],
    confirmationCopy: "",
    warnings: [],
    ...overrides,
  };
}

function editingState(): FlowState {
  return reducer(initialState(), { type: "enter_editable_review" });
}

test("revise_ready(변경 제안 있음): editing → preview 로 전환한다", () => {
  const change: ReviseFieldChange = { fieldPath: "guardrails.monthlyBudgetKrw", before: null, after: 300000 };
  const next = reducer(editingState(), { type: "revise_ready", result: reviseResponse({ proposedChanges: [change] }) });
  assert.equal(next.revise.status, "preview");
  assert.deepEqual(next.revise.result?.proposedChanges, [change]);
});

test("revise_ready(제안 없이 되묻는 질문만): editing 을 유지한다(입력창을 숨기지 않는다)", () => {
  const result = reviseResponse({
    unresolvedFields: [{ fieldPath: "general", question: "어떻게 바꿀지 조금 더 구체적으로 말해줄래요?" }],
  });
  const next = reducer(editingState(), { type: "revise_ready", result });
  assert.equal(next.revise.status, "editing", "preview 는 '입력창 숨김'이 규칙이라 되묻는 질문에는 맞지 않는다");
  assert.equal(next.revise.result?.unresolvedFields.length, 1);
});

test("apply_revision: applied 로 전환하고 appliedChanges 를 남기며 result 는 비운다", () => {
  const change: ReviseFieldChange = { fieldPath: "guardrails.monthlyBudgetKrw", before: null, after: 300000 };
  const preview = reducer(editingState(), { type: "revise_ready", result: reviseResponse({ proposedChanges: [change] }) });
  const applied = reducer(preview, {
    type: "apply_revision",
    plan: { ...preview.plan, guardrails: { ...preview.plan.guardrails, monthlyBudgetKrw: 300000 } },
    changes: [change],
  });
  assert.equal(applied.revise.status, "applied");
  assert.deepEqual(applied.revise.appliedChanges, [change]);
  assert.equal(applied.revise.result, null, "적용 완료 후 preview 용 result 는 비워야 한다");
  assert.equal(applied.plan.guardrails.monthlyBudgetKrw, 300000);
});

test("적용 완료(applied) 이후에는 revise_dismissed 로만 idle 로 돌아가고, editing 은 자동으로 열리지 않는다", () => {
  const change: ReviseFieldChange = { fieldPath: "guardrails.monthlyBudgetKrw", before: null, after: 300000 };
  const preview = reducer(editingState(), { type: "revise_ready", result: reviseResponse({ proposedChanges: [change] }) });
  const applied = reducer(preview, { type: "apply_revision", plan: preview.plan, changes: [change] });

  assert.notEqual(applied.revise.status, "editing", "적용 자체가 editing 을 다시 열면 안 된다(재발했던 회귀)");

  const dismissed = reducer(applied, { type: "revise_dismissed" });
  assert.equal(dismissed.revise.status, "idle");
  assert.equal(dismissed.revise.appliedChanges, null, "'수정된 계획 보기' 이후 이전 요약이 남아있으면 안 된다");
});

test("'다시 수정하기'(revise_start_editing)를 직접 눌러야만 applied 에서 editing 으로 돌아간다", () => {
  const change: ReviseFieldChange = { fieldPath: "guardrails.monthlyBudgetKrw", before: null, after: 300000 };
  const preview = reducer(editingState(), { type: "revise_ready", result: reviseResponse({ proposedChanges: [change] }) });
  const applied = reducer(preview, { type: "apply_revision", plan: preview.plan, changes: [change] });

  const editingAgain = reducer(applied, { type: "revise_start_editing" });
  assert.equal(editingAgain.revise.status, "editing");
  assert.equal(editingAgain.revise.appliedChanges, null);
});

test("revise_applying: 이미 applying 이면 중복 dispatch 를 무시한다(중복 클릭 방지)", () => {
  const change: ReviseFieldChange = { fieldPath: "guardrails.monthlyBudgetKrw", before: null, after: 300000 };
  const preview = reducer(editingState(), { type: "revise_ready", result: reviseResponse({ proposedChanges: [change] }) });
  const applying = reducer(preview, { type: "revise_applying" });
  assert.equal(applying.revise.status, "applying");

  const stillApplying = reducer(applying, { type: "revise_applying" });
  assert.equal(stillApplying, applying, "이미 applying 상태에서 또 dispatch 하면 상태 객체가 그대로여야 한다");
});

test("revise_failed: 계획 해석(interpret) 실패와 달리 conversationLog·currentQuestion·flowState 를 건드리지 않는다", () => {
  const before = editingState();
  const conversationLengthBefore = before.conversationLog.length;
  const failed = reducer(before, {
    type: "revise_failed",
    error: { stage: "conversation", code: "ai_unavailable", userMessage: "AI 응답을 받지 못했어요.", retryable: true },
  });
  assert.equal(failed.revise.status, "error");
  assert.equal(failed.revise.error?.userMessage, "AI 응답을 받지 못했어요.");
  assert.equal(failed.conversationLog.length, conversationLengthBefore, "공용 fail 과 달리 대화 로그에 오류 메시지를 남기지 않는다");
  assert.equal(failed.currentQuestion, before.currentQuestion);
  assert.equal(failed.flowState, before.flowState);
});

test("세션 복구(restore) 직후에는 항상 revise.status 가 idle 이다(새로고침 후 applied/editing 으로 복원되지 않음)", () => {
  const completePlan = {
    ...emptyPlan("애플을 매주 5만 원씩 살래요"),
    asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" },
    recurring: { frequency: "weekly" as const, weekday: "monday" as const, amountKrw: 50000 },
  };
  const restored = reducer(initialState(), {
    type: "restore",
    plan: completePlan,
    flowState: "idle",
    sessionId: "sess_test",
  });
  assert.equal(restored.revise.status, "idle", "revise 상태는 세션에 저장되지 않으므로 복구 직후 항상 idle 이어야 한다");
});

// ---------------------------------------------------------------------------
// applyReviseChanges — 정기 매수 요일 변경이 다른 필드에 영향을 주지 않는지
// ---------------------------------------------------------------------------

function fullPlan() {
  return {
    ...emptyPlan("애플을 매주 월요일 5만 원씩 살래요"),
    asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" },
    recurring: { frequency: "weekly" as const, weekday: "monday" as const, amountKrw: 50000 },
    guardrails: {
      monthlyBudgetKrw: 200000,
      maxConditionalExecutionsPerMonth: null,
      reviewDrawdownPercent: null,
    },
  };
}

test("정기 매수 요일 변경: 월요일 → 수요일로 바뀌고 금액·종목·월 예산은 그대로다", () => {
  const plan = fullPlan();
  const change: ReviseFieldChange = { fieldPath: "recurring.weekday", before: "monday", after: "wednesday" };
  const next = applyReviseChanges(plan, [change]);

  assert.equal(next.recurring?.weekday, "wednesday");
  assert.equal(next.recurring?.amountKrw, 50000, "요일 변경 시 정기 매수 금액은 유지되어야 한다");
  assert.equal(next.asset.symbol, "AAPL", "요일 변경 시 종목은 유지되어야 한다");
  assert.equal(next.guardrails.monthlyBudgetKrw, 200000, "요일 변경 시 월 예산은 유지되어야 한다");
});

test("정기 매수 요일 변경 후 계획 버전이 올라간다(결과 재계산 트리거)", () => {
  const plan = fullPlan();
  const change: ReviseFieldChange = { fieldPath: "recurring.weekday", before: "monday", after: "friday" };
  const next = applyReviseChanges(plan, [change]);
  assert.equal(next.version, plan.version + 1);
});

// ---------------------------------------------------------------------------
// greetingRevealed — 첫 진입 안내 메시지 이후 입력창 지연 표시(§사용자 확정)
// ---------------------------------------------------------------------------

test("initialState: 안내 메시지 하나를 미리 채워 두고, greetingRevealed 는 false 로 시작한다", () => {
  const fresh = initialState();
  assert.equal(fresh.conversationLog.length, 1, "안내 메시지 하나만 존재해야 한다");
  assert.equal(fresh.greetingRevealed, false, "지연 타이머가 끝나기 전까지는 false 여야 한다");
});

test("greeting_revealed: false → true 로 한 번만 전환하고, 이미 true 면 그대로 둔다(불필요한 재렌더 방지)", () => {
  const fresh = initialState();
  const revealed = reducer(fresh, { type: "greeting_revealed" });
  assert.equal(revealed.greetingRevealed, true);

  const revealedAgain = reducer(revealed, { type: "greeting_revealed" });
  assert.equal(revealedAgain, revealed, "이미 true 면 같은 state 참조를 그대로 반환해야 한다");
});

test("restore: chatPhase 와 무관하게 greetingRevealed 를 항상 true 로 시작한다(세션 복구 시 지연 애니메이션을 다시 재생하지 않음)", () => {
  const plan = fullPlan();

  const restoredToIdle = reducer(initialState(), {
    type: "restore",
    plan,
    flowState: "idle",
    sessionId: "sess_test",
  });
  assert.equal(restoredToIdle.greetingRevealed, true);

  const restoredToScreen3 = reducer(initialState(), {
    type: "restore",
    plan,
    flowState: "plan_ready",
    sessionId: "sess_test",
  });
  assert.equal(restoredToScreen3.greetingRevealed, true);
});

test("[회귀] 종목 확정 후 마지막 질문(예산)에 답해 계획이 완성되면, 바텀시트를 여는 데 필요한 조건(symbol·interpretStatus·currentQuestion)이 전부 충족된다", () => {
  // ScreenChat 의 readyToConfirm = isCollecting && symbol!=="" && interpretStatus==="ready"
  // && currentQuestion===null && !isInterpretFailure — 이 시퀀스가 그 네 조건을 모두 만족
  // 시키는지 리듀서 레벨에서 결정적으로 확인한다(실제 라이브 API 왕복 없이).
  const submitted = withSubmittedIntent();
  const afterFirstInterpret = reducer(submitted, interpretReadyAction());
  const afterResolve = reducer(afterFirstInterpret, {
    type: "resolve_asset",
    asset: { symbol: "AAPL", displayName: "APPLE INC", market: "US", quoteCurrency: "USD" },
  });
  const afterAnswerStart = reducer(afterResolve, {
    type: "answer_field_start",
    fields: afterResolve.interpretFields,
    skippedFieldPaths: [],
    answerLabel: "20만 원",
  });
  const final = reducer(
    afterAnswerStart,
    interpretReadyAction({
      nextQuestion: null,
      selectableAnswers: [],
      missingFieldsCount: 0,
      isPlanReady: true,
      isFreshIntent: false,
    })
  );

  assert.equal(final.chatPhase, "collecting");
  assert.equal(final.plan.asset.symbol, "AAPL");
  assert.equal(final.interpretStatus, "ready");
  assert.equal(final.currentQuestion, null);
  assert.equal(final.error, null);
});

test("back 으로 완전히 empty 까지 되돌아가면 greetingRevealed 가 다시 false 가 되어 인사말 애니메이션을 재생한다", () => {
  const state = buildFullyAnsweredState();
  const revealed = { ...state, greetingRevealed: true };

  const back1 = reducer(revealed, { type: "back" });
  const back2 = reducer(back1, { type: "back" });

  assert.equal(back2.chatPhase, "empty");
  assert.equal(back2.greetingRevealed, false, "완전히 처음으로 돌아가면 진짜 새 진입처럼 다시 재생되어야 한다");
});

// ---------------------------------------------------------------------------
// applyFieldAnswer — 요일 하드코딩 제거 + enabled 이진 질문(§사용자 확정)
// ---------------------------------------------------------------------------

test("[회귀] recurring.weekday 답변: 월요일 하드코딩 없이 사용자가 고른 요일 그대로 저장한다", () => {
  const fields = emptyPlanInterpretFields();
  const withAmount = applyFieldAnswer(fields, "recurring.amountKrw", 100000);
  const withWeekday = applyFieldAnswer(withAmount, "recurring.weekday", "wednesday");

  assert.equal(withWeekday.recurring?.weekday, "wednesday");
  assert.equal(withWeekday.recurring?.amountKrw, 100000, "요일을 나중에 답해도 이미 답한 금액이 사라지면 안 된다");
});

test("[회귀] recurring.amountKrw 답변은 이미 정한 요일을 월요일로 되돌리지 않는다", () => {
  const fields = emptyPlanInterpretFields();
  const withWeekday = applyFieldAnswer(fields, "recurring.weekday", "wednesday");
  const withAmount = applyFieldAnswer(withWeekday, "recurring.amountKrw", 100000);

  assert.equal(withAmount.recurring?.weekday, "wednesday", "금액을 나중에 답해도 요일이 월요일로 되돌아가면 안 된다");
});

test("recurring.weekday 는 한글 요일 표현도 정규화해서 저장한다(임의 치환 없음)", () => {
  const fields = emptyPlanInterpretFields();
  const result = applyFieldAnswer(fields, "recurring.weekday", "수요일");
  assert.equal(result.recurring?.weekday, "wednesday");
});

test("recurring.enabled=0(안 함)은 recurring 전체를 null 로 되돌린다", () => {
  const fields = applyFieldAnswer(emptyPlanInterpretFields(), "recurring.amountKrw", 100000);
  assert.notEqual(fields.recurring, null);
  const declined = applyFieldAnswer(fields, "recurring.enabled", 0);
  assert.equal(declined.recurring, null);
});

test("[회귀] recurring.enabled=1(설정)은 세부 값을 지어내지 않되, null 로 남기지도 않는다(빈 껍데기로 채운다)", () => {
  // recurring 이 null 로 남으면 AI 가 "원하지 않음"과 구분하지 못해 예산 질문으로 건너뛰고
  // 세부(요일·금액) 질문을 다시 하지 않는 회귀가 있었다 — 하위 필드를 전부 null 로 둔 객체로
  // 채워야, 이미 신뢰할 수 있게 동작하는 "부분 완성 필드" 처리 경로를 그대로 탄다.
  const fields = emptyPlanInterpretFields();
  const result = applyFieldAnswer(fields, "recurring.enabled", 1);
  assert.notEqual(result.recurring, null, "설정을 골랐는데 그룹 전체가 null 로 남으면 안 된다");
  assert.equal(result.recurring?.weekday, null, "요일을 지어내면 안 된다");
  assert.equal(result.recurring?.amountKrw, null, "금액을 지어내면 안 된다");
});

test("recurring.enabled=1(설정)을 두 번 답해도(이미 값이 있으면) 기존 값을 덮어쓰지 않는다", () => {
  const withAmount = applyFieldAnswer(emptyPlanInterpretFields(), "recurring.amountKrw", 100000);
  const result = applyFieldAnswer(withAmount, "recurring.enabled", 1);
  assert.equal(result.recurring?.amountKrw, 100000, "이미 답한 금액을 되돌리면 안 된다");
});

test("conditionalBuy.enabled=0(안 함)은 conditionalBuy 전체를 null 로 되돌린다", () => {
  const fields = applyFieldAnswer(emptyPlanInterpretFields(), "conditionalBuy.thresholdPercent", 10);
  assert.notEqual(fields.conditionalBuy, null);
  const declined = applyFieldAnswer(fields, "conditionalBuy.enabled", 0);
  assert.equal(declined.conditionalBuy, null);
});

test("[회귀] conditionalBuy.enabled=1(설정)도 null 로 남기지 않는다(빈 껍데기로 채운다)", () => {
  const result = applyFieldAnswer(emptyPlanInterpretFields(), "conditionalBuy.enabled", 1);
  assert.notEqual(result.conditionalBuy, null, "설정을 골랐는데 그룹 전체가 null 로 남으면 안 된다");
  assert.equal(result.conditionalBuy?.thresholdPercent, null);
  assert.equal(result.conditionalBuy?.amountKrw, null);
});

test("[회귀] mergeInterpretFieldsIntoPlan: weekday 와 amountKrw 가 모두 있어야 계획에 정기 매수가 반영된다", () => {
  const submitted = withSubmittedIntent();

  // weekday 만 있고 amountKrw 는 아직 없다 — 정기 매수가 아직 완성되지 않았으므로 plan.recurring 은 null 이어야 한다.
  const weekdayOnly = reducer(
    submitted,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "wednesday", amountKrw: null },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: null },
      },
    })
  );
  assert.equal(weekdayOnly.plan.recurring, null, "요일만 있고 금액이 없으면 아직 계획에 반영되면 안 된다");

  // 이제 amountKrw 까지 채워지면 그제야 plan.recurring 에 수요일이 반영된다.
  const complete = reducer(
    weekdayOnly,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "wednesday", amountKrw: 100000 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: null },
      },
      nextQuestion: null,
      selectableAnswers: [],
      missingFieldsCount: 0,
      isPlanReady: true,
    })
  );
  assert.equal(complete.plan.recurring?.weekday, "wednesday");
  assert.equal(complete.plan.recurring?.amountKrw, 100000);
});

// ---------------------------------------------------------------------------
// guardAgainstFieldDrift — AI가 관련 없는 질문에 답한 뒤 이미 확정된 값을 바꿔 보내는 문제
// ---------------------------------------------------------------------------

test("[회귀] 월 예산을 이미 정한 뒤 다른 질문(추가 매수 하락률)에 답했을 때, AI 응답이 예산을 다른 값으로 바꿔 보내도 기존 값을 지킨다", () => {
  const submitted = withSubmittedIntent();

  // 1) 월 예산 50만원으로 이미 확정, 다음 질문은 추가 매수 하락률(예산과 무관).
  const budgetSet = reducer(
    submitted,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
        conditionalBuy: { thresholdPercent: null, amountKrw: null },
        guardrails: { monthlyBudgetKrw: 500000 },
      },
      nextQuestion: {
        fieldPath: "conditionalBuy.thresholdPercent",
        question: "몇 % 하락하면 추가 매수할까요?",
        reason: "추가 매수 실행 조건에 필요합니다.",
        inputType: "percent",
        required: true,
      },
      selectableAnswers: [{ label: "10%", value: 10 }],
    })
  );
  assert.equal(budgetSet.plan.guardrails.monthlyBudgetKrw, 500000);
  assert.equal(budgetSet.currentQuestion, null, "채팅으로 되묻지 않는다(§입력 방식 재설계)");

  // 2) 사용자가 하락률에 답한다(answer_field_start).
  const answering: FlowState = reducer(budgetSet, {
    type: "answer_field_start",
    fields: {
      ...budgetSet.interpretFields,
      conditionalBuy: { thresholdPercent: 10, amountKrw: null },
    },
    skippedFieldPaths: [],
    answerLabel: "10%",
  });

  // 3) 이 응답에서 AI 가(관련 없는 질문에 답했을 뿐인데) 월 예산을 100만원으로 바꿔 보낸다 —
  //    실제로 겪은 회귀 상황을 그대로 재현한다.
  const drifted = reducer(
    answering,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
        conditionalBuy: { thresholdPercent: 10, amountKrw: null },
        guardrails: { monthlyBudgetKrw: 1_000_000 }, // AI 가 실제로 이렇게 바꿔 보낸 상황을 재현
      },
      nextQuestion: {
        fieldPath: "conditionalBuy.amountKrw",
        question: "하락 시 얼마나 더 살까요?",
        reason: "추가 매수 금액이 필요합니다.",
        inputType: "money",
        required: true,
      },
      selectableAnswers: [{ label: "10만원", value: 100000 }],
    })
  );

  assert.equal(
    drifted.plan.guardrails.monthlyBudgetKrw,
    500000,
    "방금 답한 질문(하락률)과 무관한 월 예산이 AI 응답만으로 바뀌면 안 된다"
  );
  assert.equal(drifted.interpretFields.conditionalBuy?.thresholdPercent, 10, "방금 답한 값 자체는 정상 반영되어야 한다");
});

test("[회귀] 방금 답한 필드 자신은 드리프트 방지에 걸리지 않고 새 값을 그대로 반영한다", () => {
  const submitted = withSubmittedIntent();
  const budgetSet = reducer(
    submitted,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: 500000 },
      },
      nextQuestion: {
        fieldPath: "guardrails.monthlyBudgetKrw",
        question: "월 예산을 다시 정하시겠어요?",
        reason: "재확인",
        inputType: "money",
        required: false,
      },
      selectableAnswers: [],
    })
  );

  // 사용자가 "월 예산" 질문 자체에 새로 답한 경우 — 이건 드리프트가 아니라 정상적인 갱신이다.
  const answering = reducer(budgetSet, {
    type: "answer_field_start",
    fields: { ...budgetSet.interpretFields, guardrails: { monthlyBudgetKrw: 1_000_000 } },
    skippedFieldPaths: [],
    answerLabel: "100만원",
  });
  const updated = reducer(
    answering,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: 1_000_000 },
      },
      nextQuestion: null,
      selectableAnswers: [],
      isPlanReady: true,
    })
  );

  assert.equal(updated.plan.guardrails.monthlyBudgetKrw, 1_000_000, "방금 답한 필드 자신의 새 값은 그대로 반영되어야 한다");
});

function withResolvedAsset(): FlowState {
  const submitted = withSubmittedIntent();
  return reducer(submitted, { type: "resolve_asset", asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" } });
}

test("[회귀] '설정' 클릭에 대한 바로 그 응답 자체가 conditionalBuy 를 null 로 돌려보내도(빈 껍데기를 만들지 않아도) 낙관적으로 이미 채워둔 빈 껍데기를 지키고, 예산 등 다른 질문으로 건너뛰지 않는다", () => {
  const resolved = withResolvedAsset();

  // "설정" 버튼 클릭 시 answerCurrentQuestion 이 applyFieldAnswer 로 낙관적 빈 껍데기를 만들고
  // answer_field_start 가 그 값을 즉시 interpretFields 에 반영한다 — 이 시점에는 아직 서버
  // 응답을 기다리는 중이다.
  const clickingEnable = reducer(resolved, {
    type: "answer_field_start",
    fields: applyFieldAnswer(resolved.interpretFields, "conditionalBuy.enabled", 1),
    skippedFieldPaths: [],
    answerLabel: "설정",
  });
  assert.ok(clickingEnable.interpretFields.conditionalBuy !== null, "낙관적 반영 직후에도 conditionalBuy 는 빈 껍데기라도 있어야 함");

  // 그런데 바로 이 턴에 대한 AI 응답 자체가 conditionalBuy 를 null 로, nextQuestion 을 예산으로
  // 돌려보낸다(§실제로 라이브 테스트에서 재현된 회귀 — "설정" 다음 질문이 곧바로 "월 최대 투자
  // 예산을 정하시겠어요?"로 넘어가고, 계획 확인 화면에는 "조건부 매수: 설정하지 않음"으로 표시됨).
  const afterEnableResponse = reducer(
    clickingEnable,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "wednesday", amountKrw: 100000 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: null },
      },
      nextQuestion: {
        fieldPath: "guardrails.monthlyBudgetKrw",
        question: "월 최대 투자 예산을 정하시겠어요?",
        reason: "필요",
        inputType: "select",
        required: false,
      },
      selectableAnswers: [],
    })
  );

  assert.notEqual(
    afterEnableResponse.interpretFields.conditionalBuy,
    null,
    "설정 클릭 자체에 대한 응답이 null 을 돌려보내도 낙관적으로 만든 빈 껍데기를 지켜야 함"
  );
  assert.equal(afterEnableResponse.currentQuestion, null, "채팅으로 빠진 세부 질문을 강제로 되묻지 않는다(계획 카드에서 채운다)");
  assert.equal(afterEnableResponse.plan.conditionalBuy, null, "세부 값이 채워지기 전까지는 계획에도 반영되면 안 됨");
});

test("[회귀] conditionalBuy 가 '설정'으로 활성화된 뒤, AI 가 통째로 null 로 되돌려 보내도(명시적 '안 함' 답변이 아니면) 유지한다", () => {
  const resolved = withResolvedAsset();

  // 1) "설정" 답변으로 conditionalBuy 가 빈 껍데기로 채워진 상태.
  const enabled = reducer(
    resolved,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "wednesday", amountKrw: 100000 },
        conditionalBuy: { thresholdPercent: null, amountKrw: null },
        guardrails: { monthlyBudgetKrw: null },
      },
      nextQuestion: {
        fieldPath: "conditionalBuy.thresholdPercent",
        question: "몇 % 하락하면 추가 매수할까요?",
        reason: "필요",
        inputType: "percent",
        required: true,
      },
      selectableAnswers: [],
    })
  );
  assert.ok(enabled.interpretFields.conditionalBuy !== null, "설정 직후 conditionalBuy 는 빈 껍데기라도 non-null 이어야 함");

  // 2) 사용자가 무관한 질문(예산)에 답한 턴에서, AI 가 conditionalBuy 전체를 null 로 되돌려 보낸다
  //    (§실제로 겪은 회귀 — "설정" 후 예산을 답하자 conditionalBuy 가 통째로 사라짐).
  const answeringBudget = reducer(enabled, {
    type: "answer_field_start",
    fields: { ...enabled.interpretFields, guardrails: { monthlyBudgetKrw: 1_500_000 } },
    skippedFieldPaths: [],
    answerLabel: "150만원",
  });
  const drifted = reducer(
    answeringBudget,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "wednesday", amountKrw: 100000 },
        conditionalBuy: null, // AI 가 실수로 통째로 지워 보낸 상황을 재현
        guardrails: { monthlyBudgetKrw: 1_500_000 },
      },
      nextQuestion: null,
      selectableAnswers: [],
      isPlanReady: true,
    })
  );

  assert.notEqual(
    drifted.interpretFields.conditionalBuy,
    null,
    "명시적으로 '안 함'을 답하지 않았다면 conditionalBuy 가 통째로 null 로 되돌아가면 안 된다"
  );
  assert.equal(drifted.interpretFields.conditionalBuy?.thresholdPercent, null, "값 자체는 여전히 비어 있어야 함(지어내지 않음)");
});

test("[회귀] conditionalBuy.enabled=0(안 함)으로 명시적으로 답하면 실제로 null 로 되돌아간다(드리프트 방지가 정상 전환을 막지 않음)", () => {
  const resolved = withResolvedAsset();
  const enabled = reducer(
    resolved,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "wednesday", amountKrw: 100000 },
        conditionalBuy: { thresholdPercent: null, amountKrw: null },
        guardrails: { monthlyBudgetKrw: null },
      },
      nextQuestion: {
        fieldPath: "conditionalBuy.thresholdPercent",
        question: "몇 % 하락하면 추가 매수할까요?",
        reason: "필요",
        inputType: "percent",
        required: true,
      },
      selectableAnswers: [],
    })
  );

  const declining = reducer(enabled, {
    type: "answer_field_start",
    fields: applyFieldAnswer(enabled.interpretFields, "conditionalBuy.enabled", 0),
    skippedFieldPaths: [],
    answerLabel: "안 함",
  });
  const declined = reducer(
    declining,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "wednesday", amountKrw: 100000 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: null },
      },
      nextQuestion: {
        fieldPath: "guardrails.monthlyBudgetKrw",
        question: "월 최대 예산을 정하시겠어요?",
        reason: "필요",
        inputType: "select",
        required: false,
      },
      selectableAnswers: [],
    })
  );

  assert.equal(declined.interpretFields.conditionalBuy, null, "명시적으로 '안 함'을 답했다면 정상적으로 null 이 되어야 함");
});

test("[§입력 방식 재설계] conditionalBuy 세부 값(추가 매수 금액)이 비어 있어도 채팅 질문으로 강제 전환하지 않는다 — plan.conditionalBuy 는 null 로 남아 계획 카드에서 채운다", () => {
  const resolved = withResolvedAsset();
  const enabled = reducer(
    resolved,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "wednesday", amountKrw: 100000 },
        conditionalBuy: { thresholdPercent: 10, amountKrw: null },
        guardrails: { monthlyBudgetKrw: null },
      },
      nextQuestion: null,
      selectableAnswers: [],
      isPlanReady: false,
    })
  );

  assert.equal(enabled.currentQuestion, null, "채팅으로 되묻지 않는다");
  assert.equal(enabled.flowState, "plan_ready", "종목이 이미 확정돼 있으면 곧바로 계획 카드로 넘어간다");
  assert.equal(enabled.plan.conditionalBuy, null, "추가 매수 금액이 없는 동안은 계획에도 조건부 매수가 반영되지 않는다");
  assert.equal(enabled.interpretFields.conditionalBuy?.thresholdPercent, 10, "이미 추출된 하락률은 카드가 이어 쓸 수 있게 보존한다");
  assert.equal(enabled.interpretFields.conditionalBuy?.amountKrw, null);
});

// ---------------------------------------------------------------------------
// 수정(revise) 흐름에서 종목 변경 — 무한 반복 회귀(§start_asset_revision 이 chatPhase 를
// "collecting" 으로 되돌리지 않아 종목 검색이 전혀 뜨지 않고 "조건을 다르게 수정하고
// 싶어요"만 반복해서 보이던 문제)
// ---------------------------------------------------------------------------

function completedPlanEditingState(): FlowState {
  const editing = editingState();
  return {
    ...editing,
    plan: {
      ...editing.plan,
      asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" },
      recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
      guardrails: { ...editing.plan.guardrails, monthlyBudgetKrw: 1_000_000 },
    },
  };
}

test("[회귀] start_asset_revision 은 chatPhase 를 collecting 으로 되돌린다(그러지 않으면 종목 검색 UI가 전혀 뜨지 않고 수정 CTA 만 무한 반복된다)", () => {
  const state = completedPlanEditingState();
  const searching = reducer(state, {
    type: "start_asset_revision",
    query: "테슬라",
    planWithOtherChangesApplied: {
      ...state.plan,
      guardrails: { ...state.plan.guardrails, monthlyBudgetKrw: 500_000 },
    },
    returnTo: "editableReview",
  });

  assert.equal(searching.chatPhase, "collecting", "collecting 이어야 needsAssetSearch 조건이 충족된다");
  assert.equal(searching.flowState, "clarifying");
  assert.equal(searching.plan.asset.symbol, "", "재검색을 위해 종목은 비워야 한다");
  assert.equal(searching.plan.guardrails.monthlyBudgetKrw, 500_000, "종목 외 다른 변경(예산)은 이미 반영돼 있어야 한다");
  assert.equal(searching.interpretFields.assetQuery, "테슬라");
  assert.equal(searching.revisionAssetRevertPlan?.plan.asset.symbol, "AAPL", "뒤로가기용 스냅샷을 남겨야 한다");
  assert.equal(searching.revisionAssetRevertPlan?.returnTo, "editableReview");
});

test("[회귀] 종목 변경 검색 중 뒤로가기를 누르면 계획 전체가 초기화되지 않고 수정 화면으로 되돌아간다", () => {
  const state = completedPlanEditingState();
  const searching = reducer(state, {
    type: "start_asset_revision",
    query: "테슬라",
    planWithOtherChangesApplied: {
      ...state.plan,
      guardrails: { ...state.plan.guardrails, monthlyBudgetKrw: 500_000 },
    },
    returnTo: "editableReview",
  });

  const backed = reducer(searching, { type: "back" });

  assert.equal(backed.plan.asset.symbol, "AAPL", "원래 종목이 유지돼야 한다(계획 전체 초기화 금지)");
  assert.equal(backed.plan.recurring?.amountKrw, 50000, "정기 매수 등 다른 계획 값도 유지돼야 한다");
  assert.equal(backed.chatPhase, "editableReview", "수정 화면(editableReview)으로 돌아가야 한다");
  assert.equal(backed.revise.status, "editing", "수정 입력창이 다시 열려야 한다");
  assert.equal(backed.revisionAssetRevertPlan, null, "되돌린 뒤에는 스냅샷을 지운다");
});

test("[회귀] 종목 검색을 완료하면(resolve_asset) revisionAssetRevertPlan 이 지워지고 plan_ready 로 이동한다", () => {
  const state = completedPlanEditingState();
  const searching = reducer(state, {
    type: "start_asset_revision",
    query: "테슬라",
    planWithOtherChangesApplied: {
      ...state.plan,
      guardrails: { ...state.plan.guardrails, monthlyBudgetKrw: 500_000 },
    },
    returnTo: "editableReview",
  });

  const resolved = reducer(searching, { type: "resolve_asset", asset: { symbol: "TSLA", displayName: "Tesla Inc", market: "US", quoteCurrency: "USD" } });

  assert.equal(resolved.flowState, "plan_ready");
  assert.equal(resolved.plan.asset.symbol, "TSLA");
  assert.equal(resolved.plan.asset.displayName, "Tesla Inc");
  assert.equal(resolved.plan.guardrails.monthlyBudgetKrw, 500_000, "다른 변경(예산)도 함께 유지된다");
  assert.equal(resolved.revisionAssetRevertPlan, null, "검색이 끝났으니 되돌릴 스냅샷은 더 이상 필요 없다");
  assert.equal(resolved.pendingPlanReadyAfterAsset, false);
});

// ---------------------------------------------------------------------------
// apply_asset_edit — §종목 수정 UX 변경(§사용자 확정) — 계획 확인 화면에서 종목 검색
// bottom sheet 로 직접 고른 결과. 채팅 화면 이동·대화 로그 추가·AI 재해석이 전혀 없어야
// 한다는 것이 이 재작업의 핵심 요구사항이다.
// ---------------------------------------------------------------------------
function planReadyEditingState(): FlowState {
  return { ...completedPlanEditingState(), chatPhase: "collecting", flowState: "plan_ready", conversationLog: [] };
}

test("apply_asset_edit(같은 통화): 종목만 바뀌고 화면·대화 로그·정기 매수·추가 매수는 그대로 유지된다", () => {
  const state = planReadyEditingState();
  const next = reducer(state, {
    type: "apply_asset_edit",
    asset: { symbol: "MSFT", displayName: "MICROSOFT CORP", market: "US", quoteCurrency: "USD" },
  });

  assert.equal(next.plan.asset.symbol, "MSFT");
  assert.equal(next.plan.asset.displayName, "Microsoft Corp", "회사명은 formatCompanyName 을 거친다");
  assert.equal(next.flowState, "plan_ready", "채팅 화면으로 이동하지 않는다");
  assert.equal(next.chatPhase, "collecting", "chatPhase 도 그대로여야 한다");
  assert.deepEqual(next.conversationLog, [], "대화 로그에 아무것도 추가되지 않는다");
  assert.deepEqual(next.plan.recurring, state.plan.recurring, "통화가 같으면 정기 매수 금액을 그대로 유지한다");
  assert.equal(next.plan.guardrails.monthlyBudgetKrw, state.plan.guardrails.monthlyBudgetKrw);
  assert.equal(next.assetCurrencyReentryRequired, false);
});

test("apply_asset_edit(다른 통화, USD→KRW): 금액만 지워지고 주기·요일은 유지되며 환율 자동 변환은 하지 않는다", () => {
  const state = planReadyEditingState();
  const next = reducer(state, {
    type: "apply_asset_edit",
    asset: { symbol: "035720", displayName: "카카오", market: "KR", quoteCurrency: "KRW" },
  });

  assert.equal(next.plan.asset.symbol, "035720");
  assert.equal(next.plan.asset.quoteCurrency, "KRW");
  assert.equal(next.flowState, "plan_ready", "채팅 화면으로 이동하지 않는다");
  assert.equal(next.chatPhase, "collecting");
  assert.deepEqual(next.conversationLog, [], "대화 로그에 아무것도 추가되지 않는다");
  assert.equal(next.plan.recurring, null, "통화가 바뀌면 금액을 다시 받아야 하므로 recurring 자체를 비운다");
  assert.equal(next.interpretFields.recurring?.frequency, "weekly", "주기는 그대로 보존한다");
  assert.equal(next.interpretFields.recurring?.weekday, "monday", "요일도 그대로 보존한다");
  assert.equal(next.interpretFields.recurring?.amountKrw, null, "금액만 지운다(§환율 자동 변환 금지)");
  assert.equal(next.assetCurrencyReentryRequired, true, "통화 재확인 상태로 전환한다");
});

test("apply_asset_edit 이후 apply_direct_plan_edit(금액 재입력)로 통화 재확인 상태가 풀린다", () => {
  const state = planReadyEditingState();
  const edited = reducer(state, {
    type: "apply_asset_edit",
    asset: { symbol: "035720", displayName: "카카오", market: "KR", quoteCurrency: "KRW" },
  });
  assert.equal(edited.assetCurrencyReentryRequired, true);

  const refilled = reducer(edited, {
    type: "apply_direct_plan_edit",
    plan: { ...edited.plan, recurring: { frequency: "weekly", weekday: "monday", amountKrw: 100_000 } },
  });

  assert.equal(refilled.assetCurrencyReentryRequired, false);
  assert.equal(refilled.plan.recurring?.amountKrw, 100_000);
});

test("[회귀] 계획 확인 화면(PlanCard)의 종목 행에서 곧바로 검색을 시작하면(returnTo: planReady), 뒤로가기 시 수정 화면이 아니라 계획 확인 화면으로 돌아간다", () => {
  const state = completedPlanEditingState();
  // enter_editable_review 를 거치지 않은, plan_ready 상태에서 시작하는 상황을 흉내낸다.
  const planReadyState: FlowState = { ...state, chatPhase: "collecting", flowState: "plan_ready" };
  const searching = reducer(planReadyState, {
    type: "start_asset_revision",
    query: "Apple Inc",
    planWithOtherChangesApplied: planReadyState.plan,
    returnTo: "planReady",
  });

  assert.equal(searching.chatPhase, "collecting");
  assert.equal(searching.flowState, "clarifying");
  assert.equal(searching.revisionAssetRevertPlan?.returnTo, "planReady");

  const backed = reducer(searching, { type: "back" });
  assert.equal(backed.flowState, "plan_ready", "종목 행에서 시작했다면 계획 확인 화면으로 돌아가야 한다");
  assert.equal(backed.plan.asset.symbol, "AAPL", "원래 종목이 유지돼야 한다");
  assert.equal(backed.revisionAssetRevertPlan, null);
});

// ---------------------------------------------------------------------------
// conditionalBuy 비활성 상태에서 조건부 매수 횟수(maxConditionalExecutionsPerMonth)가 함께
// null 로 정리되는지 — "조건부 매수: 설정하지 않음"인데 "조건부 매수 횟수: 월 8회"가 남아
// 모순 상태로 보이던 회귀(§계획 확인 화면의 개별 필드 수정 시트에서 재현됨)
// ---------------------------------------------------------------------------

test("[회귀] apply_direct_plan_edit: conditionalBuy 가 null 인데 maxConditionalExecutionsPerMonth 가 남아 있으면 함께 지운다", () => {
  const state = completedPlanEditingState();
  const inconsistentPlan = {
    ...state.plan,
    conditionalBuy: null,
    guardrails: { ...state.plan.guardrails, maxConditionalExecutionsPerMonth: 8 },
  };

  const applied = reducer(state, { type: "apply_direct_plan_edit", plan: inconsistentPlan });

  assert.equal(applied.plan.conditionalBuy, null);
  assert.equal(
    applied.plan.guardrails.maxConditionalExecutionsPerMonth,
    null,
    "conditionalBuy 가 없으면 조건부 매수 횟수도 반드시 null 이어야 한다"
  );
});

test("apply_direct_plan_edit: conditionalBuy 가 설정돼 있으면 maxConditionalExecutionsPerMonth 값을 그대로 반영한다", () => {
  const state = completedPlanEditingState();
  const planWithConditional = {
    ...state.plan,
    conditionalBuy: { thresholdPercent: 10, amountKrw: 200000 },
    guardrails: { ...state.plan.guardrails, maxConditionalExecutionsPerMonth: 3 },
  };

  const applied = reducer(state, { type: "apply_direct_plan_edit", plan: planWithConditional });

  assert.equal(applied.plan.guardrails.maxConditionalExecutionsPerMonth, 3, "conditionalBuy 가 있으면 정상적으로 유지돼야 한다");
});

test("[회귀] applyReviseChanges: 자연어 수정으로 conditionalBuy 를 없애면 maxConditionalExecutionsPerMonth 도 함께 지운다", () => {
  const plan = {
    ...emptyPlan("애플이 10% 하락하면 20만원 더 살래요"),
    asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" },
    conditionalBuy: { thresholdPercent: 10, amountKrw: 200000 },
    guardrails: {
      monthlyBudgetKrw: null,
      maxConditionalExecutionsPerMonth: 5,
      reviewDrawdownPercent: null,
    },
  };

  const changed = applyReviseChanges(plan, [{ fieldPath: "conditionalBuy", before: "유지", after: null }]);

  assert.equal(changed.conditionalBuy, null);
  assert.equal(changed.guardrails.maxConditionalExecutionsPerMonth, null);
});

// ---------------------------------------------------------------------------
// 국내 종목 가격 데이터 미연결(market_not_supported) 화면의 두 CTA — "계획으로 돌아가기"
// (edit_plan)/"다른 종목 선택하기"(start_asset_revision, returnTo: planReady)가 각각 요구된
// 상태만 바꾸고 나머지는 그대로 두는지 확인한다.
// ---------------------------------------------------------------------------

test("[회귀] edit_plan(\"계획으로 돌아가기\")은 plan_ready 로만 이동하고 currentPlan·대화 로그·revise 상태를 그대로 둔다", () => {
  const state = completedPlanEditingState();
  const stateWithConversation = {
    ...state,
    conversationLog: [...state.conversationLog, { role: "user" as const, text: "테스트 메시지" }],
  };

  // Screen4Analysis 에 처음 도착했을 때의 현실적인 초기 상태를 흉내낸다 — revise 는 아직
  // 아무도 건드리지 않은 idle 이다(editingState() 기반 fixture 는 "채팅에서 막 계획을
  // 확인하는" 다른 시나리오라 여기 그대로 쓰면 전제 자체가 맞지 않는다).
  const realisticState = { ...stateWithConversation, revise: { status: "idle" as const, result: null, appliedChanges: null, error: null } };
  const back = reducer(realisticState, { type: "edit_plan" });

  assert.equal(back.flowState, "plan_ready");
  assert.deepEqual(back.plan, realisticState.plan, "currentPlan 이 그대로 유지돼야 한다");
  assert.deepEqual(
    back.conversationLog,
    realisticState.conversationLog,
    "대화가 초기화되거나 새로 시작되면 안 된다"
  );
  assert.equal(back.revise.status, "idle", "generic 수정 composer(editing)를 새로 열면 안 된다");
});

test("[회귀] \"다른 종목 선택하기\"(start_asset_revision, returnTo: planReady)는 종목만 비우고 정기 매수·예산 등 나머지 계획은 그대로 유지하며, generic 수정 composer 를 열지 않는다", () => {
  const state = completedPlanEditingState();
  const searching = reducer(state, {
    type: "start_asset_revision",
    query: state.plan.asset.displayName,
    planWithOtherChangesApplied: state.plan,
    returnTo: "planReady",
  });

  assert.equal(searching.plan.asset.symbol, "", "재검색을 위해 종목만 비워야 한다");
  assert.equal(searching.plan.asset.displayName, "");
  assert.equal(searching.plan.recurring?.amountKrw, 50000, "정기 매수는 그대로 유지돼야 한다");
  assert.equal(searching.plan.guardrails.monthlyBudgetKrw, 1_000_000, "월 예산도 그대로 유지돼야 한다");
  assert.equal(searching.interpretFields.assetQuery, "Apple Inc", "이전 검색어 대신 현재 종목명으로 새로 채워야 한다");
  assert.equal(searching.revise.status, "idle", "generic 수정 composer 가 열리면 안 된다");
});

// ---------------------------------------------------------------------------
// §사용자 확정 — 국내·미국 주식 통화 일치, 0원 거부, 종목 변경 시 이전 종목의 평균 매수가
// 제거(관련 없는 정기 매수·예산은 유지).
// ---------------------------------------------------------------------------

test("[회귀] mergeInterpretFieldsIntoPlan: 0원은 정기 매수 확정값으로 반영하지 않는다(§0원 저장 금지)", () => {
  const submitted = withSubmittedIntent();
  const zeroAmount = reducer(
    submitted,
    interpretReadyAction({
      fields: {
        assetQuery: "애플",
        recurring: { frequency: "weekly", weekday: "wednesday", amountKrw: 0 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: null },
      },
    })
  );
  assert.equal(zeroAmount.plan.recurring, null, "0원은 값이 없는 것과 같게 취급해야 한다");
});

test("[회귀] mergeInterpretFieldsIntoPlan: 미국 주식은 1달러 미만, 국내 주식은 1,000원 미만을 거부한다", () => {
  const usdState: FlowState = {
    ...withSubmittedIntent(),
    plan: { ...emptyPlan(), asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" } },
  };
  const belowUsdMin = reducer(
    usdState,
    interpretReadyAction({
      fields: {
        assetQuery: "AAPL",
        recurring: { frequency: "weekly", weekday: "tuesday", amountKrw: 0.5 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: null },
      },
    })
  );
  assert.equal(belowUsdMin.plan.recurring, null, "미국 주식은 1달러 미만이면 아직 미확정으로 본다");

  const krwState: FlowState = {
    ...withSubmittedIntent(),
    plan: { ...emptyPlan(), asset: { symbol: "005930", displayName: "삼성전자", market: "KR", quoteCurrency: "KRW" } },
  };
  const belowKrwMin = reducer(
    krwState,
    interpretReadyAction({
      fields: {
        assetQuery: "005930",
        recurring: { frequency: "weekly", weekday: "tuesday", amountKrw: 500 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: null },
      },
    })
  );
  assert.equal(belowKrwMin.plan.recurring, null, "국내 주식은 1,000원 미만이면 아직 미확정으로 본다");
});

test("[회귀] 종목이 이미 확정된 뒤 원문에 명백히 다른 회사명이 등장하면 pendingAssetChangeQuery 를 세운다(종목 변경 감지)", () => {
  let state = withSubmittedIntent();
  state = reducer(state, { type: "resolve_asset", asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" } });

  const changed = reducer(
    state,
    interpretReadyAction({
      fields: {
        assetQuery: "테슬라",
        recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: null },
      },
      nextQuestion: {
        fieldPath: "assetQuery",
        question: "테슬라로 바꿀까요?",
        reason: "다른 종목 언급",
        inputType: "text",
        required: true,
      },
    })
  );

  assert.equal(changed.pendingAssetChangeQuery, "테슬라", "다른 회사명이 등장하면 종목 변경 검색을 준비해야 한다");
  assert.equal(changed.plan.asset.symbol, "AAPL", "검색이 끝나기 전까지는 기존 종목을 그대로 유지한다");
  assert.equal(changed.currentQuestion, null, "종목 변경 검색으로 전환하는 중에는 구조화 질문을 띄우지 않는다");
});

test("[회귀→§동적 평균 매수가] resolve_asset(종목 변경): 실제로 종목이 바뀌어도 하락률·추가 매수 금액·정기 매수는 그대로 둔다(평균 매수가는 더 이상 종목별 입력값이 아니라 다시 물을 필요가 없다)", () => {
  let state = withSubmittedIntent();
  state = reducer(state, { type: "resolve_asset", asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" } });
  state = {
    ...state,
    plan: {
      ...state.plan,
      // §국내 통화 입력 후 미국 종목 선택 회귀와 뒤섞이지 않도록, 원문에 통화 단위가 없는
      // 경우로 검증한다(순수한 "필드 유지" 검증 — 통화 불일치 처리는 별도 테스트에서 본다).
      originalInput: "매주 화요일에 사고 10% 떨어지면 더 사고 싶어요",
      recurring: { frequency: "weekly", weekday: "tuesday", amountKrw: 50 },
      conditionalBuy: { thresholdPercent: 10, amountKrw: 100 },
    },
    pendingAssetChangeQuery: "테슬라",
  };

  const resolved = reducer(state, {
    type: "resolve_asset",
    asset: { symbol: "TSLA", displayName: "Tesla Inc", market: "US", quoteCurrency: "USD" },
  });

  assert.equal(resolved.plan.asset.symbol, "TSLA");
  assert.equal(resolved.plan.conditionalBuy?.thresholdPercent, 10, "종목과 무관한 하락률은 그대로 유지해야 한다");
  assert.equal(resolved.plan.conditionalBuy?.amountKrw, 100, "종목과 무관한 추가 매수 금액도 그대로 유지해야 한다");
  assert.equal(resolved.plan.recurring?.amountKrw, 50, "종목과 무관한 정기 매수는 그대로 유지해야 한다");
  assert.equal(resolved.pendingAssetChangeQuery, null);
  assert.equal(resolved.currentQuestion, null, "평균 매수가는 다시 묻지 않으므로 채팅 질문이 생기지 않는다");
});

test("[회귀→§동적 평균 매수가] pendingPlanReadyAfterAsset 경로에서도 종목이 바뀌면 conditionalBuy(하락률·금액)를 그대로 유지한다(자연어 수정으로 종목을 바꾼 경우)", () => {
  const state = completedPlanEditingState();
  const withConditional: FlowState = {
    ...state,
    plan: { ...state.plan, conditionalBuy: { thresholdPercent: 10, amountKrw: 100 } },
  };
  const searching = reducer(withConditional, {
    type: "start_asset_revision",
    query: "테슬라",
    planWithOtherChangesApplied: withConditional.plan,
    returnTo: "editableReview",
  });

  const resolved = reducer(searching, {
    type: "resolve_asset",
    asset: { symbol: "TSLA", displayName: "Tesla Inc", market: "US", quoteCurrency: "USD" },
  });

  assert.equal(resolved.plan.asset.symbol, "TSLA");
  assert.equal(resolved.plan.conditionalBuy?.thresholdPercent, 10, "하락률·금액은 종목과 무관하므로 유지된다");
  assert.equal(resolved.plan.conditionalBuy?.amountKrw, 100);
  assert.equal(resolved.plan.recurring?.amountKrw, 50000, "정기 매수는 종목과 무관하므로 유지된다");
});

test("같은 종목을 다시 선택해도(실질적으로 바뀐 게 없어도) conditionalBuy 는 그대로 유지된다", () => {
  const state = completedPlanEditingState();
  const withConditional: FlowState = {
    ...state,
    plan: { ...state.plan, conditionalBuy: { thresholdPercent: 10, amountKrw: 100 } },
  };
  const searching = reducer(withConditional, {
    type: "start_asset_revision",
    query: "Apple Inc",
    planWithOtherChangesApplied: withConditional.plan,
    returnTo: "editableReview",
  });

  const resolved = reducer(searching, {
    type: "resolve_asset",
    asset: { symbol: "AAPL", displayName: "Apple Inc", market: "US", quoteCurrency: "USD" },
  });

  assert.equal(resolved.plan.conditionalBuy?.thresholdPercent, 10, "같은 종목을 재선택했을 뿐이면 조건부 매수를 지우면 안 된다");
});

// ---------------------------------------------------------------------------
// §복수 종목 입력 — "애플테슬라 4주씩 40만원"
// ---------------------------------------------------------------------------

test("[§복수 종목 입력] assetCandidates 가 2개 이상이면 일반 파싱 실패로 빠지지 않고 assetDisambiguation 을 채운다", () => {
  const submitted = withSubmittedIntent();
  const next = reducer(
    submitted,
    interpretReadyAction({
      fields: {
        assetQuery: null,
        recurring: { frequency: null, weekday: null, amountKrw: 400000 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: null },
      },
      nextQuestion: null,
      selectableAnswers: [],
      hasRecognizableIntent: true,
      assetCandidates: ["애플", "테슬라"],
      ambiguousQuantityText: "4주씩",
    })
  );

  assert.notEqual(next.assetDisambiguation, null, "일반 파싱 실패 문구 대신 종목 선택 카드 상태여야 한다");
  assert.deepEqual(next.assetDisambiguation?.candidates, ["애플", "테슬라"]);
  assert.equal(next.assetDisambiguation?.amountKrw, 400000, "배분 방식은 몰라도 원문 금액은 그대로 보존한다");
  assert.equal(next.assetDisambiguation?.ambiguousQuantityText, "4주씩");
  assert.equal(next.flowState, "clarifying");
  assert.equal(
    next.conversationLog.at(-1)?.text,
    "애플을 매주 5만 원씩 살래요",
    "일반 파싱 실패 문구를 대화 로그에 남기지 않는다"
  );
});

test("[§복수 종목 입력] 종목이 이미 확정된 대화 중에는 assetCandidates 가 와도 무시한다", () => {
  const state = completedPlanEditingState();
  const next = reducer(
    state,
    interpretReadyAction({
      assetCandidates: ["테슬라", "엔비디아"],
      hasRecognizableIntent: true,
    })
  );
  assert.equal(next.assetDisambiguation, null, "종목이 이미 확정됐으면 종목 선택 카드를 다시 띄우지 않는다");
});

test("[§복수 종목 입력] resolve_asset_disambiguation 은 AI 재호출 없이 assetQuery·금액을 채운 채 종목 검색으로 넘긴다", () => {
  const submitted = withSubmittedIntent();
  const withCandidates = reducer(
    submitted,
    interpretReadyAction({
      fields: {
        assetQuery: null,
        recurring: { frequency: null, weekday: null, amountKrw: 400000 },
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: null },
      },
      nextQuestion: null,
      selectableAnswers: [],
      hasRecognizableIntent: true,
      assetCandidates: ["애플", "테슬라"],
      ambiguousQuantityText: null,
    })
  );

  const resolved = reducer(withCandidates, {
    type: "resolve_asset_disambiguation",
    assetQuery: "애플",
    amountKrw: 400000,
    summaryLabel: "애플 · 400,000원",
  });

  assert.equal(resolved.assetDisambiguation, null);
  assert.equal(resolved.interpretFields.assetQuery, "애플");
  assert.equal(resolved.interpretFields.recurring?.amountKrw, 400000);
  assert.equal(resolved.interpretStatus, "ready", "비동기 요청이 없으므로 곧바로 ready 다");
  assert.equal(resolved.flowState, "clarifying", "AssetSearchStep 이 이어서 뜬다");
  assert.equal(resolved.plan.asset.symbol, "", "심볼은 아직 검색으로 확정되지 않았다");
  assert.equal(resolved.conversationLog.at(-1)?.text, "애플 · 400,000원");
});
