/**
 * Anthropic 구조화 출력 호출 공통 래퍼.
 *
 * `plan/interpret` · `plan/revise` · `review` 세 라우트가 같이 쓴다(중복 구현 금지).
 * Web 표준 API 만 쓴다 — Node(`server/apiPlugin.ts`)와 Cloudflare Pages Functions 양쪽에서
 * 재사용한다.
 *
 * §production 안정성 — timeout·재시도:
 *  - SDK 기본값(10분 timeout, 최대 2회 자동 재시도)은 Cloudflare Pages Function 의 실행
 *    시간 제한을 넘길 수 있어 그대로 쓰지 않는다. 명시적으로 timeout 을 짧게 두고, SDK 의
 *    자체 재시도(`maxRetries`)는 끈 뒤 이 파일이 직접 "최대 1회"만 재시도한다.
 *  - 429(rate limit)·5xx·네트워크 오류만 재시도 대상이다. 4xx(인증·요청 형식 오류)는 다시
 *    시도해도 같은 결과이므로 즉시 실패로 돌린다.
 *  - 429 응답에 `Retry-After` 헤더가 있고 그 값이 짧으면(초 단위, MAX_RETRY_DELAY_MS 이하)
 *    그만큼만 기다렸다가 한 번 재시도한다. 값이 없거나 너무 길면 기다리지 않고 바로 재시도해
 *    Function 자체가 오래 멈춰있지 않게 한다(무한정 기다리는 대신 실패를 사용자에게 정직하게
 *    돌려주고, 클라이언트의 "다시 시도" 버튼이 다음 재시도를 맡는다).
 */
const REQUEST_TIMEOUT_MS = 20_000;
/** Retry-After 가 이보다 길면 기다리지 않고 즉시 재시도한다(Function 자체를 오래 묶어두지
 * 않기 위해서다) — 그래도 "최대 1회 재시도"는 그대로 지킨다. */
const MAX_RETRY_DELAY_MS = 3_000;

export interface StructuredCallInput {
  apiKey: string;
  model: string;
  maxTokens: number;
  system: string;
  schema: Record<string, unknown>;
  userMessage: string;
}

export type StructuredCallResult =
  | { ok: true; rawText: string }
  | { ok: false; status: number | undefined; retryable: boolean };

interface Attempt {
  result: StructuredCallResult;
  /** 재시도 여부·대기 시간 판단에만 쓴다 — 바깥으로 노출하지 않는다. */
  rawError: unknown;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

/** Retry-After 는 초 단위 정수 또는 HTTP-date 문자열일 수 있다 — 이 서비스는 초 단위 정수만
 * 다룬다(HTTP-date 는 무시하고 기다리지 않는다, 어차피 대부분 초 단위로 온다). */
function extractRetryAfterMs(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("headers" in error)) return null;
  const headers = (error as { headers?: unknown }).headers;
  if (!(headers instanceof Headers)) return null;
  const raw = headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return seconds * 1000;
}

async function attemptOnce(input: StructuredCallInput): Promise<Attempt> {
  try {
    // 동적 import — 시장 데이터 라우트만 쓰는 호출 경로에서 SDK 로딩을 강제하지 않는다.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: input.apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 0 });

    const response = await client.messages.create({
      model: input.model,
      max_tokens: input.maxTokens,
      system: input.system,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: input.schema },
      },
      messages: [{ role: "user", content: input.userMessage }],
    });

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return { result: { ok: false, status: undefined, retryable: true }, rawError: null };
    }
    return { result: { ok: true, rawText: textBlock.text }, rawError: null };
  } catch (error) {
    const status = extractHttpStatus(error);
    const retryable = status === undefined || status === 429 || status >= 500;
    return { result: { ok: false, status, retryable }, rawError: error };
  }
}

export async function callClaudeStructured(input: StructuredCallInput): Promise<StructuredCallResult> {
  const first = await attemptOnce(input);
  if (first.result.ok || !first.result.retryable) return first.result;

  // 여기 도달하면 429·5xx·네트워크 오류다 — 정확히 한 번만 재시도한다(무한 재시도 금지).
  const retryAfterMs = extractRetryAfterMs(first.rawError);
  const delayMs = retryAfterMs !== null && retryAfterMs <= MAX_RETRY_DELAY_MS ? retryAfterMs : 0;
  if (delayMs > 0) await sleep(delayMs);
  return (await attemptOnce(input)).result;
}
