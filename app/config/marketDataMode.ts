/**
 * 시장 데이터 provider 선택 — 단 하나의 명시적 스위치.
 *
 * `VITE_USE_MOCK_MARKET=true` 일 때만 오프라인 데모 provider(결정적 합성 candles·mock quote)를
 * 쓴다. 기본값은 false(실제 데이터). API 호출이 실패했다고 이 값이 자동으로 true 가 되는 일은
 * 없다 — `app/data/market/provider.ts` 는 실패를 그대로 던지고 mock 으로 대체하지 않는다.
 *
 * 배포 환경에서는 이 플래그를 설정하지 않는다.
 */
export function isMockMarketEnabled(): boolean {
  return import.meta.env.VITE_USE_MOCK_MARKET === "true";
}
