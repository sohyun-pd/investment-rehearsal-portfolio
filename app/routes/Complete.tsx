import { ScreenShell } from "@/components/ScreenShell";
import { CtaButton } from "@/components/CtaButton";
import { Card, CardContent } from "@/components/ui/card";

const REGISTERED = [
  "매주 50,000원 정기 매수",
  "평균 매수가보다 3% 떨어지면 20,000원 추가 매수",
];

/** Screen 6. 등록 완료 (confetti·축하 애니메이션 없음) */
export function Complete() {
  return (
    <ScreenShell
      title="조건을 모의 전략으로 등록했어요"
      subtitle="실제 주문은 실행되지 않아요. 조건이 의도와 맞는지 먼저 살펴볼 수 있어요."
      footer={
        <div className="space-y-3">
          <CtaButton to="/">새 계획 만들기</CtaButton>
          <CtaButton to="/review" variant="secondary" size="md">
            등록한 조건 보기
          </CtaButton>
        </div>
      }
    >
      <div className="flex justify-center pt-2">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-strong text-2xl text-text-primary"
          aria-hidden
        >
          ✓
        </span>
      </div>

      <Card>
        <CardContent>
          <p className="text-caption text-text-tertiary">등록된 조건</p>
          <ul className="mt-3 space-y-2">
            {REGISTERED.map((item) => (
              <li key={item} className="flex gap-2 text-body text-text-primary">
                <span className="text-text-tertiary" aria-hidden>
                  •
                </span>
                {item}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </ScreenShell>
  );
}
