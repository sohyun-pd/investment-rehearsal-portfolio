import type {
  Currency,
  Frequency,
  ReferenceType,
  StrategyCondition,
} from "@/types/strategy";

/** 조건의 핵심 실행 문장(친근한 어투). */
export function conditionSentence(c: StrategyCondition): string {
  switch (c.type) {
    case "recurring_buy":
      return `${frequencyLabel(c.frequency)} ${money(c.amount, c.currency)}씩 사요`;
    case "conditional_buy":
      return `${thresholdText(c.referenceType, c.direction, c.thresholdPercent)}하면 ${money(
        c.amount,
        c.amountCurrency
      )} 더 사요`;
    case "conditional_sell":
      return `${thresholdText(c.referenceType, c.direction, c.thresholdPercent)}하면 ${ratioText(
        c.sellRatio
      )} 팔아요`;
  }
}

/** 입력이 필요한(=null) 값들의 한글 라벨 목록. 없으면 빈 배열. */
export function missingFields(c: StrategyCondition): string[] {
  const out: string[] = [];
  if (c.type === "conditional_buy" || c.type === "conditional_sell") {
    if (c.referencePrice === null) out.push("기준 가격");
    if (c.thresholdPercent === null) out.push("변동률");
  }
  if (c.type === "conditional_buy" && c.amount === null) out.push("추가 매수 금액");
  if (c.type === "conditional_sell" && c.sellRatio === null) out.push("매도 비율");
  return out;
}

export function conditionTypeLabel(type: StrategyCondition["type"]): string {
  switch (type) {
    case "recurring_buy":
      return "정기 매수";
    case "conditional_buy":
      return "추가 매수";
    case "conditional_sell":
      return "조건부 매도";
  }
}

export function referenceTypeLabel(ref: ReferenceType): string {
  switch (ref) {
    case "average_cost":
      return "평균 매수가";
    case "market_price_at_creation":
      return "생성 시점 현재가";
    case "previous_close":
      return "직전 종가";
  }
}

export function frequencyLabel(freq: Frequency): string {
  switch (freq) {
    case "daily":
      return "매일";
    case "weekly":
      return "매주";
    case "monthly":
      return "매월";
  }
}

const WEEKDAYS = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

export function weekdayLabel(weekday: number | null | undefined): string | null {
  if (weekday == null) return null;
  return WEEKDAYS[weekday] ?? null;
}

/** 금액 표기: KRW 는 원, USD 는 $. 값이 없으면 "미정". */
export function money(amount: number | null, currency: Currency): string {
  if (amount == null) return "미정";
  if (currency === "KRW") {
    return `${amount.toLocaleString("ko-KR")}원`;
  }
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** USD 기준가 표기($320). null 이면 "미정". */
export function usd(value: number | null): string {
  if (value == null) return "미정";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** 조건 문구: "평균 매수가 대비 3% 하락" (값 없으면 미정 표기). */
export function thresholdText(
  ref: ReferenceType,
  direction: "up" | "down",
  thresholdPercent: number | null
): string {
  const dir = direction === "up" ? "상승" : "하락";
  const pct = thresholdPercent == null ? "미정" : `${thresholdPercent}%`;
  return `${referenceTypeLabel(ref)} 대비 ${pct} ${dir}`;
}

/** 매도 비율 표기: 0.5 → "절반 (50%)". null → "미정". */
export function ratioText(ratio: number | null): string {
  if (ratio == null) return "미정";
  const pct = Math.round(ratio * 100);
  return pct === 50 ? "절반 (50%)" : `${pct}%`;
}

const KST_FMT = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** ISO timestamp → "2026.07.28 05:00 KST". 파싱 실패 시 원문 반환. */
export function formatKst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = KST_FMT.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}.${get("month")}.${get("day")} ${get("hour")}:${get("minute")} KST`;
}
