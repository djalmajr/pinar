// Keeps the Cloudflare public IP ranges in deploy/k8s/pinar/cloudflare-only.yaml
// fresh. Downloads https://www.cloudflare.com/ips-v4 and /ips-v6 (one CIDR per
// line, blank lines ignored) and rewrites only the sourceRange list, keeping
// the comments and the rest of the file untouched. Order is as received: v4
// then v6.
//
//   bun scripts/cloudflare-ips.ts          download and rewrite the file
//   bun scripts/cloudflare-ips.ts --check  CI gate: exit 1 with
//                                          "cloudflare-only.yaml is out of date"
//                                          when the list differs
//
// A bad response (non-2xx, an empty family, an invalid or wrong-family
// CIDR) never writes the file: the allowlist can only ever be replaced by
// a complete, valid range set.

import { readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

export const CLOUDFLARE_V4_URL = "https://www.cloudflare.com/ips-v4";
export const CLOUDFLARE_V6_URL = "https://www.cloudflare.com/ips-v6";
const DEFAULT_FILE = fileURLToPath(new URL("../deploy/k8s/pinar/cloudflare-only.yaml", import.meta.url));
const FETCH_TIMEOUT_MS = 20_000;

const STALE_MESSAGE = "cloudflare-only.yaml is out of date";
const FRESH_MESSAGE = "cloudflare-only.yaml is up to date";

/**
 * Validates one family's response and returns its lines. Each response is
 * validated on its own, before the two lists are concatenated: an empty
 * body, or a line that is not a valid CIDR of this family, is an error.
 */
function parseFamily(text: string, label: string, family: 4 | 6): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new Error(`${label} returned no IPv${family} range`);
  }
  for (const line of lines) {
    if (!isCidr(line, family)) throw new Error(`invalid range in ${label}: ${line}`);
  }
  return lines;
}

/**
 * Parses the two Cloudflare responses (v4 text then v6 text) into an
 * ordered range list. Each response is validated alone first (v4 then v6):
 * both must be non-empty and every line must be a CIDR of its own family,
 * so a bad response never produces an incomplete or invalid allowlist.
 */
export function parseCloudflareIps(v4Text: string, v6Text: string): string[] {
  return [...parseFamily(v4Text, "ips-v4", 4), ...parseFamily(v6Text, "ips-v6", 6)];
}

/**
 * True when `line` is a valid CIDR: an address that `node:net.isIP` accepts
 * (4 or 6; `family` pins the expected one), split from the prefix at the
 * LAST `/`, with the prefix an unsigned decimal integer without leading
 * zeros, within the family's maximum (32 for v4, 128 for v6). Leading-zero
 * IPv4 octets are rejected by `isIP` itself.
 */
export function isCidr(line: string, family?: 4 | 6): boolean {
  const slash = line.lastIndexOf("/");
  if (slash <= 0 || slash === line.length - 1) return false;
  const address = line.slice(0, slash);
  const prefixText = line.slice(slash + 1);
  // `isIP` accepts an IPv6 zone (`fe80::1%eth0`), which is not a CIDR the
  // Traefik (Go net.ParseCIDR) allowlist accepts.
  if (address.includes("%")) return false;
  const detected = isIP(address);
  if (detected === 0) return false;
  if (family !== undefined && detected !== family) return false;
  // Unsigned decimal, no leading zeros (`0` itself is fine).
  if (!/^(0|[1-9]\d*)$/.test(prefixText)) return false;
  return Number(prefixText) <= (detected === 4 ? 32 : 128);
}

/** Returns the current sourceRange list of the middleware YAML (or [] when the list is empty). */
export function extractSourceRange(yamlText: string): string[] {
  const lines = yamlText.split("\n");
  const keyIndex = lines.findIndex((line) => /^\s*sourceRange:\s*$/.test(line));
  if (keyIndex === -1) throw new Error("sourceRange list not found in cloudflare-only.yaml");
  const ranges: string[] = [];
  for (let i = keyIndex + 1; i < lines.length; i++) {
    const item = /^(\s*-) (.*)$/.exec(lines[i]);
    if (item !== null) {
      ranges.push(item[2]);
      continue;
    }
    if (lines[i].trim() !== "") break;
  }
  return ranges;
}

/**
 * Replaces only the sourceRange list items with `ranges`, preserving the
 * comments, indentation and everything else in the file.
 */
export function rewriteSourceRange(yamlText: string, ranges: string[]): string {
  const lines = yamlText.split("\n");
  const keyIndex = lines.findIndex((line) => /^\s*sourceRange:\s*$/.test(line));
  if (keyIndex === -1) throw new Error("sourceRange list not found in cloudflare-only.yaml");
  let keyIndent = 0;
  let firstItemIndex = -1;
  let lastItemIndex = -1;
  let itemIndent = 0;
  for (let i = keyIndex + 1; i < lines.length; i++) {
    const item = /^(\s*)- /.exec(lines[i]);
    if (item !== null) {
      if (firstItemIndex === -1) {
        firstItemIndex = i;
        itemIndent = item[1].length;
      }
      lastItemIndex = i;
      continue;
    }
    if (lines[i].trim() !== "") break;
  }
  if (firstItemIndex === -1) {
    const key = /^(\s*)sourceRange:\s*$/.exec(lines[keyIndex]);
    if (key === null) throw new Error("sourceRange list not found in cloudflare-only.yaml");
    keyIndent = key[1].length;
  }
  const prefix = firstItemIndex === -1 ? " ".repeat(keyIndent + 2) : " ".repeat(itemIndent);
  const replacement = ranges.map((range) => `${prefix}- ${range}`);
  if (firstItemIndex === -1) {
    return [...lines.slice(0, keyIndex + 1), ...replacement, ...lines.slice(keyIndex + 1)].join("\n");
  }
  return [...lines.slice(0, firstItemIndex), ...replacement, ...lines.slice(lastItemIndex + 1)].join("\n");
}

export interface CloudflareIpsOptions {
  /** CLI args; only `--check` is recognized. */
  args?: string[];
  /** The cloudflare-only.yaml to read/update. */
  file?: string;
  /** Injectable fetch (tests). */
  fetch?: typeof fetch;
  /** Message sink (tests capture it). */
  out?: (line: string) => void;
}

/**
 * Downloads the range sets, validates them, and either checks (exit 0/1) or
 * rewrites the sourceRange list. Returns the process exit code; never writes
 * the file when anything is wrong.
 */
export async function runCloudflareIps(options: CloudflareIpsOptions = {}): Promise<number> {
  const {
    args = process.argv.slice(2),
    file = DEFAULT_FILE,
    fetch: fetchFn = fetch,
    out = (line) => console.log(line),
  } = options;
  const unknown = args.filter((arg) => arg !== "--check");
  if (unknown.length > 0) {
    out(`unknown argument: ${unknown[0]}`);
    return 1;
  }
  const check = args.includes("--check");

  const fetchText = async (url: string): Promise<string> => {
    const response = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
    return await response.text();
  };

  let ranges: string[];
  try {
    const [v4Text, v6Text] = await Promise.all([fetchText(CLOUDFLARE_V4_URL), fetchText(CLOUDFLARE_V6_URL)]);
    ranges = parseCloudflareIps(v4Text, v6Text);
  } catch (error) {
    out(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    out(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (check) {
    const current = extractSourceRange(text);
    if (current.length === ranges.length && current.every((range, i) => range === ranges[i])) {
      out(FRESH_MESSAGE);
      return 0;
    }
    out(STALE_MESSAGE);
    out(`file has ${current.length} ranges, Cloudflare publishes ${ranges.length}`);
    for (const range of ranges.filter((range) => !current.includes(range))) out(`  + ${range}`);
    for (const range of current.filter((range) => !ranges.includes(range))) out(`  - ${range}`);
    return 1;
  }

  let rewritten: string;
  try {
    rewritten = rewriteSourceRange(text, ranges);
  } catch (error) {
    out(error instanceof Error ? error.message : String(error));
    return 1;
  }
  writeFileSync(file, rewritten);
  out(`wrote ${ranges.length} ranges to ${file}`);
  return 0;
}

if (import.meta.main) {
  runCloudflareIps().then((code) => {
    process.exitCode = code;
  });
}
