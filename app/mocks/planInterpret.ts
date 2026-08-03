/**
 * 오프라인 데모 계획 해석 — `VITE_USE_MOCK_AI=true` 일 때만 쓴다.
 *
 * 실제 Claude 호출(`app/data/plan/client.ts`)과 **같은 응답 모양**(`PlanInterpretResponse`)을
 * 돌려준다. NLP 추출 능력은 없다 — `MOCK_QUESTIONS` 순서대로 아직 채워지지 않은 필드를 하나씩
 * 묻기만 한다(기존 1차 mock 플로우와 같은 문구를 재사용한다).
 */
import { MOCK_QUESTIONS } from "@/mocks";
import type {
  PlanInterpretFieldPath,
  PlanInterpretFields,
  PlanInterpretRequest,
  PlanInterpretResponse,
} from "@/types/planInterpret";

const MOCK_DELAY_MS = 500;
/** 옛 mock 플로우는 추가 매수 금액을 따로 묻지 않고 이 값으로 고정했다. 그대로 유지한다. */
const DEFAULT_CONDITIONAL_AMOUNT_KRW = 20_000;

function isFieldFilled(fields: PlanInterpretFields, fieldPath: PlanInterpretFieldPath): boolean {
  switch (fieldPath) {
    case "assetQuery":
      return fields.assetQuery !== null;
    // 데모 mock 은 이 두 필드를 직접 묻지 않는다(MOCK_QUESTIONS 에 없음) — 항상 "이미 채워짐"
    // 취급해 데모 질문 순서에 끼어들지 않게 한다.
    case "recurring.enabled":
    case "conditionalBuy.enabled":
      return true;
    case "recurring.frequency":
      return fields.recurring?.frequency != null;
    case "recurring.weekday":
      return fields.recurring?.weekday != null;
    case "recurring.dayOfMonth":
      return fields.recurring?.dayOfMonth != null;
    case "recurring.amountKrw":
      return fields.recurring?.amountKrw != null;
    case "conditionalBuy.thresholdPercent":
      return fields.conditionalBuy?.thresholdPercent != null;
    case "conditionalBuy.amountKrw":
      return fields.conditionalBuy?.amountKrw != null;
    case "guardrails.monthlyBudgetKrw":
      return fields.guardrails.monthlyBudgetKrw != null;
  }
}

/** 옛 mock 관례: 하락률이 채워지면 추가 매수 금액은 고정값으로 채운다. */
function applyMockDefaults(fields: PlanInterpretFields): PlanInterpretFields {
  const conditional = fields.conditionalBuy;
  if (conditional !== null && conditional.thresholdPercent !== null && conditional.amountKrw === null) {
    return { ...fields, conditionalBuy: { ...conditional, amountKrw: DEFAULT_CONDITIONAL_AMOUNT_KRW } };
  }
  return fields;
}

export async function interpretPlanMock(request: PlanInterpretRequest): Promise<PlanInterpretResponse> {
  await new Promise((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

  const fields = applyMockDefaults(request.currentFields);
  const nextMockQuestion = MOCK_QUESTIONS.find((question) => {
    const fieldPath = question.fieldPath as PlanInterpretFieldPath;
    return !isFieldFilled(fields, fieldPath) && !request.skippedFieldPaths.includes(fieldPath);
  });

  if (nextMockQuestion === undefined) {
    return {
      understoodIntent: "데모 데이터로 계획을 구성했어요.",
      hasRecognizableIntent: true,
      extractedFields: fields,
      missingFields: [],
      nextQuestion: null,
      selectableAnswers: [],
      isPlanReady: true,
      warnings: [],
      assetCandidates: null,
      ambiguousQuantityText: null,
    };
  }

  const fieldPath = nextMockQuestion.fieldPath as PlanInterpretFieldPath;
  return {
    understoodIntent: "데모 데이터로 다음 질문을 준비했어요.",
    hasRecognizableIntent: true,
    extractedFields: fields,
    missingFields: [{ fieldPath, reason: "required_for_plan", priority: 1 }],
    nextQuestion: {
      fieldPath,
      question: nextMockQuestion.question,
      reason: nextMockQuestion.reason,
      inputType: nextMockQuestion.inputType,
      required: fieldPath !== "guardrails.monthlyBudgetKrw",
    },
    selectableAnswers: nextMockQuestion.options.map((option) => ({
      label: option.label,
      value: option.value,
    })),
    isPlanReady: false,
    warnings: [],
    assetCandidates: null,
    ambiguousQuantityText: null,
  };
}
