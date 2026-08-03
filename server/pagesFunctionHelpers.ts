/**
 * Cloudflare Pages Functions(`functions/api/**`)가 공유하는 아주 작은 유틸.
 *
 * 이 파일 자체는 Cloudflare 전용 타입(`Request`)을 쓰지 않는다 — Fetch 표준 `Request` 만
 * 쓰므로 Node 쪽에서도(원한다면) 재사용할 수 있다.
 */
import { isRequestBodyTooLarge } from "./requestGuards";

/** Content-Length 초과면 본문을 읽지 않고 null 을 돌려준다(§production 안정성 — 비정상적으로
 * 큰 payload 차단). 그 외에는 JSON 파싱을 시도하고, 형식이 잘못됐으면 null 을 돌려준다 — 각
 * 라우트의 `isValidRequestBody` 가 null 을 "형식이 잘못된 요청"으로 이미 처리한다. */
export async function parseJsonBodyWithLimit(request: Request): Promise<unknown> {
  if (isRequestBodyTooLarge(request.headers.get("content-length"))) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}
