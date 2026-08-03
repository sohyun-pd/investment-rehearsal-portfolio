/**
 * 시장 데이터 API 스파이크 실행 스크립트.
 *
 * 검증: 종목 검색 → 현재가 → 전일 대비 → 데이터 기준 시각.
 *       (provider=mock 이면 sample-response.json, finnhub/alphavantage 면 실제 조회)
 *
 * 실행: npm run spike:market
 * 실제 호출: .env.local 에 MARKET_PROVIDER + 해당 API 키 설정.
 */
import "../env.ts";
import { createMarketProvider } from "./adapters.ts";

// 검색어: 환경변수 SPIKE_QUERY 로 덮어쓸 수 있음(기본 Apple).
const QUERY = process.env.SPIKE_QUERY || "apple";

async function main(): Promise<void> {
  const provider = createMarketProvider();
  console.log(`[market-api] provider = ${provider.name}`);

  // (1) 종목 검색 (미국 주식)
  console.log(`\n▶ 종목 검색: "${QUERY}"`);
  const t0 = Date.now();
  const matches = await provider.search(QUERY);
  const searchMs = Date.now() - t0;
  if (matches.length === 0) throw new Error(`검색 결과 없음: "${QUERY}"`);
  matches.forEach((m) => console.log(`  - ${m.symbol}: ${m.description}`));
  console.log(`  (검색 응답시간: ${searchMs}ms)`);

  // (2) 첫 결과의 현재가/전일대비/기준시각
  const target = matches[0]!.symbol;
  console.log(`\n▶ 시세 조회: ${target}`);
  const t1 = Date.now();
  const q = await provider.getQuote(target);
  const quoteMs = Date.now() - t1;
  const sign = q.changePercent >= 0 ? "+" : "";
  console.log(`  현재가      : ${q.price} ${q.currency}`);
  console.log(`  전일 종가   : ${q.previousClose} ${q.currency}`);
  console.log(`  전일 대비   : ${sign}${q.changePercent}%`);
  console.log(`  기준 시각   : ${q.timestamp}`);
  console.log(`  (시세 응답시간: ${quoteMs}ms)`);

  console.log(`\n[market-api] ✅ 검색·현재가·전일대비·기준시각 조회 완료`);
}

main().catch((err) => {
  console.error("[market-api] 실행 실패:", err instanceof Error ? err.message : err);
  console.error("→ 원인/대체방안을 spikes/TECH_SPIKE_RESULT.md 에 기록하세요.");
  process.exit(1);
});
