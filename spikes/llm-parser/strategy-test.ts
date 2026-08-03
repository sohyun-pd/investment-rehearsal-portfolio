/**
 * LLM 전략 파싱 스파이크 (1회성).
 *
 * 목적: '단순 주문'을 넘어 '조건부/정기 전략'을 구조화할 수 있는지 검증한다.
 *       (기존 order 파서와 별개 — 더 풍부한 스키마/프롬프트 사용)
 *
 * 확인 기준:
 *   1) 정기 매수 vs 조건부 매수를 구분하는가
 *   2) 매수/매도 조건을 동시에 구조화하는가
 *   3) 기준 가격이 평균매수가/현재가/직전종가 중 무엇인지 명시하는가
 *   4) 정보 부족 시 숫자를 지어내지 않고 추가 질문을 요구하는가
 *
 * 실행: npm run spike:strategy   (LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY 필요)
 * 주의: API 키는 출력/로그에 남기지 않는다.
 */
import "../env.ts";

/** 전략 1건을 이루는 규칙(정기/조건부 매수·매도 등). */
interface StrategyRule {
  kind: "recurring_buy" | "conditional_buy" | "conditional_sell" | "accumulate" | "unknown";
  action: "buy" | "sell" | null;
  schedule: string | null; // 정기 주문 주기 (예: weekly)
  amount: number | null; // 금액
  amountCurrency: string | null; // 통화 (예: KRW)
  quantityType: "amount" | "fraction" | "shares" | null; // 수량 표현 방식
  fraction: number | null; // 비율 (예: 0.5 = 절반)
  referencePrice: "average_cost" | "current_price" | "previous_close" | null; // 조건 기준가
  direction: "up" | "down" | null; // 상승/하락
  thresholdPercent: number | null; // 임계 변동률(%)
  note: string | null;
}

interface Strategy {
  symbol: string | null;
  symbolName: string | null;
  needsClarification: boolean;
  clarificationQuestions: string[];
  rules: StrategyRule[];
}

const STRATEGY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    symbol: { type: ["string", "null"] },
    symbolName: { type: ["string", "null"] },
    needsClarification: { type: "boolean" },
    clarificationQuestions: { type: "array", items: { type: "string" } },
    rules: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: {
            type: "string",
            enum: ["recurring_buy", "conditional_buy", "conditional_sell", "accumulate", "unknown"],
          },
          action: { type: ["string", "null"] },
          schedule: { type: ["string", "null"] },
          amount: { type: ["number", "null"] },
          amountCurrency: { type: ["string", "null"] },
          quantityType: { type: ["string", "null"] },
          fraction: { type: ["number", "null"] },
          referencePrice: { type: ["string", "null"] },
          direction: { type: ["string", "null"] },
          thresholdPercent: { type: ["number", "null"] },
          note: { type: ["string", "null"] },
        },
        required: [
          "kind", "action", "schedule", "amount", "amountCurrency",
          "quantityType", "fraction", "referencePrice", "direction",
          "thresholdPercent", "note",
        ],
      },
    },
  },
  required: ["symbol", "symbolName", "needsClarification", "clarificationQuestions", "rules"],
} as const;

const SYSTEM_PROMPT = [
  "너는 한국어 투자 전략 문장을 구조화(JSON)하는 파서다. 단순 1회 주문이 아니라 여러 규칙(정기/조건부 매수·매도)을 담을 수 있다.",
  "각 규칙(rule)의 kind:",
  "  - recurring_buy: 주기적으로 매수(예: 매주 5만원). schedule/amount 채움.",
  "  - conditional_buy: 조건 충족 시 매수.",
  "  - conditional_sell: 조건 충족 시 매도.",
  "  - accumulate: '조금씩 모은다'처럼 방식이 모호한 적립.",
  "조건(trigger)은 referencePrice(기준가) + direction(up/down) + thresholdPercent(%) 로 표현한다.",
  "referencePrice 는 반드시 다음 중 하나로 명시: average_cost(평균 매수가) / current_price(현재가) / previous_close(직전 종가). 문맥상 '평균 매수가보다'는 average_cost, '오르면/떨어지면'처럼 명시 안 된 경우 current_price 로 본다.",
  "수량 표현: quantityType = amount(금액) / fraction(비율, 예 절반=0.5) / shares(주식 수).",
  "매우 중요: 문장에 없는 숫자/조건을 절대 지어내지 마라. 값이 불명확하면 해당 필드는 null 로 두고, needsClarification=true 와 clarificationQuestions 에 물어볼 항목을 담아라.",
  "매수 조건과 매도 조건이 함께 있으면 두 규칙을 모두 만든다.",
].join("\n");

const SENTENCES = [
  "애플을 매주 5만 원씩 사고, 평균 매수가보다 3% 떨어지면 2만 원 더 사고 싶어.",
  "엔비디아가 10% 오르면 절반을 팔고, 5% 떨어지면 3만 원 추가 매수해 줘.",
  "테슬라를 조금씩 모으다가 많이 오르면 일부 팔고 싶어.",
];

async function parseStrategy(utterance: string): Promise<{ strategy: Strategy; ms: number }> {
  if ((process.env.LLM_PROVIDER ?? "mock") !== "anthropic") {
    throw new Error("[strategy] 이 스파이크는 LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY 가 필요합니다.");
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const model = process.env.LLM_MODEL || "claude-opus-4-8";

  const t0 = Date.now();
  const res = await client.messages.create({
    model,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: STRATEGY_JSON_SCHEMA as unknown as Record<string, unknown> },
    },
    messages: [{ role: "user", content: utterance }],
  });
  const ms = Date.now() - t0;
  const textBlock = res.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") throw new Error("[strategy] 응답에 텍스트 없음");
  return { strategy: JSON.parse(textBlock.text) as Strategy, ms };
}

/** 확인 기준 자동 체크. */
function evaluate(idx: number, s: Strategy): string[] {
  const notes: string[] = [];
  const kinds = s.rules.map((r) => r.kind);
  if (idx === 0) {
    const hasRecurring = kinds.includes("recurring_buy");
    const hasCondBuy = kinds.includes("conditional_buy");
    notes.push(`${hasRecurring && hasCondBuy ? "✅" : "❌"} 정기 매수 + 조건부 매수 구분`);
    const condBuy = s.rules.find((r) => r.kind === "conditional_buy");
    notes.push(
      `${condBuy?.referencePrice === "average_cost" ? "✅" : "❌"} 조건 기준가 = 평균매수가(average_cost) 명시`
    );
  } else if (idx === 1) {
    const hasSell = kinds.includes("conditional_sell");
    const hasBuy = kinds.includes("conditional_buy");
    notes.push(`${hasSell && hasBuy ? "✅" : "❌"} 매도 조건 + 매수 조건 동시 구조화`);
    const sell = s.rules.find((r) => r.kind === "conditional_sell");
    notes.push(`${sell?.referencePrice ? "✅" : "❌"} 매도 조건 기준가 명시(${sell?.referencePrice ?? "null"})`);
  } else if (idx === 2) {
    const invented = s.rules.some((r) => r.thresholdPercent != null || r.amount != null);
    notes.push(
      `${s.needsClarification && s.clarificationQuestions.length > 0 ? "✅" : "❌"} 추가 질문 요구(needsClarification)`
    );
    notes.push(`${!invented ? "✅" : "❌"} 숫자를 지어내지 않음(임계치/금액 null)`);
  }
  return notes;
}

async function main(): Promise<void> {
  const model = process.env.LLM_MODEL || "claude-opus-4-8";
  console.log(`[strategy] provider = anthropic / model = ${model}`);
  console.log(`[strategy] 조건부 전략 파싱 ${SENTENCES.length}건 (1회성 검증)\n`);

  for (let i = 0; i < SENTENCES.length; i++) {
    const utterance = SENTENCES[i]!;
    console.log(`── 문장 ${i + 1}: ${utterance}`);
    const { strategy, ms } = await parseStrategy(utterance);
    console.log(JSON.stringify(strategy, null, 2));
    console.log(`  (응답시간: ${ms}ms)`);
    for (const note of evaluate(i, strategy)) console.log(`  ${note}`);
    console.log();
  }
  console.log("[strategy] 완료 — 결과 해석은 TECH_SPIKE_RESULT.md 에 기록");
}

main().catch((err) => {
  console.error("[strategy] 실행 실패:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
