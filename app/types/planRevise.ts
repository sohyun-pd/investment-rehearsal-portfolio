/**
 * POST /api/plan/revise — 요청·응답 타입(순수 타입, 런타임 로직 없음).
 *
 * 원칙(사용자 확정):
 *  - AI 는 사용자가 요청하지 않은 필드를 변경하지 않는다.
 *  - 금액·비율·빈도는 명시적으로 요청된 경우에만 바뀐다.
 *  - 종목 변경은 Finnhub 검색과 사용자 재확인이 필요하다 — 그래서 `assetQuery` 로만 제안되고
 *    `AppPlan.symbol` 을 직접 바꾸지 않는다(Screen 2 의 `AssetSearchStep` 재사용).
 *  - `proposedChanges` 는 아래 `ReviseFieldPath` allowlist 밖의 필드를 절대 담지 않는다
 *    (서버가 한 번 더 강제한다 — `server/planReviseRoute.ts`).
 */
import type { RecurringRule } from "@/domain/simulation";
import type { PlanInterpretFieldPath } from "./planInterpret";

/**
 * `PlanInterpretFieldPath`(단일 값 필드) + 그룹 전체 제거용 두 경로 + `recurring.weekday`.
 *
 * `recurring.weekday` 는 최초 계획 생성 질문(POST /api/plan/interpret)에는 없다 — 새 계획은
 * 항상 월요일로 시작하고, 이후 자연어 수정 요청으로만 요일을 바꿀 수 있다(§사용자 확정 —
 * "매주 수요일에 살래요"가 "지원되지 않는 필드"로 거절되던 문제를 고치면서 기존 정기 매수
 * 규칙의 하위 필드로 통합했다. 새 스키마를 만들지 않았다).
 */
export type ReviseFieldPath = PlanInterpretFieldPath | "recurring" | "conditionalBuy" | "recurring.weekday";

export interface ReviseFieldChange {
  fieldPath: ReviseFieldPath;
  /** 서버가 `currentPlan` 에서 직접 읽어 채운다 — AI 가 말한 값을 신뢰하지 않는다. */
  before: number | string | null;
  /** 그룹 경로("recurring"/"conditionalBuy")는 항목 전체 제거를 뜻하며 `null` 만 허용된다. */
  after: number | string | null;
}

export interface ReviseUnresolvedField {
  /** 특정 필드를 못 찍을 만큼 요청 자체가 모호하면 "general". */
  fieldPath: ReviseFieldPath | "general";
  question: string;
}

/** 서버로 보내는 현재 계획 스냅샷 — 필요한 필드만(원문·대화 이력 없음). */
export interface PlanReviseSnapshot {
  symbol: string;
  companyName: string;
  recurring: RecurringRule | null;
  conditionalBuy: { thresholdPercent: number; amountKrw: number } | null;
  guardrails: { monthlyBudgetKrw: number | null };
}

export interface PlanReviseRequest {
  /** §production 안정성 — 세션별 rate limit 키로만 쓴다(Cloudflare Pages Function 에서만
   * 읽는다). 수정 해석 로직 자체는 이 값을 보지 않는다. */
  sessionId: string;
  locale: "ko-KR";
  revisionText: string;
  currentPlan: PlanReviseSnapshot;
}

export interface PlanReviseResponse {
  understoodRequest: string;
  proposedChanges: ReviseFieldChange[];
  /** 유지된 기존 필드(서버가 currentPlan 과 proposedChanges 를 비교해 계산 — AI 산출 아님). */
  unchangedFields: ReviseFieldPath[];
  unresolvedFields: ReviseUnresolvedField[];
  /** "OO 을 OO 으로 바꿀까요?" — 서버가 검증된 before/after 로 조립한다(AI 문장 아님). */
  confirmationCopy: string;
  warnings: string[];
}
