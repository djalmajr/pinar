import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "..");

describe("Pinar.app release workflow", () => {
  const workflow = readFileSync(join(root, ".github/workflows/release-app.yml"), "utf8");

  test("builds an existing product tag on a macOS runner", () => {
    expect(workflow).toContain("workflow_dispatch:");
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
});
