/**
 * 국내 종목 로컬 검색 인덱스.
 *
 * 근거: 사용자 확정 — Twelve Data·Finnhub 모두 한글 검색어를 지원하지 않는다("삼성"을 그대로
 * 보내면 결과가 비어 있다). 종목 검색은 실제 가격 데이터 provider 준비 여부와 무관하게 항상
 * 동작해야 하므로, 한글 종목명·별칭·6자리 종목코드는 이 로컬 인덱스로만 찾는다(네트워크 호출
 * 없음). 영문명·미국 ticker 는 기존 Finnhub 검색(`@/data/market/provider`)을 그대로 쓴다.
 *
 * 이 인덱스는 메타데이터 검색용이다 — 가격 조회(quote·time_series)와는 완전히 분리되어 있다.
 * 여기 있는 종목을 선택할 수 있다고 해서 최근 1년 가격 조회가 된다는 뜻은 아니다(§가격
 * provider 준비 전까지는 검증 단계에서 별도로 안내한다).
 */

export interface KoreanStockItem {
  symbol: string;
  nameKo: string;
  nameEn?: string;
  market: "KOSPI" | "KOSDAQ";
  micCode: "XKRX" | "XKOS";
  currency: "KRW";
  aliases?: string[];
}

/** 최소 회귀 대상 + 검색 우선순위 검증에 필요한 종목만 담는다. 새 종목을 추가할 때는 실제
 * 종목코드·거래소를 확인해서 넣는다(임의 데이터 금지). */
export const KOREAN_STOCKS: readonly KoreanStockItem[] = [
  {
    symbol: "005930",
    nameKo: "삼성전자",
    nameEn: "Samsung Electronics",
    market: "KOSPI",
    micCode: "XKRX",
    currency: "KRW",
    aliases: ["삼성", "삼성전자", "삼전", "Samsung"],
  },
  {
    symbol: "006400",
    nameKo: "삼성SDI",
    market: "KOSPI",
    micCode: "XKRX",
    currency: "KRW",
    aliases: ["삼성SDI", "삼성에스디아이"],
  },
  {
    symbol: "010140",
    nameKo: "삼성중공업",
    market: "KOSPI",
    micCode: "XKRX",
    currency: "KRW",
    aliases: ["삼성중공업"],
  },
  {
    symbol: "035720",
    nameKo: "카카오",
    nameEn: "Kakao",
    market: "KOSPI",
    micCode: "XKRX",
    currency: "KRW",
    aliases: ["카카오", "Kakao"],
  },
  {
    symbol: "035420",
    nameKo: "NAVER",
    nameEn: "NAVER",
    market: "KOSPI",
    micCode: "XKRX",
    currency: "KRW",
    aliases: ["네이버", "NAVER", "Naver"],
  },
  {
    symbol: "000660",
    nameKo: "SK하이닉스",
    nameEn: "SK Hynix",
    market: "KOSPI",
    micCode: "XKRX",
    currency: "KRW",
    aliases: ["SK하이닉스", "하이닉스", "SK Hynix"],
  },
  {
    symbol: "247540",
    nameKo: "에코프로비엠",
    nameEn: "Ecopro BM",
    market: "KOSDAQ",
    micCode: "XKOS",
    currency: "KRW",
    aliases: ["에코프로비엠", "Ecopro BM", "EcoPro BM"],
  },
];

/** 검색어·종목명 비교용 정규화 — 공백 전부 제거, 소문자화. 한글은 대소문자가 없어 영향 없고,
 * 영문 별칭("Samsung" 등)·티커성 입력을 대소문자 무관하게 맞추기 위해서다. */
function normalize(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}

/** 종목 하나가 이 검색어와 어떤 방식으로 일치하는지 판단해, 순위(낮을수록 좋음)를 매긴다.
 * 1) 이름 완전 일치 2) 별칭 완전 일치 3) 이름 시작 일치 4) 이름 포함 5) 종목코드 일치.
 * 어떤 방식으로도 일치하지 않으면 null. */
function matchPriority(item: KoreanStockItem, query: string): number | null {
  const nameCandidates = [item.nameKo, item.nameEn].filter((name): name is string => name !== undefined);
  const aliasCandidates = item.aliases ?? [];

  if (nameCandidates.some((name) => normalize(name) === query)) return 1;
  if (aliasCandidates.some((alias) => normalize(alias) === query)) return 2;
  const allNames = [...nameCandidates, ...aliasCandidates].map(normalize);
  if (allNames.some((name) => name.startsWith(query))) return 3;
  if (allNames.some((name) => name.includes(query))) return 4;
  if (normalize(item.symbol) === query) return 5;
  return null;
}

/** 여러 종목이 같은 순위에 걸리면(예: "삼성") 인덱스에 등록된 순서를 유지한다(안정 정렬). */
export function searchKoreanStocks(rawQuery: string): KoreanStockItem[] {
  const query = normalize(rawQuery);
  if (query === "") return [];

  return KOREAN_STOCKS.map((item) => ({ item, priority: matchPriority(item, query) }))
    .filter((entry): entry is { item: KoreanStockItem; priority: number } => entry.priority !== null)
    .sort((a, b) => a.priority - b.priority)
    .map((entry) => entry.item);
}

/** 순수 6자리 숫자인지 — "종목코드 형식"으로 인식할지 판단하는 유일한 기준. */
export function isSixDigitCode(rawQuery: string): boolean {
  return /^\d{6}$/.test(rawQuery.trim());
}

/** 숫자로만 이루어져 있지만 6자리가 아닌 입력 — invalid 상태 전용 판정. */
export function isMalformedCode(rawQuery: string): boolean {
  const trimmed = rawQuery.trim();
  return /^\d+$/.test(trimmed) && trimmed.length !== 6;
}
