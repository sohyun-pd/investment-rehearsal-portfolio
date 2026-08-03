/**
 * POST /api/feedback — 공통 라우트 로직(런타임 무관).
 *
 * Node(Vite dev/preview 미들웨어, `server/apiPlugin.ts`)와 Cloudflare Pages Functions
 * (`functions/api/feedback.ts`) 양쪽에서 재사용한다.
 *
 * 원칙(사용자 확정):
 *  - 개인정보·실제 투자 정보(종목·금액·대화 전문·계정 정보)를 절대 받지 않는다 — 이 파일이
 *    받는 타입 자체가 그런 필드를 갖고 있지 않다.
 *  - 저장 endpoint 가 설정되지 않았으면 성공한 것처럼 속이지 않는다. 명확한 오류를 돌려준다.
 *  - AI 를 호출하지 않는다. 이 라우트는 순수 전달(fire-and-forward)만 한다.
 */
import type { RouteResult } from "./marketRoutes";

export type InvestmentExperience = "none" | "under_1_year" | "1_to_3_years" | "over_3_years";
export type ProductUnderstanding =
  | "recommendation"
  | "prediction"
  | "historical_rehearsal"
  | "automatic_order"
  | "unknown";
export type HardestStep =
  | "input"
  | "asset_search"
  | "conditional_rule"
  | "plan_confirmation"
  | "result"
  | "none";
export type OrderCapabilityUnderstanding = "yes" | "no" | "unknown";

export interface FeedbackSubmission {
  sessionId: string;
  investmentExperience: InvestmentExperience;
  productUnderstanding: ProductUnderstanding;
  reachedResult: boolean;
  hardestStep: HardestStep;
  resultComprehensionScore: 1 | 2 | 3 | 4 | 5;
  orderCapabilityUnderstanding: OrderCapabilityUnderstanding;
  /** 500자 제한(클라이언트에서도 강제하지만 서버가 최종 방어선이다). */
  openFeedback?: string;
}

const INVESTMENT_EXPERIENCE_VALUES: readonly InvestmentExperience[] = [
  "none",
  "under_1_year",
  "1_to_3_years",
  "over_3_years",
];
const PRODUCT_UNDERSTANDING_VALUES: readonly ProductUnderstanding[] = [
  "recommendation",
  "prediction",
  "historical_rehearsal",
  "automatic_order",
  "unknown",
];
const HARDEST_STEP_VALUES: readonly HardestStep[] = [
  "input",
  "asset_search",
  "conditional_rule",
  "plan_confirmation",
  "result",
  "none",
];
const ORDER_CAPABILITY_VALUES: readonly OrderCapabilityUnderstanding[] = ["yes", "no", "unknown"];

const MAX_OPEN_FEEDBACK_LENGTH = 500;

type ApiErrorStage = "feedback";

interface ApiProductError {
  stage: ApiErrorStage;
  code: string;
  userMessage: string;
  retryable: boolean;
}

function errorResult(status: number, error: ApiProductError): RouteResult {
  return { status, body: { error } };
}

function isValidSubmission(body: unknown): body is FeedbackSubmission {
  if (typeof body !== "object" || body === null) return false;
  const obj = body as Record<string, unknown>;

  if (typeof obj.sessionId !== "string" || obj.sessionId.trim() === "") return false;
  if (
    typeof obj.investmentExperience !== "string" ||
    !(INVESTMENT_EXPERIENCE_VALUES as readonly string[]).includes(obj.investmentExperience)
  ) {
    return false;
  }
  if (
    typeof obj.productUnderstanding !== "string" ||
    !(PRODUCT_UNDERSTANDING_VALUES as readonly string[]).includes(obj.productUnderstanding)
  ) {
    return false;
  }
  if (typeof obj.reachedResult !== "boolean") return false;
  if (typeof obj.hardestStep !== "string" || !(HARDEST_STEP_VALUES as readonly string[]).includes(obj.hardestStep)) {
    return false;
  }
  if (
    typeof obj.resultComprehensionScore !== "number" ||
    !Number.isInteger(obj.resultComprehensionScore) ||
    obj.resultComprehensionScore < 1 ||
    obj.resultComprehensionScore > 5
  ) {
    return false;
  }
  if (
    typeof obj.orderCapabilityUnderstanding !== "string" ||
    !(ORDER_CAPABILITY_VALUES as readonly string[]).includes(obj.orderCapabilityUnderstanding)
  ) {
    return false;
  }
  if (obj.openFeedback !== undefined) {
    if (typeof obj.openFeedback !== "string" || obj.openFeedback.length > MAX_OPEN_FEEDBACK_LENGTH) return false;
  }

  return true;
}

/** Google Apps Script Web App 설정. appsScriptUrl 이 있어야 실제로 전달을 시도한다 — 비어
 * 있으면 "아직 준비되지 않았다"고 정직하게 알린다(§가짜 성공 표시 금지). token 은 선택값이다
 * (§사용자 확정 — 연결된 Apps Script 의 doPost 가 별도 토큰 검증을 하지 않는 구조라, 토큰을
 * 새로 만들거나 필수로 요구하지 않는다). 비어 있으면 body 에 빈 문자열로 그대로 보낸다 —
 * 나중에 스크립트 쪽에서 토큰 검증을 추가하면 이 필드를 그대로 채워 쓸 수 있다. */
export interface FeedbackStorageConfig {
  appsScriptUrl: string;
  token: string;
}

/** package.json 의 version 과 같은 값을 수동으로 맞춘다 — 이 파일은 Node·Cloudflare Workers
 * 양쪽에서 도는 런타임 무관 코드라 `process`/`node:*`(package.json 동적 import 포함)를 쓸 수
 * 없다(파일 상단 설명 참고). */
const APP_VERSION = "0.0.1";

export async function handleFeedbackRoute(
  body: unknown,
  config: FeedbackStorageConfig,
  meta: { userAgent?: string } = {},
  fetchImpl: typeof fetch = fetch
): Promise<RouteResult> {
  if (!isValidSubmission(body)) {
    return errorResult(400, {
      stage: "feedback",
      code: "invalid_request",
      userMessage: "설문 응답 형식이 올바르지 않아요.",
      retryable: false,
    });
  }

  if (config.appsScriptUrl === "") {
    // 저장소가 아직 연결되지 않은 정상적인 상태다 — 서버 설정 문제이지 사용자 잘못이 아니다.
    return errorResult(503, {
      stage: "feedback",
      code: "storage_not_configured",
      userMessage: "설문 저장 설정이 아직 준비되지 않았어요. 잠시 후 다시 시도해주세요.",
      retryable: true,
    });
  }

  // §사용자 확정 — "허용된 필드만 추출": body 를 그대로 전달하지 않고, 설문 문항으로 검증된
  // 필드만 명시적으로 다시 나열한다. 실제 종목·투자 금액·currentPlan·개인정보는 이 타입
  // 자체에 애초에 없으므로(FeedbackSubmission), 여기서 무언가를 "빼는" 것이 아니라 "허용된
  // 것만 있는 객체"를 새로 만드는 구조다 — 클라이언트가 실수로 다른 필드를 얹어 보내도
  // 전달되지 않는다. Google Apps Script Web App 은 커스텀 Authorization 헤더 대신 요청
  // 본문(JSON) 안의 token 필드로 인증하는 관례가 일반적이라 이 방식을 따른다.
  try {
    const response = await fetchImpl(config.appsScriptUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: config.token,
        sessionId: body.sessionId,
        investmentExperience: body.investmentExperience,
        productUnderstanding: body.productUnderstanding,
        reachedResult: body.reachedResult,
        hardestStep: body.hardestStep,
        resultComprehensionScore: body.resultComprehensionScore,
        orderCapabilityUnderstanding: body.orderCapabilityUnderstanding,
        ...(body.openFeedback !== undefined ? { openFeedback: body.openFeedback } : {}),
        submittedAt: new Date().toISOString(),
        userAgent: meta.userAgent ?? "",
        appVersion: APP_VERSION,
      }),
    });

    if (!response.ok) {
      return errorResult(502, {
        stage: "feedback",
        code: "storage_request_failed",
        userMessage: "의견을 보내지 못했어요. 잠시 후 다시 시도해주세요.",
        retryable: true,
      });
    }

    return { status: 200, body: { ok: true } };
  } catch {
    return errorResult(502, {
      stage: "feedback",
      code: "network_failure",
      userMessage: "의견을 보내지 못했어요. 잠시 후 다시 시도해주세요.",
      retryable: true,
    });
  }
}
