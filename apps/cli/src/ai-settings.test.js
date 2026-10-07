import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, test } from "node:test";
import {
  createAiCredentialVault,
  readAiSettings,
  readAiSettingsMetadata,
  VAULT_COMMAND_SPAWN_OPTIONS,
  writeAiSettings,
} from "./ai-settings.mjs";

describe("local AI settings", () => {
  test("hides the console window of every vault command", () => {
    assert.equal(VAULT_COMMAND_SPAWN_OPTIONS.windowsHide, true);
  });

  test("reads the stored metadata without asking the vault", async () => {
    const root = mkdtempSync(join(tmpdir(), "pinar-ai-meta-"));
    const stored = {
      endpoint: "https://api.example.test/v1",
      mode: "byok",
      model: "model-a",
      transcriptionModel: "parakeet",
    };
    writeFileSync(join(root, "ai.json"), JSON.stringify(stored));
    // readAiSettingsMetadata takes no vault at all, so it cannot spawn one.
    assert.equal(readAiSettingsMetadata.length, 0);
    assert.deepEqual(readAiSettingsMetadata(root), stored);
  });

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
      transcriptionModel: "whisper-large-v3",
    }, root, vault);

    const stored = readFileSync(join(root, "ai.json"), "utf8");
    assert.doesNotMatch(stored, /sk-stored/);
    assert.match(stored, /api\.example\.test/);
    assert.match(stored, /whisper-large-v3/);
    assert.equal(calls[0][0], "security");
    assert.deepEqual(await readAiSettings(root, vault), {
      apiKey: "sk-stored",
      endpoint: "https://api.example.test/v1",
      hasApiKey: true,
      mode: "byok",
      model: "model-a",
      transcriptionModel: "whisper-large-v3",
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
      transcriptionModel: "",
    });
    assert.ok(calls.some(([, args]) => args[0] === "delete-generic-password"));
  });

  test("reads an empty transcriptionModel from an ai.json written before the field existed", async () => {
    const root = mkdtempSync(join(tmpdir(), "pinar-ai-"));
    writeFileSync(join(root, "ai.json"), JSON.stringify({
      endpoint: "http://localhost:11434/v1",
      mode: "local",
      model: "llama3.2",
    }));
    const vault = createAiCredentialVault({ platform: "darwin", run: async () => ({ stdout: "" }) });
    assert.deepEqual(await readAiSettings(root, vault), {
      endpoint: "http://localhost:11434/v1",
      hasApiKey: false,
      mode: "local",
      model: "llama3.2",
      transcriptionModel: "",
    });
  });

  test("stores a trimmed transcriptionModel capped at 200 characters", async () => {
    const root = mkdtempSync(join(tmpdir(), "pinar-ai-"));
    const vault = createAiCredentialVault({ platform: "darwin", run: async () => ({ stdout: "" }) });
    const long = "m".repeat(205);
    const saved = await writeAiSettings({
      endpoint: "http://localhost:11434/v1",
      mode: "local",
      model: "llama3.2",
      transcriptionModel: `  ${long}  `,
    }, root, vault);
    assert.equal(saved.transcriptionModel, "m".repeat(200));
    const stored = JSON.parse(readFileSync(join(root, "ai.json"), "utf8"));
    assert.equal(stored.transcriptionModel, "m".repeat(200));
    assert.equal((await readAiSettings(root, vault)).transcriptionModel, "m".repeat(200));
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
