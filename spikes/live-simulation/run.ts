/**
 * Live historical simulation 통합 스모크.
 *
 * 목적: production adapter 로 실제 Twelve Data 과거 일봉을 받아 시뮬레이션 엔진에 넣고,
 *       구조적 불변 조건 15개를 검증한다.
 * 실행: npm run spike:simulation:live
 *
 * 두 종류의 검증을 구분한다.
 *  - Invariant Validation — 입력·데이터가 바뀌어도 항상 성립해야 하는 계산 정합성.
 *                           실패하면 **코드 결함**이며 RESULT: FAIL.
 *  - Scenario Assertion   — 현재 고정된 스모크 입력·기간에서 관찰된 회귀 확인값.
 *                           달라지면 CHANGED 로 표시하되 RESULT 는 FAIL 로 만들지 않는다
 *                           (시나리오·데이터 결과 변경이지 코드 결함이 아니다).
 *
 * 정책:
 *  - production adapter(`app/data/market`)를 사용한다. spike 의 normalize 로직을 재구현하지 않는다.
 *  - 실패 시 mock/fixture/Finnhub 데이터로 대체하지 않는다.
 *  - 결과 수치를 미리 정해두지 않는다. 하드코딩된 기대값 대신 불변 조건만 검증한다.
 *  - API 키와 요청 URL 을 출력하지 않는다.
 */
import { isDeepStrictEqual } from "node:util";

import "../env.ts";
import {
  createTwelveDataHistoricalAdapter,
  MarketDataError,
  type HistoricalCandlesResult,
} from "../../app/data/market/index.ts";
import {
  ORIGINAL_PLAN_POLICY,
  simulatePlan,
  type SimulationEvent,
  type SimulationPlan,
  type SimulationResult,
} from "../../app/domain/simulation/index.ts";

const SYMBOL = "AAPL";
const FROM_INCLUSIVE = "2025-07-28";
const TO_INCLUSIVE = "2026-07-27";

/**
 * 기술 통합 검증용 계획.
 *
 * 평균 매수가는 더 이상 입력값이 아니다(§동적 평균 매수가) — 정기 매수 실행으로 자동 확정된다.
 * thresholdPercent 3 은 **production 기본값도, 최종 데모 사용자 값도 아니다.** 실제 candle 과
 * 엔진 연결을 확인하기 위해 조건이 여러 번 발생하도록 고른 스모크 입력이다.
 */
const SMOKE_PLAN: SimulationPlan = {
  symbol: SYMBOL,
  market: "US",
  recurring: { frequency: "weekly", weekday: "monday", amountKrw: 50_000 },
  conditionalBuy: { thresholdPercent: 3, amountKrw: 20_000 },
  guardrails: {
    monthlyBudgetKrw: 200_000,
    maxConditionalExecutionsPerMonth: null,
    reviewDrawdownPercent: null,
  },
};

interface InvariantCheck {
  id: number;
  name: string;
  pass: boolean;
  detail: string;
}

function fmtCandle(candle: { date: string; open: number; high: number; low: number; close: number; volume: number | null } | undefined): string {
  if (candle === undefined) return "(none)";
  return `${candle.date} O:${candle.open} H:${candle.high} L:${candle.low} C:${candle.close} V:${candle.volume ?? "null"}`;
}

function fmtEvent(event: SimulationEvent | undefined, label: string): string {
  if (event === undefined) return `${label}: (없음 — 이 기간에 발생하지 않았습니다)`;
  const extra: string[] = [];
  if ("amountKrw" in event) extra.push(`amount=${event.amountKrw}원`);
  if ("attemptedAmountKrw" in event) extra.push(`attempted=${event.attemptedAmountKrw}원`);
  if ("blockedBy" in event) extra.push(`blockedBy=${event.blockedBy}`);
  if ("triggerPrice" in event) extra.push(`triggerPrice=$${event.triggerPrice}`);
  if ("monthlyExecutionIndex" in event) extra.push(`monthlyIndex=${event.monthlyExecutionIndex}`);
  if ("scheduledDate" in event) {
    extra.push(`scheduled=${event.scheduledDate}${event.rolledForward ? " (rolled forward)" : ""}`);
  }
  if ("monthlyInvestmentKrw" in event) {
    extra.push(
      `monthly=${event.monthlyInvestmentKrw}원 (recurring=${event.recurringInvestmentKrw}원 + conditional=${event.conditionalInvestmentKrw}원) / budget=${event.monthlyBudgetKrw}원`
    );
    extra.push(`cause=${event.cause}`);
    extra.push(`triggeredBy=${event.triggeredByEventId}`);
  }
  if ("initialState" in event) extra.push(`initialState=${event.initialState}`);
  return `${label}: ${event.id} ${event.date} ${event.type} close=$${event.closePrice}${
    extra.length > 0 ? ` · ${extra.join(" · ")}` : ""
  }`;
}

function firstOfType<T extends SimulationEvent["type"]>(
  events: SimulationEvent[],
  type: T
): Extract<SimulationEvent, { type: T }> | undefined {
  return events.find((event): event is Extract<SimulationEvent, { type: T }> => event.type === type);
}

function checkInvariants(
  market: HistoricalCandlesResult,
  result: SimulationResult,
  rerun: SimulationResult,
  noNetworkRerun: SimulationResult
): InvariantCheck[] {
  const checks: InvariantCheck[] = [];
  const add = (id: number, name: string, pass: boolean, detail: string): void => {
    checks.push({ id, name, pass, detail });
  };

  add(
    1,
    "candle count >= 200",
    market.candles.length >= 200,
    `candles=${market.candles.length}`
  );

  add(
    2,
    "chartSeries.length === candles.length",
    result.chartSeries.length === market.candles.length,
    `chartSeries=${result.chartSeries.length} candles=${market.candles.length}`
  );

  add(
    3,
    "conditionalExecutionCount <= conditionalTriggerCount",
    result.conditionalExecutionCount <= result.conditionalTriggerCount,
    `executed=${result.conditionalExecutionCount} triggered=${result.conditionalTriggerCount}`
  );

  add(
    4,
    "blocked === triggered - executed",
    result.conditionalBlockedCount ===
      result.conditionalTriggerCount - result.conditionalExecutionCount,
    `blocked=${result.conditionalBlockedCount} triggered-executed=${
      result.conditionalTriggerCount - result.conditionalExecutionCount
    }`
  );

  add(
    5,
    "totalInvestmentKrw === recurring + conditional",
    result.totalInvestmentKrw ===
      result.totalRecurringInvestmentKrw + result.totalConditionalInvestmentKrw,
    `total=${result.totalInvestmentKrw} recurring=${result.totalRecurringInvestmentKrw} conditional=${result.totalConditionalInvestmentKrw}`
  );

  const monthlySum = result.monthlyResults.reduce(
    (acc, month) => ({
      recurringKrw: acc.recurringKrw + month.recurringInvestmentKrw,
      conditionalKrw: acc.conditionalKrw + month.conditionalInvestmentKrw,
      totalKrw: acc.totalKrw + month.totalInvestmentKrw,
      recurringCount: acc.recurringCount + month.recurringExecutionCount,
      triggerCount: acc.triggerCount + month.conditionalTriggerCount,
      executionCount: acc.executionCount + month.conditionalExecutionCount,
      blockedCount: acc.blockedCount + month.conditionalBlockedCount,
      exceededMonths: acc.exceededMonths + (month.budgetExceeded ? 1 : 0),
    }),
    {
      recurringKrw: 0,
      conditionalKrw: 0,
      totalKrw: 0,
      recurringCount: 0,
      triggerCount: 0,
      executionCount: 0,
      blockedCount: 0,
      exceededMonths: 0,
    }
  );

  const monthlyMatches =
    monthlySum.recurringKrw === result.totalRecurringInvestmentKrw &&
    monthlySum.conditionalKrw === result.totalConditionalInvestmentKrw &&
    monthlySum.totalKrw === result.totalInvestmentKrw &&
    monthlySum.recurringCount === result.recurringExecutionCount &&
    monthlySum.triggerCount === result.conditionalTriggerCount &&
    monthlySum.executionCount === result.conditionalExecutionCount &&
    monthlySum.blockedCount === result.conditionalBlockedCount &&
    monthlySum.exceededMonths === result.budgetExceededMonthCount;

  add(
    6,
    "monthlyResults 합계 === summary 합계",
    monthlyMatches,
    `months=${result.monthlyResults.length} monthlyTotal=${monthlySum.totalKrw} summaryTotal=${result.totalInvestmentKrw} monthlyRecurringCount=${monthlySum.recurringCount} summaryRecurringCount=${result.recurringExecutionCount}`
  );

  const recurringEvents = result.simulationEvents.filter(
    (event) => event.type === "recurring_buy_executed"
  );
  add(
    7,
    "recurring event 개수 === recurringExecutionCount",
    recurringEvents.length === result.recurringExecutionCount,
    `events=${recurringEvents.length} count=${result.recurringExecutionCount}`
  );

  const triggerEvents = result.simulationEvents.filter(
    (event) => event.type === "conditional_triggered"
  );
  add(
    8,
    "conditional trigger event 개수 === conditionalTriggerCount",
    triggerEvents.length === result.conditionalTriggerCount,
    `events=${triggerEvents.length} count=${result.conditionalTriggerCount}`
  );

  const outOfRange = result.simulationEvents.filter(
    (event) => event.date < market.actualRange.from || event.date > market.actualRange.to
  );
  add(
    9,
    "모든 event 날짜가 actual range 안에 있음",
    outOfRange.length === 0,
    outOfRange.length === 0
      ? `range=${market.actualRange.from}~${market.actualRange.to} events=${result.simulationEvents.length}`
      : `범위 밖 이벤트 ${outOfRange.length}건 (예: ${outOfRange[0]?.date})`
  );

  const eventIds = new Set(result.simulationEvents.map((event) => event.id));
  const linkedIds = result.chartSeries.flatMap((point) => point.eventIds);
  const unknownIds = linkedIds.filter((id) => !eventIds.has(id));
  add(
    10,
    "모든 chart eventId 가 실제 event id 를 참조",
    unknownIds.length === 0 && linkedIds.length === eventIds.size,
    `linked=${linkedIds.length} events=${eventIds.size} unknown=${unknownIds.length}`
  );

  const deterministic = isDeepStrictEqual(
    { ...result, calculatedAt: null },
    { ...rerun, calculatedAt: null }
  );
  add(
    11,
    "동일 입력 재실행 결과가 deepEqual (calculatedAt 제외)",
    deterministic,
    deterministic ? "두 번째 실행 결과 동일" : "결과 불일치"
  );

  const engineOffline = isDeepStrictEqual(
    { ...result, calculatedAt: null },
    { ...noNetworkRerun, calculatedAt: null }
  );
  add(
    12,
    "engine 이 API 를 직접 호출하지 않음 (network 차단 상태에서 동일 결과)",
    engineOffline,
    engineOffline
      ? "globalThis.fetch 를 throw 로 바꾼 상태에서도 동일 결과"
      : "network 차단 시 결과가 달라짐 — 엔진이 네트워크에 의존"
  );

  add(
    13,
    "budgetExceededMonthCount === recurringOnly + conditionalCaused",
    result.budgetExceededMonthCount ===
      result.recurringOnlyBudgetExceededMonthCount +
        result.conditionalCausedBudgetExceededMonthCount,
    `total=${result.budgetExceededMonthCount} recurringOnly=${result.recurringOnlyBudgetExceededMonthCount} conditional=${result.conditionalCausedBudgetExceededMonthCount}`
  );

  // 한 달에 두 원인이 동시에 기록되지 않고, 초과한 달에는 원인이 반드시 하나 있다.
  const causeShapeViolations = result.monthlyResults.filter((month) => {
    const bothCauses = month.recurringAloneExceededBudget && month.conditionalCausedBudgetExceed;
    const exceededWithoutCause = month.budgetExceeded && month.budgetExceededCause === null;
    const causeWithoutExceeded = !month.budgetExceeded && month.budgetExceededCause !== null;
    return bothCauses || exceededWithoutCause || causeWithoutExceeded;
  });
  add(
    14,
    "초과한 달마다 원인이 정확히 하나 지정됨",
    causeShapeViolations.length === 0,
    causeShapeViolations.length === 0
      ? `months=${result.monthlyResults.length} 검사 통과`
      : `위반 ${causeShapeViolations.length}건 (예: ${causeShapeViolations[0]?.month})`
  );

  const exceededEvents = result.simulationEvents.filter(
    (event) => event.type === "monthly_budget_exceeded"
  );
  const eventById = new Map(result.simulationEvents.map((event) => [event.id, event]));
  const eventViolations = exceededEvents.filter((event) => {
    if (event.type !== "monthly_budget_exceeded") return false;
    const month = result.monthlyResults.find((m) => m.month === event.month);
    const source = eventById.get(event.triggeredByEventId);
    const sourceIsExecution =
      source !== undefined &&
      (source.type === "recurring_buy_executed" || source.type === "conditional_buy_executed");
    return event.cause !== month?.budgetExceededCause || !sourceIsExecution;
  });
  add(
    15,
    "budget exceeded event 의 cause 가 월 분류와 같고 triggeredByEventId 가 실행 이벤트를 참조",
    eventViolations.length === 0 && exceededEvents.length === result.budgetExceededMonthCount,
    `events=${exceededEvents.length} exceededMonths=${result.budgetExceededMonthCount} violations=${eventViolations.length}`
  );

  return checks;
}

/**
 * 현재 기술 스모크 시나리오의 회귀 확인값.
 *
 * **구조적 불변 조건이 아니다.** 아래 입력·기간·시장 데이터에서 관찰된 결과이며, 모든 계획에서
 * 성립해야 하는 값이 아니다. 값이 달라지면 엔진 결함으로 단정하지 않고 시나리오 또는 데이터
 * 결과가 변한 것으로 기록한다.
 */
const SCENARIO_EXPECTATION = {
  recurringOnlyMonths: 4,
  conditionalActionMonths: 0,
} as const;

type ScenarioStatus = "MATCH" | "CHANGED";

function assertScenario(result: SimulationResult): {
  status: ScenarioStatus;
  lines: string[];
} {
  const actualRecurringOnly = result.recurringOnlyBudgetExceededMonthCount;
  const actualConditional = result.conditionalCausedBudgetExceededMonthCount;

  const status: ScenarioStatus =
    actualRecurringOnly === SCENARIO_EXPECTATION.recurringOnlyMonths &&
    actualConditional === SCENARIO_EXPECTATION.conditionalActionMonths
      ? "MATCH"
      : "CHANGED";

  const mark = (expected: number, actual: number): string =>
    expected === actual ? "" : "  ← 변경됨";

  return {
    status,
    lines: [
      `입력                : 정기 매수 매주 월요일 ${SMOKE_PLAN.recurring?.amountKrw.toLocaleString() ?? "-"}원 / 월 예산 ${SMOKE_PLAN.guardrails.monthlyBudgetKrw?.toLocaleString() ?? "-"}원`,
      `기간                : ${FROM_INCLUSIVE} ~ ${TO_INCLUSIVE}`,
      `expected recurring_only     : ${SCENARIO_EXPECTATION.recurringOnlyMonths}개월`,
      `actual   recurring_only     : ${actualRecurringOnly}개월${mark(SCENARIO_EXPECTATION.recurringOnlyMonths, actualRecurringOnly)}`,
      `expected conditional_action : ${SCENARIO_EXPECTATION.conditionalActionMonths}개월`,
      `actual   conditional_action : ${actualConditional}개월${mark(SCENARIO_EXPECTATION.conditionalActionMonths, actualConditional)}`,
    ],
  };
}

async function main(): Promise<void> {
  console.log("[spike:simulation:live] Live historical simulation 통합 스모크\n");

  const apiKey = process.env.TWELVE_DATA_API_KEY ?? "";
  if (apiKey === "") {
    console.log("error code          : api_key_missing");
    console.log("message             : TWELVE_DATA_API_KEY 가 .env.local 에 없습니다.");
    console.log("\nRESULT: FAIL");
    process.exitCode = 1;
    return;
  }

  const adapter = createTwelveDataHistoricalAdapter({ apiKey });

  const startedAt = Date.now();
  let market: HistoricalCandlesResult;
  try {
    market = await adapter.fetchHistoricalCandles({
      symbol: SYMBOL,
      fromInclusive: FROM_INCLUSIVE,
      toInclusive: TO_INCLUSIVE,
    });
  } catch (error) {
    if (error instanceof MarketDataError) {
      console.log("[Market Data]");
      console.log(`provider            : ${error.provider}`);
      console.log(`error code          : ${error.code}`);
      console.log(`http status         : ${error.httpStatus ?? "(none)"}`);
      console.log(`api response status : ${error.apiStatus ?? "(none)"}`);
      console.log(`message             : ${error.message}`);
    } else {
      console.log(`unexpected error    : ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log("\nRESULT: FAIL");
    console.log("→ 실패 원인은 spikes/live-simulation/LIVE_SIMULATION_RESULT.md 에 기록");
    process.exitCode = 1;
    return;
  }
  const latencyMs = Date.now() - startedAt;

  console.log("[Market Data]");
  console.log(`provider            : ${market.provider}`);
  console.log(`symbol              : ${market.symbol}`);
  console.log(`requested range     : ${market.requestedRange.from} ~ ${market.requestedRange.to}`);
  console.log(`actual range        : ${market.actualRange.from} ~ ${market.actualRange.to}`);
  console.log(`candle count        : ${market.candles.length}`);
  console.log(`first candle        : ${fmtCandle(market.candles[0])}`);
  console.log(`last candle         : ${fmtCandle(market.candles[market.candles.length - 1])}`);
  console.log(`adjustment          : ${market.adjustment} (dividendAdjusted=${market.dividendAdjusted})`);
  console.log(`completeness        : ${market.completeness}`);
  console.log(`fetchedAt           : ${market.fetchedAt}`);
  console.log(`API latency         : ${latencyMs}ms`);

  const simulationInput = {
    plan: SMOKE_PLAN,
    policy: ORIGINAL_PLAN_POLICY,
    candles: market.candles,
  };

  const result = simulatePlan({ ...simulationInput, calculatedAt: market.fetchedAt });
  const rerun = simulatePlan({ ...simulationInput, calculatedAt: market.fetchedAt });

  // 엔진이 네트워크에 의존하지 않는지 확인한다: fetch 를 throw 로 바꾼 상태에서 재실행.
  const originalFetch = globalThis.fetch;
  let noNetworkRerun: SimulationResult;
  try {
    globalThis.fetch = (() => {
      throw new Error("simulation engine must not perform network I/O");
    }) as unknown as typeof fetch;
    noNetworkRerun = simulatePlan({ ...simulationInput, calculatedAt: market.fetchedAt });
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log("\n[Simulation]");
  const firstTrigger = result.simulationEvents.find((event) => event.type === "conditional_triggered");
  console.log(`first trigger price : ${firstTrigger !== undefined ? `$${firstTrigger.triggerPrice}` : "(none)"}`);
  console.log(`recurringExecutionCount            : ${result.recurringExecutionCount}`);
  console.log(`conditionalTriggerCount            : ${result.conditionalTriggerCount}`);
  console.log(`conditionalExecutionCount          : ${result.conditionalExecutionCount}`);
  console.log(`conditionalBlockedCount            : ${result.conditionalBlockedCount}`);
  console.log(`totalRecurringInvestmentKrw        : ${result.totalRecurringInvestmentKrw}`);
  console.log(`totalConditionalInvestmentKrw      : ${result.totalConditionalInvestmentKrw}`);
  console.log(`totalInvestmentKrw                 : ${result.totalInvestmentKrw}`);
  console.log(`maxMonthlyInvestmentKrw            : ${result.maxMonthlyInvestmentKrw}`);
  console.log(`maxMonthlyConditionalExecutionCount: ${result.maxMonthlyConditionalExecutionCount}`);
  console.log(`budgetExceededMonthCount           : ${result.budgetExceededMonthCount}`);
  console.log(`  ├ recurring_only                 : ${result.recurringOnlyBudgetExceededMonthCount}개월`);
  console.log(`  └ conditional_action             : ${result.conditionalCausedBudgetExceededMonthCount}개월`);
  console.log(`reviewTriggeredCount               : ${result.reviewTriggeredCount}`);
  console.log(
    `maxAdditionalDeclineAfterTriggerPercent: ${
      result.maxAdditionalDeclineAfterTriggerPercent ?? "(none)"
    }`
  );
  console.log(`simulation event count             : ${result.simulationEvents.length}`);
  console.log(`chart series count                 : ${result.chartSeries.length}`);
  console.log(`engineVersion                      : ${result.engineVersion}`);

  console.log("\n[Event Samples]");
  console.log(fmtEvent(firstOfType(result.simulationEvents, "recurring_buy_executed"), "첫 recurring"));
  console.log(fmtEvent(firstOfType(result.simulationEvents, "conditional_triggered"), "첫 conditional trigger"));
  console.log(fmtEvent(firstOfType(result.simulationEvents, "conditional_buy_executed"), "첫 conditional execution"));
  console.log(fmtEvent(firstOfType(result.simulationEvents, "conditional_buy_blocked"), "첫 conditional blocked"));
  console.log(fmtEvent(firstOfType(result.simulationEvents, "monthly_budget_exceeded"), "첫 budget exceeded"));
  console.log(fmtEvent(firstOfType(result.simulationEvents, "review_triggered"), "첫 review triggered"));
  console.log(
    fmtEvent(result.simulationEvents[result.simulationEvents.length - 1], "마지막 event")
  );

  console.log("\n[Monthly Results]");
  for (const month of result.monthlyResults) {
    console.log(
      `${month.month}  total=${String(month.totalInvestmentKrw).padStart(7)}원 (recurring=${String(month.recurringInvestmentKrw).padStart(7)}원 + conditional=${String(month.conditionalInvestmentKrw).padStart(6)}원)  recurring=${month.recurringExecutionCount}회  trigger=${month.conditionalTriggerCount}회  exec=${month.conditionalExecutionCount}회  blocked=${month.conditionalBlockedCount}회  budgetExceeded=${month.budgetExceeded}  cause=${month.budgetExceededCause ?? "-"}`
    );
  }

  // 구조적 불변 조건 — 입력이나 시장 데이터가 바뀌어도 항상 성립해야 한다.
  console.log("\n[Invariant Validation]");
  const checks = checkInvariants(market, result, rerun, noNetworkRerun);
  for (const check of checks) {
    console.log(`${check.pass ? "PASS" : "FAIL"}  ${check.id}. ${check.name} — ${check.detail}`);
  }
  const failed = checks.filter((check) => !check.pass);
  const invariantsPass = failed.length === 0;

  // 시나리오 관찰값 — 코드 정합성 판정이 아니라 결과 변화 감지용이다.
  const scenario = assertScenario(result);
  console.log("\n[Scenario Assertion]");
  console.log("(구조적 불변 조건이 아니라 현재 스모크 시나리오의 회귀 확인값입니다)");
  for (const line of scenario.lines) console.log(line);
  console.log(`status              : ${scenario.status}`);
  if (scenario.status === "CHANGED") {
    console.log(
      "→ 구조적 불변 조건이 통과했다면 엔진 결함이 아니라 시나리오·데이터 결과 변경입니다."
    );
    console.log("   LIVE_SIMULATION_RESULT.md 의 관찰값을 갱신하세요.");
  }

  console.log(`\nInvariant Validation: ${checks.length - failed.length}/${checks.length} PASS`);
  console.log(`Scenario Assertion: ${scenario.status}`);
  // RESULT 는 구조적 불변 조건으로만 판정한다. 시나리오 관찰값 변화는 실패가 아니다.
  console.log(`RESULT: ${invariantsPass ? "PASS" : "FAIL"}`);
  console.log("→ 상세 결론은 spikes/live-simulation/LIVE_SIMULATION_RESULT.md 에 기록");
  process.exitCode = invariantsPass ? 0 : 1;
}

main().catch((error) => {
  console.error(
    "[spike:simulation:live] 실행 실패:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
