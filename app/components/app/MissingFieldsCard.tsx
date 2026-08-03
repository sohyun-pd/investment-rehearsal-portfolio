/**
 * 자유 입력 뒤 AI 가 이해하지 못했거나 모호했던 나머지 항목만 한 카드에서 한 번에 확인한다.
 *
 * 근거: 사용자 확정 — "편하게 적어보세요"라고 해놓고 빠진 값마다 별도 "수정" 버튼을 눌러
 * 직접 찾아 고치게 하면 안 된다. AI 가 이미 이해한 값(정기 매수 금액·조건부 매수 하락률·
 * 금액 등)은 이 카드에 다시 묻지 않고, 실제로 모호하거나 비어 있는 값만 세그먼트·칩·입력
 * 필드로 모아 보여준다. 항목당 CTA 는 하나뿐이다("선택한 내용으로 계속하기").
 *
 * §매주·매달 실행일 모델 분리 — 정기 매수 실행일 항목은 주기(frequency)에 따라 요일 칩
 * 또는 매수일(1일/15일/25일/말일) 칩 중 하나만 보여준다. AI 가 주기 자체를 알아내지
 * 못했으면(둘 다 언급 없이 금액만 말한 드문 경우) 주기부터 고르게 한 뒤 그에 맞는 칩을 보여준다.
 *
 * §추가 매수 기준 가격 인터랙션 수정(§사용자 확정) — 평균 매수가는 사용자가 입력하거나 수정하는
 * 값이 아니다. TypeScript 백테스트 엔진이 실행된 매수 내역으로 직접 계산한다. 그래서 이 카드는
 * 평균 매수가를 묻는 입력 필드를 두지 않는다. 그 안내(자동 계산된다는 사실)는 이 카드 밖,
 * Screen3PlanConfirm 의 계획 요약 아래에 가벼운 보조 문구 하나로만 보여준다(§추가 매수 기준
 * 영역 경량화 — 필수 확인 항목보다 먼저 크고 무겁게 보이면 안 된다). 대신 조건부 매수 "금액"이
 * 최소 금액에 못 미치면(예: 200원) 그 금액만 확인 항목으로 고치게 한다.
 */
import * as React from "react";
import { FieldMessage, TextInput } from "@/components/ui/textInput";
import { Button } from "@/components/ui/button";
import { DAY_OF_MONTH_LABEL, DAY_OF_MONTH_OPTIONS, WEEKDAY_LABEL, type DayOfMonth, type Weekday } from "@/domain/simulation";
import { formatByCurrency } from "@/components/app/PlanCard";
import { amountTooLowMessage, minAmountFor, parseValidAmount } from "@/lib/answerParsers";

const WEEKDAYS: Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

function amountPlaceholder(currency: "USD" | "KRW"): string {
  return currency === "KRW" ? "예: 50만원, 1,000,000원" : "예: 50달러, $50";
}

/** "1,000원 이상 입력해주세요."(§사용자 확정 정확한 문구 — "매수 금액은" 접두어 없이 항목
 * 라벨만으로 충분하다). */
function belowMinimumMessage(currency: "USD" | "KRW"): string {
  const min = minAmountFor(currency);
  return `${formatByCurrency(min, currency)} 이상 입력해주세요.`;
}

/** 조건부 매수 금액 빠른 선택지 — 최소 금액 근처의 대표 값 두 개(§사용자 확정 예시: 1,000원·
 * 10,000원). */
function quickConditionalAmounts(currency: "USD" | "KRW"): [number, number] {
  return currency === "KRW" ? [1_000, 10_000] : [1, 10];
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-full bg-action px-3.5 py-2 text-body font-medium text-action-text"
          : "rounded-full border border-border bg-bg px-3.5 py-2 text-body font-medium text-text-primary hover:bg-surface"
      }
    >
      {label}
    </button>
  );
}

function FieldBlock({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-2 text-caption text-text-tertiary">{label}</p>
      {children}
      {error ? (
        <div className="mt-2">
          <FieldMessage tone="error">{error}</FieldMessage>
        </div>
      ) : null}
    </div>
  );
}

export interface MissingFieldsDraft {
  /** recurringGap.frequency 가 이미 정해져 있으면(AI 가 매주/매달을 알아냈으면) 이 값은
   * 무시된다 — 이 필드는 AI 도 주기 자체를 알아내지 못한 드문 경우에만 쓰인다. */
  frequency: "weekly" | "monthly" | null;
  weekday: Weekday | null;
  dayOfMonth: DayOfMonth | null;
  conditionalAmountText: string;
  budgetEnabled: boolean;
  budgetText: string;
}

export interface MissingFieldsErrors {
  frequency: string | null;
  executionDay: string | null;
  conditionalAmount: string | null;
  budget: string | null;
}

/** null 이면 정기 매수 실행일 항목 자체를 카드에 넣지 않는다(§4의 3항목 예시처럼, 실제로
 * 모호한 항목만 보여준다). frequency 가 null 이면 AI 도 매주/매달을 알아내지 못한 것이다. */
export type RecurringGap = { frequency: "weekly" | "monthly" | null } | null;

/** 조건부 매수 금액이 최소 금액에 못 미칠 때만 채운다(예: "200원 더" — 1,000원 미만). */
export type ConditionalAmountGap = { currentAmountKrw: number } | null;

interface MissingFieldsCardProps {
  currency: "USD" | "KRW";
  recurringGap: RecurringGap;
  conditionalAmountGap: ConditionalAmountGap;
  draft: MissingFieldsDraft;
  onChange: (next: MissingFieldsDraft) => void;
  errors: MissingFieldsErrors;
  onSubmit: () => void;
}

export function MissingFieldsCard({
  currency,
  recurringGap,
  conditionalAmountGap,
  draft,
  onChange,
  errors,
  onSubmit,
}: MissingFieldsCardProps) {
  const itemCount = (recurringGap !== null ? 1 : 0) + (conditionalAmountGap !== null ? 1 : 0) + 1;
  const resolvedFrequency = recurringGap?.frequency ?? draft.frequency;
  const [quickAmountA, quickAmountB] = quickConditionalAmounts(currency);

  return (
    <div className="rounded-lg border border-border bg-bg px-5 py-5">
      <p className="mb-4 text-card text-text-primary">{itemCount}가지만 확인해주세요</p>
      <div className="space-y-5">
        {recurringGap !== null ? (
          <FieldBlock label="정기 매수 실행일" error={errors.frequency ?? errors.executionDay}>
            {recurringGap.frequency === null ? (
              <div className="mb-3 grid grid-cols-2 gap-2">
                <Chip label="매주" active={draft.frequency === "weekly"} onClick={() => onChange({ ...draft, frequency: "weekly" })} />
                <Chip
                  label="매달"
                  active={draft.frequency === "monthly"}
                  onClick={() => onChange({ ...draft, frequency: "monthly" })}
                />
              </div>
            ) : null}
            {resolvedFrequency === "weekly" ? (
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((weekday) => (
                  <Chip
                    key={weekday}
                    label={WEEKDAY_LABEL[weekday]}
                    active={draft.weekday === weekday}
                    onClick={() => onChange({ ...draft, weekday })}
                  />
                ))}
              </div>
            ) : resolvedFrequency === "monthly" ? (
              <div className="flex flex-wrap gap-2">
                {DAY_OF_MONTH_OPTIONS.map((day) => (
                  <Chip
                    key={String(day)}
                    label={DAY_OF_MONTH_LABEL[day]}
                    active={draft.dayOfMonth === day}
                    onClick={() => onChange({ ...draft, dayOfMonth: day })}
                  />
                ))}
              </div>
            ) : null}
          </FieldBlock>
        ) : null}

        {conditionalAmountGap !== null ? (
          <FieldBlock label="추가 매수 금액" error={errors.conditionalAmount}>
            <div className="mb-2 grid grid-cols-2 gap-2">
              <Chip
                label={formatByCurrency(quickAmountA, currency)}
                active={draft.conditionalAmountText === String(quickAmountA)}
                onClick={() => onChange({ ...draft, conditionalAmountText: String(quickAmountA) })}
              />
              <Chip
                label={formatByCurrency(quickAmountB, currency)}
                active={draft.conditionalAmountText === String(quickAmountB)}
                onClick={() => onChange({ ...draft, conditionalAmountText: String(quickAmountB) })}
              />
            </div>
            <TextInput
              inputMode="numeric"
              value={draft.conditionalAmountText}
              onChange={(e) => onChange({ ...draft, conditionalAmountText: e.target.value })}
              placeholder={amountPlaceholder(currency)}
            />
          </FieldBlock>
        ) : null}

        <FieldBlock label="월 투자 한도" error={errors.budget}>
          <div className="grid grid-cols-2 gap-2">
            <Chip label="정하지 않기" active={!draft.budgetEnabled} onClick={() => onChange({ ...draft, budgetEnabled: false })} />
            <Chip label="직접 입력" active={draft.budgetEnabled} onClick={() => onChange({ ...draft, budgetEnabled: true })} />
          </div>
          {draft.budgetEnabled ? (
            <div className="mt-2">
              <TextInput
                inputMode="numeric"
                value={draft.budgetText}
                onChange={(e) => onChange({ ...draft, budgetText: e.target.value })}
                placeholder={amountPlaceholder(currency)}
              />
            </div>
          ) : null}
        </FieldBlock>
      </div>

      <div className="mt-6">
        <Button onClick={onSubmit}>선택한 내용으로 계속하기</Button>
      </div>
    </div>
  );
}

/** 카드에 입력한 값을 검증한다 — 통과하면 null, 실패한 필드만 오류 문구를 돌려준다. */
export function validateMissingFieldsDraft(
  draft: MissingFieldsDraft,
  recurringGap: RecurringGap,
  conditionalAmountGap: ConditionalAmountGap,
  currency: "USD" | "KRW"
): MissingFieldsErrors {
  const resolvedFrequency = recurringGap?.frequency ?? draft.frequency;
  return {
    frequency: recurringGap !== null && recurringGap.frequency === null && draft.frequency === null ? "주기를 선택해주세요." : null,
    executionDay:
      recurringGap !== null && resolvedFrequency !== null
        ? resolvedFrequency === "weekly"
          ? draft.weekday === null
            ? "실행일을 선택해주세요."
            : null
          : draft.dayOfMonth === null
            ? "매수일을 선택해주세요."
            : null
        : null,
    conditionalAmount:
      conditionalAmountGap !== null && parseValidAmount(draft.conditionalAmountText, currency) === null
        ? belowMinimumMessage(currency)
        : null,
    budget:
      draft.budgetEnabled && parseValidAmount(draft.budgetText, currency) === null
        ? amountTooLowMessage(currency)
        : null,
  };
}
