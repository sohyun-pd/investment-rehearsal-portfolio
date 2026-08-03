/**
 * AI 설명 실패 시 deterministic fallback — simulation result 필드에서만 문구를 만든다.
 *
 * 근거: 사용자 확정 — "AI 실패 시 deterministic fallback copy 사용, fallback 문구도
 * simulation result 필드에서 생성". `request.causeSentence` 는 이미 호출부(FlowProvider)가
 * `app/lib/simulationCopy.ts` 의 `budgetCauseSentence()` 로 만든 값이다 — 여기서 새로
 * 추론하지 않고 그대로 옮긴다.
 *
 * §똑대리 해석 — 예산 초과 여부만 반복하면 "AI가 상태값을 읽어주는 수준"이라 싱겁다는 피드백에
 * 따라, 조건부 매수 비교 결과(추가 투자금·평가손익 차이·수익률 차이)가 있으면 그 관계를 먼저
 * 설명한다 — 전략을 평가·추천하지 않고 실제로 계산된 숫자 관계만 말한다.
 */
import { formatMoney, formatPercentPointDiff } from "@/lib/simulationCopy";
import type { ReviewRequest, ReviewResponse } from "@/types/review";

function buildComparisonInterpretation(request: ReviewRequest): { headline: string; explanation: string[] } | null {
  // 조건부 매수 자체가 계획에 없으면 비교할 대상이 없다 — 발생 횟수 0과는 다른 경우다(§조건부
  // 매수를 아예 설정하지 않은 계획과, 설정했지만 이번 기간에 발생하지 않은 계획을 구분한다).
  if (!request.plan.hasConditionalBuy) return null;

  const { additionalInvested, profitLossDifference, returnRateDifference } = request.summary;
  const currency = request.plan.currency;

  if (request.summary.conditionalTriggerCount === 0) {
    return {
      headline: "이번 1년에는 추가 매수 조건이 발생하지 않아 정기 매수만 실행됐어요.",
      explanation: ["하락 기준을 바꾸면 같은 기간에서 결과가 어떻게 달라지는지 다시 비교할 수 있어요."],
    };
  }

  if (additionalInvested === null || profitLossDifference === null) return null;

  const investedText = formatMoney(additionalInvested, currency);
  const profitText = formatMoney(Math.abs(profitLossDifference), currency);

  if (profitLossDifference > 0 && (returnRateDifference === null || returnRateDifference >= 0)) {
    const headline =
      returnRateDifference !== null
        ? `추가 매수로 ${investedText}을 더 투자했고, 평가손익은 ${profitText}, 수익률은 ${formatPercentPointDiff(returnRateDifference)} 높아졌어요.`
        : `추가 매수로 ${investedText}을 더 투자했고, 평가손익은 ${profitText} 높아졌어요.`;
    return {
      headline,
      explanation: ["추가 투자금까지 함께 보고 조건을 유지할지 판단해보세요."],
    };
  }
  if (profitLossDifference > 0 && returnRateDifference !== null && returnRateDifference < 0) {
    return {
      headline: `평가손익은 ${profitText} 늘었지만, 추가 투자금이 커지면서 수익률은 ${formatPercentPointDiff(returnRateDifference)} 낮아졌어요.`,
      explanation: ["손익 금액과 투자 효율이 서로 다르게 움직인 결과예요."],
    };
  }
  // profitLossDifference <= 0 — 수익률은 손익과 반대로 움직일 수도 있으니(예: 총 투자금
  // 자체가 줄어드는 효과) 실제 부호를 그대로 확인하고 말한다 — 항상 "낮아졌어요"로 단정하지
  // 않는다(§재발했던 회귀 — 실제로는 +0.2%p 인데 "낮아졌어요"로 잘못 말한 적이 있었다).
  const rateSuffix =
    returnRateDifference !== null
      ? `, 수익률은 ${formatPercentPointDiff(returnRateDifference)} ${returnRateDifference >= 0 ? "높아졌어요" : "낮아졌어요"}`
      : "";
  return {
    headline: `추가 매수로 ${investedText}을 더 투자했지만, 평가손익은 ${profitText} 낮아졌어요${rateSuffix}.`,
    explanation: ["이번 기간에는 추가 매수 조건이 결과를 개선하지 못했어요."],
  };
}

export function buildFallbackReview(request: ReviewRequest): ReviewResponse {
  const evidenceLabels = ["월 최대 투자 금액", "월 예산 초과 개월"];
  if (request.summary.conditionalTriggerCount > 0) {
    evidenceLabels.push("추가 매수 조건 발생");
  }

  const comparison = buildComparisonInterpretation(request);
  if (comparison !== null) {
    return {
      headline: comparison.headline,
      explanation: comparison.explanation,
      evidenceLabels,
      caution: "AI 설명을 불러오지 못해 계산 결과만 보여드려요. 위 숫자는 시뮬레이션 엔진 결과예요.",
    };
  }

  return {
    headline: request.causeSentence,
    explanation: [request.causeSentence],
    evidenceLabels,
    caution: "AI 설명을 불러오지 못해 계산 결과만 보여드려요. 위 숫자는 시뮬레이션 엔진 결과예요.",
  };
}
