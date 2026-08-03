# Historical Market Data Spike — Twelve Data (Tech Spike 2B)

현재 Twelve Data API 키로 **AAPL 최근 약 1년 일별 OHLCV** 데이터를 실제로 조회할 수 있는지 검증한다.

- 근거 계약: [`docs/product/build/AGENT_TOOL_CONTRACT.md`](../../docs/product/build/AGENT_TOOL_CONTRACT.md) §11 `fetch_historical_prices`
- 배경: Finnhub historical candle 은 현재 계정과 키에서 HTTP 403 으로 거부됐다
  ([`../historical-market-data/TECH_SPIKE_2_RESULT.md`](../historical-market-data/TECH_SPIKE_2_RESULT.md)).
  Finnhub 의 symbol search 와 current quote 는 그대로 유지하고, **과거 일봉 전용 provider** 만
  여기서 별도 검증한다.
- 이 스파이크는 데이터 조회 가능성만 검증한다. **차트·시뮬레이션 엔진·뉴스 API·앱 UI 는 만들지 않는다.**

## 검증 결과 (2026-07-28 실행, PASS)

| 항목 | 값 |
| --- | --- |
| provider / endpoint | Twelve Data / `/time_series` |
| symbol / interval | AAPL / `1day` |
| requested range | 2025-07-28 ~ 2026-07-27 |
| actual range | 2025-07-28 ~ 2026-07-24 |
| HTTP status | 200 |
| API response status | `ok` |
| trading day count | 250 |
| invalid rows / duplicate rows | 0 / 0 |
| latency | 479ms |
| completeness | `complete` |
| typecheck | PASS |

상세 기록: [`TECH_SPIKE_2B_RESULT.md`](./TECH_SPIKE_2B_RESULT.md)

## 파일

- `types.ts` — `DailyCandle`, `DateRange`, `completeness`, 오류코드, 결과 타입, Twelve Data 원시 응답 타입
- `normalize.ts` — 원시 응답(문자열 수치) → `Number` 변환 → 정렬·중복제거·OHLC 유효성·completeness. 순수 함수(네트워크 없음)
- `test.ts` — 실제 endpoint 호출 + 오류 분류 + 결과 출력
- `TECH_SPIKE_2B_RESULT.md` — 검증 결과 기록

## 실행

```bash
npm run spike:history:twelve

# 스크립트 없이 직접
npx tsx spikes/historical-market-data-twelve-data/test.ts
```

## 환경 변수

기존 `.env.local` 값을 사용한다. (키는 출력/로그에 남기지 않는다)

```
TWELVE_DATA_API_KEY=...
```

`spikes/env.ts` 가 `.env.local` 을 로드한다. 키가 없으면 `api_key_missing` 으로 명시 실패한다.

## 요청

`GET https://api.twelvedata.com/time_series`

| 파라미터 | 값 |
| --- | --- |
| `symbol` | `AAPL` |
| `interval` | `1day` |
| `start_date` | `2025-07-28` |
| `end_date` | `2026-07-27` |
| `order` | `asc` |
| `format` | `JSON` |
| `outputsize` | `5000` |
| `apikey` | `.env.local` 값 |

## 검증 항목

1. 실제 `/time_series` endpoint 호출
2. HTTP status 확인 **및 응답 body 의 `status` / `code` / `message` 확인**
   (Twelve Data 는 HTTP 200 으로도 `status="error"` 를 실어 보낸다)
3. `values[]` 의 문자열 수치를 `Number` 로 변환해 `DailyCandle` 로 정규화
   (date, open, high, low, close, volume)
4. 날짜 오름차순 정렬 (`order=asc` 를 보내지만 응답 순서를 신뢰하지 않고 재보장)
5. 중복 날짜 제거
6. OHLC 유효성: `close>0`, `high>=low`, `high>=open`, `high>=close`, `low<=open`, `low<=close`,
   유효 날짜, 빈 배열 아님
7. 출력: provider / symbol / requested range / actual range / trading day count / first candle /
   last candle / invalid row count / duplicate row count / latency / completeness /
   HTTP status / API response status
8. completeness: `complete`(≥200) · `partial`(30–199) · `insufficient`(<30 또는 데이터 없음)

## 오류 처리 (명시 구분)

`api_key_missing` · `unauthorized`(401) · `forbidden_or_plan_restriction`(402/403/432/433) ·
`rate_limited`(429) · `credits_exceeded`(429 + credit/quota 사유) · `no_data`(404 또는 빈 `values`) ·
`malformed_response` · `network_failure`

- HTTP status 와 body `code` 를 같은 규칙으로 분류한다. body `code` 가 있으면 그것을 우선한다.
- 실패 시 mock/fixture/Finnhub 데이터로 대체하지 않는다.
- 다른 provider 로 자동 전환하지 않는다.
- 실제 실패 원인을 `TECH_SPIKE_2B_RESULT.md` 에 기록한다.

## 보안

- 요청 URL(키 포함)을 출력하지 않는다.
- 출력 메시지에서 키를 `***REDACTED***` 로 가린다.
- 응답 원본을 파일로 저장하지 않는다.

## 알려진 동작: `end_date` 경계

`end_date` 는 **해당 날짜의 일봉을 포함하지 않는다**(exclusive). 그래서 `end_date=2026-07-27`
요청의 마지막 candle 은 `2026-07-24`(금)였고, `2026-07-27`(월)은 빠졌다. 같은 구간을
`end_date=2026-07-28` 로 요청하면 `2026-07-27` 이 포함되는 것으로 확인했다.

이 스파이크는 과제에 명시된 파라미터를 그대로 유지한다. 실제 기능 구현 시에는
`end_date` 를 **원하는 마지막 거래일 + 1일**로 보내야 한다.
