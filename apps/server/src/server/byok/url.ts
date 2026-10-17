// F5/S1: the first barrier of the BYOK base URL (F5 contract §1).
//
// The EdgeR egress guard (A55) resolves the DNS and enforces the allowlist
// before any request leaves; this is the server-side preflight that refuses
// what can never be a legitimate OpenAI-compatible endpoint before anything
// is stored. It never resolves names: a hostname that later points at a
// private IP is the guard's job (S6), not this one's. The input is parsed by
// WHATWG URL, which canonicalizes the hostile IP spellings (decimal, octal,
// hex, the short "127.1" form, and the IPv4-mapped/IPv4-compatible IPv6)
// into a dotted quad or a bracketed v6 that is classified here.

export const BYOK_BASE_URL_MAX = 2048;

export type ByokUrlError =
  | "unparseable"
  | "too_long"
  | "not_https"
  | "has_credentials"
  | "has_query"
  | "has_fragment"
  | "bad_port"
  | "private_host";

export type ByokUrlResult = { normalized: string } | { error: ByokUrlError };

/**
 * Validates and normalizes the BYOK base URL. The normalized form is
 * `https://host[/path]` without a trailing slash, without a query or
 * fragment, and without the default port.
 */
export function validateByokUrl(input: unknown): ByokUrlResult {
  if (typeof input !== "string" || input.length === 0) return { error: "unparseable" };
  if (input.length > BYOK_BASE_URL_MAX) return { error: "too_long" };
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { error: "unparseable" };
  }
  if (url.protocol !== "https:") return { error: "not_https" };
  if (url.username !== "" || url.password !== "") return { error: "has_credentials" };
  if (url.search !== "") return { error: "has_query" };
  if (url.hash !== "") return { error: "has_fragment" };
  // The WHATWG URL strips the default port of a special scheme, so a
  // non-empty port here is always a non-default one; "443" is the only
  // other value the parser keeps for https.
  if (url.port !== "" && url.port !== "443") return { error: "bad_port" };
  const host = bareHostname(url.hostname);
  if (host === "") return { error: "unparseable" };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return { error: "private_host" };
  if (isPrivateIp(host)) return { error: "private_host" };
  let path = url.pathname;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return { normalized: url.origin + (path === "/" ? "" : path) };
}

function bareHostname(hostname: string): string {
  // IPv6 literals arrive bracketed and lowercased by the URL parser; the
  // zone (if any survives) does not change the class of the address.
  const zone = hostname.indexOf("%");
  const name = zone === -1 ? hostname : hostname.slice(0, zone);
  return name.startsWith("[") && name.endsWith("]") ? name.slice(1, -1) : name;
}

/** The canonical IPv4 classes this first barrier refuses: private, loopback, link-local and CGNAT. */
function isPrivateIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10 || a === 127) return true; // 10/8, 127/8 (loopback)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 (CGNAT)
  if (a === 169 && b === 254) return true; // 169.254/16 (link-local, the cloud metadata IP)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  return false;
}

function ipv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    out.push(value);
  }
  return [out[0], out[1], out[2], out[3]];
}

/** Expands an IPv6 literal (no brackets) to eight 16-bit groups, or null. */
function ipv6Groups(ip: string): number[] | null {
  if (!ip.includes(":")) return null;
  const compression = ip.indexOf("::");
  if (ip.indexOf("::", compression + 1) !== -1) return null; // two "::"
  const leftText = compression === -1 ? ip : ip.slice(0, compression);
  const rightText = compression === -1 ? "" : ip.slice(compression + 2);
  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const out: number[] = [];
    for (const part of side.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      out.push(Number.parseInt(part, 16));
    }
    return out;
  };
  const left = parseSide(leftText);
  const right = parseSide(rightText);
  if (left === null || right === null) return null;
  if (compression === -1) return left.length + right.length === 8 ? [...left, ...right] : null;
  if (left.length + right.length > 7) return null;
  return [...left, ...new Array<number>(8 - left.length - right.length).fill(0), ...right];
}

/** True when the literal (an IPv4 dotted quad or a bracket-less IPv6) is not publicly routable. */
function isPrivateIp(host: string): boolean {
  const v4 = ipv4Octets(host);
  if (v4 !== null) return isPrivateIpv4(v4);
  const groups = ipv6Groups(host);
  if (groups === null) return false;
  // :: and ::1
  if (groups.every((group) => group === 0)) return true;
  if (groups.slice(0, -1).every((group) => group === 0) && groups[7] === 1) return true;
  // fe80::/10 (link-local) and fc00::/7 (unique local, private; it holds
  // the IPv6 cloud metadata address fd00:ec2::254).
  if ((groups[0] & 0xffc0) === 0xfe80) return true;
  if ((groups[0] & 0xfe00) === 0xfc00) return true;
  // An embedded IPv4: the IPv4-mapped ::ffff:a:b, and the IPv4-compatible
  // ::a:b (the parser writes both the dotted "127.0.0.1" and the hex
  // forms). The last two groups hold the four octets.
  const zerosBefore = (width: number) => groups.slice(0, 8 - width).every((group) => group === 0);
  const embedded = (g6: number, g7: number) =>
    isPrivateIpv4([(g6 >> 8) & 0xff, g6 & 0xff, (g7 >> 8) & 0xff, g7 & 0xff]);
  if (zerosBefore(6) && (groups[6] !== 0 || groups[7] !== 0)) return embedded(groups[6], groups[7]);
  if (zerosBefore(5) && groups[5] === 0xffff) return embedded(groups[6], groups[7]);
  return false;
}
