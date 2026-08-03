import { useState } from "react";
import { ScreenShell } from "@/components/ScreenShell";
import { CtaButton } from "@/components/CtaButton";
import { Card, CardContent } from "@/components/ui/card";
import { formatKst } from "@/lib/format";
import { DEMO_MARKET } from "@/fixtures/demo";

function KeyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="shrink-0 text-caption text-text-tertiary">{label}</dt>
      <dd className="tnum text-right text-body text-text-primary">{value}</dd>
    </div>
  );
}

/** Screen 5. 최종 확인 및 모의 등록 */
export function Confirm() {
  const [agreed, setAgreed] = useState(false);

  return (
    <ScreenShell
      title="이대로 등록할까요?"
      subtitle="실행될 내용을 한 번 더 문장으로 정리했어요."
      footer={
        <div className="space-y-3">
          <p className="text-caption text-text-secondary">실제 주문 없이 조건만 등록해요.</p>
          <CtaButton to="/complete" disabled={!agreed}>
            모의 전략 등록하기
          </CtaButton>
        </div>
      }
    >
      {/* 실행 내용을 문장으로 다시 설명 (핵심 수치 강조) */}
      <Card>
        <CardContent>
          <p className="text-body text-text-primary">
            매주 애플을 <span className="font-semibold">50,000원</span>씩 사요. 평균 매수가{" "}
            <span className="font-semibold">$320</span>보다 <span className="font-semibold">3%</span>{" "}
            떨어지면 <span className="font-semibold">20,000원</span>을 더 사요.
          </p>
        </CardContent>
      </Card>

      {/* 확인해야 할 핵심 수치만 */}
      <Card>
        <CardContent>
          <dl className="divide-y divide-border">
            <KeyRow label="종목" value="애플 (AAPL)" />
            <KeyRow label="정기 매수" value="매주 50,000원" />
            <KeyRow label="기준 가격" value="평균 매수가 $320" />
            <KeyRow label="추가 매수 조건" value="3% 하락 시 20,000원" />
            <KeyRow label="시세 기준 시각" value={`${formatKst(DEMO_MARKET.timestamp)} · 지연`} />
          </dl>
        </CardContent>
      </Card>

      <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-surface px-4 py-3">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-action"
        />
        <span className="text-caption text-text-secondary">
          이 전략은 투자 추천이나 수익 보장이 아니고, 실제 주문을 실행하지 않는 모의 전략인 걸
          확인했어요.
        </span>
      </label>
    </ScreenShell>
  );
}
