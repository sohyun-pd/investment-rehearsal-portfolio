/**
 * server/feedbackRoute.ts 단위 테스트.
 *
 * 실행: npm run test:feedback
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { handleFeedbackRoute, type FeedbackSubmission } from "./feedbackRoute";

function validSubmission(overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission {
  return {
    sessionId: "session-123",
    investmentExperience: "1_to_3_years",
    productUnderstanding: "historical_rehearsal",
    reachedResult: true,
    hardestStep: "conditional_rule",
    resultComprehensionScore: 4,
    orderCapabilityUnderstanding: "no",
    openFeedback: "차트가 처음엔 헷갈렸어요",
    ...overrides,
  };
}

test("[회귀] Apps Script URL 이 비어 있으면 성공한 것처럼 속이지 않고 storage_not_configured 를 정직하게 돌려준다", async () => {
  const result = await handleFeedbackRoute(validSubmission(), { appsScriptUrl: "", token: "" });
  assert.equal(result.status, 503);
  const body = result.body as { error: { code: string; retryable: boolean } };
  assert.equal(body.error.code, "storage_not_configured");
  assert.equal(body.error.retryable, true, "나중에 다시 시도할 수 있어야 한다(설정 문제일 뿐 사용자 잘못이 아니다)");
});

test("[§사용자 확정 — 토큰 선택값] 연결된 Apps Script 가 토큰 검증을 하지 않는 구조라, token 이 비어 있어도 appsScriptUrl 만 있으면 그대로 전달을 시도한다", async () => {
  let sentBody: unknown = null;
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body));
    return new Response(null, { status: 200 });
  };

  const result = await handleFeedbackRoute(
    validSubmission(),
    { appsScriptUrl: "https://script.google.com/macros/s/x/exec", token: "" },
    {},
    fakeFetch as unknown as typeof fetch
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal((sentBody as Record<string, unknown>).token, "", "토큰을 새로 만들어 채워 넣지 않는다 — 빈 값 그대로 보낸다");
});

test("형식이 잘못된 요청은 400 invalid_request 로 거부한다(예: 잘못된 열거값)", async () => {
  const malformed = { ...validSubmission(), investmentExperience: "십년" };
  const result = await handleFeedbackRoute(malformed, { appsScriptUrl: "https://script.google.com/macros/s/x/exec", token: "tok" });
  assert.equal(result.status, 400);
  assert.equal((result.body as { error: { code: string } }).error.code, "invalid_request");
});

test("resultComprehensionScore 가 1~5 범위를 벗어나면 거부한다", async () => {
  const malformed = validSubmission({ resultComprehensionScore: 7 as never });
  const result = await handleFeedbackRoute(malformed, { appsScriptUrl: "https://script.google.com/macros/s/x/exec", token: "tok" });
  assert.equal(result.status, 400);
});

test("Apps Script URL·토큰이 설정돼 있고 전달이 성공하면 200 ok 를 돌려준다 — token 은 body 안에 담고(§Apps Script 관례), 개인정보·계획 정보는 함께 보내지 않는다", async () => {
  let sentBody: unknown = null;
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body));
    return new Response(null, { status: 200 });
  };

  const result = await handleFeedbackRoute(
    validSubmission(),
    { appsScriptUrl: "https://script.google.com/macros/s/x/exec", token: "secret-token" },
    { userAgent: "test-agent/1.0" },
    fakeFetch as unknown as typeof fetch
  );

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  const forwarded = sentBody as Record<string, unknown>;
  assert.equal(forwarded.token, "secret-token", "Apps Script 는 body 안의 token 필드로 인증한다");
  assert.equal(forwarded.sessionId, "session-123");
  assert.equal(forwarded.userAgent, "test-agent/1.0");
  assert.equal(typeof forwarded.appVersion, "string");
  for (const forbidden of ["symbol", "amount", "plan", "currentPlan", "conversation", "account", "email", "name", "phone"]) {
    assert.ok(!(forbidden in forwarded), `개인정보/계획 관련 필드("${forbidden}")가 함께 전송되면 안 된다`);
  }
});

test("클라이언트가 임의의 추가 필드(예: 실제 계획 객체)를 얹어 보내도 Apps Script 로는 허용된 필드만 전달된다", async () => {
  let sentBody: unknown = null;
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body));
    return new Response(null, { status: 200 });
  };

  const withExtraField = { ...validSubmission(), currentPlan: { symbol: "005930", amountKrw: 50000 } };

  await handleFeedbackRoute(
    withExtraField,
    { appsScriptUrl: "https://script.google.com/macros/s/x/exec", token: "tok" },
    {},
    fakeFetch as unknown as typeof fetch
  );

  const forwarded = sentBody as Record<string, unknown>;
  assert.ok(!("currentPlan" in forwarded), "허용 목록에 없는 필드는 그대로 통과시키면 안 된다");
});

test("[회귀] 저장소가 실패 응답을 주면 성공으로 속이지 않고 storage_request_failed 를 돌려준다", async () => {
  const failingFetch = async () => new Response(null, { status: 500 });
  const result = await handleFeedbackRoute(
    validSubmission(),
    { appsScriptUrl: "https://script.google.com/macros/s/x/exec", token: "tok" },
    {},
    failingFetch as unknown as typeof fetch
  );
  assert.equal(result.status, 502);
  assert.equal((result.body as { error: { code: string } }).error.code, "storage_request_failed");
});

test("네트워크 오류가 나면 network_failure 로 분류하고 재시도 가능으로 표시한다", async () => {
  const throwingFetch = async () => {
    throw new Error("network down");
  };
  const result = await handleFeedbackRoute(
    validSubmission(),
    { appsScriptUrl: "https://script.google.com/macros/s/x/exec", token: "tok" },
    {},
    throwingFetch as unknown as typeof fetch
  );
  assert.equal(result.status, 502);
  const body = result.body as { error: { code: string; retryable: boolean } };
  assert.equal(body.error.code, "network_failure");
  assert.equal(body.error.retryable, true);
});
