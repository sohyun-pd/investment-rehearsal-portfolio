/**
 * 계획 카드 — 세션 내내 남는 산출물(persistent artifact).
 *
 * 근거: docs/product/DESIGN_SYSTEM.md 원칙 2, docs/product/SCREEN_SPEC_V1.md Screen 3
 *
 * 표현 규칙:
 *  - `라벨(작은 회색) / 값(크게)` 2단 행의 반복
 *  - 조건은 문장으로 (Composer 의 노드 UI 를 쓰지 않는다)
 *  - 수정은 텍스트 링크로 낮춘다 (primary CTA 와 경쟁시키지 않는다)
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import type { RecurringRule } from "@/domain/simulation";
import type { AppPlan, RevisionTarget } from "@/types/appPlan";

const WEEKDAY_LABEL: Record<string, string> = {
  monday: "월요일",
  tuesday: "화요일",
  wednesday: "수요일",
  thursday: "목요일",
  friday: "금요일",
};

const DAY_OF_MONTH_LABEL: Record<string, string> = {
  "1": "1일",
  "15": "15일",
  "25": "25일",
  last: "말일",
};

/** "매주"/"매달" 주기 라벨 — 화면·문장 어디서든 이 함수 하나로만 결정한다(§매주·매달 실행일
 * 모델 분리 — 매달인데 요일을 보여주지 않는다). */
function recurringFrequencyLabel(recurring: RecurringRule): string {
  return recurring.frequency === "weekly" ? "매주" : "매달";
}

/** 실행일 라벨 — weekly 면 요일, monthly 면 1일/15일/25일/말일. */
function recurringExecutionDayLabel(recurring: RecurringRule): string {
  return recurring.frequency === "weekly"
    ? (WEEKDAY_LABEL[recurring.weekday] ?? recurring.weekday)
    : (DAY_OF_MONTH_LABEL[String(recurring.dayOfMonth)] ?? String(recurring.dayOfMonth));
}

export function formatKrw(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** 종목 통화에 맞춰 원/달러 표기를 고른다 — 환율 변환은 하지 않는다(§사용자 확정, 국내·미국
 * 주식 통화 일치). 계획의 모든 금액(정기 매수·조건부 매수·월 예산·평균 매수가)이 이 함수
 * 하나로만 통화 기호를 결정해, 한 계획 안에서 원화·달러가 섞여 보이는 일이 없게 한다. */
export function formatByCurrency(value: number, currency: "USD" | "KRW"): string {
  return currency === "KRW" ? formatKrw(value) : formatUsd(value);
}

/**
 * Finnhub 검색 결과는 회사명을 전부 대문자로 준다("APPLE INC"). 이미 정상 표기된 이름(모의
 * 데이터 등 소문자가 섞인 경우)은 건드리지 않고, 대문자만 있는 이름만 제목 표기로 바꾼다.
 */
export function formatCompanyName(name: string): string {
  if (name === "" || /[a-z]/.test(name)) return name;
  return name
    .split(" ")
    .map((word) => (word.length > 0 ? word[0] + word.slice(1).toLowerCase() : word))
    .join(" ");
}

/** 계획을 한 문장으로 요약한다(카드 접힘 상태·헤더용). */
export function planSummarySentence(plan: AppPlan): string {
  const { recurring, conditionalBuy } = plan;
  const monthlyBudget = plan.guardrails.monthlyBudgetKrw;
  const currency = plan.asset.quoteCurrency;

  if (recurring === null && conditionalBuy === null && monthlyBudget === null) {
    return "아직 정해진 조건이 없어요";
  }

  // 예산(guardrails)만 설정된 경우도 있어 정기 매수·추가 매수와 별도로 다룬다 —
  // 셋 다 없을 때만 위의 "아직 정해진 조건이 없어요"를 쓴다.
  if (monthlyBudget === null) {
    const parts: string[] = [];
    if (recurring !== null) {
      parts.push(
        `${recurringFrequencyLabel(recurring)} ${recurringExecutionDayLabel(recurring)} ${formatByCurrency(recurring.amountKrw, currency)}`
      );
    }
    if (conditionalBuy !== null) {
      parts.push(`${conditionalBuy.thresholdPercent}% 하락 시 ${formatByCurrency(conditionalBuy.amountKrw, currency)}`);
    }
    return parts.join(" · ");
  }

  const clauses: string[] = [];
  if (recurring !== null) clauses.push("매주 정기 매수하고");
  if (conditionalBuy !== null) clauses.push("가격이 내려가면 추가 매수하고");
  clauses.push(
    recurring !== null || conditionalBuy !== null
      ? `한 달 예산은 ${formatByCurrency(monthlyBudget, currency)}이에요`
      : `한 달 투자 예산은 ${formatByCurrency(monthlyBudget, currency)}이에요`
  );
  return clauses.join(", ");
}

/** 구역(정기 매수·추가 매수·월 투자 한도) 하나 — 수정 링크는 구역당 하나만 둔다(§사용자
 * 확정 — 행마다 같은 수정 링크를 반복해 화면을 복잡하게 만들지 않는다). */
function PlanSection({
  title,
  onEdit,
  empty,
  /** 정기 매수·추가 매수처럼 "둘 중 하나는 있어야" 하는 항목은 아직 못 정한 상태를 오류처럼
   * 보이지 않게 "선택해주세요"로 보여준다(§입력 방식 재설계 — 절대 빨간색·오류로 보이지
   * 않게). 월 투자 한도처럼 정말 건너뛰어도 되는 항목만 "설정하지 않음"을 그대로 쓴다. */
  emptyLabel = "설정하지 않음",
  children,
}: {
  title: string;
  onEdit?: () => void;
  empty: boolean;
  emptyLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-card text-text-primary">{title}</span>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 text-caption text-text-secondary underline underline-offset-4 hover:text-text-primary"
          >
            수정
          </button>
        ) : null}
      </div>
      {empty ? <p className="text-body text-text-tertiary">{emptyLabel}</p> : <div className="space-y-1.5">{children}</div>}
    </div>
  );
}

function PlanDetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 text-caption text-text-tertiary">{label}</span>
      <span className="text-right text-body font-medium text-text-primary">{value}</span>
    </div>
  );
}

interface PlanCardProps {
  plan: AppPlan;
  /** 접힘 상태에서는 한 줄 요약만 보여준다. */
  collapsed?: boolean;
  /** 행마다 어떤 대상을 편집하려는지 명시해서 전달한다 — 종목(asset)만 실제 종목 검색으로
   * 이어지고, 나머지는 각자 전용 편집 시트를 연다(§재발했던 회귀: 모든 행이 onEdit 하나를
   * 공유해 뒤로가기를 호출하는 바람에, 어떤 "수정"을 눌러도 종목 검색 화면으로 갔다). */
  onEditTarget?: ((target: RevisionTarget) => void) | undefined;
  className?: string;
}

export function PlanCard({ plan, collapsed = false, onEditTarget, className }: PlanCardProps) {
  if (collapsed) {
    return (
      <div className={cn("rounded-lg bg-surface px-4 py-3", className)}>
        <p className="text-caption text-text-tertiary">
          {plan.asset.displayName === ""
            ? "정리 중인 계획"
            : `${formatCompanyName(plan.asset.displayName)} · ${plan.asset.symbol}`}
        </p>
        <p className="mt-1 truncate text-body text-text-primary">{planSummarySentence(plan)}</p>
      </div>
    );
  }

  const conditional = plan.conditionalBuy;
  const guardrails = plan.guardrails;
  const currency = plan.asset.quoteCurrency;
  const edit = (target: RevisionTarget) => (onEditTarget ? () => onEditTarget(target) : undefined);

  return (
    <div className={cn("rounded-lg border border-border bg-bg px-5", className)}>
      <div className="flex items-center justify-between gap-3 border-b border-border py-4">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-strong text-caption font-semibold text-text-secondary">
            {plan.asset.symbol.slice(0, 2) || "—"}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-card text-text-primary">
              {plan.asset.displayName === "" ? "종목 미정" : formatCompanyName(plan.asset.displayName)}
            </span>
            <span className="block text-caption text-text-tertiary">
              {plan.asset.symbol}
              {plan.asset.symbol !== "" ? ` · ${plan.asset.market === "KR" ? "국내" : "미국"} · ${currency}` : null}
            </span>
          </span>
        </span>
        {onEditTarget ? (
          <button
            type="button"
            onClick={edit("asset")}
            className="shrink-0 text-caption text-text-secondary underline underline-offset-4 hover:text-text-primary"
          >
            종목 변경
          </button>
        ) : null}
      </div>

      {/* 구역마다 "수정"을 하나씩만 둔다(§사용자 확정 — 행마다 같은 수정 링크를 반복하지
          않는다). 추가 매수 구역은 기준 가격·하락률·금액·최대 횟수를 한 시트(conditionalRule)
          에서 함께 고친다. */}
      <div className="divide-y divide-border">
        <PlanSection
          title="정기 매수"
          onEdit={edit("recurringSchedule")}
          empty={plan.recurring === null}
          emptyLabel="선택해주세요"
        >
          {plan.recurring !== null ? (
            <>
              <PlanDetailRow label="주기" value={recurringFrequencyLabel(plan.recurring)} />
              <PlanDetailRow label="실행일" value={recurringExecutionDayLabel(plan.recurring)} />
              <PlanDetailRow label="매수 금액" value={formatByCurrency(plan.recurring.amountKrw, currency)} />
            </>
          ) : null}
        </PlanSection>

        <PlanSection
          title="추가 매수"
          onEdit={edit("conditionalRule")}
          empty={conditional === null}
          emptyLabel="선택해주세요"
        >
          {conditional !== null ? (
            <>
              <PlanDetailRow label="추가 매수 기준" value="시뮬레이션 평균 매수가" />
              <p className="text-caption text-text-tertiary">
                {`첫 정기 매수 이후, 평균 매수가보다 ${conditional.thresholdPercent}% 낮아지면 추가 매수해요.`}
              </p>
              <PlanDetailRow label="매수 금액" value={formatByCurrency(conditional.amountKrw, currency)} />
              <PlanDetailRow
                label="최대 횟수"
                value={
                  guardrails.maxConditionalExecutionsPerMonth === null
                    ? "설정하지 않음"
                    : `월 ${guardrails.maxConditionalExecutionsPerMonth}회`
                }
              />
            </>
          ) : null}
        </PlanSection>

        <PlanSection title="월 투자 한도" onEdit={edit("monthlyBudget")} empty={guardrails.monthlyBudgetKrw === null}>
          {guardrails.monthlyBudgetKrw !== null ? (
            <PlanDetailRow label="월 최대 금액" value={formatByCurrency(guardrails.monthlyBudgetKrw, currency)} />
          ) : null}
        </PlanSection>
      </div>
    </div>
  );
}
