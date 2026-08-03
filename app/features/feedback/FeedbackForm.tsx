/**
 * 사용성 피드백 설문 폼 — 한 화면에 1~2문항, 이전/다음으로 이동한다.
 *
 * 근거: 사용자 확정 — 투자 리허설의 채팅 말풍선 UI를 재사용하지 않는다(설문은 AI 와의 대화가
 * 아니라 별도 피드백 폼이다). 기존 디자인 토큰(폰트·색·radius)은 그대로 쓰되, 진행 표시는
 * 설문 안에서만 쓰고 기존 앱 화면(1/5 등)과 절대 섞지 않는다.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  emptyFeedbackDraft,
  isFeedbackDraftComplete,
  MAX_OPEN_FEEDBACK_LENGTH,
  type FeedbackDraft,
  type FeedbackSubmissionPayload,
  type HardestStep,
  type InvestmentExperience,
  type OrderCapabilityUnderstanding,
  type ProductUnderstanding,
} from "./feedback.types";

/** sessionId 는 FeedbackPage 가 붙인다 — 이 폼은 설문 내용만 안다. */
export type FeedbackAnswers = Omit<FeedbackSubmissionPayload, "sessionId">;

const TOTAL_STEPS = 4;

function RadioOption({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "min-h-[52px] w-full rounded-lg border px-4 py-3 text-left text-body transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong",
        selected
          ? "border-action bg-action-soft font-medium text-text-primary"
          : "border-border bg-bg text-text-primary hover:bg-surface"
      )}
    >
      {label}
    </button>
  );
}

function QuestionBlock({ question, children }: { question: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-card text-text-primary">{question}</p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

const INVESTMENT_EXPERIENCE_OPTIONS: Array<{ value: InvestmentExperience; label: string }> = [
  { value: "none", label: "없음" },
  { value: "under_1_year", label: "1년 미만" },
  { value: "1_to_3_years", label: "1~3년" },
  { value: "over_3_years", label: "3년 이상" },
];

const PRODUCT_UNDERSTANDING_OPTIONS: Array<{ value: ProductUnderstanding; label: string }> = [
  { value: "recommendation", label: "투자 종목 추천" },
  { value: "prediction", label: "미래 수익 예측" },
  { value: "historical_rehearsal", label: "내가 정한 투자 방법을 과거 가격에 적용" },
  { value: "automatic_order", label: "실제 주문 실행" },
  { value: "unknown", label: "잘 모르겠음" },
];

const HARDEST_STEP_OPTIONS: Array<{ value: HardestStep; label: string }> = [
  { value: "input", label: "투자 방법 입력" },
  { value: "asset_search", label: "종목 선택" },
  { value: "conditional_rule", label: "조건 설정" },
  { value: "plan_confirmation", label: "계획 확인" },
  { value: "result", label: "결과 이해" },
  { value: "none", label: "어려운 단계 없음" },
];

const ORDER_CAPABILITY_OPTIONS: Array<{ value: OrderCapabilityUnderstanding; label: string }> = [
  { value: "yes", label: "예" },
  { value: "no", label: "아니요" },
  { value: "unknown", label: "잘 모르겠음" },
];

interface FeedbackFormProps {
  onSubmit: (answers: FeedbackAnswers) => void;
  submitting: boolean;
}

export function FeedbackForm({ onSubmit, submitting }: FeedbackFormProps) {
  const [step, setStep] = React.useState(1);
  const [draft, setDraft] = React.useState<FeedbackDraft>(emptyFeedbackDraft());

  function patch(partial: Partial<FeedbackDraft>) {
    setDraft((prev) => ({ ...prev, ...partial }));
  }

  const step1Complete = draft.investmentExperience !== null && draft.productUnderstanding !== null;
  const step2Complete = draft.reachedResult !== null && draft.hardestStep !== null;
  const step3Complete = draft.resultComprehensionScore !== null && draft.orderCapabilityUnderstanding !== null;
  const canSubmit = isFeedbackDraftComplete(draft);

  function handleNext() {
    setStep((prev) => Math.min(TOTAL_STEPS, prev + 1));
  }
  function handlePrev() {
    setStep((prev) => Math.max(1, prev - 1));
  }
  function handleSubmit() {
    if (!isFeedbackDraftComplete(draft)) return;
    const trimmedOpenFeedback = draft.openFeedback.trim();
    onSubmit({
      investmentExperience: draft.investmentExperience,
      productUnderstanding: draft.productUnderstanding,
      reachedResult: draft.reachedResult,
      hardestStep: draft.hardestStep,
      resultComprehensionScore: draft.resultComprehensionScore,
      orderCapabilityUnderstanding: draft.orderCapabilityUnderstanding,
      ...(trimmedOpenFeedback !== "" ? { openFeedback: trimmedOpenFeedback.slice(0, MAX_OPEN_FEEDBACK_LENGTH) } : {}),
    });
  }

  return (
    <div className="space-y-6">
      <p className="text-caption text-text-tertiary" aria-live="polite">
        {step} / {TOTAL_STEPS}
      </p>

      {step === 1 ? (
        <div className="space-y-6">
          <QuestionBlock question="평소 주식 투자 경험이 어느 정도 되시나요?">
            {INVESTMENT_EXPERIENCE_OPTIONS.map((option) => (
              <RadioOption
                key={option.value}
                label={option.label}
                selected={draft.investmentExperience === option.value}
                onClick={() => patch({ investmentExperience: option.value })}
              />
            ))}
          </QuestionBlock>
          <QuestionBlock question="이 서비스가 하는 일로 가장 가깝게 느낀 것은 무엇인가요?">
            {PRODUCT_UNDERSTANDING_OPTIONS.map((option) => (
              <RadioOption
                key={option.value}
                label={option.label}
                selected={draft.productUnderstanding === option.value}
                onClick={() => patch({ productUnderstanding: option.value })}
              />
            ))}
          </QuestionBlock>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-6">
          <QuestionBlock question="결과 화면까지 확인하셨나요?">
            <RadioOption label="예" selected={draft.reachedResult === true} onClick={() => patch({ reachedResult: true })} />
            <RadioOption label="아니요" selected={draft.reachedResult === false} onClick={() => patch({ reachedResult: false })} />
          </QuestionBlock>
          <QuestionBlock question="가장 어려웠던 단계는 무엇인가요?">
            {HARDEST_STEP_OPTIONS.map((option) => (
              <RadioOption
                key={option.value}
                label={option.label}
                selected={draft.hardestStep === option.value}
                onClick={() => patch({ hardestStep: option.value })}
              />
            ))}
          </QuestionBlock>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="space-y-6">
          <QuestionBlock question="결과 화면을 얼마나 이해하기 쉬웠나요?">
            <div className="flex gap-2">
              {([1, 2, 3, 4, 5] as const).map((score) => (
                <button
                  key={score}
                  type="button"
                  onClick={() => patch({ resultComprehensionScore: score })}
                  aria-pressed={draft.resultComprehensionScore === score}
                  className={cn(
                    "flex h-[52px] flex-1 items-center justify-center rounded-lg border text-body font-medium",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-strong",
                    draft.resultComprehensionScore === score
                      ? "border-action bg-action-soft text-text-primary"
                      : "border-border bg-bg text-text-primary hover:bg-surface"
                  )}
                >
                  {score}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-caption text-text-tertiary">
              <span>전혀 이해하기 어려웠어요</span>
              <span>바로 이해했어요</span>
            </div>
          </QuestionBlock>
          <QuestionBlock question="실제 주문까지 실행된다고 느꼈나요?">
            {ORDER_CAPABILITY_OPTIONS.map((option) => (
              <RadioOption
                key={option.value}
                label={option.label}
                selected={draft.orderCapabilityUnderstanding === option.value}
                onClick={() => patch({ orderCapabilityUnderstanding: option.value })}
              />
            ))}
          </QuestionBlock>
        </div>
      ) : null}

      {step === 4 ? (
        <div className="space-y-3">
          <p className="text-card text-text-primary">더 하고 싶은 말씀이 있다면 알려주세요.</p>
          <textarea
            value={draft.openFeedback}
            onChange={(event) => patch({ openFeedback: event.target.value.slice(0, MAX_OPEN_FEEDBACK_LENGTH) })}
            rows={5}
            maxLength={MAX_OPEN_FEEDBACK_LENGTH}
            placeholder="화면이나 문구에서 어려웠던 점을 적어주세요. 이름, 계좌 정보나 실제 보유 내역은 입력하지 않아도 돼요."
            className="w-full resize-none rounded-md border border-border bg-bg px-4 py-3 text-body text-text-primary placeholder:text-text-placeholder focus:border-border-strong focus:outline-none focus:ring-0"
          />
          <p className="text-right text-caption text-text-tertiary">
            {draft.openFeedback.length}/{MAX_OPEN_FEEDBACK_LENGTH}
          </p>
        </div>
      ) : null}

      <div className="flex gap-2">
        {step > 1 ? (
          <Button variant="ghost" size="md" onClick={handlePrev} disabled={submitting}>
            이전
          </Button>
        ) : null}
        {step < TOTAL_STEPS ? (
          <Button
            size="md"
            onClick={handleNext}
            disabled={(step === 1 && !step1Complete) || (step === 2 && !step2Complete) || (step === 3 && !step3Complete)}
          >
            다음
          </Button>
        ) : (
          <Button size="md" onClick={handleSubmit} disabled={!canSubmit || submitting} loading={submitting}>
            의견 보내기
          </Button>
        )}
      </div>
      {submitting ? (
        <p className="text-center text-caption text-text-tertiary" aria-live="polite">
          의견을 보내고 있어요
        </p>
      ) : null}
    </div>
  );
}
