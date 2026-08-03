/**
 * `visible` 이 true 일 때만 보인다(시장 데이터는 `isMockMarketEnabled()`, AI 계획 해석은
 * `isMockAiEnabled()` — 호출부가 어떤 플래그인지 정한다). 실제 데이터와 화면에서 구분되지
 * 않는 구조를 금지하기 위한 명시적 배지다(회색 캡션으로 숨기지 않는다).
 */
import { Badge } from "@/components/ui/badge";

export function DemoDataBadge({ visible, className }: { visible: boolean; className?: string }) {
  if (!visible) return null;
  return (
    <Badge tone="delayed" className={className}>
      데모 데이터
    </Badge>
  );
}
