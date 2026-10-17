import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { BYOK_BASE_URL_MAX, type ByokUrlError, validateByokUrl } from "./url";

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
