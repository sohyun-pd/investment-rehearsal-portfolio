/**
 * /feedback — 사용성 피드백 설문 페이지.
 *
 * 근거: 사용자 확정 — 독립된 route 로 구현한다. FlowProvider 는 Routes 밖에 있어(§App.tsx)
 * 이 페이지를 오가도 currentPlan·simulationResult·market data 가 전혀 바뀌지 않는다 —
 * 뒤로가기는 브라우저 history 로 처리해 직전 결과 화면을 그대로 복원한다(재계산·재조회 없음).
 *
 * 이 페이지는 useFlow() 에서 sessionId 뿐 아니라 simulation 도 읽는다 — 결과가 실제로
 * 메모리에 있을 때만(§사용자 확정 — navigate(-1) 에만 기대면 안 된다) 설문을 보여준다.
 *
 * `simulation` 은 session storage 에 저장하지 않는 값이다(§session/planStorage.ts — 계산
 * 결과·market data 는 저장하지 않고 새로고침 시 재조회한다). 그래서 이 화면을 새로고침하거나,
 * 직접 URL 로 열거나, 히스토리가 없는 새 탭에서 열면 simulation 은 항상 null 이 된다 — 그
 * 경우 빈 설문을 보여주는 대신 "먼저 결과를 확인해주세요" 안내로 대체한다. 정상적으로 결과
 * 화면에서 들어왔을 때만 simulation 이 채워져 있고, 그때만 "결과로 돌아가기"가 실제로 돌아갈
 * 결과를 갖고 있다는 뜻이다 — 그래서 이 하나의 조건이 "돌아갈 곳이 있는지"를 그대로 답한다.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { AppHeader, AppScreen } from "@/components/app/AppScreen";
import { Button } from "@/components/ui/button";
import { APP_ROOT_PATH } from "@/config/routePaths";
import { useFlow } from "@/flow/FlowProvider";
import { FeedbackForm, type FeedbackAnswers } from "./FeedbackForm";
import { submitFeedback } from "./feedback.repository";
import { hasSubmittedFeedback, markFeedbackSubmitted } from "./feedback.storage";

type PageState = "no_result" | "form" | "submitting" | "submitted" | "error" | "already_submitted";

/** 진입 시 어떤 상태로 시작할지 결정하는 순수 함수 — 렌더링 없이 이 분기 자체를 테스트할 수
 * 있다. 결과가 없으면(hasResult=false) 다른 무엇보다 먼저다 — 이미 제출했어도 결과가 없으면
 * "이미 제출했어요"가 아니라 "먼저 결과를 확인해주세요"가 맞다. */
export function resolveInitialFeedbackPageState(hasResult: boolean, alreadySubmitted: boolean): PageState {
  if (!hasResult) return "no_result";
  return alreadySubmitted ? "already_submitted" : "form";
}

export function FeedbackPage() {
  const navigate = useNavigate();
  const { sessionId, simulation } = useFlow();
  const hasResult = simulation !== null;
  const [state, setState] = React.useState<PageState>(() =>
    resolveInitialFeedbackPageState(hasResult, hasSubmittedFeedback(sessionId))
  );
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const [pendingAnswers, setPendingAnswers] = React.useState<FeedbackAnswers | null>(null);

  // 결과가 있을 때만 실제로 "뒤로" 갈 결과가 있다 — 그때만 브라우저 히스토리를 쓴다. 결과가
  // 없으면(새로고침·직접 접근·히스토리 없는 새 탭) 앱 루트로 보낸다. 히스토리가 비어 있어도
  // 앱 밖으로 나가는 일은 없다(§사용자 확정 — 빈 히스토리로 제품 밖에 내보내면 안 된다).
  function goToResult() {
    if (hasResult) {
      navigate(-1);
      return;
    }
    navigate(APP_ROOT_PATH);
  }

  async function handleSubmit(answers: FeedbackAnswers) {
    setPendingAnswers(answers);
    setState("submitting");
    const result = await submitFeedback({ sessionId, ...answers });
    if (result.ok) {
      markFeedbackSubmitted(sessionId);
      setState("submitted");
      return;
    }
    setErrorMessage(result.userMessage);
    setState("error");
  }

  async function handleRetry() {
    if (pendingAnswers === null) return;
    setState("submitting");
    const result = await submitFeedback({ sessionId, ...pendingAnswers });
    if (result.ok) {
      markFeedbackSubmitted(sessionId);
      setState("submitted");
      return;
    }
    setErrorMessage(result.userMessage);
    setState("error");
  }

  // 결과가 없으면(새로고침·직접 접근·히스토리 없는 새 탭) 다른 어떤 상태보다 먼저 이걸
  // 보여준다 — 빈 설문을 그리지 않는다(§사용자 확정).
  if (state === "no_result") {
    return (
      <AppScreen header={<AppHeader onBack={goToResult} title="사용성 피드백" />}>
        <div className="space-y-4">
          <h1 className="text-page text-text-primary">먼저 투자 방법의 결과를 확인해주세요.</h1>
          <Button onClick={goToResult}>투자 리허설로 이동</Button>
        </div>
      </AppScreen>
    );
  }

  return (
    <AppScreen header={<AppHeader onBack={goToResult} title="사용성 피드백" />} scrollable>
      <p className="mb-1 text-caption font-medium text-text-tertiary">프로토타입 사용성 점검</p>

      {state === "already_submitted" ? (
        <div className="space-y-4">
          <h1 className="text-page text-text-primary">이미 의견을 보내주셨어요</h1>
          <p className="text-body text-text-secondary">같은 세션에서는 한 번만 응답을 받고 있어요.</p>
          <Button onClick={goToResult}>결과로 돌아가기</Button>
        </div>
      ) : state === "submitted" ? (
        <div className="space-y-4">
          <h1 className="text-page text-text-primary">의견을 보내주셔서 감사해요.</h1>
          <p className="text-body text-text-secondary">
            남겨주신 내용은 투자 리허설을 개선하는 데 사용할게요.
          </p>
          <Button onClick={goToResult}>결과 화면으로 돌아가기</Button>
        </div>
      ) : state === "error" ? (
        <div className="space-y-4">
          <h1 className="text-page text-text-primary">의견을 보내지 못했어요</h1>
          <p className="text-body text-text-secondary">{errorMessage ?? "입력한 내용은 그대로 두었어요. 잠시 후 다시 시도해주세요."}</p>
          <div className="space-y-2">
            <Button onClick={handleRetry}>다시 시도</Button>
            <Button variant="ghost" onClick={goToResult}>
              결과로 돌아가기
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="text-page text-text-primary">사용해보신 경험을 알려주세요</h1>
            <p className="mt-2 text-body text-text-secondary">
              별도 설명 없이 투자 방법을 만들고 결과를 확인한 경험을 묻는 짧은 설문이에요. 응답은
              프로토타입의 사용성을 개선하는 데만 활용해요.
            </p>
          </div>
          <FeedbackForm onSubmit={handleSubmit} submitting={state === "submitting"} />
        </div>
      )}
    </AppScreen>
  );
}
