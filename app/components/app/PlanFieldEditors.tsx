/**
 * 계획 확인 화면의 항목별 전용 수정 UI — PlanCard 의 "수정" 버튼이 여는 시트 안쪽 내용.
 *
 * 근거: 사용자 확정 — 종목 이외 항목(정기 매수·조건부 매수·평균 매수가·월 예산·조건부 매수
 * 횟수·재검토 조건)은 AI 자연어 파싱을 거치지 않는 결정적 UI 편집이다. 각 컴포넌트는 draft를
 * 로컬 state 로만 들고 있다가 "변경 내용 확인하기"를 누를 때만 완성된 AppPlan 을 돌려준다
 * (currentPlan 은 그 순간에만 바뀐다 — 그전까지는 취소해도 아무 영향이 없다).
 */
import * as React from "react";
import { FieldMessage, TextInput } from "@/components/ui/textInput";
import { DAY_OF_MONTH_LABEL, DAY_OF_MONTH_OPTIONS, WEEKDAY_LABEL, type DayOfMonth, type Weekday } from "@/domain/simulation";
import { amountTooLowMessage, parsePercent, parseValidAmount } from "@/lib/answerParsers";
import type { AppPlan } from "@/types/appPlan";
import type { PlanInterpretFields } from "@/types/planInterpret";
import { FieldEditSheet } from "@/components/app/FieldEditSheet";

const WEEKDAYS: Weekday[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

/** plan(확정된 값)·interpretFields(AI 가 방금 추출한 부분 값) 어느 쪽에서 왔든 같은 평평한
 * 모양으로 통일한다 — plan.recurring 은 판별 유니온(weekday XOR dayOfMonth)이고
 * interpretFields.recurring 은 둘 다 nullable 로 갖고 있는 다른 모양이라, 시트 로컬 state 를
 * 세팅하는 곳마다 이 둘을 갈라 다루지 않게 여기서 한 번에 정규화한다(§매주·매달 실행일
 * 모델 분리). */
interface RecurringDraftShape {
  frequency: "weekly" | "monthly" | null;
  weekday: Weekday | null;
  dayOfMonth: DayOfMonth | null;
  amountKrw: number | null;
}

function deriveRecurringDraft(plan: AppPlan, interpretFields?: PlanInterpretFields): RecurringDraftShape {
  if (plan.recurring !== null) {
    return plan.recurring.frequency === "weekly"
      ? { frequency: "weekly", weekday: plan.recurring.weekday, dayOfMonth: null, amountKrw: plan.recurring.amountKrw }
      : { frequency: "monthly", weekday: null, dayOfMonth: plan.recurring.dayOfMonth, amountKrw: plan.recurring.amountKrw };
  }
  return interpretFields?.recurring ?? { frequency: null, weekday: null, dayOfMonth: null, amountKrw: null };
}

/** 금액 필드는 모두 종목 통화(`plan.asset.quoteCurrency`)에 맞춰 표시·입력·검증한다(§사용자
 * 확정 — 국내·미국 주식 통화 일치, 환율 변환 없이 원/달러 기호만 종목에 맞춘다). 계산 자체
 * (`amountKrw` 필드명)는 통화와 무관한 숫자 하나일 뿐이라 엔진은 그대로 둔다 — 여기서 바뀌는
 * 건 사람이 보는 라벨·placeholder·오류 문구·파서뿐이다. */
function amountPlaceholder(currency: "USD" | "KRW"): string {
  return currency === "KRW" ? "예: 50만원, 1,000,000원" : "예: 50달러, $50";
}

/** §추가 매수 기준 가격 인터랙션 수정(§사용자 확정) — 평균 매수가는 백테스트 엔진이 실행된
 * 매수 내역으로 직접 계산하는 값이라 이 시트에서 입력받지 않는다. 하락률 입력창에 아직 유효한
 * 값이 없으면 숫자를 만들어 넣지 않고 일반 문구로 대신한다. */
function conditionalThresholdCaption(percentText: string): string {
  const percent = Number(percentText);
  return Number.isFinite(percent) && percent > 0
    ? `첫 정기 매수 이후, 평균 매수가보다 ${percent}% 낮아지면 추가 매수해요.`
    : "첫 정기 매수 이후, 평균 매수가보다 정한 하락률만큼 낮아지면 추가 매수해요.";
}

function WeekdayPicker({ value, onChange }: { value: Weekday | null; onChange: (weekday: Weekday) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {WEEKDAYS.map((weekday) => (
        <button
          key={weekday}
          type="button"
          onClick={() => onChange(weekday)}
          aria-pressed={value === weekday}
          className={
            value === weekday
              ? "rounded-full bg-action px-3.5 py-2 text-body font-medium text-action-text"
              : "rounded-full border border-border bg-bg px-3.5 py-2 text-body font-medium text-text-primary hover:bg-surface"
          }
        >
          {WEEKDAY_LABEL[weekday]}
        </button>
      ))}
    </div>
  );
}

function DayOfMonthPicker({ value, onChange }: { value: DayOfMonth | null; onChange: (day: DayOfMonth) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {DAY_OF_MONTH_OPTIONS.map((day) => (
        <button
          key={String(day)}
          type="button"
          onClick={() => onChange(day)}
          aria-pressed={value === day}
          className={
            value === day
              ? "rounded-full bg-action px-3.5 py-2 text-body font-medium text-action-text"
              : "rounded-full border border-border bg-bg px-3.5 py-2 text-body font-medium text-text-primary hover:bg-surface"
          }
        >
          {DAY_OF_MONTH_LABEL[day]}
        </button>
      ))}
    </div>
  );
}

function ToggleRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "w-full rounded-lg border border-text-primary bg-surface px-4 py-3 text-left text-body text-text-primary"
          : "w-full rounded-lg border border-border bg-bg px-4 py-3 text-left text-body text-text-secondary hover:bg-surface"
      }
    >
      {label}
    </button>
  );
}

interface EditorProps {
  open: boolean;
  plan: AppPlan;
  onApply: (plan: AppPlan) => void;
  onCancel: () => void;
  /** AI 가 방금 추출했지만 아직 계획에 반영되지 못한 부분 값(예: 요일 없이 금액만 말한 경우) —
   * 시트를 처음 열 때 그 값을 이어받아 채운다(§입력 방식 재설계 — "AI 가 이해한 내용은 채워진
   * 채로 보여준다"). plan 에 이미 반영된 값이 있으면 그쪽을 우선한다. */
  interpretFields?: PlanInterpretFields;
}

/** "정기 매수" 구역 — 사용 여부·주기·요일·금액을 함께 수정한다(§사용자 확정 — 꺼져 있을 때도
 * 다시 켤 수 있어야 한다. 이전에는 끄는 토글만 있어 한 번 끄면 이 시트로는 다시 켤 수 없었다). */
export function RecurringScheduleEditor({ open, plan, onApply, onCancel, interpretFields }: EditorProps) {
  const currency = plan.asset.quoteCurrency;
  const draft = deriveRecurringDraft(plan, interpretFields);
  // AI 가 요일 없이 금액만(또는 그 반대로) 추출해도 정기 매수 의도 자체는 분명하므로, 시트가
  // 처음부터 "사용"으로 열려 이미 아는 값을 곧바로 보여준다(§입력 방식 재설계 — "AI 가 이해한
  // 내용은 채워진 채로 보여준다"). plan.recurring 이 null 이어도 draft 가 있으면 켠다.
  const [enabled, setEnabled] = React.useState(plan.recurring !== null || draft.frequency !== null);
  // 매주·매달 중 어느 쪽인지 아직 모르면(순수 금액만 말한 경우) 기본값 매주로 시작한다 —
  // 사용자가 직접 골라 바꿀 수 있다(§매주·매달 실행일 모델 분리).
  const [frequency, setFrequency] = React.useState<"weekly" | "monthly">(draft.frequency === "monthly" ? "monthly" : "weekly");
  const [weekday, setWeekday] = React.useState<Weekday | null>(draft.weekday);
  const [dayOfMonth, setDayOfMonth] = React.useState<DayOfMonth | null>(draft.dayOfMonth);
  const [amountText, setAmountText] = React.useState(draft.amountKrw !== null ? String(draft.amountKrw) : "");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const nextDraft = deriveRecurringDraft(plan, interpretFields);
    setEnabled(plan.recurring !== null || nextDraft.frequency !== null);
    setFrequency(nextDraft.frequency === "monthly" ? "monthly" : "weekly");
    setWeekday(nextDraft.weekday);
    setDayOfMonth(nextDraft.dayOfMonth);
    setAmountText(nextDraft.amountKrw !== null ? String(nextDraft.amountKrw) : "");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan, interpretFields]);

  function confirm() {
    if (!enabled) {
      onApply({ ...plan, recurring: null });
      return;
    }
    const amount = parseValidAmount(amountText, currency);
    if (amount === null) {
      setError(amountTooLowMessage(currency));
      return;
    }
    if (frequency === "weekly") {
      if (weekday === null) {
        setError("요일을 선택해주세요.");
        return;
      }
      onApply({ ...plan, recurring: { frequency: "weekly", weekday, amountKrw: amount } });
      return;
    }
    if (dayOfMonth === null) {
      setError("매수일을 선택해주세요.");
      return;
    }
    onApply({ ...plan, recurring: { frequency: "monthly", dayOfMonth, amountKrw: amount } });
  }

  return (
    <FieldEditSheet open={open} title="정기 매수 수정" onCancel={onCancel} onConfirm={confirm}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <ToggleRow label="정기 매수 사용" active={enabled} onClick={() => setEnabled(true)} />
          <ToggleRow label="정기 매수 안 함" active={!enabled} onClick={() => setEnabled(false)} />
        </div>
        {enabled ? (
          <div className="space-y-3">
            <p className="text-caption text-text-tertiary">주기</p>
            <div className="grid grid-cols-2 gap-2">
              <ToggleRow label="매주" active={frequency === "weekly"} onClick={() => setFrequency("weekly")} />
              <ToggleRow label="매달" active={frequency === "monthly"} onClick={() => setFrequency("monthly")} />
            </div>
            {frequency === "weekly" ? (
              <>
                <p className="text-caption text-text-tertiary">요일</p>
                <WeekdayPicker value={weekday} onChange={setWeekday} />
              </>
            ) : (
              <>
                <p className="text-caption text-text-tertiary">매수일</p>
                <DayOfMonthPicker value={dayOfMonth} onChange={setDayOfMonth} />
              </>
            )}
            <p className="text-caption text-text-tertiary">금액</p>
            <TextInput
              inputMode="numeric"
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              placeholder={amountPlaceholder(currency)}
            />
          </div>
        ) : null}
        {error !== null ? <FieldMessage tone="error">{error}</FieldMessage> : null}
      </div>
    </FieldEditSheet>
  );
}

/** "추가 매수" 구역 — 사용 여부·기준 가격·하락률·매수 금액·최대 횟수를 한 시트에서 함께
 * 수정한다(§사용자 확정 — 평균 매수가·최대 횟수를 별도 시트로 나누지 않는다. 구역마다 수정
 * 링크를 하나만 두기 위해서다). 꺼져 있어도 이 시트에서 바로 다시 켤 수 있다. */
export function ConditionalRuleEditor({ open, plan, onApply, onCancel, interpretFields }: EditorProps) {
  const conditional = plan.conditionalBuy;
  const currency = plan.asset.quoteCurrency;
  const draft = conditional ?? interpretFields?.conditionalBuy ?? null;
  // AI 가 하락률·금액 등 일부만 추출해도 추가 매수 의도 자체는 분명하므로, 시트가 처음부터
  // "사용"으로 열려 이미 아는 값을 곧바로 보여준다(§입력 방식 재설계). conditional(plan 값)이
  // null 이어도 draft(추출된 부분 값)가 있으면 켠다.
  const [enabled, setEnabled] = React.useState(draft !== null);
  const [percentText, setPercentText] = React.useState(
    draft?.thresholdPercent !== null && draft?.thresholdPercent !== undefined ? String(draft.thresholdPercent) : ""
  );
  const [amountText, setAmountText] = React.useState(
    draft?.amountKrw !== null && draft?.amountKrw !== undefined ? String(draft.amountKrw) : ""
  );
  const [maxCountEnabled, setMaxCountEnabled] = React.useState(
    plan.guardrails.maxConditionalExecutionsPerMonth !== null
  );
  const [maxCountText, setMaxCountText] = React.useState(
    plan.guardrails.maxConditionalExecutionsPerMonth !== null
      ? String(plan.guardrails.maxConditionalExecutionsPerMonth)
      : ""
  );
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const c = plan.conditionalBuy;
    const nextDraft = c ?? interpretFields?.conditionalBuy ?? null;
    setEnabled(nextDraft !== null);
    setPercentText(
      nextDraft?.thresholdPercent !== null && nextDraft?.thresholdPercent !== undefined
        ? String(nextDraft.thresholdPercent)
        : ""
    );
    setAmountText(
      nextDraft?.amountKrw !== null && nextDraft?.amountKrw !== undefined ? String(nextDraft.amountKrw) : ""
    );
    setMaxCountEnabled(plan.guardrails.maxConditionalExecutionsPerMonth !== null);
    setMaxCountText(
      plan.guardrails.maxConditionalExecutionsPerMonth !== null
        ? String(plan.guardrails.maxConditionalExecutionsPerMonth)
        : ""
    );
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, plan, interpretFields]);

  function confirm() {
    if (!enabled) {
      onApply({ ...plan, conditionalBuy: null });
      return;
    }
    const percent = parsePercent(percentText.trim().endsWith("%") ? percentText : `${percentText}%`);
    if (percent === null || !(percent > 0 && percent < 100)) {
      setError("하락률은 0보다 크고 100보다 작아야 해요.");
      return;
    }
    const amount = parseValidAmount(amountText, currency);
    if (amount === null) {
      setError(amountTooLowMessage(currency));
      return;
    }
    let maxCount: number | null = null;
    if (maxCountEnabled) {
      const parsed = Number(maxCountText);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        setError("최대 횟수는 1 이상의 정수여야 해요.");
        return;
      }
      maxCount = parsed;
    }
    onApply({
      ...plan,
      conditionalBuy: { thresholdPercent: percent, amountKrw: amount },
      guardrails: { ...plan.guardrails, maxConditionalExecutionsPerMonth: maxCount },
    });
  }

  return (
    <FieldEditSheet open={open} title="추가 매수 수정" onCancel={onCancel} onConfirm={confirm}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <ToggleRow label="추가 매수 사용" active={enabled} onClick={() => setEnabled(true)} />
          <ToggleRow label="추가 매수 안 함" active={!enabled} onClick={() => setEnabled(false)} />
        </div>
        {enabled ? (
          <div className="space-y-3">
            <div className="rounded-md bg-surface px-4 py-3">
              <p className="text-caption text-text-tertiary">추가 매수 기준</p>
              <p className="mt-0.5 text-body font-medium text-text-primary">시뮬레이션 평균 매수가</p>
              <p className="mt-1 text-caption text-text-tertiary">
                {conditionalThresholdCaption(percentText)}
              </p>
            </div>
            <div>
              <p className="mb-2 text-caption text-text-tertiary">하락률</p>
              <TextInput value={percentText} onChange={(e) => setPercentText(e.target.value)} placeholder="예: 12%, 7.5%" />
            </div>
            <div>
              <p className="mb-2 text-caption text-text-tertiary">추가 매수 금액</p>
              <TextInput value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={amountPlaceholder(currency)} />
            </div>
            <div>
              <p className="mb-2 text-caption text-text-tertiary">최대 횟수</p>
              <div className="grid grid-cols-2 gap-2">
                <ToggleRow label="정할게요" active={maxCountEnabled} onClick={() => setMaxCountEnabled(true)} />
                <ToggleRow label="정하지 않아요" active={!maxCountEnabled} onClick={() => setMaxCountEnabled(false)} />
              </div>
              {maxCountEnabled ? (
                <div className="mt-2">
                  <TextInput
                    inputMode="numeric"
                    value={maxCountText}
                    onChange={(e) => setMaxCountText(e.target.value)}
                    placeholder="예: 3"
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        {error !== null ? <FieldMessage tone="error">{error}</FieldMessage> : null}
      </div>
    </FieldEditSheet>
  );
}

/** "월 투자 한도" 구역 — 사용 여부·금액을 함께 수정한다. 꺼져 있어도 이 시트에서 바로 다시
 * 켤 수 있다(§사용자 확정 — 예산 수정이 적용되지 않던 문제의 실제 원인은 이 "다시 켜는"
 * 경로 자체가 없었던 것이었다). */
export function MonthlyBudgetEditor({ open, plan, onApply, onCancel }: EditorProps) {
  const currency = plan.asset.quoteCurrency;
  const current = plan.guardrails.monthlyBudgetKrw;
  const [enabled, setEnabled] = React.useState(current !== null);
  const [text, setText] = React.useState(current !== null ? String(current) : "");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setEnabled(current !== null);
    setText(current !== null ? String(current) : "");
    setError(null);
  }, [open, current]);

  function confirm() {
    if (!enabled) {
      onApply({ ...plan, guardrails: { ...plan.guardrails, monthlyBudgetKrw: null } });
      return;
    }
    const amount = parseValidAmount(text, currency);
    if (amount === null) {
      setError(amountTooLowMessage(currency));
      return;
    }
    onApply({ ...plan, guardrails: { ...plan.guardrails, monthlyBudgetKrw: amount } });
  }

  return (
    <FieldEditSheet open={open} title="월 투자 한도 수정" onCancel={onCancel} onConfirm={confirm}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <ToggleRow label="예산 사용" active={enabled} onClick={() => setEnabled(true)} />
          <ToggleRow label="예산을 정하지 않음" active={!enabled} onClick={() => setEnabled(false)} />
        </div>
        {enabled ? (
          <TextInput
            inputMode="numeric"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={amountPlaceholder(currency)}
          />
        ) : null}
        {error !== null ? <FieldMessage tone="error">{error}</FieldMessage> : null}
      </div>
    </FieldEditSheet>
  );
}

