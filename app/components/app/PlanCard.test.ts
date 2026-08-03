/**
 * planSummarySentence 단위 테스트 (Node 내장 test runner + tsx).
 *
 * 실행: npm run test:plancard
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { planSummarySentence } from "./PlanCard";
import { emptyPlan } from "@/types/appPlan";
import type { AppPlan } from "@/types/appPlan";

const KRW_ASSET = { symbol: "005930", displayName: "삼성전자", market: "KR" as const, quoteCurrency: "KRW" as const };

function planWith(overrides: Partial<AppPlan>): AppPlan {
  return { ...emptyPlan(), asset: KRW_ASSET, ...overrides };
}

test("월 예산만 설정된 경우 유효한 요약 문장을 반환한다", () => {
  const plan = planWith({
    guardrails: {
      monthlyBudgetKrw: 200000,
      maxConditionalExecutionsPerMonth: null,
      reviewDrawdownPercent: null,
    },
  });
  assert.equal(planSummarySentence(plan), "한 달 투자 예산은 200,000원이에요");
});

test("정기 매수 + 월 예산이 함께 있으면 자연스럽게 조합된다", () => {
  const plan = planWith({
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
    guardrails: {
      monthlyBudgetKrw: 200000,
      maxConditionalExecutionsPerMonth: null,
      reviewDrawdownPercent: null,
    },
  });
  assert.equal(planSummarySentence(plan), "매주 정기 매수하고, 한 달 예산은 200,000원이에요");
});

test("추가 매수 + 월 예산이 함께 있으면 자연스럽게 조합된다", () => {
  const plan = planWith({
    conditionalBuy: { thresholdPercent: 3, amountKrw: 20000 },
    guardrails: {
      monthlyBudgetKrw: 200000,
      maxConditionalExecutionsPerMonth: null,
      reviewDrawdownPercent: null,
    },
  });
  assert.equal(planSummarySentence(plan), "가격이 내려가면 추가 매수하고, 한 달 예산은 200,000원이에요");
});

test("정기 매수 + 추가 매수 + 월 예산이 모두 있으면 셋 다 자연스럽게 조합된다", () => {
  const plan = planWith({
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
    conditionalBuy: { thresholdPercent: 3, amountKrw: 20000 },
    guardrails: {
      monthlyBudgetKrw: 200000,
      maxConditionalExecutionsPerMonth: null,
      reviewDrawdownPercent: null,
    },
  });
  assert.equal(
    planSummarySentence(plan),
    "매주 정기 매수하고, 가격이 내려가면 추가 매수하고, 한 달 예산은 200,000원이에요"
  );
});

test("아무 조건도 설정되지 않으면 '아직 정해진 조건이 없어요'를 반환한다", () => {
  const plan = planWith({});
  assert.equal(planSummarySentence(plan), "아직 정해진 조건이 없어요");
});

test("[회귀] 정기 매수만 있고 예산이 없으면 기존 문구를 그대로 유지한다", () => {
  const plan = planWith({
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
  });
  assert.equal(planSummarySentence(plan), "매주 월요일 50,000원");
});

test("[회귀] 추가 매수만 있고 예산이 없으면 기존 문구를 그대로 유지한다", () => {
  const plan = planWith({
    conditionalBuy: { thresholdPercent: 3, amountKrw: 20000 },
  });
  assert.equal(planSummarySentence(plan), "3% 하락 시 20,000원");
});

test("[회귀] 정기 매수 + 추가 매수(예산 없음)는 기존처럼 · 로 이어진다", () => {
  const plan = planWith({
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
    conditionalBuy: { thresholdPercent: 3, amountKrw: 20000 },
  });
  assert.equal(planSummarySentence(plan), "매주 월요일 50,000원 · 3% 하락 시 20,000원");
});
