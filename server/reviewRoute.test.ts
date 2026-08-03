/**
 * reviewRoute 숫자 출처 검증 단위 테스트 (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:review
 *
 * 다루는 회귀: profitLossDifference·returnRateDifference 처럼 payload 숫자가 음수일 때,
 * AI 가 "-49737"이 아니라 "49,737원 낮아졌어요"처럼 부호 없이 방향을 단어로 표현해도
 * schema_mismatch 로 잘못 거절되면 안 된다(§똑대리 해석 — 실제 라이브 호출에서 재현됨).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { collectAllowedNumbers, validateReviewResponse } from "./reviewRoute";
import type { ReviewRequest } from "../app/types/review";

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
      maxMonthlyInvestmentKrw: 500_000,
      budgetExceededMonthCount: 0,
      recurringOnlyBudgetExceededMonthCount: 0,
      conditionalCausedBudgetExceededMonthCount: 0,
      conditionalTriggerCount: 1,
      conditionalExecutionCount: 1,
      conditionalBlockedCount: 0,
      recurringExecutionCount: 53,
      reviewTriggeredCount: 0,
      maxAdditionalDeclineAfterTriggerPercent: null,
      totalInvestmentKrw: 5_500_000,
      additionalInvested: 200_000,
      profitLossDifference: -49_737,
      returnRateDifference: 0.2,
    },
    period: { from: "2025-07-29", to: "2026-07-29", tradingDayCount: 243 },
    budgetExceededCause: "none",
    causeSentence: "월 예산을 넘지 않았어요.",
    quoteStatus: "ok",
    ...overrides,
  };
}

test("[회귀] payload 의 음수(profitLossDifference: -49737)를 응답이 부호 없이 '49,737원'으로 써도 허용된다", () => {
  const request = requestWith();
  const allowed = collectAllowedNumbers(request);

  const response = {
    headline: "추가 매수로 200,000원을 더 투자했지만 평가손익은 49,737원 낮아졌어요. 수익률은 0.2%p 높아졌어요.",
    explanation: ["이번 기간 조건부 매수는 1회 발생했고 1회 실행됐어요."],
    evidenceLabels: ["추가 투자금", "평가손익 차이"],
    caution: "이 결과는 과거 데이터 기반 계산일 뿐 미래 수익을 예측하지 않아요.",
  };

  // 예외를 던지지 않아야 한다(= schema_mismatch 로 거절되지 않는다).
  assert.doesNotThrow(() => validateReviewResponse(response, allowed));
});

test("payload 에 없는 숫자를 응답에 쓰면 여전히 거절된다", () => {
  const request = requestWith();
  const allowed = collectAllowedNumbers(request);

  const response = {
    headline: "추가 매수로 999,999원을 더 투자했어요.",
    explanation: [],
    evidenceLabels: [],
    caution: "이 결과는 과거 데이터 기반 계산일 뿐이에요.",
  };

  assert.throws(() => validateReviewResponse(response, allowed));
});
