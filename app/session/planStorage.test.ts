/**
 * migratePlanAsset 단위 테스트 — window.sessionStorage 의존 없이 순수 함수만 확인한다.
 *
 * 실행: npm run test:planstorage
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { migratePlanAsset } from "./planStorage";

test("[회귀] asset 이 없는 옛 세션(symbol/companyName 평면 구조)은 market:US 로 migration 한다", () => {
  const legacyPlan = {
    originalInput: "애플을 매주 5만 원씩 살래요",
    symbol: "AAPL",
    companyName: "Apple Inc.",
    recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50_000 },
    conditionalBuy: null,
    guardrails: { monthlyBudgetKrw: null, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
    version: 1,
  };

  const migrated = migratePlanAsset(legacyPlan);

  assert.deepEqual(migrated.asset, {
    symbol: "AAPL",
    displayName: "Apple Inc.",
    market: "US",
    quoteCurrency: "USD",
  });
  assert.equal(migrated.recurring?.amountKrw, 50_000, "market 이외의 필드는 그대로 보존해야 한다");
});

test("이미 asset 이 있는 새 세션은 그대로 통과시킨다(중복 migration 없음)", () => {
  const currentPlan = {
    originalInput: "삼성전자를 매주 화요일 5만 원씩 살래요",
    asset: { symbol: "005930", displayName: "삼성전자", market: "KR" as const, exchange: "KOSPI" as const, quoteCurrency: "KRW" as const },
    recurring: { frequency: "weekly", weekday: "tuesday", amountKrw: 50_000 },
    conditionalBuy: null,
    guardrails: { monthlyBudgetKrw: null, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
    version: 1,
  };

  const migrated = migratePlanAsset(currentPlan);

  assert.deepEqual(migrated.asset, currentPlan.asset, "이미 KR 로 확정된 asset 을 US 로 덮어쓰면 안 된다");
});

test("[회귀] symbol/companyName 도 없는 완전히 빈 계획은 emptyAsset() 으로 안전하게 처리한다", () => {
  const emptyLegacyPlan = {
    originalInput: "",
    recurring: null,
    conditionalBuy: null,
    guardrails: { monthlyBudgetKrw: null, maxConditionalExecutionsPerMonth: null, reviewDrawdownPercent: null },
    version: 1,
  };

  const migrated = migratePlanAsset(emptyLegacyPlan);

  assert.equal(migrated.asset.symbol, "");
  assert.equal(migrated.asset.market, "US", "종목이 아예 없던 경우에도 market 은 안전한 기본값(US)이어야 한다");
});
