import type { MarketData } from "@/types/strategy";
import { formatKst, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

/**
 * 시세 블록. 문서에 정의된 정보 순서를 유지한다.
 *   1) 회사명·티커 → 2) 현재가·직전 종가 → 3) 전일 대비 → 4) 기준 시각 → 5) 지연·출처
 * 상승=빨강 / 하락=파랑(한국 관습). 색만으로 전달하지 않고 +/− 기호와 '상승/하락' 텍스트를 함께 쓴다.
 * 기준 시각·지연 여부를 tooltip 에 숨기지 않는다.
 */
export function QuoteCard({ data }: { data: MarketData }) {
  const up = data.changePercent >= 0;
  return (
    <Card>
      <CardContent>
        {/* 1) 회사명 · 티커 */}
        <p className="text-card text-text-primary">{data.companyName}</p>
        <p className="text-caption text-text-tertiary">{data.symbol}</p>

        {/* 2) 현재가 · 직전 종가 */}
        <p className="tnum mt-3 text-num text-text-primary">{usd(data.currentPrice)}</p>
        <p className="tnum mt-1 text-caption text-text-secondary">
          직전 종가 {usd(data.previousClose)}
        </p>

        {/* 3) 전일 대비 (기호 + 색 + 텍스트) */}
        <p
          className={cn(
            "tnum mt-2 text-body font-semibold",
            up ? "text-positive" : "text-negative"
          )}
        >
          {up ? "+" : "−"}
          {Math.abs(data.changePercent)}% {up ? "상승" : "하락"}
        </p>

        {/* 4) 기준 시각 · 5) 지연 여부 · 출처 */}
        <div className="mt-4 border-t border-border pt-3">
          <p className="text-caption text-text-secondary">
            기준 시각 · {formatKst(data.timestamp)}
          </p>
          <p className="mt-1 text-caption text-text-secondary">
            {data.delayed ? (
              <span className="font-medium text-warning">지연 시세</span>
            ) : (
              <span>실시간 시세</span>
            )}{" "}
            · 출처 {data.source === "finnhub" ? "Finnhub" : data.source}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
