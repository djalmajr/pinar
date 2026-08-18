import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { installerResponse } from "./installers";

describe("installer responses", () => {
  test("serve the build's Unix and PowerShell installers as cacheable plain text", async () => {
    const unix = installerResponse("/install.sh");
    assert.ok(unix);
    assert.equal(unix.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.equal(unix.headers.get("cache-control"), "public, max-age=300");
    assert.match(await unix.text(), /^#!\/bin\/sh/);

    const powershell = installerResponse("/install.ps1");
    assert.ok(powershell);
    assert.equal(powershell.headers.get("content-type"), "text/plain; charset=utf-8");
    assert.match(await powershell.text(), /ErrorActionPreference|Invoke-WebRequest/i);

    assert.equal(installerResponse("/install.exe"), null);
  });
});
