/**
 * Screen 2 — 종목 검색(첫 단계, 명확화 질문보다 먼저 온다).
 *
 * 근거: docs/product/SCREEN_SPEC_V1.md Screen 2 §Data Source · §Error State(15.3)
 * 사용자 확정 — 국내 종목(한글명·6자리 코드)은 Twelve Data·Finnhub 모두 지원하지 않아 로컬
 * 인덱스(`@/data/market/koreanStocks`)로 찾는다. 영문명·미국 ticker 는 기존 Finnhub 검색을
 * 그대로 쓴다. 가격 데이터 provider 준비 여부와 검색 자체는 완전히 분리되어 있다 — 여기서
 * "가격을 못 가져온다"는 이유로 종목을 못 찾았다고 표시하지 않는다.
 *
 * 상태는 `StockSearchState` 하나로만 관리한다 — 여러 boolean 을 조합해 "지금 뭘 보여줄지"를
 * 추론하지 않는다(§ScreenChat.tsx 의 questionUiKind 와 같은 원칙).
 */
import * as React from "react";
import { DemoDataBadge } from "@/components/app/DemoDataBadge";
import { formatCompanyName } from "@/components/app/PlanCard";
import { Button } from "@/components/ui/button";
import { FieldMessage, Spinner, TextInput } from "@/components/ui/textInput";
import { cn } from "@/lib/utils";
import { isMockMarketEnabled } from "@/config/marketDataMode";
import { searchSymbols, type SymbolSearchResultDto } from "@/data/market/provider";
import { isMalformedCode, isSixDigitCode, searchKoreanStocks, type KoreanStockItem } from "@/data/market/koreanStocks";
import { containsHangul, normalizeSearchQuery } from "@/screens/koreanStockAlias";
import type { AssetRef } from "@/types/appPlan";

const DEBOUNCE_MS = 300;

/** 국내 종목·미국 종목 검색 결과를 화면 표시용으로 합친 공통 모양 — market·exchange 를 포함해
 * `AssetRef` 로 그대로 넘길 수 있게 한다(§사용자 확정 — 시장 판단은 검색 결과에서 받은 값
 * 하나로만 한다. 화면 문구나 종목명 문자열로 추측하지 않는다). */
interface UnifiedSearchResult {
  symbol: string;
  displayName: string;
  marketLabel: string;
  currency: "KRW" | "USD";
  market: AssetRef["market"];
  exchange?: AssetRef["exchange"];
}

type StockSearchState = "idle" | "typing" | "loading" | "results" | "selected" | "empty" | "invalid" | "error";

interface AssetSearchStepProps {
  onSelect: (asset: AssetRef) => void;
  /** AI 가 원문에서 읽어낸 종목 후보 텍스트(확정 아님). 검색창을 채우는 용도로만 쓴다. */
  initialQuery?: string;
}

const MARKET_LABEL: Record<KoreanStockItem["market"], string> = {
  KOSPI: "코스피",
  KOSDAQ: "코스닥",
};

const EXCHANGE_LABEL: Record<string, string> = {
  NASDAQ: "나스닥",
  NYSE: "뉴욕증권거래소",
};

function fromKoreanStock(item: KoreanStockItem): UnifiedSearchResult {
  return {
    symbol: item.symbol,
    displayName: item.nameKo,
    marketLabel: MARKET_LABEL[item.market],
    currency: "KRW",
    market: "KR",
    exchange: item.market,
  };
}

function fromFinnhubResult(dto: SymbolSearchResultDto): UnifiedSearchResult {
  return {
    symbol: dto.symbol,
    displayName: formatCompanyName(dto.companyName),
    marketLabel: dto.exchange !== null ? (EXCHANGE_LABEL[dto.exchange] ?? dto.exchange) : "미국 증시",
    currency: "USD",
    market: "US",
    exchange: dto.exchange ?? undefined,
  };
}

export function AssetSearchStep({ onSelect, initialQuery = "" }: AssetSearchStepProps) {
  const [query, setQuery] = React.useState(initialQuery);
  const [status, setStatus] = React.useState<StockSearchState>("idle");
  const [results, setResults] = React.useState<UnifiedSearchResult[]>([]);
  const [selected, setSelected] = React.useState<UnifiedSearchResult | null>(null);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const [retryNonce, setRetryNonce] = React.useState(0);

  const requestIdRef = React.useRef(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const statusRegionRef = React.useRef<HTMLDivElement | null>(null);
  // AI 가 원문에서 읽어낸 종목이 한 후보로 정확히 좁혀지면 클릭 없이 곧바로 확정한다(§입력
  // 방식 재설계 — 여러 후보가 있을 때만 채팅/선택 UI 를 쓴다). 사용자가 검색창을 직접 고쳐
  // 쓴 뒤에는(query !== initialQuery) 절대 자동 확정하지 않는다 — 타이핑 중 결과가 우연히
  // 1개로 줄어들었다고 화면이 멋대로 넘어가면 안 된다.
  const autoResolvedRef = React.useRef(false);
  // §중복 선택 방지 — 후보를 고르면 곧바로 이 ref 를 세운다. onSelect(부모의 resolveAsset)는
  // 동기 dispatch 라 리렌더 전에도 두 번째 클릭이 들어올 수 있다(빠른 연속 클릭·이중 탭) —
  // React state(status)만으로 막으면 그 사이 창이 있다. ref 는 렌더를 기다리지 않고 즉시
  // 반영되므로 같은 후보든 다른 후보든 첫 선택 이후의 호출을 전부 무시한다.
  const selectionLockedRef = React.useRef(false);

  const listboxId = React.useId();
  const messageId = React.useId();

  // 결과·오류·형식 오류 상태로 바뀔 때 한 번만 그 영역이 보이도록 스크롤한다(§자동 스크롤).
  // "typing"·"loading" 처럼 검색 도중 자꾸 바뀌는 상태에서는 반복 스크롤하지 않는다.
  React.useEffect(() => {
    if (status === "results" || status === "empty" || status === "invalid" || status === "error") {
      statusRegionRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [status]);

  React.useEffect(() => {
    const trimmed = query.trim();
    if (trimmed === "") {
      setStatus("idle");
      setResults([]);
      setActiveIndex(-1);
      return;
    }

    setStatus("typing");
    setActiveIndex(-1);

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      if (requestIdRef.current !== requestId) return;

      // 종목코드 검색(순수 숫자)인데 6자리가 아니면 — 네트워크 호출 없이 즉시 형식 오류.
      // "삼성" 같은 일반 한글 검색어는 숫자가 아니므로 이 분기에 해당하지 않는다.
      if (isMalformedCode(trimmed)) {
        setStatus("invalid");
        return;
      }

      const isInitialAutoQuery = trimmed === initialQuery.trim() && !autoResolvedRef.current;

      // 국내 종목(한글명·별칭·6자리 코드)은 로컬 인덱스로만 찾는다 — Twelve Data·Finnhub 둘 다
      // 한글 검색어를 지원하지 않아 그대로 보내면 항상 빈 결과가 온다.
      const koreanMatches = searchKoreanStocks(trimmed);
      if (koreanMatches.length > 0) {
        if (isInitialAutoQuery && koreanMatches.length === 1) {
          autoResolvedRef.current = true;
          selectResult(fromKoreanStock(koreanMatches[0]!));
          return;
        }
        setResults(koreanMatches.map(fromKoreanStock));
        setStatus("results");
        return;
      }
      // 6자리 코드인데 로컬 인덱스에 없으면(아직 등록 안 된 종목) 결과 없음으로 처리한다 —
      // 존재하지 않는 미국 ticker 검색으로 새지 않는다.
      if (isSixDigitCode(trimmed)) {
        setStatus("empty");
        return;
      }

      // 별칭 사전에도 없는 한글 검색어(예: 없는 회사 이름)는 여기서 끝낸다 — Finnhub·Twelve
      // Data 모두 한글을 이해하지 못해 그대로 보내면 오류처럼 보이는 응답만 돌아온다(§재발했던
      // 문제: 한글 원문을 provider 에 그대로 요청).
      const searchQuery = normalizeSearchQuery(trimmed);
      if (containsHangul(searchQuery)) {
        setStatus("empty");
        return;
      }

      // 여기까지 오면 영문명·미국 ticker 다 — 기존 Finnhub 검색으로 넘어간다.
      setStatus("loading");
      searchSymbols(searchQuery, controller.signal)
        .then((found) => {
          if (controller.signal.aborted || requestIdRef.current !== requestId) return;
          if (found.length === 0) {
            setStatus("empty");
            return;
          }
          if (isInitialAutoQuery && found.length === 1) {
            autoResolvedRef.current = true;
            selectResult(fromFinnhubResult(found[0]!));
            return;
          }
          setResults(found.map(fromFinnhubResult));
          setStatus("results");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted || requestIdRef.current !== requestId) return;
          // eslint-disable-next-line no-console
          console.error("[AssetSearchStep] 종목 검색 실패", error);
          setStatus("error");
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // retryNonce 는 값 자체를 쓰지 않고 같은 검색어로 재검색을 강제하는 용도다.
  }, [query, retryNonce]);

  function selectResult(result: UnifiedSearchResult) {
    // §중복 선택 방지 — 이미 한 번 선택을 처리했으면(같은 후보든 다른 후보든) 무시한다.
    if (selectionLockedRef.current) return;
    selectionLockedRef.current = true;
    setSelected(result);
    setStatus("selected");
    onSelect({
      symbol: result.symbol,
      displayName: result.displayName,
      market: result.market,
      exchange: result.exchange,
      quoteCurrency: result.currency,
    });
  }

  function retrySearch() {
    setRetryNonce((n) => n + 1);
  }

  function changeSelection() {
    selectionLockedRef.current = false;
    setSelected(null);
    setQuery("");
    setStatus("idle");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (status !== "results" || results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (event.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < results.length) {
        event.preventDefault();
        selectResult(results[activeIndex]!);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setStatus("idle");
      setActiveIndex(-1);
    }
  }

  const trimmedQuery = query.trim();
  const searching = status === "typing" || status === "loading";
  const activeOptionId = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  if (status === "selected" && selected !== null) {
    return (
      <div>
        <p className="mb-2 text-caption text-text-tertiary">어떤 종목에 투자하고 싶으신가요?</p>
        <div className="flex items-center justify-between rounded-card border border-border bg-surface px-4 py-4">
          <div>
            <p className="text-body font-semibold text-text-primary">{selected.displayName}</p>
            <p className="text-caption text-text-secondary">
              {selected.symbol} · {selected.marketLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={changeSelection}
            className="rounded-full px-3 py-2 text-caption font-medium text-text-secondary hover:bg-surface-hover"
          >
            변경
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <label htmlFor="stock-search-input" className="text-caption text-text-tertiary">
          어떤 종목에 투자하고 싶으신가요?
        </label>
        <DemoDataBadge visible={isMockMarketEnabled()} />
      </div>

      <TextInput
        id="stock-search-input"
        ref={inputRef}
        role="combobox"
        aria-expanded={status === "results"}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        aria-invalid={status === "invalid" ? true : undefined}
        aria-describedby={status === "invalid" || status === "empty" || status === "error" ? messageId : undefined}
        tone={status === "invalid" ? "error" : "default"}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="종목명 또는 종목코드 검색"
        autoFocus
        autoComplete="off"
        endAdornment={searching ? <Spinner /> : undefined}
      />

      <div ref={statusRegionRef} className="mt-2 scroll-mb-24">
        {status === "typing" || status === "loading" ? (
          <p className="text-caption text-text-tertiary">종목을 찾고 있어요</p>
        ) : status === "invalid" ? (
          <FieldMessage tone="error" id={messageId}>
            종목코드는 숫자 6자리로 입력해주세요.
          </FieldMessage>
        ) : status === "empty" ? (
          <InlineNotice
            id={messageId}
            tone="neutral"
            icon="🔎"
            title={`'${trimmedQuery}'와 일치하는 종목이 없어요`}
            description="종목명을 조금 더 정확히 입력하거나 6자리 종목코드를 입력해주세요."
            actionLabel="다시 검색"
            onAction={() => {
              setQuery("");
              window.requestAnimationFrame(() => inputRef.current?.focus());
            }}
          />
        ) : status === "error" ? (
          <InlineNotice
            id={messageId}
            tone="warning"
            icon="⚠️"
            title="지금은 종목 정보를 불러오지 못했어요"
            description="잠시 후 다시 시도해주세요."
            actionLabel="다시 시도"
            onAction={retrySearch}
            role="alert"
          />
        ) : status === "results" && results.length > 0 ? (
          <ResultList
            id={listboxId}
            results={results}
            activeIndex={activeIndex}
            onHover={setActiveIndex}
            onSelect={selectResult}
          />
        ) : null}
      </div>
    </div>
  );
}

function ResultList({
  id,
  results,
  activeIndex,
  onHover,
  onSelect,
}: {
  id: string;
  results: UnifiedSearchResult[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (result: UnifiedSearchResult) => void;
}) {
  return (
    <div>
      <p className="mb-2 text-caption text-text-tertiary">검색 결과 {results.length}개</p>
      <div
        id={id}
        role="listbox"
        aria-label="종목 검색 결과"
        className="divide-y divide-border overflow-hidden rounded-card border border-border bg-bg shadow-sm"
      >
        {results.map((result, index) => (
          <button
            key={result.symbol}
            id={`${id}-option-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            type="button"
            onMouseEnter={() => onHover(index)}
            onClick={() => onSelect(result)}
            className={cn(
              "flex min-h-16 w-full items-center justify-between px-4 py-3 text-left transition-colors",
              index === activeIndex ? "bg-surface-hover" : "hover:bg-surface-hover"
            )}
          >
            <span>
              <span className="block text-body font-semibold text-text-primary">{result.displayName}</span>
              <span className="block text-caption text-text-secondary">
                {result.symbol} · {result.marketLabel}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function InlineNotice({
  id,
  tone,
  icon,
  title,
  description,
  actionLabel,
  onAction,
  role,
}: {
  id?: string;
  tone: "neutral" | "warning";
  icon: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
  role?: "alert";
}) {
  return (
    <div
      id={id}
      role={role}
      aria-live={role === undefined ? "polite" : undefined}
      className="rounded-card border border-border bg-surface px-4 py-4"
    >
      <div className="flex gap-3">
        <span aria-hidden className="mt-0.5 shrink-0 text-body">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("text-body font-semibold", tone === "warning" ? "text-warning" : "text-text-primary")}>
            {title}
          </p>
          <p className="mt-1 text-caption text-text-secondary">{description}</p>
          <div className="mt-3">
            <Button variant="secondary" size="sm" className="w-auto" onClick={onAction}>
              {actionLabel}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
