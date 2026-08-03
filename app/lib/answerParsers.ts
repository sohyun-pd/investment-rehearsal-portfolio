/**
 * 금액·퍼센트 로컬 파서 — Claude 전체 plan parser 를 거치지 않고 그 자리에서 결정적으로 값을
 * 뽑아낸다.
 *
 * 근거: 사용자 확정 — chips 는 예시일 뿐 입력 가능한 값의 한계가 아니다. 지금 질문이 금액·
 * 퍼센트처럼 무엇을 묻는지 이미 아는 상황(structured_question)에서는, 짧은 답변을 다시 AI
 * 전체 parser 에 보내 왕복 지연·비용을 들이지 않고 여기서 바로 파싱한다.
 */

const KOREAN_DIGIT: Record<string, number> = {
  일: 1,
  이: 2,
  삼: 3,
  사: 4,
  오: 5,
  육: 6,
  칠: 7,
  팔: 8,
  구: 9,
};

/** "오십"(50)·"이십삼"(23)·"십"(10)·"오"(5) 같은 1~99 범위 순우리말 숫자만 다룬다 — 이 앱에서
 * 실제로 쓰이는 범위(예: "오십만원")를 넘는 큰 수 표현까지 지원할 필요는 없다. */
function parseKoreanTensNumeral(text: string): number | null {
  if (text.length === 1 && KOREAN_DIGIT[text] !== undefined) return KOREAN_DIGIT[text];
  const match = text.match(/^([일이삼사오육칠팔구]?)십([일이삼사오육칠팔구]?)$/);
  if (match === null) return null;
  const tens = match[1] === "" ? 1 : KOREAN_DIGIT[match[1] as string];
  const ones = match[2] === "" ? 0 : KOREAN_DIGIT[match[2] as string];
  if (tens === undefined || ones === undefined) return null;
  return tens * 10 + ones;
}

/** 원화 금액 — "5만원"·"50만원"·"100만 원"·"1백만원"·"오십만원"·"1,000,000원"·"82,300원" 등을
 * 파싱한다. 파싱할 수 없으면 null(호출자가 형식 오류로 안내한다 — 임의로 0 등을 반환하지 않는다). */
export function parseMoneyKrw(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/원\s*$/, "")
    .replace(/\s+/g, "")
    .replace(/,/g, "");
  if (cleaned === "") return null;

  const hundredManMatch = cleaned.match(/^(\d+(?:\.\d+)?)백만$/);
  if (hundredManMatch !== null) return Number(hundredManMatch[1]) * 1_000_000;

  const manMatch = cleaned.match(/^(\d+(?:\.\d+)?)만$/);
  if (manMatch !== null) return Number(manMatch[1]) * 10_000;

  const koreanManMatch = cleaned.match(/^([일이삼사오육칠팔구]?십[일이삼사오육칠팔구]?|[일이삼사오육칠팔구])만$/);
  if (koreanManMatch !== null) {
    const value = parseKoreanTensNumeral(koreanManMatch[1] as string);
    if (value !== null) return value * 10_000;
  }

  if (/^\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);

  return null;
}

/** 달러 금액 — "220달러"·"245.5달러"·"$220" 등을 파싱한다. */
export function parseMoneyUsd(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/^\$/, "")
    .replace(/달러\s*$/, "")
    .replace(/\s+/g, "")
    .replace(/,/g, "");
  if (/^\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned);
  return null;
}

/** 퍼센트 — "5%"·"7.5%"·"12% 하락"·"20퍼센트"·"15프로" 등에서 숫자만 뽑는다. */
export function parsePercent(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s+/g, "");
  const match = cleaned.match(/^(\d+(?:\.\d+)?)(%|퍼센트|프로)/);
  return match !== null ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// 통화별 금액 처리 — 계획의 종목 통화(`plan.asset.quoteCurrency`)에 맞는 파서·최소
// 금액·오류 문구를 하나의 지점에서 결정한다. 환율 변환은 하지 않는다 — 통화마다 숫자를
// 그대로 쓰되, 어느 통화인지만 종목에 맞춰 고른다(§사용자 확정 — 원화·달러 혼용 금지).
// ---------------------------------------------------------------------------

export const MIN_AMOUNT_KRW = 1_000;
export const MIN_AMOUNT_USD = 1;

/** 종목 통화에 맞는 파서로 금액 텍스트를 숫자로 바꾼다. */
export function parseMoneyByCurrency(raw: string, currency: "USD" | "KRW"): number | null {
  return currency === "KRW" ? parseMoneyKrw(raw) : parseMoneyUsd(raw);
}

/** 종목 통화의 최소 매수 금액 — 국내 1,000원, 미국 1달러(§사용자 확정). */
export function minAmountFor(currency: "USD" | "KRW"): number {
  return currency === "KRW" ? MIN_AMOUNT_KRW : MIN_AMOUNT_USD;
}

/** 최소 금액 미달(0·음수·너무 작은 값)일 때 보여줄 문구. */
export function amountTooLowMessage(currency: "USD" | "KRW"): string {
  return currency === "KRW" ? "매수 금액은 1,000원 이상 입력해주세요." : "매수 금액은 1달러 이상 입력해주세요.";
}

/** 금액 텍스트를 통화에 맞게 파싱하고 최소 금액까지 확인한다. 실패하면 null. */
export function parseValidAmount(raw: string, currency: "USD" | "KRW"): number | null {
  const parsed = parseMoneyByCurrency(raw, currency);
  if (parsed === null || parsed < minAmountFor(currency)) return null;
  return parsed;
}

/** 종목 통화와 반대되는 통화 표기("원" ↔ "달러"·"$")를 명시적으로 썼는지 확인한다 — 환율
 * 변환을 하지 않으므로 통화를 섞어 입력하면 조용히 잘못 파싱하는 대신 바로 알려준다
 * (§사용자 확정 — 미국 주식에 원화를 입력한 경우). */
export function hasMismatchedCurrencyMarker(raw: string, currency: "USD" | "KRW"): boolean {
  const trimmed = raw.trim();
  if (currency === "USD") return /원(?!화)/.test(trimmed) && !/\$|달러/.test(trimmed);
  return /\$|달러/.test(trimmed) && !/원(?!화)/.test(trimmed);
}

/** 통화 불일치 입력에 보여줄 안내(§사용자 확정 — 정확히 이 문구). */
export function currencyMismatchMessage(currency: "USD" | "KRW"): { title: string; example: string } {
  return currency === "USD"
    ? { title: "미국 주식은 달러 기준으로 계산해요.\n매수 금액을 달러로 입력해주세요.", example: "예) 매주 화요일 50달러" }
    : { title: "국내 주식은 원화 기준으로 계산해요.\n매수 금액을 원화로 입력해주세요.", example: "예) 매주 화요일 5만원" };
}
