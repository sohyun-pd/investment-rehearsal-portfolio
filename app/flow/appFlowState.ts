/**
 * AppFlowState — UI 흐름 전용 상태.
 *
 * 근거: docs/product/STATE_FLOW_V1.md
 *
 * STRATEGY_SCHEMA_V2 의 `PlanLifecycleStatus`(계획 데이터 수명주기)와 **통합하지 않는다.**
 * 두 체계는 명시적 mapping 만 사용한다(§0).
 */

export type AppFlowState =
  | "idle"
  | "interpreting_intent"
  | "clarifying"
  | "plan_ready"
  | "plan_confirmed"
  | "loading_market_data"
  | "simulating"
  | "analysis_ready"
  | "generating_alternatives"
  | "alternatives_ready"
  | "revised_plan_selected"
  | "replaying_revised_plan"
  | "completed";

/** 계획 데이터의 수명주기(STRATEGY_SCHEMA_V2 §3). 화면 사정과 분리해 저장한다. */
export type PlanLifecycleStatus =
  | "onboarding"
  | "collecting_intent"
  | "needs_clarification"
  | "ready_for_review"
  | "awaiting_analysis_approval"
  | "fetching_market_data"
  | "running_simulation"
  | "generating_review"
  | "analysis_ready"
  | "collecting_revision"
  | "generating_alternatives"
  | "comparison_ready"
  | "awaiting_final_approval"
  | "mock_active"
  | "error";

/**
 * AppFlowState → PlanLifecycleStatus 명시적 mapping.
 * `null` 은 대응이 없는 화면 전용 상태로, 직전 lifecycle status 를 유지한다.
 */
export const PLAN_LIFECYCLE_BY_FLOW: Record<AppFlowState, PlanLifecycleStatus | null> = {
  idle: "collecting_intent",
  interpreting_intent: null,
  clarifying: "needs_clarification",
  plan_ready: "ready_for_review",
  plan_confirmed: "awaiting_analysis_approval",
  loading_market_data: "fetching_market_data",
  simulating: "running_simulation",
  analysis_ready: "analysis_ready",
  generating_alternatives: "generating_alternatives",
  alternatives_ready: "comparison_ready",
  revised_plan_selected: "awaiting_final_approval",
  replaying_revised_plan: null,
  completed: "mock_active",
};

/**
 * 화면 식별자. Screen 4-R 은 새 화면이 아니라 Screen 4 레이아웃 재사용이다.
 *
 * `screen_chat` 은 예전 Screen 1(투자 생각 입력)과 Screen 2(명확화 대화)를 하나로 합친
 * 채팅형 화면이다 — 첫 진입·정상 질문·무효 입력·오류 복구를 모두 같은 화면 안에서 다룬다
 * (Screen 1 ↔ Screen 2 왕복, 1/5·2/5 단계 배지를 없앤다).
 */
export type ScreenId =
  | "screen_chat"
  | "screen3_plan"
  | "screen4_analysis"
  | "screen4r_revised"
  | "screen5_compare"
  | "screen_completed";

/** 상태 → 화면. 한 화면이 여러 상태(로딩 포함)를 담당한다. */
export const SCREEN_BY_FLOW: Record<AppFlowState, ScreenId> = {
  idle: "screen_chat",
  interpreting_intent: "screen_chat",
  clarifying: "screen_chat",
  plan_ready: "screen3_plan",
  plan_confirmed: "screen4_analysis",
  loading_market_data: "screen4_analysis",
  simulating: "screen4_analysis",
  analysis_ready: "screen4_analysis",
  generating_alternatives: "screen5_compare",
  alternatives_ready: "screen5_compare",
  revised_plan_selected: "screen5_compare",
  replaying_revised_plan: "screen4r_revised",
  completed: "screen_completed",
};

/** 화면 상단 단계 표시(1–5). `screen_chat` 은 고정 배지 없이 타이틀만 보여준다. */
export const STEP_BY_SCREEN: Record<ScreenId, number | null> = {
  screen_chat: null,
  screen3_plan: 3,
  screen4_analysis: 4,
  screen4r_revised: 4,
  screen5_compare: 5,
  screen_completed: null,
};

export const TOTAL_STEPS = 5;

/** 실패 단계. STRATEGY_SCHEMA_V2 `ProductError.stage` 와 같은 값. */
export type ErrorStage =
  | "conversation"
  | "plan_structure"
  | "asset_resolution"
  | "market_quote"
  | "historical_data"
  | "simulation"
  | "ai_review"
  | "alternative_generation";

export interface FlowError {
  stage: ErrorStage;
  code: string;
  userMessage: string;
  retryable: boolean;
}
