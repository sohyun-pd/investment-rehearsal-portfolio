# Live Historical Simulation Smoke

production adapter 로 받은 **실제 Twelve Data 과거 일봉**을 시뮬레이션 엔진에 넣어
통합이 성립하는지 확인한다.

- 결과 기록: [`LIVE_SIMULATION_RESULT.md`](./LIVE_SIMULATION_RESULT.md)
- adapter: [`app/data/market/`](../../app/data/market/)
- engine: [`app/domain/simulation/`](../../app/domain/simulation/)
- 엔진 스펙: [`docs/product/build/SIMULATION_ENGINE_SPEC.md`](../../docs/product/build/SIMULATION_ENGINE_SPEC.md)

## 실행

```bash
npm run spike:simulation:live
```

환경변수 `TWELVE_DATA_API_KEY` 를 `.env.local` 에서 읽는다. 키가 없으면 `api_key_missing` 으로
명시 실패한다. 출력에는 API 키와 요청 URL 이 포함되지 않는다.

## 이 스모크가 확인하는 것

정식 백테스트가 아니다. **과거 조건 시뮬레이션(Historical Condition Replay)** 의 기술 통합만
확인한다.

```text
사용자가 입력한 평균 매수가를 고정 기준으로 사용해
최근 가격에서 조건 발생 시점을 확인합니다.
실제 체결 수량, 환율, 평균 매수가 변화는 반영하지 않습니다.
```

## 검증 대상

- symbol: `AAPL`
- fromInclusive: `2025-07-28`
- toInclusive: `2026-07-27` (adapter 가 `end_date=2026-07-28` 로 변환해 요청)

## ⚠️ 기술 스모크 입력값

```typescript
{
  recurring:      { frequency: "weekly", weekday: "monday", amountKrw: 50000 },
  conditionalBuy: { averageCostUsd: 220, thresholdPercent: 3, amountKrw: 20000 },
  guardrails:     { monthlyBudgetKrw: 200000,
                    maxConditionalExecutionsPerMonth: null,
                    reviewDrawdownPercent: null }
}
```

**`averageCostUsd: 220` 은 production 기본값이 아니다. 최종 데모 사용자 값도 아니다.**
실제 candle 과 엔진이 연결되는지 확인하기 위한 기술 스모크 입력이며, 어디에도 기본값으로
저장하지 않는다. 사용자 평균 매수가는 언제나 사용자 입력에서 온다.

## 분석 정책

`ORIGINAL_PLAN_POLICY` (원래 계획 분석용):

| 항목 | 값 |
| --- | --- |
| `monthlyBudgetBehavior` | `allow_and_flag` |
| `reviewTriggerBehavior` | `flag_only` |
| `conditionalTriggerMode` | `crossing` |
| `sameDayEventOrder` | `recurring_first` |
| `postTriggerObservationDays` | `20` |

## 출력

- `[Market Data]` — provider / symbol / requested range / actual range / candle count /
  first·last candle / adjustment / completeness / fetchedAt / API latency
- `[Simulation]` — trigger price 와 모든 요약 지표 / event count / chart series count / engineVersion
- `[Event Samples]` — 첫 recurring · 첫 conditional trigger · 첫 conditional execution ·
  첫 conditional blocked · 첫 budget exceeded · 첫 review triggered · 마지막 event
  (해당 이벤트가 없으면 "없음"으로 표시한다. 실패로 조작하지 않는다)
- `[Monthly Results]` — 월별 집계
- `[Invariant Validation]` — 구조적 불변 조건 15개 개별 PASS/FAIL
- `[Scenario Assertion]` — 현재 스모크 시나리오 관찰값의 expected / actual / MATCH·CHANGED

## 구조적 불변 조건 15개 (Invariant Validation)

**입력값이나 시장 데이터가 바뀌어도 항상 성립해야 하는 계산 정합성**만 담는다.
실제 결과에 특정 횟수나 금액을 하드코딩하지 않는다.

1. candle count >= 200
2. `chartSeries.length === candles.length`
3. `conditionalExecutionCount <= conditionalTriggerCount`
4. `conditionalBlockedCount === conditionalTriggerCount - conditionalExecutionCount`
5. `totalInvestmentKrw === totalRecurringInvestmentKrw + totalConditionalInvestmentKrw`
6. `monthlyResults` 합계와 summary 합계 일치
7. recurring event 개수 === `recurringExecutionCount`
8. conditional trigger event 개수 === `conditionalTriggerCount`
9. 모든 event 날짜가 actual range 안에 있음
10. 모든 chart `eventId` 가 실제 event id 를 참조
11. 동일 candles + plan + policy 재실행 결과가 `calculatedAt` 제외 deepEqual
12. engine 이 API 를 직접 호출하지 않음
13. `budgetExceededMonthCount === recurringOnly + conditionalCaused`
14. 초과한 달마다 원인이 정확히 하나 지정됨 (두 원인 동시 기록 없음)
15. `monthly_budget_exceeded` 이벤트의 `cause` 가 월 분류와 같고 `triggeredByEventId` 가
    실제 실행 이벤트를 참조

하나라도 실패하면 **코드 결함**이며 `RESULT: FAIL` 이고 exit code 1 이다.

## Scenario Assertion (결과 변화 감지용)

```text
recurring_only     : 4개월
conditional_action : 0개월
```

이 값은 **현재 고정된 기술 스모크 시나리오의 관찰값**이다.

- 입력: 정기 매수 매주 월요일 50,000원 / 월 예산 200,000원
- 기간: 2025-07-28 ~ 2026-07-27

**이 값이 바뀌었다는 이유만으로 스모크를 실패 처리하지 않는다.** 실패 여부는 다음으로 판단한다.

1. API 호출 성공 여부
2. simulation 실행 성공 여부
3. 구조적 invariant 통과 여부

Scenario Assertion 은 **결과 변화 감지용**이며 코드 정합성 판정용 invariant 가 아니다.
값이 달라지면 러너가 `CHANGED` 를 출력하지만 `RESULT: PASS` 는 유지된다. 이때는 엔진 결함으로
단정하지 말고 `LIVE_SIMULATION_RESULT.md` 의 관찰값을 갱신한다.

가능한 조합:

```text
Invariant Validation: 15/15 PASS
Scenario Assertion: MATCH        → RESULT: PASS

Invariant Validation: 15/15 PASS
Scenario Assertion: CHANGED      → RESULT: PASS  (시나리오·데이터 결과 변경)

Invariant Validation: 14/15 PASS
Scenario Assertion: MATCH        → RESULT: FAIL  (코드 결함)
```

> 12번 검증 방법: `globalThis.fetch` 를 throw 하는 함수로 바꾼 상태에서 엔진을 재실행하고
> 결과가 동일한지 본다. 엔진이 네트워크를 건드리면 그 자리에서 예외가 난다.

## 정책

- production adapter 를 사용한다. spike 안에 normalize 로직을 다시 만들지 않는다.
- 실패 시 mock/fixture/Finnhub 데이터로 대체하지 않는다.
- 결과 수치를 미리 정해두거나 하드코딩하지 않는다.
- 수익률을 계산하지 않는다. 실제 주문을 하지 않는다.
