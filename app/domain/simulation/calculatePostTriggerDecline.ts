/**
 * 조건 발생 후 추가 하락 계산 (순수 함수).
 *
 * 계산:
 *   (관찰 기간 최저 종가 - 조건 발생일 종가) ÷ 조건 발생일 종가 × 100
 *
 *  - 관찰 기간은 조건 발생일 **다음** 거래일부터 최대 N거래일(기본 20)이다.
 *  - 남은 거래일이 N개보다 적으면 남아 있는 거래일만 사용한다.
 *  - 조건 발생일이 마지막 candle 이면 관찰 가능한 거래일이 0개이므로 null 이다.
 *  - 종가만 사용한다(intraday low 미사용).
 */
import { PERCENT_DECIMALS, roundTo } from "./policies";
import type { DailyCandle } from "./types";

export interface PostTriggerDecline {
  triggerDate: string;
  triggerClose: number;
  observedTradingDays: number;
  minCloseAfterTrigger: number | null;
  minCloseDate: string | null;
  /** 하락이면 음수. 관찰 거래일이 없으면 null. */
  additionalDeclinePercent: number | null;
}

export function calculatePostTriggerDecline(
  candles: DailyCandle[],
  triggerIndex: number,
  observationDays: number
): PostTriggerDecline {
  const trigger = candles[triggerIndex];
  if (trigger === undefined) {
    throw new RangeError(`triggerIndex ${triggerIndex} 가 candles 범위를 벗어났습니다.`);
  }

  const start = triggerIndex + 1;
  const end = Math.min(candles.length, start + observationDays);

  let minClose: number | null = null;
  let minCloseDate: string | null = null;
  let observedTradingDays = 0;

  for (let index = start; index < end; index++) {
    const candle = candles[index];
    if (candle === undefined) continue;
    observedTradingDays++;
    if (minClose === null || candle.close < minClose) {
      minClose = candle.close;
      minCloseDate = candle.date;
    }
  }

  const additionalDeclinePercent =
    minClose === null || trigger.close <= 0
      ? null
      : roundTo(((minClose - trigger.close) / trigger.close) * 100, PERCENT_DECIMALS);

  return {
    triggerDate: trigger.date,
    triggerClose: trigger.close,
    observedTradingDays,
    minCloseAfterTrigger: minClose,
    minCloseDate,
    additionalDeclinePercent,
  };
}

/**
 * 모든 trigger 중 가장 큰 추가 하락(= 가장 작은 값).
 * 관찰 가능한 거래일이 있는 trigger 가 하나도 없으면 null.
 */
export function maxAdditionalDeclinePercent(declines: PostTriggerDecline[]): number | null {
  let worst: number | null = null;
  for (const decline of declines) {
    const value = decline.additionalDeclinePercent;
    if (value === null) continue;
    if (worst === null || value < worst) worst = value;
  }
  return worst;
}
