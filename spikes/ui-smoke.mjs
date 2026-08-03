/**
 * UI 스모크 — 1차 화면 골격이 실제로 렌더되는지 브라우저에서 확인한다.
 *
 * 실행: node spikes/ui-smoke.mjs   (dev 서버가 떠 있어야 한다)
 *
 * `VITE_USE_MOCK_MARKET`·`VITE_USE_MOCK_AI` 를 설정하지 않고 실행하면 실제 Finnhub 검색 ·
 * 실제 Claude 계획 해석(POST /api/plan/interpret) · 실제 Twelve Data 과거 일봉으로
 * Screen 2(종목 검색·질문) → Screen 4(분석)를 통과한다(server/BFF 경유).
 *
 * Claude 가 만드는 질문은 매 실행마다 문구·순서가 다를 수 있어, 질문 개수를 하드코딩하지
 * 않고 Screen 3(계획 확인)이 뜰 때까지 보이는 첫 선택지를 반복해서 누른다.
 *
 * 검증:
 *  - 콘솔 오류 없이 Screen 1 → 5 를 통과하는가
 *  - 실제(또는 VITE_USE_MOCK_MARKET=true 인 경우 결정적 합성) candles 가 실제 시뮬레이션
 *    엔진 검증을 통과하는가(통과 못 하면 화면이 throw)
 *  - sessionStorage 에 plan 이 저장되고 새로고침 후 복구되는가
 */
import { chromium } from "playwright";

const BASE = "http://localhost:5173/";
const shots = [];
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

async function shot(name) {
  await page.screenshot({ path: `/tmp/ui-${name}.png`, fullPage: true });
  shots.push(name);
}

await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForSelector("textarea");
await shot("1-intent");

// Screen 1+2 통합(ScreenChat) — 예시 칩이 없다(§자연어 입력만). 텍스트를 직접 입력해 실제
// /api/plan/interpret 를 호출한다.
await page.locator('textarea[aria-label="투자 생각 입력"]').fill("애플을 매주 월요일 5만 원씩 살래요");
await page.locator('button:has-text("전송")').click();
await page.waitForSelector('[aria-label="AI가 입력 중이에요"]');
await shot("2-loading");

// Screen 2 — 종목 검색(실제 Finnhub, server/BFF 경유). AI 질문보다 먼저 온다.
await page.waitForSelector("#stock-search-input", { timeout: 15000 });
await page.locator("#stock-search-input").fill("AAPL");
await page.locator('button:has-text("AAPL")').first().click({ timeout: 10000 });
await shot("2b-asset-selected");

// Screen 2 — AI(POST /api/plan/interpret)가 만드는 질문에 순서대로 응답한다. 문구는 매 실행
// 마다 다를 수 있어 "main 안의 첫 선택지"를 계획이 준비될 때까지 반복해서 누른다.
// 채팅형 화면에서는 조건이 모일 때마다 바텀시트가 뜬다 — 아직 더 물을 게 남아있으면
// "계속 수정하기"로 닫고 계속하고, 더 물을 게 없으면(main 에 답할 버튼이 없으면)
// "이 계획 검증하기"를 눌러 Screen 3 로 넘어간다(§FlowProvider `advance_plan_ready`).
const PLAN_READY_TEXT = "작동했는지 확인해볼까요?";
async function isPlanReadyNow() {
  return (await page.locator(`text=${PLAN_READY_TEXT}`).count()) > 0;
}
async function isSheetOpen() {
  return (await page.locator("text=지금까지 정리한 계획").count()) > 0;
}
// 마지막 질문에 답하면 다음 질문 버튼이 다시 뜨지 않고(더 물을 게 없으므로) 바텀시트만
// 저절로 열린다 — "새 버튼이 뜬다"만 기다리면 영영 끝나지 않는다. 둘 중 먼저 오는 쪽을 본다.
async function waitForNextButtonsOrSheet(timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isSheetOpen()) return "sheet";
    if ((await page.locator("main button").count()) > 0) return "buttons";
    if (await isPlanReadyNow()) return "ready";
    await page.waitForTimeout(200);
  }
  throw new Error("질문 버튼도 바텀시트도 뜨지 않았습니다(타임아웃)");
}
for (let i = 0; i < 16; i++) {
  if (await isPlanReadyNow()) break;

  if (await isSheetOpen()) {
    const noMoreQuestions = (await page.locator("main button").count()) === 0;
    if (noMoreQuestions) {
      await page.locator("button", { hasText: "최근 1년 가격에 적용하기" }).click();
      continue;
    }
    await page.locator("button", { hasText: "계획 수정하기" }).click();
    await page.waitForTimeout(200);
    continue;
  }

  await waitForNextButtonsOrSheet();
  if (await isPlanReadyNow()) break;
  if (await isSheetOpen()) continue;

  const answerButton = page.locator("main button").first();
  try {
    // 짧은 타임아웃: 클릭을 시도하는 사이 바텀시트가 열려 화면을 덮으면 빠르게 실패시키고
    // 다음 루프에서 시트부터 처리한다(30초 기본 타임아웃까지 기다리지 않는다).
    await answerButton.click({ timeout: 3000 });
    await page.waitForTimeout(300);
  } catch {
    // 바텀시트가 막 열렸다 — 다음 루프 진입 시 위 isSheetOpen() 분기가 처리한다.
  }
}

// 마지막으로 바텀시트가 열려 있는 채로 루프가 끝났다면(최종 검증 시점) 한 번 더 확인한다.
if (!(await isPlanReadyNow()) && (await isSheetOpen())) {
  await page.locator("button", { hasText: "최근 1년 가격에 적용하기" }).click();
}
await shot("2c-questions-done");

// Screen 3
await page.waitForSelector(`text=${PLAN_READY_TEXT}`, { timeout: 15000 });
await shot("3-plan");

// Screen 4
await page.locator("button", { hasText: "최근 1년 가격에 적용하기" }).click();
await page.waitForSelector("text=가격을 가져오는 중이에요");
await shot("4-loading");
await page.waitForSelector("text=월 최대 투자 금액", { timeout: 15000 });
// 지표·차트는 즉시 뜨지만 AI 해석(실제 Claude 호출)은 별도로 늦게 온다 — 늦게 와도 결과를
// 가리지 않는지 확인하려면 헤드라인 로딩이 끝날 때까지 기다린다(최대 20초).
await page
  .waitForSelector("text=AI 설명을 정리하고 있어요", { state: "detached", timeout: 20000 })
  .catch(() => {});
await shot("4-analysis");

const heroValue = await page.locator("p.text-display").first().textContent();
const causeText = await page.locator("text=/예산을 넘은 달이|넘지 않았어요/").first().textContent();

// Screen 5
await page.locator("button", { hasText: "조정안 비교하기" }).click();
await page.waitForSelector("text=모의 실행할까요?", { timeout: 15000 });
await shot("5-compare");

// 조정안 선택 → Screen 4-R
await page.locator("button", { hasText: "정기 일정 우선" }).first().click();
await page.locator("button", { hasText: "이 계획으로 모의 실행하기" }).click();
await page.waitForSelector("text=바뀐 부분", { timeout: 15000 });
await page.waitForTimeout(800);
await shot("6-revised");

// 완료
await page.locator("button", { hasText: "모의 실행 마치기" }).click();
await page.waitForSelector("text=모의 계획으로");
await shot("7-completed");

// sessionStorage 복구 확인
const stored = await page.evaluate(() => window.sessionStorage.getItem("aiicp.session.v1"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);
const afterReload = await page.locator("h1").first().textContent();
await shot("8-after-reload");

console.log("screenshots:", shots.join(", "));
console.log("hero:", heroValue?.trim());
console.log("cause:", causeText?.trim().slice(0, 80));
console.log("sessionStorage keys:", stored === null ? "(none)" : Object.keys(JSON.parse(stored)).join(","));
console.log("plan in storage:", stored === null ? "-" : JSON.stringify(JSON.parse(stored).plan).slice(0, 120));
console.log("after reload h1:", afterReload?.trim().replace(/\s+/g, " "));
console.log("console errors:", errors.length === 0 ? "none" : errors.join(" | "));

await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
