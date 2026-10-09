import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";

const root = join(import.meta.dir, "..");

const checkoutV7 = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1";
const setupBunV2 = "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 # v2";

function jobBlock(source: string, key: string): string {
  const start = source.search(new RegExp(`^  ${key}:$`, "m"));
  expect(start, `job ${key} missing from ci.yml`).toBeGreaterThanOrEqual(0);
  const block = source.slice(start);
  const nextJob = block.slice(1).search(/^  [A-Za-z]/m);
  return nextJob === -1 ? block : block.slice(0, nextJob + 1);
}

describe("CI workflow", () => {
  const workflow = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");

  test("triggers only on pull_request with read-only permissions", () => {
    expect(workflow).toContain("name: CI");
    expect(workflow).toMatch(/^on:\n  pull_request:\s*$/m);
    expect(workflow).not.toContain("pull_request_target");
    expect(workflow).not.toContain("workflow_dispatch");
    expect(workflow).not.toContain("push:");
    expect(workflow).not.toContain("branches:");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).not.toContain("contents: write");
  });

  test("cancels superseded runs of the same pull request", () => {
    expect(workflow).toContain("group: ci-${{ github.workflow }}-${{ github.event.pull_request.number }}");
    expect(workflow).toContain("cancel-in-progress: true");
  });

  test("runs each OS on its own check with the repo gates", () => {
    const windows = jobBlock(workflow, "windows");
    const macos = jobBlock(workflow, "macos");
    const linux = jobBlock(workflow, "linux");
    expect(windows).toContain("runs-on: windows-latest");
    expect(windows).toContain("shell: pwsh");
    expect(windows).toContain("timeout-minutes: 60");
    // The runner default would rewrite LF to CRLF and break the i18n byte-identity test.
    expect(windows).toContain("core.autocrlf input");
    expect(windows).toContain("core.eol lf");
    expect(windows.indexOf("core.autocrlf input")).toBeLessThan(windows.indexOf("uses: actions/checkout"));
    expect(macos).toContain("runs-on: macos-14");
    expect(macos).toContain("timeout-minutes: 60");
    expect(linux).toContain("runs-on: ubuntu-latest");
    expect(linux).toContain("timeout-minutes: 45");
    for (const block of [windows, macos, linux]) {
      expect(block).toContain(checkoutV7);
      // A full tag history is needed: the release-content test lists `git tag v*`.
      expect(block).toContain("fetch-depth: 0");
      expect(block).toContain(setupBunV2);
      expect(block).toContain("bun-version: 1.4.0");
      expect(block).toContain("bun install --frozen-lockfile");
      expect(block).toContain("bun run typecheck");
      expect(block).toContain("bun run test");
    }
  });

  test("never reads secrets or publishes anything", () => {
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("GITHUB_TOKEN");
    expect(workflow).not.toContain("gh release");
    expect(workflow).not.toContain("wrangler");
    expect(workflow).not.toContain("npm publish");
    expect(workflow).not.toContain("upload-artifact");
  });

  test("fails the job when a gate or the smoke fails", () => {
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toContain("|| true");
    expect(workflow).not.toContain("if: false");
  });

  test("installs Hutch and smokes the tray startup on macOS and Windows", () => {
    const windows = jobBlock(workflow, "windows");
    const macos = jobBlock(workflow, "macos");
    expect(windows).toContain("hutch/install.ps1");
    expect(windows).toContain("-Version 0.25.0");
    expect(windows).toContain("-NoModifyPath");
    expect(macos).toContain("hutch/install.sh");
    expect(macos).toContain("--version 0.25.0");
    expect(macos).toContain('echo "$HOME/.hutch/bin" >> "$GITHUB_PATH"');
    for (const block of [windows, macos]) {
      expect(block).toContain("bun run build:tray");
      expect(block).toContain("bun scripts/tray-smoke.mjs --timeout-ms 120000");
      expect(block).toContain("tray-smoke.log");
      expect(block).toContain("if: failure()");
    }
    expect(windows).toContain("Get-Content");
    expect(macos).toContain("cat ");
  });

  test("keeps the tray build and smoke off the Linux job", () => {
    const linux = jobBlock(workflow, "linux");
    expect(linux).not.toContain("bun run build:tray");
    expect(linux).not.toContain("tray-smoke");
    expect(linux).not.toContain("hutch/install");
    expect(workflow).toContain("The tray ships for macOS and Windows only");
  });
});
