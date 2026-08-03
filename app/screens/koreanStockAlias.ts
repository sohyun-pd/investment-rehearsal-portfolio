/**
 * 한글 종목 별칭 → 영문 검색어 정규화.
 *
 * 근거: 사용자 확정 — 자연어 투자 계획 제품에서 "애플" 검색이 실패하는 건 제품 의도와 맞지
 * 않는다. 다만 별칭 사전이 티커를 직접 확정하면 안 된다 — 여기서는 검색어만 바꾸고, 실제
 * 종목 확정은 항상 Finnhub 검색 결과를 사용자가 고르는 기존 절차(AssetSearchStep)를 그대로
 * 거친다(§AssetSearchStep.onSelect).
 */

const KOREAN_STOCK_ALIASES: Record<string, string> = {
  애플: "Apple",
  테슬라: "Tesla",
  엔비디아: "NVIDIA",
  마이크로소프트: "Microsoft",
  아마존: "Amazon",
  구글: "Alphabet",
  알파벳: "Alphabet",
  메타: "Meta",
  넷플릭스: "Netflix",
};

/**
 * 검색창에 입력한 원문을 그대로 두고(사용자에게 보이는 값), 실제 Finnhub 검색에는 이 함수의
 * 반환값만 쓴다 — trim/공백 정규화 후 별칭 사전에 있으면 영문으로 바꾸고, 없으면 원문 그대로
 * 돌려줘 기존 영문 검색(예: "Apple")이 계속 정상 동작하게 한다.
 */
export function normalizeSearchQuery(rawInput: string): string {
  const normalized = rawInput.trim().replace(/\s+/g, " ");
  return KOREAN_STOCK_ALIASES[normalized] ?? normalized;
}

/** 한글(완성형·자모) 문자가 하나라도 있는지 — Finnhub·Twelve Data 모두 한글 검색어를 이해하지
 * 못하므로, 별칭 사전에도 없는 한글 입력을 그대로 실제 provider 에 보내면 안 된다는 판단에
 * 쓴다(§AssetSearchStep — 국내 로컬 인덱스에도 없는 한글 검색어는 empty 로 끝내고, 오류로
 * 보이는 provider 호출로 새지 않는다). */
export function containsHangul(text: string): boolean {
  return /[가-힣ᄀ-ᇿ㄰-㆏]/.test(text);
}
