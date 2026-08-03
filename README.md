# 투자 리허설 (Investment Rehearsal)

자연어로 입력한 투자 방법을 확인 가능한 계획으로 구조화하고,
최근 1년 실제 가격에 적용해 결과를 비교하는
AI 투자 시뮬레이션 프로토타입입니다.

**이 서비스는 실제 주문·투자 추천·미래 수익 예측 서비스가 아니다.** 사용자가 말한 조건을
과거 실제 가격에 결정적으로 적용해 계산만 할 뿐, 무엇을 사라고 권하거나 앞으로의 가격을
예측하지 않는다.

## 링크

- Live demo: https://invest-rehearsal-portfolio.pages.dev
- Product overview: [`docs/product/PRODUCT_OVERVIEW.md`](./docs/product/PRODUCT_OVERVIEW.md)
- Local setup: [아래 "로컬 실행"](#로컬-실행)
- Architecture: [아래 "기술 구성"](#기술-구성)
- Test commands: [아래 "test / build"](#test--build)

## 주요 흐름

1. **자연어 입력** — "애플을 매달 100달러씩 사고, 평균 매입가보다 10% 낮아지면 50달러 더
   살래요"처럼 편하게 적으면 AI("똑대리")가 종목·정기 매수·조건부 추가 매수·월 투자
   한도로 구조화한다.
2. **종목 확정** — 후보 종목을 실제 검색 결과(Finnhub)에서 직접 고른다. 복수 종목이나
   모호한 표현(예: "4주씩")이 섞이면 일반 오류 대신 한 카드에서 선택해 정리한다.
3. **계획 확인** — 빠진 조건만 모아 한 번에 채우고, 확정 전에 계획 전체를 확인한다.
   국내 주식은 1주 단위로만 계산되므로, 설정한 금액으로 최근 1년 동안 단 하루도 1주를
   살 수 없으면 미리 안내한다.
4. **백테스트 결과** — 최근 1년 실제 일별 종가에 계획을 그대로 적용해 매수 시점·평가손익·
   평가수익률을 계산한다. 국내 주식은 정수 수량, 해외 주식은 소수점 수량을 유지한다.
5. **조건 수정 / 종목 변경 / 새 투자 방법 만들기** — 결과를 본 뒤 조건을 바꿔 다시
   계산하거나, 종목만 바꿔 재계산하거나, 처음부터 다른 계획을 시작할 수 있다.
6. **사용성 피드백** — 결과를 확인한 뒤에만 짧은 설문에 답할 수 있고, 응답은 서버를 거쳐
   구글 시트에 저장된다(외부 구글 폼으로 이동하지 않는다).

## 기술 구성

- **프런트엔드**: React 18 + TypeScript + Vite + Tailwind CSS v4, React Router
- **BFF(서버)**: Cloudflare Pages Functions(`functions/api/**`) — 브라우저는 외부 API 키를
  절대 직접 다루지 않는다. 로직 자체는 런타임 무관 공용 코드(`server/*.ts`)로 작성해
  Cloudflare Pages Functions와 로컬 Vite dev 미들웨어(`server/apiPlugin.ts`) 양쪽에서
  재사용한다.
- **AI**: Anthropic Claude(구조화 출력) — 계획 해석·수정, 결과 설명에 사용한다. 가격·
  예산 합계·수익률은 AI가 계산하지 않고 결정적 엔진(`app/domain/simulation`)이 계산한다.
- **시장 데이터**: 해외 주식 검색·시세는 Finnhub, 과거 일별 가격은 Twelve Data(해외) ·
  Yahoo Finance(국내, 임시 provider). 실시간 조회가 실패하면 저장된 스냅샷으로만
  제한적으로 대체하고, 그 사실을 화면에 그대로 표시한다.
- **피드백 저장**: 인앱 설문 → 서버(BFF) → Google Apps Script Web App → Google 시트.

## 로컬 실행

```bash
npm install
cp .env.example .env.local   # 값 채우기(아래 "필요한 환경변수" 참고)
npm run dev                  # http://localhost:5173
```

`npm run dev`는 Vite 개발 서버 + 로컬 BFF 미들웨어를 함께 띄운다. 실제 Claude·시장
데이터 API 를 그대로 호출한다(키가 없으면 해당 기능만 오류로 표시된다 — 가짜 성공을
보여주지 않는다).

## 필요한 환경변수

`.env.example` 에 이름만 있고 값은 비어 있다. 서버 전용 값은 `VITE_` 접두사를 쓰지
않는다(브라우저 번들에 노출되면 안 되기 때문).

| 변수 | 용도 | 필수 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | 계획 해석·수정·결과 설명(Claude) | 필수 |
| `FINNHUB_API_KEY` | 해외 종목 검색·시세 | 필수 |
| `TWELVE_DATA_API_KEY` | 해외 종목 과거 일별 가격 | 필수 |
| `LLM_MODEL` | Claude 모델명(기본값 있음) | 선택 |
| `FEEDBACK_APPS_SCRIPT_URL` | 피드백 저장용 Google Apps Script 웹앱 URL | 선택(비우면 피드백 저장만 비활성) |
| `FEEDBACK_API_TOKEN` | Apps Script 가 별도 토큰 검증을 하도록 만들었을 때만 | 선택 |
| `VITE_ENABLE_FEEDBACK` | 결과 화면에 피드백 버튼 노출 여부(`true`/`false`) | 선택 |
| `VITE_USE_MOCK_AI` | 오프라인 데모 질문 흐름(개발용) | 선택 |
| `VITE_USE_MOCK_MARKET` | 오프라인 합성 시세(개발용) | 선택 |

## test / build

```bash
npm test              # 전체 unit test(23개 스위트, node:test + tsx)
npm run typecheck      # 앱 전체 타입 검사
npm run typecheck:functions  # Cloudflare Pages Functions 타입 검사
npm run build          # 타입 검사 + production 빌드(dist/)
```

## 배포 구조

Cloudflare Pages(직접 업로드 방식, git 연동 아님) + Pages Functions.

```bash
npm run build
npx wrangler pages deploy dist --project-name invest-rehearsal-portfolio
```

- `wrangler.jsonc` — Pages 프로젝트 설정. AI 호출 라우트(계획 해석·수정·결과 설명)에는
  세션 기준 rate limit(Cloudflare KV 카운터)이 걸려 있다.
- 시크릿(API 키 등)은 `wrangler pages secret put <NAME> --project-name invest-rehearsal-portfolio`
  로 등록한다 — 저장소에는 절대 값을 넣지 않는다.
- 미국 종목 과거 가격·종목 검색은 Cloudflare Cache API 로 캐시해 같은 조회를 반복하지
  않는다(사용자 개인 계획·AI 응답은 캐시하지 않는다).
