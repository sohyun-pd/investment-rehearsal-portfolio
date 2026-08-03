/**
 * production 최소 요청 로그 — §production 안정성.
 *
 * Cloudflare Pages Functions 의 `console.log` 출력은 Workers Logs(`observability.enabled`,
 * `wrangler.jsonc`)로 그대로 수집된다 — 별도 저장소를 새로 만들지 않는다.
 *
 * 남기는 것: request id · route · status · 처리 시간(ms) · 외부 API 오류 코드 · fallback
 * 사용 여부뿐이다. 사용자 원문·AI 응답 원문·API 키·개인정보는 절대 로그에 넣지 않는다 —
 * 그래서 이 함수는 애초에 그런 값을 받는 파라미터 자체가 없다.
 */
export interface RequestLogEntry {
  route: string;
  status: number;
  durationMs: number;
  /** 외부 API(Anthropic·Finnhub·Twelve Data·Yahoo·Apps Script) 오류 코드 — 없으면 생략. */
  errorCode?: string;
  /** 저장된 스냅샷으로 대체됐는지(시장 데이터 라우트 전용) — 없으면 생략. */
  fallbackUsed?: boolean;
}

let counter = 0;

/** 요청마다 짧은 고유 id 를 만든다 — 분산 트레이싱용 UUID 가 아니라, 같은 배치 로그 안에서
 * 어떤 줄들이 한 요청에 속하는지 구분하는 용도다. */
export function nextRequestId(): string {
  counter += 1;
  return `req_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/** RouteResult.body 가 `{error:{code}}` 모양이면 그 code 만 뽑아낸다 — 없으면 undefined. */
export function extractErrorCode(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

export function logRequestOutcome(requestId: string, entry: RequestLogEntry): void {
  console.log(
    JSON.stringify({
      requestId,
      route: entry.route,
      status: entry.status,
      durationMs: entry.durationMs,
      ...(entry.errorCode !== undefined ? { errorCode: entry.errorCode } : {}),
      ...(entry.fallbackUsed !== undefined ? { fallbackUsed: entry.fallbackUsed } : {}),
    })
  );
}
