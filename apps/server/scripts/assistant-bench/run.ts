// CLI: runs the assistant bench against one OpenAI-compatible model.
//
//   bun apps/server/scripts/assistant-bench/run.ts --model <id> \
//     [--thinking on|off|omit] [--strict on|off] [--parallel on|off|omit] \
//     [--repeat N] [--cases id1,id2] [--out <dir>]
//
// Configuration comes from the environment:
//   ASSISTANT_BENCH_BASE_URL  (HTTPS base, e.g. https://appliance/v1)
//   ASSISTANT_BENCH_API_KEY   (never printed, never stored in reports)
//
// Output: <out>/bench-<model>-<variante>-<timestamp>.md and .json, without
// the key. Exit codes: 0 ok, 2 bad configuration/environment.

import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { BENCH_CASES } from "./cases";
import { redactSecret } from "./client";
import { respond as fixtureRespond } from "./fixtures";
import { runAgentLoop, SYSTEM_PROMPT } from "./loop";
import { aggregate, loopToRun, renderReportJson, renderReportMarkdown, scoreCase } from "./score";
import { BENCH_TOOLS, llmToolDefs } from "./tools";
import type { BenchCase, BenchConfig, CaseRun } from "./types";

interface ParsedArgs {
  cases?: string[];
  model?: string;
  out: string;
  parallel: "off" | "omit" | "on";
  repeat: number;
  strict: boolean;
  thinking: "off" | "omit" | "on";
}

function parseArgs(argv: string[]): { args?: ParsedArgs; error?: string } {
  const out: ParsedArgs = {
    out: join(tmpdir(), "assistant-bench-out"),
    parallel: "omit",
    repeat: 1,
    strict: false,
    thinking: "omit",
  };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    switch (flag) {
      case "--model":
        if (!value) return { error: "--model exige um valor" };
        out.model = value;
        i += 1;
        break;
      case "--thinking":
        if (value !== "on" && value !== "off" && value !== "omit") return { error: "--thinking aceita on, off ou omit" };
        out.thinking = value;
        i += 1;
        break;
      case "--strict":
        if (value !== "on" && value !== "off") return { error: "--strict aceita on ou off" };
        out.strict = value === "on";
        i += 1;
        break;
      case "--parallel":
        if (value !== "on" && value !== "off" && value !== "omit") return { error: "--parallel aceita on, off ou omit" };
        out.parallel = value;
        i += 1;
        break;
      case "--repeat": {
        if (!value || !/^[1-9][0-9]*$/.test(value)) return { error: "--repeat exige um inteiro >= 1" };
        out.repeat = Number(value);
        i += 1;
        break;
      }
      case "--cases": {
        if (!value) return { error: "--cases exige uma lista separada por vírgula" };
        out.cases = value.split(",").map((id) => id.trim()).filter((id) => id.length > 0);
        i += 1;
        break;
      }
      case "--out":
        if (!value) return { error: "--out exige um diretório" };
        out.out = value;
        i += 1;
        break;
      case "--help":
      case "-h":
        return { error: HELP };
      default:
        return { error: `flag desconhecida: ${flag}\n\n${HELP}` };
    }
  }
  return { args: out };
}

const HELP = [
  "Uso: run.ts --model <id> [--thinking on|off|omit] [--strict on|off] [--parallel on|off|omit] [--repeat N] [--cases id1,id2] [--out <dir>]",
  "Ambiente: ASSISTANT_BENCH_BASE_URL (HTTPS) e ASSISTANT_BENCH_API_KEY.",
].join("\n");

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.error) {
    if (parsed.error.startsWith("Uso:")) {
      console.log(parsed.error);
      return 2;
    }
    console.error(`Erro: ${parsed.error}`);
    return 2;
  }
  const args = parsed.args as ParsedArgs;
  if (!args.model) {
    console.error(`Erro: --model é obrigatório.\n\n${HELP}`);
    return 2;
  }
  const apiKey = process.env["ASSISTANT_BENCH_API_KEY"];
  const baseUrl = process.env["ASSISTANT_BENCH_BASE_URL"];
  if (!apiKey || !baseUrl) {
    console.error(
      "Erro: defina ASSISTANT_BENCH_BASE_URL (HTTPS) e ASSISTANT_BENCH_API_KEY no ambiente antes de rodar o bench.",
    );
    return 2;
  }
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    console.error("Erro: ASSISTANT_BENCH_BASE_URL não é uma URL válida.");
    return 2;
  }
  if (base.protocol !== "https:") {
    console.error("Erro: ASSISTANT_BENCH_BASE_URL deve usar HTTPS.");
    return 2;
  }
  let cases: BenchCase[];
  if (args.cases) {
    const known = new Map(BENCH_CASES.map((benchCase) => [benchCase.id, benchCase]));
    const missing = args.cases.filter((id) => !known.has(id));
    if (missing.length > 0) {
      console.error(`Erro: casos desconhecidos: ${missing.join(", ")}`);
      return 2;
    }
    cases = BENCH_CASES.filter((benchCase) => args.cases?.includes(benchCase.id));
  } else {
    cases = BENCH_CASES;
  }

  const config: BenchConfig = {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model: args.model,
    parallel: args.parallel,
    repeat: args.repeat,
    strict: args.strict,
    systemPrompt: SYSTEM_PROMPT,
    thinking: args.thinking,
    toolCount: BENCH_TOOLS.length,
  };
  const tools = llmToolDefs(args.strict);

  const runs: CaseRun[] = [];
  // One request at a time, always: cases and repeats run strictly in order.
  for (const benchCase of cases) {
    for (let repeat = 1; repeat <= args.repeat; repeat++) {
      const loop = await runAgentLoop({
        casePrompt: benchCase.prompt,
        client: {
          apiKey,
          baseUrl: config.baseUrl,
          conversationId: randomUUID(),
          model: args.model,
          parallelToolCalls: args.parallel === "omit" ? undefined : args.parallel === "on",
          thinking: args.thinking,
          tools,
        },
        respond: fixtureRespond,
        systemPrompt: SYSTEM_PROMPT,
      });
      const score = scoreCase(benchCase.expect, loop);
      const run = loopToRun(benchCase, loop, repeat, score);
      runs.push(run);
      const mark = score.pass ? "ok" : "falha";
      console.error(`[${repeat}/${args.repeat}] ${benchCase.id}: ${mark}${loop.error ? ` (erro: ${loop.error})` : ""}`);
    }
  }

  const aggregateResult = aggregate(runs, config);
  const generatedAt = new Date().toISOString();
  // Report boundary: redact the key from everything that will be printed or
  // written (the loop already sanitizes errors; finalText is model output an
  // appliance could have echoed the key into).
  for (const run of runs) {
    run.finalText = redactSecret(run.finalText, apiKey);
    run.error = run.error === null ? null : redactSecret(run.error, apiKey);
  }
  const reportData = { aggregate: aggregateResult, config, generatedAt, runs };
  const variant = `think-${args.thinking}_strict-${args.strict ? "on" : "off"}_parallel-${args.parallel}_r${args.repeat}`;
  const stamp = timestamp();
  mkdirSync(args.out, { recursive: true });
  const baseName = `bench-${safeName(args.model)}-${safeName(variant)}-${stamp}`;
  const markdownPath = join(args.out, `${baseName}.md`);
  const jsonPath = join(args.out, `${baseName}.json`);
  writeFileSync(markdownPath, renderReportMarkdown(reportData));
  writeFileSync(jsonPath, renderReportJson(reportData));
  console.error(`Relatório: ${markdownPath}`);
  console.error(`JSON:      ${jsonPath}`);
  const passRate = aggregateResult.passRate === null ? "n/d" : `${Math.round(aggregateResult.passRate * 100)}%`;
  console.log(`Bench ${args.model}: ${aggregateResult.totalPass}/${aggregateResult.totalRuns} execuções passaram (${passRate}).`);
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`Erro inesperado: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
