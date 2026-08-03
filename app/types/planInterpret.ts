/**
 * POST /api/plan/interpret — 요청·응답 타입(순수 타입, 런타임 로직 없음).
 *
 * 브라우저(app/)와 서버(server/, functions/) 양쪽에서 import 한다.
 *
 * 원칙(사용자 확정):
 *  - AI 는 가격·예산 합계·대안 금액을 계산하지 않는다. 숫자는 사용자가 말한 값만 옮긴다.
 *  - 종목명은 Finnhub 검색 결과와 매칭하기 전까지 확정하지 않는다 — 그래서 `assetQuery` 는
 *    후보 텍스트일 뿐이고 `AppPlan.symbol` 이 아니다(실제 매칭은 Screen 2 의 종목 검색 단계,
 *    `AssetSearchStep` + Finnhub 가 담당한다).
 *  - 한 번에 질문 하나만 반환한다(`nextQuestion` 은 배열이 아니라 단일 객체).
 *  - 불명확한 필수 값은 임의로 채우지 않고 `null` 로 남긴다.
 */
import type { DayOfMonth, Weekday } from "@/domain/simulation";

export type PlanInterpretFieldPath =
  | "assetQuery"
  | "recurring.enabled"
  | "recurring.amountKrw"
  | "recurring.frequency"
  | "recurring.weekday"
  | "recurring.dayOfMonth"
  | "conditionalBuy.enabled"
  | "conditionalBuy.thresholdPercent"
  | "conditionalBuy.amountKrw"
  | "guardrails.monthlyBudgetKrw";

export interface PlanInterpretFields {
  /** 종목 후보 텍스트(예: "애플", "AAPL"). 확정 심볼이 아니다. */
  assetQuery: string | null;
  recurring: {
    /** "매주"/"매달" 둘 다 지원한다(§매주·매달 실행일 모델 분리) — weekly 면 weekday 만,
     * monthly 면 dayOfMonth 만 채워진다. 정기 매수 의도는 있지만 아직 어느 쪽인지도 모르는
     * 중간 상태를 표현하기 위해 frequency 자체도 null 을 허용한다. */
    frequency: "weekly" | "monthly" | null;
    /** 사용자가 말한 요일 그대로 — 월요일로 고정하지 않는다(§사용자 확정: 월요일 하드코딩 제거).
     * frequency 가 "monthly"면 절대 채우지 않는다. */
    weekday: Weekday | null;
    /** frequency 가 "weekly"면 절대 채우지 않는다. */
    dayOfMonth: DayOfMonth | null;
    amountKrw: number | null;
  } | null;
  conditionalBuy: {
    thresholdPercent: number | null;
    amountKrw: number | null;
  } | null;
  guardrails: {
    monthlyBudgetKrw: number | null;
  };
}

export function emptyPlanInterpretFields(): PlanInterpretFields {
  return {
    assetQuery: null,
    recurring: null,
    conditionalBuy: null,
    guardrails: { monthlyBudgetKrw: null },
  };
}

/** 정기 매수 의도는 있지만 아직 세부 값이 없는 빈 껍데기(§enabled=1 답변 등에서 쓴다). */
export function emptyRecurringFields(): NonNullable<PlanInterpretFields["recurring"]> {
  return { frequency: null, weekday: null, dayOfMonth: null, amountKrw: null };
}

export type MissingFieldReason =
  | "required_for_plan"
  | "required_for_simulation"
  | "ambiguous_user_expression";

export interface PlanInterpretMissingField {
  fieldPath: PlanInterpretFieldPath;
  reason: MissingFieldReason;
  priority: 1 | 2 | 3;
}

export interface PlanInterpretAnswerOption {
  label: string;
  value: string | number;
}

export type PlanInterpretInputType = "money" | "percent" | "select" | "text";

export interface PlanInterpretNextQuestion {
  fieldPath: PlanInterpretFieldPath;
  question: string;
  reason: string;
  inputType: PlanInterpretInputType;
  required: boolean;
}

export interface PlanInterpretRequest {
  /** §production 안정성 — 세션별 rate limit 키로만 쓴다(Cloudflare Pages Function 에서만
   * 읽는다). 계획 해석 로직 자체는 이 값을 보지 않는다. */
  sessionId: string;
  /** 세션 내내 보존하는 사용자 원문. 매 호출 그대로 다시 보낸다(짧고, 대화 이력이 아니다). */
  originalInput: string;
  locale: "ko-KR";
  /** 지금까지 확정된 필드 — 서버는 이 값만 보고 다음에 무엇이 필요한지 판단한다. */
  currentFields: PlanInterpretFields;
  /** 사용자가 "나중에 정할게요"로 넘긴 필드. 같은 질문을 다시 만들지 않게 한다. */
  skippedFieldPaths: PlanInterpretFieldPath[];
  /** 종목이 이미 확정됐으면(Finnhub 검색으로 선택 완료) 그 정체성을 함께 보낸다 — AI 가
   * (1) 같은 종목을 다른 표기로 다시 언급한 것인지 진짜 다른 회사를 새로 말한 것인지 구분하고,
   * (2) 금액을 종목 통화에 맞게 해석하도록 돕는다(§사용자 확정 — 국내·미국 주식 통화 일치).
   * 종목이 아직 없으면 null. */
  resolvedAsset: { symbol: string; displayName: string; currency: "USD" | "KRW" } | null;
}

export interface PlanInterpretResponse {
  understoodIntent: string;
  /** 사용자 원문에서 투자 관련 의도를 조금이라도 알아볼 수 있었는지 — extractedFields 가 전부
   * null 이어도(아직 구체적인 숫자가 없을 뿐) true 일 수 있다("한 달 예산 안에서 투자하고
   * 싶어요"처럼 의도는 분명하지만 값이 없는 경우와, "ㄴㅋㅋㅋ"처럼 의도 자체가 없는 경우를
   * 구분하는 필드다 — nextQuestion 은 규칙상 두 경우 모두 채워지므로 구분 기준이 될 수 없다). */
  hasRecognizableIntent: boolean;
  extractedFields: PlanInterpretFields;
  missingFields: PlanInterpretMissingField[];
  nextQuestion: PlanInterpretNextQuestion | null;
  selectableAnswers: PlanInterpretAnswerOption[];
  isPlanReady: boolean;
  warnings: string[];
  /** §복수 종목 입력 — 원문에 서로 다른 종목이 2개 이상 등장해 assetQuery 하나로 표현할 수
   * 없을 때만 채운다(항상 2개 이상, 그 외엔 null). assetQuery 는 이때 반드시 null 이다. */
  assetCandidates: string[] | null;
  /** §수량·주기 모호성 — "4주씩"처럼 매수 주기인지 매수 수량인지 원문만으로 정할 수 없는
   * 표현을 원문 그대로 담는다. 없으면 null. */
  ambiguousQuantityText: string | null;
}
