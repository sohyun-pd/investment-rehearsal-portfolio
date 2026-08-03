import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";

import { isFeedbackEnabled } from "@/config/feedbackMode";
import { APP_ROOT_PATH } from "@/config/routePaths";
import { FeedbackPage } from "@/features/feedback/FeedbackPage";
import { FlowProvider, useFlow } from "@/flow/FlowProvider";
import { ScreenChat } from "@/screens/ScreenChat";
import { Screen3PlanConfirm } from "@/screens/Screen3PlanConfirm";
import { Screen4Analysis } from "@/screens/Screen4Analysis";
import { Screen4RevisedResult } from "@/screens/Screen4RevisedResult";
import { Screen5Compare } from "@/screens/Screen5Compare";
import { ScreenCompleted } from "@/screens/ScreenCompleted";

/** 플래그가 꺼져 있으면 설문 route 에 직접 접근해도 결과 화면으로 되돌린다(§사용자 확정 —
 * 완성되지 않은 배포에서는 route 자체를 막는다). */
function FeedbackRoute() {
  if (!isFeedbackEnabled()) return <Navigate to={APP_ROOT_PATH} replace />;
  return <FeedbackPage />;
}

// V1 프로토타입(구 화면). V2 흐름과 별개로 /legacy 아래에 남겨 둔다.
import { PlanInput } from "@/routes/PlanInput";
import { Analyzing } from "@/routes/Analyzing";
import { Clarify } from "@/routes/Clarify";
import { Review } from "@/routes/Review";
import { Confirm } from "@/routes/Confirm";
import { Complete } from "@/routes/Complete";
import { Process } from "@/routes/Process";

/**
 * 레이아웃: 중앙 최대 440px 앱 프레임.
 * 모바일 우선, 데스크톱에서는 프레임이 가운데 정렬된다.
 */
function Layout() {
  return (
    <div className="flex min-h-[100dvh] flex-col bg-surface-strong">
      <div className="mx-auto flex w-full max-w-[440px] flex-1 flex-col bg-bg">
        <Outlet />
      </div>
    </div>
  );
}

/**
 * 화면은 `AppFlowState` 가 결정한다(docs/product/STATE_FLOW_V1.md).
 * URL 라우팅으로 화면을 나누면 상태와 주소가 어긋날 수 있어, 흐름 상태를 단일 진실로 둔다.
 * 뒤로가기는 각 화면의 헤더 버튼이 담당한다(문서 §15.8 의 상태별 규칙).
 */
function FlowRouter() {
  const { screen } = useFlow();

  switch (screen) {
    case "screen_chat":
      return <ScreenChat />;
    case "screen3_plan":
      return <Screen3PlanConfirm />;
    case "screen4_analysis":
      return <Screen4Analysis />;
    case "screen4r_revised":
      return <Screen4RevisedResult />;
    case "screen5_compare":
      return <Screen5Compare />;
    case "screen_completed":
      return <ScreenCompleted />;
  }
}

export function App() {
  return (
    // FlowProvider 를 Routes 밖에 두어 라우트 전환에도 흐름 상태가 유지되게 한다.
    <BrowserRouter>
      <FlowProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route path={APP_ROOT_PATH} element={<FlowRouter />} />
            <Route path="/feedback" element={<FeedbackRoute />} />

            {/* V1 프로토타입 보관 */}
            <Route path="/legacy" element={<PlanInput />} />
            <Route path="/legacy/analyzing" element={<Analyzing />} />
            <Route path="/legacy/clarify" element={<Clarify />} />
            <Route path="/legacy/review" element={<Review />} />
            <Route path="/legacy/confirm" element={<Confirm />} />
            <Route path="/legacy/complete" element={<Complete />} />
            <Route path="/legacy/process" element={<Process />} />

            <Route path="*" element={<Navigate to={APP_ROOT_PATH} replace />} />
          </Route>
        </Routes>
      </FlowProvider>
    </BrowserRouter>
  );
}
