/**
 * 조건 수정 요청 — 자연어로 계획 변경을 요청하고, 서버가 만든 변경안을 확인한 뒤 적용한다.
 *
 * 근거: 사용자 확정(POST /api/plan/revise 원칙)
 *  - 변경 전/후 계획을 여기서 사용자에게 확인받은 뒤에만 적용한다.
 *  - AI 실패 시 기존 계획과 기존 결과를 그대로 둔다(오류만 이 패널 안에 표시).
 *  - 종목 변경 제안은 바로 적용하지 않는다 — 별도 확인 질문을 거친 뒤에만 Finnhub 재검색으로
 *    넘어간다(§여러 필드가 동시에 감지돼도 자동 적용하지 않는다).
 *  - 모호한 요청("좀 더 안전하게" 등)은 재질문으로 돌아온다 — 임의로 바꾸지 않는다.
 *
 * 렌더링은 전부 `revise.status`(§FlowProvider `RevisionStatus`) 하나로 결정한다 — 이 컴포넌트는
 * "열려 있는지"를 로컬 state로 따로 들고 있지 않는다(재발했던 회귀: 적용 완료 후에도 로컬
 * open 이 true 로 남아 입력창이 다시 나타났다). "다시 수정하기"를 직접 눌러야만 editing 으로
 * 돌아간다 — 적용 자체가 editing 을 다시 열지 않는다.
 *
 * `presentation="sheet"`(Screen4Analysis 결과 화면 전용, §사용자 확정): editing/parsing/preview/
 * applying/error 상태는 페이지 하단에 조용히 삽입되는 대신 BottomSheet 로 즉시 열린다 — 클릭
 * 해도 스크롤·포커스 이동이 없어 버튼이 고장 난 것처럼 보이던 문제를 고친다. idle(아무것도
 * 그리지 않음)과 applied(방금 반영된 변경 요약 — 더 이상 "편집 중"이 아니다)는 sheet 든 inline
 * 이든 항상 페이지 안에 그대로 그린다. ScreenChat 의 기존 inline 사용(headline/showExamples)은
 * `presentation` 기본값(inline)을 그대로 써서 전혀 바뀌지 않는다.
 */
import * as React from "react";
import { BottomSheet } from "@/components/app/BottomSheet";
import { formatCompanyName } from "@/components/app/PlanCard";
import { ErrorBlock } from "@/components/app/StateBlocks";
import { Button } from "@/components/ui/button";
import { useFlow } from "@/flow/FlowProvider";
import { krw } from "@/lib/simulationCopy";
import type { ReviseFieldChange } from "@/types/planRevise";

// 라벨은 PlanCard(요약 카드)·서버 fieldLabel()(planReviseRoute.ts)과 정확히 같은 명칭을 쓴다 —
// "정기 매수 금액"과 "조건부 매수 금액"이 다른 표현으로 갈리면 사용자가 어떤 필드가 바뀌는지
// 헷갈린다(§사용자 확정 — 조건부 매수금액 수정 요청이 다른 필드로 잘못 반영되던 문제).
const FIELD_LABELS: Record<string, string> = {
  assetQuery: "종목",
  recurring: "정기 매수",
  "recurring.amountKrw": "정기 매수 금액",
  "recurring.weekday": "정기 매수 요일",
  conditionalBuy: "조건부 매수",
  "conditionalBuy.thresholdPercent": "조건부 매수 기준",
  "conditionalBuy.amountKrw": "조건부 매수 금액",
  "guardrails.monthlyBudgetKrw": "월 예산",
};

const WEEKDAY_LABEL: Record<string, string> = {
  monday: "월요일",
  tuesday: "화요일",
  wednesday: "수요일",
  thursday: "목요일",
  friday: "금요일",
};

function formatChangeValue(fieldPath: string, value: number | string | null): string {
  if (value === null) return "설정 안 함";
  if (fieldPath === "recurring.weekday") return WEEKDAY_LABEL[String(value)] ?? String(value);
  if (typeof value === "string") return value;
  if (fieldPath === "conditionalBuy.thresholdPercent") return `${value}%`;
  return krw(value);
}

const TEXTAREA_CLASS =
  "w-full resize-none rounded-md border border-border bg-bg px-4 py-3 text-body text-text-primary placeholder:text-text-tertiary focus:border-border-strong focus:shadow-none focus:outline-none focus:ring-0";

/** ScreenChat 의 "수정 진입" 상태(§완성된 계획 복구·최종 확인 바텀시트 닫기)에서 곧바로
 * 시도해볼 수 있는 예시 — 클릭하면 실제 /api/plan/revise 를 호출한다(입력창만 채우지 않는다). */
const REVISE_EXAMPLES = ["월 예산을 바꿀래요", "조건부 매수 기준을 바꿀래요", "조건부 매수 금액을 바꿀래요"];

interface ReviseRequestPanelProps {
  /** 지정하면 패널 안내 문구를 이 텍스트로 바꾼다(기본: "조건을 어떻게 바꿀까요?"). */
  headline?: string;
  /** 제목 아래 보조 설명(선택) — sheet 프레젠테이션에서만 쓴다. */
  description?: string;
  /** true 면 자유 입력 위에 완성형 예시 칩을 보여준다. */
  showExamples?: boolean;
  /** 예시 칩 목록을 덮어쓴다. 지정하지 않으면 기존 REVISE_EXAMPLES 를 그대로 쓴다(ScreenChat
   * 호환 — 이 prop 을 새로 추가해도 기존 호출부는 바뀌지 않는다). */
  examples?: string[];
  /** true 면 idle 상태의 보조 링크("조건을 다르게 수정하고 싶어요")를 그리지 않는다 — 이미
   * 화면 footer 의 primary/secondary 버튼이 같은 startEditingRevision 진입점을 제공할 때(§Screen4
   * 결과 CTA 재설계) 같은 동작을 하는 링크를 중복으로 보여주지 않기 위해서다. 기본값 false. */
  hideIdleTrigger?: boolean;
  /** "inline"(기본, 기존 동작 그대로) | "sheet"(§Screen4 결과 화면 전용 — 즉시 여는 바텀시트). */
  presentation?: "inline" | "sheet";
}

function DiffRows({ changes }: { changes: ReviseFieldChange[] }) {
  return (
    <div className="divide-y divide-border">
      {changes.map((change) => (
        <div key={change.fieldPath} className="flex items-center justify-between gap-4 py-2.5">
          <span className="text-caption text-text-tertiary">{FIELD_LABELS[change.fieldPath] ?? change.fieldPath}</span>
          <span className="tnum text-body text-text-primary">
            {formatChangeValue(change.fieldPath, change.before)} → {formatChangeValue(change.fieldPath, change.after)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ReviseRequestPanel({
  headline,
  description,
  showExamples = false,
  examples,
  hideIdleTrigger = false,
  presentation = "inline",
}: ReviseRequestPanelProps = {}) {
  const { plan, revise, requestRevision, confirmRevision, dismissRevision, startEditingRevision } = useFlow();
  const [text, setText] = React.useState("");
  const exampleList = examples ?? REVISE_EXAMPLES;

  const { status, result, appliedChanges, error } = revise;

  const close = () => {
    dismissRevision();
    setText("");
  };

  // --- idle: 링크 하나만 ---------------------------------------------------------------
  if (status === "idle") {
    if (hideIdleTrigger) return null;
    return (
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={startEditingRevision}
          className="text-caption font-medium text-action-text underline underline-offset-4"
        >
          조건을 다르게 수정하고 싶어요
        </button>
      </div>
    );
  }

  // --- applied: 적용 완료 메시지 + 변경 요약 + "수정된 계획 보기"/"다시 수정하기" -----------
  // 입력창·확인 카드는 여기서 절대 렌더하지 않는다 — "다시 수정하기"를 직접 눌러야만
  // editing 으로 돌아간다(§재발했던 회귀).
  if (status === "applied") {
    return (
      <section className="mt-6 rounded-lg border border-border bg-surface px-5 py-4">
        <p className="mb-3 text-card text-text-primary">변경한 조건을 계획에 반영했어요.</p>
        {appliedChanges !== null && appliedChanges.length > 0 ? (
          <div className="mb-4">
            <DiffRows changes={appliedChanges} />
          </div>
        ) : null}
        <div className="flex gap-2">
          <Button size="md" onClick={dismissRevision}>
            수정된 계획 보기
          </Button>
          <Button variant="ghost" size="md" className="hover:bg-bg" onClick={startEditingRevision}>
            다시 수정하기
          </Button>
        </div>
      </section>
    );
  }

  // --- 나머지(editing/parsing/preview/applying/error)는 패널이 펼쳐진 상태 ----------------
  const sending = status === "parsing";
  const applying = status === "applying";
  const hasChanges = (status === "preview" || status === "applying") && result !== null && result.proposedChanges.length > 0;
  const hasAssetChange = hasChanges && result!.proposedChanges.some((change) => change.fieldPath === "assetQuery");
  const showClarifyingQuestion =
    (status === "editing" || status === "parsing") && result !== null && result.unresolvedFields.length > 0;

  // Enter 로 제출, Shift+Enter 로 줄바꿈(§ScreenChat 채팅 입력창과 같은 관례 — multiline
  // textarea 인데도 Enter 전송 정책이 앱 다른 곳과 충돌하지 않게 한다).
  function handleSubmitKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>, onSubmit: () => void) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  }

  const titleId = "revise-sheet-title";
  // sheet 프레젠테이션의 문구("이대로 다시 확인하기"/"변경 내용 확인하기" 등)는 inline 의
  // 짧은 문구("이대로 적용하기"/"취소")보다 길어서, 나란히 두면(flex gap-2) 절반 폭에서
  // 줄바꿈이 생긴다 — 이 앱의 다른 시트(PlanBottomSheet·StartOverConfirmSheet)와 같은 방식으로
  // sheet 에서는 세로로 쌓는다.
  const buttonRowClass = presentation === "sheet" ? "space-y-2" : "flex gap-2";
  const body = (
    <>
      {/* sheet 프레젠테이션에서는 BottomSheet 자신의 <h2> 가 이미 제목을 보여준다 — 여기서
          중복으로 그리지 않는다. inline(ScreenChat 기존 사용)은 그대로 문단으로 보여준다. */}
      {presentation === "inline" ? (
        <p className="mb-3 text-card text-text-primary">{headline ?? "조건을 어떻게 바꿀까요?"}</p>
      ) : null}
      {description !== undefined ? <p className="mb-3 text-body text-text-secondary">{description}</p> : null}

      {status === "error" ? (
        <ErrorBlock
          error={
            error ?? { stage: "conversation", code: "unknown", userMessage: "알 수 없는 오류가 발생했어요.", retryable: true }
          }
          onRetry={error?.retryable ?? true ? () => requestRevision(text) : undefined}
          secondary={
            <Button variant="ghost" size="md" className="hover:bg-bg" onClick={close}>
              닫기
            </Button>
          }
        />
      ) : hasChanges && result !== null ? (
        hasAssetChange ? (
          (() => {
            const assetChange = result.proposedChanges.find((change) => change.fieldPath === "assetQuery")!;
            const otherChanges = result.proposedChanges.filter((change) => change.fieldPath !== "assetQuery");
            // 조사("으로"/"로") 를 문자열로 붙이면 받침 유무에 따라 틀린 문장이 나온다(§재발했던
            // 회귀 — "종목을 AAPL에서 테슬라(으)로 바꿀까요?"). 조사가 필요 없는 "현재/변경할"
            // 2행 표시로 대신한다. before 도 티커(AAPL)가 아니라 실제 회사명을 보여준다 —
            // 아직 Finnhub 로 확정하지 않은 after(사용자가 말한 원문 텍스트)와 같은 위계로
            // 보이면 헷갈리므로, after 는 "검색해서 확인할 종목"이라는 걸 문장으로 분명히 한다.
            const currentAssetLabel =
              plan.asset.displayName !== ""
                ? `${formatCompanyName(plan.asset.displayName)} · ${plan.asset.symbol}`
                : "종목 미정";
            return (
              <div className="space-y-3">
                <p className="text-body text-text-secondary">{result.understoodRequest}</p>
                <div className="space-y-2">
                  <div>
                    <p className="text-caption text-text-tertiary">현재 종목</p>
                    <p className="text-body text-text-primary">{currentAssetLabel}</p>
                  </div>
                  <div>
                    <p className="text-caption text-text-tertiary">변경할 종목</p>
                    <p className="text-body text-text-primary">{String(assetChange.after)}</p>
                  </div>
                </div>
                {otherChanges.length > 0 ? (
                  <DiffRows changes={otherChanges} />
                ) : null}
                <p className="text-caption text-text-tertiary">
                  ⓘ 적용하기 전에 새 종목을 검색해 정확한 종목을 확인할게요.
                </p>
                <div className={buttonRowClass}>
                  <Button size="md" onClick={confirmRevision} disabled={applying} loading={applying}>
                    종목 검색하기
                  </Button>
                  <Button variant="ghost" size="md" className="hover:bg-bg" onClick={startEditingRevision} disabled={applying}>
                    다시 입력하기
                  </Button>
                </div>
              </div>
            );
          })()
        ) : (
          <div className="space-y-3">
            <p className="text-body text-text-secondary">{result.understoodRequest}</p>
            <DiffRows changes={result.proposedChanges} />
            <div className={buttonRowClass}>
              <Button size="md" onClick={confirmRevision} disabled={applying} loading={applying}>
                {presentation === "sheet" ? "이대로 다시 확인하기" : "이대로 적용하기"}
              </Button>
              <Button
                variant="ghost"
                size="md"
                className="hover:bg-bg"
                onClick={presentation === "sheet" ? startEditingRevision : close}
                disabled={applying}
              >
                {presentation === "sheet" ? "다시 입력하기" : "취소"}
              </Button>
            </div>
          </div>
        )
      ) : showClarifyingQuestion && result !== null ? (
        <div className="space-y-3">
          <p className="text-body text-text-primary">{result.unresolvedFields[0]?.question}</p>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => handleSubmitKeyDown(event, () => {
              if (text.trim() !== "" && !sending) requestRevision(text.trim());
            })}
            rows={3}
            className={TEXTAREA_CLASS}
            placeholder="예: 월 예산을 30만 원으로 바꿔줘"
            disabled={sending}
          />
          <div className={buttonRowClass}>
            <Button
              size="md"
              disabled={text.trim() === "" || sending}
              onClick={() => requestRevision(text.trim())}
              loading={sending}
            >
              {sending ? (presentation === "sheet" ? "변경 내용을 확인하고 있어요" : "확인하는 중") : "다시 요청하기"}
            </Button>
            <Button variant="ghost" size="md" className="hover:bg-bg" onClick={close} disabled={sending}>
              취소
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {showExamples ? (
            <div className="flex flex-wrap gap-2">
              {exampleList.map((example) => (
                <button
                  key={example}
                  type="button"
                  disabled={sending}
                  onClick={() => requestRevision(example)}
                  className="rounded-full border border-border bg-bg px-3.5 py-2 text-body font-medium text-text-primary hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {example}
                </button>
              ))}
            </div>
          ) : null}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => handleSubmitKeyDown(event, () => {
              if (text.trim() !== "" && !sending) requestRevision(text.trim());
            })}
            rows={3}
            className={TEXTAREA_CLASS}
            placeholder="예: 월 예산을 30만 원으로 바꿔줘"
            disabled={sending}
          />
          <div className={buttonRowClass}>
            <Button
              size="md"
              disabled={text.trim() === "" || sending}
              onClick={() => requestRevision(text.trim())}
              loading={sending}
            >
              {sending
                ? presentation === "sheet"
                  ? "변경 내용을 확인하고 있어요"
                  : "확인하는 중"
                : presentation === "sheet"
                  ? "변경 내용 확인하기"
                  : "요청 보내기"}
            </Button>
            <Button variant="ghost" size="md" className="hover:bg-bg" onClick={close} disabled={sending}>
              취소
            </Button>
          </div>
        </div>
      )}
    </>
  );

  if (presentation === "sheet") {
    return (
      <BottomSheet
        open
        onClose={close}
        titleId={titleId}
        title={headline ?? "조건을 어떻게 바꿀까요?"}
        dismissible={!sending && !applying}
      >
        {body}
      </BottomSheet>
    );
  }

  return <section className="mt-6 rounded-lg border border-border bg-surface px-5 py-4">{body}</section>;
}
