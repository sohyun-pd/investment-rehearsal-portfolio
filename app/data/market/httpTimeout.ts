/**
 * 외부 시장 데이터 API(Finnhub·Twelve Data·Yahoo) 호출 공통 timeout — §production 안정성.
 *
 * SDK 가 없는 순수 `fetch` 호출이라 timeout 을 직접 걸어야 한다. 걸지 않으면 외부 API 가
 * 응답을 하지 않는 드문 경우(네트워크 단절 등) Cloudflare Pages Function 요청이 그 API 의
 * 타임아웃(수 분)까지 그대로 붙잡혀 있는다 — 그동안 사용자는 로딩 화면만 본다.
 *
 * 재시도는 여기서 하지 않는다 — 각 adapter 가 이미 실패를 `MarketDataError`(retryable 여부
 * 포함)로 정규화해 호출부(FlowProvider)에 돌려주고, 사용자가 "다시 시도"를 누르면 그게
 * 재시도다. 서버가 스스로 반복 재시도하면 무료/제한 티어의 API 한도를 실패 한 번에 여러 번
 * 소모하게 된다.
 */
const DEFAULT_TIMEOUT_MS = 10_000;

export function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
}
