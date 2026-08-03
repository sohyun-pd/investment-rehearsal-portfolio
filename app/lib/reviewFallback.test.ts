/**
 * buildFallbackReview() 단위 테스트 (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:reviewfallback
 *
 * 다루는 회귀: AI 설명("똑대리 해석")이 예산 초과 여부만 반복해 싱겁다는 피드백에 따라,
 * 조건부 매수 비교 결과(추가 투자금·평가손익 차이·수익률 차이)가 있으면 그 관계를 먼저
 * 해석해야 한다 — "합리적입니다" 같은 전략 평가 문구 없이, 실제로 계산된 숫자 관계만 말한다.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { buildFallbackReview } from "./reviewFallback";
import type { ReviewRequest } from "@/types/review";

function requestWith(overrides: Partial<ReviewRequest> = {}): ReviewRequest {
  return {
    sessionId: "test-session",
    locale: "ko-KR",
    plan: {
      symbol: "035720",
      companyName: "카카오",
      hasRecurring: true,
      hasConditionalBuy: true,
      monthlyBudgetKrw: null,
      currency: "KRW",
    },
    summary: {
      maxMonthlyInvestmentKrw: 1_000_000,
      budgetExceededMonthCount: 0,
      recurringOnlyBudgetExceededMonthCount: 0,
      conditionalCausedBudgetExceededMonthCount: 0,
      conditionalTriggerCount: 0,
      conditionalExecutionCount: 0,
      conditionalBlockedCount: 0,
      recurringExecutionCount: 12,
      reviewTriggeredCount: 0,
      maxAdditionalDeclineAfterTriggerPercent: null,
      totalInvestmentKrw: 12_000_000,
      additionalInvested: null,
      profitLossDifference: null,
      returnRateDifference: null,
    },
    period: { from: "2025-07-29", to: "2026-07-29", tradingDayCount: 243 },
    budgetExceededCause: "none",
    causeSentence: "월 예산을 넘지 않았어요.",
    quoteStatus: "ok",
    ...overrides,
  };
}

test("추가 매수 조건이 한 번도 발생하지 않으면 그 사실과 다음 행동 제안만 말한다", () => {
  const result = buildFallbackReview(requestWith());
  assert.equal(result.headline, "이번 1년에는 추가 매수 조건이 발생하지 않아 정기 매수만 실행됐어요.");
  assert.equal(result.explanation.length, 1);
  assert.ok(!result.headline.includes("합리적"));
});

test("평가손익·수익률이 모두 높아지면 두 숫자를 함께 말한다", () => {
  const result = buildFallbackReview(
    requestWith({
      summary: {
        ...requestWith().summary,
        conditionalTriggerCount: 3,
        additionalInvested: 400_000,
        profitLossDifference: 120_000,
        returnRateDifference: 1.2,
      },
    })
  );
  assert.ok(result.headline.includes("400,000원"));
  assert.ok(result.headline.includes("120,000원"));
  assert.ok(result.headline.includes("1.2%p"));
  assert.ok(result.headline.includes("높아졌어요"));
  assert.ok(!result.headline.includes("합리적"), "전략을 평가·추천하는 표현을 쓰면 안 된다");
});

test("평가손익은 늘었지만 수익률은 낮아지면 그 불일치를 설명한다", () => {
  const result = buildFallbackReview(
    requestWith({
      summary: {
        ...requestWith().summary,
        conditionalTriggerCount: 2,
        additionalInvested: 400_000,
        profitLossDifference: 50_000,
        returnRateDifference: -0.3,
      },
    })
  );
  assert.ok(result.headline.includes("평가손익은 50,000원 늘었지만"));
  assert.ok(result.headline.includes("0.3%p 낮아졌어요"));
});

test("평가손익이 낮아지면 개선하지 못했다는 사실만 말하고 미래를 예측하지 않는다", () => {
  const result = buildFallbackReview(
    requestWith({
      summary: {
        ...requestWith().summary,
        conditionalTriggerCount: 1,
        additionalInvested: 200_000,
        profitLossDifference: -30_000,
        returnRateDifference: -0.5,
      },
    })
  );
  assert.ok(result.headline.includes("낮아졌어요"));
  assert.equal(result.explanation[0], "이번 기간에는 추가 매수 조건이 결과를 개선하지 못했어요.");
  assert.ok(!result.headline.includes("것으로 예상"), "미래 예측 표현을 쓰면 안 된다");
});

test("[회귀] 평가손익은 낮아져도 수익률은 오히려 높아질 수 있다 — 부호를 단정하지 않는다", () => {
  // 총 투자금 자체가 변하면서 손익과 수익률이 반대로 움직이는 경우도 있다. 방향 단어를
  // 하드코딩하지 않고 실제 returnRateDifference 부호를 그대로 따라야 한다.
  const result = buildFallbackReview(
    requestWith({
      summary: {
        ...requestWith().summary,
        conditionalTriggerCount: 1,
        additionalInvested: 200_000,
        profitLossDifference: -49_737,
        returnRateDifference: 0.2,
      },
    })
  );
  assert.ok(result.headline.includes("0.2%p 높아졌어요"), `실제 응답: ${result.headline}`);
  assert.ok(!result.headline.includes("0.2%p 낮아졌어요"));
});

test("조건부 매수 자체가 없으면(비교 데이터 없음) 기존처럼 예산 상태 문장을 쓴다", () => {
  const result = buildFallbackReview(
    requestWith({
      plan: { ...requestWith().plan, hasConditionalBuy: false },
    })
  );
  assert.equal(result.headline, "월 예산을 넘지 않았어요.");
});
