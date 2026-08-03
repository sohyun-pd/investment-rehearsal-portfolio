import type { StrategyCondition } from "@/types/strategy";
import {
  conditionSentence,
  conditionTypeLabel,
  frequencyLabel,
  missingFields,
  money,
  ratioText,
  referenceTypeLabel,
  usd,
  weekdayLabel,
} from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-caption text-text-tertiary">{label}</dt>
      <dd className="tnum text-right text-body text-text-primary">{value}</dd>
    </div>
  );
}

/** 조건 세부 행(기준 가격 · 금액/비율 · 주기). */
function detailRows(c: StrategyCondition): { label: string; value: string }[] {
  switch (c.type) {
    case "recurring_buy": {
      const rows = [{ label: "주문 금액", value: money(c.amount, c.currency) }];
      const wd = weekdayLabel(c.weekday);
      rows.push({ label: "실행 주기", value: wd ? `${frequencyLabel(c.frequency)} · ${wd}` : frequencyLabel(c.frequency) });
      rows.push({ label: "시작일", value: c.startDate ?? "등록할 때 선택" });
      return rows;
    }
    case "conditional_buy":
      return [
        { label: "기준 가격", value: `${referenceTypeLabel(c.referenceType)} ${usd(c.referencePrice)}` },
        { label: "추가 매수 금액", value: money(c.amount, c.amountCurrency) },
      ];
    case "conditional_sell":
      return [
        { label: "기준 가격", value: referenceTypeLabel(c.referenceType) },
        { label: "매도 비율", value: ratioText(c.sellRatio) },
      ];
  }
}

/**
 * 전략 조건 카드.
 * 상단: 조건 유형 + 편집 버튼 / 본문: 핵심 실행 문장 + 세부 / 하단: 수정 필요 정보.
 * 색상은 과도하게 쓰지 않고 유형은 라벨로 구분한다.
 */
export function ConditionCard({
  condition,
  editable = false,
}: {
  condition: StrategyCondition;
  editable?: boolean;
}) {
  const missing = missingFields(condition);
  return (
    <Card>
      <CardContent>
        <div className="flex items-center justify-between">
          <Badge tone="neutral">{conditionTypeLabel(condition.type)}</Badge>
          {editable ? (
            <Button variant="ghost" size="sm" className="w-auto" aria-label="조건 수정">
              수정
            </Button>
          ) : null}
        </div>

        <p className="mt-3 text-body font-semibold text-text-primary">
          {conditionSentence(condition)}
        </p>

        <dl className="mt-3 space-y-2">
          {detailRows(condition).map((r) => (
            <Row key={r.label} label={r.label} value={r.value} />
          ))}
        </dl>

        {missing.length > 0 ? (
          <p className="mt-3 border-t border-border pt-3 text-caption text-warning">
            아직 정할 값: {missing.join(", ")} — 입력이 필요해요
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
