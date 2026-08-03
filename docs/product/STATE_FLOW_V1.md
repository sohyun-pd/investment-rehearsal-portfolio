# State Flow V1

세션 전체의 상태 전이와 실패 흐름을 확정한다. **구현 코드는 작성하지 않는다.**

- 화면 스펙: [`SCREEN_SPEC_V1.md`](./SCREEN_SPEC_V1.md)
- 데이터 계약: [`STRATEGY_SCHEMA_V2.md`](./STRATEGY_SCHEMA_V2.md)
- 계산 계약: [`build/SIMULATION_ENGINE_SPEC.md`](./build/SIMULATION_ENGINE_SPEC.md)
- 도구 계약: [`build/AGENT_TOOL_CONTRACT.md`](./build/AGENT_TOOL_CONTRACT.md)

---

## 0. 두 상태 체계 — 통합하지 않는다 (확정)

**두 체계는 서로 다른 것을 나타내며, 통합하지 않고 명시적 mapping 만 사용한다.**

| 체계 | 정의 위치 | 나타내는 것 |
| --- | --- | --- |
| **`AppFlowState`** (13개) | 이 문서 | **UI 흐름 전용.** 지금 어떤 화면을 어떤 모습으로 보여줄지 |
| **`PlanLifecycleStatus`** (15개) | `STRATEGY_SCHEMA_V2.md` §3 | **계획 데이터의 수명주기.** 계획이 어느 단계까지 확정됐는지 |

`AppFlowState` 는 로딩·재시도 같은 화면 사정을 담고, `PlanLifecycleStatus` 는 저장·복구되는
데이터의 상태를 담는다. 하나로 합치면 "로딩 중"이 계획 데이터에 기록되는 문제가 생긴다.

### Mapping

| `AppFlowState` | `PlanLifecycleStatus` |
| --- | --- |
| `idle` | `onboarding` · `collecting_intent` |
| `interpreting_intent` | (대응 없음 — 스키마는 별도 로딩 상태를 두지 않음) |
| `clarifying` | `needs_clarification` |
| `plan_ready` | `ready_for_review` |
| `plan_confirmed` | `awaiting_analysis_approval` |
| `loading_market_data` | `fetching_market_data` |
| `simulating` | `running_simulation` |
| `analysis_ready` | `generating_review` → `analysis_ready` |
| `generating_alternatives` | `collecting_revision` → `generating_alternatives` |
| `alternatives_ready` | `comparison_ready` |
| `revised_plan_selected` | `awaiting_final_approval` |
| `replaying_revised_plan` | (대응 없음) |
| `completed` | `mock_active` |
| (모든 실패) | `error` + `errors[]` |

`interpreting_intent` 와 `replaying_revised_plan` 은 화면 사정이므로 `PlanLifecycleStatus` 에
대응이 없다. 이 상태에서는 직전 lifecycle status 를 그대로 유지한다.

---

## 1. 전이 개요

```text
idle
 → interpreting_intent
 → clarifying            ⟲ (질문이 남아 있는 동안 자기 자신으로 반복)
 → plan_ready
 → plan_confirmed
 → loading_market_data
 → simulating
 → analysis_ready
 → generating_alternatives
 → alternatives_ready
 → revised_plan_selected
 → replaying_revised_plan
 → completed
```

역방향 전이(사용자 주도)는 §12 에 따로 정의한다.

---

## 2. `idle`

**진입 조건** — 세션 시작, 또는 `completed` 이후 `새 계획 시작`.

**화면** — Screen 1 (투자 생각 입력). 안내 문구 · 예시 질문 3개 · 입력창 · AI 고지.

**허용 행동** — 텍스트 입력, 예시 chip 탭, 전송.

**다음 상태** — `interpreting_intent` (전송 시)

**실패 상태** — 없음 (네트워크 호출 없음). 전송 실패는 `interpreting_intent` 에서 처리.

**재시도** — 해당 없음.

**유지 데이터** — `sessionId`, `createdAt`. 입력 중인 텍스트는 로컬 draft 로 보존.

---

## 3. `interpreting_intent`

**진입 조건** — 사용자가 투자 생각을 전송함. `plan.originalInput` 설정됨.

**화면** — Screen 2 의 로딩 형태. "말씀하신 내용을 정리하고 있어요" + 계획 카드 skeleton.

**허용 행동** — 취소(뒤로) 만. 재입력·수정 불가.

**다음 상태**

- `clarifying` — 부족한 필수 조건이 있을 때 (`plan.missingFields` 에 `required` 존재)
- `plan_ready` — 모든 필수 조건이 채워졌을 때

**실패 상태** — `error(stage: "conversation")` · `error(stage: "plan_structure")`
· `error(stage: "asset_resolution")`

**재시도** — 같은 `originalInput` 으로 재호출. 2회 실패 시 Screen 1 재입력으로 유도.

**유지 데이터** — `plan.originalInput`, `conversation.messages[]`.

---

## 4. `clarifying`

**진입 조건** — `conversation.currentQuestion !== null`.

**화면** — Screen 2. 계획 카드(접힘) + 질문 1개 + 선택지 + 직접 입력.

**허용 행동** — 선택지 탭, 직접 입력, 이전 질문으로, 선택 사항 건너뛰기(`required: false` 만).

**다음 상태**

- `clarifying` (자기 자신) — 남은 질문이 있을 때
- `plan_ready` — `missingFields` 의 `required` 가 비었을 때

**실패 상태** — `error(stage: "conversation")` · `error(stage: "plan_structure")`
· `error(stage: "asset_resolution")` (종목 질문에서만)

**재시도** — 질문 단위. **이미 답한 조건은 유지**하고 실패한 질문만 다시 받는다.

**유지 데이터** — `plan` 전체(누적 답변), `completedQuestionIds`, `skippedQuestionIds`,
`plan.assumptions[]`.

---

## 5. `plan_ready`

**진입 조건** — 필수 조건이 모두 채워지고 `plan.asset.resolutionStatus === "confirmed"`.

**화면** — Screen 3 (계획 확인). 질문형 요약 + 계획 카드 + 고정 평균 매수가 안내 + 분석 범위.

**허용 행동** — 조건 행별 `수정`(→ `clarifying` 해당 질문), 분석 승인.

**다음 상태** — `plan_confirmed` (CTA 탭)

**실패 상태** — 없음(호출 없음). 진입 시 필수 필드 누락이 발견되면 `clarifying` 으로 되돌린다.

**재시도** — 해당 없음.

**유지 데이터** — `plan`(확정본), `plan.version`.

---

## 6. `plan_confirmed`

**진입 조건** — 사용자가 분석을 승인함. `plan.userConfirmed = true`.

**화면** — 전환 상태. 별도 화면을 그리지 않고 즉시 `loading_market_data` 로 넘어간다.

**허용 행동** — 없음(순간 상태).

**다음 상태** — `loading_market_data`

**실패 상태** — 없음.

**재시도** — 해당 없음.

**유지 데이터** — 승인 시점 `plan` 스냅샷. **이후 화면의 모든 계산은 이 스냅샷 기준**이다.

> 이 스냅샷을 남기는 이유: 분석 이후 사용자가 계획을 수정해도 "무엇을 분석한 결과인지"가
> 흔들리지 않아야 한다(§12 case 9).

---

## 7. `loading_market_data`

**진입 조건** — 승인된 `plan` 스냅샷 존재.

**화면** — Screen 4 의 1단계 로딩. "최근 1년 가격을 가져오는 중이에요" + 계획 카드(접힘).

**허용 행동** — 취소(→ `plan_ready`).

**호출**

| 대상 | 용도 | 실패 시 |
| --- | --- | --- |
| **Twelve Data** `/time_series` | 과거 일봉 (`adjust=splits`) | **치명** — 분석 중단 |
| **Finnhub** quote | 현재가 | **비치명** — 시세 블록만 실패 표시 |

**다음 상태** — `simulating` (과거 일봉 확보 시)

**실패 상태** — `error(stage: "historical_data")` — `MarketDataError.code` 별 분기.
현재가 실패는 `error(stage: "market_quote")` 로 기록하되 **흐름을 막지 않는다.**

**재시도** — `retryable` 인 코드(`rate_limited`, `network_failure`, `credits_exceeded`)만
재시도 버튼 노출. `unauthorized` · `forbidden_or_plan_restriction` 은 재시도 불가로 표시.

**유지 데이터** — `plan` 스냅샷, 부분 성공한 `marketData.quote`.

---

## 8. `simulating`

**진입 조건** — `candles` 확보. `completeness !== "insufficient"`.

**화면** — Screen 4 의 2단계 로딩. "조건이 발생한 시점을 찾고 있어요".

**허용 행동** — 없음(로컬 계산, 즉시 완료).

**다음 상태** — `analysis_ready`

**실패 상태** — `error(stage: "simulation")` — `SimulationInputError.code` 로 원인 지목.

**재시도** — 입력 오류이므로 **재시도가 아니라 `plan_ready` 로 되돌린다.**
같은 입력으로 다시 돌려도 같은 실패가 나온다(엔진은 결정적).

**유지 데이터** — `marketData`(candles 포함). **재계산 시 다시 조회하지 않는다.**

---

## 9. `analysis_ready`

**진입 조건** — `simulation !== null`.

**화면** — Screen 4. 결론 + 지표 + 차트 + 원인 + 기준 + 한계.

**허용 행동** — 차트 마커 탭(사건 상세), 월별 요약 펼치기, 계획 조정 요청, 조건 직접 수정.

**다음 상태**

- `generating_alternatives` — 수정 요청 전송 시
- `plan_ready` — 조건 직접 수정 선택 시(재분석 필요, §15.9)

**실패 상태** — `error(stage: "ai_review")` — **결과는 유지하고 결론 문장만 실패 표시.**

**재시도** — AI 결론만 재호출. 지표·차트는 재계산하지 않는다.

**유지 데이터** — `marketData`, `simulation`, `aiReview`, `plan` 스냅샷.

---

## 10. `generating_alternatives`

**진입 조건** — `revisionRequest` 생성됨(사용자 수정 요청 해석 완료).

**화면** — Screen 5 로딩. "조건을 만족하는 계획을 찾고 있어요" + 카드 skeleton.

**허용 행동** — 취소(→ `analysis_ready`).

**처리 순서**

```text
1. Claude — 수정 요청에서 유지/변경 제약 추출 (RevisionRequest)
2. Claude — 대안 계획 후보 생성 (PlanAlternative.plan)
3. simulation engine — 각 후보를 **Screen 4 와 동일한 candles** 로 재계산
4. 제약 충족 여부 판정 (satisfiesUserConstraints, constraintViolations)
```

**다음 상태** — `alternatives_ready`

**실패 상태** — `error(stage: "alternative_generation")`

**재시도** — 대안 생성만 재시도. **market data 재조회 없음.**

**유지 데이터** — `marketData.candles`(재사용 필수), 원본 `simulation`, `revisionRequest`.

---

## 11. `alternatives_ready`

**진입 조건** — `alternatives.length >= 1`, 각 대안에 `simulation` 존재.

**화면** — Screen 5. 수정 요청 요약 + 계획 카드 3장 + 지표별 비교 목록.

**허용 행동** — 계획 선택, 분석 결과 다시 보기, 조건 직접 고치기.

**다음 상태** — `revised_plan_selected` (선택 시)

**실패 상태** — 개별 대안 계산 실패는 **그 카드만 비활성**. 전체 실패가 아니다.

**재시도** — 실패한 대안만 재생성.

**유지 데이터** — `alternatives[]`, `selectedAlternativeId`, `marketData.candles`.

---

## 12. `revised_plan_selected`

**진입 조건** — `selectedAlternativeId !== null` (현재 계획 유지도 선택으로 취급).

**화면** — Screen 5 의 선택 확정 상태. 선택 카드 강조 + 승인 고지 + CTA 활성.

**허용 행동** — 선택 변경, 승인.

**다음 상태** — `replaying_revised_plan` (승인 시)

**실패 상태** — 없음.

**재시도** — 해당 없음.

**유지 데이터** — 선택된 `plan`, 그 `simulation`.

---

## 13. `replaying_revised_plan`

**진입 조건** — 사용자가 최종 승인함.

**화면** — **새 화면을 만들지 않는다. Screen 4 결과 레이아웃을 재사용한다.**

- 상단에 **변경 전/후 비교 요약**을 추가한다
- 지표·차트는 **수정안 기준 `simulation`** 으로 표시한다
- 나머지 구성(결론 · 지표 · 차트 · 원인 · 기준 · 한계)은 Screen 4 와 동일

**허용 행동** — 결과 확인, 완료로 진행.

**다음 상태** — `completed`

**실패 상태** — 네트워크 호출이 없다. 이미 계산된 `simulation` 을 보여줄 뿐이다.

**재시도** — 해당 없음.

**유지 데이터** — 최종 `plan`, 그 `simulation`, 비교용 **직전 계획의 `simulation`**.

> **새로 계산하지 않는다.** 대안은 `generating_alternatives` 에서 이미 계산됐다.
> 변경 전/후 비교 요약도 두 `SimulationResult` 를 읽어 만든다.

---

## 14. `completed`

**진입 조건** — 최종 계획 승인 완료.

**화면** — 완료 화면. 최종 조건 요약 + 모의 실행 안내 + 계산 기준.

**허용 행동** — 계획 다시 보기, 새 계획 시작.

**다음 상태** — `idle` (새 계획 시작 시)

**실패 상태** — 없음.

**재시도** — 해당 없음.

**유지 데이터** — 최종 `plan`, `simulation`, `engineVersion`, `calculatedAt`, `marketData` 기준 정보.

---

## 15. 실패 흐름

공통 원칙 4가지.

1. **부분 실패를 전체 실패로 만들지 않는다.** 계산이 살아 있으면 계산을 보여준다.
2. **실패해도 `plan` 을 잃지 않는다.** 사용자가 입력한 조건은 항상 보존한다.
3. **mock·fixture 로 대체하지 않는다.** 실패는 실패로 표시한다.
4. **재시도 가능 여부를 화면에 명시한다.** `ProductError.retryable` 로 버튼 노출을 결정한다.

### 15.1 Claude 응답 실패

| 항목 | 내용 |
| --- | --- |
| 발생 상태 | `interpreting_intent` · `clarifying` · `analysis_ready`(리뷰) · `generating_alternatives` |
| `ProductError.stage` | `conversation` / `ai_review` / `alternative_generation` |
| 화면 | 해당 영역에만 `ErrorPanel`. 계획 카드·지표·차트는 유지 |
| 복구 | 같은 입력으로 재시도 (`retryable: true`) |
| 2회 실패 | 수동 경로 제공 — `직접 입력할게요` / `조건 직접 고치기` |
| 보존 | `plan`, `conversation.messages[]`, `simulation` |

### 15.2 structured parsing 실패

Claude 가 응답했지만 스키마에 맞지 않는 경우.

| 항목 | 내용 |
| --- | --- |
| `ProductError.stage` | `plan_structure` |
| 화면 | "이해한 내용을 정리하지 못했어요" |
| 복구 | 1회 재요청 → 실패 시 사용자에게 다시 말하도록 유도 |
| 금지 | **부분 파싱 결과를 추정으로 채우지 않는다.** 누락 필드는 `missingFields` 로 남긴다 |
| 보존 | 직전까지 확정된 `plan` |

### 15.3 종목 검색 실패 (Finnhub)

| 항목 | 내용 |
| --- | --- |
| `ProductError.stage` | `asset_resolution` |
| 화면 | 종목 질문 영역만 오류. 다른 조건은 그대로 |
| 결과 0건 | `resolutionStatus: "not_found"` — "그 이름으로 종목을 찾지 못했어요" |
| 후보 다수 | `candidates[]` 를 선택지로 노출 (실패 아님) |
| 복구 | 재검색 또는 티커 직접 입력 |
| 차단 | 종목 미확정이면 `plan_ready` 로 진행 불가 |

### 15.4 현재가 조회 실패 (Finnhub quote)

| 항목 | 내용 |
| --- | --- |
| `ProductError.stage` | `market_quote` |
| 심각도 | **비치명** |
| 화면 | Screen 4 시세 블록만 "현재가를 불러오지 못했어요". **분석은 계속 진행** |
| 이유 | 시뮬레이션은 과거 일봉만 사용한다. 현재가는 참고 정보다 |
| 복구 | 시세 블록 내 재시도 |

### 15.5 historical candle 조회 실패 (Twelve Data)

| 항목 | 내용 |
| --- | --- |
| `ProductError.stage` | `historical_data` |
| 심각도 | **치명** — 분석 불가 |
| 화면 | Screen 4 전체 오류 화면 |

`MarketDataError.code` 별 처리:

| code | 재시도 | 문구 방향 |
| --- | --- | --- |
| `network_failure` | O | 연결 문제 — 다시 시도 |
| `rate_limited` | O (지연 후) | 잠시 후 다시 시도 |
| `credits_exceeded` | O (지연 후) | 오늘 조회 한도 초과 |
| `unauthorized` · `forbidden_or_plan_restriction` | X | 데이터 이용 권한 문제 — 재시도 불가 명시 |
| `no_data` | X | 해당 기간 데이터 없음 — 종목/기간 확인 |
| `malformed_response` · `invalid_request` | X | 데이터를 읽지 못함 |
| `api_key_missing` | X | 설정 문제 (사용자 화면에는 일반 문구) |

`completeness` 처리:

- `insufficient` → **분석 중단.** "확인 가능한 기간이 부족해 분석을 진행할 수 없어요"
- `partial` → 결과 노출 + 상단에 기간 부족 안내
- `complete` → 정상

**mock·fixture·Finnhub 과거 데이터로 대체하지 않는다.**

### 15.6 simulation engine 실패

| 항목 | 내용 |
| --- | --- |
| `ProductError.stage` | `simulation` |
| 원인 | `SimulationInputError` (입력 검증) 또는 예기치 못한 예외 |
| 화면 | 어떤 입력이 문제인지 **지목**한다 |
| 복구 | 재시도가 아니라 **`plan_ready` 로 되돌린다** (엔진은 결정적이므로 재시도가 무의미) |
| 보존 | `marketData` — 조건 수정 후 **재조회 없이** 재계산 |

주요 코드 → 되돌릴 화면 위치:

| code | 안내 |
| --- | --- |
| `invalid_average_cost` · `invalid_threshold_percent` | 조건부 매수 행 |
| `invalid_recurring_amount` · `invalid_conditional_amount` | 해당 금액 행 |
| `invalid_monthly_budget` · `invalid_max_conditional_executions` · `invalid_review_drawdown_percent` | 안전장치 행 |
| `review_requires_average_cost` | 재검토 조건 행 — 평균 매수가 필요 안내 |
| `empty_candles` · `candles_not_ascending` · `duplicate_candle_date` · `invalid_candle` | 데이터 문제 — `historical_data` 재조회로 유도 |

### 15.7 대안 생성 실패

| 항목 | 내용 |
| --- | --- |
| `ProductError.stage` | `alternative_generation` |
| 화면 | Screen 5 오류. **Screen 4 분석 결과는 유지** |
| 부분 실패 | 일부 대안만 실패하면 그 카드만 비활성. 나머지는 비교 가능 |
| 제약 미충족 | 실패가 아니다. `satisfiesUserConstraints: false` + `constraintViolations[]` 노출 |
| 복구 | 재생성 / `조건 직접 고치기`(→ `plan_ready`) |
| 보존 | `simulation`, `marketData.candles` |

### 15.8 사용자가 입력 도중 뒤로가기

| 출발 상태 | 동작 |
| --- | --- |
| `clarifying` | 이전 질문으로. **답변은 보존**하고 수정 가능 |
| `clarifying` 첫 질문에서 뒤로 | `idle` 로. `originalInput` 을 입력창에 복원 |
| `plan_ready` | `clarifying` 마지막 질문으로 |
| `loading_market_data` · `simulating` | 호출 취소 → `plan_ready`. **부분 데이터 폐기** |
| `analysis_ready` | 이탈 경고 없음. `plan_ready` 로 이동하되 `simulation` 은 보존 |
| `generating_alternatives` | 취소 → `analysis_ready` |
| `alternatives_ready` | `analysis_ready` 로. `alternatives[]` 보존 |

**원칙** — 뒤로가기로 **사용자가 입력한 값을 잃지 않는다.** 계산 결과는 무효화될 수 있지만
입력은 남는다.

### 15.9 사용자가 분석 후 계획을 직접 수정

가장 주의가 필요한 흐름이다. **분석 결과와 계획이 어긋난 상태**가 생긴다.

| 항목 | 내용 |
| --- | --- |
| 진입 | `analysis_ready` · `alternatives_ready` 에서 `조건 직접 고치기` |
| 전이 | → `plan_ready` (수정) → `plan_confirmed` → `simulating` |
| 무효화 | `simulation`, `aiReview`, `alternatives[]`, `selectedAlternativeId` 를 **무효 표시** |
| 재조회 | **하지 않는다.** `marketData.candles` 를 재사용해 재계산만 한다 |
| 화면 | 수정 시점에 "조건을 바꾸면 분석 결과를 다시 계산해요" 안내 |
| 금지 | 옛 `simulation` 숫자를 새 `plan` 옆에 함께 노출 |

`plan.version` 을 올리고, 결과 화면에는 계산에 쓰인 `plan.version` 을 함께 보관한다.
**둘이 다르면 결과를 "이전 계획 기준"으로 표시하거나 재계산한다.**

### 15.10 새로고침 또는 세션 복구

**저장 매체 (확정)**

| 데이터 | 위치 |
| --- | --- |
| `plan`, 사용자 입력, `conversation`, `status`, `selectedAlternativeId` | **`sessionStorage`** |
| `candles`, `quote` | **앱 메모리 / query cache** (저장하지 않음) |
| 서버 세션 · DB | **사용하지 않는다** |

**새로고침 시 — `plan` 을 복구한 뒤 market data 를 재조회한다.**

| 항목 | 내용 |
| --- | --- |
| 저장 대상 | `sessionId`, `plan`, `conversation`, `status`, `selectedAlternativeId` |
| 저장 제외 | `marketData`(candles·quote), `simulation`, `alternatives`, 로딩 중 부분 상태 |
| 복구 정책 | 상태별로 다르게 처리한다 |

| 저장된 상태 | 복구 후 |
| --- | --- |
| `idle` · `clarifying` · `plan_ready` | 그대로 복구 |
| `interpreting_intent` · `generating_alternatives` | 직전 안정 상태로 되돌림 (`idle` / `analysis_ready`) |
| `loading_market_data` · `simulating` | `plan_ready` 로 되돌림 |
| `analysis_ready` 이후 | **candles 없이 복구 불가** → `plan_confirmed` 부터 다시 (계획은 유지, market data 재조회) |
| `completed` | 최종 계획 요약만 복구. 차트·이벤트는 재조회 + 재계산 필요 |

**금지** — 저장된 옛 `simulation` 숫자를 재계산 없이 화면에 다시 노출하는 것.
`engineVersion` 이 다르면 반드시 재계산한다.

---

## 16. 상태별 데이터 보존 요약

| 데이터 | 언제 만들어지고 언제까지 유지되나 |
| --- | --- |
| `plan.originalInput` | `idle` 전송 시 → 세션 끝까지 |
| `plan` | `interpreting_intent` 부터 누적 → 세션 끝까지. **어떤 실패에도 잃지 않는다** |
| `plan` 스냅샷 + `version` | `plan_confirmed` 시 고정 → 결과 화면의 기준 |
| `marketData.quote` | `loading_market_data` → `analysis_ready` 표시용 |
| `marketData.candles` | `loading_market_data` → **`alternatives_ready` 까지 재사용.** 재조회 금지 |
| `simulation` | `simulating` → 계획 수정 시 무효화 |
| `aiReview` | `analysis_ready` → 계획 수정 시 무효화 |
| `alternatives[]` | `alternatives_ready` → 계획 수정 시 무효화 |
| `errors[]` | 누적 기록. 화면에는 해당 stage 의 최신 것만 노출 |

---

## 17. 제품 원칙 체크 (전 상태 공통)

| 원칙 | 이 문서에서의 반영 |
| --- | --- |
| Chat 은 입력·수정에만 | `idle` · `clarifying` · 수정 요청에서만 대화 사용. 결과 상태에는 대화 없음 |
| 계획은 structured plan card 로 유지 | `interpreting_intent` 이후 모든 상태에서 `PlanCard` 노출 |
| 분석 숫자는 AI 가 만들지 않음 | `simulating` 산출물만 지표로 사용. `ai_review` 실패해도 숫자는 남음 |
| `budgetExceededCause` 문구는 simulation result 로 결정 | `analysis_ready` 원인 문장 분기 근거 |
| 차트는 Screen 4 에서만 | `analysis_ready` 상태에서만 차트 렌더 |
| 차트는 종가 1선 + 사건 마커 | `chartSeries[]` 의 `closePrice` + `has*` 플래그만 사용 |
| 수익률·예상 수익·평균단가 변화 미표시 | 어떤 상태에서도 해당 필드를 만들지 않음 (엔진에 존재하지 않음) |
| 자사 UX Baseline 우선 | 로딩·오류·CTA 문구를 자사 기준(질문형·이유 명시)으로 |
| Composer 노드 UI 미사용 | 계획 표현은 카드 1장. 트리·캔버스 상태 없음 |
| 화면당 primary CTA 하나 | 각 상태의 허용 행동에서 주 행동 1개 + 나머지는 텍스트 링크 |

---

## 18. 구현 결정 (확정)

| # | 항목 | 결정 |
| --- | --- | --- |
| 1 | 상태 체계 | **통합하지 않는다.** `AppFlowState`(13, UI 전용) + `PlanLifecycleStatus`(15, 데이터) + 명시적 mapping (§0) |
| 2 | `MarketDataSource` | 용도별 분리 — `symbolSearch: finnhub` / `quote: finnhub` / `historicalCandles: twelve_data` |
| 3 | 데이터 보존 | `plan`·사용자 입력 → `sessionStorage` / `candles`·`quote` → 메모리·query cache / 새로고침 시 plan 복구 후 재조회 / **서버 세션·DB 미사용** |
| 4 | API 경계 | Finnhub·Twelve Data 는 **반드시 server/BFF 경유**. 브라우저 번들에 API key 미포함 |
| 5 | 결과 로딩 | simulation 결과·차트는 계산 완료 즉시 표시. **AI 해석 문장은 별도 생성**하며 실패해도 결과 화면을 막지 않음 |
| 6 | 대안 | **2개 고정.** 값은 TypeScript 규칙으로 계산, AI 는 trade-off 설명에만 사용 (§19) |
| 7 | Screen 5 secondary | **"현재 계획 유지"** — 기존 plan 을 그대로 `completed` 처리, **재시뮬레이션 안 함** |
| 8 | revised plan replay | 새 화면 없음. **Screen 4 레이아웃 재사용** + 상단 변경 전/후 비교 요약 (§13) |

---

## 19. 대안 생성 규칙 (확정)

**대안은 2개 고정이며 값은 TypeScript 규칙으로 계산한다. AI 는 trade-off 설명 문장만 만든다.**

### 엔진 정책 전제 (이 규칙의 근거)

```text
1. conditional action 은 **실행 시점의 월 누적 금액만** 확인한다.
   그 달에 남아 있는 recurring amount 를 미리 예약하지 않는다.
2. recurring action 은 **월 예산을 넘어도 차단하지 않는다.**
```

따라서 정기 매수만으로 예산을 꽉 채우는 안은, 조건부 매수가 그 달의 정기 매수보다 **먼저**
실행되면 월 합계가 예산을 넘을 수 있다. 이는 엔진 결함이 아니라 현재 정책상 가능한 결과다.

### Alternative A — 정기 일정 우선

```text
weekly recurring amount = 40,000 KRW
→ 월요일이 5번인 달의 정기 매수 200,000 KRW (예산과 동일)
budgetPosture = may_exceed
```

- 정기 일정을 그대로 유지한다.
- **조건부 매수 시점과 이후 정기 일정에 따라 월 예산을 초과할 수 있다.**
- **월 예산 준수안이라고 표현하지 않는다.** 화면 라벨은 `예산 초과 가능`.

### Alternative B — 월 예산 우선

```text
weekly recurring amount = 35,000 KRW
→ 5주 정기 매수 175,000 KRW
+ conditional 20,000 KRW = 최대 195,000 KRW
budgetPosture = within_budget
```

- 정기 매수와 조건부 매수를 합쳐도 예산 안에 들어오도록 금액을 잡는다.
- 현재 시나리오 기준 **최대 195,000원 · 초과 0개월**.
- 화면 라벨은 `월 예산 이내`.

### 규칙

- 각 대안의 지표는 **Screen 4 와 동일한 candles 로 재계산**한다.
- 조정안은 조정안 정책(`block_action_when_exceeded`)으로 계산한다.
- **AI 는 숫자를 만들지 않는다.** `explanation` 문장만 생성한다.
- 예산 준수 여부는 **규칙의 성질**(`budgetPosture`)로 표시한다. 특정 시나리오 결과를
  준수 근거로 쓰지 않는다.
