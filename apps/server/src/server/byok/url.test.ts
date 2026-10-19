import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BYOK_BASE_URL_MAX, type ByokUrlError, isPinarOwnHost, isPinarPublicHost, PINAR_PUBLIC_HOSTS, validateByokUrl } from "./url";

function allowed(input: string): string {
  const result = validateByokUrl(input);
  assert.ok("normalized" in result, `${input} must be allowed, got ${JSON.stringify(result)}`);
  return result.normalized;
}

function refused(input: string, error: ByokUrlError) {
  const result = validateByokUrl(input);
  assert.ok("error" in result, `${input} must be refused, got ${JSON.stringify(result)}`);
  assert.equal(result.error, error, `for ${input}`);
}

describe("validateByokUrl", () => {
  test("normalizes without a trailing slash, a query, a fragment or the default port", () => {
    assert.equal(allowed("https://api.example.com"), "https://api.example.com");
    assert.equal(allowed("https://api.example.com/"), "https://api.example.com");
    assert.equal(allowed("https://api.example.com//"), "https://api.example.com");
    assert.equal(allowed("https://api.example.com/v1"), "https://api.example.com/v1");
    assert.equal(allowed("https://api.example.com/v1/"), "https://api.example.com/v1");
    assert.equal(allowed("https://api.example.com:443/v1"), "https://api.example.com/v1");
    assert.equal(allowed("https://sub.example.co.uk/deep/path/"), "https://sub.example.co.uk/deep/path");
  });

  test("only https is allowed", () => {
    refused("http://api.example.com/v1", "not_https");
    refused("ftp://api.example.com", "not_https");
    refused("ws://api.example.com", "not_https");
    refused("API.EXAMPLE.COM", "unparseable"); // no scheme
    refused("", "unparseable");
    refused("  ", "unparseable");
    refused("https://", "unparseable");
    refused("https://exa mple.com", "unparseable");
  });

  test("no user or password in the URL", () => {
    refused("https://user:pass@api.example.com/v1", "has_credentials");
    refused("https://user@api.example.com/v1", "has_credentials");
    refused("https://:pass@api.example.com/v1", "has_credentials");
  });

  test("no query or fragment", () => {
    refused("https://api.example.com/v1?token=x", "has_query");
    refused("https://api.example.com/v1#frag", "has_fragment");
    refused("https://api.example.com?v1", "has_query");
  });

  test("only port 443 or no port", () => {
    refused("https://api.example.com:8443/v1", "bad_port");
    refused("https://api.example.com:08443/v1", "bad_port"); // the parser keeps 8443
    refused("https://api.example.com:0/v1", "bad_port");
    refused("https://api.example.com:1/v1", "bad_port");
  });

  test("no localhost nor *.local / *.internal names", () => {
    refused("https://localhost/v1", "private_host");
    refused("https://LOCALHOST/v1", "private_host");
    refused("https://sub.localhost/v1", "private_host");
    refused("https://foo.local/v1", "private_host");
    refused("https://a.b.local/v1", "private_host");
    refused("https://bar.internal/v1", "private_host");
    refused("https://metadata.google.internal/v1", "private_host");
  });

  test("the DNS trailing dot cannot bypass the hostname classes", () => {
    // The URL parser keeps the final dot in the hostname; it must be
    // canonicalized away before the classification (security review P2).
    refused("https://LOCALHOST./v1/", "private_host");
    refused("https://a.localhost./v1", "private_host");
    refused("https://metadata.google.internal./v1", "private_host");
    refused("https://foo.local./v1", "private_host");
    // The degenerate forms of a trailing dot are not hosts either.
    refused("https://./", "unparseable");
    refused("https://./v1", "unparseable");
  });

  test("a hostname with an empty label is not a host: it is refused as unparseable", () => {
    // Stripping a single terminal dot would leave the forbidden one-dot
    // form, so every empty label — a second terminal dot, `..` in the
    // middle or a leading dot — is refused before the classification
    // (security review P2, double-dot variant).
    refused("https://localhost..", "unparseable");
    refused("https://LOCALHOST..:443/v1/", "unparseable");
    refused("https://a.localhost..", "unparseable");
    refused("https://metadata.google.internal..", "unparseable");
    refused("https://foo.local..", "unparseable");
    refused("https://ｌｏｃａｌｈｏｓｔ..", "unparseable"); // fullwidth, mapped to `localhost..`
    refused("https://bücher.example..:443/v1/", "unparseable"); // IDN, mapped and then refused
    refused("https://.example.com", "unparseable"); // leading dot
    refused("https://a..b.example.com", "unparseable"); // empty label in the middle
    refused("https://example..com/", "unparseable");
    refused("https://..", "unparseable");
    refused("https://...", "unparseable");
    // IP literals with a second terminal dot parse as domains and carry `..`.
    refused("https://8.8.8.8..:443/", "unparseable");
    refused("https://127.0.0.1..:443/", "unparseable");
    // An IP literal with one terminal dot is canonicalized by the parser
    // into the dotted quad and classified by IP, not by dot rules.
    refused("https://127.0.0.1./v1", "private_host");
    assert.equal(allowed("https://8.8.8.8./v1"), "https://8.8.8.8/v1");
  });

  test("the stored URL is the host that was classified: the trailing dot is normalized away", () => {
    assert.equal(allowed("https://api.example.test./v1/"), "https://api.example.test/v1");
    assert.equal(allowed("https://api.example.test.:443/v1/"), "https://api.example.test/v1");
    assert.equal(allowed("https://sub.example.co.uk./deep/path/"), "https://sub.example.co.uk/deep/path");
    assert.equal(allowed("https://API.EXAMPLE.COM./v1/"), "https://api.example.com/v1");
  });

  test("is stable: every accepted URL revalidates to the same normalized form", () => {
    // The property the review demands: for every accepted URL,
    // validateByokUrl(normalized) accepts and returns the same normalized
    // URL. The list walks the hostile families (double dots, :443,
    // uppercase, fullwidth, IDN, IP literals with a trailing dot) plus
    // public hosts with and without the terminal dot.
    const cases: Array<[string, { normalized: string } | { error: ByokUrlError }]> = [
      // The review's double-dot family: refused, never stored.
      ["https://localhost..", { error: "unparseable" }],
      ["https://localhost..:443/v1/", { error: "unparseable" }],
      ["https://a.localhost..", { error: "unparseable" }],
      ["https://metadata.google.internal..", { error: "unparseable" }],
      ["https://foo.local..", { error: "unparseable" }],
      ["https://ｌｏｃａｌｈｏｓｔ..", { error: "unparseable" }],
      ["https://bücher.example..:443/v1/", { error: "unparseable" }],
      ["https://.example.com", { error: "unparseable" }],
      ["https://a..b.example.com", { error: "unparseable" }],
      ["https://..", { error: "unparseable" }],
      // One terminal dot is accepted and stripped, with and without :443.
      ["https://api.example.test.", { normalized: "https://api.example.test" }],
      ["https://api.example.test./v1/", { normalized: "https://api.example.test/v1" }],
      ["https://api.example.test.:443/v1/", { normalized: "https://api.example.test/v1" }],
      ["https://API.EXAMPLE.COM./v1/", { normalized: "https://api.example.com/v1" }],
      ["https://sub.example.co.uk./deep/path/", { normalized: "https://sub.example.co.uk/deep/path" }],
      // IDN: one terminal dot is stripped on the mapped form.
      ["https://bücher.example.", { normalized: "https://xn--bcher-kva.example" }],
      ["https://bücher.example.:443/v1", { normalized: "https://xn--bcher-kva.example/v1" }],
      // Uppercase with one terminal dot.
      ["https://API.EXAMPLE.COM.", { normalized: "https://api.example.com" }],
      // Public hosts, with and without the terminal dot.
      ["https://api.example.com", { normalized: "https://api.example.com" }],
      ["https://api.example.com.", { normalized: "https://api.example.com" }],
      ["https://8.8.8.8", { normalized: "https://8.8.8.8" }],
      ["https://8.8.8.8.", { normalized: "https://8.8.8.8" }],
      ["https://1.1.1.1./v1", { normalized: "https://1.1.1.1/v1" }],
      ["https://[2606:4700:4700::1111]/v1", { normalized: "https://[2606:4700:4700::1111]/v1" }],
      // IP literals with a trailing dot are canonicalized by the parser.
      ["https://127.0.0.1./v1", { error: "private_host" }],
      ["https://169.254.169.254./v1", { error: "private_host" }],
    ];
    for (const [input, expected] of cases) {
      assert.deepEqual(validateByokUrl(input), expected, `for ${JSON.stringify(input)}`);
      if ("normalized" in expected) {
        // The stored form must revalidate to itself: the classifier and the
        // stored URL agree on the very host that was classified.
        assert.deepEqual(
          validateByokUrl(expected.normalized),
          expected,
          `revalidating ${JSON.stringify(expected.normalized)}`,
        );
      }
    }
  });

  test("refuses private, loopback, link-local and CGNAT IPv4 literals", () => {
    // The plain dotted forms.
    refused("https://127.0.0.1/v1", "private_host");
    refused("https://127.255.255.254/v1", "private_host");
    refused("https://10.1.2.3/v1", "private_host");
    refused("https://172.16.0.1/v1", "private_host");
    refused("https://172.31.255.255/v1", "private_host");
    refused("https://192.168.1.1/v1", "private_host");
    refused("https://0.0.0.0/v1", "private_host");
    // CGNAT 100.64/10 and the link-local cloud metadata IP.
    refused("https://100.64.0.1/v1", "private_host");
    refused("https://100.127.255.255/v1", "private_host");
    refused("https://169.254.169.254/v1", "private_host"); // the cloud metadata IP
    refused("https://169.254.0.1/v1", "private_host");
    // Boundary control: just outside the refused ranges stays allowed.
    allowed("https://100.63.255.255/v1"); // just before 100.64/10
    allowed("https://100.128.0.1/v1"); // just after 100.64/10
    allowed("https://172.15.0.1/v1"); // just before 172.16/12
    allowed("https://172.32.0.1/v1"); // just after 172.16/12
    allowed("https://9.255.255.255/v1"); // just before 10/8
  });

  test("refuses the decimal, octal, hex and short spellings of a private IP", () => {
    // WHATWG URL canonicalizes all of these into the dotted quad.
    refused("https://2130706433/v1", "private_host"); // 127.0.0.1 in decimal
    refused("https://167772160/v1", "private_host"); // 10.0.0.0 in decimal
    refused("https://3232235531/v1", "private_host"); // 192.168.0.1 in decimal
    refused("https://0177.0.0.1/v1", "private_host"); // 127.0.0.1 in octal
    refused("https://012.0.0.0/v1", "private_host"); // 10.0.0.0 in octal
    refused("https://0x7f000001/v1", "private_host"); // 127.0.0.1 in hex
    refused("https://0x0a000000/v1", "private_host"); // 10.0.0.0 in hex
    refused("https://127.1/v1", "private_host"); // the short form of 127.0.0.1
    refused("https://10.1/v1", "private_host"); // the short form of 10.0.0.1
    refused("https://192.168.1/v1", "private_host"); // the short form of 192.168.0.1
  });

  test("refuses the hostile IPv6 literals, including the IPv4-mapped and -compatible", () => {
    refused("https://[::1]/v1", "private_host"); // loopback
    refused("https://[::]/v1", "private_host"); // unspecified
    refused("https://[fe80::1]/v1", "private_host"); // link-local
    refused("https://[fc00::1]/v1", "private_host"); // unique local (private)
    refused("https://[fd00:ec2::254]/v1", "private_host"); // the IPv6 cloud metadata address
    refused("https://[::ffff:127.0.0.1]/v1", "private_host"); // IPv4-mapped loopback
    refused("https://[::ffff:192.168.0.1]/v1", "private_host"); // IPv4-mapped private
    refused("https://[0:0:0:0:ffff:c0a8:0:1]/v1", "private_host"); // the mapped form, uncompressed
    refused("https://[::ffff:100.64.0.1]/v1", "private_host"); // mapped CGNAT
    refused("https://[::192.168.0.1]/v1", "private_host"); // IPv4-compatible private
    refused("https://[::7f00:1]/v1", "private_host"); // the hex spelling of ::127.0.0.1
    // Public literals stay allowed: this barrier refuses only the named classes.
    allowed("https://[2606:4700:4700::1111]/v1");
    allowed("https://[::ffff:8.8.8.8]/v1");
  });

  test("public IP literals and ordinary hostnames are allowed", () => {
    allowed("https://8.8.8.8/v1");
    allowed("https://1.1.1.1/v1");
    allowed("https://api.example.com/v1");
  });

  test("the base URL is capped at 2048 characters", () => {
    const longHost = "a".repeat(200) + ".example.com";
    refused(`https://${longHost}/` + "p".repeat(BYOK_BASE_URL_MAX - longHost.length + 20), "too_long");
    allowed(`https://${longHost}/`);
  });
});

describe("isPinarOwnHost", () => {
  const REQUEST = "https://pinar.test/api/byok";

  test("the public hosts, in any case, with the DNS trailing dot and the default port", () => {
    assert.deepEqual(PINAR_PUBLIC_HOSTS, ["pinar.dev", "www.pinar.dev"]);
    for (const baseUrl of [
      "https://pinar.dev",
      "https://pinar.dev/v1",
      "https://www.pinar.dev/v1",
      "https://PINAR.DEV/v1",
      "https://Www.Pinar.Dev",
      "https://pinar.dev./v1",
      "https://www.pinar.dev.",
      "https://pinar.dev:443/v1",
      "https://PINAR.DEV.:443/v1",
    ]) {
      assert.equal(isPinarOwnHost(baseUrl, REQUEST), true, baseUrl);
    }
  });

  test("the host of the request, normalized on both sides", () => {
    assert.equal(isPinarOwnHost("https://pinar.test/v1", REQUEST), true);
    assert.equal(isPinarOwnHost("https://PINAR.TEST./v1", REQUEST), true);
    assert.equal(isPinarOwnHost("https://stg.pinar.dev/v1", "https://STG.PINAR.DEV./api/byok"), true);
    assert.equal(isPinarOwnHost("https://stg.pinar.dev:443/v1", "https://stg.pinar.dev/api/byok/test"), true);
    // Another request host does not make the staging host the Pinar.
    assert.equal(isPinarOwnHost("https://stg.pinar.dev/v1", REQUEST), false);
  });

  test("a neighbor host is not the Pinar", () => {
    for (const baseUrl of [
      "https://api.pinar.dev.example/v1",
      "https://pinar.dev.example",
      "https://notpinar.dev",
      "https://pinar.devs/v1",
      "https://api.pinar.dev/v1",
      "https://pinar.test.example/v1",
      "https://example.com/pinar.dev",
    ]) {
      assert.equal(isPinarOwnHost(baseUrl, REQUEST), false, baseUrl);
    }
  });

  test("an unparseable URL is not a host; an unparseable request leaves the public hosts", () => {
    assert.equal(isPinarOwnHost("not a url", REQUEST), false);
    assert.equal(isPinarOwnHost("https://pinar.dev/v1", "not a url"), true);
    assert.equal(isPinarOwnHost("https://pinar.test/v1", "not a url"), false);
  });
});

describe("isPinarPublicHost", () => {
  test("the public hosts, in any case, with the DNS trailing dot, the port and a path", () => {
    for (const baseUrl of [
      "https://pinar.dev",
      "https://www.pinar.dev",
      "https://PINAR.DEV",
      "https://pinar.dev.",
      "https://pinar.dev:443",
      "https://pinar.dev:8443/v1",
      "https://www.pinar.dev/v1",
    ]) {
      assert.equal(isPinarPublicHost(baseUrl), true, baseUrl);
    }
  });

  test("a neighbor host, another route's host or an unparseable URL is not a public host", () => {
    for (const baseUrl of [
      "https://api.pinar.dev.example",
      "https://pinar.dev.example",
      "https://stg.pinar.dev/v1",
      "https://notpinar.dev",
      "https://pinar.dev..",
      "not a url",
    ]) {
      assert.equal(isPinarPublicHost(baseUrl), false, baseUrl);
    }
  });
});
