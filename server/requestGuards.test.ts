/**
 * server/requestGuards.ts 단위 테스트.
 *
 * 실행: npm run test:requestguards
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { isRequestBodyTooLarge, MAX_REQUEST_BODY_BYTES } from "./requestGuards";

test("Content-Length 가 없으면 판단하지 않는다(false)", () => {
  assert.equal(isRequestBodyTooLarge(null), false);
});

test("상한 이하면 false", () => {
  assert.equal(isRequestBodyTooLarge(String(MAX_REQUEST_BODY_BYTES)), false);
  assert.equal(isRequestBodyTooLarge("100"), false);
});

test("상한을 넘으면 true", () => {
  assert.equal(isRequestBodyTooLarge(String(MAX_REQUEST_BODY_BYTES + 1)), true);
  assert.equal(isRequestBodyTooLarge("99999999"), true);
});

test("숫자가 아니면(false) 판단하지 않는다", () => {
  assert.equal(isRequestBodyTooLarge("not-a-number"), false);
});
