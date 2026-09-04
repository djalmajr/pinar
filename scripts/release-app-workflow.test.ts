import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "..");

describe("Pinar.app release workflow", () => {
  const workflow = readFileSync(join(root, ".github/workflows/release-app.yml"), "utf8");
  const checkoutV7 = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";

  test("builds an existing product tag on a macOS runner", () => {
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain(checkoutV7);
    expect(workflow).toContain("ref: ${{ inputs.tag }}");
    expect(workflow).toContain("runs-on: macos-14");
    expect(workflow).toContain("hutch/install.sh");
    expect(workflow).toContain("--version 0.25.0");
    expect(workflow).toContain('echo "$HOME/.hutch/bin" >> "$GITHUB_PATH"');
    expect(workflow).toContain("bun run release:check");
    expect(workflow).toContain("bun run build:tray");
  });

  test("uses GitHub secrets for signing and notarization", () => {
    for (const secret of [
      "APPLE_CERTIFICATE",
      "APPLE_CERTIFICATE_PASSWORD",
      "APPLE_API_KEY_P8_BASE64",
      "APPLE_API_KEY",
      "APPLE_API_ISSUER",
    ]) {
      expect(workflow).toContain(`secrets.${secret}`);
    }
    expect(workflow).toContain("security create-keychain");
    expect(workflow).toContain("security import");
  });

  test("verifies artifacts before publishing the GitHub release", () => {
    expect(workflow).toContain("xcrun stapler validate");
    expect(workflow).toContain("spctl --assess");
    expect(workflow).toContain("macos-arm64-Pinar.dmg");
    expect(workflow).toContain("stable-macos-arm64-Pinar.app.tar.zst");
    expect(workflow).toContain("stable-macos-arm64-update.json");
    expect(workflow).toContain('gh release edit "$RELEASE_TAG" --draft=false --latest');
  });

  test("builds an unsigned Windows installer on a Windows runner", () => {
    expect(workflow).toContain("runs-on: windows-latest");
    expect(workflow).toContain("hutch/install.ps1");
    expect(workflow).toContain("-Version 0.25.0");
    expect(workflow).toContain("-NoModifyPath");
    expect(workflow).toContain(
      'Add-Content -Path $env:GITHUB_PATH -Value (Join-Path $env:USERPROFILE ".hutch\\bin")',
    );
    expect(workflow).toContain("win-x64-Pinar-Setup.zip");
    expect(workflow).not.toContain("win-x64-Pinar-Setup.exe");
    expect(workflow).toContain(".installer/");
    expect(workflow).toContain("Pinar-Setup.exe");
    expect(workflow).toContain("stable-win-x64-Pinar.tar.zst");
    expect(workflow).toContain("stable-win-x64-update.json");
    expect(workflow).toContain("ConvertFrom-Json");
    expect(workflow).toContain('$manifest.version -ne $expectedVersion');
    expect(workflow).not.toContain("signtool");
    expect(workflow).not.toContain("Get-AuthenticodeSignature");
  });

  test("copies the Windows installer after Electrobun packaging", () => {
    const config = readFileSync(join(root, "apps/tray/electrobun.config.ts"), "utf8");
    expect(config).toContain('postPackage: "scripts/post-build.mjs"');
  });
});
