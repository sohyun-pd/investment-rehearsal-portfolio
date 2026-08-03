---
title: Prototype Design System
status: decided
---

````

# Design Direction

국내 모바일 증권 앱 맥락과 어울리는
쉽고 친근한 모바일 투자 경험을 지향한다.

사용자가 투자 전문 지식이나 주문 조건을 모두 이해하지 않아도
자신의 투자 계획을 말하고,
AI가 정리한 조건을 하나씩 확인할 수 있어야 한다.

특정 서비스의 화면이나 컴포넌트를 직접 복제하지 않는다.
대신 다음 제품 원칙을 따른다.

1. 투자 용어를 일상적인 문장으로 설명한다.
2. 사용자가 지금 무엇을 확인해야 하는지 먼저 보여준다.
3. 복잡한 조건은 한 번에 요구하지 않고 단계적으로 묻는다.
4. AI가 판단을 대신하기보다 사용자의 계획을 정리한다.
5. 주요 행동은 친근하게, 위험 정보는 분명하게 표현한다.
6. 한 화면에서 하나의 결정에 집중한다.
````

# Radius

```
--radius-sm: 8px;
--radius-md: 12px;
--radius-lg: 16px;
--radius-full: 999px;
```

- Input: 12px
- Button: 14px
- Card: 16px
- Badge: full

과도하게 둥근 카드와 캡슐형 UI를 남용하지 않는다.

# Color

색은 역할을 기준으로 사용한다.  
특정 브랜드 컬러를 직접 복제하지 않는다.

```
--color-bg: #FFFFFF;
--color-surface: #F2F4F7;
--color-surface-strong: #EAF4FF;

--color-text-primary: #191F28;
--color-text-secondary: #6B7684;
--color-text-tertiary: #8B95A1;

--color-border: #D9E0E8;
--color-border-strong: #C4CDD8;

--color-action: #3182F6;
--color-action-hover: #2475E8;
--color-action-pressed: #1B64D8;
--color-action-text: #FFFFFF;
--color-action-soft: #E7F1FF;

--color-positive: #E94B55;
--color-negative: #3B70E2;
--color-warning: #F59F00;
--color-error: #E5484D;
--color-success: #20A464;
```

주의:

- 상승·하락 색상은 한국 금융 서비스 관습에 맞게 사용한다.
- 색상만으로 상승·하락 상태를 전달하지 않는다.
- 수치 앞에 +, − 기호와 텍스트를 함께 사용한다.
- AI 기능에 보라색 그라데이션이나 네온 효과를 사용하지 않는다.
- 검정 배경, 글래스모피즘, 과도한 그림자를 사용하지 않는다.
- 상승·하락 의미 색상(positive/negative)과 성공·경고·오류 의미 색상은 액션 블루로
  통일하지 않는다 — 각자의 의미 색상을 그대로 유지한다.

블루 적용 범위:

```
주요 CTA
선택된 예시 문장
AI가 확인한 조건 표시
현재 진행 단계
포커스 링
캐릭터 주변 배경
```

블루를 쓰지 않을 곳:

```
모든 카드 배경(흰색 유지)
상승·하락 수치(의미 색상 유지)
오류·경고 상태(의미 색상 유지)
```

# Typography

가능하면 Pretendard 또는 시스템 산세리프를 사용한다.

```
font-family:
  Pretendard,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

## Type Scale

- Display: 28px / 38px / 700
- Page title: 24px / 34px / 700
- Section title: 20px / 28px / 700
- Card title: 17px / 24px / 600
- Body: 16px / 25px / 400
- Body strong: 16px / 25px / 600
- Caption: 13px / 19px / 400
- Numeric emphasis: 24px / 32px / 700

원칙:

- 본문 최소 크기는 15px 이상
- 제목에 불필요한 영문 대문자를 사용하지 않음
- 핵심 숫자에는 tabular numbers 적용
- 긴 설명을 작은 회색 글씨로 숨기지 않음
- 한 문단은 최대 2~3문장

# Components

## Primary Button

- Background: vivid blue action color
- Text: dark neutral
- Height: 56px
- Radius: 14px
- Font: 16px / 600
- 그림자와 그라데이션 사용 금지
- 한 화면에 하나의 주요 버튼만 사용

예시:

- 투자 조건으로 정리하기
- 빠진 조건 입력하기
- 이 조건으로 확인하기
- 모의 전략 등록하기

## Secondary Button

- Height: 48px
- Border 또는 neutral surface 사용
- Primary CTA보다 시각적 강도를 낮춤

## Text Input

- Minimum height: 52px
- Horizontal padding: 16px
- Border: 1px solid border color
- Focus 상태를 명확히 표시
- 오류 문구는 입력창 바로 아래 배치

## Natural Language Textarea

- Minimum height: 144px
- 사용자가 작성한 문장을 수정하기 쉬워야 함
- 기본 예시 문장을 제공하되 placeholder로만 숨기지 않음
- 글자 수 제한은 MVP에서 사용하지 않음

## Card

- Background: white or neutral surface
- Border: 1px solid border color
- Radius: 16px
- Padding: 20px
- Shadow는 사용하지 않거나 매우 약하게 사용
- 모든 콘텐츠를 카드로 감싸지 않음

## Strategy Condition Card

카드 상단:

- 조건 유형
- 편집 버튼

카드 본문:

- 핵심 실행 문장
- 기준 가격
- 금액 또는 비율
- 실행 주기

카드 하단:

- 데이터 기준
- 수정이 필요한 정보

정기 매수, 조건부 매수, 조건부 매도를 시각적으로 구분하되  
색상을 과도하게 사용하지 않는다.

## Market Data Block

다음 정보의 순서를 유지한다.

1. 회사명과 티커
2. 현재가 또는 직전 종가
3. 전일 대비
4. 데이터 기준 시각
5. 지연 여부와 출처

데이터 시각과 지연 여부를 tooltip 안에 숨기지 않는다.

## Status Badge

사용 가능한 상태:

- 분석 중
- 확인 필요
- 등록 준비
- 모의 전략
- 지연 시세
- 데이터 오류

Badge는 상태 전달에만 사용하고 장식 목적으로 사용하지 않는다.

## Bottom CTA

모바일 화면 하단에 주요 CTA를 고정할 수 있다.

- 콘텐츠를 가리지 않도록 bottom padding 확보
- 키보드 노출 시 입력 영역을 가리지 않음
- Safe area inset 반영
- 하단 모서리에 불필요한 radius를 넣지 않음

# Screen Principles

## Input

- 첫 화면에서 기능 설명을 길게 하지 않는다.
- 사용자가 바로 문장을 입력하거나 예시를 실행할 수 있어야 한다.
- 추천 종목을 제공하지 않는다.

## Loading

3단계 진행 문구를 사용한다.

1. 투자 계획을 읽고 있어요
2. 종목과 조건을 확인하고 있어요
3. 실행 가능한 전략으로 정리하고 있어요

단순 spinner만 보여주지 않는다.

## Clarification

- 한 화면에서 한 질문을 우선한다.
- AI가 왜 질문하는지 한 줄로 설명한다.
- 입력되지 않은 숫자를 임의 생성하지 않는다.

## Review

- 자연어 원문보다 구조화된 조건을 먼저 보여준다.
- 수정 가능한 값은 명확한 input 또는 edit action으로 제공한다.
- 기준 가격의 종류와 시각을 반드시 표시한다.

## Confirmation

- 실제 실행될 내용을 문장으로 다시 설명한다.
- 사용자가 확인해야 할 핵심 수치만 강조한다.
- 실제 주문이 아닌 모의 등록임을 CTA 주변에 표시한다.

## Complete

- 축하 애니메이션이나 confetti를 사용하지 않는다.
- 등록된 조건을 한 번 더 요약한다.
- MVP에서 지원하지 않는 실제 주문 기능을 암시하지 않는다.

# UX Writing

전문적인 기능도 사용자가 실제로 하는 행동을 기준으로 설명한다.

권장:

- 어떤 투자 계획을 갖고 있나요?
- 말해주신 계획을 조건으로 정리할게요
- 실행하려면 평균 매수가가 필요해요
- 정리한 조건이 맞는지 확인해 주세요
- 이 가격을 기준으로 계산했어요
- 실제 주문 없이 조건만 등록해 볼게요
- 언제든 조건을 다시 바꿀 수 있어요

비권장:

- 투자 전략 생성
- 파라미터 입력
- 조건부 주문 트리거 설정
- AI 분석 결과 검증
- 전략 활성화
- 포지션 사이즈 설정

전문 용어가 필요한 경우 이렇게 풀어.

```
기준 가격
평균 매수가를 기준으로 계산해요

매도 비율
보유한 주식 중 얼마나 팔지 정해요

지연 시세
현재 화면의 가격은 실제 시장보다 늦을 수 있어요
```
## 5. 화면 톤

### 입력 화면

기존:

```
투자 계획을 말해보세요
```

추천:

```
어떤 투자 계획을 갖고 있나요?

평소 생각하던 매수·매도 계획을
말하듯이 적어주세요.
```

### 분석 화면

```
말해주신 계획을 정리하고 있어요

종목을 확인했어요
매수 조건을 나누고 있어요
빠진 정보가 있는지 살펴보고 있어요
```

### 추가 질문

```
평균 매수가는 얼마인가요?

평균 매수가보다 3% 떨어졌을 때
추가로 사는 조건을 계산하는 데 필요해요.
```

### 검토 화면

```
이렇게 이해했어요

다르게 생각한 부분이 있다면
숫자를 눌러 바로 바꿀 수 있어요.
```

### 완료 화면

```
조건을 모의 전략으로 등록했어요

실제 주문은 실행되지 않아요.
조건이 의도와 맞는지 먼저 살펴볼 수 있어요.
```
# Prohibited Patterns

- 특정 금융 서비스 화면의 직접 복제
- 과도한 그라데이션
- 유리 질감 카드
- 3D AI 캐릭터
- 반짝이와 마법봉 아이콘
- 의미 없는 차트
- 수익률을 강조하는 홍보 문구
- 한 화면에 여러 primary CTA
- 작은 회색 글씨에 중요 정보를 숨기는 방식
- 임의의 spacing, radius, color 추가