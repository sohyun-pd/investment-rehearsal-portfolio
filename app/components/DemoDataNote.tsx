import { cn } from "@/lib/utils";

/** 정적 데모 데이터임을 화면에 명시(실데이터 오해 방지). 회색으로 숨기지 않는다. */
export function DemoDataNote({ className }: { className?: string }) {
  return (
    <p className={cn("text-caption text-text-tertiary", className)}>
      데모용 예시 데이터예요. 실제 시장·API 응답이 아니에요.
    </p>
  );
}
