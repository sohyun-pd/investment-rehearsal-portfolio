/**
 * LLM 어댑터 - 교체 가능한 구조.
 *
 * 공통 인터페이스(LlmParser)만 고정하고 구현(mock/anthropic/openai)은
 * 환경변수(LLM_PROVIDER)로 교체한다.
 *  - mock      : 키 없이 규칙 기반 (파이프라인/스키마 검증용)
 *  - anthropic : 실제 Claude 호출 (공식 SDK, 구조화 출력)
 *  - openai    : 자리만 준비 (키 확정 시 구현)
 */

export interface ParsedOrder {
  action: "buy" | "sell" | "unknown";
  symbol?: string;
  symbolName?: string;
  quantity?: number;
  orderType?: "market" | "limit";
  limitPrice?: number;
  needsClarification?: boolean;
}

export interface LlmParser {
  readonly name: string;
  /** 자연어 지시문을 구조화 주문으로 파싱한다. */
  parse(utterance: string): Promise<ParsedOrder>;
}

/** 파싱 결과 공통 JSON 스키마 (구조화 출력 / 검증에 재사용). */
const ORDER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["buy", "sell", "unknown"] },
    symbol: { type: ["string", "null"] },
    symbolName: { type: ["string", "null"] },
    quantity: { type: ["integer", "null"] },
    orderType: { type: ["string", "null"] },
    limitPrice: { type: ["number", "null"] },
    needsClarification: { type: "boolean" },
  },
  required: [
    "action",
    "symbol",
    "symbolName",
    "quantity",
    "orderType",
    "limitPrice",
    "needsClarification",
  ],
} as const;

const SYSTEM_PROMPT = [
  "너는 한국어/영어 자연어 투자 지시문을 구조화된 주문(JSON)으로 파싱하는 파서다.",
  "- action: 매수면 buy, 매도면 sell, 판단 불가면 unknown.",
  "- symbol: 종목 코드/티커(한국 주식은 6자리 코드, 미국 주식은 티커). 모르면 null.",
  "- symbolName: 사람이 말한 종목명. 없으면 null.",
  "- quantity: 주문 수량(정수). 없으면 null.",
  "- orderType: 가격 지정이 있으면 limit, 시장가면 market, 불명확하면 null.",
  "- limitPrice: 지정가. 없으면 null.",
  "- needsClarification: 의미가 모호해 되물어야 하면 true, 아니면 false.",
  "확실하지 않은 값은 추측하지 말고 null로 둔다.",
].join("\n");

/** null → undefined 정규화 (ParsedOrder 형태로 맞춤). */
function normalizeOrder(raw: Record<string, unknown>): ParsedOrder {
  const clean: ParsedOrder = { action: (raw.action as ParsedOrder["action"]) ?? "unknown" };
  if (raw.symbol != null) clean.symbol = String(raw.symbol);
  if (raw.symbolName != null) clean.symbolName = String(raw.symbolName);
  if (raw.quantity != null) clean.quantity = Number(raw.quantity);
  if (raw.orderType != null) clean.orderType = raw.orderType as ParsedOrder["orderType"];
  if (raw.limitPrice != null) clean.limitPrice = Number(raw.limitPrice);
  if (raw.needsClarification) clean.needsClarification = true;
  return clean;
}

/**
 * Mock 구현: 실제 LLM 호출 없이 규칙 기반 파싱.
 * provider 확정 전까지 파이프라인/스키마 검증 용도.
 */
export class MockLlmParser implements LlmParser {
  readonly name = "mock";

  async parse(utterance: string): Promise<ParsedOrder> {
    const text = utterance.trim();
    const isBuy = /(사|매수|buy)/i.test(text);
    const isSell = /(팔|매도|sell)/i.test(text);
    if (!isBuy && !isSell) {
      return { action: "unknown", needsClarification: true };
    }
    const qtyMatch = text.match(/(\d+)\s*주/);
    const quantity = qtyMatch ? Number(qtyMatch[1]) : undefined;
    const priceMatch = text.match(/(\d+)\s*(달러|원|\$)/);
    const limitPrice = priceMatch ? Number(priceMatch[1]) : undefined;

    const known: Record<string, string> = { 삼성전자: "005930", 애플: "AAPL" };
    let symbol: string | undefined;
    let symbolName: string | undefined;
    for (const [name, code] of Object.entries(known)) {
      if (text.includes(name)) {
        symbolName = name;
        symbol = code;
        break;
      }
    }
    return {
      action: isBuy ? "buy" : "sell",
      symbol,
      symbolName,
      quantity,
      orderType: limitPrice !== undefined ? "limit" : "market",
      ...(limitPrice !== undefined ? { limitPrice } : {}),
    };
  }
}

/**
 * 실제 Claude 호출 (공식 @anthropic-ai/sdk, 구조화 출력).
 * ANTHROPIC_API_KEY 필요. 모델은 LLM_MODEL(기본 claude-opus-4-8).
 */
export class AnthropicLlmParser implements LlmParser {
  readonly name = "anthropic";
  private readonly model: string;

  constructor(model: string = process.env.LLM_MODEL || "claude-opus-4-8") {
    this.model = model;
  }

  async parse(utterance: string): Promise<ParsedOrder> {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("[llm] ANTHROPIC_API_KEY 가 없습니다. .env.local 에 넣으세요.");
    }
    // 동적 import: mock 실행 시엔 SDK 로딩 불필요.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic();

    const response = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: ORDER_JSON_SCHEMA as unknown as Record<string, unknown> },
      },
      messages: [{ role: "user", content: utterance }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("[llm] Claude 응답에 텍스트 블록이 없습니다.");
    }
    return normalizeOrder(JSON.parse(textBlock.text));
  }
}

/** OpenAI 자리(placeholder). 키/공급자 확정되면 구현. */
class UnimplementedOpenAiParser implements LlmParser {
  readonly name = "openai";
  async parse(): Promise<ParsedOrder> {
    throw new Error(
      `[llm] provider "openai" 는 아직 미구현입니다. ` +
        `보유 키가 OpenAI 라면 알려주세요. 지금은 LLM_PROVIDER=anthropic 또는 mock 을 쓰세요.`
    );
  }
}

/** 환경변수(LLM_PROVIDER)에 따라 어댑터를 고른다. */
export function createLlmParser(
  provider: string = process.env.LLM_PROVIDER ?? "mock"
): LlmParser {
  switch (provider) {
    case "mock":
      return new MockLlmParser();
    case "anthropic":
      return new AnthropicLlmParser();
    case "openai":
      return new UnimplementedOpenAiParser();
    default:
      throw new Error(`[llm] 알 수 없는 LLM_PROVIDER: "${provider}"`);
  }
}
