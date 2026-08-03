/**
 * AI 호출 라우트(plan/interpret · plan/revise · review) 공통 rate limit 로직.
 *
 * 실제 카운팅은 Cloudflare KV(`wrangler.jsonc` 의 `kv_namespaces` — binding
 * `AI_RATE_LIMIT_KV`)로 한다. Workers 전용 "Rate Limiting binding"(`ratelimits` 필드)을
 * 처음 시도했지만 Cloudflare **Pages** 프로젝트는 그 필드를 지원하지 않는다(config
 * validation 이 "Configuration file for Pages projects does not support 'ratelimits'"로
 * 거부한다 — 2026-07-31 실측). KV 는 Pages Functions 에서 오래전부터 지원되는 binding 이라
 * 이걸로 대체했다.
 *
 * 정확도 트레이드오프: KV 는 최종 일관성(eventually consistent)이라 여러 리전에서 거의
 * 동시에 요청이 몰리면 정확히 N회에서 막지 못하고 살짝 넘길 수 있다. 이 서비스에서는
 * "정상적인 1회 전체 흐름은 절대 막지 않되, 반복 호출 루프나 스크립트성 남용만 막는다"가
 * 목표라 이 정도 오차는 허용한다(과금이나 보안 경계가 아니라 단순 남용 방지 목적).
 *
 * binding 은 Cloudflare Pages Functions 런타임에서만 존재한다(로컬 Node dev 서버에는
 * 없다) — 그래서 이 파일은 Cloudflare 전용 타입을 직접 import 하지 않고 최소 `{get, put}`
 * 인터페이스만 요구한다(로컬에서는 호출부가 binding 이 undefined 라 그냥 건너뛴다).
 *
 * 원칙(사용자 확정):
 *  - 세션별 제한이 기본, IP 는 세션 ID 가 없을 때만 보조로 쓴다.
 *  - 공용 회사망처럼 같은 IP 를 쓰는 여러 사용자를 지나치게 막지 않는다 — 그래서 세션 ID 가
 *    있으면 IP 는 아예 섞지 않는다(세션 키 하나만으로 충분히 좁힌다).
 */
import type { RouteResult } from "./marketRoutes";

export interface RateLimitKvBinding {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

const SESSION_KEY_PREFIX = "session:";
const IP_KEY_PREFIX = "ip:";
/** 세션 ID 가 없는 요청(구버전 클라이언트 등)만 IP 로 대신한다 — 식별 실패 시 전부 같은
 * 버킷에 몰리지 않도록 고정 문자열로 폴백한다(그래도 완전히 막는 것보단 낫다). */
const UNKNOWN_KEY = "unknown";

/** 고정 시간창(fixed window) — 60초에 20회. 정상적인 1회 전체 흐름(계획 해석 몇 번 + 수정
 * 몇 번 + 리뷰 1번)은 절대 넘지 않으면서, 반복 호출 루프나 스크립트성 남용만 막는 수준이다. */
const WINDOW_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 20;

export function resolveRateLimitKey(sessionId: unknown, clientIp: string | null): string {
  if (typeof sessionId === "string" && sessionId.trim() !== "") {
    return `${SESSION_KEY_PREFIX}${sessionId.trim().slice(0, 128)}`;
  }
  if (clientIp !== null && clientIp.trim() !== "") {
    return `${IP_KEY_PREFIX}${clientIp.trim()}`;
  }
  return UNKNOWN_KEY;
}

/** 같은 (키, 시간창) 조합이면 항상 같은 KV 키가 된다 — 고정 시간창 카운터. */
export function resolveWindowKey(rateLimitKey: string, nowMs: number): string {
  const windowIndex = Math.floor(nowMs / (WINDOW_SECONDS * 1000));
  return `${rateLimitKey}:${windowIndex}`;
}

export function rateLimitedResult(): RouteResult {
  return {
    status: 429,
    body: {
      error: {
        stage: "conversation",
        code: "rate_limited",
        userMessage: "잠깐 사이에 요청이 너무 많았어요. 잠시 후 다시 시도해주세요.",
        retryable: true,
      },
    },
  };
}

/** binding 이 없으면(로컬 dev) 항상 통과시킨다 — 프로덕션(Cloudflare Pages Functions)에서만
 * 실제로 제한한다. */
export async function checkAiRateLimit(
  kv: RateLimitKvBinding | undefined,
  sessionId: unknown,
  clientIp: string | null
): Promise<RouteResult | null> {
  if (kv === undefined) return null;

  const key = resolveRateLimitKey(sessionId, clientIp);
  const windowKey = resolveWindowKey(key, Date.now());

  const current = await kv.get(windowKey);
  const count = current === null ? 0 : Number(current);
  if (Number.isFinite(count) && count >= MAX_REQUESTS_PER_WINDOW) {
    return rateLimitedResult();
  }

  // 다음 시간창으로 넘어가면 자연히 만료되게 TTL 을 2배로 둔다(경계 부근 오차 흡수용 여유).
  await kv.put(windowKey, String(count + 1), { expirationTtl: WINDOW_SECONDS * 2 });
  return null;
}
