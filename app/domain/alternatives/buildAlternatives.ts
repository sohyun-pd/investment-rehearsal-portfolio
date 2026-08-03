/**
 * 조정안 생성 — **2개 고정, TypeScript 규칙으로 계산**.
 *
 * 근거: docs/product/STATE_FLOW_V1.md §19
 *
 * AI 는 이 값을 만들지 않는다. AI 는 `explanation`(trade-off 설명 문장)만 담당한다.
 * 이 모듈은 순수 함수이며 네트워크·시각을 읽지 않는다.
 */
import type { AppPlan } from "@/types/appPlan";

export type AlternativeId = "alternative_a" | "alternative_b";

export type AlternativePriority = "preserve_recurring_plan" | "preserve_monthly_budget";

/**
 * 월 예산 대비 성격.
 *
 * 엔진 정책상 이렇게 갈린다.
 *  - 조건부 매수는 **실행 시점의 월 누적 금액만** 확인한다. 그 달에 남아 있는 정기 매수를
 *    미리 예약하지 않는다.
 *  - 정기 매수는 **월 예산을 넘어도 차단하지 않는다.**
 *
 * 따라서 정기 매수만으로 예산을 꽉 채우는 안은 조건부 매수가 먼저 실행되면 그 달 합계가
 * 예산을 넘을 수 있다. 이를 `may_exceed` 로 명시한다.
 */
export type BudgetPosture = "may_exceed" | "within_budget";

export interface AlternativeRule {
  id: AlternativeId;
  name: string;
  priority: AlternativePriority;
  /** 조정한 주간 정기 매수 금액(KRW). */
  weeklyRecurringKrw: number;
  /** 월요일이 5번인 달의 정기 매수 합계(KRW). */
  fiveWeekRecurringKrw: number;
  /** 조건부 매수를 포함한 월 최대 사용 금액(KRW). `may_exceed` 면 상한이 정해지지 않는다. */
  maxMonthlySpendKrw: number | null;
  budgetPosture: BudgetPosture;
  /** 화면에 그대로 쓰는 한 줄 요약. */
  headline: string;
  /** 예산 대비 성격을 나타내는 짧은 라벨. */
  budgetLabel: string;
}

const WEEKS_IN_LONG_MONTH = 5;

/**
 * Alternative A — 정기 일정 우선.
 *
 * 주 40,000원 → 5주인 달 정기 매수 200,000원(예산과 동일).
 * **월 예산 준수안이 아니다.** 조건부 매수가 그 달의 정기 매수보다 먼저 실행되면
 * 남은 정기 매수가 더해지며 월 합계가 예산을 넘을 수 있다.
 */
export const ALTERNATIVE_A: AlternativeRule = {
  id: "alternative_a",
  name: "정기 일정 우선",
  priority: "preserve_recurring_plan",
  weeklyRecurringKrw: 40_000,
  fiveWeekRecurringKrw: 40_000 * WEEKS_IN_LONG_MONTH,
  maxMonthlySpendKrw: null,
  budgetPosture: "may_exceed",
  headline: "정기 매수 일정을 그대로 지켜요",
  budgetLabel: "예산 초과 가능",
};

/**
 * Alternative B — 월 예산 우선.
 *
 * 주 35,000원 → 5주 175,000원 + 조건부 20,000원 = 최대 195,000원.
 * 정기 매수와 조건부 매수를 합쳐도 예산 안에 들어오도록 금액을 잡았다.
 */
export const ALTERNATIVE_B: AlternativeRule = {
  id: "alternative_b",
  name: "월 예산 우선",
  priority: "preserve_monthly_budget",
  weeklyRecurringKrw: 35_000,
  fiveWeekRecurringKrw: 35_000 * WEEKS_IN_LONG_MONTH,
  maxMonthlySpendKrw: 35_000 * WEEKS_IN_LONG_MONTH + 20_000,
  budgetPosture: "within_budget",
  headline: "정기 매수와 추가 매수를 합쳐도 예산 안에 들어와요",
  budgetLabel: "월 예산 이내",
};

export const ALTERNATIVE_RULES: readonly AlternativeRule[] = [ALTERNATIVE_A, ALTERNATIVE_B];

/** 규칙을 계획에 적용한다. 정기 매수 금액만 조정하고 나머지 조건은 유지한다. */
export function applyAlternativeRule(plan: AppPlan, rule: AlternativeRule): AppPlan {
  return {
    ...plan,
    version: plan.version + 1,
    recurring:
      plan.recurring === null
        ? null
        : { ...plan.recurring, amountKrw: rule.weeklyRecurringKrw },
  };
}

/** 두 조정안 계획을 만든다. 항상 2개다. */
export function buildAlternativePlans(plan: AppPlan): Array<{ rule: AlternativeRule; plan: AppPlan }> {
  return ALTERNATIVE_RULES.map((rule) => ({ rule, plan: applyAlternativeRule(plan, rule) }));
}

/**
 * trade-off 설명 문구 자리. Claude 조정안 설명(AI alternative explanation)으로 교체될
 * 자리이며, 지금은 고정 문구다. 값은 여기서만 만들지 않는다 — 숫자는 항상 simulation
 * 결과에서 온다.
 */
export const ALTERNATIVE_TRADE_OFFS: Record<AlternativeId, { benefit: string; cost: string }> = {
  alternative_a: {
    benefit: "정기 매수 일정을 한 번도 거르지 않아요.",
    cost: "추가 매수가 먼저 실행된 달에는 월 예산을 넘을 수 있어요.",
  },
  alternative_b: {
    benefit: "정기 매수와 추가 매수를 합쳐도 월 예산 안에 들어와요.",
    cost: "매주 사는 금액이 가장 많이 줄어요.",
  },
};
