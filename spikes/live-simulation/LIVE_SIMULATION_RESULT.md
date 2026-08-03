# Live Historical Simulation Integration

## Result

**PASS** — 실제 Twelve Data 과거 일봉과 시뮬레이션 엔진 통합 성립.

- Structural invariants: **15/15 PASS**
- Scenario assertion: **MATCH**

> 실제 터미널에서 인증된 호출로 실행해 확정한 결과다. mock / fixture / Finnhub 데이터로
> 대체하지 않았고, 결과 수치를 하드코딩하지 않았다.

실행일: 2026-07-28

## Data

| 항목 | 값 |
| --- | --- |
| provider | Twelve Data (`/time_series`) |
| symbol | AAPL |
| requested range | 2025-07-28 ~ 2026-07-27 (inclusive) |
| actual range | **2025-07-28 ~ 2026-07-27** |
| candle count | **251** |
| adjustment | `splits` (`dividendAdjusted: false`) |
| completeness | `complete` |
| latency | **787ms** |
| fetchedAt | 2026-07-28T10:24:54.660Z |

- first candle: `2025-07-28 O:214.029999 H:214.85001 L:213.059998 C:214.050003 V:37858000`
- last candle: `2026-07-27 O:334.89999 H:339.57001 L:334.019989 C:336.91 V:45246885`

**inclusive → exclusive 변환이 실제로 작동했다.** Tech Spike 2B 는 `end_date=2026-07-27` 을 그대로
보내 마지막 candle 이 `2026-07-24` 로 끝나고 250개였다. adapter 가 `+1일` 변환을 하면서 요청한
종료일 `2026-07-27` 이 포함되어 **251개**가 됐다.

## Technical Smoke Plan

| 조건 | 값 |
| --- | --- |
| recurring | weekly / monday / 50,000원 |
| conditional | averageCostUsd 220 USD 대비 -3% / 20,000원 |
| monthly budget | 200,000원 |
| max conditional executions per month | 미설정 (null) |
| review drawdown | 미설정 (null) |
| trigger price (계산값) | **$213.40** |

분석 정책: `allow_and_flag` / `flag_only` / `crossing` / `recurring_first` / 관찰 20거래일.

> ⚠️ **`averageCostUsd: 220` 은 production 기본값이 아니다. 최종 데모 사용자 값도 아니다.**
> 실제 candle 과 엔진 연결을 확인하기 위한 기술 스모크 입력이다. 어디에도 기본값으로
> 저장하지 않았고, 사용자 평균 매수가는 언제나 사용자 입력에서 온다.

## Actual Simulation Result

| 지표 | 값 |
| --- | --- |
| `recurringExecutionCount` | 53 |
| `conditionalTriggerCount` | 1 |
| `conditionalExecutionCount` | 1 |
| `conditionalBlockedCount` | 0 |
| `totalRecurringInvestmentKrw` | 2,650,000 |
| `totalConditionalInvestmentKrw` | 20,000 |
| `totalInvestmentKrw` | 2,670,000 |
| `maxMonthlyInvestmentKrw` | 250,000 |
| `maxMonthlyConditionalExecutionCount` | 1 |
| `budgetExceededMonthCount` | **4** |
| ├ `recurringOnlyBudgetExceededMonthCount` | **4** |
| └ `conditionalCausedBudgetExceededMonthCount` | **0** |
| `reviewTriggeredCount` | 0 (재검토 기준 미설정) |
| `maxAdditionalDeclineAfterTriggerPercent` | **-4.21** |
| simulation event count | 59 |
| chart series count | 251 |
| `engineVersion` | `simulation-engine-1.0.0` |

### 월별 집계 (13개월)

| 월 | 총 투자 | 정기 | 추가 | recurring 횟수 | trigger | exec | 예산 초과 | 원인 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| 2025-07 | 70,000원 | 50,000 | 20,000 | 1 | 1 | 1 | false | – |
| 2025-08 | 200,000원 | 200,000 | 0 | 4 | 0 | 0 | false | – |
| 2025-09 | 250,000원 | 250,000 | 0 | 5 | 0 | 0 | **true** | `recurring_only` |
| 2025-10 | 200,000원 | 200,000 | 0 | 4 | 0 | 0 | false | – |
| 2025-11 | 200,000원 | 200,000 | 0 | 4 | 0 | 0 | false | – |
| 2025-12 | 250,000원 | 250,000 | 0 | 5 | 0 | 0 | **true** | `recurring_only` |
| 2026-01 | 200,000원 | 200,000 | 0 | 4 | 0 | 0 | false | – |
| 2026-02 | 200,000원 | 200,000 | 0 | 4 | 0 | 0 | false | – |
| 2026-03 | 250,000원 | 250,000 | 0 | 5 | 0 | 0 | **true** | `recurring_only` |
| 2026-04 | 200,000원 | 200,000 | 0 | 4 | 0 | 0 | false | – |
| 2026-05 | 200,000원 | 200,000 | 0 | 4 | 0 | 0 | false | – |
| 2026-06 | 250,000원 | 250,000 | 0 | 5 | 0 | 0 | **true** | `recurring_only` |
| 2026-07 | 200,000원 | 200,000 | 0 | 4 | 0 | 0 | false | – |

### 예산 초과 원인 (실측)

| 항목 | 값 |
| --- | ---: |
| 예산 초과 | **4개월** (2025-09, 2025-12, 2026-03, 2026-06) |
| 정기 매수만으로 초과 (`recurring_only`) | **4개월** |
| 추가 매수로 초과 (`conditional_action`) | **0개월** |

- 4개월 모두 **월요일이 5번 있는 달**이다. 50,000원 × 5회 = **250,000원**이 사용되어
  월 예산 200,000원을 넘었다.
- 그 4개월의 추가 매수 금액은 **모두 0원**이다. **추가 매수는 예산 초과 원인이 아니었다.**
- 이 기간에 발생한 유일한 추가 매수(2025-07-29, 20,000원)가 속한 2025-07 은 총 70,000원으로
  예산 안이었다.

> 이 관찰은 **이번 기술 스모크 계획(주 50,000원 / 월 예산 200,000원)과 검증 기간
> (2025-07-28 ~ 2026-07-27)에 한정된 사실**이다. 투자 일반론이나 다른 계획·기간으로 확장하지
> 않는다.

## Event Samples

```text
첫 recurring            : evt_0001 2025-07-28 recurring_buy_executed close=$214.050003
                          · amount=50000원 · scheduled=2025-07-28
첫 conditional trigger  : evt_0002 2025-07-29 conditional_triggered close=$211.27
                          · triggerPrice=$213.4
첫 conditional execution: evt_0003 2025-07-29 conditional_buy_executed close=$211.27
                          · amount=20000원 · monthlyIndex=1
첫 conditional blocked  : (없음 — 이 기간에 발생하지 않았습니다)
첫 budget exceeded      : evt_0013 2025-09-29 monthly_budget_exceeded close=$254.42999
                          · monthly=250000원 (recurring=250000원 + conditional=0원)
                          / budget=200000원 · cause=recurring_only
                          · triggeredBy=evt_0012 (recurring_buy_executed)
첫 review triggered     : (없음 — 재검토 기준 미설정)
마지막 event            : evt_0059 2026-07-27 recurring_buy_executed close=$336.91
                          · amount=50000원 · scheduled=2026-07-27
```

발생하지 않은 이벤트는 없다고 표시했다. 실패로 조작하지 않았다.

## Invariant Validation

| # | 불변 조건 | 결과 | 실측값 |
| --- | --- | --- | --- |
| 1 | candle count >= 200 | **PASS** | candles=251 |
| 2 | `chartSeries.length === candles.length` | **PASS** | 251 === 251 |
| 3 | `conditionalExecutionCount <= conditionalTriggerCount` | **PASS** | 1 <= 1 |
| 4 | `blocked === triggered - executed` | **PASS** | 0 === 1-1 |
| 5 | `totalInvestmentKrw === recurring + conditional` | **PASS** | 2,670,000 = 2,650,000 + 20,000 |
| 6 | `monthlyResults` 합계 === summary 합계 | **PASS** | months=13, 금액·횟수·초과개월 전부 일치 |
| 7 | recurring event 개수 === `recurringExecutionCount` | **PASS** | 53 === 53 |
| 8 | conditional trigger event 개수 === `conditionalTriggerCount` | **PASS** | 1 === 1 |
| 9 | 모든 event 날짜가 actual range 안 | **PASS** | 59개 이벤트 모두 2025-07-28~2026-07-27 |
| 10 | 모든 chart `eventId` 가 실제 event id 참조 | **PASS** | linked=59, events=59, unknown=0 |
| 11 | 동일 입력 재실행 deepEqual (`calculatedAt` 제외) | **PASS** | 2회 실행 결과 동일 |
| 12 | engine 이 API 를 직접 호출하지 않음 | **PASS** | `globalThis.fetch` 를 throw 로 바꾼 상태에서도 동일 결과 |
| 13 | `budgetExceededMonthCount === recurringOnly + conditionalCaused` | **PASS** | 4 === 4 + 0 |
| 14 | 초과한 달마다 원인이 정확히 하나 지정됨 | **PASS** | 13개월 검사 통과 (두 원인 동시 기록 0건) |
| 15 | budget exceeded event 의 `cause` 가 월 분류와 같고 `triggeredByEventId` 가 실행 이벤트 참조 | **PASS** | events=4, exceededMonths=4, violations=0 |

**Structural invariants: 15/15 PASS**

여기 있는 항목은 **입력값이나 시장 데이터가 바뀌어도 항상 성립해야 하는 구조적 계산 정합성**만
담는다. 특정 횟수·금액을 기대값으로 넣지 않는다. 하나라도 실패하면 코드 결함이며
`RESULT: FAIL` 이다.

## Scenario Assertion

**구조적 불변 조건이 아니다.** 아래 입력·기간·시장 데이터에서 관찰된 결과이며, 결과 변화를
감지하기 위한 회귀 확인값이다.

### 현재 기술 스모크 입력

- 정기 매수: 매주 월요일 50,000원
- 월 예산: 200,000원
- 기간: 2025-07-28 ~ 2026-07-27

### 현재 관찰 결과

| 항목 | expected | actual | |
| --- | ---: | ---: | --- |
| `recurring_only` | 4개월 | **4개월** | ✓ |
| `conditional_action` | 0개월 | **0개월** | ✓ |

**status: MATCH**

### 해석 규칙

이 값은 현재 입력, 기간, 시장 데이터에서 관찰된 결과이며 **모든 계획에서 성립해야 하는
invariant 가 아니다.**

향후 값이 달라지더라도 구조적 invariant 가 통과한다면 **엔진 결함으로 단정하지 않고
시나리오 또는 데이터 결과 변경으로 기록한다.** 이 경우 러너는
`Scenario Assertion: CHANGED` 를 출력하지만 `RESULT: PASS` 를 유지하며, 이 문서의 관찰값을
갱신한다.

스모크의 실패 여부는 다음으로만 판단한다.

1. API 호출 성공 여부
2. simulation 실행 성공 여부
3. 구조적 invariant 통과 여부

## Product Implication

### 실제 historical candle 과 simulation engine 연결 가능 여부

**가능하다.** 251 거래일 `complete` 데이터가 엔진에 그대로 들어가고, 이벤트·차트·월별 집계가
모두 일관되게 나온다. adapter 가 exclusive `end_date` 와 문자열 → Number 변환을 흡수하므로
엔진은 확정된 candle 배열만 받는다.

### 현재 분석 화면에서 쓸 수 있는 지표

바로 쓸 수 있다(모두 실제 계산값):

- 정기 매수 모의 실행 횟수, 조건 발생 횟수, 조건 실행/차단 횟수
- KRW 투자 금액 (정기/추가/합계), 월 최대 투자 금액
- 월별 집계 13개월 (투자 금액·횟수·예산 초과 여부)
- 예산 초과 개월 수 **+ 원인별 분해** (`recurring_only` / `conditional_action`)
- 조건 발생 후 최대 추가 하락 (%)
- 차트: 251개 포인트 + 이벤트 마커 (`eventIds` 로 이벤트 상세 연결)
- 이벤트 타임라인 59건 (Replay 생성 가능)

### 이번 실행에서 드러난 것 하나 → 엔진에 반영 완료

**예산 초과 4개월이 전부 정기 매수만으로 발생했다.** 월요일이 5번 있는 달(2025-09, 2025-12,
2026-03, 2026-06)은 50,000원 × 5 = 250,000원 > 200,000원이 된다. 추가 매수는 한 번도 관여하지
않았다(해당 4개월의 추가 매수 금액 0원).

`budgetExceededMonthCount` 만 보면 AI 가 추가 매수를 원인으로 잘못 설명할 수 있다. 원인을
추론하게 두지 않기 위해 **계산 필드를 추가했다**:

- `MonthlySimulationResult.budgetExceededCause` (`recurring_only` / `conditional_action` / `null`)
- `MonthlySimulationResult.recurringAloneExceededBudget`, `conditionalCausedBudgetExceed`
- `SimulationSummary.recurringOnlyBudgetExceededMonthCount`,
  `conditionalCausedBudgetExceededMonthCount`
- `monthly_budget_exceeded` 이벤트의 `cause`, 금액 분해, `triggeredByEventId`

이번 데이터에서는 `recurringOnly=4`, `conditional=0` 으로 계산됐다. AI 는 이 필드를 읽어
"추가 매수와 관계없이 정기 매수 일정만으로 예산을 넘은 달이 있었다"고 설명할 수 있다.

MVP 정책상 정기 매수는 월 예산으로 차단하지 않으므로 이 초과 자체는 계속 발생한다.

### 계산 결과가 없는 경우 UI 처리

- **조건 발생 0회**: 지표를 0으로 표시하고, "조건이 안전하다는 의미는 아니며 과거 작동 사례가
  부족해 판단이 제한될 수 있다"는 안내를 함께 낸다(USER_FLOW_V2 "시뮬레이션 조건 미발생" 참고).
- **`maxAdditionalDeclineAfterTriggerPercent === null`**: 조건 발생이 없거나 발생일 이후
  관찰 가능한 거래일이 없는 경우다. 0% 로 표시하지 않는다. "계산할 수 없음"으로 구분한다.
- **`reviewTriggeredCount === 0` + 재검토 기준 미설정**: "발생하지 않음"이 아니라
  "기준이 설정되지 않음"으로 표시한다. 두 상태는 의미가 다르다.
- **`completeness !== "complete"`**: 지표를 그대로 보여주되 데이터 범위가 짧다는 사실을
  화면에 명시한다. `insufficient` 면 분석을 진행하지 않는다.
- **adapter 실패(`MarketDataError`)**: 오류 코드와 사유를 화면에 그대로 노출한다.
  mock/fixture 로 대체하지 않는다.

## Limitations

- **fixed average cost** — 사용자가 입력한 평균 매수가를 고정 기준으로 쓴다. 매수가 발생해도
  갱신하지 않는다.
- **no quantity** — 실제 주식 수량을 계산하지 않는다.
- **no FX** — KRW 주문 금액과 USD 가격 사이 환율을 계산하지 않는다.
- **no dynamic average cost** — 가중평균 매수가를 계산하지 않는다(수량을 모르므로 불가).
- **close-only trigger** — 조건 판정과 모의 체결가 모두 일별 종가다. 장중에 임계선을 스쳤다가
  회복한 날은 조건 발생으로 보지 않는다.
- **no return calculation** — 수익률·투자 성과를 계산하지 않는다. 이 결과는 "얼마 벌었나"에
  답하지 않는다.
- **AAPL 단일 종목 검증** — 다른 종목·거래소는 검증하지 않았다.
- **단일 기간 검증** — 2025-07-28 ~ 2026-07-27 한 구간만 검증했다.
- **차단·재검토 경로는 live 데이터로 실행되지 않았다.** 이번 스모크 입력에서는 조건 발생이
  1회뿐이고(기간 중 AAPL 이 214 → 337 로 상승), 횟수 제한과 재검토 기준을 설정하지 않았다.
  `conditional_buy_blocked` 와 `review_triggered` 경로는 단위 테스트(23개)로만 검증된 상태다.
- **단일 latency 측정값** — 787ms 는 1회 측정이다. 재시도·rate limit 상황은 미측정이다.

## 재현 방법

```
npm run spike:simulation:live
```

출력에는 API 키와 요청 URL 이 포함되지 않는다.
