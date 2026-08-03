# Screen Spec V1

5개 화면의 와이어프레임 구조를 확정한다. **UI 코드는 작성하지 않는다.**

- 디자인 방향: [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md)
- 상태 전이: [`STATE_FLOW_V1.md`](./STATE_FLOW_V1.md)
- 데이터 계약: [`STRATEGY_SCHEMA_V2.md`](./STRATEGY_SCHEMA_V2.md)
- 계산 계약: [`build/SIMULATION_ENGINE_SPEC.md`](./build/SIMULATION_ENGINE_SPEC.md)
- 도구 계약: [`build/AGENT_TOOL_CONTRACT.md`](./build/AGENT_TOOL_CONTRACT.md)

---

## 전 화면 공통 규칙

이 규칙은 개별 화면 스펙보다 우선한다.

1. **Chat 은 투자 생각 입력과 수정에만 사용한다.** 지표·차트·계획을 채팅 말풍선에 넣지 않는다.
2. **계획은 항상 structured plan card 로 유지한다.** 대화는 지나가고 카드는 남는다.
3. **분석 결과 숫자는 AI 가 만들지 않는다.** 모든 수치는 simulation engine 계산값이다.
4. **`budgetExceededCause` 관련 문구는 simulation result 에서 결정한다.** AI 가 원인을 추론하지 않는다.
5. **차트는 Screen 4 에서만 노출한다.**
6. **차트는 종가 1선 + 사건 마커만 사용한다.** 거래량·이동평균·다축·캔들 없음.
7. **수익률, 예상 수익, 평균단가 변화를 표시하지 않는다.**
8. **화면 톤이 [`DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) 와 충돌하면 그 문서를 우선한다.**
9. **Composer 의 노드 UI 와 비주얼은 사용하지 않는다.**
10. **화면마다 primary CTA 는 하나다.**
11. **API 는 반드시 server/BFF 를 통해 호출한다.** 브라우저 번들에 API key 가 포함되지 않는다.
12. **`plan` 과 사용자 입력은 `sessionStorage`, `candles`·`quote` 는 메모리/query cache** 에 둔다.
    서버 세션과 DB 는 사용하지 않는다.
### Self-Review Checklist

- 3초 안에 화면의 핵심 목적과 결과가 보이는가
- 다음 행동이 하나로 명확한가
- 대화가 아니라 실행 가능한 제품 상태로 전환되는가
- 실제 데이터와 AI 설명이 구분되는가
- 로딩·오류·빈 상태·재시도가 설계되어 있는가
- 기존 국내 증권 앱에 자연스럽게 녹아드는가
### 공통 컴포넌트

| 컴포넌트 | 규칙 |
| --- | --- |
| `PlanCard` | Screen 2–5 에서 유지. 접힘/펼침 2단계. 조건 행마다 수정 텍스트 링크 |
| `AiBadge` | `✦ AI 해석` + 기준 시각. AI 가 쓴 문장에만 붙는다 |
| `BasisLabel` | 섹션 제목 우측 회색 기준 라벨 (`최근 1년 종가 기준` 등) |
| `PrimaryCta` | 하단 고정. 비활성 시 **활성 조건을 문장으로** 표시 |
| `NoticeLine` | ⓘ + 한 줄. 결과 옆에 배치 |
| `ErrorPanel` | `ProductError.userMessage` 노출 + `retryable` 이면 재시도 |

### 공통 Non-goals

- 실제 주문·체결
- 수익률·예상 수익·평균단가 변화 표시
- 포트폴리오·보유 종목·계좌 잔고
- 종목 추천, 매수 시점 추천
- 뉴스·커뮤니티·토론

---

## Screen 1. 투자 생각 입력

### Screen Goal

사용자가 **막연한 투자 생각을 한 문장으로 꺼내 놓는 것**. 조건을 완성할 필요는 없다.

### Entry Condition

- `status = "onboarding"` 또는 `"collecting_intent"`
- `plan.originalInput` 이 비어 있음
- 세션 최초 진입 또는 새 계획 시작

### Layout Order

```text
1. 안내 문구 (1–2줄)
2. 예시 질문 chip 3개 (세로)
3. (여백)
4. AI 입력창 — 하단 고정
5. AI 고지 한 줄 — 입력창 바로 위
```

### Required Components

- `IntroCopy`
- `ExampleQuestionChip` × 3 (탭 → 입력창에 텍스트 채움, 자동 전송 안 함)
- `ChatInput` (multiline, placeholder 질문형)
- `AiNotice`
- `PrimaryCta` (전송 — 입력창 내부 버튼)

### Primary CTA

**입력 전송**

### Secondary Action

없음. (예시 chip 은 입력 보조이지 별도 행동이 아니다)

### Data Source

- **사용자 입력** — 자유 텍스트

이 화면은 API 를 호출하지 않는다. 전송 시점에 Claude 호출이 시작된다.

### Required Fields

| 필드 | 출처 |
| --- | --- |
| `plan.originalInput` | 사용자 입력 |
| `conversation.messages[]` | 사용자 메시지 1건 추가 |
| `status` | `collecting_intent` → `interpreting_intent` |

### Loading State

전송 직후 **화면 전환 없이** 입력창이 잠기고 `해석 중` 표시.
`interpreting_intent` 진입과 동시에 Screen 2 로 이동한다(로딩은 Screen 2 가 받는다).

### Empty State

입력 전 기본 상태가 곧 empty state 다. 빈 화면을 따로 두지 않는다.
예시 chip 이 empty state 의 역할을 한다.

### Error State

- 입력 길이 초과: 인라인 카운터 + 전송 비활성
- 네트워크 오류: 입력 내용을 **지우지 않고** 유지 + `다시 보내기`

### Validation

| 조건 | 결과 |
| --- | --- |
| 공백 제외 2자 미만 | CTA 비활성 — "투자 생각을 한 문장으로 적어주세요" |
| 500자 초과 | CTA 비활성 — "500자 안에서 적어주세요" |
| 그 외 | CTA 활성 |

### Copy

```text
[안내]
어떻게 투자하고 싶은지 편하게 알려주세요.
조건이 완성되지 않아도 괜찮아요.

[예시 chip]
애플을 매주 조금씩 사고 싶어요
가격이 떨어질 때 더 사고 싶어요
한 달에 20만 원 넘게 쓰고 싶지 않아요

[입력창 placeholder]
어떤 투자를 생각하고 계신가요?

[AI 고지]
AI가 이해한 내용을 다음 화면에서 직접 확인하고 고칠 수 있어요.

[CTA 비활성]
투자 생각을 한 문장으로 적어주세요
```

### Non-goals

- 종목 검색 UI
- 조건 입력 폼
- 시세·차트
- 로그인·계좌 연결

---

## Screen 2. 계획 구체화

### Screen Goal

**부족한 조건 하나에 답하는 것.** 한 화면에 질문 하나.

### Entry Condition

- `status = "needs_clarification"` (전이 상태 `clarifying`)
- `conversation.currentQuestion !== null`
- 또는 `interpreting_intent` 로딩 중 진입 (질문 준비 전)

### Layout Order

```text
1. 계획 카드 — 접힌 1줄 요약 (상단 고정, 탭하면 펼침)
2. 남은 질문 안내 ("2개만 더 여쭤볼게요")
3. AI 질문 (큰 글씨 한 문장)
4. 질문 이유 한 줄 (회색)
5. 선택형 응답 (ClarificationOption chip / 큰 버튼)
6. 직접 입력 — 텍스트 링크로 열기
7. (하단) 이전 질문으로
```

### Required Components

- `PlanCard` (collapsed)
- `ProgressCopy`
- `QuestionText`
- `QuestionReason`
- `OptionButton[]` (`ClarificationOption`)
- `DirectInputLink` → `ClarificationInput` (`inputType` 별 키패드)
- `PrimaryCta` (선택 즉시 진행 또는 직접 입력 확인)

### Primary CTA

**답변 선택 또는 입력**

- 선택형: 옵션 탭 = 즉시 다음 질문 (별도 CTA 버튼 없음)
- 직접 입력: 하단 고정 CTA `확인`

### Secondary Action

- `직접 입력할게요` (텍스트 링크)
- `이전 질문으로` (텍스트 링크)

### Data Source

- **Claude structured output** — `ClarificationQuestion`, `ClarificationOption`, `QuickReply`
- **사용자 입력** — 선택 또는 직접 입력
- **Finnhub** — 종목 질문일 때만 `AssetCandidate[]` (symbol search)

### Required Fields

| 필드 | 출처 |
| --- | --- |
| `conversation.currentQuestion` | Claude |
| `currentQuestion.fieldPath` · `question` · `reason` · `inputType` · `options` · `validation` | Claude |
| `conversation.completedQuestionIds` | 앱 |
| `plan.missingFields[]` | Claude |
| `plan.asset.candidates[]` · `resolutionStatus` | Finnhub |
| `plan.recurringAction` · `conditionalActions[]` · `guardrails` | 누적 입력 |
| `plan.assumptions[]` | Claude (가정한 값 표시) |

### Loading State

- **질문 준비 중**(`interpreting_intent`): 계획 카드 skeleton + "말씀하신 내용을 정리하고 있어요"
- **답변 전송 중**: 선택한 옵션만 활성 표시, 나머지 비활성. 화면 전환 없음
- **종목 검색 중**: 옵션 자리에 skeleton 3줄

### Empty State

- 질문이 하나도 없으면 이 화면을 건너뛰고 Screen 3 으로 간다
- 종목 검색 결과 0건: "그 이름으로 종목을 찾지 못했어요" + 재입력

### Error State

| 실패 | 화면 |
| --- | --- |
| Claude 응답 실패 | 질문 영역에 `ErrorPanel` + `다시 시도` (계획 카드 유지) |
| structured parsing 실패 | "이해한 내용을 정리하지 못했어요" + `다시 말해볼게요`(Screen 1 재입력) |
| 종목 검색 실패 | 종목 질문만 오류 + 직접 티커 입력 fallback |

**모든 오류에서 `plan` 은 유지한다.** 이미 답한 조건을 잃지 않는다.

### Validation

- `currentQuestion.validation` (`min`/`max`/`integerOnly`/`allowedValues`) 를 그대로 적용
- 금액: 0 이하 거부 — "0보다 큰 금액을 입력해주세요"
- 하락률: 0 초과 100 미만 — "0보다 크고 100보다 작은 값을 입력해주세요"
  (엔진 `invalid_threshold_percent` 와 동일 기준)
- 필수 질문은 건너뛸 수 없음. `required: false` 만 `나중에 정할게요` 노출

### Copy

```text
[진행]
2개만 더 여쭤볼게요

[질문 예시]
평균 매수가를 알려주세요
[이유] 얼마나 떨어졌을 때 더 살지 계산하는 기준이에요

[직접 입력]
직접 입력할게요

[선택 안 함]
나중에 정할게요

[오류]
이해한 내용을 정리하지 못했어요. 다시 한 번 말씀해주시겠어요?
```

### Non-goals

- 여러 질문 동시 노출
- 자유 대화 (질문 외 잡담 응답)
- 차트·시세·분석 결과
- 조건 삭제/추가 (Screen 3 에서)

---

## Screen 3. 계획 확인

### Screen Goal

**구조화된 조건이 내 의도와 맞는지 확인하고 분석을 승인하는 것.**

### Entry Condition

- `status = "ready_for_review"` 또는 `"awaiting_analysis_approval"` (전이 상태 `plan_ready`)
- `plan.missingFields` 에 `required` 항목 없음
- `plan.asset.resolutionStatus = "confirmed"`

### Layout Order

```text
1. 질문형 요약 한 문장
2. 종목 (로고 · 종목명 · 티커)
3. 계획 카드
   - 정기 매수 (주기 · 요일 · 금액)
   - 조건부 매수 (기준가 · 하락률 · 금액)
   - 월 예산
   - 재검토 조건
4. 고정 평균 매수가 안내 ⓘ — 조건부 매수 행 바로 아래
5. AI 가정 목록 (있을 때만)
6. 분석 범위 안내 (기간 · 데이터 출처)
7. PrimaryCta — 하단 고정
```

### Required Components

- `SummaryQuestion`
- `AssetRow`
- `PlanCard` (expanded, 행마다 `수정` 텍스트 링크)
- `NoticeLine` (고정 평균 매수가)
- `AssumptionList`
- `ScopeNotice`
- `PrimaryCta`

### Primary CTA

**최근 1년 가격에 적용해보기**

### Secondary Action

- 조건 행별 `수정` (텍스트 링크 → Screen 2 해당 질문)
- `조건 추가` — MVP 범위 밖. **노출하지 않는다.**

### Data Source

- **사용자 입력 + Claude structured output** — `InvestmentPlan` 전체
- **Finnhub** — `plan.asset` (symbol search 결과), 현재가는 이 화면에서 **호출하지 않는다**

> 현재가는 Screen 4 의 시장 데이터 블록에서만 쓴다. 이 화면에서 시세를 보여주면
> "지금 사는 것"으로 오해될 수 있다.

### Required Fields

| 필드 | 표시 |
| --- | --- |
| `plan.asset.symbol` · `companyName` | 종목 행 |
| `plan.recurringAction.frequency` · `weekday` · `amount` | 정기 매수 |
| `plan.conditionalActions[].priceReference` · `trigger.thresholdPercent` · `amount` | 조건부 매수 |
| `plan.guardrails.monthlyBudget` | 월 예산 |
| `plan.guardrails.maxConditionalExecutionsPerMonth` | 추가 매수 횟수 |
| `plan.guardrails.reviewTrigger` | 재검토 조건 |
| `plan.assumptions[]` | AI 가정 목록 |
| `plan.version` | 내부 추적 |

### Loading State

없음. 진입 시점에 모든 값이 확정되어 있다.
CTA 탭 후에는 즉시 `loading_market_data` 로 전이하며 Screen 4 가 로딩을 받는다.

### Empty State

- 조건부 매수 없음: 해당 행에 "설정하지 않음" + `추가할까요?` 링크 대신 **회색 텍스트만**
- 안전장치 미설정: "설정하지 않음" 으로 표시하고 **경고하지 않는다**
  (위험은 Screen 4 에서 계산 결과로 설명한다)

### Error State

- 진입 시 `required` 필드 누락 발견 → Screen 2 로 되돌리고 해당 질문 재노출
- 종목 미확정(`resolutionStatus !== "confirmed"`) → 종목 행에 오류 + 재검색

### Validation

CTA 활성 조건:

- `plan.asset.resolutionStatus === "confirmed"`
- `plan.recurringAction !== null` 또는 `conditionalActions.length > 0` (최소 하나)
- 조건부 매수가 있으면 `priceReference.price > 0` 이고 `thresholdPercent` 가 0 초과 100 미만

비활성 문구는 **부족한 것을 지목**한다: "평균 매수가를 입력하면 확인할 수 있어요"

### Copy

```text
[요약]
이 조건으로 최근 1년을 확인해볼까요?

[정기 매수]
매주 월요일 50,000원

[조건부 매수]
평균 매수가보다 3% 떨어지면 20,000원

[고정 평균 매수가 안내]
ⓘ 입력한 평균 매수가를 고정 기준으로 사용해요.
   추가 매수가 일어나도 기준가는 바뀌지 않아요.

[분석 범위]
최근 1년 일별 종가에 이 조건을 적용해 조건이 발생한 시점을 확인해요.
실제 체결 수량, 환율, 평균 매수가 변화는 반영하지 않아요.

[CTA]
최근 1년 가격에 적용해보기

[CTA 비활성]
평균 매수가를 입력하면 확인할 수 있어요
```

### Non-goals

- 현재가·시세 표시
- 차트
- 예상 수익 계산
- 조건 추가/삭제
- 실제 주문

---

## Screen 4. Historical Condition Replay 결과

### Screen Goal

**내 계획이 최근 1년 가격에서 어떤 부담을 만들었는지 한 문장으로 이해하는 것.**

### Entry Condition

- `status = "analysis_ready"`
- `marketData !== null` 이고 `simulation !== null`
- 진입 전 `loading_market_data` → `simulating` 로딩을 이 화면에서 표시

### Layout Order

```text
1. 한 문장 결론 + ✦ AI 해석 배지
2. 핵심 지표 — 큰 숫자 1개 + 보조 3개
3. 사건 중심 차트 (종가 1선 + 마커 + 하단 범례)
4. 예산 초과 원인 설명 (문장)
5. 월별 요약 (접힘, 더보기)
6. 데이터 기간 · 출처 · 기준 시각
7. 계산 한계 (회색 블록)
8. PrimaryCta — 하단 고정
```

### Required Components

- `ConclusionText` + `AiBadge`
- `MetricHero` (큰 숫자 1)
- `MetricRow[]` (보조 3)
- `EventChart` + `ChartLegend`
- `CauseExplanation`
- `MonthlyTable` (collapsed, `더보기`)
- `BasisLabel` · `NoticeLine`
- `PrimaryCta`

### Primary CTA

**조정안 비교하기**

### Secondary Action

- 차트 마커 탭 → 사건 상세 시트

> `이 계획 그대로 두기` 는 **Screen 5 의 secondary action** 으로 옮겼다(§Screen 5).
> Screen 4 에서 승인 흐름으로 직행하지 않는다.

### Data Source

- **Twelve Data** — 과거 일봉 (`HistoricalCandlesResult`)
- **Finnhub** — 현재가 (`MarketQuote`), 종목 메타
- **simulation engine** — 모든 지표·이벤트·차트 시리즈
- **Claude structured output** — 결론 문장과 위험 설명 **문장만** (숫자는 엔진 값 삽입)

### Required Fields

**시장 데이터**

| 필드 | 표시 |
| --- | --- |
| `actualRange.from` · `to` | 분석 기간 |
| `candles.length` | 거래일 수 |
| `adjustment` (`"splits"`) · `dividendAdjusted` (`false`) | 데이터 기준 |
| `completeness` | `complete` 아니면 안내 노출 |
| `fetchedAt` | 기준 시각 |
| `quote.currentPrice` · `changePercent` · `marketTimestamp` · `isDelayed` | 시세 블록 |

**시뮬레이션 결과** ([`SimulationResult`](./build/SIMULATION_ENGINE_SPEC.md))

| 필드 | 표시 |
| --- | --- |
| `maxMonthlyInvestmentKrw` | **큰 숫자(hero)** |
| `conditionalTriggerCount` | 보조 |
| `recurringExecutionCount` | 보조 |
| `budgetExceededMonthCount` | 보조 |
| `recurringOnlyBudgetExceededMonthCount` | 원인 문장 |
| `conditionalCausedBudgetExceededMonthCount` | 원인 문장 |
| `conditionalExecutionCount` · `conditionalBlockedCount` | 상세 |
| `maxAdditionalDeclineAfterTriggerPercent` | 상세 (null 이면 "계산할 수 없음") |
| `reviewTriggeredCount` | 상세 |
| `maxMonthlyConditionalExecutionCount` | 상세 |
| `chartSeries[].date` · `closePrice` · `eventIds` · `hasRecurringBuy` · `hasConditionalTrigger` · `hasConditionalBuy` · `hasBlockedAction` · `hasBudgetExceeded` · `hasReviewTrigger` | 차트 |
| `monthlyResults[]` (`month`, `totalInvestmentKrw`, `budgetExceeded`, `budgetExceededCause`) | 월별 요약 |
| `simulationEvents[]` | 마커 상세 시트 |
| `appliedPolicy.conditionalTriggerPrice` · `averageCostUsd` · `averageCostUpdated` | 계산 기준 |
| `period` · `tradingDayCount` · `engineVersion` · `calculatedAt` | 하단 기준 블록 |

**Claude 산출물** — `aiReview.summary.headline` · `risks[]`. 숫자는 참조 필드로만 주입한다.

### Loading State

2단계로 나눠 **무엇을 기다리는지** 보여준다.

```text
[1] 최근 1년 가격을 가져오는 중이에요       (loading_market_data)
[2] 조건이 발생한 시점을 찾고 있어요        (simulating)
```

- 계획 카드는 상단에 접힌 상태로 유지 (무엇을 분석 중인지 보이게)
- skeleton: 결론 1줄 + 지표 4칸 + 차트 영역

**AI 해석은 별도로 로드한다 (확정).**

```text
simulation 완료  → 지표·차트·원인 문장을 즉시 표시
AI 해석 진행 중  → 결론 영역만 skeleton
AI 해석 실패     → 결론 영역만 오류 + 재시도. 나머지는 그대로 유지
```

**AI 해석을 기다리느라 계산 결과를 늦추지 않는다.**
숫자와 `budgetExceededCause` 문구는 **simulation result 에서만** 생성한다.

### Empty State

| 상황 | 화면 |
| --- | --- |
| `conditionalTriggerCount === 0` | "최근 1년 동안 이 조건은 발생하지 않았어요" + "조건이 안전하다는 의미는 아니며, 과거 작동 사례가 부족해 판단이 제한될 수 있어요" |
| `maxAdditionalDeclineAfterTriggerPercent === null` | "계산할 수 없음" — **0% 로 표시하지 않는다** |
| `reviewTriggeredCount === 0` 이고 재검토 미설정 | "설정하지 않음" — "발생하지 않음"과 구분 |
| `budgetExceededMonthCount === 0` | "정기 매수와 추가 매수를 합해도 월 예산을 넘지 않았어요" |

### Error State

| 실패 | 화면 |
| --- | --- |
| historical candle 실패 (`MarketDataError`) | 전체 오류 화면 + 코드별 문구 + `다시 시도`. **mock/fixture 로 대체하지 않는다** |
| `completeness = "insufficient"` | 분석 중단 + "확인 가능한 기간이 부족해 분석을 진행할 수 없어요" |
| `completeness = "partial"` | 결과는 보여주되 상단에 기간 부족 안내 |
| 현재가 조회 실패 | **분석은 계속한다.** 시세 블록만 "현재가를 불러오지 못했어요" |
| simulation engine 실패 (`SimulationInputError`) | 오류 + 어떤 입력이 문제인지 지목 + Screen 3 으로 |
| AI 결론 생성 실패 | **지표와 차트는 그대로 노출**하고 결론 자리에만 "AI 설명을 불러오지 못했어요 · 다시 시도" |

> 마지막 항목이 핵심이다. **AI 문장 실패가 계산 결과를 가리지 않는다.**

### Validation

이 화면은 입력이 없다. CTA 는 항상 활성.
단 `completeness === "insufficient"` 이면 CTA 를 `계획 수정하기`(Screen 3) 로 바꾼다.

### Copy

```text
[결론 예시]
계획대로라면 월 예산을 넘는 달이 있어요

[hero 지표]
월 최대 투자 금액
250,000원

[보조 지표]
조건 발생 · 정기 매수 · 예산 초과

[원인 — recurring_only]
추가 매수와 관계없이 정기 매수 일정만으로
월 예산을 넘은 달이 4개월 있었어요.
월요일이 5번 있는 달에는 50,000원씩 5번, 250,000원이 쓰여요.

[원인 — conditional_action]
정기 매수는 월 예산 안이었지만
추가 매수가 실행되면서 예산을 넘은 달이 2개월 있었어요.

[원인 — 없음]
정기 매수와 추가 매수를 합해도 월 예산을 넘지 않았어요.

[차트 범례]
● 정기 매수   ◆ 조건 발생   ▲ 예산 초과   ! 재검토

[기준]
2025.07.28 ~ 2026.07.27 · 251 거래일 · Twelve Data 일별 종가
분할 반영(splits) · 배당 미반영

[한계]
ⓘ 입력한 평균 매수가를 고정 기준으로 계산했어요.
   실제 체결 수량, 환율, 평균 매수가 변화는 반영하지 않아요.
   수익률을 계산한 결과가 아니에요.

[CTA]
조정안 비교하기
```

**원인 문구는 `budgetExceededCause` · `recurringOnlyBudgetExceededMonthCount` ·
`conditionalCausedBudgetExceededMonthCount` 로 분기한다. AI 가 원인을 추론하지 않는다.**

### Non-goals

- 수익률·예상 수익·평균단가 변화
- 거래량·이동평균·보조지표·다축 차트
- 종목 추천, 매수 시점 추천
- 긴 AI 보고서 (결론 1문장 + 위험 2–3개까지)

---

## Screen 5. 조정안 비교와 승인

### Screen Goal

**현재 계획과 두 대안 중 하나를 골라 모의 실행을 승인하는 것.**

### Entry Condition

- `status = "comparison_ready"` 또는 `"awaiting_final_approval"`
- **`alternatives.length === 2`** (A: 정기 일정 우선 / B: 월 예산 우선 — 고정)
- 각 대안이 **같은 candles 로 재계산된** `simulation` 을 가지고 있음

**대안 값은 TypeScript 규칙으로 계산한다**([`STATE_FLOW_V1.md`](./STATE_FLOW_V1.md) §19).

| 대안 | 정기 매수 | 5주인 달 정기 매수 | 예산 성격 | 화면 라벨 |
| --- | ---: | ---: | --- | --- |
| A. 정기 일정 우선 | 40,000원/주 | 200,000원 | `may_exceed` | **예산 초과 가능** |
| B. 월 예산 우선 | 35,000원/주 | 175,000원 (+조건부 20,000원 = 195,000원) | `within_budget` | **월 예산 이내** |

**A 를 월 예산 준수안으로 표현하지 않는다.** 조건부 매수가 그 달의 정기 매수보다 먼저
실행되면 월 합계가 예산을 넘을 수 있다(엔진은 실행 시점의 누적 금액만 확인하고, 정기 매수는
예산으로 차단하지 않는다).

**AI 는 trade-off 설명 문장만 만든다. 숫자를 만들지 않는다.**

### Layout Order

```text
1. 사용자 수정 요청 요약 (내가 뭘 바꿔달라고 했는지)
2. 계획 선택 카드 3장 (현재 / 조정안 A / 조정안 B) — 세로
   각 카드: 이름 · 달라진 설정값 · trade-off 한 줄
3. 지표별 비교 목록 (라벨 좌측, 값 3개 우측)
4. 선택한 계획 상세 (접힘)
5. 승인 확인 문구 + 모의 실행 고지
6. PrimaryCta — 하단 고정
```

### Required Components

- `RevisionSummary`
- `AlternativeCard[]` (선택 상태 표시)
- `MetricComparisonList`
- `TradeOffLine`
- `ConsentNotice`
- `PrimaryCta`

### Primary CTA

**이 계획으로 모의 실행하기**

### Secondary Action

- **`현재 계획 유지`** — 기존 `plan` 을 그대로 `completed` 처리한다.
  **재시뮬레이션하지 않는다.** 이미 계산된 Screen 4 의 `simulation` 을 그대로 최종 결과로 쓴다.
- `조건 직접 고치기` (텍스트 링크 → Screen 3)
- `분석 결과 다시 보기` (텍스트 링크 → Screen 4)

### Data Source

- **Claude structured output** — `RevisionRequest`, `PlanAlternative.name` · `priority` ·
  `explanation` (설명 문장)
- **simulation engine** — 각 대안의 `SimulationResult` (모든 비교 숫자)
- **Twelve Data** — 재호출하지 않는다. **Screen 4 에서 받은 candles 를 재사용한다**

> 세 계획을 **동일한 candles** 로 계산해야 비교가 성립한다. 대안마다 다시 조회하지 않는다.

### Required Fields

| 필드 | 표시 |
| --- | --- |
| `revisionRequest.originalText` | 수정 요청 요약 |
| `alternatives[].name` · `priority` | 카드 제목 |
| `alternatives[].plan.recurringAction.amount` 등 변경된 설정값 | 달라진 값 강조 |
| `alternatives[].explanation` | trade-off 한 줄 |
| `alternatives[].satisfiesUserConstraints` · `constraintViolations[]` | 제약 미충족 표시 |
| `simulation.maxMonthlyInvestmentKrw` | 비교 행 |
| `simulation.budgetExceededMonthCount` | 비교 행 |
| `simulation.recurringOnlyBudgetExceededMonthCount` · `conditionalCausedBudgetExceededMonthCount` | 비교 행 (원인 분해) |
| `simulation.conditionalExecutionCount` · `conditionalBlockedCount` | 비교 행 |
| `simulation.conditionalTriggerCount` | 비교 행 |
| `simulation.totalInvestmentKrw` | 비교 행 |
| `selectedAlternativeId` | 선택 상태 |

### Loading State

- `generating_alternatives`: "조건을 만족하는 계획을 찾고 있어요" + 카드 skeleton 3장
- 대안별 재계산은 즉시(로컬 계산)이므로 별도 로딩 없음

### Empty State

| 상황 | 화면 |
| --- | --- |
| 대안 생성 실패 | "조정안을 만들지 못했어요" + `현재 계획 유지` · `조건 직접 고치기` |
| 모든 대안이 `satisfiesUserConstraints: false` | 카드는 보여주되 미충족 제약을 각 카드에 명시 |

**대안은 2개 고정**이므로 "대안 0개 / 1개" 레이아웃 분기를 두지 않는다. 계산 실패는 빈 상태가
아니라 오류로 다룬다.

### Error State

| 실패 | 화면 |
| --- | --- |
| 대안 생성 실패 (Claude) | `ErrorPanel` + `다시 시도`. **Screen 4 결과는 유지** |
| 대안 parsing 실패 | "조정안을 정리하지 못했어요" + `직접 고치기` fallback |
| 대안 시뮬레이션 실패 | 해당 카드만 "계산하지 못했어요"로 비활성, 나머지는 비교 가능 |

### Validation

CTA 활성 조건: `selectedAlternativeId !== null` (현재 계획 유지도 선택 항목)

비활성 문구: "비교할 계획을 하나 골라주세요"

### Copy

```text
[수정 요청 요약]
"정기 매수는 유지하면서 한 달에 20만 원을 넘지 않게 해줘"

[카드]
조정안 A · 정기 매수 우선
추가 매수를 월 1회로 제한해요
→ 예산은 지키지만 하락이 반복될 때 덜 사게 돼요

[비교 행]
월 최대 투자 금액 · 예산 초과 개월 · 조건 발생 · 실행 · 차단

[승인 고지]
실제 주문은 실행되지 않아요. 모의 계획으로 저장돼요.
이 결과는 과거 가격에 조건을 적용한 시뮬레이션이며
미래 수익을 예측하거나 보장하지 않아요.

[CTA]
이 계획으로 모의 실행하기

[CTA 비활성]
비교할 계획을 하나 골라주세요
```

**`추천` · `최적` · `가장 좋은` 배지를 쓰지 않는다.**

### Non-goals

- 자동 추천/정렬
- 수익률 비교
- 실제 주문
- 대안 개수 가변 (2개 고정)
- 차트 (차트는 Screen 4 에만)

---

## Screen 4-R. 수정안 결과 (Screen 4 재사용)

**새 화면을 만들지 않는다.** `replaying_revised_plan` 상태에서 **Screen 4 의 레이아웃을
그대로 재사용**하고 상단에 비교 요약만 얹는다.

### Screen Goal

**내가 고른 조정안이 원래 계획과 무엇이 달라졌는지 확인하고 마무리하는 것.**

### Entry Condition

- `status = "awaiting_final_approval"` 이후 승인 완료
- `selectedAlternativeId !== null`
- 원본 `simulation` 과 선택 대안의 `simulation` 이 모두 존재

### Layout Order

```text
0. 변경 전/후 비교 요약   ← Screen 4 대비 추가되는 유일한 블록
1. 한 문장 결론 + ✦ AI 해석 배지   ┐
2. 핵심 지표                        │
3. 사건 중심 차트                   ├ Screen 4 와 동일 (수정안 기준 simulation)
4. 예산 초과 원인 설명              │
5. 월별 요약 / 기준 / 한계          ┘
6. PrimaryCta
```

### Required Components

Screen 4 의 컴포넌트 전부 + `BeforeAfterSummary`

### Primary CTA

**모의 실행 마치기** → `completed`

### Data Source

- **simulation engine** — 선택 대안의 `SimulationResult` (지표·차트)
- 비교 요약은 **두 `SimulationResult` 를 읽어** 만든다. **재계산·재조회 없음**

### Required Fields

| 필드 | 표시 |
| --- | --- |
| 원본 `simulation.maxMonthlyInvestmentKrw` → 대안 값 | 변경 전/후 |
| 원본 `budgetExceededMonthCount` → 대안 값 | 변경 전/후 |
| 원본 `conditionalExecutionCount` · `conditionalBlockedCount` → 대안 값 | 변경 전/후 |
| 대안 `simulation` 전체 | 본문(Screen 4 와 동일) |

### Loading / Empty / Error State

- **로딩 없음.** 이미 계산된 결과를 보여준다.
- Empty·Error 는 Screen 4 와 동일한 규칙을 따른다.

### Copy

```text
[비교 요약]
월 최대 투자 금액   250,000원 → 200,000원
예산 초과            4개월 → 0개월
추가 매수 실행       1회 → 0회

[CTA]
모의 실행 마치기
```

### Non-goals

- 재시뮬레이션
- market data 재조회
- 별도 라우트·별도 레이아웃
