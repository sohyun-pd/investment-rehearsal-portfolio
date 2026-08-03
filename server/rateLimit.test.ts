/**
 * server/rateLimit.ts 단위 테스트.
 *
 * 실행: npm run test:ratelimit
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  checkAiRateLimit,
  rateLimitedResult,
  resolveRateLimitKey,
  resolveWindowKey,
  type RateLimitKvBinding,
} from "./rateLimit";

function fakeKv(initial: Record<string, string> = {}): RateLimitKvBinding & { store: Record<string, string> } {
  const store = { ...initial };
  return {
    store,
    get: async (key) => store[key] ?? null,
    put: async (key, value) => {
      store[key] = value;
    },
  };
}

test("세션 ID 가 있으면 세션 키를 쓰고 IP 는 섞지 않는다", () => {
  assert.equal(resolveRateLimitKey("sess_abc123", "203.0.113.1"), "session:sess_abc123");
});

test("세션 ID 가 없으면 IP 로 대신한다", () => {
  assert.equal(resolveRateLimitKey(undefined, "203.0.113.1"), "ip:203.0.113.1");
  assert.equal(resolveRateLimitKey(null, "203.0.113.1"), "ip:203.0.113.1");
  assert.equal(resolveRateLimitKey("", "203.0.113.1"), "ip:203.0.113.1");
});

test("세션 ID 도 IP 도 없으면 고정 폴백 키를 쓴다(전부 막지는 않는다)", () => {
  assert.equal(resolveRateLimitKey(undefined, null), "unknown");
});

test("같은 시간창 안이면 같은 window key, 다른 시간창이면 다른 key", () => {
  const oneMinuteMs = 60_000;
  const a = resolveWindowKey("session:x", 0);
  const b = resolveWindowKey("session:x", 30_000);
  const c = resolveWindowKey("session:x", oneMinuteMs + 1);
  assert.equal(a, b, "같은 60초 창 안이면 같은 키");
  assert.notEqual(a, c, "다음 60초 창으로 넘어가면 다른 키");
});

test("[회귀] binding 이 없으면(로컬 dev) 항상 통과시킨다", async () => {
  const result = await checkAiRateLimit(undefined, "sess_1", "203.0.113.1");
  assert.equal(result, null);
});

test("카운트가 상한 미만이면 통과시키고 카운트를 1 올린다", async () => {
  const kv = fakeKv();
  const result = await checkAiRateLimit(kv, "sess_1", "203.0.113.1");
  assert.equal(result, null);
  const windowKey = resolveWindowKey("session:sess_1", Date.now());
  assert.equal(kv.store[windowKey], "1");
});

test("카운트가 상한(20)에 도달하면 429 rate_limited 를 돌려주고 더 이상 올리지 않는다", async () => {
  const windowKey = resolveWindowKey("session:sess_1", Date.now());
  const kv = fakeKv({ [windowKey]: "20" });
  const result = await checkAiRateLimit(kv, "sess_1", "203.0.113.1");
  assert.deepEqual(result, rateLimitedResult());
  assert.equal(result?.status, 429);
  assert.equal(kv.store[windowKey], "20", "이미 상한이면 더 올리지 않는다");
  const body = result?.body as { error: { code: string; retryable: boolean } };
  assert.equal(body.error.code, "rate_limited");
  assert.equal(body.error.retryable, true, "잠시 후 재시도할 수 있어야 한다");
});

test("19회까지는 통과, 20번째부터 막는다", async () => {
  const kv = fakeKv();
  for (let i = 0; i < 19; i++) {
    const result = await checkAiRateLimit(kv, "sess_burst", "203.0.113.1");
    assert.equal(result, null, `요청 ${i + 1}번째는 통과해야 한다`);
  }
  const twentieth = await checkAiRateLimit(kv, "sess_burst", "203.0.113.1");
  assert.equal(twentieth, null, "20번째(=상한)까지는 통과");
  const twentyFirst = await checkAiRateLimit(kv, "sess_burst", "203.0.113.1");
  assert.equal(twentyFirst?.status, 429, "21번째부터 막는다");
});

test("서로 다른 세션은 서로의 카운트에 영향을 주지 않는다", async () => {
  const kv = fakeKv();
  const windowKeyA = resolveWindowKey("session:sess_a", Date.now());
  kv.store[windowKeyA] = "20";
  const resultA = await checkAiRateLimit(kv, "sess_a", "203.0.113.1");
  const resultB = await checkAiRateLimit(kv, "sess_b", "203.0.113.1");
  assert.equal(resultA?.status, 429, "sess_a 는 이미 상한");
  assert.equal(resultB, null, "sess_b 는 별도 카운터라 통과해야 한다");
});
