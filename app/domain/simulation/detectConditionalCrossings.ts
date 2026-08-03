/**
 * threshold 하향 돌파(crossing) 탐지 (순수 함수).
 *
 * 판정 규칙:
 *   이전 거래일 종가 > thresholdPrice  AND  현재 거래일 종가 <= thresholdPrice
 *
 * 이 규칙 하나로 세 가지 요구사항이 동시에 만족된다.
 *  - 임계선 아래에 머무는 동안 매일 반복 trigger 하지 않는다(이전 종가가 이미 아래라 조건 불성립).
 *  - 종가가 임계선 위로 회복하면 자동으로 re-arm 된다(다음 하락에서 조건 성립).
 *  - 첫 candle 은 비교할 이전 거래일이 없으므로 trigger 하지 않는다. 이미 임계선 이하라면
 *    initialState 로만 기록한다.
 *
 * intraday high/low 는 사용하지 않는다. 종가만 본다.
 */
import type { DailyCandle } from "./types";

export type ThresholdInitialState = "above_threshold" | "at_or_below_threshold";

export interface ThresholdCrossing {
  /** candles 배열의 인덱스. */
  index: number;
  date: string;
  close: number;
  previousClose: number;
}

export interface CrossingDetection {
  thresholdPrice: number;
  initialState: ThresholdInitialState;
  crossings: ThresholdCrossing[];
}

export function detectThresholdCrossings(
  candles: DailyCandle[],
  thresholdPrice: number
): CrossingDetection {
  const first = candles[0];
  const initialState: ThresholdInitialState =
    first !== undefined && first.close <= thresholdPrice
      ? "at_or_below_threshold"
      : "above_threshold";

  const crossings: ThresholdCrossing[] = [];

  for (let index = 1; index < candles.length; index++) {
    const previous = candles[index - 1];
    const current = candles[index];
    if (previous === undefined || current === undefined) continue;

    if (previous.close > thresholdPrice && current.close <= thresholdPrice) {
      crossings.push({
        index,
        date: current.date,
        close: current.close,
        previousClose: previous.close,
      });
    }
  }

  return { thresholdPrice, initialState, crossings };
}
