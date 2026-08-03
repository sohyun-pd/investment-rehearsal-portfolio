/**
 * 세션 보존 — `sessionStorage` 전용.
 *
 * 결정(docs/product/STATE_FLOW_V1.md §18):
 *  - `plan` 과 사용자 입력만 sessionStorage 에 저장한다.
 *  - `candles` · `quote` · `simulation` · `alternatives` 는 저장하지 않는다(메모리/query cache).
 *  - 서버 세션과 DB 는 사용하지 않는다.
 *  - 새로고침 시 plan 을 복구한 뒤 market data 를 **재조회**한다.
 */
import type { AppFlowState } from "@/flow/appFlowState";
import { emptyAsset, type AppPlan } from "@/types/appPlan";

const STORAGE_KEY = "aiicp.session.v1";

/** 스키마가 바뀌면 올린다. 값이 다르면 복구하지 않고 버린다. */
const STORAGE_VERSION = 1;

export interface PersistedSession {
  storageVersion: number;
  sessionId: string;
  plan: AppPlan;
  /** 저장 시점의 흐름 상태. 복구 시 안전한 상태로 되돌린다. */
  flowState: AppFlowState;
  updatedAt: string;
}

/**
 * 복구 시 되돌릴 상태.
 *
 * 계산 결과와 market data 는 저장하지 않으므로, 결과 이후 상태는 그대로 복구할 수 없다.
 * `plan` 은 유지하고 재조회가 필요한 지점으로 되돌린다.
 */
export function recoverableFlowState(saved: AppFlowState): AppFlowState {
  switch (saved) {
    case "idle":
    case "plan_ready":
      return saved;

    // 진행 중이던 로딩과 명확화 대화는 직전 안정 상태로. clarifying 의 진행 상황(현재 질문·
    // 이미 확정된 필드)은 세션에 저장되지 않으므로(plan 에 없는 임시 상태) 이어갈 수 없다 —
    // originalInput 은 보존되므로 idle 로 돌아가면 다시 보낼 수 있다.
    case "interpreting_intent":
    case "clarifying":
      return "idle";

    // market data 가 없으므로 계획 확인 화면부터 다시.
    case "plan_confirmed":
    case "loading_market_data":
    case "simulating":
    case "analysis_ready":
    case "generating_alternatives":
    case "alternatives_ready":
    case "revised_plan_selected":
    case "replaying_revised_plan":
    case "completed":
      return "plan_ready";
  }
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function saveSession(session: Omit<PersistedSession, "storageVersion" | "updatedAt">): void {
  if (!isBrowser()) return;
  try {
    const payload: PersistedSession = {
      ...session,
      storageVersion: STORAGE_VERSION,
      updatedAt: new Date().toISOString(),
    };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 저장 실패(용량·프라이빗 모드)는 기능을 막지 않는다. 복구만 포기한다.
  }
}

/** `AppPlan.symbol`·`companyName`(평면) → `asset: AssetRef`(중첩) 로 바뀌기 전에 저장된 세션을
 * 위한 1회성 migration(§사용자 확정 — 국내 종목 지원 추가 시 market 이 없는 기존 저장 데이터를
 * 위한 migration 을 두라는 요청). 이 앱의 기존 관례(스키마가 바뀌면 STORAGE_VERSION 을 올려
 * 통째로 버림)보다, 진행 중이던 계획을 그냥 잃게 하지 않는 쪽을 택한다 — 옛 세션은 전부 미국
 * 종목만 있었으므로 `market: "US"` 로 안전하게 기본값을 둘 수 있다. */
export function migratePlanAsset(plan: unknown): AppPlan {
  const candidate = plan as Partial<AppPlan> & { symbol?: string; companyName?: string };
  if (candidate.asset !== undefined) return candidate as AppPlan;

  const legacySymbol = typeof candidate.symbol === "string" ? candidate.symbol : "";
  const legacyCompanyName = typeof candidate.companyName === "string" ? candidate.companyName : "";

  return {
    ...(candidate as AppPlan),
    asset:
      legacySymbol === "" && legacyCompanyName === ""
        ? emptyAsset()
        : { symbol: legacySymbol, displayName: legacyCompanyName, market: "US", quoteCurrency: "USD" },
  };
}

export function loadSession(): PersistedSession | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;

    const parsed = JSON.parse(raw) as Partial<PersistedSession>;
    if (parsed.storageVersion !== STORAGE_VERSION) return null;
    if (parsed.plan === undefined || parsed.sessionId === undefined) return null;
    if (parsed.flowState === undefined) return null;

    return {
      storageVersion: STORAGE_VERSION,
      sessionId: parsed.sessionId,
      plan: migratePlanAsset(parsed.plan),
      flowState: parsed.flowState,
      updatedAt: parsed.updatedAt ?? "",
    };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  if (!isBrowser()) return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}
