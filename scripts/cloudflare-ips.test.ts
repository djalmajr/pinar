import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLOUDFLARE_V4_URL,
  CLOUDFLARE_V6_URL,
  extractSourceRange,
  isCidr,
  parseCloudflareIps,
  rewriteSourceRange,
  runCloudflareIps,
} from "./cloudflare-ips.ts";

const REAL_FILE = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "deploy",
  "k8s",
  "pinar",
  "cloudflare-only.yaml",
);
const REAL_TEXT = () => readFileSync(REAL_FILE, "utf8");
const REAL_RANGES = extractSourceRange(REAL_TEXT());
const V4_TEXT = REAL_RANGES.filter((range) => range.includes(".")).join("\n") + "\n";
const V6_TEXT = REAL_RANGES.filter((range) => range.includes(":")).join("\n") + "\n";

type FakeBody = Response | string | Error | (() => Response | Promise<Response>);
function fakeFetch(v4: FakeBody, v6: FakeBody) {
  const calls: { init: RequestInit | undefined; url: string }[] = [];
  const fn = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({ init, url });
    const pick = url === CLOUDFLARE_V4_URL ? v4 : v6;
    if (pick instanceof Error) throw pick;
    const resolved = typeof pick === "function" ? await pick() : pick;
    return typeof resolved === "string" ? new Response(resolved) : resolved;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function withTempFile(run: (file: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "cloudflare-ips-"));
  return (async () => {
    try {
      await run(join(dir, "cloudflare-only.yaml"));
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  })();
}

function commentHeader(text: string): string[] {
  return text.split("\n").slice(0, text.split("\n").findIndex((line) => line.startsWith("apiVersion")));
}

describe("isCidr", () => {
  test("accepts every published range, per family", () => {
    for (const range of REAL_RANGES.filter((range) => range.includes("."))) {
      expect(isCidr(range, 4)).toBe(true);
    }
    for (const range of REAL_RANGES.filter((range) => range.includes(":"))) {
      expect(isCidr(range, 6)).toBe(true);
    }
  });

  test("accepts the brief's passing examples", () => {
    expect(isCidr("173.245.48.0/20", 4)).toBe(true);
    expect(isCidr("2a06:98c0::/29", 6)).toBe(true);
    expect(isCidr("2400:cb00::/32", 6)).toBe(true);
  });

  test("accepts valid IPv6 forms, including full and compressed addresses", () => {
    for (const range of ["::/0", "::1/128", "2001:db8:0:0:0:0:0:1/128", "2a06:98c0::/29"]) {
      expect(isCidr(range, 6)).toBe(true);
    }
    expect(isCidr("0.0.0.0/0", 4)).toBe(true);
  });

  test("rejects the brief's failing examples", () => {
    for (const [line, family] of [
      [":1::/64", 6],
      ["1::2:/64", 6],
      ["001.2.3.4/24", 4],
      ["1.2.3.4/33", 4],
      ["2400:cb00::/129", 6],
      ["1.2.3.4", 4],
      ["1.2.3.4/", 4],
      ["1.2.3.4/024", 4],
      ["fe80::1%eth0/64", 6],
    ] as const) {
      expect(isCidr(line, family)).toBe(false);
    }
  });

  test("rejects leading-zero IPv4 octets (node:net.isIP refuses them)", () => {
    for (const line of ["001.2.3.4/24", "01.2.3.4/24", "1.2.3.01/24"]) {
      expect(isCidr(line, 4)).toBe(false);
    }
  });

  test("rejects a range of the wrong family", () => {
    expect(isCidr("1.2.3.4/24", 6)).toBe(false);
    expect(isCidr("2001:db8::/32", 4)).toBe(false);
  });

  test("rejects invalid ranges", () => {
    for (const [line, family] of [
      ["1.2.3.4/33", 4],
      ["999.1.1.1/8", 4],
      ["1.2.3/8", 4],
      ["1.2.3.4", 4],
      ["/24", 4],
      ["1.2.3.4/08", 4],
      ["2001:db8:::1/32", 6],
      ["2001:db8::/129", 6],
      ["1:2:3:4:5:6:7:8:9/64", 6],
      ["1::2::3/64", 6],
      [":::1/32", 6],
      ["abc", 4],
      ["", 4],
    ] as const) {
      expect(isCidr(line, family)).toBe(false);
    }
  });
});

describe("parseCloudflareIps", () => {
  test("keeps the received order (v4 then v6) and ignores blank lines", () => {
    const v4 = `${REAL_RANGES[0]}\n\n${REAL_RANGES[1]}\n   \n`;
    const v6 = `\n${REAL_RANGES[16]}\n${REAL_RANGES[21]}\n`;
    expect(parseCloudflareIps(v4, v6)).toEqual([REAL_RANGES[0], REAL_RANGES[1], REAL_RANGES[16], REAL_RANGES[21]]);
  });

  test("rejects an invalid range in the ips-v4 response, with the exact message", () => {
    for (const line of ["1.2.3.4/33", "999.1.1.1/8", "001.2.3.4/24", "1.2.3.4"]) {
      let message = "";
      try {
        parseCloudflareIps(`${line}\n`, "2001:db8::/32\n");
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(`invalid range in ips-v4: ${line}`);
    }
  });

  test("rejects an invalid range in the ips-v6 response, including a v4 range in the wrong family", () => {
    for (const line of ["2001:db8:::1/32", ":1::/64", "1::2:/64", "1.2.3.4/24"]) {
      let message = "";
      try {
        parseCloudflareIps("173.245.48.0/20\n", `${line}\n`);
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(`invalid range in ips-v6: ${line}`);
    }
  });

  test("rejects an empty ips-v4 response even when ips-v6 is complete", () => {
    let message = "";
    try {
      parseCloudflareIps("\n  \n", V6_TEXT);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("ips-v4 returned no IPv4 range");
  });

  test("rejects an empty ips-v6 response even when ips-v4 is complete", () => {
    let message = "";
    try {
      parseCloudflareIps(V4_TEXT, "   \n");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe("ips-v6 returned no IPv6 range");
  });

  test("rejects two empty responses: a bad pair must never empty the allowlist", () => {
    expect(() => parseCloudflareIps("\n  \n", "\n")).toThrow(/^ips-v4 returned no IPv4 range$/);
  });
});

describe("rewriteSourceRange", () => {
  test("swaps only the list items, keeping the comment and everything else byte-for-byte", () => {
    const synthetic = [
      "# top comment, line 1",
      "# top comment, line 2",
      "apiVersion: traefik.io/v1alpha1",
      "kind: Middleware",
      "metadata:",
      "  name: x",
      "spec:",
      "  ipAllowList:",
      "    sourceRange:",
      "      - 10.0.0.0/8",
      "      - 10.1.0.0/16",
      "  trailing: kept",
      "",
    ].join("\n");
    const out = rewriteSourceRange(synthetic, ["10.0.0.0/8", "10.2.0.0/15", "2001:db8::/32"]);
    expect(out).toBe(
      [
        "# top comment, line 1",
        "# top comment, line 2",
        "apiVersion: traefik.io/v1alpha1",
        "kind: Middleware",
        "metadata:",
        "  name: x",
        "spec:",
        "  ipAllowList:",
        "    sourceRange:",
        "      - 10.0.0.0/8",
        "      - 10.2.0.0/15",
        "      - 2001:db8::/32",
        "  trailing: kept",
        "",
      ].join("\n"),
    );
  });

  test("on the real file, only the sourceRange changes", () => {
    const text = REAL_TEXT();
    const changed = [...REAL_RANGES.slice(0, -1), "192.0.2.0/24"];
    const rewritten = rewriteSourceRange(text, changed);
    expect(rewritten).not.toBe(text);
    expect(commentHeader(rewritten)).toEqual(commentHeader(text));
    const before = Bun.YAML.parse(text) as Record<string, any>;
    const after = Bun.YAML.parse(rewritten) as Record<string, any>;
    expect(after.apiVersion).toBe(before.apiVersion);
    expect(after.kind).toBe(before.kind);
    expect(after.metadata).toEqual(before.metadata);
    expect(after.spec.ipStrategy).toBeUndefined();
    expect(after.spec.ipAllowList.sourceRange).toEqual(changed);
  });

  test("throws when the sourceRange list is missing", () => {
    expect(() => rewriteSourceRange("apiVersion: v1\nkind: ConfigMap\n", ["10.0.0.0/8"])).toThrow(
      /sourceRange list not found/,
    );
  });
});

describe("runCloudflareIps", () => {
  test("update mode rewrites only the list (valid IPv4 and IPv6 accepted) and keeps the comment", async () => {
    await withTempFile(async (file) => {
      writeFileSync(file, REAL_TEXT());
      // The replacement must stay in the v6 family (last slot is an IPv6 range).
      const changed = [...REAL_RANGES.slice(0, -1), "2001:db8::/32"];
      const { fn, calls } = fakeFetch(changed.slice(0, 15).join("\n") + "\n", changed.slice(15).join("\n") + "\n");
      const out: string[] = [];
      const code = await runCloudflareIps({ args: [], fetch: fn, file, out: (line) => out.push(line) });
      expect(code).toBe(0);
      expect(calls.map((c) => c.url).sort()).toEqual([CLOUDFLARE_V4_URL, CLOUDFLARE_V6_URL]);
      const next = readFileSync(file, "utf8");
      expect(next).not.toBe(REAL_TEXT());
      expect(commentHeader(next)).toEqual(commentHeader(REAL_TEXT()));
      expect(extractSourceRange(next)).toEqual(changed);
      expect(out).toHaveLength(1);
      expect(out[0]).toContain(file);
    });
  });

  test("passes an AbortSignal to fetch", async () => {
    await withTempFile(async (file) => {
      writeFileSync(file, REAL_TEXT());
      const { fn, calls } = fakeFetch(V4_TEXT, V6_TEXT);
      const code = await runCloudflareIps({ args: [], fetch: fn, file, out: () => {} });
      expect(code).toBe(0);
      for (const call of calls) expect(call.init?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  test("--check exits 0 when the list matches and leaves the file untouched", async () => {
    await withTempFile(async (file) => {
      const text = REAL_TEXT();
      writeFileSync(file, text);
      const { fn } = fakeFetch(V4_TEXT, V6_TEXT);
      const code = await runCloudflareIps({ args: ["--check"], fetch: fn, file, out: () => {} });
      expect(code).toBe(0);
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  });

  test("--check exits 1 with the exact message when the list differs", async () => {
    await withTempFile(async (file) => {
      const text = REAL_TEXT();
      writeFileSync(file, text);
      const { fn } = fakeFetch(V4_TEXT, V6_TEXT.replace(REAL_RANGES[16], "2001:db8::/120"));
      const out: string[] = [];
      const code = await runCloudflareIps({ args: ["--check"], fetch: fn, file, out: (line) => out.push(line) });
      expect(code).toBe(1);
      expect(out[0]).toBe("cloudflare-only.yaml is out of date");
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  });

  test("a 200 response with an invalid range errors without writing", async () => {
    await withTempFile(async (file) => {
      const text = REAL_TEXT();
      writeFileSync(file, text);
      const { fn } = fakeFetch("1.2.3.4/33\n", V6_TEXT);
      const out: string[] = [];
      const code = await runCloudflareIps({ args: [], fetch: fn, file, out: (line) => out.push(line) });
      expect(code).toBe(1);
      expect(out[0]).toBe("invalid range in ips-v4: 1.2.3.4/33");
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  });

  test("an empty 200 response errors without writing", async () => {
    await withTempFile(async (file) => {
      const text = REAL_TEXT();
      writeFileSync(file, text);
      const { fn } = fakeFetch("", "");
      const out: string[] = [];
      const code = await runCloudflareIps({ args: [], fetch: fn, file, out: (line) => out.push(line) });
      expect(code).toBe(1);
      expect(out[0]).toBe("ips-v4 returned no IPv4 range");
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  });

  test("an empty ips-v4 response errors without writing, even with a complete ips-v6", async () => {
    await withTempFile(async (file) => {
      const text = REAL_TEXT();
      writeFileSync(file, text);
      const { fn } = fakeFetch("", V6_TEXT);
      const out: string[] = [];
      const code = await runCloudflareIps({ args: [], fetch: fn, file, out: (line) => out.push(line) });
      expect(code).toBe(1);
      expect(out[0]).toBe("ips-v4 returned no IPv4 range");
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  });

  test("an empty ips-v6 response errors without writing, even with a complete ips-v4", async () => {
    await withTempFile(async (file) => {
      const text = REAL_TEXT();
      writeFileSync(file, text);
      const { fn } = fakeFetch(V4_TEXT, "\n");
      const out: string[] = [];
      const code = await runCloudflareIps({ args: [], fetch: fn, file, out: (line) => out.push(line) });
      expect(code).toBe(1);
      expect(out[0]).toBe("ips-v6 returned no IPv6 range");
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  });

  test("a 200 response with an invalid v6 line (the reviewer's :1::/64) errors without writing", async () => {
    await withTempFile(async (file) => {
      const text = REAL_TEXT();
      writeFileSync(file, text);
      const { fn } = fakeFetch(V4_TEXT, ":1::/64\n");
      const out: string[] = [];
      const code = await runCloudflareIps({ args: [], fetch: fn, file, out: (line) => out.push(line) });
      expect(code).toBe(1);
      expect(out[0]).toBe("invalid range in ips-v6: :1::/64");
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  });

  test("a 500 response errors without writing", async () => {
    await withTempFile(async (file) => {
      const text = REAL_TEXT();
      writeFileSync(file, text);
      const { fn } = fakeFetch(new Response("oops", { status: 500 }), V6_TEXT);
      const out: string[] = [];
      const code = await runCloudflareIps({ args: [], fetch: fn, file, out: (line) => out.push(line) });
      expect(code).toBe(1);
      expect(out[0]).toContain("HTTP 500");
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  });

  test("a network failure errors without writing", async () => {
    await withTempFile(async (file) => {
      const text = REAL_TEXT();
      writeFileSync(file, text);
      const { fn } = fakeFetch(new TypeError("fetch failed"), V6_TEXT);
      const code = await runCloudflareIps({ args: [], fetch: fn, file, out: () => {} });
      expect(code).toBe(1);
      expect(readFileSync(file, "utf8")).toBe(text);
    });
  });

  test("an unknown argument is refused before any fetch", async () => {
    await withTempFile(async (file) => {
      writeFileSync(file, REAL_TEXT());
      const { fn, calls } = fakeFetch(V4_TEXT, V6_TEXT);
      const out: string[] = [];
      const code = await runCloudflareIps({ args: ["--stale"], fetch: fn, file, out: (line) => out.push(line) });
      expect(code).toBe(1);
      expect(out[0]).toBe("unknown argument: --stale");
      expect(calls).toHaveLength(0);
    });
  });
});
