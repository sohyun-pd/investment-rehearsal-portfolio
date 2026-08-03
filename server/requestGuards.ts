/**
 * POST 요청 공통 방어 — §production 안정성.
 *
 * 이 서비스가 실제로 받는 JSON 본문(계획 해석·수정·리뷰·피드백)은 전부 문자열 길이 상한이
 * 이미 있는 필드들의 조합이라 정상 요청은 수 KB를 넘지 않는다. 그보다 훨씬 큰 본문은 정상
 * 사용에서 나올 수 없으므로, 굳이 JSON.parse 까지 가지 않고 미리 거절한다(메모리 낭비 방지).
 */
export const MAX_REQUEST_BODY_BYTES = 100_000; // 100KB — 정상 요청의 수십 배 여유

/** Content-Length 헤더가 있고 상한을 넘으면 true. 헤더가 없으면(청크 전송 등) 판단하지
 * 않는다 — 그 경우는 플랫폼(Cloudflare)이미 두는 요청 크기 상한이 최종 방어선이다. */
export function isRequestBodyTooLarge(contentLength: string | null): boolean {
  if (contentLength === null) return false;
  const bytes = Number(contentLength);
  return Number.isFinite(bytes) && bytes > MAX_REQUEST_BODY_BYTES;
}
