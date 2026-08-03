# Historical Market Data Spike (Tech Spike 2)

현재 Finnhub API 키로 **AAPL 최근 약 1년 일별 OHLCV(candle)** 데이터를 실제로 조회할 수 있는지 검증한다.

- 근거 계약: [`docs/product/build/AGENT_TOOL_CONTRACT.md`](../../docs/product/build/AGENT_TOOL_CONTRACT.md) §11 `fetch_historical_prices`
- 이 스파이크는 데이터 조회 가능성만 검증한다. **차트·시뮬레이션 엔진·뉴스 API·앱 UI 는 만들지 않는다.**

## 검증 결과 (2026-07-28 실행, FAIL)

현재 사용 중인 Finnhub 계정과 API 키에서는 historical candle endpoint 가 **HTTP 403** 으로
거부됐다. 응답 메시지는 `You don't have access to this resource.` 였다.

| 항목 | 값 |
| --- | --- |
| 실행일 | 2026-07-28 |
| provider / endpoint | Finnhub / historical candle |
| symbol / requested range | AAPL / 2025-07-28 ~ 2026-07-27 |
| HTTP status | 403 |
| error code | `forbidden_or_plan_restriction` |
| completeness | `insufficient` |
| latency | 485ms |
| typecheck | PASS |

- HTTP 403 과 응답 메시지에 근거해 **현재 계정의 접근 권한 또는 플랜 제한**으로 판단한다.
  요청 파라미터나 클라이언트 구현 문제가 아니므로 **코드 수정으로 해결할 수 있는 오류가 아니다.**
- latency 485ms 는 데이터 조회 성능이 아니라 **인증·권한 거부 응답의 왕복 시간**이다.
- 응답에 candle 데이터가 없어 **정규화(`normalize.ts`)와 데이터 품질 검증은 실행되지 않았다.**
  아래 "검증 항목" 3–8 은 미실행 상태다.

자세한 기록: [`TECH_SPIKE_2_RESULT.md`](./TECH_SPIKE_2_RESULT.md)

## 파일

- `types.ts` — `DailyCandle`, `DateRange`, `completeness`, 오류코드, 결과 타입
- `normalize.ts` — Finnhub 원시 응답 → 정규화(정렬·중복제거·OHLC 유효성·completeness). 순수 함수(네트워크 없음)
- `test.ts` — 실제 endpoint 호출 + 오류 분류 + 결과 출력
- `TECH_SPIKE_2_RESULT.md` — 검증 결과 기록

## 실행

```bash
# 방법 A: npm 스크립트 (아래 스크립트를 package.json 에 추가한 경우)
npm run spike:history

# 방법 B: 스크립트 없이 직접
npx tsx spikes/historical-market-data/test.ts
```

> package.json 에 추가할 스크립트 (한 줄):
>
> ```json
> "spike:history": "tsx spikes/historical-market-data/test.ts",
> ```

## 환경 변수

기존 `.env.local` 값을 사용한다. (키는 출력/로그에 남기지 않는다)

```
MARKET_PROVIDER=finnhub
FINNHUB_API_KEY=...
```

`spikes/env.ts` 가 `.env.local` 을 로드한다. 키가 없으면 `api_key_missing` 으로 명시 실패한다.

## 대상

- Symbol: `AAPL`
- Resolution: 일봉 (`resolution=D`)
- Range: `2025-07-28` ~ `2026-07-27`
- Endpoint: `GET https://finnhub.io/api/v1/stock/candle`

## 검증 항목

1. 실제 historical candle endpoint 호출
2. 응답 상태 코드/오류 확인
3. `DailyCandle` 로 정규화 (date, open, high, low, close, volume)
4. 날짜 오름차순 정렬
5. 중복 날짜 제거
6. OHLC 유효성: `close>0`, `high>=low`, `high>=open`, `high>=close`, `low<=open`, `low<=close`, 유효 날짜, 빈 배열 아님
7. 출력: provider / symbol / requested range / actual range / trading day count / first candle / last candle / invalid row count / duplicate row count / latency / completeness
8. completeness: `complete`(≥200) · `partial`(30–199) · `insufficient`(<30 또는 데이터 없음)

## 오류 처리 (명시 구분)

`api_key_missing` · `unauthorized`(401) · `forbidden_or_plan_restriction`(402/403) · `rate_limited`(429) · `no_data`(`s=no_data`) · `malformed_response` · `network_failure`

- 실패 시 mock/fixture 로 대체하지 않는다.
- 다른 provider 로 자동 전환하지 않는다.
- 실제 실패 원인을 `TECH_SPIKE_2_RESULT.md` 에 기록한다.

## 보안

- 요청 URL(토큰 포함)을 출력하지 않는다.
- 출력 메시지에서 토큰을 `***REDACTED***` 로 가린다.
- 응답 원본을 파일로 저장하지 않는다(토큰/인증정보 유출 방지).

## 후속 조치

- **Finnhub 의 symbol search 와 current quote 는 기존대로 유지한다.** 이번 거부는 historical
  candle endpoint 에 한정되며, 현재 사용 중인 검색·현재가 기능에는 영향이 없다.
- **historical daily candle 은 별도 provider 를 검증한다.** Finnhub 를 교체하는 것이 아니라,
  과거 일봉 용도로만 다른 provider 를 둔다.
- **다음 검증 대상은 Twelve Data 다.** 동일한 검증 항목(AAPL / 일봉 / 2025-07-28 ~ 2026-07-27 /
  completeness / latency)으로 진행한다.
- 실제 과거 일봉 데이터가 확보되기 전까지 mock 이나 fixture 로 대체하지 않는다.
