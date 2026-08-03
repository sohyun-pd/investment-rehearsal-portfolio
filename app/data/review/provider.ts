/**
 * AI 설명 provider 선택 — 앱(FlowProvider)이 부르는 유일한 진입점.
 *
 * `VITE_USE_MOCK_AI=true` 일 때는 실제 Claude 를 부르지 않고 곧바로 deterministic
 * fallback(`app/lib/reviewFallback.ts`)을 쓴다 — 가짜 AI 문장을 지어내는 대신, 이미
 * "실패 시 fallback" 용도로 검증된 같은 문구를 재사용한다(실제 데이터와 항상 구분된다).
 */
import { isMockAiEnabled } from "@/config/aiMode";
import { getReviewClient } from "./client";
import { buildFallbackReview } from "@/lib/reviewFallback";
import type { ReviewRequest, ReviewResponse } from "@/types/review";

export function getReview(request: ReviewRequest): Promise<ReviewResponse> {
  if (isMockAiEnabled()) return Promise.resolve(buildFallbackReview(request));
  return getReviewClient(request);
}
