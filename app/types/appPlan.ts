/**
 * UI 가 다루는 계획 모델.
 *
 * 계산에 들어가는 부분은 시뮬레이션 엔진의 `SimulationPlan` 과 **같은 모양**을 유지하고,
 * 화면 표시에만 필요한 값(회사명 등)을 덧붙인다. 엔진에 넘길 때는 `toSimulationPlan()` 으로
 * 표시용 필드를 떼어낸다.
 *
 * 근거: docs/product/SCREEN_SPEC_V1.md · docs/product/STRATEGY_SCHEMA_V2.md
 */
import type { SimulationPlan } from "@/domain/simulation";

/** PlanCard 개별 행의 "수정" 버튼이 무엇을 편집하려는지 명시한다 — 종목(asset)만 실제 Finnhub
 * 검색으로 이어지고, 나머지는 각자 전용 편집 시트를 연다(§재발했던 회귀: 모든 "수정" 버튼이
 * 하나의 onEdit(=뒤로가기)를 공유해, 어떤 행을 눌러도 종목 검색 화면으로 가버렸다). */
export type RevisionTarget =
  | "asset"
  | "recurringSchedule"
  | "conditionalRule"
  | "conditionalMaxCount"
  | "monthlyBudget"
  | "general";

/** 국내(KR)·미국(US) 두 시장만 다룬다 — 시장 판단은 항상 이 값 하나로만 한다(§사용자 확정,
 * 화면 문구나 종목명 문자열로 시장을 추측하지 않는다). */
export type Market = "US" | "KR";

/** 종목 하나의 정체성 — 검색에서 확정된 뒤에는 이 값이 시장 판단의 단일 출처(single source of
 * truth)다. `AppPlan` 최상위에 market 을 따로 중복 저장하지 않는다(§사용자 확정).
 *
 * `providerSymbol` 은 선택 필드다 — 데이터 provider 가 요구하는 형식(예: KRX 종목의
 * `005930.KS`)은 provider adapter 내부에서만 계산한다. 이 필드에 미리 값을 채워 넣지 않는다 —
 * canonical `symbol`(005930)이 provider 마다 다른 형식으로 오염되는 걸 막는다. */
export interface AssetRef {
  symbol: string;
  displayName: string;
  market: Market;
  exchange?: "KOSPI" | "KOSDAQ" | string;
  quoteCurrency: "USD" | "KRW";
  providerSymbol?: string;
}

export function emptyAsset(): AssetRef {
  return { symbol: "", displayName: "", market: "US", quoteCurrency: "USD" };
}

export interface AppPlan {
  /** 사용자가 처음 입력한 문장. 세션 내내 보존한다. */
  originalInput: string;

  asset: AssetRef;

  recurring: SimulationPlan["recurring"];
  conditionalBuy: SimulationPlan["conditionalBuy"];
  guardrails: SimulationPlan["guardrails"];

  /** 계획이 바뀔 때마다 올린다. 결과가 어느 버전 기준인지 추적한다. */
  version: number;
}

export function toSimulationPlan(plan: AppPlan): SimulationPlan {
  return {
    symbol: plan.asset.symbol,
    // §국내주식 정수 수량 매수(§사용자 확정) — 매수 수량 계산 방식이 시장에 따라 갈리므로,
    // asset.market(시장 판단의 단일 출처)을 그대로 엔진에 넘긴다.
    market: plan.asset.market,
    recurring: plan.recurring,
    conditionalBuy: plan.conditionalBuy,
    guardrails: plan.guardrails,
  };
}

/** 아직 아무것도 정해지지 않은 계획. */
export function emptyPlan(originalInput = ""): AppPlan {
  return {
    originalInput,
    asset: emptyAsset(),
    recurring: null,
    conditionalBuy: null,
    guardrails: {
      monthlyBudgetKrw: null,
      maxConditionalExecutionsPerMonth: null,
      reviewDrawdownPercent: null,
    },
    version: 1,
  };
}

/** Screen 3 의 CTA 활성 조건. 부족한 항목을 반환한다(빈 배열이면 진행 가능). */
export function missingPlanRequirements(plan: AppPlan): string[] {
  const missing: string[] = [];

  if (plan.asset.symbol.trim() === "") missing.push("종목");
  if (plan.recurring === null && plan.conditionalBuy === null) {
    missing.push("정기 매수 또는 추가 매수 조건");
  }
  if (plan.conditionalBuy !== null) {
    const pct = plan.conditionalBuy.thresholdPercent;
    if (!(pct > 0 && pct < 100)) missing.push("하락률");
    if (!(plan.conditionalBuy.amountKrw > 0)) missing.push("추가 매수 금액");
  }
  if (plan.recurring !== null && !(plan.recurring.amountKrw > 0)) {
    missing.push("정기 매수 금액");
  }
  return missing;
}

/** 매주(정기) 또는 조건 발생 시(추가) 한 번에 나가는 금액이 그 자체로 월 예산을 넘는지만
 * 본다 — "이번 달에 여러 번 실행되면 예산을 넘을 수 있다"는 시뮬레이션이 이미 정상적으로
 * 지원하는 결과(§budgetExceededMonthCount, "예산 조정안" 흐름)이므로 여기서 막지 않는다.
 * 한 번의 실행 금액만으로도 월 예산을 넘는 경우만 "명백한 충돌"로 본다(§사용자 확정 예시 —
 * 매주 5억 원 vs 월 예산 100만 원). 월 예산을 정하지 않았으면(null) 비교 대상이 없어 충돌도
 * 없다. */
export interface BudgetConflict {
  field: "recurring" | "conditional";
  amountKrw: number;
  monthlyBudgetKrw: number;
}

export function detectBudgetConflict(plan: AppPlan): BudgetConflict | null {
  const monthlyBudgetKrw = plan.guardrails.monthlyBudgetKrw;
  if (monthlyBudgetKrw === null) return null;

  if (plan.recurring !== null && plan.recurring.amountKrw > monthlyBudgetKrw) {
    return { field: "recurring", amountKrw: plan.recurring.amountKrw, monthlyBudgetKrw };
  }
  if (plan.conditionalBuy !== null && plan.conditionalBuy.amountKrw > monthlyBudgetKrw) {
    return { field: "conditional", amountKrw: plan.conditionalBuy.amountKrw, monthlyBudgetKrw };
  }
  return null;
}

/** "500,000,000" → "5억 원", "1,000,000" → "100만 원" — 경고 문구 전용 축약 표기다(§사용자
 * 확정 예시 문구). 결과 화면 등 다른 곳의 기존 원 단위 표기(`krw()`)는 건드리지 않는다. */
export function formatKrwCompact(value: number): string {
  if (value >= 100_000_000) {
    const eok = Math.floor(value / 100_000_000);
    const remainder = value % 100_000_000;
    const man = Math.floor(remainder / 10_000);
    return man > 0 ? `${eok}억 ${man.toLocaleString("ko-KR")}만 원` : `${eok}억 원`;
  }
  if (value >= 10_000) {
    const man = Math.floor(value / 10_000);
    const remainder = value % 10_000;
    return remainder > 0 ? `${man.toLocaleString("ko-KR")}만 ${remainder.toLocaleString("ko-KR")}원` : `${man.toLocaleString("ko-KR")}만 원`;
  }
  return `${value.toLocaleString("ko-KR")}원`;
}

export interface BudgetConflictMessage {
  title: string;
  description: string;
}

export function budgetConflictMessage(conflict: BudgetConflict): BudgetConflictMessage {
  const actionLine =
    conflict.field === "recurring"
      ? `매주 ${formatKrwCompact(conflict.amountKrw)}씩 매수하면`
      : `조건이 발생할 때마다 ${formatKrwCompact(conflict.amountKrw)}씩 추가 매수하면`;
  return {
    title: "매수 금액이 월 예산을 넘어요",
    description: `${actionLine}\n한 달 투자 금액이 월 예산 ${formatKrwCompact(
      conflict.monthlyBudgetKrw
    )}을 크게 넘을 수 있어요.\n금액이나 월 예산을 다시 확인해주세요.`,
  };
}
