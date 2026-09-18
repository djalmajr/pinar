import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  createAiCredentialVault,
  readAiSettings,
  writeAiSettings,
} from "./ai-settings.mjs";

describe("local AI settings", () => {
  test("stores endpoint and model on disk but keeps the API key in the OS vault", async () => {
    const root = mkdtempSync(join(tmpdir(), "pinar-ai-"));
    const calls = [];
    const vault = createAiCredentialVault({
      platform: "darwin",
      run: async (command, args) => {
        calls.push([command, args]);
        return { stdout: args[0] === "find-generic-password" ? "sk-stored\n" : "" };
      },
    });
    await writeAiSettings({
      apiKey: "sk-stored",
      endpoint: "https://api.example.test/v1",
      mode: "byok",
      model: "model-a",
    }, root, vault);

    const stored = readFileSync(join(root, "ai.json"), "utf8");
    assert.doesNotMatch(stored, /sk-stored/);
    assert.match(stored, /api\.example\.test/);
    assert.equal(calls[0][0], "security");
    assert.deepEqual(await readAiSettings(root, vault), {
      apiKey: "sk-stored",
      endpoint: "https://api.example.test/v1",
      hasApiKey: true,
      mode: "byok",
      model: "model-a",
    });
  });

  test("local mode works without a key and clearing BYOK removes the vault entry", async () => {
    const root = mkdtempSync(join(tmpdir(), "pinar-ai-"));
    const calls = [];
    const vault = createAiCredentialVault({
      platform: "darwin",
      run: async (command, args) => {
        calls.push([command, args]);
        if (args[0] === "find-generic-password") throw Object.assign(new Error("missing"), { code: 44 });
        return { stdout: "" };
      },
    });
    await writeAiSettings({ endpoint: "http://localhost:11434/v1", mode: "local", model: "llama3.2" }, root, vault);
    assert.deepEqual(await readAiSettings(root, vault), {
      endpoint: "http://localhost:11434/v1",
      hasApiKey: false,
      mode: "local",
      model: "llama3.2",
    });
    assert.ok(calls.some(([, args]) => args[0] === "delete-generic-password"));
  });

  test("uses the Windows credential vault rather than writing a secret file", async () => {
    const calls = [];
    const vault = createAiCredentialVault({
      platform: "win32",
      run: async (command, args) => {
        calls.push([command, args]);
        return { stdout: "" };
      },
    });
    await vault.set("secret");
    assert.match(calls[0][0], /powershell/i);
    assert.ok(calls[0][1].includes("-EncodedCommand"));
    assert.equal(calls[0][1].some((part) => part === "secret"), false);
  });
});
