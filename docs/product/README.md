# 투자 리허설

사용자가 말한 투자 방법을 종목·금액·주기와 조건으로 정리하고,
최근 1년 실제 가격에서 매수 시점과 월별 투자 금액을 확인하는 프로토타입.

## 현재 문서

- [[PRODUCT_OVERVIEW]]
- [[FINAL_SCOPE]]
- [[FINAL_TEST_SCENARIOS]]
- [[RELEASE_CHECKLIST]]
- [[LEARNINGS]]

## 설계 과정 원본

실제로 존재하는 문서를 기준으로 연결한다.

- 프로젝트 배경 → [PRODUCT_DIRECTION_V2](../04_Decisions/PRODUCT_DIRECTION_V2.md.md)
- 리서치 결과 → [RESEARCH_SYNTHESIS](../02_Research/RESEARCH_SYNTHESIS.md)
- 출처 확인 → [Source Check](../02_Research/Source%20Check.md)
- 인터뷰 결과 → [INTERVIEW_SYNTHESIS](../03_Interview/INTERVIEW_SYNTHESIS.md)
- 제품 방향 결정 → [PRD_V2](../05_Product/PRD_V2.md)
- 현재 사용자 흐름 → [USER_FLOW_V2](../05_Product/USER_FLOW_V2.md)
- 투자 계획 데이터 구조 → [STRATEGY_SCHEMA_V2](../05_Product/STRATEGY_SCHEMA_V2.md)
- 기술 검토 → [TECH_SPIKE_RESULT](../06_Build/TECH_SPIKE_RESULT.md)
- AI와 도구 역할 → [AGENT_TOOL_CONTRACT](../06_Build/AGENT_TOOL_CONTRACT.md)

## 현재 상태

- 미국 종목 가격 적용: 확인됨
- 국내 종목 가격 적용: 최종 확인 필요
- 조건 수정 후 재계산: 확인됨
- 외부 사용성 설문: 진행 전
- 실제 주문: 범위 제외
- 계좌 연결: 범위 제외

확인할 수 없는 항목은 완료로 쓰지 않고 `확인 필요` 또는 `진행 중`으로 둔다.