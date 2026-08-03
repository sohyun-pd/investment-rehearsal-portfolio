/**
 * Screen 3. 계획 확인
 *
 * 근거: docs/product/SCREEN_SPEC_V1.md Screen 3
 * Primary CTA: 최근 1년 가격에 적용해보기
 *
 * 이 화면에서는 현재가를 호출하지 않는다. 시세가 보이면 "지금 사는 것"으로 읽힌다.
 */
import * as React from "react";
import { AppHeader, AppScreen, ScreenTitle } from "@/components/app/AppScreen";
import { BottomSheet } from "@/components/app/BottomSheet";
import { formatByCurrency, formatCompanyName, PlanCard } from "@/components/app/PlanCard";
import { ConditionalRuleEditor, MonthlyBudgetEditor, RecurringScheduleEditor } from "@/components/app/PlanFieldEditors";
import {
  MissingFieldsCard,
  validateMissingFieldsDraft,
  type ConditionalAmountGap,
  type MissingFieldsDraft,
  type MissingFieldsErrors,
  type RecurringGap,
} from "@/components/app/MissingFieldsCard";
import { NoticeLine } from "@/components/app/StateBlocks";
import { Button } from "@/components/ui/button";
import { fetchCandles } from "@/data/market/provider";
import { hasExecutableKrRecurringBuy } from "@/domain/simulation";
import { hasMismatchedCurrencyMarker, minAmountFor, parseValidAmount } from "@/lib/answerParsers";
import { computeAnalysisRange, useFlow } from "@/flow/FlowProvider";
import { AssetSearchStep } from "@/screens/AssetSearchStep";
import type { AppPlan, AssetRef } from "@/types/appPlan";
import { budgetConflictMessage, detectBudgetConflict, missingPlanRequirements, type RevisionTarget } from "@/types/appPlan";

const EMPTY_MISSING_FIELDS_ERRORS: MissingFieldsErrors = {
  frequency: null,
  executionDay: null,
  conditionalAmount: null,
  budget: null,
};

/** "asset" 은 이 화면 안에서 종목 검색 bottom sheet 를 여는 것으로 처리한다(§종목 수정 UX
 * 변경 — 채팅 화면으로 이동하지 않는다, stockEditOpen 참고). "general" 은 이 화면에 진입점이
 * 없다(§자연어 자유 수정은 editableReview 전용). "conditionalMaxCount" 도 여기서 다루지
 * 않는다 — 최대 횟수는 "conditionalRule" 시트 하나에서 함께 고친다(§사용자 확정 — 구역마다
 * 수정 링크를 하나만 둔다). */
type DirectEditTarget = Exclude<RevisionTarget, "asset" | "general" | "conditionalMaxCount">;

/** 정기 매수 금액이 이 값 이상이면(원화 기준) 오입력 가능성을 확인만 받는다 — 계산 자체를
 * 막지는 않는다(§큰 금액은 차단하지 말고 확인만 받는다). */
const LARGE_AMOUNT_THRESHOLD_KRW = 10_000_000;

interface KrRecurringFeasibility {
  status: "idle" | "loading" | "ready" | "error";
  /** status가 "ready"일 때만 의미가 있다 — 그 외에는 항상 true(경고를 보여주지 않는 쪽으로
   * 보수적으로 둔다). */
  executable: boolean;
}

const IDLE_FEASIBILITY: KrRecurringFeasibility = { status: "idle", executable: true };

/** §국내주식 0회 계획 사전 판정 — 시뮬레이션을 실제로 돌리기 전에, 최근 1년 동안 이 정기
 * 매수 금액으로 단 하루도 1주를 살 수 없는지 미리 확인한다(§국내주식 정수 수량 매수와 같은
 * 규칙). 결과 화면(Screen4Analysis)의 계산 정책·`confirmPlan()`/`fetchMarketData` 흐름은
 * 전혀 건드리지 않는다 — 이 화면 전용 로컬 조회다(confirmPlan 을 눌러 실제로 진행하면
 * candles 를 다시 받아온다). API 실패 시에는 경고를 띄우지 못하지만, 계획 확인 자체를
 * 막지 않는다 — confirmPlan() 이 이어서 같은 조회를 다시 시도하고 정상적인 오류 화면으로
 * 안내한다. */
function useKrRecurringFeasibility(plan: AppPlan): KrRecurringFeasibility {
  const [state, setState] = React.useState<KrRecurringFeasibility>(IDLE_FEASIBILITY);
  const { market, symbol } = plan.asset;
  const recurring = plan.recurring;
  const frequency = recurring?.frequency ?? null;
  const weekday = recurring?.frequency === "weekly" ? recurring.weekday : null;
  const dayOfMonth = recurring?.frequency === "monthly" ? recurring.dayOfMonth : null;
  const amountKrw = recurring?.amountKrw ?? null;

  React.useEffect(() => {
    if (market !== "KR" || symbol.trim() === "" || recurring === null || amountKrw === null) {
      setState(IDLE_FEASIBILITY);
      return;
    }
    let cancelled = false;
    setState({ status: "loading", executable: true });
    const { from, to } = computeAnalysisRange(new Date());
    fetchCandles(plan.asset, from, to)
      .then((result) => {
        if (cancelled) return;
        setState({ status: "ready", executable: hasExecutableKrRecurringBuy(result.candles, recurring, amountKrw) });
      })
      .catch(() => {
        if (cancelled) return;
        setState({ status: "error", executable: true });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, symbol, frequency, weekday, dayOfMonth, amountKrw]);

  return state;
}

export function Screen3PlanConfirm() {
  const {
    plan,
    interpretFields,
    simulation,
    confirmPlan,
    back,
    startOver,
    restoredFromSession,
    applyDirectPlanEdit,
    applyAssetEdit,
    assetCurrencyReentryRequired,
  } = useFlow();
  const [editingTarget, setEditingTarget] = React.useState<DirectEditTarget | null>(null);
  // §종목 수정 UX 변경(§사용자 확정) — "종목 변경"은 이 화면 위의 bottom sheet 로 처리한다.
  // 채팅 화면으로 이동하지 않고, 선택 전까지는 canonical plan 이 전혀 바뀌지 않는다 — 시트를
  // 닫기만 해도(취소) 아무 부작용이 없다.
  const [stockEditOpen, setStockEditOpen] = React.useState(false);
  const currency = plan.asset.quoteCurrency;

  function handleSelectNewAsset(asset: AssetRef) {
    applyAssetEdit(asset);
    setStockEditOpen(false);
  }

  // 결과를 이미 한 번 계산해봤다면(§조건 바꿔 다시 확인하기 등으로 되돌아온 경우) "말해주신
  // 내용을 정리했어요"라는 첫 정리 문구가 더 이상 맞지 않는다 — 그때는 기존 "이 계획대로
  // 투자했다면" 틀을 그대로 쓴다. AI 추출 직후 처음 이 화면에 오는 경우에만(§입력 방식
  // 재설계 §3·§8) 원문·AI 메시지·카드 셋만 보여준다.
  const isFreshFromExtraction = simulation === null && plan.originalInput !== "";
  const missing = missingPlanRequirements(plan);
  // 필수 항목이 다 채워졌어도, 한 번에 나가는 금액 자체가 월 예산을 넘으면 계산으로 넘어가지
  // 않는다(§사용자 확정 — "매수 금액이 월 예산을 넘어요" P0). 필수 항목 누락이 더 근본적인
  // 문제라 그게 있으면 그 문구를 먼저 보여준다.
  const conflict = missing.length === 0 ? detectBudgetConflict(plan) : null;
  const noBuyRule = plan.recurring === null && plan.conditionalBuy === null;

  // §자유 입력 실패 처리 전면 수정 — AI 가 정기 매수·조건부 매수 의도 자체는 이해했는데
  // 값 하나만 비어 있으면(예: 주기·금액은 알아냈지만 실행일만 모호함), "수정" 링크를 각각
  // 찾아 누르게 하지 않고 이 값(과 선택 항목인 월 예산)만 한 카드에서 모아 한 번에 묻는다.
  // 매주·매달 실행일은 서로 다른 값이라(§매주·매달 실행일 모델 분리) recurringGap.frequency 로
  // 어느 쪽 선택지를 보여줄지 정한다 — AI 가 주기 자체도 알아내지 못했으면(드묾) null 로 두고
  // 카드에서 먼저 주기를 고르게 한다.
  const recurringGap: RecurringGap =
    plan.recurring === null && interpretFields.recurring !== null && interpretFields.recurring.amountKrw !== null
      ? interpretFields.recurring.frequency === "weekly" && interpretFields.recurring.weekday !== null
        ? null
        : interpretFields.recurring.frequency === "monthly" && interpretFields.recurring.dayOfMonth !== null
          ? null
          : { frequency: interpretFields.recurring.frequency }
      : null;
  // §추가 매수 기준 가격 인터랙션 수정(§사용자 확정) — 평균 매수가는 더 이상 사용자에게 묻지
  // 않는다(백테스트 엔진이 실행된 매수 내역으로 직접 계산한다). 대신 조건부 매수 "금액"이
  // 최소 금액에 못 미치면(예: "200원 더") 그 금액만 고치게 한다.
  const conditionalAmountRaw = interpretFields.conditionalBuy?.amountKrw ?? null;
  const conditionalAmountGap: ConditionalAmountGap =
    plan.conditionalBuy === null &&
    interpretFields.conditionalBuy !== null &&
    interpretFields.conditionalBuy.thresholdPercent !== null &&
    conditionalAmountRaw !== null &&
    conditionalAmountRaw < minAmountFor(currency)
      ? { currentAmountKrw: conditionalAmountRaw }
      : null;
  // §추가 매수 기준 영역 경량화(§사용자 확정) — 평균 매수가 자동 계산 안내는 "확인해주세요"
  // 카드 안 큰 박스가 아니라, 계획 요약 바로 아래 가벼운 보조 문구 하나로만 보여준다. 조건부
  // 매수가 계획에 있는 한(완성 여부와 무관하게) 항상 보여준다 — 사용자가 손댈 값이 아니므로
  // "확인해주세요" 항목 수에는 넣지 않는다.
  const conditionalThresholdPercent =
    plan.conditionalBuy?.thresholdPercent ?? interpretFields.conditionalBuy?.thresholdPercent ?? null;
  const showMissingFieldsCard = recurringGap !== null || conditionalAmountGap !== null;

  // §국내주식 0회 계획 사전 판정(§사용자 확정 — "삼전 매달 5만원"처럼 파싱은 정상 성공했지만
  // 최근 1년 동안 그 금액으로 1주도 살 수 없는 계획을 계산 화면으로 넘기기 전에 미리 안내한다).
  // 계획이 아직 미완성(showMissingFieldsCard·noBuyRule)이거나 더 근본적인 예산 충돌(conflict)이
  // 있으면 그 문구가 우선한다 — 이 조회는 그 문구들이 전부 사라진, 계획이 완성된 뒤에만
  // 의미가 있다.
  const krFeasibility = useKrRecurringFeasibility(plan);
  const showZeroFeasibilityNotice =
    !showMissingFieldsCard &&
    !noBuyRule &&
    conflict === null &&
    krFeasibility.status === "ready" &&
    !krFeasibility.executable;

  // §국내 통화 입력 후 미국 종목 선택(§사용자 확정) — 종목 확정 시 통화가 안 맞으면 금액만
  // 지워진다(원문의 "원"·"달러" 표기와 실제 종목 통화가 다를 때, FlowProvider 의
  // clearAmountsIfCurrencyMismatched). 절대 환율로 자동 변환하지 않고, 절대 계획 전체를
  // 리셋하지 않는다 — 주기·요일·하락률처럼 통화와 무관한 값은 interpretFields 에 그대로
  // 남아 있고, 금액만 그 종목의 통화로 다시 입력받는다.
  const recurringNeedsCurrencyReentry =
    interpretFields.recurring !== null && interpretFields.recurring.amountKrw === null && interpretFields.recurring.frequency !== null;
  const conditionalNeedsCurrencyReentry =
    interpretFields.conditionalBuy !== null &&
    interpretFields.conditionalBuy.amountKrw === null &&
    interpretFields.conditionalBuy.thresholdPercent !== null;
  // hasMismatchedCurrencyMarker(원문 텍스트 휴리스틱, 최초 종목 확정용) 또는
  // assetCurrencyReentryRequired(§종목 수정 UX 변경 — 계획 확인 화면에서 직접 종목을 바꿔
  // 통화가 달라진 경우, 명시적 플래그) 둘 중 하나만 있어도 통화 재확인 상태다.
  const currencyMismatchAmountsCleared =
    (hasMismatchedCurrencyMarker(plan.originalInput, currency) || assetCurrencyReentryRequired) &&
    (recurringNeedsCurrencyReentry || conditionalNeedsCurrencyReentry);

  const [draft, setDraft] = React.useState<MissingFieldsDraft>({
    frequency: null,
    weekday: null,
    dayOfMonth: null,
    conditionalAmountText: conditionalAmountGap !== null ? String(conditionalAmountGap.currentAmountKrw) : "",
    budgetEnabled: false,
    budgetText: "",
  });
  const [draftErrors, setDraftErrors] = React.useState<MissingFieldsErrors>(EMPTY_MISSING_FIELDS_ERRORS);

  // §큰 금액은 차단하지 말고 확인만 받는다 — 값 자체는 이미 canonical plan 에 반영돼 있고,
  // 사용자가 "맞아요"를 누르기 전까지는 최종 계산으로 넘어가지만 못하게만 막는다.
  const showLargeAmountConfirm =
    !showMissingFieldsCard &&
    !noBuyRule &&
    currency === "KRW" &&
    plan.recurring !== null &&
    plan.recurring.amountKrw >= LARGE_AMOUNT_THRESHOLD_KRW;
  const [largeAmountConfirmed, setLargeAmountConfirmed] = React.useState(false);
  React.useEffect(() => {
    setLargeAmountConfirmed(false);
  }, [plan.recurring?.amountKrw]);

  const disabled =
    missing.length > 0 ||
    conflict !== null ||
    (showLargeAmountConfirm && !largeAmountConfirmed) ||
    showZeroFeasibilityNotice;

  function handleEditTarget(target: RevisionTarget) {
    if (target === "asset") {
      setStockEditOpen(true);
      return;
    }
    if (target === "general" || target === "conditionalMaxCount") return;
    setEditingTarget(target);
  }

  function applyAndClose(newPlan: Parameters<typeof applyDirectPlanEdit>[0]) {
    applyDirectPlanEdit(newPlan);
    setEditingTarget(null);
  }

  function submitMissingFields() {
    const errors = validateMissingFieldsDraft(draft, recurringGap, conditionalAmountGap, currency);
    if (
      errors.frequency !== null ||
      errors.executionDay !== null ||
      errors.conditionalAmount !== null ||
      errors.budget !== null
    ) {
      setDraftErrors(errors);
      return;
    }
    const resolvedFrequency = recurringGap?.frequency ?? draft.frequency;
    const newRecurring =
      recurringGap !== null
        ? resolvedFrequency === "weekly"
          ? { frequency: "weekly" as const, weekday: draft.weekday!, amountKrw: interpretFields.recurring!.amountKrw! }
          : { frequency: "monthly" as const, dayOfMonth: draft.dayOfMonth!, amountKrw: interpretFields.recurring!.amountKrw! }
        : plan.recurring;
    const newConditional =
      conditionalAmountGap !== null
        ? {
            thresholdPercent: interpretFields.conditionalBuy!.thresholdPercent!,
            amountKrw: parseValidAmount(draft.conditionalAmountText, currency)!,
          }
        : plan.conditionalBuy;
    const newBudget = draft.budgetEnabled ? parseValidAmount(draft.budgetText, currency) : null;
    applyDirectPlanEdit({
      ...plan,
      recurring: newRecurring,
      conditionalBuy: newConditional,
      guardrails: { ...plan.guardrails, monthlyBudgetKrw: newBudget },
    });
    setDraftErrors(EMPTY_MISSING_FIELDS_ERRORS);
  }

  return (
    <AppScreen
      header={<AppHeader onBack={back} step={3} />}
      footer={
        showMissingFieldsCard || noBuyRule ? (
          <Button variant="ghost" onClick={startOver}>
            처음부터 다시 적기
          </Button>
        ) : (
          <div className="space-y-2">
            <Button disabled={disabled} onClick={confirmPlan}>
              {missing.length > 0
                ? "빠진 항목을 확인해주세요"
                : conflict !== null
                  ? budgetConflictMessage(conflict).title
                  : showZeroFeasibilityNotice
                    ? "매수 금액을 확인해주세요"
                    : "최근 1년 결과 확인하기"}
            </Button>
            <Button variant="ghost" onClick={startOver}>
              처음부터 다시 적기
            </Button>
          </div>
        )
      }
    >
      {isFreshFromExtraction ? (
        <div className="mb-5 space-y-3">
          <div className="flex justify-end">
            <p className="max-w-[80%] whitespace-pre-line rounded-3xl bg-action px-5 py-3 text-body text-action-text">
              {plan.originalInput}
            </p>
          </div>
          <p className="max-w-[85%] whitespace-pre-line rounded-3xl bg-surface px-5 py-3 text-body text-text-primary">
            {"말해주신 내용을 계획으로 정리했어요.\n빠진 항목만 확인해주세요."}
          </p>
        </div>
      ) : (
        <ScreenTitle sub={"최근 1년 실제 가격으로\n평가손익과 매수 시점을 계산해요."}>
          이 계획대로 투자했다면,
          <br />
          결과가 어땠을까요?
        </ScreenTitle>
      )}

      {restoredFromSession ? (
        <div className="mb-5 rounded-md bg-surface px-4 py-3">
          <p className="text-caption text-text-secondary">
            이전에 작성하던 계획을 불러왔어요. 가격 데이터는 다시 가져올게요.
          </p>
        </div>
      ) : null}

      {showMissingFieldsCard ? (
        <>
          {/* 이미 이해한 값은 그대로 보여준다 — 방금 적은 내용이 사라진 것처럼 보이면 안 된다.
              §정보 순서: 1. 종목·정기 매수·추가 매수 요약 → 2. 평균 매수가 자동 계산 안내(작은
              보조 문구, 별도 박스 없음) → 3. "N가지만 확인해주세요"(MissingFieldsCard). */}
          <div className="mb-4 rounded-lg bg-surface px-4 py-3">
            <p className="text-caption text-text-tertiary">
              {formatCompanyName(plan.asset.displayName)} · {plan.asset.symbol}
            </p>
            <div className="mt-1 space-y-0.5 text-body text-text-primary">
              {interpretFields.recurring !== null && interpretFields.recurring.amountKrw !== null ? (
                <p>정기 매수 · {formatByCurrency(interpretFields.recurring.amountKrw, currency)}</p>
              ) : null}
              {interpretFields.conditionalBuy !== null &&
              interpretFields.conditionalBuy.thresholdPercent !== null &&
              interpretFields.conditionalBuy.amountKrw !== null ? (
                <p>
                  추가 매수 · 평균 매수가 대비 {interpretFields.conditionalBuy.thresholdPercent}% 하락 시{" "}
                  {formatByCurrency(interpretFields.conditionalBuy.amountKrw, currency)}
                </p>
              ) : null}
            </div>
          </div>
          {/* §추가 매수 기준 영역 경량화 — 별도 배경 박스 없이, "N가지만 확인해주세요"보다
              시각적으로 약한 작은 보조 문구 하나만 둔다(입력 필드처럼 보이지 않게). */}
          {conditionalThresholdPercent !== null ? (
            <p className="mb-4 text-caption text-text-tertiary">평균 매수가는 첫 정기 매수 이후 자동으로 계산돼요.</p>
          ) : null}
          <MissingFieldsCard
            currency={currency}
            recurringGap={recurringGap}
            conditionalAmountGap={conditionalAmountGap}
            draft={draft}
            onChange={(next) => {
              setDraft(next);
              setDraftErrors(EMPTY_MISSING_FIELDS_ERRORS);
            }}
            errors={draftErrors}
            onSubmit={submitMissingFields}
          />
        </>
      ) : noBuyRule ? (
        currencyMismatchAmountsCleared ? (
          // §국내 통화 입력 후 미국 종목 선택 / §종목 수정 UX 변경 — 두 경로(최초 종목 확정,
          // 계획 확인 화면에서 직접 종목 편집) 모두 여기로 온다. 어느 방향(KRW→USD·USD→KRW)
          // 이든 성립하는 문구를 쓴다(§사용자 확정 — 방향을 못박은 "미국 종목을 선택했어요"는
          // 반대 방향에서 틀린 문장이 된다). 주기·하락률 등은 이미 아는 채로 편집 시트를 열면
          // 채워져 있다(RecurringScheduleEditor/ConditionalRuleEditor 의 interpretFields
          // prefill) — 여기서는 통화가 안 맞아 지워진 금액만 다시 입력받는다는 사실만 안내한다.
          <div className="rounded-lg border border-border bg-bg px-5 py-6 text-center">
            <p className="whitespace-pre-line text-card text-text-primary">
              {"종목의 거래 통화가 바뀌었어요.\n투자 금액만 다시 확인해주세요."}
            </p>
            <p className="mt-2 text-body text-text-secondary">
              확인 항목:{" "}
              {[
                recurringNeedsCurrencyReentry ? "정기 매수 금액" : null,
                conditionalNeedsCurrencyReentry ? "추가 매수 금액" : null,
              ]
                .filter((label): label is string => label !== null)
                .join(" / ")}
            </p>
            <div className="mt-5 space-y-2">
              {recurringNeedsCurrencyReentry ? (
                <Button onClick={() => setEditingTarget("recurringSchedule")}>정기 매수 금액 입력하기</Button>
              ) : null}
              {conditionalNeedsCurrencyReentry ? (
                <Button variant="secondary" onClick={() => setEditingTarget("conditionalRule")}>
                  추가 매수 금액 입력하기
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          // AI 가 정기 매수·추가 매수 어느 쪽도 알아내지 못한 경우(예: "테슬라"만 입력) — 모아
          // 물을 부분 값 자체가 없다. "선택해주세요"가 가득한 계획 카드나 빨간 오류 박스를
          // 먼저 보여준 뒤 시트를 자동으로 여는 대신, 처음부터 차분한 안내와 버튼 하나만
          // 보여준다(§미완성 계획을 계획 확인 화면에 노출하지 않는다).
          <div className="rounded-lg border border-border bg-bg px-5 py-6 text-center">
            <p className="text-card text-text-primary">
              {formatCompanyName(plan.asset.displayName)}({plan.asset.symbol}) 매수 방법을 정해주세요
            </p>
            <p className="mt-2 text-body text-text-secondary">
              정기적으로 살지, 가격이 떨어지면 추가로 살지 선택할 수 있어요.
            </p>
            <div className="mt-5">
              <Button onClick={() => setEditingTarget("recurringSchedule")}>매수 방법 선택하기</Button>
            </div>
          </div>
        )
      ) : (
        <>
          {isFreshFromExtraction ? (
            <p className="mb-3 text-card text-text-primary">투자 계획을 확인해주세요</p>
          ) : null}

          {/* §큰 금액은 차단하지 말고 확인만 받는다 — 오입력 가능성이 있는 큰 금액(1,000만원
              이상)은 계산을 막지 않되, 맞는지 한 번 확인받는다. */}
          {showLargeAmountConfirm && !largeAmountConfirmed && plan.recurring !== null ? (
            <div className="mb-4 rounded-lg border border-border bg-surface px-4 py-4">
              <p className="whitespace-pre-line text-body text-text-primary">
                {`정기 매수 금액이 ${formatByCurrency(plan.recurring.amountKrw, currency)}으로 입력됐어요.\n맞는지 확인해주세요.`}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Button size="md" onClick={() => setLargeAmountConfirmed(true)}>
                  맞아요
                </Button>
                <Button variant="secondary" size="md" onClick={() => setEditingTarget("recurringSchedule")}>
                  금액 바꾸기
                </Button>
              </div>
            </div>
          ) : null}

          <PlanCard plan={plan} onEditTarget={handleEditTarget} />

          {/* §국내주식 0회 계획 사전 판정(§사용자 확정) — 예산 충돌(위 conflict, 데이터 정합성
              문제)과 달리 이 계획은 계산 자체는 가능하다(0회) — 그래서 "오류색"이 아닌 중립적
              색으로 두고, "0회 결과도 확인하기"로 그대로 진행할 길도 함께 준다. 매수 금액을
              보여주는 PlanCard 바로 아래(=매수 금액과 가까운 위치)에 둔다. */}
          {showZeroFeasibilityNotice ? (
            <div className="mt-6 rounded-lg border border-border bg-surface px-4 py-4">
              <p className="whitespace-pre-line text-body text-text-primary">
                {"최근 1년 가격에서는\n1주를 살 수 있는 매수일이 없어요."}
              </p>
              <div className="mt-4 space-y-2">
                <Button size="md" onClick={() => setEditingTarget("recurringSchedule")}>
                  금액 수정하기
                </Button>
                <Button variant="secondary" size="md" onClick={confirmPlan}>
                  0회 결과도 확인하기
                </Button>
              </div>
            </div>
          ) : null}

          {/* 예산 충돌 경고 — 단순 alert 로 끝내지 않고 어느 값을 고칠지 바로 고를 수 있게 두
              버튼을 같이 둔다(§사용자 확정). 이 충돌이 해결되기 전에는 위 footer CTA 가
              비활성 상태다. */}
          {conflict !== null ? (
            <div className="mt-6 rounded-lg border border-warning bg-surface px-4 py-4">
              <p className="text-card text-warning">{budgetConflictMessage(conflict).title}</p>
              <p className="mt-2 whitespace-pre-line text-body text-text-secondary">
                {budgetConflictMessage(conflict).description}
              </p>
              <div className="mt-4 space-y-2">
                <Button
                  size="md"
                  onClick={() => setEditingTarget(conflict.field === "recurring" ? "recurringSchedule" : "conditionalRule")}
                >
                  금액 수정하기
                </Button>
                <Button variant="secondary" size="md" onClick={() => setEditingTarget("monthlyBudget")}>
                  월 예산 수정하기
                </Button>
              </div>
            </div>
          ) : null}

          <div className="mt-6 space-y-3">
            <NoticeLine>최근 1년 일별 종가에 계획을 적용해 매수 시점과 월별 투자 금액을 계산해요.</NoticeLine>
            {/* §국내주식 정수 수량 매수(§사용자 확정 — P0 계산 오류 수정) — 국내주식만 이
                안내를 본다. 해외주식은 기존 소수점 매수를 그대로 쓰므로 이 문구가 필요 없다. */}
            {plan.asset.market === "KR" ? (
              <NoticeLine>
                <span className="whitespace-pre-line">
                  {"국내주식은 1주 단위로 계산해요.\n설정한 금액이 주가보다 낮으면 매수가 실행되지 않을 수 있어요."}
                </span>
              </NoticeLine>
            ) : null}
          </div>
        </>
      )}

      <RecurringScheduleEditor
        open={editingTarget === "recurringSchedule"}
        plan={plan}
        interpretFields={interpretFields}
        onApply={applyAndClose}
        onCancel={() => setEditingTarget(null)}
      />
      <ConditionalRuleEditor
        open={editingTarget === "conditionalRule"}
        plan={plan}
        interpretFields={interpretFields}
        onApply={applyAndClose}
        onCancel={() => setEditingTarget(null)}
      />
      <MonthlyBudgetEditor
        open={editingTarget === "monthlyBudget"}
        plan={plan}
        onApply={applyAndClose}
        onCancel={() => setEditingTarget(null)}
      />

      {/* §종목 수정 UX 변경(§사용자 확정) — "종목 변경"은 이 화면 위의 bottom sheet 로 연다.
          검색어는 비워 둔다(현재 종목명을 그대로 채우면 검색 결과가 그 종목 하나로 좁혀져
          §자동 확정 로직이 곧바로 같은 종목을 골라버린다 — 이게 "선택창이 0.2초 만에 닫히고
          계획 확인 화면으로 자동 복귀"의 실제 원인이었다). 선택 전까지는 canonical plan 이
          바뀌지 않고, 취소(배경 클릭·ESC·뒤로가기)해도 아무 부작용이 없다. */}
      <BottomSheet open={stockEditOpen} onClose={() => setStockEditOpen(false)} titleId="stock-edit-sheet-title" title="종목 변경">
        <AssetSearchStep onSelect={handleSelectNewAsset} initialQuery="" />
      </BottomSheet>
    </AppScreen>
  );
}
