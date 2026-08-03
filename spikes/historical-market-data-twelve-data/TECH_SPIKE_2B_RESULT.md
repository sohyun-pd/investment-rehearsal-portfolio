# Historical Market Data Spike — Twelve Data (Tech Spike 2B)

## Result

**PASS** — 현재 Twelve Data 계정과 API 키로 AAPL 최근 약 1년 일별 OHLCV 조회에 성공했다.

> 실제 터미널에서 인증된 호출로 실행해 확정한 결과다. mock / fixture / Finnhub 데이터로
> 대체하지 않았다.

실행일: 2026-07-28

## Provider

Twelve Data

## Test

AAPL / `interval=1day` / 2025-07-28 ~ 2026-07-27
Endpoint: `GET https://api.twelvedata.com/time_series?symbol=AAPL&interval=1day&start_date=..&end_date=..&order=asc&format=JSON&outputsize=5000`

Typecheck: PASS (`npm run typecheck`, 신규 3개 파일 포함 확인)

## API Accessibility

- endpoint access: **가능**
- HTTP status: `200`
- API response status: `ok`
- body `code` / `message`: 없음 (오류 아님)
- plan restriction 여부: 해당 없음 — 요청한 1년 일봉 구간이 현재 플랜에서 반환됨

## Data Quality

- requested range: 2025-07-28 ~ 2026-07-27
- actual range: **2025-07-28 ~ 2026-07-24**
- trading day count: **250**
- first candle: `2025-07-28 O:214.029999 H:214.85001 L:213.059998 C:214.050003 V:37858000`
- last candle: `2026-07-24 O:321.79001 H:334.37 L:321.62 C:333.019989 V:47443900`
- invalid row count: **0**
- duplicate row count: **0**
- completeness: **`complete`** (기준 ≥200)

정규화 검증 통과 내용:

- `values[]` 의 문자열 수치를 모두 `Number` 로 변환했고 `NaN` 이 된 행은 없었다.
- OHLC 제약(`close>0`, `high>=low`, `high>=open`, `high>=close`, `low<=open`, `low<=close`)과
  날짜 형식 검사를 250행 전부 통과했다.
- 날짜 중복 0건, 오름차순 정렬 상태.
- `volume` 은 250행 모두 값이 존재했다(`null` 없음).

## Performance

- latency: **479ms** (1회 요청, 250행 응답 수신까지)

> 단일 측정값이다. 재시도·동시 요청·rate limit 상황의 성능은 측정하지 않았다.

## Product Decision

1. **과거 일봉(historical daily candle) provider 로 Twelve Data 를 채택한다.**
   요청 구간에서 `complete` 완전성과 0건 무효/중복을 실제로 확인했다.
2. **Finnhub 의 symbol search 와 current quote 는 기존대로 유지한다.** provider 를 교체하는
   것이 아니라, 과거 일봉 용도만 Twelve Data 로 분리한다.
3. **provider 별 역할을 분리해 둔다.** Finnhub = 검색 + 현재가, Twelve Data = 과거 일봉.
   두 소스의 가격이 미세하게 다를 수 있다는 점을 이후 설계에서 감안한다.
4. **`end_date` 는 exclusive 로 다룬다.** 실제 기능 구현 시 `end_date` = 원하는 마지막 거래일 + 1일
   로 보낸다(아래 Limitations 참고).
5. **시뮬레이션 엔진은 아직 구현하지 않는다.** 이 스파이크의 범위는 데이터 조회 가능성 검증까지다.

## Limitations

- **`end_date` 경계**: `end_date` 는 그 날짜의 일봉을 포함하지 않는다. `end_date=2026-07-27`
  요청의 마지막 candle 은 `2026-07-24`(금)였고 `2026-07-27`(월)이 빠졌다. 동일 구간을
  `end_date=2026-07-28` 로 요청하면 `2026-07-27` 이 포함되는 것을 별도 호출로 확인했다.
  이번 스파이크는 과제에 명시된 파라미터를 그대로 유지했으므로 actual range 가 요청 범위보다
  하루 짧게 끝난다. 데이터 누락이나 provider 결함이 아니다.
- **검증 범위**: `AAPL` 단일 심볼, 일봉, 1년 구간, 1회 호출만 검증했다. 다른 심볼·해상도·더 긴
  기간·해외 거래소·rate limit / credit 소진 동작은 미검증이다(오류 분류 코드는 구현했으나
  실제로 발생시켜 확인하지는 않았다).
- **가격 조정 여부 미확인**: 이번 응답이 split/dividend 조정 가격인지 확인하지 않았다.
  시뮬레이션 정확도에 영향이 있으므로 엔진 구현 전에 별도로 확인해야 한다.
- 차트·시뮬레이션 엔진·뉴스 API·앱 UI 는 이 스파이크 범위 밖이며 만들지 않았다.
- 기존 Finnhub 스파이크 파일(`spikes/historical-market-data/`)은 수정하지 않았다.

## 재현 방법

```
npm run spike:history:twelve
```

출력에는 API 키가 포함되지 않는다(요청 URL 미출력, 메시지 redact).
