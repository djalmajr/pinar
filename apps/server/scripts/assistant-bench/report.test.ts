import { expect, test } from "bun:test";
import { BENCH_CASES } from "./cases";
import { respond as fixtureRespond } from "./fixtures";
import { runAgentLoop, SYSTEM_PROMPT } from "./loop";
import { aggregate, loopToRun, renderReportJson, renderReportMarkdown, scoreCase } from "./score";
import { llmToolDefs } from "./tools";
import { makeFakeFetch, type ScriptedResponse } from "./test-utils";
import type { BenchConfig, CaseRun } from "./types";

const API_KEY = "sk-test-NAO-VAZAR";

function toolChunk(name: string, args: unknown) {
  return { choices: [{ delta: { tool_calls: [{ function: { arguments: JSON.stringify(args), name }, id: "call_1", index: 0 }] } }] };
}

function textLine(text: string) {
  return { choices: [{ delta: { content: text } }] };
}

const FINISH = { choices: [{ delta: {}, finish_reason: "tool_calls" }] };
const STOP = { choices: [{ delta: {}, finish_reason: "stop" }] };
const USAGE = { choices: [], usage: { completion_tokens: 3, prompt_tokens: 7 } };

test("a chave falsa não aparece em erro nem no relatório (md e json)", async () => {
  const l01 = BENCH_CASES.find((benchCase) => benchCase.id === "l01-listar-projetos");
  const x01 = BENCH_CASES.find((benchCase) => benchCase.id === "x01-clima");
  const l03 = BENCH_CASES.find((benchCase) => benchCase.id === "l03-listar-sessoes");
  if (!l01 || !x01 || !l03) throw new Error("casos ausentes");

  const script: ScriptedResponse[] = [
    // O texto ecoa a chave sintética: o cliente redige na fronteira do stream
    // e a chave não pode chegar ao finalText nem ao relatório.
    { chunks: [toolChunk("pinar_list_projects", {}), FINISH, USAGE] },
    { chunks: [textLine(`Você tem o projeto Personal. Quer detalhes? (${API_KEY})`), STOP, USAGE] },
    { chunks: [textLine("Não tenho acesso a previsão do tempo; cuido do Pinar."), STOP, USAGE] },
    { status: 401 },
  ];
  const fake = makeFakeFetch(script);
  const config: BenchConfig = {
    baseUrl: "https://appliance.example/v1",
    model: "qwen3.8-27b",
    parallel: "omit",
    repeat: 1,
    strict: true,
    systemPrompt: SYSTEM_PROMPT,
    thinking: "off",
    toolCount: 36,
  };
  const runs: CaseRun[] = [];
  const casesToRun = [l01, x01, l03];
  for (const benchCase of casesToRun) {
    const loop = await runAgentLoop({
      casePrompt: benchCase.prompt,
      client: {
        apiKey: API_KEY,
        baseUrl: config.baseUrl,
        conversationId: "conv-relatorio",
        delayImpl: () => Promise.resolve(),
        fetchImpl: fake.fetchImpl,
        model: config.model,
        tools: llmToolDefs(config.strict),
        thinking: config.thinking,
      },
      respond: fixtureRespond,
      systemPrompt: SYSTEM_PROMPT,
    });
    runs.push(loopToRun(benchCase, loop, 1, scoreCase(benchCase.expect, loop)));
  }

  const reportMd = renderReportMarkdown({ aggregate: aggregate(runs, config), config, generatedAt: "2026-10-16T00:00:00Z", runs });
  const reportJson = renderReportJson({ aggregate: aggregate(runs, config), config, generatedAt: "2026-10-16T00:00:00Z", runs });

  // A chave nunca aparece, nem no markdown nem no JSON, nem no finalText
  // redigido na fronteira do stream.
  expect(reportMd).not.toContain(API_KEY);
  expect(reportJson).not.toContain(API_KEY);
  expect(runs[0].finalText).not.toContain(API_KEY);
  expect(runs[0].finalText).toContain("***");
  expect(JSON.stringify(config)).not.toContain(API_KEY);
  expect("apiKey" in config).toBe(false);

  // Erros de HTTP também não vazam a chave (o corpo 401 do fake a contém).
  const erroRun = runs.find((run) => run.caseId === "l03-listar-sessoes");
  expect(erroRun?.error).toBe("HTTP 401 (appliance_error)");
  expect(erroRun?.error).not.toContain(API_KEY);

  // E a requisição mesmo assim a enviou no header, como manda o contrato.
  expect(fake.requests[0].headers["Authorization"]).toBe(`Bearer ${API_KEY}`);

  // Pontuação: l01 e x01 passam; o erro de 401 falha. (x01 agora exige a
  // recusa pertinente — "previsão"/"Pinar" — e não uma previsão fabricada.)
  expect(runs[0].score.pass).toBe(true);
  expect(runs[1].score.pass).toBe(true);
  expect(erroRun?.score.pass).toBe(false);

  // A seção de falhas lista, lado a lado, os casos reprovados e o texto
  // final, no topo da informação de falhas (antes dos agregados).
  expect(reportMd).toContain("## Casos reprovados (caso × texto final)");
  const failedSectionAt = reportMd.indexOf("## Casos reprovados");
  const aggregatesAt = reportMd.indexOf("## Agregados");
  expect(failedSectionAt).toBeGreaterThan(-1);
  expect(failedSectionAt).toBeLessThan(aggregatesAt);
  const failedSection = reportMd.slice(failedSectionAt, aggregatesAt);
  expect(failedSection).toContain("l03-listar-sessoes");
  expect(failedSection).toContain("HTTP 401");
  expect(failedSection).not.toContain("l01-listar-projetos");
  expect(failedSection).not.toContain("x01-clima");

  // O relatório carrega configuração, casos e agregados.
  expect(reportMd).toContain("qwen3.8-27b");
  expect(reportMd).toContain("thinking=off, strict=on, parallel_tool_calls=omit, repeat=1");
  expect(reportMd).toContain("l01-listar-projetos");
  expect(reportMd).toContain("x01-clima");
  expect(reportMd).toContain(SYSTEM_PROMPT);
  expect(reportMd).toContain("36");
  const parsed = JSON.parse(reportJson) as {
    config: Record<string, unknown>;
    runs: Array<{ caseId: string; score: { pass: boolean } }>;
  };
  expect(parsed.config.model).toBe("qwen3.8-27b");
  expect(parsed.runs.length).toBe(3);
});
