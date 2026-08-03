# Historical Market Data Spike

## Result

**FAIL** — 현재 Finnhub 계정으로 historical candle endpoint 접근 불가 (403).

> 실제 터미널에서 인증된 호출로 실행해 확정한 결과다. mock/fixture 로 대체하지 않았다.

## Provider

Finnhub

## Test

AAPL / Daily / 2025-07-28 ~ 2026-07-27
Endpoint: `GET https://finnhub.io/api/v1/stock/candle?symbol=AAPL&resolution=D&from=..&to=..`

Typecheck: PASS

## API Accessibility

- endpoint access: **불가**
- status code: `403`
- error code: `forbidden_or_plan_restriction`
- message: `You don't have access to this resource.`
- plan restriction 여부: **확인됨** — Finnhub `/stock/candle` 은 현재 계정 플랜에서 제공되지 않음

## Data Quality

응답 본문에 candle 데이터가 없어 정규화 단계에 도달하지 못했다.

- trading day count: 0
- actual range: 없음
- invalid rows: 0 (평가 대상 없음)
- duplicate rows: 0 (평가 대상 없음)
- completeness: `insufficient`

## Performance

- latency: 485ms

> 인증 거부 응답의 왕복 시간이다. 데이터 조회 성능 지표로는 사용할 수 없다.

## Product Decision

1. **Finnhub 의 symbol search 와 quote 는 기존대로 유지한다.** 이번 실패는 historical
   candle endpoint 에 한정되며, 현재 사용 중인 검색·현재가 기능에는 영향이 없다.
2. **현재 Finnhub 계정으로 historical candle endpoint 는 사용할 수 없다.** 플랜 제약이므로
   코드 수정이나 재시도로 해결되지 않는다.
3. **mock 이나 fixture 로 대체하지 않는다.** 과거 일봉이 필요한 기능은 실제 데이터가
   확보되기 전까지 구현하지 않는다.
4. **과거 일봉 전용 대체 provider 를 별도로 검증한다.** Finnhub 를 교체하는 것이 아니라,
   historical daily 용도로만 별도 provider 를 둔다.
5. **다음 검증 대상은 Twelve Data 다.** 동일한 검증 항목(AAPL / 일봉 / 최근 1년 /
   completeness / latency)으로 Tech Spike 3 를 진행한다.

## Limitations

- 이 스파이크는 `AAPL` 단일 심볼, 일봉, 최근 1년 범위만 검증했다. 다른 심볼·해상도·기간에서
  Finnhub 가 다르게 동작할 가능성은 검증 대상이 아니었다(플랜 제약이므로 동일할 가능성이 높다).
- 유료 플랜에서의 데이터 품질·완전성은 미검증이다. 이번 결과는 **현재 계정**의 접근 가능성만
  말한다.
- 차트·시뮬레이션 엔진·뉴스 API·앱 UI 는 이 스파이크 범위 밖이며 수정하지 않았다.

## 재현 방법

```
npx tsx spikes/historical-market-data/test.ts
```

출력에는 API 키가 포함되지 않는다(요청 URL 미출력, 메시지 redact).
