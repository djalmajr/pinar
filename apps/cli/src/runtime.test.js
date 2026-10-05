import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { isCompiledModuleUrl } from "./runtime.mjs";

describe("isCompiledModuleUrl", () => {
  test("matches the compiled module urls", () => {
    assert.equal(isCompiledModuleUrl("file:///$bunfs/root/pinar"), true);
    assert.equal(isCompiledModuleUrl("file:///B:/%7EBUN/root/pinar.exe"), true);
    assert.equal(isCompiledModuleUrl("file:///B:/~BUN/root/pinar.exe"), true);
  });

  test("does not match plain source urls", () => {
    assert.equal(isCompiledModuleUrl("file:///C:/Users/u/repo/apps/cli/src/cli.mjs"), false);
    assert.equal(isCompiledModuleUrl("file:///C:/Users/u/AppData/Local/Temp/bun-build/out/pinar.js"), false);
  });
});
