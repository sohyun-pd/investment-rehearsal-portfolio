/**
 * 흐름 상태 관리 — AppFlowState 전이 + sessionStorage 복구.
 *
 * 근거: docs/product/STATE_FLOW_V1.md
 *
 * 실제로 계산·호출하는 부분:
 *  - 시장 데이터: `@/data/market/provider` (기본 실제 BFF, `VITE_USE_MOCK_MARKET=true` 일 때만
 *    오프라인 데모 provider).
 *  - 계획 해석(Screen 2 질문): `@/data/plan/provider` → POST /api/plan/interpret, 실제 Claude
 *    구조화 출력(기본), `VITE_USE_MOCK_AI=true` 일 때만 오프라인 데모 질문 흐름.
 *  - 시뮬레이션: `@/domain/simulation` 엔진에 실제 candles 를 그대로 주입한다.
 * 어느 쪽이든 실패는 실패로 던지고 자동으로 mock 으로 대체하지 않는다.
 *
 * 아직 연결하지 않은 단계(AI 해석 문장·조정안 trade-off 설명)만 mock 타이머로 남아 있다.
 *
 * 오류 화면 확인용: URL 에 `?mockError=ai_review` 처럼 붙이면 그 단계에서 실패 상태를
 * 재현한다(`MockableErrorStage` 값 사용). 계획 해석·시장 데이터·시뮬레이션 오류는 실제
 * 실패로만 재현한다(예: 잘못된 심볼로 조회, 빈 원문 전송).
 */
import * as React from "react";

import {
  SCREEN_BY_FLOW,
  type AppFlowState,
  type ErrorStage,
  type FlowError,
  type ScreenId,
} from "@/flow/appFlowState";
import {
  ADJUSTED_PLAN_POLICY,
  ORIGINAL_PLAN_POLICY,
  SimulationInputError,
  normalizeDayOfMonthInput,
  normalizeWeekdayInput,
  simulatePlan,
  type DailyCandle,
  type SimulationInputErrorCode,
  type SimulationResult,
  type Weekday,
} from "@/domain/simulation";
import {
  ALTERNATIVE_TRADE_OFFS,
  buildAlternativePlans,
  type AlternativeRule,
} from "@/domain/alternatives/buildAlternatives";
import { fetchCandles, fetchQuote, type MarketQuoteDto } from "@/data/market/provider";
import { formatCompanyName } from "@/components/app/PlanCard";
import { interpretPlan, revisePlan } from "@/data/plan/provider";
import { getReview } from "@/data/review/provider";
import { budgetCauseSentence } from "@/lib/simulationCopy";
import { hasMismatchedCurrencyMarker, minAmountFor } from "@/lib/answerParsers";
import { normalizeSearchQuery } from "@/screens/koreanStockAlias";
import { buildFallbackReview } from "@/lib/reviewFallback";
import { MOCK_PLAN } from "@/mocks";
import { clearSession, loadSession, recoverableFlowState, saveSession } from "@/session/planStorage";
import {
  emptyAsset,
  emptyPlan,
  missingPlanRequirements,
  toSimulationPlan,
  type AppPlan,
  type AssetRef,
} from "@/types/appPlan";
import {
  emptyPlanInterpretFields,
  emptyRecurringFields,
  type PlanInterpretAnswerOption,
  type PlanInterpretFieldPath,
  type PlanInterpretFields,
  type PlanInterpretNextQuestion,
} from "@/types/planInterpret";
import type {
  PlanReviseResponse,
  PlanReviseSnapshot,
  ReviseFieldChange,
} from "@/types/planRevise";
import type { BudgetExceededCauseBucket, ReviewRequest } from "@/types/review";

type AiReviewStatus = "idle" | "loading" | "ready" | "error";

export type SelectionId = "current" | "alternative_a" | "alternative_b";

/** 과거 일봉 조회 결과 중 시뮬레이션·화면 기준에 필요한 부분만 담는다. */
interface MarketDataState {
  candles: DailyCandle[];
  actualRange: { from: string; to: string };
  requestedRange: { from: string; to: string };
  completeness: "complete" | "partial" | "insufficient";
  adjustment: "splits";
  dividendAdjusted: false;
  fetchedAt: string;
  /** true 면 실시간 조회가 실패해 서버에 저장된 실제 응답으로 대체된 것이다. */
  fallbackUsed: boolean;
  /** fallbackUsed 일 때만 의미가 있다 — 저장된 스냅샷이 실제로 covering 하는 마지막 거래일. */
  asOfDate?: string;
}

interface QuoteState {
  status: "idle" | "loading" | "ready" | "error";
  data: MarketQuoteDto | null;
  error: FlowError | null;
}

/** 조정안 1개 결과. 값은 TypeScript 규칙(`buildAlternatives.ts`)으로 계산한다. */
export interface Alternative {
  rule: AlternativeRule;
  plan: AppPlan;
  simulation: SimulationResult;
  tradeOff: { benefit: string; cost: string };
}

/** Screen 2 대화 로그 한 줄. 채팅형 화면 표시 전용 — 계획 계산에는 쓰지 않는다. */
export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/** §복수 종목 입력 — 원문에 서로 다른 종목이 2개 이상 등장해 단일 assetQuery 로 표현할 수
 * 없을 때만 채운다(§interpret_ready). 화면(ScreenChat)이 이 값을 보고 일반 파싱 실패 문구
 * 대신 종목 선택 카드를 그린다. AI 재호출 없이 카드 안에서만 로컬로 진행하다가, 종목·금액이
 * 모두 정해지면 `resolve_asset_disambiguation` 한 번으로 끝낸다. */
export interface AssetDisambiguationState {
  candidates: string[];
  /** AI 가 원문에서 그대로 뽑아낸 금액(배분 방식은 아직 모른다) — 없으면 null. */
  amountKrw: number | null;
  /** "4주씩"처럼 매수 주기·수량 중 어느 쪽인지 원문만으로 정할 수 없는 표현. 없으면 null. */
  ambiguousQuantityText: string | null;
}

/** 명확화 질문 한 번의 스냅샷. "이전 질문으로" 는 재호출 없이 이 스택을 되돌린다. */
interface QuestionSnapshot {
  fields: PlanInterpretFields;
  skippedFieldPaths: PlanInterpretFieldPath[];
  currentQuestion: PlanInterpretNextQuestion | null;
  selectableAnswers: PlanInterpretAnswerOption[];
  missingFieldsCount: number;
  conversationLog: ChatTurn[];
  /** 종목 확정(resolve_asset)도 되돌릴 수 있어야 하므로 plan 전체를 함께 남긴다. */
  plan: AppPlan;
}

/** 실제로 추출된 투자 관련 필드가 하나도 없는지 확인한다(투자 의도가 불명확한 입력 차단용).
 * `ScreenChat` 도 같은 기준으로 "종목 검색으로 넘어갈지 / 자유 입력을 다시 받을지"를 정한다. */
export function hasAnyExtractedField(fields: PlanInterpretFields): boolean {
  return (
    (fields.assetQuery !== null && fields.assetQuery.trim() !== "") ||
    fields.recurring !== null ||
    fields.conditionalBuy !== null ||
    fields.guardrails.monthlyBudgetKrw !== null
  );
}

// 오류·실패·"이해하기 어렵다"는 표현을 쓰지 않는다 — 사용자를 탓하지 않고, 바로 따라 입력할
// 수 있는 완성형 예시로 다음 시도를 돕는다(친절한 안내 톤 — 사용자 확정).
// 예시는 국내 종목 지원이 완료되기 전까지 실제로 끝까지 완료되는 미국 종목(애플)만 쓴다
// (§사용자 확정 — 지원하지 않는 국내 종목을 시작 예시로 노출하지 않는다).
const FIRST_INVALID_MESSAGE = "입력한 내용에서 투자 조건을 찾지 못했어요.\n종목과 금액부터 적어주세요.";
const RECOVERY_INVALID_MESSAGE = "어떤 계획부터 만들지 고민된다면,\n아래 예시로 시작해보세요.";

/** API 호출 실패·구조 오류(네트워크·스키마)는 "무효 입력"과 다른 문제라 문구를 분리한다.
 * "실패"·"다시 시도" 같은 표현은 쓰지 않는다 — 사용자 잘못이 아니라 지금 응답을 받지 못한
 * 것뿐이므로, 이미 알아낸 값이 있으면 그대로 두고 조용히 다시 확인할 수 있게만 안내한다
 * (§자유 입력 실패 처리 전면 수정). */
const API_ERROR_MESSAGE_NOTHING_YET = "입력한 내용에서 투자 조건을 찾지 못했어요.\n종목과 금액부터 적어주세요.";
const API_ERROR_MESSAGE_PARTIAL = "지금은 응답을 받지 못했어요.\n잠시 후 다시 확인해주세요.";
/** §로딩 종료 보장 — 종목은 이미 확정된 뒤(예: 검색에서 직접 선택) 다른 값을 마저 채우려는
 * 요청이 오래 걸리거나 끝내 응답하지 않을 때. "처음부터 다시 입력해주세요"로 되돌리지 않고
 * 이미 확정된 종목·값은 그대로 둔 채 계획 카드에서 이어가게 한다. */
const API_ERROR_MESSAGE_TIMEOUT_ASSET_RESOLVED = "종목은 선택했어요.\n나머지 조건을 이어서 확인해주세요.";
/** 이 시간 안에 응답이 오지 않으면 typing indicator 를 무한히 띄워 두지 않고 대신 실패로
 * 취급한다(§로딩 종료 보장 — 최대 대기 시간). */
const INTERPRET_TIMEOUT_MS = 10_000;

/** 채팅형 화면(Screen 1+2 통합) 첫 진입 시 보여주는 단 하나의 고정 안내 메시지 — AI 호출 없이
 * 즉시 표시한다(§사용자 확정 — 캐릭터 자기소개 인사말과 안내 문구가 역할이 겹치고 너무 길어
 * 첫 화면에서 입력창까지 스크롤해야 했다. 인사말을 완전히 없애고 안내 문구 하나만 남긴다).
 * 예시 문장만 "\n\n" 뒤 마지막 문단으로 두어 옅은 글자로 렌더링한다(ScreenChat.tsx dimExample). */
export const CHAT_GREETING =
  "궁금했던 투자 방법이 있나요?\n편하게 적어보세요. 지난 1년 실제 가격으로 바로 확인해드릴게요.\n\n예) 애플을 매달 100달러씩 사고, 평균 매입가보다 10% 낮아지면 50달러 더 살래요";

function initialGreetingLog(): ChatTurn[] {
  return [{ role: "assistant", text: CHAT_GREETING }];
}

/** 완성된 계획을 복구했을 때(또는 최종 확인 바텀시트를 닫았을 때) 보여주는 수정 진입 문구. */
export const EDITABLE_REVIEW_PROMPT = "투자 방법을 어떻게 바꿀까요?";

/**
 * ScreenChat(Screen 1+2 통합) 내부 상태 — 화면에 무엇을 그릴지는 항상 이 값 하나로 결정한다.
 * 여러 boolean 을 조합해 추론하지 않는다(과거 회귀들의 공통 원인).
 *
 *  - empty: 저장된 계획이 없는 신규 진입. currentQuestion 은 반드시 null, deriveNextQuestion
 *    (실제 interpret 호출)을 절대 실행하지 않는다.
 *  - restorePending: 저장된 계획을 발견해 plan 만 임시로 복구했지만, 사용자가 아직 "계속
 *    수정하기/새로 시작하기/계획 확인하기" 중 아무것도 고르지 않은 상태. currentQuestion 은
 *    반드시 null, deriveNextQuestion 을 절대 실행하지 않는다 — 바텀시트만 보여준다.
 *  - collecting: 실제로 질문을 주고받는 상태(신규 대화 진행 중, 또는 미완성 복구 계획에서
 *    "계속 수정하기"를 눌러 이어가는 중). deriveNextQuestion 은 이 상태에서만 실행한다.
 *  - editableReview: 완성된 계획(신규든 복구든)에서 "계속 수정하기"를 누른 뒤의 자연어 수정
 *    상태. ReviseRequestPanel(POST /api/plan/revise)로만 진행한다.
 */
export type ChatPhase = "empty" | "restorePending" | "collecting" | "editableReview";

/**
 * ReviseRequestPanel(자연어 계획 수정)의 화면 상태 — 단일 source of truth. 여러 boolean
 * (loading/open/result 유무)의 조합으로 "지금 뭘 보여줄지"를 추론하지 않는다(§재발했던 회귀:
 * 적용 완료 후에도 이 조합 추론 때문에 수정 입력창이 다시 나타났다).
 *
 *  - idle: "조건을 다르게 수정하고 싶어요" 링크만(또는 아무것도) 보여준다.
 *  - editing: 자유 입력창(+예시 칩) 노출. 되묻는 질문(unresolvedFields)에 답하는 것도 이 상태다.
 *  - parsing: editing 에서 제출한 뒤 POST /api/plan/revise 응답을 기다리는 중. 입력창 유지,
 *    버튼만 loading. 중복 제출 방지.
 *  - preview: 서버가 돌려준 변경 목록을 확인 카드로 보여준다. 입력창은 숨긴다.
 *  - applying: "이대로 적용하기"를 누른 뒤. 확인 카드 유지, CTA loading, 재입력 비활성화.
 *  - applied: 적용 완료. 입력창·확인 카드 모두 닫고 "변경한 조건을 계획에 반영했어요" +
 *    변경 요약 + "수정된 계획 보기"/"다시 수정하기"만 보여준다. "다시 수정하기"를 직접 눌러야만
 *    editing 으로 돌아간다 — 적용 자체가 자동으로 다시 열지 않는다.
 *  - error: 요청 실패. 입력값은 그대로 두고 오류 메시지 + 재시도만 보여준다.
 */
export type RevisionStatus = "idle" | "editing" | "parsing" | "preview" | "applying" | "applied" | "error";

export interface FlowState {
  sessionId: string;
  flowState: AppFlowState;
  chatPhase: ChatPhase;
  plan: AppPlan;
  /** 계획 해석(POST /api/plan/interpret) 진행 상태. 질문 응답을 기다리는 동안 "loading". */
  interpretStatus: "loading" | "ready";
  interpretFields: PlanInterpretFields;
  skippedFieldPaths: PlanInterpretFieldPath[];
  currentQuestion: PlanInterpretNextQuestion | null;
  selectableAnswers: PlanInterpretAnswerOption[];
  /** §복수 종목 입력 — non-null 인 동안은 currentQuestion·자유 입력창 대신 종목 선택 카드를
   * 보여준다(§ScreenChat needsAssetSearch/needsFreeInput 이 이 값도 함께 확인한다). */
  assetDisambiguation: AssetDisambiguationState | null;
  /** 마지막 응답의 missingFields 개수 — "n개만 더 여쭤볼게요" 진행 안내용(참고치, 정답 아님). */
  missingFieldsCount: number;
  /** 답변할 때마다 쌓는다. "이전 질문으로" 가 재호출 없이 여기서 하나씩 되돌린다. */
  questionHistory: QuestionSnapshot[];
  /** Screen 2 채팅형 화면에 표시하는 대화 로그(표시 전용, 계획 계산과 무관). */
  conversationLog: ChatTurn[];
  /** 연속으로 투자 의도를 알아볼 수 없었던 횟수. 2회부터 예시 계획 복구 UI를 보여준다. */
  invalidInputStreak: number;
  /** 종목이 이미 확정된 뒤 AI 가 그래도 종목 관련 질문을 다시 만들어냈을 때만 채운다(§문제 1
   * 구조적 방어) — 화면·대화 로그에 보여주지 않고, 이 필드를 본 effect 가 조용히 재요청한다. */
  pendingAutoRetrySkip: PlanInterpretFieldPath | null;
  /** 종목이 이미 확정된 대화 중에 사용자가 다른 종목명을 새로 말했을 때만 채운다(§사용자
   * 확정 — "애플 대화 중 테슬라를 입력했는데 이전 종목이 남는 오류"). 이 값이 있으면
   * `plan.asset.symbol` 이 비어 있지 않아도 종목 검색을 다시 보여준다 — 검색이 끝나면(§
   * resolve_asset) null 로 되돌린다. */
  pendingAssetChangeQuery: string | null;
  /** 수정 요청(POST /api/plan/revise)에서 종목 변경이 제안됐을 때, 자산 검색 화면을 다시
   * 거친 뒤 곧바로 plan_ready 로 넘어가야 함을 표시한다(§확인할 파일: AssetSearchStep 재사용). */
  pendingPlanReadyAfterAsset: boolean;
  /** 종목 변경 검색이 시작되기 직전의 계획(다른 변경은 이미 반영된 상태 포함)과, 뒤로가기를
   * 누르면 어디로 돌아가야 하는지를 함께 담아 둔다. null 이면 "지금 진행 중인 종목 검색이
   * 일반 계획 생성 흐름이다"라는 뜻이라 기존 back() 로직을 그대로 따른다(§재발했던 회귀 —
   * questionHistory 가 비어 있어 되돌릴 곳이 없다고 보고 계획 전체를 초기화해버림). */
  revisionAssetRevertPlan: { plan: AppPlan; returnTo: "editableReview" | "planReady" } | null;
  /** §종목 수정 UX 변경(§사용자 확정) — 계획 확인 화면에서 종목을 직접 편집(apply_asset_edit)해
   * 통화가 바뀌었을 때만 true 다. hasMismatchedCurrencyMarker 같은 원문 텍스트 휴리스틱이
   * 아니라, 이 편집이 실제로 통화를 바꿨다는 사실 자체를 명시적으로 남긴다. 금액을 다시
   * 채우면(정기 매수·추가 매수 편집 시트 적용, apply_direct_plan_edit) 꺼진다. */
  assetCurrencyReentryRequired: boolean;
  revise: {
    status: RevisionStatus;
    result: PlanReviseResponse | null;
    /** "applied" 상태에서만 채운다 — 방금 실제로 반영된 변경 목록(요약 카드용). */
    appliedChanges: ReviseFieldChange[] | null;
    /** "error" 상태에서만 채운다 — 계획 해석(interpret) 실패와 공유하지 않는 전용 오류. */
    error: FlowError | null;
  };
  marketData: MarketDataState | null;
  quote: QuoteState;
  /** 원래 계획 기준 결과. */
  simulation: SimulationResult | null;
  /** 결과가 어느 계획 버전으로 계산됐는지. plan.version 과 다르면 재계산이 필요하다. */
  simulatedPlanVersion: number | null;
  aiReview: { status: AiReviewStatus; headline: string; risks: string[] };
  alternatives: Alternative[];
  selectedId: SelectionId | null;
  error: FlowError | null;
  /** 새로고침 복구 안내를 한 번 보여주기 위한 플래그. */
  restoredFromSession: boolean;
  /** 첫 진입 인사말 두 번째 말풍선이 이미 나타났는지 — false 인 동안만 `ScreenChat` 이 지연
   * 애니메이션을 재생한다. 세션 복구 시에는 항상 true 로 시작해 애니메이션을 다시 재생하지
   * 않는다(§사용자 확정). */
  greetingRevealed: boolean;
}

export type Action =
  | { type: "restore"; plan: AppPlan; flowState: AppFlowState; sessionId: string }
  | { type: "submit_intent"; input: string }
  | { type: "resolve_asset"; asset: AssetRef }
  /** §복수 종목 입력 — 종목 선택 카드가 로컬로 모든 모호함(종목·금액 배분·수량 뜻)을 끝낸
   * 뒤 한 번만 dispatch 한다. AI 를 다시 부르지 않고, 곧바로 기존 종목 검색(AssetSearchStep)
   * 흐름으로 넘긴다 — assetQuery 가 채워진 채 심볼만 아직 없는 상태와 동일하게 취급된다. */
  | {
      type: "resolve_asset_disambiguation";
      assetQuery: string;
      amountKrw: number | null;
      /** 대화 로그에 남길 사용자 선택 요약(예: "애플 · 40만 원 · 4주마다"). */
      summaryLabel: string;
    }
  | {
      type: "answer_field_start";
      fields: PlanInterpretFields;
      skippedFieldPaths: PlanInterpretFieldPath[];
      answerLabel: string;
    }
  | {
      type: "interpret_ready";
      fields: PlanInterpretFields;
      skippedFieldPaths: PlanInterpretFieldPath[];
      nextQuestion: PlanInterpretNextQuestion | null;
      selectableAnswers: PlanInterpretAnswerOption[];
      missingFieldsCount: number;
      isPlanReady: boolean;
      isFreshIntent: boolean;
      /** AI 가 투자 관련 의도를 조금이라도 알아봤는지(§hasAnyExtractedField 와 다르다 — 값이
       * 하나도 없어도 의도 자체는 분명할 수 있다. 예: "한 달 예산 안에서 투자하고 싶어요"). */
      hasRecognizableIntent: boolean;
      /** §복수 종목 입력 — 2개 이상이면 채워진다. 기존 테스트 호출부를 깨지 않도록 선택 필드로
       * 둔다(생략 시 null 취급). */
      assetCandidates?: string[] | null;
      ambiguousQuantityText?: string | null;
    }
  | { type: "advance_plan_ready" }
  | { type: "auto_skip_field"; fieldPath: PlanInterpretFieldPath }
  | { type: "enter_editable_review" }
  | { type: "continue_restored_plan"; interpretFields: PlanInterpretFields; incomplete: boolean }
  | { type: "back" }
  | { type: "confirm_plan" }
  | { type: "market_data_loaded"; marketData: MarketDataState }
  | { type: "quote_loading" }
  | { type: "quote_ready"; quote: MarketQuoteDto }
  | { type: "quote_failed"; error: FlowError }
  | { type: "simulation_done"; simulation: SimulationResult }
  | { type: "ai_review_loading" }
  | { type: "ai_review_ready"; headline: string; risks: string[] }
  /** "조건을 다르게 수정하고 싶어요" 클릭, 또는 applied 상태에서 "다시 수정하기" 클릭 —
   * 이 두 경우에만 editing 으로 들어간다(적용 직후 자동으로 열리지 않는다). */
  | { type: "revise_start_editing" }
  | { type: "revise_requested" }
  | { type: "revise_ready"; result: PlanReviseResponse }
  | { type: "revise_dismissed" }
  /** "이대로 적용하기" 클릭 직후 — 중복 클릭 방지용 짧은 중간 상태(applying). */
  | { type: "revise_applying" }
  | { type: "revise_failed"; error: FlowError }
  | { type: "apply_revision"; plan: AppPlan; changes: ReviseFieldChange[] }
  | {
      type: "start_asset_revision";
      query: string;
      planWithOtherChangesApplied: AppPlan;
      /** 검색 중 뒤로가기를 누르면 어디로 돌아갈지 — 자연어 수정(editableReview)에서 시작했는지,
       * 계획 확인 화면(PlanCard 의 "종목" 행)에서 곧바로 시작했는지에 따라 다르다. */
      returnTo: "editableReview" | "planReady";
    }
  /** 계획 확인 화면의 개별 필드 수정 시트("변경 내용 확인하기")에서 쓴다 — AI 파싱을 거치지
   * 않는 결정적 UI 편집이라, 이미 다 채워진 plan 을 그대로 반영하기만 한다. */
  | { type: "apply_direct_plan_edit"; plan: AppPlan }
  /** 계획 확인 화면의 "종목 변경"에서 검색 bottom sheet 로 직접 고른 결과 — 채팅 화면으로
   * 이동하지 않고, 대화 로그도 남기지 않고, AI 재해석도 호출하지 않는 결정적 편집이다(§종목
   * 수정 UX 변경, §사용자 확정). */
  | { type: "apply_asset_edit"; asset: AssetRef }
  | { type: "request_alternatives" }
  | { type: "alternatives_ready"; alternatives: Alternative[] }
  | { type: "select"; id: SelectionId }
  | { type: "approve" }
  | { type: "finish" }
  | { type: "edit_plan" }
  | { type: "fail"; error: FlowError }
  | { type: "clear_error" }
  | { type: "load_demo_plan"; plan: AppPlan }
  | { type: "reset" }
  /** 첫 진입 인사말 두 번째 말풍선이 실제로 나타난 순간 — 이후 재생하지 않도록 한 번만
   * dispatch 한다(§ScreenChat.tsx 지연 타이머). */
  | { type: "greeting_revealed" };

function createSessionId(): string {
  return `sess_${Date.now().toString(36)}`;
}

const EMPTY_QUOTE_STATE: QuoteState = { status: "idle", data: null, error: null };
const IDLE_REVISE_STATE: FlowState["revise"] = {
  status: "idle",
  result: null,
  appliedChanges: null,
  error: null,
};

export function initialState(): FlowState {
  return {
    sessionId: createSessionId(),
    flowState: "idle",
    chatPhase: "empty",
    plan: emptyPlan(),
    // 앱 시작 시점엔 진행 중인 해석 호출이 없다 — "loading"으로 두면(예전엔 Screen 1 이
    // interpretStatus 를 보지 않아 무해했지만) 채팅형 화면의 "응답 대기 중" 판정과 겹쳐
    // 첫 진입 시 자유 입력창이 아예 안 보이는 문제가 생긴다.
    interpretStatus: "ready",
    interpretFields: emptyPlanInterpretFields(),
    skippedFieldPaths: [],
    currentQuestion: null,
    selectableAnswers: [],
    assetDisambiguation: null,
    missingFieldsCount: 0,
    questionHistory: [],
    conversationLog: initialGreetingLog(),
    invalidInputStreak: 0,
    pendingAutoRetrySkip: null,
    pendingAssetChangeQuery: null,
    pendingPlanReadyAfterAsset: false,
    revisionAssetRevertPlan: null,
    assetCurrencyReentryRequired: false,
    revise: IDLE_REVISE_STATE,
    marketData: null,
    quote: EMPTY_QUOTE_STATE,
    simulation: null,
    simulatedPlanVersion: null,
    aiReview: { status: "idle", headline: "", risks: [] },
    alternatives: [],
    selectedId: null,
    error: null,
    restoredFromSession: false,
    greetingRevealed: false,
  };
}

/** 다음 질문으로 넘어가기 전 스냅샷을 남긴다("이전 질문으로" 용). */
function snapshotQuestion(state: FlowState): QuestionSnapshot {
  return {
    fields: state.interpretFields,
    skippedFieldPaths: state.skippedFieldPaths,
    currentQuestion: state.currentQuestion,
    selectableAnswers: state.selectableAnswers,
    missingFieldsCount: state.missingFieldsCount,
    conversationLog: state.conversationLog,
    plan: state.plan,
  };
}

/** 히스토리에서 하나를 꺼내 그 시점 질문으로 되돌린다. 재호출하지 않는다. */
function popQuestionHistory(state: FlowState, flowState: AppFlowState): FlowState {
  if (state.questionHistory.length === 0) return { ...state, flowState };
  const previous = state.questionHistory[state.questionHistory.length - 1]!;
  return {
    ...state,
    flowState,
    questionHistory: state.questionHistory.slice(0, -1),
    interpretFields: previous.fields,
    skippedFieldPaths: previous.skippedFieldPaths,
    currentQuestion: previous.currentQuestion,
    selectableAnswers: previous.selectableAnswers,
    assetDisambiguation: null,
    missingFieldsCount: previous.missingFieldsCount,
    conversationLog: previous.conversationLog,
    plan: previous.plan,
    interpretStatus: "ready",
    // 종목 변경 검색 중 뒤로가기를 누르면 검색 화면이 계속 뜨는 채로 남지 않게 한다(§사용자
    // 확정 — 뒤로가기로 복구할 수 없는 오류 방지).
    pendingAssetChangeQuery: null,
  };
}

/**
 * 계획이 바뀌면 계산 결과를 무효화한다(STATE_FLOW_V1 §15.9, §29).
 * market data(candles·quote) 도 함께 버린다 — 종목이 바뀔 수 있는 지점(새 계획 시작,
 * 명확화 답변, 로딩 중 취소)에서만 쓴다.
 */
function invalidateResults(state: FlowState): FlowState {
  return {
    ...state,
    marketData: null,
    quote: EMPTY_QUOTE_STATE,
    simulation: null,
    simulatedPlanVersion: null,
    aiReview: { status: "idle", headline: "", risks: [] },
    alternatives: [],
    selectedId: null,
  };
}

/**
 * 분석 이후 조건을 직접 고칠 때 쓴다(§15.9). `marketData.candles` 는 **재사용**한다 —
 * 재조회하지 않고 재계산만 한다.
 */
function invalidateAnalysisKeepMarketData(state: FlowState): FlowState {
  return {
    ...state,
    simulation: null,
    simulatedPlanVersion: null,
    aiReview: { status: "idle", headline: "", risks: [] },
    alternatives: [],
    selectedId: null,
  };
}

export function reducer(state: FlowState, action: Action): FlowState {
  switch (action.type) {
    case "restore": {
      if (action.flowState !== "idle") {
        // Screen 3 이후로 복구되면 이 화면(ScreenChat)의 상태 파생이 필요 없다 — Screen3PlanConfirm
        // 은 plan 만 보고 그린다.
        return {
          ...state,
          sessionId: action.sessionId,
          plan: action.plan,
          flowState: action.flowState,
          restoredFromSession: true,
          greetingRevealed: true,
        };
      }

      // ScreenChat(Screen 1+2 통합)으로 복구되는 경우 — plan 데이터만 임시로 되살리고, 그 외
      // 아무것도 자동으로 실행하지 않는다("restorePending"). currentFields 계산·실제 interpret
      // 호출(deriveNextQuestion)·대화 로그 추가·로딩 말풍선은 전부 사용자가 바텀시트에서 명시적
      // 으로 "계속 수정하기"를 고른 뒤에만 일어난다(§continue_restored_plan). 완성/미완성 여부와
      // 무관하게 항상 이 대기 상태로만 진입한다 — 재발했던 회귀(복구 직후 자동으로 질문 생성)의
      // 원인이 바로 여기서 곧장 loading 으로 넘어갔던 것이었다.
      return {
        ...state,
        sessionId: action.sessionId,
        plan: action.plan,
        currentQuestion: null,
        selectableAnswers: [],
        interpretStatus: "ready",
        chatPhase: "restorePending",
        flowState: "clarifying",
        restoredFromSession: true,
        greetingRevealed: true,
      };
    }

    case "submit_intent":
      // 채팅형 화면(Screen 1+2 통합)에서는 첫 메시지든 무효 입력 재시도든 같은 액션을 쓴다 —
      // 자유 입력은 항상 "구조화된 질문이 없는" 상태에서만 가능해, 이 시점의 interpretFields 등은
      // 이미 비어 있다(무효 입력 분기가 값을 채우지 않기 때문). 대화 로그는 지우지 않고 이어 붙인다.
      return {
        ...invalidateResults(state),
        plan: { ...state.plan, originalInput: action.input },
        interpretStatus: "loading",
        interpretFields: emptyPlanInterpretFields(),
        skippedFieldPaths: [],
        currentQuestion: null,
        selectableAnswers: [],
        assetDisambiguation: null,
        missingFieldsCount: 0,
        questionHistory: [],
        conversationLog: [...state.conversationLog, { role: "user", text: action.input }],
        chatPhase: "collecting",
        flowState: "interpreting_intent",
        error: null,
      };

    case "resolve_asset": {
      // §종목 선택은 AI 재해석 없이 처리(§사용자 확정) — 사용자가 검색 결과에서 종목을 직접
      // 골랐다는 것 자체가 이미 확정된 값이다. 여기서 Claude 를 다시 부르면, 원문(originalInput)
      // 에 남아 있는 예전 종목 표현(예: 검색으로 이어지게 만든 "카카오톡")을 AI 가 "지금 확정된
      // 종목과 다른 회사"로 다시 인식해 종목 변경을 되묻는 무한 루프가 생긴다(§재발했던 회귀 —
      // 실제로 서버 응답이 다시 nextQuestion.fieldPath="assetQuery" 를 돌려보내 pendingAssetChangeQuery
      // 가 다시 세워지고, 같은 종목을 다시 골라도 매번 20초 가까이 걸리는 요청이 반복됐다).
      // 그래서 여기서는 로컬 상태만 바꾸고 비동기 요청을 전혀 하지 않는다 — 무한 로딩도
      // 구조적으로 발생할 수 없다.
      const newAsset = { ...action.asset, displayName: formatCompanyName(action.asset.displayName) };
      // 선택한 종목 메시지는 selection 당 한 번만 남긴다(§중복 선택 방지) — 화면에 이미 뜬
      // "어떤 종목에 투자하고 싶으신가요?" 질문을 대화 로그에 다시 기록하지 않는다(그대로
      // 두면 방금 고른 종목 위에 똑같은 질문·답변 쌍이 매번 새로 쌓인다).
      const conversationLog = [
        ...state.conversationLog,
        { role: "user" as const, text: `${formatCompanyName(newAsset.displayName)} (${newAsset.symbol})` },
      ];
      const baseNext = {
        ...state,
        questionHistory: [...state.questionHistory, snapshotQuestion(state)],
        conversationLog,
        pendingAssetChangeQuery: null,
        currentQuestion: null,
        selectableAnswers: [],
        assetDisambiguation: null,
        invalidInputStreak: 0,
        // 비동기 요청이 전혀 없으므로 곧바로 "ready" 다 — "loading" 으로 남겨 두면 그 상태를
        // 끝낼 응답이 없어 typing indicator 가 영원히 사라지지 않는다(§무한 로딩 회귀).
        interpretStatus: "ready" as const,
        flowState: "plan_ready" as const,
      };

      // pendingPlanReadyAfterAsset(계획 확인·수정 화면에서 다시 검색)·isAssetChange(대화 중
      // 이미 확정돼 있던 종목을 다른 회사로 바꾼 경우) 둘 다 plan.recurring/conditionalBuy 가
      // 이미 완성돼 있을 수 있는 지점이다 — interpretFields 로 다시 조립하면 그 사이 plan 에
      // 직접 반영된 값(예: "수정" 시트로 고친 값, guardrails)을 잃어버리므로, 있는 plan 에
      // 종목만 그대로 얹는다.
      if (state.pendingPlanReadyAfterAsset || state.pendingAssetChangeQuery !== null) {
        const planWithAsset: AppPlan = { ...state.plan, asset: newAsset };
        const mismatched = hasMismatchedCurrencyMarker(planWithAsset.originalInput, newAsset.quoteCurrency);
        const finalPlan = mismatched
          ? clearMaxCountIfConditionalDisabled({ ...planWithAsset, recurring: null, conditionalBuy: null })
          : planWithAsset;
        return {
          ...baseNext,
          plan: finalPlan,
          interpretFields: clearAmountsIfCurrencyMismatched(
            { ...state.interpretFields, assetQuery: newAsset.symbol },
            newAsset.quoteCurrency,
            planWithAsset.originalInput
          ),
          pendingPlanReadyAfterAsset: false,
          revisionAssetRevertPlan: null,
        };
      }

      // 첫 검색(종목이 여태 한 번도 확정된 적 없음) — 지금까지 추출된 값의 authoritative
      // source 는 interpretFields 다(plan.recurring/conditionalBuy 는 종목이 없어 아직
      // 완성되지 못했을 수 있다 — 여기서 처음으로 완성한다).
      const adjustedInterpretFields = clearAmountsIfCurrencyMismatched(
        { ...state.interpretFields, assetQuery: newAsset.symbol },
        newAsset.quoteCurrency,
        state.plan.originalInput
      );
      const mergedPlan = mergeInterpretFieldsIntoPlan({ ...state.plan, asset: newAsset }, adjustedInterpretFields);
      return { ...baseNext, plan: mergedPlan, interpretFields: adjustedInterpretFields };
    }

    // §복수 종목 입력 — 종목 선택 카드가 로컬로 끝낸 결과를 한 번에 반영한다. AI 를 다시
    // 부르지 않고, "종목 텍스트는 있지만 심볼은 아직 없는" 일반적인 중간 상태로 만들어
    // 기존 needsAssetSearch(AssetSearchStep) 흐름을 그대로 재사용한다(§자동 단일 후보 해결도
    // 그대로 적용된다).
    case "resolve_asset_disambiguation": {
      const fields: PlanInterpretFields = {
        assetQuery: action.assetQuery,
        recurring:
          action.amountKrw !== null
            ? { frequency: null, weekday: null, dayOfMonth: null, amountKrw: action.amountKrw }
            : null,
        conditionalBuy: null,
        guardrails: { monthlyBudgetKrw: null },
      };
      const mergedPlan = mergeInterpretFieldsIntoPlan(state.plan, fields);
      return {
        ...state,
        assetDisambiguation: null,
        interpretFields: fields,
        plan: mergedPlan,
        interpretStatus: "ready",
        currentQuestion: null,
        selectableAnswers: [],
        invalidInputStreak: 0,
        conversationLog: [...state.conversationLog, { role: "user", text: action.summaryLabel }],
        flowState: "clarifying",
      };
    }

    case "answer_field_start":
      return {
        ...state,
        questionHistory: [...state.questionHistory, snapshotQuestion(state)],
        interpretStatus: "loading",
        // 응답이 오기 전에도 즉시 반영한다 — 실패해도 이미 답한 값을 잃지 않고, retry() 가
        // 최신 값으로 같은 요청을 다시 보낼 수 있다.
        interpretFields: action.fields,
        skippedFieldPaths: action.skippedFieldPaths,
        conversationLog: [...state.conversationLog, { role: "user", text: action.answerLabel }],
      };

    case "interpret_ready": {
      // 투자 의도를 전혀 알아볼 수 없는 입력(예: "ㄴㅋㅋㅋㅋ", "안녕하세요")은 다음 단계로 넘기지
      // 않는다 — 채팅형 화면을 벗어나지 않고, 거절 메시지를 assistant 말풍선으로 추가한 뒤
      // 다시 자유 입력을 받는다(§P0 잘못된 입력 처리). 화면 전환·세션 초기화는 하지 않는다.
      // hasAnyExtractedField 가 아니라 hasRecognizableIntent 로 판단한다 — "한 달 예산 안에서
      // 투자하고 싶어요"처럼 구체적인 숫자가 아직 없어도 의도가 분명한 입력을, 값이 없다는
      // 이유만으로 잘못된 입력 취급하던 회귀를 고쳤다(§재발했던 회귀: nextQuestion 은 의도를
      // 못 알아봤을 때도 항상 채워지므로 hasAnyExtractedField 만으로는 둘을 구분할 수 없었다).
      if (action.isFreshIntent && !action.hasRecognizableIntent) {
        const nextStreak = state.invalidInputStreak + 1;
        const message = nextStreak >= 2 ? RECOVERY_INVALID_MESSAGE : FIRST_INVALID_MESSAGE;
        return {
          ...state,
          interpretStatus: "ready",
          invalidInputStreak: nextStreak,
          currentQuestion: null,
          selectableAnswers: [],
          assetDisambiguation: null,
          conversationLog: [...state.conversationLog, { role: "assistant", text: message }],
          flowState: "clarifying",
        };
      }

      // §복수 종목 입력 — 종목이 아직 확정되지 않은 상태에서 서로 다른 종목이 2개 이상
      // 감지되면, 일반 파싱 실패로 보여주지 않고 종목 선택 카드를 그린다(§사용자 확정 —
      // "AI가 못 알아들은 게 아니라 복수 종목과 모호한 금액 배분을 확인해야 하는 입력이야").
      // 이미 종목이 확정된 대화 중에는(symbolResolved) 이 분기를 타지 않는다 — 서버 프롬프트도
      // 그 경우 assetCandidates 를 채우지 않지만, 클라이언트에서도 한 번 더 막는다.
      if (
        state.plan.asset.symbol.trim() === "" &&
        action.assetCandidates !== undefined &&
        action.assetCandidates !== null &&
        action.assetCandidates.length >= 2
      ) {
        return {
          ...state,
          interpretStatus: "ready",
          currentQuestion: null,
          selectableAnswers: [],
          assetDisambiguation: {
            candidates: action.assetCandidates,
            amountKrw: action.fields.recurring?.amountKrw ?? null,
            ambiguousQuantityText: action.ambiguousQuantityText ?? null,
          },
          invalidInputStreak: 0,
          flowState: "clarifying",
        };
      }

      const guardedFields = guardAgainstFieldDrift(
        state.interpretFields,
        action.fields,
        state.currentQuestion?.fieldPath ?? null
      );
      const mergedPlan = mergeInterpretFieldsIntoPlan(state.plan, guardedFields);
      const symbolResolved = mergedPlan.asset.symbol.trim() !== "";

      // 종목이 이미 확정된 뒤에도 AI 가 assetQuery 를 다시 채워 보내는 두 가지 경우를
      // 구분한다(§사용자 확정 — "애플 대화 중 테슬라를 입력했는데 이전 종목이 남는 오류").
      //  1. 같은 종목을 다시 확인·언급한 재질문 — 화면·대화 로그에 절대 노출하지 않고 조용히
      //     건너뛴다(기존 동작).
      //  2. 원문에 실제로 다른 회사명이 새로 등장한 종목 변경 요청 — 종목 검색을 다시 열어
      //     사용자가 직접 확정하게 한다. 이때 이미 확정돼 있던 정기 매수·조건부 매수·월
      //     예산은(§관련 없는 값을 임의로 지우지 않는다) 그대로 두고, 종목이 실제로 바뀌면
      //     resolve_asset 에서 통화에 의존하는 평균 매수가만 따로 정리한다.
      const isExplicitAssetChange =
        symbolResolved &&
        action.nextQuestion?.fieldPath === "assetQuery" &&
        action.fields.assetQuery !== null &&
        action.fields.assetQuery.trim() !== "" &&
        !mentionsCurrentAsset(action.fields.assetQuery, state.plan.asset);

      if (isExplicitAssetChange) {
        return {
          ...state,
          questionHistory: [...state.questionHistory, snapshotQuestion(state)],
          interpretStatus: "ready",
          interpretFields: guardedFields,
          plan: mergedPlan,
          currentQuestion: null,
          selectableAnswers: [],
          assetDisambiguation: null,
          invalidInputStreak: 0,
          pendingAssetChangeQuery: action.fields.assetQuery!.trim(),
          flowState: "clarifying",
        };
      }

      if (symbolResolved && action.nextQuestion?.fieldPath === "assetQuery") {
        return {
          ...state,
          interpretStatus: "loading",
          interpretFields: guardedFields,
          plan: mergedPlan,
          currentQuestion: null,
          selectableAnswers: [],
          assetDisambiguation: null,
          invalidInputStreak: 0,
          pendingAutoRetrySkip: "assetQuery",
          flowState: "clarifying",
        };
      }

      // §사용자 확정(입력 방식 재설계) — 종목이 확정되면 정기 매수·조건부 매수·월 예산이
      // 비어 있어도 채팅으로 하나씩 다시 묻지 않는다. AI 가 추출한 값은 그대로 반영하고,
      // 나머지는 곧바로 계획 카드(Screen3PlanConfirm)에서 한 번에 채운다 — 일문일답 질문·
      // selectableAnswers·"AI 가 이미 그 질문을 하고 있는지" 판단 로직은 더 이상 쓰지 않는다.
      if (symbolResolved) {
        return {
          ...state,
          interpretStatus: "ready",
          interpretFields: guardedFields,
          skippedFieldPaths: action.skippedFieldPaths,
          currentQuestion: null,
          selectableAnswers: [],
          assetDisambiguation: null,
          missingFieldsCount: action.missingFieldsCount,
          plan: mergedPlan,
          invalidInputStreak: 0,
          pendingAutoRetrySkip: null,
          flowState: "plan_ready",
        };
      }

      // 종목이 아직 확정되지 않았으면(검색이 더 필요하거나 여러 후보 중 골라야 함) 계획 카드로
      // 넘어가지 않고 대기한다 — AssetSearchStep 이 이어서 뜬다(§7 종목 후보 모호성 예외).
      return {
        ...state,
        interpretStatus: "ready",
        interpretFields: guardedFields,
        skippedFieldPaths: action.skippedFieldPaths,
        currentQuestion: null,
        selectableAnswers: [],
        assetDisambiguation: null,
        missingFieldsCount: action.missingFieldsCount,
        plan: mergedPlan,
        invalidInputStreak: 0,
        pendingAutoRetrySkip: null,
        flowState: "clarifying",
      };
    }

    case "advance_plan_ready":
      return { ...state, flowState: "plan_ready" };

    // 종목(assetQuery)이 이미 확정된 뒤(plan.symbol !== "") AI 가 그래도 종목 관련 질문을
    // 다시 만들어내면(예: "추가 매수 종목은 무엇인가요?"), 화면에 보여주지 않고 조용히
    // skippedFieldPaths 에 추가해 재요청한다 — "종목 재질문 금지"를 서버 프롬프트 하나에만
    // 맡기지 않고 클라이언트에서도 구조적으로 보장한다(§completed field set 기준 계산).
    // interpret_ready 가 이미 interpretStatus/currentQuestion 을 정리해 뒀다(위 §문제 1) —
    // 여기서는 skippedFieldPaths 를 확정하고 pendingAutoRetrySkip 깃발을 내려, 재요청을
    // 보낸 effect 가 같은 필드를 두 번 재요청하지 않게 한다.
    case "auto_skip_field":
      return {
        ...state,
        skippedFieldPaths: state.skippedFieldPaths.includes(action.fieldPath)
          ? state.skippedFieldPaths
          : [...state.skippedFieldPaths, action.fieldPath],
        pendingAutoRetrySkip: null,
      };

    // 완성된 계획을 확인/복구한 뒤 "계속 수정하기"로 넘어갈 때 한 번만 안내 말풍선을 남긴다
    // (같은 문구가 이미 마지막 메시지면 중복 추가하지 않는다 — 바텀시트를 여러 번 열고 닫아도
    // 채팅이 지저분해지지 않는다).
    case "enter_editable_review": {
      // ReviseRequestPanel 의 "defaultOpen" prop 대신 여기서 곧바로 editing 으로 연다 — 열림
      // 여부가 컴포넌트 로컬 상태가 아니라 이 reducer 하나로 정해지게 한다.
      if (state.conversationLog.at(-1)?.text === EDITABLE_REVIEW_PROMPT) {
        return { ...state, chatPhase: "editableReview", revise: { ...IDLE_REVISE_STATE, status: "editing" } };
      }
      return {
        ...state,
        chatPhase: "editableReview",
        revise: { ...IDLE_REVISE_STATE, status: "editing" },
        conversationLog: [...state.conversationLog, { role: "assistant", text: EDITABLE_REVIEW_PROMPT }],
      };
    }

    // "restorePending" 바텀시트에서 사용자가 "계속 수정하기"를 명시적으로 골랐을 때만 실행된다
    // — deriveNextQuestion(실제 interpret 호출)과 대화 로그 갱신은 여기서부터 시작한다. 미완성
    // 이면 이어서 물을 질문을 실제로 받아와야 하므로 loading 으로 전환하고(별도 context
    // 메서드가 곧바로 runInterpret 를 호출한다), 완성된 계획이면 수정 진입 문구를 한 번만 남긴다.
    case "continue_restored_plan": {
      const alreadySeeded = state.conversationLog.at(-1)?.text === EDITABLE_REVIEW_PROMPT;
      return {
        ...state,
        chatPhase: action.incomplete ? "collecting" : "editableReview",
        interpretFields: action.interpretFields,
        interpretStatus: action.incomplete ? "loading" : "ready",
        currentQuestion: null,
        selectableAnswers: [],
        revise: action.incomplete ? state.revise : { ...IDLE_REVISE_STATE, status: "editing" },
        conversationLog:
          !action.incomplete && !alreadySeeded
            ? [...state.conversationLog, { role: "assistant", text: EDITABLE_REVIEW_PROMPT }]
            : state.conversationLog,
      };
    }

    case "back": {
      switch (state.flowState) {
        case "clarifying":
          // 수정(revise) 흐름에서 시작된 종목 검색이면 questionHistory 와 무관하게 항상 여기서
          // 먼저 처리한다 — 그러지 않으면 questionHistory 가 비어 있을 때(수정 흐름은 별도
          // 이력을 쌓지 않는다) 아래 "대화 시작 전으로 완전히 되돌리기" 분기가 잘못 실행돼
          // 이미 완성돼 있던 계획 전체가 초기화됐다(§재발했던 회귀 — 종목 변경 확인 후 뒤로가기
          // 하면 정기 매수·예산 등 기존 계획이 통째로 사라짐).
          if (state.revisionAssetRevertPlan !== null) {
            const { plan: revertPlan, returnTo } = state.revisionAssetRevertPlan;
            const restored = {
              ...invalidateResults(state),
              plan: revertPlan,
              interpretFields: planToInterpretFields(revertPlan),
              revisionAssetRevertPlan: null,
              pendingPlanReadyAfterAsset: false,
              currentQuestion: null,
              selectableAnswers: [],
              interpretStatus: "ready" as const,
            };
            // PlanCard(계획 확인 화면)의 "종목" 행에서 곧바로 검색을 시작했다면 다시 계획
            // 확인 화면으로 — 자연어 수정(editableReview)에서 시작했다면 그 수정 화면으로.
            return returnTo === "planReady"
              ? { ...restored, flowState: "plan_ready" as const }
              : {
                  ...restored,
                  chatPhase: "editableReview" as const,
                  revise: { status: "editing" as const, result: null, appliedChanges: null, error: null },
                  flowState: "clarifying" as const,
                };
          }
          // 되돌릴 이전 질문이 없으면(예: 종목 검색 화면에서 더 back) 대화를 시작하기
          // 전(§empty)으로 완전히 되돌린다 — flowState 만 idle 로 바꾸고 currentQuestion·
          // chatPhase·plan.symbol 을 그대로 두면(예전 동작) 이미 지나간 질문 칩이 그대로
          // 남아 empty 상태의 불변식(currentQuestion 은 반드시 null)이 깨진다.
          return state.questionHistory.length === 0
            ? {
                ...invalidateResults(state),
                flowState: "idle",
                chatPhase: "empty",
                plan: { ...state.plan, asset: emptyAsset(), originalInput: "" },
                interpretStatus: "ready",
                interpretFields: emptyPlanInterpretFields(),
                skippedFieldPaths: [],
                currentQuestion: null,
                selectableAnswers: [],
                assetDisambiguation: null,
                missingFieldsCount: 0,
                conversationLog: initialGreetingLog(),
                invalidInputStreak: 0,
                greetingRevealed: false,
                pendingAssetChangeQuery: null,
              }
            : popQuestionHistory(state, "clarifying");
        case "plan_ready":
          // 되돌릴 이전 질문이 없으면(원문 한 번으로 계획이 바로 완성된 경우) 그대로 둔다.
          return state.questionHistory.length === 0 ? state : popQuestionHistory(state, "clarifying");
        case "plan_confirmed":
        case "loading_market_data":
        case "simulating":
          // 진행 중 취소 — 부분 데이터는 버린다.
          return { ...invalidateResults(state), flowState: "plan_ready", error: null };
        case "analysis_ready":
          // 결과는 보존한 채 계획 확인으로. Screen 4 전용 오류(수정 요청 실패 등)는 여기서 비운다 —
          // Screen 2·3 에는 이 오류가 의미가 없다.
          return { ...state, flowState: "plan_ready", error: null };
        case "generating_alternatives":
        case "alternatives_ready":
        case "revised_plan_selected":
          return { ...state, flowState: "analysis_ready", error: null };
        case "replaying_revised_plan":
          return { ...state, flowState: "alternatives_ready" };
        default:
          return state;
      }
    }

    case "confirm_plan":
      return { ...state, flowState: "loading_market_data", error: null };

    case "market_data_loaded":
      return { ...state, flowState: "simulating", marketData: action.marketData };

    case "quote_loading":
      return { ...state, quote: { status: "loading", data: null, error: null } };

    case "quote_ready":
      return { ...state, quote: { status: "ready", data: action.quote, error: null } };

    case "quote_failed":
      return { ...state, quote: { status: "error", data: null, error: action.error } };

    case "simulation_done":
      return {
        ...state,
        flowState: "analysis_ready",
        simulation: action.simulation,
        simulatedPlanVersion: state.plan.version,
      };

    case "ai_review_loading":
      return { ...state, aiReview: { status: "loading", headline: "", risks: [] } };

    case "ai_review_ready":
      return {
        ...state,
        aiReview: { status: "ready", headline: action.headline, risks: action.risks },
      };

    // "조건을 다르게 수정하고 싶어요"(idle→editing) 또는 적용 완료 화면의 "다시 수정하기"
    // (applied→editing) — editing 으로 들어가는 경로는 이 둘뿐이다. apply_revision 이 직접
    // editing 을 열지 않는다(§재발했던 회귀: 적용 완료 후 입력창이 자동으로 다시 나타났다).
    case "revise_start_editing":
      return { ...state, revise: { status: "editing", result: null, appliedChanges: null, error: null } };

    case "revise_requested":
      return { ...state, revise: { status: "parsing", result: null, appliedChanges: null, error: null } };

    case "revise_ready": {
      // 실제 변경 제안이 있으면 확인 카드(preview). 제안 없이 되묻는 질문만 왔다면(예: "더
      // 안전하게"처럼 모호한 요청) editing 을 유지한다 — 그 질문에 답하는 것도 입력창이 있는
      // 상태이기 때문이다(§preview 는 "입력창 숨김"이 규칙이라 여기 해당하지 않는다).
      const nextStatus: RevisionStatus = action.result.proposedChanges.length > 0 ? "preview" : "editing";
      return { ...state, revise: { status: nextStatus, result: action.result, appliedChanges: null, error: null } };
    }

    case "revise_dismissed":
      return { ...state, revise: IDLE_REVISE_STATE };

    case "revise_applying":
      // 이미 적용 중이면 무시한다 — "이대로 적용하기" 중복 클릭 방지(신뢰는 하지만 여기서도
      // 한 번 더 막는다 — context 의 confirmRevision() 도 같은 조건으로 조기 반환한다).
      if (state.revise.status === "applying") return state;
      return { ...state, revise: { ...state.revise, status: "applying" } };

    case "revise_failed":
      // 계획 해석(interpret) 실패와 다른 전용 오류다 — conversationLog·currentQuestion·
      // flowState 등 다른 화면 상태를 절대 건드리지 않는다(§재발했던 문제: 공용 "fail" 액션을
      // 쓰면 Screen4Analysis 등에서 엉뚱하게 대화 로그가 바뀌었다). 입력값(text)은 컴포넌트
      // 로컬 상태라 여기서 지우지 않아도 그대로 남는다.
      return { ...state, revise: { ...state.revise, status: "error", error: action.error } };

    case "apply_revision":
      // 재시뮬레이션은 §15.9 와 같은 방식(marketData.candles 재사용, 재조회 없음)으로 처리한다 —
      // 실제 조회·계산은 context 의 confirmRevision() 이 이어서 수행한다. result 는 비우고
      // appliedChanges 만 남긴다 — "지금 확인해야 할 제안"과 "방금 반영된 변경 요약"은 다른
      // 개념이다.
      return {
        ...invalidateAnalysisKeepMarketData(state),
        plan: action.plan,
        revise: { status: "applied", result: null, appliedChanges: action.changes, error: null },
        flowState: "loading_market_data",
        error: null,
      };

    case "start_asset_revision":
      // 종목 변경 제안은 Finnhub 재확인이 필요하다 — Screen 2 의 종목 검색을 그대로 재사용한다.
      // chatPhase 를 "collecting" 으로 되돌리지 않으면(§재발했던 회귀 — 무한 반복) editableReview
      // 그대로 남아 needsAssetSearch(=isCollecting 전제)가 계속 false 다 — 종목 검색 UI 가 전혀
      // 뜨지 않고, ReviseRequestPanel 의 idle 뷰("조건을 다르게 수정하고 싶어요")만 다시
      // 보여서, 사용자가 그걸 다시 누르고 또 같은 자리로 돌아오는 무한 루프가 생겼다.
      return {
        ...invalidateResults(state),
        plan: { ...action.planWithOtherChangesApplied, asset: emptyAsset() },
        interpretFields: { ...state.interpretFields, assetQuery: action.query },
        pendingPlanReadyAfterAsset: true,
        // 검색 중 뒤로가기를 누르면 이 시점(다른 필드 변경은 반영, 종목은 아직 그대로)으로
        // 되돌아간다 — state.plan 은 이 액션이 실행되기 전의 값이므로 여기서 캡처해야 한다.
        revisionAssetRevertPlan: { plan: state.plan, returnTo: action.returnTo },
        revise: IDLE_REVISE_STATE,
        chatPhase: "collecting",
        flowState: "clarifying",
        error: null,
      };

    case "apply_direct_plan_edit":
      // 정기 매수·추가 매수 금액을 새 통화로 다시 채운 뒤 확인 시트를 적용하는 시점이라,
      // 여기서 통화 재확인 상태를 끈다(§종목 수정 UX 변경) — 금액이 이미 종목 통화 기준으로
      // 검증된 값이라 더 이상 확인이 필요 없다.
      return {
        ...invalidateResults(state),
        plan: clearMaxCountIfConditionalDisabled(action.plan),
        assetCurrencyReentryRequired: false,
      };

    case "apply_asset_edit": {
      // §종목 수정 UX 변경(§사용자 확정) — 계획 확인 화면에서 종목만 바꾸는 결정적 편집이다.
      // 채팅 화면으로 이동하지 않고(flowState·chatPhase 그대로), 대화 로그에 아무것도 남기지
      // 않으며, AI 재해석도 호출하지 않는다.
      const newAsset = { ...action.asset, displayName: formatCompanyName(action.asset.displayName) };
      const oldAsset = state.plan.asset;
      const currencyChanged = oldAsset.quoteCurrency !== newAsset.quoteCurrency;

      if (!currencyChanged) {
        return {
          ...invalidateResults(state),
          plan: { ...state.plan, asset: newAsset },
          assetCurrencyReentryRequired: false,
        };
      }

      // 통화가 바뀌면 정기 매수·추가 매수 "금액"만 다시 받는다 — 주기·요일·하락률은 그대로
      // 두고, 환율 자동 변환은 하지 않는다(§사용자 확정). 지운 금액을 interpretFields 에
      // 옮겨 두면 기존 편집 시트(RecurringScheduleEditor/ConditionalRuleEditor)가 나머지
      // 값을 채운 채로 열린다 — §추가 매수 기준 가격 인터랙션 수정에서 이미 만든 경로를
      // 그대로 재사용한다.
      const oldRecurring = state.plan.recurring;
      const oldConditional = state.plan.conditionalBuy;
      return {
        ...invalidateResults(state),
        plan: { ...state.plan, asset: newAsset, recurring: null, conditionalBuy: null },
        interpretFields: {
          ...state.interpretFields,
          assetQuery: newAsset.symbol,
          recurring:
            oldRecurring !== null
              ? {
                  frequency: oldRecurring.frequency,
                  weekday: oldRecurring.frequency === "weekly" ? oldRecurring.weekday : null,
                  dayOfMonth: oldRecurring.frequency === "monthly" ? oldRecurring.dayOfMonth : null,
                  amountKrw: null,
                }
              : state.interpretFields.recurring,
          conditionalBuy:
            oldConditional !== null
              ? { thresholdPercent: oldConditional.thresholdPercent, amountKrw: null }
              : state.interpretFields.conditionalBuy,
        },
        assetCurrencyReentryRequired: true,
      };
    }

    case "request_alternatives":
      return { ...state, flowState: "generating_alternatives", error: null };

    case "alternatives_ready":
      return { ...state, flowState: "alternatives_ready", alternatives: action.alternatives };

    case "select":
      return { ...state, flowState: "revised_plan_selected", selectedId: action.id };

    case "approve": {
      // "현재 계획 유지" 는 재시뮬레이션하지 않고 바로 완료 처리한다.
      if (state.selectedId === "current" || state.selectedId === null) {
        return { ...state, flowState: "completed" };
      }
      return { ...state, flowState: "replaying_revised_plan" };
    }

    case "finish":
      return { ...state, flowState: "completed" };

    case "edit_plan":
      return { ...invalidateAnalysisKeepMarketData(state), flowState: "plan_ready" };

    case "fail": {
      // 계획 해석 호출 실패·구조 오류(네트워크·스키마)는 채팅 화면을 벗어나지 않는다 — 사용자
      // 잘못이 아니므로 "실패"·"다시 시도" 표현을 쓰지 않고, 이미 알아낸 값(종목·정기 매수 등)이
      // 있으면 그대로 지킨다(§자유 입력 실패 처리 전면 수정 — 예전에는 이 호출 하나가 실패하면
      // 이미 확정된 값까지 전부 날아간 것처럼 보이는 문구를 띄웠다). `error` 는 그대로 남겨
      // 기존 `retry()` 가 stage 를 보고 재호출할 수 있게 한다.
      const isInterpretFailure =
        action.error.stage === "conversation" || action.error.stage === "plan_structure";
      if (isInterpretFailure) {
        const hasNothingYet = state.plan.asset.symbol.trim() === "" && !hasAnyExtractedField(state.interpretFields);
        // §로딩 종료 보장 — 종목이 이미 확정된 뒤(예: 검색에서 직접 선택) 나머지 값을 마저
        // 채우려던 요청이 타임아웃되면, 채팅으로 되돌리지 않고 곧바로 계획 카드로 보낸다.
        // "처음부터 다시 입력해주세요"로 복구하지 않는다 — 이미 확정된 종목·값은 그대로 둔다.
        if (action.error.code === "timeout" && state.plan.asset.symbol.trim() !== "") {
          return {
            ...state,
            error: action.error,
            interpretStatus: "ready",
            currentQuestion: null,
            selectableAnswers: [],
            conversationLog: [
              ...state.conversationLog,
              { role: "assistant", text: API_ERROR_MESSAGE_TIMEOUT_ASSET_RESOLVED },
            ],
            flowState: "plan_ready",
          };
        }
        return {
          ...state,
          error: action.error,
          interpretStatus: "ready",
          currentQuestion: null,
          selectableAnswers: [],
          conversationLog: [
            ...state.conversationLog,
            { role: "assistant", text: hasNothingYet ? API_ERROR_MESSAGE_NOTHING_YET : API_ERROR_MESSAGE_PARTIAL },
          ],
          flowState: "clarifying",
        };
      }
      return { ...state, error: action.error };
    }

    case "clear_error":
      return { ...state, error: null };

    case "load_demo_plan":
      return {
        ...invalidateResults(state),
        plan: action.plan,
        flowState: "plan_ready",
        error: null,
        assetCurrencyReentryRequired: false,
      };

    case "reset":
      return { ...initialState(), sessionId: state.sessionId };

    case "greeting_revealed":
      return state.greetingRevealed ? state : { ...state, greetingRevealed: true };

    default:
      return state;
  }
}

/** 아직 Claude 로 연결하지 않은 단계만 URL 파라미터로 오류를 재현할 수 있다. */
type MockableErrorStage = "alternative_generation";

const ERROR_PRESETS: Record<MockableErrorStage, FlowError> = {
  alternative_generation: {
    stage: "alternative_generation",
    code: "ai_unavailable",
    userMessage: "조정안을 만들지 못했어요.",
    retryable: true,
  },
};

function readMockErrorStage(): MockableErrorStage | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("mockError");
  if (raw === null) return null;
  return raw in ERROR_PRESETS ? (raw as MockableErrorStage) : null;
}

/** 실제 API 실패(MarketClientError 모양) 또는 예기치 못한 예외를 FlowError 로 정규화한다. */
function toFlowError(error: unknown, stage: ErrorStage): FlowError {
  if (typeof error === "object" && error !== null && "userMessage" in error && "retryable" in error) {
    const e = error as { code?: unknown; userMessage?: unknown; retryable?: unknown };
    return {
      stage,
      code: typeof e.code === "string" ? e.code : "unknown",
      userMessage:
        typeof e.userMessage === "string" ? e.userMessage : "알 수 없는 오류가 발생했어요.",
      retryable: Boolean(e.retryable),
    };
  }
  return { stage, code: "unknown", userMessage: "알 수 없는 오류가 발생했어요.", retryable: true };
}

/** 서버가 이미 stage(conversation 호출 실패 / plan_structure 검증 실패)를 구분해 보낸다. */
function toAiCallFlowError(error: unknown): FlowError {
  if (typeof error === "object" && error !== null && "userMessage" in error && "retryable" in error) {
    const e = error as { stage?: unknown; code?: unknown; userMessage?: unknown; retryable?: unknown };
    const stage = e.stage === "plan_structure" ? "plan_structure" : "conversation";
    return {
      stage,
      code: typeof e.code === "string" ? e.code : "unknown",
      userMessage: typeof e.userMessage === "string" ? e.userMessage : "AI 응답을 받지 못했어요.",
      retryable: Boolean(e.retryable),
    };
  }
  return { stage: "conversation", code: "unknown", userMessage: "AI 응답을 받지 못했어요.", retryable: true };
}

/** AI에게 "이미 값이 있는 필드는 그대로 유지한다"고 프롬프트로 지시해도, 실제로는 방금 답한
 * 질문과 무관한 필드의 숫자가 다른 값으로 바뀌어 돌아오는 사례가 있었다(§재발했던 회귀: 월
 * 예산 50만원이 100만원으로 바뀜 — AI 신뢰성의 한계이지 코드 버그가 아니라, 프롬프트만으로는
 * 완전히 막을 수 없다). "지금 막 답한 질문"(justAnsweredFieldPath)이 아닌 필드는, 이전에
 * 이미 값이 있었다면 새 응답이 뭐라고 하든 기존 값을 그대로 지킨다 — 그룹 전체가 null 로
 * 바뀌는 것(정기·조건부 매수 자체를 그만두는 새 문장)까지는 막지 않는다. 그건 이 값들과
 * 다른, 이미 별도로 처리되는 정상적인 전환이다. */
/** AI 가 이미 확정된 종목을 다른 표기(한글 별칭·회사명·티커)로 다시 언급했을 뿐인지, 아니면
 * 진짜 다른 회사를 새로 말한 것인지 구분한다(§사용자 확정 — "애플 대화 중 테슬라를 입력했는데
 * 이전 종목이 남는 오류"를 고치되, AI 가 같은 종목을 "애플"로 다시 부른 정상 재확인까지 종목
 * 변경으로 오해하면 안 된다). 한글 별칭 사전으로 정규화한 뒤 대소문자 without 비교한다 — 완벽한
 * 판정은 아니지만, 실제로 다른 회사명이 등장했는지를 가리기에는 충분하다. */
function mentionsCurrentAsset(query: string, asset: AssetRef): boolean {
  const normalized = normalizeSearchQuery(query).trim().toLowerCase();
  if (normalized === "") return true;
  const symbol = asset.symbol.trim().toLowerCase();
  const name = asset.displayName.trim().toLowerCase();
  if (symbol !== "" && normalized === symbol) return true;
  if (name === "") return false;
  return name.includes(normalized) || normalized.includes(name);
}

function guardAgainstFieldDrift(
  previous: PlanInterpretFields,
  incoming: PlanInterpretFields,
  justAnsweredFieldPath: PlanInterpretFieldPath | null
): PlanInterpretFields {
  const guarded = { ...incoming };

  if (
    previous.guardrails.monthlyBudgetKrw !== null &&
    justAnsweredFieldPath !== "guardrails.monthlyBudgetKrw" &&
    incoming.guardrails.monthlyBudgetKrw !== previous.guardrails.monthlyBudgetKrw
  ) {
    guarded.guardrails = { monthlyBudgetKrw: previous.guardrails.monthlyBudgetKrw };
  }

  // 그룹 전체가 null 로 되돌아오는 것도 드리프트다. "안 함"(명시적 그만두기)은 여기 도달하기
  // 전에 이미 다른 경로로 처리된다 — answerCurrentQuestion 이 클릭 즉시 applyFieldAnswer 로
  // fields.recurring/conditionalBuy 를 낙관적으로 null 로 만들고, answer_field_start 가 그
  // 값을 state.interpretFields(=이 함수의 previous)에 바로 반영하기 때문에, 진짜 "안 함"
  // 상황에서는 previous 가 이미 null 이라 아래 조건 자체가 걸리지 않는다. 반대로 previous 가
  // still non-null 인데 incoming 이 null 이면, 그건 항상 "그룹이 이미 활성화된 뒤 AI 가
  // 실수로 통째로 지워버린" 드리프트다 — justAnsweredFieldPath 가 그 그룹의 enabled 필드와
  // 같은지로는 이 둘을 구분할 수 없다(§재발했던 회귀: "설정" 클릭 직후의 바로 그 응답에서도
  // AI 가 conditionalBuy 를 null 로 돌려보내, "지금 막 enabled 를 답한 턴이니 정상적인 전환"
  // 이라고 잘못 봐주면서 예산 질문으로 곧장 건너뛰고 계획 확인 화면에는 "조건부 매수: 설정하지
  // 않음"으로 표시됐다). 그래서 justAnsweredFieldPath 조건 없이 항상 이전 값을 지킨다.
  if (previous.recurring !== null && incoming.recurring === null) {
    guarded.recurring = previous.recurring;
  }
  if (previous.conditionalBuy !== null && incoming.conditionalBuy === null) {
    guarded.conditionalBuy = previous.conditionalBuy;
  }

  if (previous.recurring !== null && incoming.recurring !== null) {
    const recurring = { ...incoming.recurring };
    if (
      previous.recurring.amountKrw !== null &&
      justAnsweredFieldPath !== "recurring.amountKrw" &&
      incoming.recurring.amountKrw !== previous.recurring.amountKrw
    ) {
      recurring.amountKrw = previous.recurring.amountKrw;
    }
    if (
      previous.recurring.weekday !== null &&
      justAnsweredFieldPath !== "recurring.weekday" &&
      incoming.recurring.weekday !== previous.recurring.weekday
    ) {
      recurring.weekday = previous.recurring.weekday;
    }
    guarded.recurring = recurring;
  }

  if (previous.conditionalBuy !== null && incoming.conditionalBuy !== null) {
    const conditionalBuy = { ...incoming.conditionalBuy };
    if (
      previous.conditionalBuy.thresholdPercent !== null &&
      justAnsweredFieldPath !== "conditionalBuy.thresholdPercent" &&
      incoming.conditionalBuy.thresholdPercent !== previous.conditionalBuy.thresholdPercent
    ) {
      conditionalBuy.thresholdPercent = previous.conditionalBuy.thresholdPercent;
    }
    if (
      previous.conditionalBuy.amountKrw !== null &&
      justAnsweredFieldPath !== "conditionalBuy.amountKrw" &&
      incoming.conditionalBuy.amountKrw !== previous.conditionalBuy.amountKrw
    ) {
      conditionalBuy.amountKrw = previous.conditionalBuy.amountKrw;
    }
    guarded.conditionalBuy = conditionalBuy;
  }

  return guarded;
}

/** 종목을 확정한 원문이 그 종목과 다른 통화로 금액을 말했으면(예: 원화로 말했는데 미국 종목을
 * 골랐다), 그 금액을 새 통화 기준으로 그대로 믿지 않는다 — 환율로 자동 변환하지도, 숫자만
 * 그대로 새 통화로 재해석하지도 않는다(§사용자 확정). 하락률·주기·요일처럼 통화와 무관한
 * 값은 그대로 두고, 금액(recurring·conditionalBuy 의 amountKrw)만 다시 입력받도록 비운다. */
function clearAmountsIfCurrencyMismatched(
  fields: PlanInterpretFields,
  currency: "USD" | "KRW",
  originalInput: string
): PlanInterpretFields {
  if (!hasMismatchedCurrencyMarker(originalInput, currency)) return fields;
  return {
    ...fields,
    recurring: fields.recurring !== null ? { ...fields.recurring, amountKrw: null } : null,
    conditionalBuy: fields.conditionalBuy !== null ? { ...fields.conditionalBuy, amountKrw: null } : null,
  };
}

/** extractedFields(부분 null 허용)를 AppPlan 의 엄격한 모양으로 옮긴다. 완전히 채워진 그룹만 반영한다. */
/** conditionalBuy 가 꺼져 있으면(null) guardrails.maxConditionalExecutionsPerMonth 도 반드시
 * null 이어야 한다 — "조건부 매수: 설정하지 않음" 인데 "조건부 매수 횟수: 월 8회"가 함께
 * 남아 있던 모순 상태를 막는다(§재발했던 회귀). 계획을 새로 구성하는 모든 지점(질문 응답 병합·
 * 자연어 수정 적용·계획 확인 화면의 개별 필드 수정)에서 이 함수를 거친다 — 특정 편집기 하나만
 * 고치면 다른 경로로 같은 모순이 다시 생길 수 있어, 계획이 확정되는 지점에서 일괄 강제한다. */
function clearMaxCountIfConditionalDisabled(plan: AppPlan): AppPlan {
  if (plan.conditionalBuy !== null || plan.guardrails.maxConditionalExecutionsPerMonth === null) {
    return plan;
  }
  return { ...plan, guardrails: { ...plan.guardrails, maxConditionalExecutionsPerMonth: null } };
}

/** 0 이하·최소 금액 미만이면 "값이 확정됐다"고 보지 않는다(§사용자 확정 — 0원·음수는 계획
 * 값으로 저장하지 않는다). `firstMissingMandatorySubField` 와 같은 기준을 쓴다 — 그 함수가
 * "아직 안 채워졌다"고 보는 값은 여기서도 plan 에 반영하지 않는다. */
function mergeInterpretFieldsIntoPlan(plan: AppPlan, fields: PlanInterpretFields): AppPlan {
  const minAmount = minAmountFor(plan.asset.quoteCurrency);
  const validAmount = (value: number | null): number | null => (value !== null && value >= minAmount ? value : null);

  const recurringAmount = validAmount(fields.recurring?.amountKrw ?? null);
  const recurring: AppPlan["recurring"] =
    fields.recurring !== null && recurringAmount !== null && fields.recurring.frequency === "weekly" && fields.recurring.weekday !== null
      ? { frequency: "weekly", weekday: fields.recurring.weekday, amountKrw: recurringAmount }
      : fields.recurring !== null &&
          recurringAmount !== null &&
          fields.recurring.frequency === "monthly" &&
          fields.recurring.dayOfMonth !== null
        ? { frequency: "monthly", dayOfMonth: fields.recurring.dayOfMonth, amountKrw: recurringAmount }
        : null;

  const conditionalAmount = validAmount(fields.conditionalBuy?.amountKrw ?? null);
  const conditionalPercent = fields.conditionalBuy?.thresholdPercent ?? null;
  const conditionalBuy =
    fields.conditionalBuy !== null &&
    conditionalPercent !== null &&
    conditionalPercent > 0 &&
    conditionalPercent < 100 &&
    conditionalAmount !== null
      ? { thresholdPercent: conditionalPercent, amountKrw: conditionalAmount }
      : null;

  const monthlyBudget =
    fields.guardrails.monthlyBudgetKrw !== null && fields.guardrails.monthlyBudgetKrw > 0
      ? fields.guardrails.monthlyBudgetKrw
      : null;

  return clearMaxCountIfConditionalDisabled({
    ...plan,
    recurring,
    conditionalBuy,
    guardrails: { ...plan.guardrails, monthlyBudgetKrw: monthlyBudget },
    version: plan.version + 1,
  });
}

/** `mergeInterpretFieldsIntoPlan` 의 역변환 — 세션 복구 시 저장된 `plan` 만으로 서버가 다음
 * 질문을 이어서 만들 수 있도록 `currentFields` 모양을 되살린다(§세션 복구는 저장된 질문 id를
 * 믿지 않고 plan 에서 다시 계산한다). */
export function planToInterpretFields(plan: AppPlan): PlanInterpretFields {
  return {
    assetQuery: plan.asset.symbol.trim() !== "" ? plan.asset.symbol : null,
    recurring:
      plan.recurring !== null
        ? plan.recurring.frequency === "weekly"
          ? { frequency: "weekly", weekday: plan.recurring.weekday, dayOfMonth: null, amountKrw: plan.recurring.amountKrw }
          : { frequency: "monthly", weekday: null, dayOfMonth: plan.recurring.dayOfMonth, amountKrw: plan.recurring.amountKrw }
        : null,
    conditionalBuy:
      plan.conditionalBuy !== null
        ? {
            thresholdPercent: plan.conditionalBuy.thresholdPercent,
            amountKrw: plan.conditionalBuy.amountKrw,
          }
        : null,
    guardrails: { monthlyBudgetKrw: plan.guardrails.monthlyBudgetKrw },
  };
}

/** 선택한 답 하나를 해당 필드에 반영한다. 다른 필드는 그대로 둔다. */
export function applyFieldAnswer(
  fields: PlanInterpretFields,
  fieldPath: PlanInterpretFieldPath,
  value: number | string
): PlanInterpretFields {
  const numValue = typeof value === "number" ? value : Number(value);
  switch (fieldPath) {
    case "assetQuery":
      return { ...fields, assetQuery: String(value) };
    // "설정"/"안 함" 두 선택지는 화면(ScreenChat)이 고정으로 만든다(§사용자 확정 — 이진 질문은
    // 반드시 양쪽 선택지). value 0 = 안 함(전체를 null 로 되돌린다). value 1 = 설정 — 세부
    // 값은 아직 모르니 지어내지 않지만, 그룹 자체를 null 로 남기면 안 된다. `recurring`/
    // `conditionalBuy` 가 null 인 상태는 시스템 전체에서 이미 "원하지 않음"이라는 뜻으로 굳어져
    // 있어(AI 프롬프트·시뮬레이션 엔진 모두), null 로 둔 채 "그래도 세부 질문은 이어가라"고
    // 프롬프트로만 지시해도 AI 가 신뢰성 있게 따르지 않았다(§재발했던 회귀: "설정"을 골랐는데
    // 예산 질문으로 건너뛰고 하락 기준·금액은 묻지 않음). 그래서 여기서 하위 필드가 전부 null
    // 인 "빈 껍데기" 객체로 채워 둔다 — 이건 대화 중간에 일부 값만 채워진 상태와 똑같은 모양이라
    // AI 가 이미 잘 다루는 기존 로직(부족한 하위 필드만 이어서 묻기)을 그대로 재사용하게 된다.
    case "recurring.enabled":
      return numValue === 0
        ? { ...fields, recurring: null }
        : { ...fields, recurring: fields.recurring ?? emptyRecurringFields() };
    case "conditionalBuy.enabled":
      return numValue === 0
        ? { ...fields, conditionalBuy: null }
        : {
            ...fields,
            conditionalBuy: fields.conditionalBuy ?? { thresholdPercent: null, amountKrw: null },
          };
    // 매주·매달 중 어느 쪽으로 바뀌면 반대쪽 축의 값(요일/실행일)은 더 이상 의미가 없으므로
    // 지운다(§매주·매달 실행일 모델 분리 — "매달"인데 요일을 저장하지 않는다).
    case "recurring.frequency": {
      const frequency = value === "monthly" ? "monthly" : "weekly";
      return {
        ...fields,
        recurring: {
          frequency,
          weekday: null,
          dayOfMonth: null,
          amountKrw: fields.recurring?.amountKrw ?? null,
        },
      };
    }
    case "recurring.weekday": {
      // 화면이 만든 칩이든 자유 입력이든, 저장 직전 여기서 한 번 더 정규화한다(§요일 하드코딩
      // 제거 — 월요일로 임의 치환하지 않는다). 정규화에 실패하면(이례적 — 자유 입력 경로는
      // 호출 전에 이미 검증한다) 기존 값을 그대로 둔다.
      const normalized = normalizeWeekdayInput(String(value));
      const weekday = normalized.kind === "weekday" ? normalized.value : (fields.recurring?.weekday ?? null);
      return {
        ...fields,
        recurring: { frequency: "weekly", weekday, dayOfMonth: null, amountKrw: fields.recurring?.amountKrw ?? null },
      };
    }
    case "recurring.dayOfMonth": {
      const normalized = normalizeDayOfMonthInput(String(value));
      const dayOfMonth = normalized.kind === "dayOfMonth" ? normalized.value : (fields.recurring?.dayOfMonth ?? null);
      return {
        ...fields,
        recurring: { frequency: "monthly", weekday: null, dayOfMonth, amountKrw: fields.recurring?.amountKrw ?? null },
      };
    }
    case "recurring.amountKrw":
      return {
        ...fields,
        recurring: {
          frequency: fields.recurring?.frequency ?? null,
          weekday: fields.recurring?.weekday ?? null,
          dayOfMonth: fields.recurring?.dayOfMonth ?? null,
          amountKrw: numValue,
        },
      };
    case "conditionalBuy.thresholdPercent":
      return {
        ...fields,
        conditionalBuy: {
          thresholdPercent: numValue,
          amountKrw: fields.conditionalBuy?.amountKrw ?? null,
        },
      };
    case "conditionalBuy.amountKrw":
      return {
        ...fields,
        conditionalBuy: {
          thresholdPercent: fields.conditionalBuy?.thresholdPercent ?? null,
          amountKrw: numValue,
        },
      };
    case "guardrails.monthlyBudgetKrw":
      // 0 이하는 "정하지 않을게요" 관례(옛 mock 과 동일) — null 로 남긴다.
      return { ...fields, guardrails: { monthlyBudgetKrw: numValue > 0 ? numValue : null } };
  }
}

/** 이전 요청이 나중에 응답해도 이미 최신 요청이 아니면 무시한다(더블클릭·빠른 재제출 경쟁 방지).
 * `AssetSearchStep` 의 `requestIdRef` 패턴과 동일하다. */
interface RequestGuard {
  ref: React.MutableRefObject<number>;
  id: number;
}

function isStaleRequest(guard: RequestGuard): boolean {
  return guard.ref.current !== guard.id;
}

/** 실제 계획 해석 호출(server/BFF 경유, `@/data/plan/provider`). 응답이 곧 다음 질문이다.
 * `isFreshIntent` 는 Screen 1 의 원문 제출(자유 서술) 인지 표시한다 — 이때만 "투자 의도를
 * 전혀 알아볼 수 없는 입력" 차단을 적용한다(선택지 답변은 항상 유효한 값이라 차단 대상이 아니다). */
function runInterpret(
  dispatch: React.Dispatch<Action>,
  sessionId: string,
  originalInput: string,
  currentFields: PlanInterpretFields,
  skippedFieldPaths: PlanInterpretFieldPath[],
  resolvedAsset: AssetRef | null,
  isFreshIntent = false,
  guard?: RequestGuard
): void {
  const resolvedAssetForRequest =
    resolvedAsset !== null && resolvedAsset.symbol.trim() !== ""
      ? { symbol: resolvedAsset.symbol, displayName: resolvedAsset.displayName, currency: resolvedAsset.quoteCurrency }
      : null;

  // §로딩 종료 보장 — 응답이 INTERPRET_TIMEOUT_MS 안에 오지 않으면 typing indicator 를 무한히
  // 띄워 두지 않고 실패로 취급한다. 타임아웃이 먼저 발생한 뒤 원래 요청이 뒤늦게 응답해도
  // 무시한다(settled) — 화면을 이미 옮긴 뒤 도착한 응답이 canonical plan 을 덮어쓰면 안 된다
  // (§오래된 비동기 응답 차단).
  let settled = false;
  const timeoutId = window.setTimeout(() => {
    if (settled) return;
    settled = true;
    if (guard !== undefined && isStaleRequest(guard)) return;
    dispatch({
      type: "fail",
      error: { stage: "conversation", code: "timeout", userMessage: "지금은 응답을 받지 못했어요.", retryable: true },
    });
  }, INTERPRET_TIMEOUT_MS);

  interpretPlan({
    sessionId,
    originalInput,
    locale: "ko-KR",
    currentFields,
    skippedFieldPaths,
    resolvedAsset: resolvedAssetForRequest,
  })
    .then((response) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (guard !== undefined && isStaleRequest(guard)) return;
      dispatch({
        type: "interpret_ready",
        fields: response.extractedFields,
        skippedFieldPaths,
        nextQuestion: response.nextQuestion,
        selectableAnswers: response.selectableAnswers,
        missingFieldsCount: response.missingFields.length,
        isPlanReady: response.isPlanReady,
        isFreshIntent,
        hasRecognizableIntent: response.hasRecognizableIntent,
        assetCandidates: response.assetCandidates,
        ambiguousQuantityText: response.ambiguousQuantityText,
      });
    })
    .catch((error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (guard !== undefined && isStaleRequest(guard)) return;
      dispatch({ type: "fail", error: toAiCallFlowError(error) });
    });
}

/** 실제 계획 수정 요청 호출(server/BFF 경유, `@/data/plan/provider`). */
function runRevise(dispatch: React.Dispatch<Action>, sessionId: string, plan: AppPlan, revisionText: string): void {
  const snapshot: PlanReviseSnapshot = {
    symbol: plan.asset.symbol,
    companyName: plan.asset.displayName,
    recurring: plan.recurring,
    conditionalBuy: plan.conditionalBuy,
    guardrails: { monthlyBudgetKrw: plan.guardrails.monthlyBudgetKrw },
  };
  revisePlan({ sessionId, locale: "ko-KR", revisionText, currentPlan: snapshot })
    .then((result) => dispatch({ type: "revise_ready", result }))
    // 전용 액션으로 분리한다 — 일반 "fail" 은 계획 해석(interpret) 실패 전용 분기(conversationLog에
    // 오류 메시지 추가·currentQuestion 초기화 등)를 갖고 있어, 수정 요청 실패에 그대로 쓰면
    // 채팅 화면과 무관한 Screen4Analysis 등에서도 잘못된 부작용이 생긴다.
    .catch((error) => dispatch({ type: "revise_failed", error: toAiCallFlowError(error) }));
}

/** 변경 제안 하나를 적용한다. assetQuery(종목 변경)는 여기서 적용하지 않는다 — 별도 경로(Finnhub
 * 재확인, `start_asset_revision`)를 거친다. */
function applyOneReviseChange(plan: AppPlan, change: ReviseFieldChange): AppPlan {
  switch (change.fieldPath) {
    case "assetQuery":
      return plan;
    case "recurring":
    case "recurring.enabled":
      return change.after === null ? { ...plan, recurring: null } : plan;
    case "recurring.amountKrw":
      return plan.recurring === null
        ? plan
        : { ...plan, recurring: { ...plan.recurring, amountKrw: change.after as number } };
    case "recurring.weekday":
      // 매달(monthly) 계획에는 요일 자체가 없다 — 자연어 수정이 실수로 이 필드를 겨냥해도
      // 무시한다(§매주·매달 실행일 모델 분리).
      return plan.recurring === null || plan.recurring.frequency !== "weekly"
        ? plan
        : { ...plan, recurring: { ...plan.recurring, weekday: change.after as Weekday } };
    // 자연어 수정(planReviseRoute)은 아직 매주/매달 전환·실행일 자체를 제안하지 않는다(§매주·
    // 매달 실행일 모델 분리는 계획 생성 단계 한정 — 수정 카드는 후순위). ReviseFieldPath 타입이
    // PlanInterpretFieldPath 를 포함해 이 두 경로가 형식적으로 들어오지만, 서버 허용 목록에
    // 없어 실제로는 절대 오지 않는다 — 방어적으로 아무 것도 바꾸지 않는다.
    case "recurring.frequency":
    case "recurring.dayOfMonth":
      return plan;
    case "conditionalBuy":
    case "conditionalBuy.enabled":
      return change.after === null ? { ...plan, conditionalBuy: null } : plan;
    case "conditionalBuy.thresholdPercent":
      return plan.conditionalBuy === null
        ? plan
        : { ...plan, conditionalBuy: { ...plan.conditionalBuy, thresholdPercent: change.after as number } };
    case "conditionalBuy.amountKrw":
      return plan.conditionalBuy === null
        ? plan
        : { ...plan, conditionalBuy: { ...plan.conditionalBuy, amountKrw: change.after as number } };
    case "guardrails.monthlyBudgetKrw":
      return { ...plan, guardrails: { ...plan.guardrails, monthlyBudgetKrw: change.after as number | null } };
  }
}

/** 승인된 변경(assetQuery 제외)을 전부 적용하고 버전을 올린다. */
export function applyReviseChanges(plan: AppPlan, changes: ReviseFieldChange[]): AppPlan {
  const next = changes.reduce(applyOneReviseChange, plan);
  return clearMaxCountIfConditionalDisabled({ ...next, version: plan.version + 1 });
}

/** budgetExceededCause 는 simulation 엔진 결과에서만 결정한다(§20 판정 규칙). AI 는 추론하지 않는다. */
function computeBudgetExceededCauseBucket(result: SimulationResult): BudgetExceededCauseBucket {
  const recurringOnly = result.recurringOnlyBudgetExceededMonthCount;
  const conditional = result.conditionalCausedBudgetExceededMonthCount;
  if (recurringOnly > 0 && conditional > 0) return "mixed";
  if (recurringOnly > 0) return "recurring_only";
  if (conditional > 0) return "conditional_action";
  return "none";
}

/** 화면에 실제로 보여주는 자리수와 맞춘다 — 원화는 정수, 달러는 소수점 둘째 자리까지
 * (§formatMoney 와 같은 반올림 규칙). 맞추지 않으면 AI 가 원본 부동소수점을 그대로 옮겨 써서
 * "-49,736.605069560464원"처럼 지저분해진다(§똑대리 해석). */
function roundMoneyLike(value: number, currency: "USD" | "KRW"): number {
  return currency === "KRW" ? Math.round(value) : Math.round(value * 100) / 100;
}

/** simulation 요약만 옮긴다(원본 전체·대화 이력 미전송 — 비용 제어). */
function buildReviewRequest(
  sessionId: string,
  plan: AppPlan,
  result: SimulationResult,
  quoteStatus: "ok" | "failed" | "unavailable"
): ReviewRequest {
  const currency = plan.asset.quoteCurrency;
  return {
    sessionId,
    locale: "ko-KR",
    plan: {
      symbol: plan.asset.symbol,
      companyName: plan.asset.displayName,
      hasRecurring: plan.recurring !== null,
      hasConditionalBuy: plan.conditionalBuy !== null,
      monthlyBudgetKrw: plan.guardrails.monthlyBudgetKrw,
      currency: plan.asset.quoteCurrency,
    },
    summary: {
      maxMonthlyInvestmentKrw: result.maxMonthlyInvestmentKrw,
      budgetExceededMonthCount: result.budgetExceededMonthCount,
      recurringOnlyBudgetExceededMonthCount: result.recurringOnlyBudgetExceededMonthCount,
      conditionalCausedBudgetExceededMonthCount: result.conditionalCausedBudgetExceededMonthCount,
      conditionalTriggerCount: result.conditionalTriggerCount,
      conditionalExecutionCount: result.conditionalExecutionCount,
      conditionalBlockedCount: result.conditionalBlockedCount,
      recurringExecutionCount: result.recurringExecutionCount,
      reviewTriggeredCount: result.reviewTriggeredCount,
      maxAdditionalDeclineAfterTriggerPercent: result.maxAdditionalDeclineAfterTriggerPercent,
      totalInvestmentKrw: result.totalInvestmentKrw,
      additionalInvested:
        result.backtestComparison !== null
          ? roundMoneyLike(result.backtestComparison.difference.additionalInvested, currency)
          : null,
      profitLossDifference:
        result.backtestComparison !== null
          ? roundMoneyLike(result.backtestComparison.difference.profitLossDifference, currency)
          : null,
      returnRateDifference:
        result.backtestComparison?.difference.returnRateDifference != null
          ? Math.round(result.backtestComparison.difference.returnRateDifference * 10) / 10
          : null,
    },
    period: { from: result.period.from, to: result.period.to, tradingDayCount: result.tradingDayCount },
    budgetExceededCause: computeBudgetExceededCauseBucket(result),
    causeSentence: budgetCauseSentence(result),
    quoteStatus,
  };
}

/**
 * 실제 AI 설명 호출. 실패해도 오류 화면을 띄우지 않는다 — deterministic fallback(엔진 결과에서
 * 만든 문장)으로 곧바로 대체한다(사용자 확정 — "AI 실패 시 deterministic fallback copy 사용").
 */
function runReview(
  dispatch: React.Dispatch<Action>,
  sessionId: string,
  plan: AppPlan,
  result: SimulationResult,
  quoteStatus: "ok" | "failed" | "unavailable"
): void {
  const request = buildReviewRequest(sessionId, plan, result, quoteStatus);
  getReview(request)
    .then((response) => {
      dispatch({ type: "ai_review_ready", headline: response.headline, risks: response.explanation });
    })
    .catch(() => {
      const fallback = buildFallbackReview(request);
      dispatch({ type: "ai_review_ready", headline: fallback.headline, risks: fallback.explanation });
    });
}

/** STATE_FLOW_V1 §15.6 — 어떤 입력이 문제인지 지목한다. */
const SIMULATION_ERROR_MESSAGES: Record<SimulationInputErrorCode, string> = {
  invalid_symbol: "종목 정보를 다시 확인해주세요.",
  empty_candles: "가져온 가격 데이터가 비어 있어요. 다시 조회해주세요.",
  candles_not_ascending: "가격 데이터 순서에 문제가 있어요. 다시 조회해주세요.",
  duplicate_candle_date: "가격 데이터에 중복된 날짜가 있어요. 다시 조회해주세요.",
  invalid_candle: "가져온 가격 데이터에 문제가 있어요. 다시 조회해주세요.",
  invalid_recurring_amount: "정기 매수 금액을 다시 확인해주세요.",
  invalid_conditional_amount: "추가 매수 금액을 다시 확인해주세요.",
  invalid_threshold_percent: "하락률을 다시 확인해주세요.",
  invalid_monthly_budget: "월 예산을 다시 확인해주세요.",
  invalid_max_conditional_executions: "추가 매수 최대 횟수를 다시 확인해주세요.",
  invalid_review_drawdown_percent: "재검토 기준을 다시 확인해주세요.",
  review_requires_average_cost: "재검토 조건을 쓰려면 평균 매수가가 필요해요.",
};

/** 엔진은 결정적이다 — 같은 입력이면 같은 실패가 난다. 재시도 대신 계획 확인으로 되돌린다. */
function toSimulationFlowError(error: unknown): FlowError {
  if (error instanceof SimulationInputError) {
    return {
      stage: "simulation",
      code: error.code,
      userMessage: SIMULATION_ERROR_MESSAGES[error.code],
      retryable: false,
    };
  }
  return {
    stage: "simulation",
    code: "unknown",
    userMessage: "계산 중 문제가 발생했어요.",
    retryable: false,
  };
}

const DAY_MS = 86_400_000;

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** "최근 1년" — 오늘은 아직 종가가 없을 수 있어 어제까지로 잡는다. §국내주식 0회 계획
 * 사전 판정(Screen3PlanConfirm)도 실제 시뮬레이션과 같은 범위를 봐야 하므로 export 한다. */
export function computeAnalysisRange(now: Date): { from: string; to: string } {
  const to = new Date(now.getTime() - DAY_MS);
  const from = new Date(to.getTime() - 365 * DAY_MS);
  return { from: toISODate(from), to: toISODate(to) };
}

/** 조정안 2개를 같은 candles 로 재계산한다. 숫자는 여기서 만들지 않는다(엔진 산출). */
function buildAlternatives(plan: AppPlan, marketData: MarketDataState): Alternative[] {
  return buildAlternativePlans(plan).map(({ rule, plan: altPlan }) => ({
    rule,
    plan: altPlan,
    simulation: simulatePlan({
      plan: toSimulationPlan(altPlan),
      policy: ADJUSTED_PLAN_POLICY,
      candles: marketData.candles,
      calculatedAt: marketData.fetchedAt,
    }),
    tradeOff: ALTERNATIVE_TRADE_OFFS[rule.id] ?? { benefit: "", cost: "" },
  }));
}

/** 실제 엔진 계산. 로딩 2단계 중 "조건이 발생한 시점을 찾고 있어요" 를 잠깐 보여준다. */
function runSimulation(
  dispatch: React.Dispatch<Action>,
  plan: AppPlan,
  marketData: MarketDataState
): void {
  if (marketData.completeness === "insufficient") {
    dispatch({
      type: "fail",
      error: {
        stage: "historical_data",
        code: "insufficient_data",
        userMessage: "확인 가능한 기간이 부족해 분석을 진행할 수 없어요.",
        retryable: false,
      },
    });
    return;
  }

  window.setTimeout(() => {
    try {
      const simulation = simulatePlan({
        plan: toSimulationPlan(plan),
        policy: ORIGINAL_PLAN_POLICY,
        candles: marketData.candles,
        calculatedAt: marketData.fetchedAt,
      });
      dispatch({ type: "simulation_done", simulation });
    } catch (error) {
      dispatch({ type: "fail", error: toSimulationFlowError(error) });
    }
  }, 400);
}

/**
 * 실제 과거 일봉 + 현재가를 조회한다(server/BFF 경유, `@/data/market/provider`).
 * 현재가 실패는 비치명(시세 블록만 실패 표시), 과거 일봉 실패는 치명(분석 중단)이다.
 *
 * 현재가(`/api/quote`)는 Finnhub 전용이라 국내 종목(KRX)은 애초에 지원하지 않는다(§사용자
 * 확정 — 국내 종목은 로컬 인덱스·Yahoo 로만 다룬다). 실패할 걸 알면서 매번 호출해 콘솔에
 * 오류를 남기고 재시도 불가능한 "불러오지 못했어요"를 보여주는 대신, 국내 종목은 애초에
 * 호출하지 않는다 — quote 상태가 "idle"로 남아 QuoteLine 이 아무것도 보여주지 않는다.
 */
function fetchMarketData(dispatch: React.Dispatch<Action>, plan: AppPlan): void {
  const { from, to } = computeAnalysisRange(new Date());

  if (plan.asset.market !== "KR") {
    dispatch({ type: "quote_loading" });
    fetchQuote(plan.asset.symbol)
      .then((quote) => dispatch({ type: "quote_ready", quote }))
      .catch((error) => dispatch({ type: "quote_failed", error: toFlowError(error, "market_quote") }));
  }

  fetchCandles(plan.asset, from, to)
    .then((result) => {
      const marketData: MarketDataState = {
        candles: result.candles,
        actualRange: result.actualRange,
        requestedRange: result.requestedRange,
        completeness: result.completeness,
        adjustment: result.adjustment,
        dividendAdjusted: result.dividendAdjusted,
        fetchedAt: result.fetchedAt,
        fallbackUsed: result.fallbackUsed,
        asOfDate: result.asOfDate,
      };
      dispatch({ type: "market_data_loaded", marketData });
      runSimulation(dispatch, plan, marketData);
    })
    .catch((error) => {
      dispatch({ type: "fail", error: toFlowError(error, "historical_data") });
    });
}

export interface FlowContextValue extends FlowState {
  screen: ScreenId;
  /** 선택된 계획의 결과. 현재 계획 유지면 원본 결과다. */
  selectedSimulation: SimulationResult | null;
  selectedAlternative: Alternative | null;
  submitIntent: (input: string) => void;
  resolveAsset: (asset: AssetRef) => void;
  /** §복수 종목 입력 — 종목 선택 카드가 로컬로 모든 모호함을 끝낸 뒤 한 번만 호출한다. */
  resolveAssetDisambiguation: (assetQuery: string, amountKrw: number | null, summaryLabel: string) => void;
  /** explicitLabel 을 주면 selectableAnswers 조회 대신 그 문구를 그대로 대화 로그에 남긴다 —
   * 화면이 고정 버튼(예: "설정"/"안 함")이나 직접 입력으로 답할 때, AI 가 만든 selectableAnswers
   * 의 값과 우리가 실제로 넘기는 값이 다를 수 있어(예: 0/1 대 "enabled"/"disabled") 조회가
   * 실패해 원문 숫자가 그대로 노출되는 문제를 막는다. */
  answerCurrentQuestion: (value: number | string, explicitLabel?: string) => void;
  /** Screen 2 바텀시트 "이 계획 검증하기" — Screen 3 로의 전환은 여기서만 일어난다. */
  confirmPlanFromSheet: () => void;
  /** 계획 요약 바텀시트를 "계속 수정하기"로 닫을 때 호출 — 수정 진입 안내를 채팅에 남긴다. */
  enterEditableReview: () => void;
  /** restorePending 바텀시트의 "계속 수정하기" — 이때 처음으로 deriveNextQuestion 을 실행한다. */
  continueRestoredPlan: () => void;
  /** restorePending 바텀시트의 "새로 시작하기" — 저장된 세션까지 실제로 지운다. */
  startOver: () => void;
  back: () => void;
  confirmPlan: () => void;
  requestAlternatives: () => void;
  select: (id: SelectionId) => void;
  approve: () => void;
  finish: () => void;
  editPlan: () => void;
  retry: () => void;
  retryAiReview: () => void;
  retryQuote: () => void;
  /** "조건을 다르게 수정하고 싶어요" 또는 적용 완료 화면의 "다시 수정하기" — editing 으로
   * 들어가는 유일한 두 통로. */
  startEditingRevision: () => void;
  requestRevision: (text: string) => void;
  confirmRevision: () => void;
  dismissRevision: () => void;
  /** 계획 확인 화면의 "종목" 행 전용 — 자연어 수정 없이 곧바로 종목 검색을 연다. */
  startAssetEditFromPlan: () => void;
  /** 계획 확인 화면의 개별 필드 수정 시트에서만 쓴다(AI 파싱을 거치지 않는 결정적 편집). */
  applyDirectPlanEdit: (plan: AppPlan) => void;
  /** 계획 확인 화면의 종목 검색 bottom sheet 에서 후보를 직접 골랐을 때만 쓴다 — 채팅 화면
   * 이동·대화 로그 추가·AI 재해석 없이 canonical plan.asset 만 바꾼다(§종목 수정 UX 변경). */
  applyAssetEdit: (asset: AssetRef) => void;
  reset: () => void;
  loadDemoPlan: () => void;
  /** 첫 진입 인사말 두 번째 말풍선이 화면에 나타난 순간 `ScreenChat` 이 호출한다. */
  revealGreeting: () => void;
}

const FlowContext = React.createContext<FlowContextValue | null>(null);

export function FlowProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = React.useReducer(reducer, undefined, initialState);
  const mockErrorStage = React.useMemo(readMockErrorStage, []);

  // --- 세션 복구 (plan 만 복구하고 market data 는 재조회한다) ---------------
  //
  // **아직 시작하지 않은 세션에서만** 복구한다. 개발 중 재마운트나 StrictMode 이중 호출로
  // 이 effect 가 다시 실행돼도, 진행 중인 상태를 저장된 옛 값으로 덮어쓰지 않는다.
  const pristine = state.flowState === "idle" && state.plan.originalInput === "";
  const pristineRef = React.useRef(pristine);
  pristineRef.current = pristine;

  React.useEffect(() => {
    if (!pristineRef.current) return;

    const saved = loadSession();
    if (saved === null) return;
    if (saved.plan.originalInput === "") return;

    dispatch({
      type: "restore",
      plan: saved.plan,
      flowState: recoverableFlowState(saved.flowState),
      sessionId: saved.sessionId,
    });
  }, []);

  // --- 세션 저장 (plan + 사용자 입력만. candles·quote·simulation 은 저장하지 않는다) -------
  React.useEffect(() => {
    if (state.flowState === "idle" && state.plan.originalInput === "") return;
    saveSession({
      sessionId: state.sessionId,
      plan: state.plan,
      flowState: state.flowState,
    });
  }, [state.sessionId, state.plan, state.flowState]);

  // §똑대리 한마디 — 화면에 보여주는 "똑대리 한마디"는 이제 AI 호출 없이 결정적으로 만든다
  // (app/lib/simulationCopy.ts 의 tokdaeriComment). 예전에는 여기서 결과가 나오는 즉시 AI
  // 설명을 별도로 요청했지만, 그 결과를 쓰는 화면이 없어졌으니 더 이상 요청하지 않는다 —
  // 안 쓰는 API 호출을 남겨 두면 비용만 낭비한다.

  const selectedAlternative = React.useMemo(() => {
    if (state.selectedId === null || state.selectedId === "current") return null;
    return state.alternatives.find((alt) => alt.rule.id === state.selectedId) ?? null;
  }, [state.alternatives, state.selectedId]);

  // 계획 해석 요청의 "최신 요청 번호". submitIntent·answerCurrentQuestion·retry 가 호출될 때마다
  // 올린다 — 응답이 왔을 때 이 값과 다르면(더 최신 요청이 이미 나갔으면) 버린다. 더블클릭이나
  // 빠른 재제출로 두 요청이 겹쳐도, 나중에 도착하는 응답이 화면을 덮어쓰지 않게 막는다.
  const interpretRequestIdRef = React.useRef(0);
  function nextInterpretGuard(): RequestGuard {
    const id = ++interpretRequestIdRef.current;
    return { ref: interpretRequestIdRef, id };
  }

  // 구조적 안전망(§문제 1) — 서버 프롬프트를 강화해도 AI 는 확률적이라 종목을 다시 물을
  // 가능성을 완전히 배제할 수 없다. `interpret_ready` 리듀서가 이미 화면·대화 로그에는 그
  // 질문을 절대 노출하지 않도록 동기적으로 걸러 `pendingAutoRetrySkip` 만 남겨뒀다 — 여기서는
  // 그 깃발을 보고 실제 재요청(비동기)만 수행한다.
  React.useEffect(() => {
    const fieldPath = state.pendingAutoRetrySkip;
    if (fieldPath === null) return;
    const skippedFieldPaths = state.skippedFieldPaths.includes(fieldPath)
      ? state.skippedFieldPaths
      : [...state.skippedFieldPaths, fieldPath];
    dispatch({ type: "auto_skip_field", fieldPath });
    runInterpret(
      dispatch,
      state.sessionId,
      state.plan.originalInput,
      state.interpretFields,
      skippedFieldPaths,
      state.plan.asset,
      false,
      nextInterpretGuard()
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.pendingAutoRetrySkip]);

  const value: FlowContextValue = {
    ...state,
    screen: SCREEN_BY_FLOW[state.flowState],
    selectedAlternative,
    selectedSimulation: selectedAlternative?.simulation ?? state.simulation,
    submitIntent: (input) => {
      dispatch({ type: "submit_intent", input });
      runInterpret(dispatch, state.sessionId, input, emptyPlanInterpretFields(), [], state.plan.asset, true, nextInterpretGuard());
    },
    // §종목 선택은 AI 재해석 없이 처리(§사용자 확정) — 사용자가 검색 결과에서 직접 고른
    // 종목은 이미 확정된 값이다. reducer 가 이미 로컬에서 interpretFields 를 canonical
    // plan 에 합치고 화면을 plan_ready 로 옮겨 두므로, 여기서는 dispatch 하나면 끝난다 —
    // Claude 를 다시 부르지 않는다(비동기 요청이 없으므로 무한 로딩도 생길 수 없다).
    resolveAsset: (asset) => dispatch({ type: "resolve_asset", asset }),
    resolveAssetDisambiguation: (assetQuery, amountKrw, summaryLabel) =>
      dispatch({ type: "resolve_asset_disambiguation", assetQuery, amountKrw, summaryLabel }),
    confirmPlanFromSheet: () => dispatch({ type: "advance_plan_ready" }),
    enterEditableReview: () => dispatch({ type: "enter_editable_review" }),
    continueRestoredPlan: () => {
      const derivedFields = planToInterpretFields(state.plan);
      const incomplete = missingPlanRequirements(state.plan).length > 0;
      dispatch({ type: "continue_restored_plan", interpretFields: derivedFields, incomplete });
      // deriveNextQuestion 은 "collecting"으로 전환되는 이 시점에만 실제로 호출한다 — restorePending
      // 동안에는 절대 실행하지 않는다(§B. 저장된 계획이 있는 재진입).
      if (incomplete) {
        runInterpret(dispatch, state.sessionId, state.plan.originalInput, derivedFields, [], state.plan.asset, false, nextInterpretGuard());
      }
    },
    startOver: () => {
      // "새로 시작하기"는 화면 상태뿐 아니라 저장된 세션도 실제로 지운다 — 그러지 않으면 다음
      // 새로고침에서 같은 계획이 다시 restorePending 으로 나타난다. 진행 중인 interpret 요청도
      // 무효화한다 — 그러지 않으면 리셋 이후 뒤늦게 도착한 응답이 방금 비운 empty 상태에
      // currentQuestion 을 다시 채워 넣을 수 있다(§empty 불변식: currentQuestion 은 반드시 null).
      clearSession();
      nextInterpretGuard();
      dispatch({ type: "reset" });
    },
    answerCurrentQuestion: (value, explicitLabel) => {
      const question = state.currentQuestion;
      if (question === null) return;
      const chosenLabel =
        explicitLabel ??
        state.selectableAnswers.find((option) => option.value === value)?.label ??
        String(value);
      // 정기·조건부 매수 "할지 말지" 질문은 화면이 고정 버튼(설정=1/안 함=0)으로 묻는다 — 어느
      // 쪽을 답하든 결정은 끝난 것이므로 항상 skippedFieldPaths 에 넣어 AI 가 같은 질문을
      // 되풀이하지 않게 한다(§재발했던 회귀: "설정"을 골랐는데 같은 질문을 다시 함 — 값이 0
      // 이하일 때만 건너뛰던 기존 규칙은 "설정"(값 1)에는 적용되지 않았다).
      const isEnabledGate = question.fieldPath === "recurring.enabled" || question.fieldPath === "conditionalBuy.enabled";
      const skip = isEnabledGate || (!question.required && Number(value) <= 0);
      const fields = applyFieldAnswer(state.interpretFields, question.fieldPath, value);
      const skippedFieldPaths = skip
        ? [...state.skippedFieldPaths, question.fieldPath]
        : state.skippedFieldPaths;
      dispatch({ type: "answer_field_start", fields, skippedFieldPaths, answerLabel: chosenLabel });
      runInterpret(dispatch, state.sessionId, state.plan.originalInput, fields, skippedFieldPaths, state.plan.asset, false, nextInterpretGuard());
    },
    back: () => dispatch({ type: "back" }),
    confirmPlan: () => {
      dispatch({ type: "confirm_plan" });
      // 조건만 다시 확인하는 경우(예: 조건 수정 후 재승인)엔 candles 를 재사용해 재계산만 한다.
      if (state.marketData !== null) {
        dispatch({ type: "market_data_loaded", marketData: state.marketData });
        runSimulation(dispatch, state.plan, state.marketData);
      } else {
        fetchMarketData(dispatch, state.plan);
      }
    },
    requestAlternatives: () => {
      dispatch({ type: "request_alternatives" });
      if (mockErrorStage === "alternative_generation") {
        window.setTimeout(
          () => dispatch({ type: "fail", error: ERROR_PRESETS.alternative_generation }),
          700
        );
        return;
      }
      const marketData = state.marketData;
      if (marketData === null) return; // 방어적: 이 시점엔 항상 있어야 한다.
      const plan = state.plan;
      window.setTimeout(() => {
        dispatch({ type: "alternatives_ready", alternatives: buildAlternatives(plan, marketData) });
      }, 700);
    },
    select: (id) => dispatch({ type: "select", id }),
    approve: () => dispatch({ type: "approve" }),
    finish: () => dispatch({ type: "finish" }),
    editPlan: () => dispatch({ type: "edit_plan" }),
    retry: () => {
      const stage = state.error?.stage;
      dispatch({ type: "clear_error" });
      if (stage === "historical_data") {
        fetchMarketData(dispatch, state.plan);
      } else if (stage === "conversation" || stage === "plan_structure") {
        // isFreshIntent: true — 실패한 호출이 아직 아무 필드도 확정되지 않은 자유 입력이었을
        // 수 있어, 재시도 응답도 같은 무효-입력 기준으로 판정한다(이미 유효 필드가 있으면
        // hasAnyExtractedField 가 true 라 이 플래그는 영향을 주지 않는다).
        runInterpret(
          dispatch,
          state.sessionId,
          state.plan.originalInput,
          state.interpretFields,
          state.skippedFieldPaths,
          state.plan.asset,
          true,
          nextInterpretGuard()
        );
      }
    },
    retryAiReview: () => {
      if (state.simulation === null) return;
      dispatch({ type: "ai_review_loading" });
      const quoteStatus =
        state.quote.status === "ready" ? "ok" : state.quote.status === "error" ? "failed" : "unavailable";
      runReview(dispatch, state.sessionId, state.plan, state.simulation, quoteStatus);
    },
    retryQuote: () => {
      if (state.plan.asset.market === "KR") return;
      dispatch({ type: "quote_loading" });
      fetchQuote(state.plan.asset.symbol)
        .then((quote) => dispatch({ type: "quote_ready", quote }))
        .catch((error) => dispatch({ type: "quote_failed", error: toFlowError(error, "market_quote") }));
    },
    requestRevision: (text) => {
      // 중복 제출 방지 — 이미 응답을 기다리는 중이면 같은 텍스트로 다시 보내지 않는다.
      if (state.revise.status === "parsing") return;
      dispatch({ type: "revise_requested" });
      runRevise(dispatch, state.sessionId, state.plan, text);
    },
    confirmRevision: () => {
      // 중복 클릭 방지 — 이미 적용 처리 중이면 아무것도 하지 않는다(reducer 도 같은 조건으로
      // 한 번 더 막지만, 여기서 막아야 apply_revision/start_asset_revision 자체가 두 번
      // 나가는 것도 막을 수 있다).
      if (state.revise.status === "applying") return;
      const result = state.revise.result;
      if (result === null) return;

      dispatch({ type: "revise_applying" });

      const assetChange = result.proposedChanges.find((change) => change.fieldPath === "assetQuery");
      const otherChanges = result.proposedChanges.filter((change) => change.fieldPath !== "assetQuery");
      const planWithOtherChanges = applyReviseChanges(state.plan, otherChanges);

      // 종목 변경은 Finnhub 검색·재확인이 필요하다 — 다른 변경은 먼저 적용해두고 검색으로 넘어간다.
      if (assetChange !== undefined && typeof assetChange.after === "string") {
        dispatch({
          type: "start_asset_revision",
          query: assetChange.after,
          planWithOtherChangesApplied: planWithOtherChanges,
          returnTo: "editableReview",
        });
        return;
      }

      dispatch({ type: "apply_revision", plan: planWithOtherChanges, changes: otherChanges });
      // §15.9 와 같은 방식 — marketData.candles 가 있으면 재조회 없이 재계산만 한다.
      if (state.marketData !== null) {
        dispatch({ type: "market_data_loaded", marketData: state.marketData });
        runSimulation(dispatch, planWithOtherChanges, state.marketData);
      } else {
        fetchMarketData(dispatch, planWithOtherChanges);
      }
    },
    startEditingRevision: () => dispatch({ type: "revise_start_editing" }),
    dismissRevision: () => dispatch({ type: "revise_dismissed" }),
    // PlanCard(계획 확인 화면)의 "종목" 행 전용 — 자연어 수정을 거치지 않고 곧바로 종목 검색을
    // 시작한다. 다른 필드는 그대로 두고(planWithOtherChangesApplied: state.plan) 검색어는 현재
    // 회사명으로 미리 채운다(§UX — 지금 종목과 비슷한 후보부터 바로 보인다).
    startAssetEditFromPlan: () => {
      dispatch({
        type: "start_asset_revision",
        query: state.plan.asset.displayName !== "" ? state.plan.asset.displayName : state.plan.asset.symbol,
        planWithOtherChangesApplied: state.plan,
        returnTo: "planReady",
      });
    },
    // 계획 확인 화면의 개별 필드 수정 시트("정기 매수 금액", "월 예산" 등)에서만 쓴다 — AI
    // 파싱을 거치지 않는 결정적 UI 편집이라, 시트가 이미 완성한 plan 을 그대로 반영한다.
    applyDirectPlanEdit: (plan) => dispatch({ type: "apply_direct_plan_edit", plan }),
    applyAssetEdit: (asset) => dispatch({ type: "apply_asset_edit", asset }),
    reset: () => dispatch({ type: "reset" }),
    loadDemoPlan: () => dispatch({ type: "load_demo_plan", plan: MOCK_PLAN }),
    revealGreeting: () => dispatch({ type: "greeting_revealed" }),
  };

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow(): FlowContextValue {
  const context = React.useContext(FlowContext);
  if (context === null) throw new Error("useFlow 는 FlowProvider 안에서만 사용할 수 있어요.");
  return context;
}
