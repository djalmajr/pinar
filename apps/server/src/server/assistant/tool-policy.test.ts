import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { CLOUD_MCP_TOOLS } from "../cloud-api";
import { LOCAL_MCP_TOOLS } from "../local-mcp";
import {
  ASSISTANT_TOOL_POLICY,
  assistantToolsFor,
  fromLlmToolName,
  toLlmToolName,
  type AssistantTool,
} from "./tool-policy";

const LLM_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

const LOCAL_NAMES = LOCAL_MCP_TOOLS.map((tool) => tool.name);
const CLOUD_NAMES = CLOUD_MCP_TOOLS.map((tool) => tool.name);
const UNION_NAMES = [...new Set([...LOCAL_NAMES, ...CLOUD_NAMES])];
const POLICY_NAMES = Object.keys(ASSISTANT_TOOL_POLICY);

const jsonSha256 = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

describe("ASSISTANT_TOOL_POLICY coverage", () => {
  test("keys are exactly the union of LOCAL_MCP_TOOLS and CLOUD_MCP_TOOLS names", () => {
    const missing = UNION_NAMES.filter((name) => !POLICY_NAMES.includes(name));
    const extra = POLICY_NAMES.filter((name) => !UNION_NAMES.includes(name));
    assert.equal(missing.length, 0, `policy is missing MCP tool name(s): ${missing.join(", ") || "-"}`);
    assert.equal(extra.length, 0, `policy has unknown MCP tool name(s): ${extra.join(", ") || "-"}`);
  });

  test("surfaces keep their sizes: 36 local, 39 cloud, cloud = local + 3", () => {
    assert.equal(LOCAL_NAMES.length, 36);
    assert.equal(CLOUD_NAMES.length, 39);
    assert.equal(new Set(LOCAL_NAMES).size, LOCAL_NAMES.length, "local names must be unique");
    assert.equal(new Set(CLOUD_NAMES).size, CLOUD_NAMES.length, "cloud names must be unique");
    const localSet = new Set(LOCAL_NAMES);
    const cloudOnly = CLOUD_NAMES.filter((name) => !localSet.has(name));
    assert.deepEqual(cloudOnly.sort(), ["pinar.key_scope", "pinar.publish_share", "pinar.revoke_share"].sort());
  });
});

describe("risk rules", () => {
  test("every exclude has a reason", () => {
    for (const [name, entry] of Object.entries(ASSISTANT_TOOL_POLICY)) {
      if (entry.assistant !== "exclude") continue;
      assert.ok(
        typeof entry.reason === "string" && entry.reason.trim().length > 0,
        `${name} is excluded without a reason`,
      );
    }
  });

  test("read tools have risk none and write tools never have risk none", () => {
    for (const [name, entry] of Object.entries(ASSISTANT_TOOL_POLICY)) {
      assert.equal(
        entry.kind === "read",
        entry.risk === "none",
        `${name}: kind "${entry.kind}" does not match risk "${entry.risk}"`,
      );
    }
  });

  test("every delete_* tool is irreversible", () => {
    const deleters = POLICY_NAMES.filter((name) => name.startsWith("pinar.delete_"));
    assert.equal(deleters.length, 6, "expected the six delete_* tools");
    for (const name of deleters) {
      assert.equal(ASSISTANT_TOOL_POLICY[name].risk, "irreversible", `${name} must be irreversible`);
    }
  });

  test("publish_share and revoke_share are external", () => {
    assert.equal(ASSISTANT_TOOL_POLICY["pinar.publish_share"].risk, "external");
    assert.equal(ASSISTANT_TOOL_POLICY["pinar.revoke_share"].risk, "external");
  });

  test("reviewed undo risks: conclude_pin, reopen_pin, update_session and edit_pin_note are irreversible", () => {
    for (const name of ["pinar.conclude_pin", "pinar.reopen_pin", "pinar.update_session", "pinar.edit_pin_note"]) {
      assert.equal(ASSISTANT_TOOL_POLICY[name].risk, "irreversible", `${name} must be irreversible`);
    }
  });
});

describe("LLM names", () => {
  test("every llmName matches ^[a-zA-Z0-9_-]{1,64}$, is unique, and round-trips", () => {
    const llmNames = POLICY_NAMES.map(toLlmToolName);
    assert.equal(new Set(llmNames).size, llmNames.length, "llmNames must be unique");
    for (const name of POLICY_NAMES) {
      const llmName = toLlmToolName(name);
      assert.match(llmName, LLM_NAME_PATTERN, `${name} -> ${llmName} is not a valid LLM tool name`);
      assert.equal(fromLlmToolName(llmName), name, `round-trip failed for ${name}`);
    }
  });

  test("fromLlmToolName returns undefined for unknown names", () => {
    assert.equal(fromLlmToolName("pinar_not_a_tool"), undefined);
    assert.equal(fromLlmToolName("pinar.list-sessions"), undefined);
    assert.equal(fromLlmToolName("pinar.list_sessions_extra"), undefined);
    assert.equal(fromLlmToolName(""), undefined);
    assert.equal(fromLlmToolName("pinar_list_sessions "), undefined);
  });
});

describe("assistantToolsFor", () => {
  const checkIdentity = (tools: AssistantTool[], originals: typeof LOCAL_MCP_TOOLS) => {
    assert.equal(tools.length, originals.length);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      originals.map((tool) => tool.name),
      "order must match the MCP list",
    );
    tools.forEach((tool, index) => {
      const original = originals[index];
      assert.equal(tool.name, original.name);
      assert.equal(tool.description, original.description, `${original.name}: description changed`);
      assert.equal(tool.inputSchema, original.inputSchema, `${original.name}: inputSchema must stay the same object`);
      assert.equal(tool.llmName, toLlmToolName(original.name));
      assert.equal(tool.policy, ASSISTANT_TOOL_POLICY[original.name]);
      assert.equal(tool.policy.assistant, "include", `${original.name} is not included`);
    });
  };

  test("local keeps the MCP order and definitions and returns 36 tools", () => {
    checkIdentity(assistantToolsFor("local"), LOCAL_MCP_TOOLS);
  });

  test("cloud drops only key_scope, keeps the MCP order and returns 38 tools", () => {
    const cloudTools = assistantToolsFor("cloud");
    const expected = CLOUD_MCP_TOOLS.filter((tool) => tool.name !== "pinar.key_scope");
    checkIdentity(cloudTools, expected);
    assert.ok(!cloudTools.some((tool) => tool.name === "pinar.key_scope"), "key_scope must be excluded");
  });
});

describe("MCP list guard snapshot", () => {
  // The JSON of both MCP tool lists must not change because of this slice.
  // The baselines were generated once (bun -e, one-time) from the imported
  // lists themselves at origin/main 49c6575; local-mcp.ts and cloud-api.ts
  // are byte-identical between origin/main and this worktree (verified in
  // the slice report via git diff), so these hashes are the origin/main
  // hashes.
  const LOCAL_TOOLS_JSON_SHA256 = "484d123473da2bfa068ac464247b9ad67050391238b1227e891179714f5876f1";
  const CLOUD_TOOLS_JSON_SHA256 = "0d6bf63053dbd1e8bd5e93b5331086fafaf416d8cd887e0d47ca2c09c35b15ab";

  test("LOCAL_MCP_TOOLS and CLOUD_MCP_TOOLS JSON are unchanged", () => {
    assert.equal(
      jsonSha256(LOCAL_MCP_TOOLS),
      LOCAL_TOOLS_JSON_SHA256,
      "LOCAL_MCP_TOOLS JSON changed; update the guard snapshot deliberately",
    );
    assert.equal(
      jsonSha256(CLOUD_MCP_TOOLS),
      CLOUD_TOOLS_JSON_SHA256,
      "CLOUD_MCP_TOOLS JSON changed; update the guard snapshot deliberately",
    );
  });
});

describe("light import graph", () => {
  // Review finding 3: importing the policy must not load the server modules
  // (local-mcp.ts / cloud-api.ts), whose runtime import pulls the Cloud
  // stack. Checked statically: the walker extracts every static import/
  // export-from specifier (incl. type-only and side-effect) and every
  // dynamic import() from each source file, resolves relative module
  // specifiers (Bun resolution: exact, .ts, .tsx, .js, .mjs, index.ts)
  // and stops at package specifiers (node_modules) and asset specifiers
  // with query suffixes (?raw, ?url). The static graph is a superset of
  // the runtime graph, so a light static graph proves the runtime import is
  // light. Limitation: strings that merely look like `from "./x"` would be
  // followed; the modules in this slice contain none (verified).
  test("tool-policy.ts does not reach local-mcp.ts or cloud-api.ts", () => {
    const start = resolve(dirname(fileURLToPath(import.meta.url)), "tool-policy.ts");
    const visited: string[] = [];
    const seen = new Set<string>();
    const stack = [start];
    const specifiersOf = (file: string): string[] => {
      const source = readFileSync(file, "utf8");
      const specs: string[] = [];
      const pattern = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(source)) !== null) specs.push(match[1]);
      return specs;
    };
    const resolveSpecifier = (specifier: string, fromFile: string): string | null => {
      // Vite asset suffixes (?raw, ?url, ...) are file-content imports, not
      // module loads: stop at them.
      if (specifier.includes("?")) return null;
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) return null;
      const base = resolve(dirname(fromFile), specifier);
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, resolve(base, "index.ts")]) {
        if (existsSync(candidate)) return candidate;
      }
      throw new Error(`unresolved relative specifier ${specifier} in ${fromFile}`);
    };
    while (stack.length > 0) {
      const file = stack.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      visited.push(file);
      for (const specifier of specifiersOf(file)) {
        const next = resolveSpecifier(specifier, file);
        if (next) stack.push(next);
      }
    }
    const names = visited.map((file) => basename(file));
    // Positive controls: the walker must have followed into the light
    // modules; otherwise the negative assertions below would be vacuous.
    assert.ok(names.includes("mcp-tools-local.ts"), `walker did not reach mcp-tools-local.ts: ${names.join(", ")}`);
    assert.ok(names.includes("mcp-tools-cloud.ts"), `walker did not reach mcp-tools-cloud.ts: ${names.join(", ")}`);
    // The server modules must not be reachable from the policy.
    assert.ok(!names.includes("cloud-api.ts"), `policy graph reaches cloud-api.ts: ${names.join(", ")}`);
    assert.ok(!names.includes("local-mcp.ts"), `policy graph reaches local-mcp.ts: ${names.join(", ")}`);
  });
});
