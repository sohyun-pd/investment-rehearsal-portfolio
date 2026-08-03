/**
 * Screen 4. Historical Condition Replay 결과
 *
 * 근거: docs/product/SCREEN_SPEC_V1.md Screen 4
 * Primary CTA: 조정안 비교하기
 *
 * 로딩은 2단계로 무엇을 기다리는지 보여준다. AI 해석은 별도로 로드되며,
 * 실패해도 지표·차트를 막지 않는다.
 */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { AppHeader, AppScreen, TextLink } from "@/components/app/AppScreen";
import { PlanCard } from "@/components/app/PlanCard";
import { Button } from "@/components/ui/button";
import { isFeedbackEnabled } from "@/config/feedbackMode";
import { TOTAL_STEPS, type AppFlowState, type FlowError } from "@/flow/appFlowState";
import { useFlow } from "@/flow/FlowProvider";
import type { SimulationResult } from "@/domain/simulation";
import { AnalysisBody } from "@/screens/AnalysisBody";
import { PROCESSING_DONE_MESSAGE, PROCESSING_STEPS } from "@/lib/simulationCopy";

// 각 처리 단계가 화면에 머무는 최소 시간(§사용자 확정 350~500ms) — 실제 계산이 이보다 빨리
// 끝나도 문구가 순간적으로 스쳐 지나가지 않게 한다. 가짜 진행률을 만들지 않는다 — 문구 전환은
// 항상 실제 flowState 전이(또는 그 전이 직후의 최소 대기)에 맞춰서만 일어난다.
const PROCESSING_STEP_MIN_MS = 420;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "계산 중" 화면이 지금 보여줘야 할 문구와, 결과 화면으로 넘어가도 되는지를 결정한다.
 * flowState 3단계(loading_market_data·simulating·analysis_ready)만으로는 5개 문구를 모두
 * 구분할 실제 신호가 없어, `simulating` 안에서는 최소 시간이 지나면 다음 문구로 자동
 * 전환한다(§사용자 확정 — 같은 실제 계산을 두 문장으로 나눠 설명하는 것이지 지어낸 진행률이
 * 아니다). `analysis_ready` 에 도달하면 완료 문구를 최소 시간만큼 보여준 뒤에만 결과를 연다. */
function useProcessingDisplay(flowState: AppFlowState): { text: string; canReveal: boolean } {
  const [stepIndex, setStepIndex] = React.useState(0);
  const [showDone, setShowDone] = React.useState(false);
  const [canReveal, setCanReveal] = React.useState(false);

  // §재발했던 회귀 — "피드백 화면에서 결과 화면으로 돌아오면 무한 로딩" — 이 effect 는
  // [flowState] 의존성 배열만으로 이미 "flowState 가 실제로 바뀔 때만 다시 실행"을 보장한다.
  // 예전에는 그 위에 lastFlowState ref 로 한 번 더 같은 값이면 건너뛰는 방어를 얹어뒀는데,
  // React StrictMode(개발 모드)가 마운트 시 이 effect 를 "실행→클린업→실행"으로 한 번 더
  // 부르면 두 번째 실행이 이 ref 만 보고 조용히 아무것도 안 하고 return 해버렸다 — 그 사이
  // 첫 번째 실행은 이미 클린업(cancelled=true)된 상태라 setShowDone/setCanReveal 까지
  // 끝내지 못하고 멈춰서, analysis_ready 상태인데도 결과가 영영 안 열렸다(Screen4Analysis 를
  // 언마운트했다가 다시 마운트하는 상황 — 예: "사용성 피드백 남기기"로 이동했다 돌아오기 —
  // 에서 매번 재현됐다). ref 없이 의존성 배열만 믿으면 StrictMode 의 두 번째 실행도 끝까지
  // 완주해 정상적으로 canReveal 이 true 가 된다.
  React.useEffect(() => {
    let cancelled = false;

    async function run() {
      if (flowState === "plan_confirmed") {
        setStepIndex(0);
      } else if (flowState === "loading_market_data") {
        setStepIndex(1);
      } else if (flowState === "simulating") {
        setStepIndex(2);
        await sleep(PROCESSING_STEP_MIN_MS);
        if (cancelled) return;
        setStepIndex(3);
      } else if (flowState === "analysis_ready") {
        setStepIndex(4);
        await sleep(PROCESSING_STEP_MIN_MS);
        if (cancelled) return;
        setShowDone(true);
        await sleep(PROCESSING_STEP_MIN_MS);
        if (cancelled) return;
        setCanReveal(true);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, [flowState]);

  return { text: showDone ? PROCESSING_DONE_MESSAGE : (PROCESSING_STEPS[stepIndex] ?? PROCESSING_STEPS[0] ?? ""), canReveal };
}

/** ChatGPT 처럼 현재 단계 문구 하나만 보여주고 애니메이션 점 세 개로 "계산 중"임을
 * 나타낸다(§사용자 확정 — 이전 단계를 쌓아 보여주지 않는다). */
function ProcessingStatusLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-surface px-4 py-3" aria-live="polite">
      <span className="whitespace-pre-line text-body text-text-primary [word-break:keep-all]">{text}</span>
      <span className="inline-flex shrink-0 gap-0.5" aria-hidden>
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-tertiary [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-tertiary [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-text-tertiary" />
      </span>
    </div>
  );
}

/** 국내 종목 가격 데이터 미연결 화면의 문구 — 실제 provider·요금제명을 노출하지 않는다
 * (§사용자 확정). 상수로 빼서 화면을 렌더링하지 않고도 정확한 문구를 테스트할 수 있게 한다. */
export const MARKET_NOT_SUPPORTED_TITLE = "국내 종목의 가격 데이터는 아직 준비 중이에요";
export const MARKET_NOT_SUPPORTED_DESCRIPTION =
  "계획은 만들 수 있지만, 현재는 국내 종목의 최근 1년 가격에 적용할 수 없어요.";

export type AnalysisScreenKind = "market_not_supported" | "fatal_error" | "loading" | "ready";

/** Screen4Analysis 가 지금 어떤 화면을 그려야 하는지 결정하는 순수 함수 — JSX 렌더링과
 * 분리해 두면 렌더링 테스트 없이도(§이 저장소에는 컴포넌트 렌더링 테스트 도구가 없다) 분기
 * 로직 자체를 단위 테스트할 수 있다(ScreenChat.tsx 의 resolveQuestionUiKind 와 같은 패턴). */
export function resolveAnalysisScreenKind(
  error: FlowError | null,
  flowState: AppFlowState,
  simulation: SimulationResult | null
): AnalysisScreenKind {
  if (error !== null && error.stage === "historical_data" && error.code === "market_not_supported") {
    return "market_not_supported";
  }
  if (error !== null && (error.stage === "historical_data" || error.stage === "simulation")) {
    return "fatal_error";
  }
  if (flowState !== "analysis_ready" || simulation === null) {
    return "loading";
  }
  return "ready";
}

export interface ResultCtaCopy {
  /** 예산 초과가 없으면 이 결과가 마지막 단계다 — 존재하지 않는 5단계(비교)를 진행 표시에
   * 약속하지 않는다. */
  totalSteps: number;
  primaryLabel: string;
  secondaryLabel: string;
}

/** 결과 화면 footer 의 primary/secondary 버튼 문구와 전체 단계 수를 결정하는 순수 함수
 * (§사용자 확정 — 예산 초과 없음: 4/4, "조건 바꿔 다시 확인하기"/"새 투자 방법 만들기".
 * 예산 초과 + 유효한 대안 있음: 4/5, "예산 조정안 보기"/"조건 직접 고치기"). JSX 렌더링과
 * 분리해 이 저장소의 렌더링-테스트-없는 제약에서도 분기 자체를 단위 테스트할 수 있게 한다. */
export function resolveResultCtaCopy(hasBudgetIssue: boolean): ResultCtaCopy {
  if (hasBudgetIssue) {
    return { totalSteps: TOTAL_STEPS, primaryLabel: "예산 조정안 보기", secondaryLabel: "조건 직접 고치기" };
  }
  return { totalSteps: 4, primaryLabel: "조건 바꿔 다시 확인하기", secondaryLabel: "새 투자 방법 만들기" };
}

export function Screen4Analysis() {
  const {
    flowState,
    plan,
    marketData,
    simulation,
    quote,
    error,
    back,
    retry,
    retryQuote,
    editPlan,
    startAssetEditFromPlan,
    requestAlternatives,
    startOver,
  } = useFlow();
  const navigate = useNavigate();
  const processing = useProcessingDisplay(flowState);

  const header = <AppHeader onBack={back} step={4} />;
  const screenKind = resolveAnalysisScreenKind(error, flowState, simulation);

  // --- 국내 종목 가격 데이터 미연결: "재시도하면 될 것 같은 오류"가 아니라 "이 종목 자체를
  // 지금은 계산할 수 없다"는 별개의 종료 상태다(§사용자 확정 — 국내 종목을 미지원 취급하지
  // 않되, 지원하는 척도 하지 않는다). 일반 오류 화면(재시도·"조건 다시 확인하기")을 재사용하지
  // 않는다 — 계획 자체는 문제가 없고(재확인해도 똑같음), 가격 데이터가 아직 없을 뿐이다.
  // 결과 단계로 온 것처럼 보이면 안 되므로 진행 표시(step)도 붙이지 않는다.
  if (screenKind === "market_not_supported") {
    return (
      <AppScreen header={<AppHeader onBack={back} />}>
        <PlanCard plan={plan} collapsed className="mb-8" />
        <div className="rounded-lg border border-border bg-surface px-5 py-6">
          <p className="text-card text-text-primary">{MARKET_NOT_SUPPORTED_TITLE}</p>
          <p className="mt-2 text-body text-text-secondary">{MARKET_NOT_SUPPORTED_DESCRIPTION}</p>
          <div className="mt-4 space-y-2">
            <Button size="md" onClick={editPlan}>
              계획으로 돌아가기
            </Button>
            <Button variant="ghost" size="md" onClick={startAssetEditFromPlan}>
              다른 종목 선택하기
            </Button>
          </div>
        </div>
      </AppScreen>
    );
  }

  // --- 치명 오류: 과거 데이터·시뮬레이션 실패는 결과 화면 전체를 대체한다 ---
  if (screenKind === "fatal_error" && error !== null) {
    // 가격 데이터를 못 가져왔거나 계산 중 오류가 난 경우 전용 카드 — 어떤 오류든 같은 고정
    // 문구를 쓴다(§사용자 확정 정확한 문구). "투자금 0원"·"계산할 수 없어요" 같은 지표 카드로
    // 데이터 오류를 표현하지 않는다 — AnalysisBody 자체를 그리지 않고 이 카드로 화면 전체를
    // 대체한다.
    return (
      <AppScreen header={header}>
        <PlanCard plan={plan} collapsed className="mb-8" />
        <div className="rounded-lg border border-border bg-surface px-5 py-6" role="alert">
          <p className="text-card text-text-primary">결과를 불러오지 못했어요</p>
          <p className="mt-2 whitespace-pre-line text-body text-text-secondary">
            입력한 계획은 그대로 저장되어 있어요.
            {"\n"}잠시 후 다시 계산해주세요.
          </p>
          <div className="mt-4 space-y-2">
            {error.retryable ? (
              <Button size="md" onClick={retry}>
                다시 계산하기
              </Button>
            ) : null}
            <Button variant="ghost" size="md" onClick={editPlan}>
              계획 확인하기
            </Button>
          </div>
        </div>
      </AppScreen>
    );
  }

  // --- 계산 중: 단계 문구 하나만 보여주고 교체한다(§사용자 확정) --- (simulation === null 은
  // 항상 screenKind "loading" 이지만, TS 는 이 함수 호출만으로는 narrowing 하지 못해 아래에서
  // simulation 을 다시 한 번 명시적으로 확인한다. 결과가 실제로 준비돼도 완료 문구를 최소
  // 시간만큼 보여줄 때까지는(processing.canReveal) 계산 중 화면을 유지한다.)
  if (screenKind === "loading" || simulation === null || !processing.canReveal) {
    return (
      <AppScreen header={header}>
        <PlanCard plan={plan} collapsed className="mb-8" />
        <ProcessingStatusLine text={processing.text} />
      </AppScreen>
    );
  }

  // 예산을 실제로 넘긴 달이 있을 때만 "예산 조정안 보기"를 제안한다(§재발했던 회귀: 하나도
  // 넘지 않았는데도 이 CTA 가 항상 떠서, 마치 조정이 필요한 문제가 있는 것처럼 보였다). 이 결과가
  // 비교(5단계)로 이어지지 않으면 존재하지 않는 다음 단계를 진행 표시에 약속하지 않는다 —
  // "4/4"로 이 결과가 마지막 단계임을 그대로 보여준다(§사용자 확정 — 결과 CTA/단계 표시 재설계).
  const hasBudgetIssue = simulation.budgetExceededMonthCount > 0;
  const ctaCopy = resolveResultCtaCopy(hasBudgetIssue);

  // "사용성 피드백 남기기"는 내부 `/feedback` 화면으로 이동한다(§사용자 확정 — 외부 Google
  // Form 새 탭으로 보내지 않는다. 응답은 서버 BFF(POST /api/feedback)를 거쳐 Google Apps
  // Script → Google Sheet 로만 저장된다). 저장 endpoint 가 실제로 연결된 뒤에만
  // VITE_ENABLE_FEEDBACK=true 로 켠다(§껍데기 CTA 금지 원칙 그대로 — 꺼져 있으면 버튼 자체를
  // 그리지 않는다).
  const feedbackEnabled = isFeedbackEnabled();

  return (
    <AppScreen
      header={<AppHeader onBack={back} step={4} totalSteps={ctaCopy.totalSteps} />}
      // CTA 는 결과를 약속하지 않는다. 다음 화면이 하는 일(비교/조건 수정)만 말한다.
      footer={
        <div className="space-y-2">
          {/* "조건 바꿔 다시 확인하기"·"조건 직접 고치기"는 둘 다 같은 곳(계획 카드)으로
              이동한다(§사용자 확정 — 같은 plan edit 화면으로 가는 버튼을 중복해서 두지 않는다.
              이전에는 이 버튼이 결과 화면 안에서 자연어 수정 시트를 여는 별도 경로였다). */}
          <Button onClick={hasBudgetIssue ? requestAlternatives : editPlan}>{ctaCopy.primaryLabel}</Button>
          {/* "새 투자 방법 만들기"는 확인 모달 없이 곧바로 새 시작 화면으로 이동하며 기존
              계획·결과 state 를 완전히 초기화한다(§사용자 확정 — 결과 화면 Secondary 버튼은
              확인 절차 없이 바로 새로 시작한다). 이 버튼은 "조건 바꿔 다시 확인하기"(계획
              유지)와 역할·결과가 명확히 다르다(계획·결과 완전 초기화). */}
          <Button variant="ghost" onClick={hasBudgetIssue ? editPlan : startOver}>
            {ctaCopy.secondaryLabel}
          </Button>
          {feedbackEnabled ? (
            <div className="pt-1 text-center">
              <TextLink onClick={() => navigate("/feedback")}>사용성 피드백 남기기</TextLink>
            </div>
          ) : null}
        </div>
      }
    >
      <AnalysisBody
        result={simulation}
        companyName={plan.asset.displayName}
        priceCurrency={plan.asset.quoteCurrency}
        quote={quote}
        onRetryQuote={retryQuote}
        partialDataNotice={marketData?.completeness === "partial"}
        marketDataFetchedAt={marketData?.fetchedAt ?? ""}
        marketDataFallbackUsed={marketData?.fallbackUsed ?? false}
      />
    </AppScreen>
  );
}
