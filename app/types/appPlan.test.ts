/**
 * app/types/appPlan.ts 단위 테스트 — 예산 충돌 감지·문구.
 *
 * 실행: npm run test:appplan
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  budgetConflictMessage,
  detectBudgetConflict,
  emptyPlan,
  formatKrwCompact,
  type AppPlan,
} from "./appPlan";

function basePlan(overrides: Partial<AppPlan> = {}): AppPlan {
  return {
    ...emptyPlan("테스트"),
    asset: { symbol: "AAPL", displayName: "Apple Inc.", market: "US", quoteCurrency: "USD" },
    ...overrides,
  };
}

test("formatKrwCompact: 억·만 단위를 사용자 확정 예시와 같은 형태로 표기한다", () => {
  assert.equal(formatKrwCompact(500_000_000), "5억 원");
  assert.equal(formatKrwCompact(1_000_000), "100만 원");
  assert.equal(formatKrwCompact(50_000), "5만 원");
  assert.equal(formatKrwCompact(5_000), "5,000원");
  assert.equal(formatKrwCompact(150_000_000), "1억 5,000만 원");
});

test("[회귀] 정기 매수 1회 금액이 월 예산을 넘으면 명백한 충돌로 감지한다(사용자 확정 예시: 매주 5억 vs 월 100만)", () => {
  const plan = basePlan({
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 500_000_000 },
    guardrails: { monthlyBudgetKrw: 1_000_000, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
  });
  const conflict = detectBudgetConflict(plan);
  assert.notEqual(conflict, null);
  assert.equal(conflict?.field, "recurring");
  const message = budgetConflictMessage(conflict!);
  assert.equal(message.title, "매수 금액이 월 예산을 넘어요");
  assert.match(message.description, /매주 5억 원씩 매수하면/);
  assert.match(message.description, /월 예산 100만 원을 크게 넘을 수 있어요/);
});

test("조건부(추가) 매수 1회 금액이 월 예산을 넘어도 충돌로 감지한다", () => {
  const plan = basePlan({
    recurring: null,
    conditionalBuy: { thresholdPercent: 10, amountKrw: 2_000_000 },
    guardrails: { monthlyBudgetKrw: 500_000, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
  });
  const conflict = detectBudgetConflict(plan);
  assert.notEqual(conflict, null);
  assert.equal(conflict?.field, "conditional");
});

test("여러 번 실행되면 예산을 넘을 수 있는 정상 범위(단발 금액은 예산 이하)는 충돌로 보지 않는다", () => {
  // 매주 20만원 * 월 4~5회 = 80만~100만 > 월 예산 50만 이 될 수 있지만, 단발 실행 금액(20만)
  // 자체는 예산(50만)보다 작다 — 이건 시뮬레이션의 "예산 초과" 결과로 정상 처리할 대상이지
  // 여기서 미리 막을 대상이 아니다.
  const plan = basePlan({
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 200_000 },
    guardrails: { monthlyBudgetKrw: 500_000, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
  });
  assert.equal(detectBudgetConflict(plan), null);
});

test("월 예산을 정하지 않았으면(null) 비교 대상이 없어 충돌도 없다", () => {
  const plan = basePlan({
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 500_000_000 },
    guardrails: { monthlyBudgetKrw: null, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
  });
  assert.equal(detectBudgetConflict(plan), null);
});

test("정기 매수·조건부 매수가 둘 다 없으면 충돌도 없다", () => {
  const plan = basePlan({
    recurring: null,
    conditionalBuy: null,
    guardrails: { monthlyBudgetKrw: 500_000, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
  });
  assert.equal(detectBudgetConflict(plan), null);
});
