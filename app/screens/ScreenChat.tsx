/**
 * Screen 1+2 통합 — 채팅형 계획 생성 화면.
 *
 * 근거: 사용자 확정 — "Screen 1과 Screen 2를 별도 단계로 나눈 구조를 중단하고, 하나의
 * 대화형 계획 생성 화면으로 통합". 첫 진입·정상 질문·무효 입력·오류 복구를 모두 이 화면
 * 안에서 처리한다 — 화면 전환도, 1/5·2/5 단계 배지도, 별도 회색 오류 카드도 없다.
 *
 * 렌더링은 항상 `chatPhase`(§FlowProvider) 하나로 결정한다 — 여러 boolean 을 조합해
 * "지금 뭘 보여줄지"를 추론하지 않는다. 특히 `restorePending`(새로고침으로 저장된 계획을
 * 발견한 직후) 동안에는 바텀시트 외에 아무 입력 UI도 렌더하지 않는다 — deriveNextQuestion
 * (실제 interpret 호출)은 사용자가 "계속 수정하기"를 명시적으로 고른 뒤에만 실행된다
 * (재발했던 회귀: 복구 직후 자동으로 질문·로딩 말풍선이 나타났다).
 *
 * 시각 문법: 흰 배경, 사용자 말풍선은 액션 블루 단색, AI 말풍선은 옅은 중성 회색 + 작은
 * 아바타/이름, 선택지는 흰 배경 + 회색 아웃라인 칩, 입력창은 하단 고정 옅은 회색 알약
 * 모양. 녹색·연두색·쑥색 계열은 어디에도 쓰지 않는다.
 */
import * as React from "react";
import { AppHeader, AppScreen, TextLink } from "@/components/app/AppScreen";
import { DemoDataBadge } from "@/components/app/DemoDataBadge";
import { HelpBottomSheet } from "@/components/app/HelpBottomSheet";
import { PlanBottomSheet } from "@/components/app/PlanBottomSheet";
import { StartOverConfirmSheet } from "@/components/app/StartOverConfirmSheet";
import { Button } from "@/components/ui/button";
import { FieldMessage, TextInput } from "@/components/ui/textInput";
import { cn } from "@/lib/utils";
import { isMockAiEnabled } from "@/config/aiMode";
import { normalizeWeekdayInput, WEEKEND_REJECTION_MESSAGE } from "@/domain/simulation";
import {
  EDITABLE_REVIEW_PROMPT,
  hasAnyExtractedField,
  useFlow,
  type AssetDisambiguationState,
  type ChatTurn,
} from "@/flow/FlowProvider";
import {
  amountTooLowMessage,
  currencyMismatchMessage,
  hasMismatchedCurrencyMarker,
  MIN_AMOUNT_KRW,
  parseMoneyKrw,
  parsePercent,
  parseValidAmount,
} from "@/lib/answerParsers";
import { missingPlanRequirements, type AssetRef } from "@/types/appPlan";
import type { PlanInterpretFieldPath, PlanInterpretNextQuestion } from "@/types/planInterpret";
import { AssetSearchStep } from "@/screens/AssetSearchStep";
import { ReviseRequestPanel } from "@/screens/ReviseRequestPanel";

/** 하단에서 이 거리(px) 이내면 "맨 아래 근처"로 본다 — 새 메시지가 와도 강제로 끌어내리지
 * 않고, 이 범위 안일 때만 자동으로 따라간다(§3. 채팅 자동 스크롤). */
const NEAR_BOTTOM_THRESHOLD_PX = 120;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** reduce-motion 이면 항상 "auto"(즉시 이동) — smooth 애니메이션을 강제하지 않는다. */
function resolveScrollBehavior(intent: "smooth" | "auto"): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : intent;
}

function isNearBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_THRESHOLD_PX;
}

/**
 * "지금 이 순간 화면에 뜰 입력 UI가 정확히 하나"임을 명시적으로 강제하는 switch. `collecting`
 * 단계가 아니면(예: restorePending, editableReview) 무조건 "none" — 종목 검색이나 질문 칩이
 * 실수로라도 다른 단계에 새어 나가지 못한다.
 *
 * `isInterpreting`(다음 응답을 기다리는 중)일 때도 "none" 이다 — 그러지 않으면 `answer_field_start`
 * 가 아직 지우지 않은 이전 질문·선택지가 방금 답한 뒤에도(비활성화된 채로) 그대로 남아있는 것처럼
 * 보인다(§재발했던 회귀: 이전 질문 선택지가 남음). `needsAssetSearch` 는 이미 자체적으로
 * `interpretStatus === "ready"` 를 요구해 이 문제가 없었지만, structured_question 쪽에는 같은
 * 방어가 빠져 있었다.
 */
type QuestionUiKind = "asset_search" | "structured_question" | "multi_asset_disambiguation" | "none";

export function resolveQuestionUiKind(
  isCollecting: boolean,
  isInterpreting: boolean,
  needsAssetSearch: boolean,
  currentQuestion: PlanInterpretNextQuestion | null,
  // §복수 종목 입력 — 기존 호출부(테스트 포함)를 깨지 않도록 기본값을 둔다.
  needsAssetDisambiguation = false
): QuestionUiKind {
  if (!isCollecting || isInterpreting) return "none";
  switch (true) {
    case needsAssetDisambiguation:
      return "multi_asset_disambiguation";
    case needsAssetSearch:
      return "asset_search";
    case currentQuestion !== null:
      return "structured_question";
    default:
      return "none";
  }
}

const MAX_LENGTH = 500;
const MIN_LENGTH = 2;

const RECOVERY_EXAMPLES = ["네이버 매달 10만 원", "애플 매달 100달러", "삼성전자 매주 5만원, 10% 떨어지면 20만 더"];

const BOT_NAME = "똑대리";

function AiAvatar() {
  return (
    <img
      src="/assets/profile.png"
      alt=""
      aria-hidden
      className="h-6 w-6 shrink-0 rounded-full object-cover"
    />
  );
}

/** 첫 진입 안내 메시지 전용 크기 — 일반 대화 말풍선(균일한 max-w-[85%]·py-3)보다 조금 더
 * 넉넉하게 보이도록 별도 치수를 쓴다. */
const GREETING_SIZE_CLASS = "max-w-[82%] p-5";

/** dimExample 이면 문단을 "\n\n" 기준으로 나눠, 마지막 문단(입력 예시)만 한 단계 작고 옅은
 * 글자로 보여준다 — 버튼·링크·테두리 없이 순수 텍스트로만 구분한다(§사용자 확정: 예시를
 * 클릭 가능한 선택지가 아니라 입력 방법을 보여주는 문장으로만 제공). */
function ChatBubble({
  turn,
  greeting = false,
  dimExample = false,
  animateIn = false,
}: {
  turn: ChatTurn;
  /** 첫 진입 안내 메시지 전용 크기를 쓸지 여부. */
  greeting?: boolean;
  dimExample?: boolean;
  animateIn?: boolean;
}) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[80%] whitespace-pre-line rounded-3xl bg-action px-5 py-3 text-body text-action-text">
          {turn.text}
        </p>
      </div>
    );
  }

  const paragraphs = dimExample ? turn.text.split("\n\n") : [turn.text];

  return (
    <div className={cn("flex flex-col items-start gap-1.5", animateIn && "animate-message-in")}>
      <div className="flex items-center gap-1.5">
        <AiAvatar />
        <span className="text-caption text-text-tertiary">{BOT_NAME}</span>
      </div>
      <div
        className={cn(
          "space-y-2 rounded-3xl bg-surface",
          greeting ? GREETING_SIZE_CLASS : "max-w-[85%] px-5 py-3"
        )}
      >
        {paragraphs.map((paragraph, index) => (
          <p
            key={index}
            className={cn(
              "whitespace-pre-line",
              dimExample && index === paragraphs.length - 1
                ? "mt-1 text-caption text-text-tertiary"
                : "text-body text-text-primary"
            )}
          >
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}

/** 사용자가 메시지/수정 요청을 보낸 뒤 응답을 기다릴 때만 쓴다 — 부팅·복구 시에는 절대
 * 렌더하지 않는다(§로딩 말풍선 규칙). */
function TypingBubble() {
  return (
    <div className="flex flex-col items-start gap-1.5" aria-live="polite" aria-label="AI가 입력 중이에요">
      <div className="flex items-center gap-1.5">
        <AiAvatar />
        <span className="text-caption text-text-tertiary">{BOT_NAME}</span>
      </div>
      <div className="flex items-center gap-1.5 rounded-3xl bg-surface px-5 py-3.5">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-tertiary" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-tertiary [animation-delay:150ms]" />
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-text-tertiary [animation-delay:300ms]" />
      </div>
    </div>
  );
}

/** 회색 아웃라인 칩 — 선택지·예시 문장 공통 스타일(흰 배경 + 중성 회색 1px 테두리). */
function ChipButton({
  onClick,
  disabled,
  className,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-full border border-border bg-bg px-3.5 py-2 text-body font-medium text-text-primary transition-colors",
        "hover:border-action-text/20 hover:bg-hover-neutral active:bg-action-soft",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
    >
      {children}
    </button>
  );
}

/** 금액·평균 매수가 필드는 종목 통화(KRW/USD)에 맞는 예시를 보여준다(§사용자 확정 — 국내·
 * 미국 주식 통화 일치. 환율 변환은 하지 않고 종목에 맞는 통화 기호만 고른다). */
function placeholderFor(fieldPath: PlanInterpretFieldPath, currency: "USD" | "KRW"): string {
  switch (fieldPath) {
    case "recurring.weekday":
      return "예: 수요일";
    case "recurring.amountKrw":
    case "conditionalBuy.amountKrw":
    case "guardrails.monthlyBudgetKrw":
      return currency === "KRW" ? "예: 50만원, 1,000,000원" : "예: 50달러, $50";
    case "conditionalBuy.thresholdPercent":
      return "예: 12%, 7.5%";
    default:
      return "직접 입력";
  }
}

const AMOUNT_FIELD_PATHS: readonly PlanInterpretFieldPath[] = [
  "recurring.amountKrw",
  "conditionalBuy.amountKrw",
  "guardrails.monthlyBudgetKrw",
];

/** chips 는 예시일 뿐 입력 가능한 값의 한계가 아니다(§사용자 확정) — 모든 구조화 질문에는
 * chips 와 별개로 이 직접 입력창이 항상 함께 있다. 지금 질문이 무엇을 묻는지 이미 알고
 * 있으므로(fieldPath), Claude 전체 plan parser 를 다시 거치지 않고 로컬 파서로 그 자리에서
 * 값을 뽑는다(§13 금액·퍼센트 로컬 파서) — 왕복 지연도, chip 범위를 벗어난 값을 막을 일도 없다. */
function StructuredAnswerInput({
  fieldPath,
  currency,
  disabled,
  onSubmit,
}: {
  fieldPath: PlanInterpretFieldPath;
  /** 종목 통화 — 금액 필드의 파서·최소값·오류 문구를 전부 이 값 하나로 정한다. */
  currency: "USD" | "KRW";
  disabled: boolean;
  /** label 은 사용자가 실제로 입력한 원문 그대로다 — 대화 로그에는 파싱된 숫자("3000000")가
   * 아니라 사용자가 쓴 문구("300만원")가 그대로 남아야 한다. */
  onSubmit: (value: number | string, label: string) => void;
}) {
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();

  function submit() {
    const trimmed = text.trim();
    if (trimmed === "") return;

    if (fieldPath === "recurring.weekday") {
      const normalized = normalizeWeekdayInput(trimmed);
      if (normalized.kind === "weekend") {
        setError(WEEKEND_REJECTION_MESSAGE);
        return;
      }
      if (normalized.kind === "unrecognized") {
        setError("어느 요일인지 알아보지 못했어요. 예: 수요일");
        return;
      }
      onSubmit(normalized.value, trimmed);
      setText("");
      setError(null);
      return;
    }

    if (AMOUNT_FIELD_PATHS.includes(fieldPath)) {
      // 통화를 섞어 입력하면(예: 미국 주식에 "원") 조용히 잘못 파싱하는 대신 바로 알려준다
      // (§사용자 확정 — 국내·미국 주식 통화 일치).
      if (hasMismatchedCurrencyMarker(trimmed, currency)) {
        const mismatch = currencyMismatchMessage(currency);
        setError(`${mismatch.title} ${mismatch.example}`);
        return;
      }
      const parsed = parseValidAmount(trimmed, currency);
      if (parsed === null) {
        setError(amountTooLowMessage(currency));
        return;
      }
      onSubmit(parsed, trimmed);
      setText("");
      setError(null);
      return;
    }

    if (fieldPath === "conditionalBuy.thresholdPercent") {
      const parsed = parsePercent(trimmed);
      if (parsed === null || parsed <= 0 || parsed >= 100) {
        setError("0~100 사이의 하락률을 알아보지 못했어요. 예: 12%, 7.5%");
        return;
      }
      onSubmit(parsed, trimmed);
      setText("");
      setError(null);
      return;
    }

    onSubmit(trimmed, trimmed);
    setText("");
    setError(null);
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <TextInput
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (error !== null) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          disabled={disabled}
          placeholder={placeholderFor(fieldPath, currency)}
          aria-label="직접 입력"
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={error !== null ? errorId : undefined}
          tone={error !== null ? "error" : "default"}
          className="h-11"
        />
        <Button
          variant="secondary"
          size="sm"
          className="w-auto shrink-0"
          disabled={disabled || text.trim() === ""}
          onClick={submit}
        >
          적용
        </Button>
      </div>
      {error !== null ? (
        <FieldMessage tone="error" id={errorId}>
          {error}
        </FieldMessage>
      ) : null}
    </div>
  );
}

function formatKrwAmount(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}

/** "4주씩" → "4". 못 찾으면 빈 문자열(문구에서 자연스럽게 생략한다). */
function extractLeadingNumber(text: string): string {
  return text.match(/\d+/)?.[0] ?? "";
}

/** 직접 입력(커스텀 분배·수량 강제 확인) 한 줄짜리 금액 입력 — StructuredAnswerInput 과 같은
 * KRW 파서·최소 금액을 쓴다(§복수 종목 입력 단계에서는 종목이 아직 없어 통화를 모른다 —
 * AI 가 assetCandidates 를 채울 때 쓰는 recurring.amountKrw 와 마찬가지로 원화 기준으로만
 * 다룬다). */
function InlineAmountInput({
  placeholder,
  onConfirm,
}: {
  placeholder: string;
  onConfirm: (amount: number) => void;
}) {
  const [text, setText] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const errorId = React.useId();

  function submit() {
    const trimmed = text.trim();
    if (trimmed === "") return;
    const parsed = parseMoneyKrw(trimmed);
    if (parsed === null || parsed < MIN_AMOUNT_KRW) {
      setError(amountTooLowMessage("KRW"));
      return;
    }
    onConfirm(parsed);
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2">
        <TextInput
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            if (error !== null) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label="직접 입력"
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={error !== null ? errorId : undefined}
          tone={error !== null ? "error" : "default"}
          className="h-11"
        />
        <Button variant="secondary" size="sm" className="w-auto shrink-0" disabled={text.trim() === ""} onClick={submit}>
          확인
        </Button>
      </div>
      {error !== null ? (
        <FieldMessage tone="error" id={errorId}>
          {error}
        </FieldMessage>
      ) : null}
    </div>
  );
}

/**
 * §복수 종목 입력 — "애플테슬라 4주씩 40만원"처럼 한 문장에 종목이 2개 이상 등장하면, 일반
 * 파싱 실패 문구 대신 이 카드 하나로 종목·금액 배분·수량 모호성을 순서대로 확인한다(§사용자
 * 확정 — "여러 질문을 하나씩 긴 채팅으로 묻지 말고, 가능하면 하나의 확인 카드 안에서 선택").
 * AI 를 다시 부르지 않는다 — 전부 이 컴포넌트 안의 로컬 상태로만 진행하다가, 끝나면
 * `onResolve` 한 번으로 결과만 반영한다.
 */
function MultiAssetDisambiguationCard({
  disambiguation,
  onResolve,
}: {
  disambiguation: AssetDisambiguationState;
  onResolve: (assetQuery: string, amountKrw: number | null, summaryLabel: string) => void;
}) {
  const { candidates, amountKrw, ambiguousQuantityText } = disambiguation;
  const [selectedAsset, setSelectedAsset] = React.useState<string | null>(null);
  const [amountDecided, setAmountDecided] = React.useState(false);
  const [pendingAmount, setPendingAmount] = React.useState<number | null>(null);
  const [showCustomAmountInput, setShowCustomAmountInput] = React.useState(false);
  const [showForcedAmountInput, setShowForcedAmountInput] = React.useState(false);

  const quantityNumberText = ambiguousQuantityText !== null ? extractLeadingNumber(ambiguousQuantityText) : "";

  function summarize(asset: string, amount: number | null, extra?: string): string {
    const parts = [asset];
    if (amount !== null) parts.push(formatKrwAmount(amount));
    if (extra !== undefined) parts.push(extra);
    return parts.join(" · ");
  }

  function handleSelectAsset(name: string) {
    setSelectedAsset(name);
    if (amountKrw === null && ambiguousQuantityText === null) {
      onResolve(name, null, name);
    }
  }

  function finishAmountStep(amount: number) {
    setPendingAmount(amount);
    setAmountDecided(true);
    if (ambiguousQuantityText === null) {
      onResolve(selectedAsset as string, amount, summarize(selectedAsset as string, amount));
    }
  }

  function handleQuantityChoice(choice: "interval" | "count") {
    if (choice === "interval") {
      const extra = quantityNumberText !== "" ? `${quantityNumberText}주마다` : undefined;
      onResolve(selectedAsset as string, pendingAmount, summarize(selectedAsset as string, pendingAmount, extra));
      return;
    }
    setShowForcedAmountInput(true);
  }

  const needsAmountStep = selectedAsset !== null && amountKrw !== null && !amountDecided;
  const needsQuantityStep =
    selectedAsset !== null && ambiguousQuantityText !== null && (amountKrw === null || amountDecided);

  return (
    <div className="mt-5 space-y-5 rounded-card border border-border bg-surface p-4">
      <div>
        <p className="whitespace-pre-line text-body text-text-primary">
          {"한 번에 한 종목씩 확인할 수 있어요.\n먼저 확인할 종목을 선택해주세요."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {candidates.map((name) => (
            <ChipButton
              key={name}
              disabled={selectedAsset !== null}
              className={selectedAsset === name ? "border-action-text/40 bg-action-soft" : undefined}
              onClick={() => handleSelectAsset(name)}
            >
              {name}
            </ChipButton>
          ))}
        </div>
      </div>

      {needsAmountStep ? (
        <div>
          <p className="whitespace-pre-line text-body text-text-primary">
            {formatKrwAmount(amountKrw as number)}은 어떻게 나눠 투자하려고 했나요?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ChipButton onClick={() => finishAmountStep(amountKrw as number)}>
              선택한 종목에 {formatKrwAmount(amountKrw as number)}
            </ChipButton>
            <ChipButton onClick={() => finishAmountStep(Math.floor((amountKrw as number) / candidates.length))}>
              {candidates.length === 2 ? "두 종목에" : `${candidates.length}개 종목에`} 합쳐 {formatKrwAmount(amountKrw as number)}
            </ChipButton>
            <ChipButton onClick={() => setShowCustomAmountInput(true)}>직접 입력</ChipButton>
          </div>
          {showCustomAmountInput ? (
            <InlineAmountInput placeholder="예: 20만원" onConfirm={finishAmountStep} />
          ) : null}
        </div>
      ) : null}

      {needsQuantityStep ? (
        <div>
          <p className="whitespace-pre-line text-body text-text-primary">
            '{ambiguousQuantityText}'은 어떤 뜻인가요?
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ChipButton onClick={() => handleQuantityChoice("interval")}>
              {quantityNumberText !== "" ? `${quantityNumberText}주마다 투자` : "정기적으로 투자"}
            </ChipButton>
            <ChipButton onClick={() => handleQuantityChoice("count")}>
              한 번에 {quantityNumberText !== "" ? `${quantityNumberText}주` : "정해진 수량"} 매수
            </ChipButton>
          </div>
          {showForcedAmountInput ? (
            <div className="mt-3">
              <p className="text-caption text-text-secondary">
                {"현재는 금액으로 투자하는 계획만 확인할 수 있어요.\n매수 금액을 입력해주세요."}
              </p>
              <InlineAmountInput
                placeholder="예: 20만원"
                onConfirm={(amount) =>
                  onResolve(
                    selectedAsset as string,
                    amount,
                    summarize(selectedAsset as string, amount, `1회 ${quantityNumberText}주`)
                  )
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ScreenChat() {
  const {
    chatPhase,
    plan,
    interpretStatus,
    interpretFields,
    pendingAssetChangeQuery,
    currentQuestion,
    selectableAnswers,
    assetDisambiguation,
    conversationLog,
    invalidInputStreak,
    error,
    greetingRevealed,
    revealGreeting,
    submitIntent,
    answerCurrentQuestion,
    resolveAsset,
    resolveAssetDisambiguation,
    confirmPlanFromSheet,
    enterEditableReview,
    continueRestoredPlan,
    startOver,
    retry,
    back,
  } = useFlow();

  const [value, setValue] = React.useState("");
  const [startOverSheetOpen, setStartOverSheetOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const helpButtonRef = React.useRef<HTMLButtonElement | null>(null);

  const isRestorePending = chatPhase === "restorePending";
  const isCollecting = chatPhase === "collecting";
  const isEditableReview = chatPhase === "editableReview";

  // --- 첫 진입 안내 메시지 이후 입력창 지연 표시(§사용자 확정) -----------------------------
  // 안내 메시지가 뜨자마자 입력창이 겹쳐 나타나지 않도록 짧게 지연한다(아래 needsFreeInput 의
  // greetingRevealed 조건). 세션 복구 시에는 FlowProvider 가 greetingRevealed 를 이미 true 로
  // 시작해 이 타이머 자체가 발동하지 않는다.
  React.useEffect(() => {
    if (greetingRevealed) return;
    const timer = window.setTimeout(() => revealGreeting(), 200);
    return () => window.clearTimeout(timer);
  }, [greetingRevealed, revealGreeting]);

  const missing = missingPlanRequirements(plan);
  // 자유 입력 제출 뿐 아니라 버튼 답변의 응답 대기도 "AI가 응답 중"인 상태다 — 이 둘을
  // 하나로 안 보면, 답변을 기다리는 동안 이전 질문 칩이 계속 활성 상태로 남아 여러 번
  // 눌릴 수 있고, 그때마다 새 요청이 나가 서로를 무효화시킨다.
  const isInterpreting = isCollecting && interpretStatus === "loading";
  const isInterpretFailure =
    isCollecting && error !== null && (error.stage === "conversation" || error.stage === "plan_structure");

  // 이 바텀시트는 이제 restorePending(세션 복구) 전용이다 — §입력 방식 재설계 이후로는
  // 종목이 확정되는 순간 flowState 가 곧바로 "plan_ready"로 바뀌어(interpret_ready), 화면
  // 자체가 Screen3PlanConfirm 으로 전환된다. 즉 "collecting 중 더 물을 게 없어지는" 순간을
  // 이 화면이 직접 관찰할 일이 더는 없다 — 그 전에 이미 언마운트된다.
  const [sheetOpen, setSheetOpen] = React.useState(false);

  // restorePending 에 들어서면 무조건, 그리고 오직 이 이유로만 시트를 연다 — 완성/미완성과
  // 무관하다(§B. 저장된 계획이 있는 재진입). deriveNextQuestion 은 여기서 실행하지 않는다.
  React.useEffect(() => {
    if (isRestorePending) setSheetOpen(true);
  }, [isRestorePending]);

  // §복수 종목 입력 — 이 카드가 떠 있는 동안은 종목 검색·자유 입력창 둘 다 절대 같이 뜨면
  // 안 된다(§ScreenChat "지금 뜨는 입력 UI는 정확히 하나" 불변식). AI 재호출이 전혀 없어
  // interpretStatus 는 항상 "ready" 인 채로 유지된다.
  const needsAssetDisambiguation = isCollecting && interpretStatus === "ready" && assetDisambiguation !== null;

  // 종목 검색은 "AI 가 뭔가는 읽어냈는데(assetQuery 등) 아직 심볼이 없을 때" 또는 "이미 확정된
  // 종목을 대화 중 다른 회사명으로 바꾸려 할 때"(pendingAssetChangeQuery) 만 보여준다 —
  // collecting 단계에서만 해당하고, restorePending/editableReview 에서는 절대 켜지지 않는다.
  const needsAssetSearch =
    isCollecting &&
    interpretStatus === "ready" &&
    !needsAssetDisambiguation &&
    (pendingAssetChangeQuery !== null || (plan.asset.symbol.trim() === "" && hasAnyExtractedField(interpretFields)));
  // 자유 입력(하단 고정 입력창)은 "empty"(신규 진입)와 "collecting"(무효 입력 재시도 등)에서만
  // 보인다 — restorePending/editableReview 에서는 이 조건 자체가 애초에 해당하지 않는다.
  const needsFreeInput =
    (chatPhase === "empty" || isCollecting) &&
    !isInterpreting &&
    !needsAssetDisambiguation &&
    currentQuestion === null &&
    plan.asset.symbol.trim() === "" &&
    !hasAnyExtractedField(interpretFields) &&
    // 인사말 두 번째 말풍선이 나타나기 전까지는 입력창을 띄우지 않는다(§사용자 확정 — "이후
    // 입력창 활성화"). 세션 복구 시에는 greetingRevealed 가 이미 true 라 지연 없이 바로 뜬다.
    greetingRevealed;

  // --- 채팅 자동 스크롤(§3) ---------------------------------------------------------------
  const mainElRef = React.useRef<HTMLElement | null>(null);
  const bottomSentinelRef = React.useRef<HTMLDivElement | null>(null);
  const [nearBottom, setNearBottom] = React.useState(true);
  const [showJumpToLatest, setShowJumpToLatest] = React.useState(false);
  // 사용자 자신의 행동(메시지 전송·칩 선택·종목 선택) 직후에는 현재 스크롤 위치와 무관하게
  // 항상 맨 아래로 이동한다 — 다음 렌더의 스크롤 effect 가 이 깃발을 보고 한 번만 소비한다.
  const forceScrollNextRef = React.useRef(false);
  const isFirstScrollRef = React.useRef(true);
  const prevConversationLengthRef = React.useRef(conversationLog.length);

  function scrollToBottom(intent: "smooth" | "auto") {
    const el = mainElRef.current;
    if (el === null) return;
    el.scrollTo({ top: el.scrollHeight, behavior: resolveScrollBehavior(intent) });
  }

  // 스크롤 위치 추적 — 맨 아래 근처를 벗어나면(사용자가 과거 메시지를 읽으러 위로 스크롤)
  // 이후 새 내용은 강제로 끌어내리지 않고 "새 메시지 ↓" 버튼으로만 알린다.
  React.useEffect(() => {
    const el = mainElRef.current;
    if (el === null) return;
    function handleScroll() {
      const atBottom = isNearBottom(el!);
      setNearBottom(atBottom);
      if (atBottom) setShowJumpToLatest(false);
    }
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, []);

  // 모바일 키보드가 열리거나(visualViewport 높이 변화) 맨 아래 근처에 있었다면 계속 맨
  // 아래를 유지한다 — window.scrollTo 가 아니라 실제 chat container(main)를 스크롤한다.
  React.useEffect(() => {
    const vv = typeof window === "undefined" ? null : window.visualViewport;
    if (vv === null) return;
    function handleViewportResize() {
      if (nearBottom) scrollToBottom("auto");
    }
    vv.addEventListener("resize", handleViewportResize);
    return () => vv.removeEventListener("resize", handleViewportResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nearBottom]);

  // 대화 로그·현재 질문·응답 대기·종목 검색 여부가 바뀔 때마다 스크롤 여부를 판단한다.
  React.useEffect(() => {
    const el = mainElRef.current;
    if (el === null) return;

    const isFirst = isFirstScrollRef.current;
    isFirstScrollRef.current = false;

    const grew = conversationLog.length > prevConversationLengthRef.current;
    const delta = conversationLog.length - prevConversationLengthRef.current;
    prevConversationLengthRef.current = conversationLog.length;

    const forced = forceScrollNextRef.current;
    forceScrollNextRef.current = false;

    // 최초 진입 · 세션 복구 · 여러 메시지 동시 등장은 auto(즉시), 그 외 일반 추가는 smooth.
    const intent: "smooth" | "auto" = isFirst || isRestorePending || delta > 1 ? "auto" : "smooth";

    if (isFirst || forced || nearBottom) {
      scrollToBottom(intent);
      setShowJumpToLatest(false);
    } else if (grew || isInterpreting || needsAssetSearch) {
      setShowJumpToLatest(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationLog.length, currentQuestion, isInterpreting, needsAssetSearch, chatPhase]);

  function jumpToLatest() {
    scrollToBottom("smooth");
    setNearBottom(true);
    setShowJumpToLatest(false);
  }

  const bottomSheet = (
    <PlanBottomSheet
      open={sheetOpen}
      plan={plan}
      showConfirmButton={isRestorePending ? missing.length === 0 : true}
      confirmDisabledReason={!isRestorePending && missing.length > 0 ? `${missing.join(", ")} 확인이 더 필요해요` : null}
      onConfirm={confirmPlanFromSheet}
      onDismiss={() => {
        setSheetOpen(false);
        if (isRestorePending) {
          continueRestoredPlan();
        } else {
          enterEditableReview();
        }
      }}
      onStartOver={isRestorePending ? startOver : undefined}
      // restorePending: 미완성이면 이어서 질문을 받으므로 "계속 수정하기". 완성된 계획을 최종
      // 확인하는 중이면 자연어 수정으로 들어가므로 "계획 수정하기"로 문구를 구분한다.
      dismissLabel={isRestorePending ? "계속 수정하기" : "계획 수정하기"}
      title={isRestorePending ? undefined : "이 계획으로 확인할까요?"}
      // 계획 생성이 막 끝난 확인 시점에는 배경을 탭했다는 이유만으로 조용히 수정 모드에
      // 들어가면 안 된다 — 반드시 "최근 1년 가격에 적용하기"/"계획 수정하기" 중 하나를 명시적으로
      // 골라야 한다(§사용자 확정 — 생성 모드와 수정 모드가 섞이던 회귀). restorePending 은
      // 배경 탭 = "계속 수정하기"가 안전한 기본 동작이라 그대로 둔다.
      dismissible={isRestorePending}
    />
  );

  const startOverSheet = (
    <StartOverConfirmSheet
      open={startOverSheetOpen}
      onKeepEditing={() => setStartOverSheetOpen(false)}
      onStartOver={() => {
        setStartOverSheetOpen(false);
        startOver();
      }}
    />
  );

  const trimmed = value.trim();
  const tooLong = value.length > MAX_LENGTH;
  const sendDisabled = isInterpreting || trimmed.length < MIN_LENGTH || tooLong;

  function handleSend() {
    if (sendDisabled) return;
    // 사용자가 방금 보낸 메시지는 스크롤 위치와 무관하게 항상 맨 아래로 보여준다(§3).
    forceScrollNextRef.current = true;
    submitIntent(trimmed);
    setValue("");
  }

  function handleAnswerChip(answerValue: number | string, explicitLabel?: string) {
    forceScrollNextRef.current = true;
    answerCurrentQuestion(answerValue, explicitLabel);
  }

  function handleResolveAsset(asset: AssetRef) {
    forceScrollNextRef.current = true;
    resolveAsset(asset);
  }

  // 처음 한 번만 이해하지 못해도 곧바로 예시를 보여준다(§자유 입력 실패 처리 전면 수정 —
  // "편하게 적어보세요"라고 해놓고 두 번 실패할 때까지 예시조차 안 주는 건 불친절하다).
  const showRecovery = invalidInputStreak >= 1;

  // 이전 질문으로 돌아가기는 헤더 좌측 아이콘 하나로만 제공한다. 응답을 기다리는 중
  // (isInterpreting)에는 되돌아갈 대상 자체가 아직 확정되지 않았으므로 숨긴다(§async 요청
  // 중에는 back 비활성화). 최초 진입(empty)에는 애초에 needsAssetSearch/currentQuestion 이
  // 없으므로 자연히 비노출된다.
  const canGoBack =
    !isInterpreting && (needsAssetSearch || needsAssetDisambiguation || (isCollecting && currentQuestion !== null));
  const questionUiKind = resolveQuestionUiKind(
    isCollecting,
    isInterpreting,
    needsAssetSearch,
    currentQuestion,
    needsAssetDisambiguation
  );
  // "처음부터"는 전역 메뉴 항목이 아니라 지금 진행 중인 계획 작성 흐름을 리셋하는 액션이라,
  // 헤더가 아니라 선택 칩 영역(질문/응답 흐름) 안에 둔다(§사용자 확정 — 더보기(⋯) 메뉴에
  // 넣으면 기능을 찾으러 메뉴를 뒤져야 하는 것처럼 보인다). 헤더 우측에는 도움말만 남는다.
  const header = (
    <AppHeader
      title="투자 리허설"
      onBack={canGoBack ? back : undefined}
      backLabel="이전 질문으로 돌아가기"
      right={
        <button
          ref={helpButtonRef}
          type="button"
          aria-label="도움말"
          onClick={() => setHelpOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-full text-text-primary hover:bg-surface active:bg-surface-strong"
        >
          <span aria-hidden className="text-body font-medium">
            ?
          </span>
        </button>
      }
    />
  );

  let footer: React.ReactNode = null;
  if (needsFreeInput || isInterpretFailure) {
    footer = (
      <div className="flex items-end gap-2">
        <textarea
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSend();
            }
          }}
          rows={1}
          disabled={isInterpreting}
          className="min-h-12 flex-1 resize-none rounded-full border-none bg-surface px-5 py-3 text-body text-text-primary placeholder:text-text-tertiary shadow-none focus:shadow-none focus:outline-none focus:ring-0"
          placeholder="투자 방법을 적어주세요"
          aria-label="투자 생각 입력"
        />
        <Button size="md" className="w-auto rounded-full px-5" disabled={sendDisabled} onClick={handleSend}>
          전송
        </Button>
      </div>
    );
  }

  return (
    <>
      <AppScreen header={header} footer={footer} scrollable onMainRef={(el) => (mainElRef.current = el)}>
        <div className="space-y-5">
          {conversationLog.map((turn, index) => {
            // 첫 진입 안내 메시지(0번) 위에만 캐릭터 영상을 한 번 보여준다(§사용자 확정 —
            // 인사말 말풍선을 없애고 안내 문구 하나만 남기며, 큰 캐릭터 이미지도 한 번만 쓴다).
            if (index === 0) {
              return (
                <div key="greeting" className="space-y-3">
                  <p className="text-center text-card text-text-primary">
                    생각한 투자 방법,
                    <br />
                    지난 1년 결과로 확인해요
                  </p>
                  <video
                    src="/assets/smile.mp4"
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="mx-auto block h-[100px] w-auto"
                  />
                  <ChatBubble turn={turn} greeting dimExample animateIn />
                </div>
              );
            }
            return <ChatBubble key={index} turn={turn} />;
          })}
          {isInterpreting ? <TypingBubble /> : null}
        </div>

        {isInterpretFailure ? (
          <div className="mt-3">
            <TextLink onClick={retry}>다시 확인하기</TextLink>
          </div>
        ) : null}

        {/* 지금 뜨는 입력 UI는 정확히 하나다(resolveQuestionUiKind, 위 주석 참고). AssetSearchStep
            은 이 switch 가 "asset_search" 를 반환하지 않는 순간 DOM 에서 완전히 제거되어(=CSS
            로 숨기는 게 아니라 언마운트), 검색어·결과·오류·직접 입력 로컬 state 가 컴포넌트와
            함께 사라진다. */}
        {(() => {
          switch (questionUiKind) {
            case "multi_asset_disambiguation":
              if (assetDisambiguation === null) return null;
              return (
                <MultiAssetDisambiguationCard
                  disambiguation={assetDisambiguation}
                  onResolve={resolveAssetDisambiguation}
                />
              );
            case "asset_search":
              return (
                <div className="mt-5">
                  <AssetSearchStep
                    onSelect={handleResolveAsset}
                    initialQuery={pendingAssetChangeQuery ?? interpretFields.assetQuery ?? ""}
                  />
                </div>
              );
            case "structured_question": {
              if (currentQuestion === null) return null;
              // 정기·조건부 매수를 "할지 말지" 자체는 화면이 항상 고정된 두 선택지로만 묻는다
              // (§사용자 확정 — 이진 질문은 반드시 양쪽 선택지). AI 가 만든 selectableAnswers 를
              // 신경 쓰지 않는다 — 하나만 오거나 되묻는 문제가 여기서는 아예 생기지 않는다.
              const isRecurringEnabledQuestion = currentQuestion.fieldPath === "recurring.enabled";
              const isConditionalEnabledQuestion = currentQuestion.fieldPath === "conditionalBuy.enabled";
              return (
                <div className="mt-5">
                  <DemoDataBadge visible={isMockAiEnabled()} className="mb-2" />
                  {isRecurringEnabledQuestion ? (
                    <div className="flex flex-wrap gap-2">
                      <ChipButton disabled={isInterpreting} onClick={() => handleAnswerChip(1, "매주")}>
                        매주
                      </ChipButton>
                      <ChipButton disabled={isInterpreting} onClick={() => handleAnswerChip(0, "정기 매수 안 함")}>
                        정기 매수 안 함
                      </ChipButton>
                    </div>
                  ) : isConditionalEnabledQuestion ? (
                    <div className="flex flex-wrap gap-2">
                      <ChipButton disabled={isInterpreting} onClick={() => handleAnswerChip(1, "설정하기")}>
                        설정하기
                      </ChipButton>
                      <ChipButton disabled={isInterpreting} onClick={() => handleAnswerChip(0, "추가 매수 안 함")}>
                        추가 매수 안 함
                      </ChipButton>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-2">
                        {selectableAnswers.map((option) => (
                          <ChipButton
                            key={`${option.label}-${option.value}`}
                            disabled={isInterpreting}
                            onClick={() => handleAnswerChip(option.value)}
                          >
                            {option.label}
                          </ChipButton>
                        ))}
                      </div>
                      {/* chips 는 예시일 뿐이다 — 직접 입력창이 항상 함께 있다(§사용자 확정). */}
                      <StructuredAnswerInput
                        fieldPath={currentQuestion.fieldPath}
                        currency={plan.asset.quoteCurrency}
                        disabled={isInterpreting}
                        onSubmit={handleAnswerChip}
                      />
                    </>
                  )}
                </div>
              );
            }
            case "none":
              return null;
          }
        })()}

        {/* "새 투자 방법 만들기" — 지금 답하고 있는 선택 칩/보조 액션과 같은 영역 안, 그 바로
            아래 줄에 둔다(§사용자 확정 — 전역 메뉴가 아니라 지금 흐름을 리셋하는 액션이므로
            질문/응답 흐름 안에서 보여야 한다). 실제 답변 칩보다 눈에 띄지 않는 보조 텍스트
            버튼으로 — primary CTA 처럼 보이면 안 되고, 위 선택지 클릭을 방해하지 않게 간격을
            둔다. */}
        {questionUiKind !== "none" ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setStartOverSheetOpen(true)}
              className="text-caption text-text-tertiary underline underline-offset-4 hover:text-text-secondary"
            >
              새 투자 방법 만들기
            </button>
          </div>
        ) : null}

        {isEditableReview ? (
          <ReviseRequestPanel headline={EDITABLE_REVIEW_PROMPT} showExamples />
        ) : null}

        {needsFreeInput && showRecovery ? (
          <section className="mt-5 space-y-2">
            <div className="flex flex-wrap gap-2">
              {RECOVERY_EXAMPLES.map((example) => (
                <ChipButton
                  key={example}
                  disabled={isInterpreting}
                  onClick={() => {
                    forceScrollNextRef.current = true;
                    submitIntent(example);
                  }}
                >
                  {example}
                </ChipButton>
              ))}
            </div>
            <p className="text-caption text-text-tertiary">또는 직접 입력을 계속할 수 있어요</p>
          </section>
        ) : null}

        <div ref={bottomSentinelRef} aria-hidden />
      </AppScreen>
      {showJumpToLatest ? (
        // main 내부 스크롤 위치와 무관하게 항상 뷰포트 기준으로 떠 있어야 하므로 sticky 가
        // 아니라 fixed 를 쓴다(sticky 는 스크롤이 그 지점 근처에 와야만 "붙는다" — 맨 위로
        // 스크롤한 상태에선 전혀 보이지 않는 회귀가 있었다). footer(composer)가 떠 있으면
        // 그 위, 없으면 화면 하단 여백만큼 띄운다.
        <div
          className="pointer-events-none fixed inset-x-0 z-20 flex justify-center px-5"
          style={{
            bottom: `calc(env(safe-area-inset-bottom, 0px) + ${footer !== null ? "92px" : "20px"})`,
          }}
        >
          <button
            type="button"
            onClick={jumpToLatest}
            className="pointer-events-auto flex items-center gap-1 rounded-full border border-border bg-bg px-4 py-2 text-caption font-medium text-text-primary shadow-md hover:bg-hover-neutral"
          >
            새 메시지 ↓
          </button>
        </div>
      ) : null}
      {bottomSheet}
      {startOverSheet}
      <HelpBottomSheet open={helpOpen} onClose={() => setHelpOpen(false)} triggerRef={helpButtonRef} />
    </>
  );
}
