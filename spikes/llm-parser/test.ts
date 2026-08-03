/**
 * LLM 파서 스파이크 실행 스크립트.
 *
 * 목적: 자연어 투자 지시문을 실제 구조화 주문으로 파싱한다(3건).
 *       (provider=mock 이면 규칙 기반, anthropic 이면 실제 Claude 호출)
 *
 * 실행: npm run spike:llm
 * 실제 호출: .env.local 에 LLM_PROVIDER=anthropic + ANTHROPIC_API_KEY 설정.
 * 주의: API 키는 출력/로그에 남기지 않는다.
 */
import "../env.ts";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createLlmParser, type ParsedOrder } from "./adapters.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface SampleCase {
  id: string;
  utterance: string;
  expected: ParsedOrder & { needsClarification?: boolean };
}
interface SampleFile {
  description: string;
  cases: SampleCase[];
}

function loadSamples(): SampleFile {
  const raw = readFileSync(join(__dirname, "sample-inputs.json"), "utf8");
  return JSON.parse(raw) as SampleFile;
}

/** expected 의 필드가 실제 결과와 일치하는지(회귀 검증용). */
function matches(actual: ParsedOrder, expected: SampleCase["expected"]): boolean {
  return Object.entries(expected).every(
    ([k, v]) => (actual as unknown as Record<string, unknown>)[k] === v
  );
}

async function main(): Promise<void> {
  const parser = createLlmParser();
  const { cases } = loadSamples();
  console.log(`[llm-parser] provider = ${parser.name}`);
  console.log(`[llm-parser] 실제 파싱 ${cases.length}건 실행\n`);

  let passed = 0;
  for (const c of cases) {
    const t0 = Date.now();
    const actual = await parser.parse(c.utterance);
    const ms = Date.now() - t0;
    const ok = matches(actual, c.expected);
    passed += ok ? 1 : 0;
    console.log(`[${c.id}] "${c.utterance}"`);
    console.log(`  → ${JSON.stringify(actual)}  (${ms}ms)`);
  }

  console.log(`\n[llm-parser] 완료: ${cases.length}건 파싱`);
  console.log(`[llm-parser] 기대값 일치: ${passed}/${cases.length}`);
}

main().catch((err) => {
  // 키가 메시지에 포함되지 않도록 message 만 출력.
  console.error("[llm-parser] 실행 실패:", err instanceof Error ? err.message : String(err));
  console.error("→ 원인/대체방안을 spikes/TECH_SPIKE_RESULT.md 에 기록하세요.");
  process.exit(1);
});
