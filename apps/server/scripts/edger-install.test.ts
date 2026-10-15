import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  adminEndpoint,
  assembleEnv,
  databaseHostPort,
  fillManifest,
  loadWranglerEnv,
  manifestEnvKeys,
  parseEnvFile,
  parseInstallArgs,
  readApiKey,
  redactSecrets,
  runEdgerInstall,
  type RunOptions,
} from "./edger-install";

// Module-local shim: the tests run on Bun, where the global exists; the
// project tsconfig does not load Bun types for `scripts`.
declare const Bun: {
  YAML: { parse: (text: string) => unknown; stringify: (value: unknown) => string };
};

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKTREE_ROOT = resolve(SERVER_DIR, "..", "..");
const REAL_MANIFEST = join(SERVER_DIR, "edger", "manifest.yaml");
const REAL_WRANGLER = join(SERVER_DIR, "wrangler.jsonc");
const TEMPLATE = readFileSync(REAL_MANIFEST, "utf8");

const STAGING_ENV_FILE = [
  "# staging secrets",
  "",
  "DEPLOYMENT_ENV=staging",
  "DATABASE_URL=http://pinar-stg.edger.svc.cluster.local:8080",
  "AUTH_PEPPER=pepper-staging-000000",
  "EXTENSION_ORIGIN=https://chrome.google.com",
  "STRIPE_SECRET_KEY=sk_test_staging_000",
  "STRIPE_WEBHOOK_SECRET=whsec_staging_000",
  "S3_ACCESS_KEY_ID=AKIASTG0000000000001",
  "S3_BUCKET=pinar-stg",
  "S3_ENDPOINT=https://pinar-stg.r2.cloudflarestorage.com",
  "S3_REGION=auto",
  "S3_SECRET_ACCESS_KEY=s3secret-staging-000",
  "CLOUDFLARE_ACCOUNT_ID=1427e570ac9806fcc2626c20e0d38b3d",
  "CLOUDFLARE_EMAIL_API_TOKEN=cfemail-staging-000",
].join("\n");

const PRODUCTION_ENV_FILE = [
  "DEPLOYMENT_ENV=production",
  "DATABASE_URL=https://pinar-prd.edger.svc.cluster.local",
  "AUTH_PEPPER=pepper-production-000000",
  "EXTENSION_ORIGIN=https://chrome.google.com",
  "STRIPE_SECRET_KEY=sk_live_production_000",
  "STRIPE_WEBHOOK_SECRET=whsec_production_000",
].join("\n");

interface Capture {
  body: Uint8Array | null;
  headers: Record<string, string>;
  method: string;
  url: string;
}

interface FakeFetchResult {
  body?: string;
  status?: number;
}

function fakeFetch(
  captures: Capture[],
  respond: (index: number) => FakeFetchResult,
): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    const body =
      init?.body === undefined || init?.body === null
        ? null
        : new Uint8Array(init.body as unknown as ArrayLike<number>);
    const index = captures.length;
    captures.push({
      body,
      headers,
      method: init?.method ?? "GET",
      url: String(input),
    });
    const result = respond(index);
    return new Response(result.body ?? "", { status: result.status ?? 200 });
  };
}

interface Fixture {
  area: string;
  envFile: string;
  keyFile: string;
  rootDir: string;
  tempParent: string;
}

function installFixture(): Fixture {
  const area = mkdtempSync(join(tmpdir(), "pinar-edger-install-test-"));
  const rootDir = join(area, "root");
  mkdirSync(join(rootDir, "apps/server/dist/edger/server"), { recursive: true });
  mkdirSync(join(rootDir, "apps/server/edger"), { recursive: true });
  writeFileSync(join(rootDir, "package.json"), JSON.stringify({ name: "pinar", version: "9.9.9" }));
  writeFileSync(
    join(rootDir, "apps/server/wrangler.jsonc"),
    readFileSync(REAL_WRANGLER, "utf8"),
  );
  writeFileSync(
    join(rootDir, "apps/server/edger/manifest.yaml"),
    readFileSync(REAL_MANIFEST, "utf8"),
  );
  writeFileSync(
    join(rootDir, "apps/server/dist/edger/manifest.yaml"),
    readFileSync(REAL_MANIFEST, "utf8"),
  );
  writeFileSync(
    join(rootDir, "apps/server/dist/edger/server/server.js"),
    "export default {};\n",
  );
  const keyFile = join(area, "api-key");
  writeFileSync(keyFile, "test-api-key-123\n", { mode: 0o600 });
  const envFile = join(area, "env");
  const tempParent = join(area, "tmp");
  mkdirSync(tempParent);
  return { area, envFile, keyFile, rootDir, tempParent };
}

function writeEnvFile(fixture: Fixture, content: string): void {
  writeFileSync(fixture.envFile, content, { mode: 0o600 });
}

interface RunOutcome {
  code: number;
  lines: string[];
}

async function run(
  fixture: Fixture,
  argv: string[],
  fetchImpl: typeof fetch,
  extra: Partial<RunOptions> = {},
): Promise<RunOutcome> {
  const lines: string[] = [];
  const code = await runEdgerInstall(argv, {
    fetch: fetchImpl,
    log: (line) => {
      lines.push(line);
    },
    rootDir: fixture.rootDir,
    tempParent: fixture.tempParent,
    ...extra,
  });
  return { code, lines };
}

function stagingArgs(fixture: Fixture, extra: string[] = []): string[] {
  return [
    "--url",
    "https://stg.pinar.dev",
    "--env",
    "staging",
    "--env-file",
    fixture.envFile,
    "--api-key-file",
    fixture.keyFile,
    "--no-build",
    ...extra,
  ];
}

function noTempLeftovers(fixture: Fixture): void {
  const leftovers = readdirSync(fixture.tempParent).filter((name) =>
    name.startsWith("pinar-edger-install-"),
  );
  assert.deepEqual(leftovers, []);
}

function unzipEntry(zipFile: string, entry: string): string {
  return execFileSync("unzip", ["-p", zipFile, entry], { encoding: "utf8" });
}

function unzipList(zipFile: string): string {
  return execFileSync("unzip", ["-l", zipFile], { encoding: "utf8" });
}

describe("parseInstallArgs", () => {
  test("parses the staging form", () => {
    const args = parseInstallArgs([
      "--url",
      "https://stg.pinar.dev",
      "--env",
      "staging",
      "--env-file",
      "env.txt",
    ]);
    assert.deepEqual(args, {
      build: true,
      env: "staging",
      envFile: "env.txt",
      noPromote: false,
      url: "https://stg.pinar.dev",
    });
  });

  test("parses --flag=value forms and the booleans", () => {
    const args = parseInstallArgs([
      "--url=https://pinar.dev",
      "--env=production",
      "--env-file=env.txt",
      "--api-key-file=key.txt",
      "--version=1.2.3-rc.1",
      "--no-build",
      "--no-promote",
    ]);
    assert.equal(args.build, false);
    assert.equal(args.env, "production");
    assert.equal(args.noPromote, true);
    assert.equal(args.apiKeyFile, "key.txt");
    assert.equal(args.version, "1.2.3-rc.1");
  });

  test("rejects a non-http(s) url", () => {
    assert.throws(
      () =>
        parseInstallArgs([
          "--url",
          "ftp://stg.pinar.dev",
          "--env",
          "staging",
          "--env-file",
          "env.txt",
        ]),
      /--url must be an absolute http\(s\) URL without credentials/,
    );
  });

  test("rejects a relative url", () => {
    assert.throws(
      () =>
        parseInstallArgs([
          "--url",
          "stg.pinar.dev",
          "--env",
          "staging",
          "--env-file",
          "env.txt",
        ]),
      /--url must be an absolute http\(s\) URL without credentials/,
    );
  });

  test("rejects a url with credentials", () => {
    assert.throws(
      () =>
        parseInstallArgs([
          "--url",
          "https://user:pass@stg.pinar.dev",
          "--env",
          "staging",
          "--env-file",
          "env.txt",
        ]),
      /--url must be an absolute http\(s\) URL without credentials/,
    );
  });

  test("rejects an unknown --env", () => {
    assert.throws(
      () =>
        parseInstallArgs([
          "--url",
          "https://stg.pinar.dev",
          "--env",
          "prod",
          "--env-file",
          "env.txt",
        ]),
      /--env must be staging or production/,
    );
  });

  test("rejects a non-semver --version and accepts a prerelease", () => {
    assert.throws(
      () =>
        parseInstallArgs([
          "--url",
          "https://stg.pinar.dev",
          "--env",
          "staging",
          "--env-file",
          "env.txt",
          "--version",
          "1.2",
        ]),
      /--version must be a semver/,
    );
    const args = parseInstallArgs([
      "--url",
      "https://stg.pinar.dev",
      "--env",
      "staging",
      "--env-file",
      "env.txt",
      "--version",
      "1.2.3-rc.1",
    ]);
    assert.equal(args.version, "1.2.3-rc.1");
  });

  test("requires url, env and env-file", () => {
    assert.throws(() => parseInstallArgs(["--env", "staging", "--env-file", "e.txt"]), /--url is required/);
    assert.throws(
      () => parseInstallArgs(["--url", "https://stg.pinar.dev", "--env-file", "e.txt"]),
      /--env is required/,
    );
    assert.throws(
      () => parseInstallArgs(["--url", "https://stg.pinar.dev", "--env", "staging"]),
      /--env-file is required/,
    );
  });

  test("rejects an unknown flag", () => {
    assert.throws(
      () =>
        parseInstallArgs([
          "--url",
          "https://stg.pinar.dev",
          "--env",
          "staging",
          "--env-file",
          "env.txt",
          "--bogus",
        ]),
      /unknown argument: --bogus/,
    );
  });

  test("parses --artifact-dir (both forms) and disables the build", () => {
    const area = mkdtempSync(join(tmpdir(), "pinar-edger-artifact-test-"));
    try {
      writeFileSync(join(area, "manifest.yaml"), "name: pinar\n");
      const args = parseInstallArgs([
        "--url",
        "https://stg.pinar.dev",
        "--env",
        "staging",
        "--env-file",
        "env.txt",
        "--artifact-dir",
        area,
      ]);
      assert.equal(args.artifactDir, area);
      assert.equal(args.build, false);
      const equals = parseInstallArgs([
        "--url",
        "https://stg.pinar.dev",
        "--env",
        "staging",
        "--env-file",
        "env.txt",
        `--artifact-dir=${area}`,
      ]);
      assert.equal(equals.artifactDir, area);
      assert.equal(equals.build, false);
    } finally {
      rmSync(area, { recursive: true, force: true });
    }
  });

  test("rejects --artifact-dir without a value", () => {
    assert.throws(
      () =>
        parseInstallArgs([
          "--url",
          "https://stg.pinar.dev",
          "--env",
          "staging",
          "--env-file",
          "env.txt",
          "--artifact-dir",
        ]),
      /--artifact-dir requires a value/,
    );
  });

  test("rejects a --artifact-dir without a manifest.yaml", () => {
    const area = mkdtempSync(join(tmpdir(), "pinar-edger-artifact-test-"));
    try {
      writeFileSync(join(area, "server.js"), "export default {};\n");
      assert.throws(
        () =>
          parseInstallArgs([
            "--url",
            "https://stg.pinar.dev",
            "--env",
            "staging",
            "--env-file",
            "env.txt",
            "--artifact-dir",
            area,
          ]),
        new RegExp(`--artifact-dir ${area} has no manifest\\.yaml`),
      );
    } finally {
      rmSync(area, { recursive: true, force: true });
    }
  });
});

describe("parseEnvFile", () => {
  test("skips comments and blanks, keeps the value to the end of the line", () => {
    const values = parseEnvFile("# comment\n\nA=1\nB= spaced # kept\n");
    assert.deepEqual([...values.entries()], [
      ["A", "1"],
      ["B", " spaced # kept"],
    ]);
  });

  test("a later line with the same key wins", () => {
    assert.deepEqual([...parseEnvFile("A=1\nA=2\n").entries()], [["A", "2"]]);
  });

  test("rejects a line without = without echoing it", () => {
    assert.throws(() => parseEnvFile("JUSTAKEY"), /invalid line in env file: line 1/);
    assert.throws(() => parseEnvFile("A=1\nJUSTAKEY\n"), /invalid line in env file: line 2/);
  });
});

describe("readApiKey", () => {
  let area: string;
  beforeEach(() => {
    area = mkdtempSync(join(tmpdir(), "pinar-edger-key-"));
  });
  afterEach(() => {
    rmSync(area, { recursive: true, force: true });
  });

  test("reads a 0600 file", () => {
    const file = join(area, "key");
    writeFileSync(file, " file-key \n", { mode: 0o600 });
    assert.equal(readApiKey(file, {}), "file-key");
  });

  test("accepts a more restrictive mode", () => {
    const file = join(area, "key");
    writeFileSync(file, "file-key\n", { mode: 0o400 });
    assert.equal(readApiKey(file, {}), "file-key");
  });

  test("rejects a 0644 file", () => {
    const file = join(area, "key");
    writeFileSync(file, "file-key\n");
    assert.throws(() => readApiKey(file, {}), new RegExp(`${file} must be mode 0600`));
  });

  test("falls back to EDGER_API_KEY", () => {
    assert.equal(readApiKey(undefined, { EDGER_API_KEY: " env-key " }), "env-key");
  });

  test("requires the file or the env var", () => {
    assert.throws(
      () => readApiKey(undefined, {}),
      /api key is required: --api-key-file or EDGER_API_KEY/,
    );
  });

  test("rejects an empty file", () => {
    const file = join(area, "key");
    writeFileSync(file, "  \n", { mode: 0o600 });
    assert.throws(() => readApiKey(file, {}), new RegExp(`${file} is empty`));
  });
});

describe("databaseHostPort", () => {
  test("keeps an explicit port", () => {
    assert.equal(
      databaseHostPort("http://pinar-prd.edger.svc.cluster.local:8080"),
      "pinar-prd.edger.svc.cluster.local:8080",
    );
  });

  test("defaults http to 80", () => {
    assert.equal(databaseHostPort("http://db.example.com"), "db.example.com:80");
  });

  test("defaults https to 443", () => {
    assert.equal(databaseHostPort("https://db.example.com"), "db.example.com:443");
  });

  test("defaults libsql to 443", () => {
    assert.equal(databaseHostPort("libsql://db.turso.io"), "db.turso.io:443");
  });

  test("an explicit port wins over the default", () => {
    assert.equal(databaseHostPort("https://db.example.com:8443"), "db.example.com:8443");
  });

  test("rejects a hostless url", () => {
    assert.throws(() => databaseHostPort("file:/tmp/db.sqlite"), /invalid DATABASE_URL/);
  });
});

describe("fillManifest", () => {
  test("fills the staging worker", () => {
    const env = new Map<string, string>([
      ["DEPLOYMENT_ENV", "staging"],
      ["CLOUD_TRIAL_ENABLED", "true"],
      ["PRICING_YEARLY_BRL_CENTS", "9900"],
      ["DATABASE_URL", "http://pinar-stg.edger.svc.cluster.local:8080"],
      ["AUTH_PEPPER", "pepper-staging-000000"],
    ]);
    const manifest = Bun.YAML.parse(
      fillManifest(TEMPLATE, {
        databaseUrl: "http://pinar-stg.edger.svc.cluster.local:8080",
        env,
        hosts: ["stg.pinar.dev"],
        name: "pinar-stg",
        version: "1.2.3",
      }),
    ) as {
      allowNet: string[];
      env: Record<string, string>;
      hosts: string[];
      name: string;
      version: string;
    };
    assert.equal(manifest.name, "pinar-stg");
    assert.equal(manifest.version, "1.2.3");
    assert.deepEqual(manifest.hosts, ["stg.pinar.dev"]);
    assert.deepEqual(Object.keys(manifest.env), Object.keys((Bun.YAML.parse(TEMPLATE) as { env: Record<string, string> }).env));
    assert.equal(manifest.env.DEPLOYMENT_ENV, "staging");
    assert.equal(manifest.env.CLOUD_TRIAL_ENABLED, "true");
    assert.equal(manifest.env.DATABASE_URL, "http://pinar-stg.edger.svc.cluster.local:8080");
    assert.equal(manifest.env.AUTH_PEPPER, "pepper-staging-000000");
    assert.equal(manifest.env.AI_API_KEY, "");
    assert.ok(manifest.allowNet.includes("pinar-stg.edger.svc.cluster.local:8080"));
    assert.ok(manifest.allowNet.includes("api.stripe.com:443"));
    const templateAllowNet = (Bun.YAML.parse(TEMPLATE) as { allowNet: string[] }).allowNet;
    assert.equal(manifest.allowNet.length, templateAllowNet.length + 1);
  });

  test("fills the production worker", () => {
    const env = new Map<string, string>([
      ["DEPLOYMENT_ENV", "production"],
      ["DATABASE_URL", "https://pinar-prd.edger.svc.cluster.local"],
    ]);
    const manifest = Bun.YAML.parse(
      fillManifest(TEMPLATE, {
        databaseUrl: "https://pinar-prd.edger.svc.cluster.local",
        env,
        hosts: ["pinar.dev", "www.pinar.dev"],
        name: "pinar",
        version: "1.0.0",
      }),
    ) as {
      allowNet: string[];
      env: Record<string, string>;
      hosts: string[];
      name: string;
      version: string;
    };
    assert.equal(manifest.name, "pinar");
    assert.equal(manifest.version, "1.0.0");
    assert.deepEqual(manifest.hosts, ["pinar.dev", "www.pinar.dev"]);
    assert.equal(manifest.env.DEPLOYMENT_ENV, "production");
    assert.ok(manifest.allowNet.includes("pinar-prd.edger.svc.cluster.local:443"));
  });
});

describe("redactSecrets", () => {
  test("replaces every occurrence of each secret with <redacted>", () => {
    assert.equal(
      redactSecrets("a sk_live_12345 and sk_live_12345 again", ["sk_live_12345"]),
      "a <redacted> and <redacted> again",
    );
    assert.equal(
      redactSecrets("key=abc12345 db=peer-9", ["abc12345", "peer-9"]),
      "key=<redacted> db=<redacted>",
    );
  });

  test("ignores empty and short secrets and leaves the text untouched", () => {
    assert.equal(redactSecrets("abc ab and ", ["", "ab", " "]), "abc ab and ");
    assert.equal(redactSecrets("no secrets here", []), "no secrets here");
  });

  test("masks a secret that contains another one, whole", () => {
    assert.equal(redactSecrets("the token xab12y end", ["ab12", "xab12y"]), "the token <redacted> end");
  });
});

describe("assembleEnv", () => {
  const wrangler = loadWranglerEnv(WORKTREE_ROOT, "staging");
  const manifestKeys = manifestEnvKeys(WORKTREE_ROOT);

  test("wrangler vars + env file + DEPLOYMENT_ENV forced to --env", () => {
    const final = assembleEnv({
      envFileEntries: parseEnvFile("DEPLOYMENT_ENV=staging\nDATABASE_URL=http://db:8080\n"),
      envName: "staging",
      manifestKeys,
      wrangler,
    });
    assert.equal(final.get("DEPLOYMENT_ENV"), "staging");
    assert.equal(final.get("CLOUD_TRIAL_ENABLED"), "true");
    assert.equal(final.get("DATABASE_URL"), "http://db:8080");
  });

  test("requires the env file to declare DEPLOYMENT_ENV equal to --env", () => {
    let message = "";
    try {
      assembleEnv({
        // Identity is checked before any other rule: this file also has an
        // unknown key, and the identity error must win.
        envFileEntries: parseEnvFile("NOPE=1\n"),
        envName: "staging",
        manifestKeys,
        wrangler,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert.equal(message, "env file must declare DEPLOYMENT_ENV=staging");
  });

  test("rejects a DEPLOYMENT_ENV that does not match --env, with the exact message", () => {
    let message = "";
    try {
      assembleEnv({
        envFileEntries: parseEnvFile("DEPLOYMENT_ENV=production\nDATABASE_URL=http://db:8080\n"),
        envName: "staging",
        manifestKeys,
        wrangler,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    assert.equal(message, "DEPLOYMENT_ENV in env file does not match --env");
  });
});

describe("adminEndpoint", () => {
  test("joins the endpoint onto the base without a trailing slash", () => {
    assert.equal(
      adminEndpoint("https://stg.pinar.dev", "/api/admin/workers/install"),
      "https://stg.pinar.dev/api/admin/workers/install",
    );
    assert.equal(
      adminEndpoint("https://stg.pinar.dev/", "/api/admin/workers/install"),
      "https://stg.pinar.dev/api/admin/workers/install",
    );
    assert.equal(
      adminEndpoint("https://stg.pinar.dev/apps", "/api/admin/workers/install"),
      "https://stg.pinar.dev/apps/api/admin/workers/install",
    );
  });
});

describe("runEdgerInstall", () => {
  let fixture: Fixture;
  beforeEach(() => {
    fixture = installFixture();
  });
  afterEach(() => {
    rmSync(fixture.area, { recursive: true, force: true });
  });

  test("installs staged and promotes for staging", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    const captures: Capture[] = [];
    const fake = fakeFetch(captures, () => ({
      body: '{"name":"pinar-stg","version":"1.2.3","staged":true}',
      status: 201,
    }));
    const { code, lines } = await run(
      fixture,
      stagingArgs(fixture, ["--version", "1.2.3"]),
      fake,
    );
    assert.equal(code, 0);
    assert.equal(captures.length, 2);
    assert.equal(captures[0].url, "https://stg.pinar.dev/api/admin/workers/install?staged=true");
    assert.equal(captures[0].method, "POST");
    assert.equal(captures[0].headers["authorization"], "Bearer test-api-key-123");
    assert.equal(captures[0].headers["content-type"], "application/zip");
    assert.ok(captures[0].body !== null);
    assert.equal(captures[0].body![0], 0x50);
    assert.equal(captures[0].body![1], 0x4b);
    const zipFile = join(fixture.area, "captured.zip");
    writeFileSync(zipFile, captures[0].body!);
    assert.ok(unzipList(zipFile).includes("manifest.yaml"));
    assert.ok(unzipList(zipFile).includes("server/server.js"));
    const manifest = Bun.YAML.parse(unzipEntry(zipFile, "manifest.yaml")) as {
      env: Record<string, string>;
      name: string;
      version: string;
    };
    assert.equal(manifest.name, "pinar-stg");
    assert.equal(manifest.version, "1.2.3");
    assert.equal(manifest.env.DEPLOYMENT_ENV, "staging");
    assert.equal(manifest.env.CLOUD_TRIAL_ENABLED, "true");
    assert.equal(
      manifest.env.DATABASE_URL,
      "http://pinar-stg.edger.svc.cluster.local:8080",
    );
    assert.equal(captures[1].url, "https://stg.pinar.dev/api/admin/workers/pinar-stg/promote?version=1.2.3");
    assert.equal(captures[1].method, "POST");
    assert.equal(captures[1].headers["authorization"], "Bearer test-api-key-123");
    assert.equal(captures[1].body, null);
    // S3_BUCKET=pinar-stg is not a secret (NON_SECRET_ENV_KEYS), so the
    // worker name stays readable; the secret values are still redacted.
    assert.deepEqual(lines, [
      "installed pinar-stg@1.2.3 (staged)",
      "promoted pinar-stg@1.2.3",
    ]);
    for (const line of lines) assert.equal(line.includes("<redacted>"), false);
    noTempLeftovers(fixture);
  });

  test("skips promote with --no-promote", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      stagingArgs(fixture, ["--version", "1.2.3", "--no-promote"]),
      fakeFetch(captures, () => ({ status: 201 })),
    );
    assert.equal(code, 0);
    assert.equal(captures.length, 1);
    assert.deepEqual(lines, [
      "installed pinar-stg@1.2.3 (staged)",
      "not promoted (--no-promote): test it at https://stg.pinar.dev/pinar-stg@1.2.3/",
    ]);
    noTempLeftovers(fixture);
  });

  test("defaults the version to the root package.json", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      stagingArgs(fixture),
      fakeFetch(captures, () => ({ status: 201 })),
    );
    assert.equal(code, 0);
    assert.equal(captures[1].url, "https://stg.pinar.dev/api/admin/workers/pinar-stg/promote?version=9.9.9");
    assert.deepEqual(lines, [
      "installed pinar-stg@9.9.9 (staged)",
      "promoted pinar-stg@9.9.9",
    ]);
  });

  test("reports a non-2xx install with the json code and never the body", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      stagingArgs(fixture, ["--version", "1.2.3"]),
      fakeFetch(captures, () => ({
        body: '{"code":"DEPLOY_PUBLIC_VERSION_IMMUTABLE","message":"echo S3CRET-BODY-12345"}',
        status: 409,
      })),
    );
    assert.equal(code, 1);
    assert.equal(captures.length, 1);
    assert.deepEqual(lines, ["install failed: 409 DEPLOY_PUBLIC_VERSION_IMMUTABLE"]);
    noTempLeftovers(fixture);
  });

  test("reports a non-2xx install without a code as the status", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    const { code, lines } = await run(
      fixture,
      stagingArgs(fixture),
      fakeFetch([], () => ({ body: "internal error", status: 500 })),
    );
    assert.equal(code, 1);
    assert.deepEqual(lines, ["install failed: 500"]);
  });

  test("keeps a base url prefix on every endpoint", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      [
        "--url",
        "https://stg.pinar.dev/apps",
        "--env",
        "staging",
        "--env-file",
        fixture.envFile,
        "--api-key-file",
        fixture.keyFile,
        "--no-build",
        "--version",
        "1.2.3",
        "--no-promote",
      ],
      fakeFetch(captures, () => ({ status: 201 })),
    );
    assert.equal(code, 0);
    assert.equal(
      captures[0].url,
      "https://stg.pinar.dev/apps/api/admin/workers/install?staged=true",
    );
    assert.equal(
      lines[1],
      "not promoted (--no-promote): test it at https://stg.pinar.dev/apps/pinar-stg@1.2.3/",
    );
  });

  test("never prints the api key or the env values", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      stagingArgs(fixture, ["--version", "1.2.3"]),
      fakeFetch(captures, () => ({ status: 201, body: '{"name":"pinar-stg"}' })),
    );
    assert.equal(code, 0);
    const secrets = [
      "test-api-key-123",
      "http://pinar-stg.edger.svc.cluster.local:8080",
      "pepper-staging-000000",
      "https://chrome.google.com",
      "sk_test_staging_000",
      "whsec_staging_000",
      "s3secret-staging-000",
      "cfemail-staging-000",
    ];
    for (const line of lines) {
      for (const secret of secrets) {
        assert.ok(
          !line.includes(secret),
          `printed output leaks ${JSON.stringify(secret)}: ${JSON.stringify(line)}`,
        );
      }
    }
  });

  test("refuses production when releaseProblems reports, before anything else", async () => {
    writeEnvFile(fixture, PRODUCTION_ENV_FILE);
    // No dist/edger: without the release gate first, the failure would be
    // "dist/edger is missing", proving the gate runs earlier.
    rmSync(join(fixture.rootDir, "apps/server/dist/edger"), { recursive: true, force: true });
    const captures: Capture[] = [];
    let fetchCalls = 0;
    const fake = fakeFetch(captures, () => {
      fetchCalls += 1;
      return { status: 201 };
    });
    const { code, lines } = await run(
      fixture,
      [
        "--url",
        "https://pinar.dev",
        "--env",
        "production",
        "--env-file",
        fixture.envFile,
        "--api-key-file",
        fixture.keyFile,
        "--no-build",
      ],
      fake,
      {
        releaseProblems: () => ({
          problems: ["HEAD is not on v9.9.9 (no tag). Production builds come from the release tag only."],
          tag: "v9.9.9",
          version: "9.9.9",
        }),
      },
    );
    assert.equal(code, 1);
    assert.equal(fetchCalls, 0);
    assert.equal(captures.length, 0);
    assert.ok(lines.some((line) => line === "edger:install: production release check failed:"));
    assert.ok(
      lines.some((line) => line.includes("HEAD is not on v9.9.9 (no tag)")),
    );
    assert.ok(!lines.some((line) => line.includes("dist/edger is missing")));
    noTempLeftovers(fixture);
  });

  test("production with a clean release check installs pinar on both hosts", async () => {
    writeEnvFile(fixture, PRODUCTION_ENV_FILE);
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      [
        "--url",
        "https://pinar.dev",
        "--env",
        "production",
        "--env-file",
        fixture.envFile,
        "--api-key-file",
        fixture.keyFile,
        "--no-build",
        "--version",
        "1.0.0",
      ],
      fakeFetch(captures, () => ({ status: 201 })),
      { releaseProblems: () => ({ problems: [], tag: "v1.0.0", version: "1.0.0" }) },
    );
    assert.equal(code, 0);
    assert.equal(captures.length, 2);
    assert.equal(captures[0].url, "https://pinar.dev/api/admin/workers/install?staged=true");
    assert.equal(
      captures[1].url,
      "https://pinar.dev/api/admin/workers/pinar/promote?version=1.0.0",
    );
    const zipFile = join(fixture.area, "captured.zip");
    writeFileSync(zipFile, captures[0].body!);
    const manifest = Bun.YAML.parse(unzipEntry(zipFile, "manifest.yaml")) as {
      env: Record<string, string>;
      hosts: string[];
      name: string;
    };
    assert.equal(manifest.name, "pinar");
    assert.deepEqual(manifest.hosts, ["pinar.dev", "www.pinar.dev"]);
    assert.equal(manifest.env.DEPLOYMENT_ENV, "production");
    assert.deepEqual(lines, ["installed pinar@1.0.0 (staged)", "promoted pinar@1.0.0"]);
    noTempLeftovers(fixture);
  });

  test("staging never calls the release check", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    let calls = 0;
    const { code } = await run(
      fixture,
      stagingArgs(fixture),
      fakeFetch([], () => ({ status: 201 })),
      {
        releaseProblems: () => {
          calls += 1;
          return { problems: [], tag: "v9.9.9", version: "9.9.9" };
        },
      },
    );
    assert.equal(code, 0);
    assert.equal(calls, 0);
  });

  test("requires dist/edger with --no-build", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    rmSync(join(fixture.rootDir, "apps/server/dist/edger"), { recursive: true, force: true });
    const captures: Capture[] = [];
    const { code, lines } = await run(fixture, stagingArgs(fixture), fakeFetch(captures, () => ({ status: 201 })));
    assert.equal(code, 1);
    assert.equal(captures.length, 0);
    assert.deepEqual(lines, ["dist/edger is missing; run bun run build:edger"]);
  });

  test("--artifact-dir installs from the given directory, never building", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    // A distinct artifact dir (a marker file) proves the given directory is
    // the source; the fixture root has no `bun run build:edger`, so a build
    // attempt would fail the run.
    const artifactDir = join(fixture.area, "artifact");
    mkdirSync(join(artifactDir, "server"), { recursive: true });
    writeFileSync(join(artifactDir, "manifest.yaml"), readFileSync(REAL_MANIFEST, "utf8"));
    writeFileSync(join(artifactDir, "server/server.js"), "export default {};\n");
    writeFileSync(join(artifactDir, "marker.txt"), "platform-proof\n");
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      [
        "--url",
        "https://stg.pinar.dev",
        "--env",
        "staging",
        "--env-file",
        fixture.envFile,
        "--api-key-file",
        fixture.keyFile,
        "--version",
        "1.2.3",
        "--artifact-dir",
        artifactDir,
      ],
      fakeFetch(captures, () => ({ status: 201 })),
    );
    assert.equal(code, 0);
    assert.equal(captures.length, 2);
    const zipFile = join(fixture.area, "captured-artifact.zip");
    writeFileSync(zipFile, captures[0].body!);
    assert.ok(unzipList(zipFile).includes("marker.txt"));
    assert.ok(!unzipList(zipFile).includes("dist/edger"));
    assert.deepEqual(lines, [
      "installed pinar-stg@1.2.3 (staged)",
      "promoted pinar-stg@1.2.3",
    ]);
    noTempLeftovers(fixture);
  });

  test("--artifact-dir without a manifest.yaml is a usage error (exit 2)", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    const emptyDir = join(fixture.area, "empty-artifact");
    mkdirSync(emptyDir, { recursive: true });
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      stagingArgs(fixture, ["--artifact-dir", emptyDir]),
      fakeFetch(captures, () => ({ status: 201 })),
    );
    assert.equal(code, 2);
    assert.equal(captures.length, 0);
    assert.ok(lines.some((line) => line.includes(`--artifact-dir ${emptyDir} has no manifest.yaml`)));
    assert.ok(lines.some((line) => line.startsWith("usage:")));
    noTempLeftovers(fixture);
  });

  test("rejects a 0644 env file", async () => {
    writeFileSync(fixture.envFile, STAGING_ENV_FILE);
    const captures: Capture[] = [];
    const { code, lines } = await run(fixture, stagingArgs(fixture), fakeFetch(captures, () => ({ status: 201 })));
    assert.equal(code, 1);
    assert.equal(captures.length, 0);
    assert.deepEqual(lines, [`${fixture.envFile} must be mode 0600`]);
  });

  test("rejects an unknown key in the env file", async () => {
    writeEnvFile(fixture, `${STAGING_ENV_FILE}\nNOPE=1\n`);
    const captures: Capture[] = [];
    const { code, lines } = await run(fixture, stagingArgs(fixture), fakeFetch(captures, () => ({ status: 201 })));
    assert.equal(code, 1);
    assert.equal(captures.length, 0);
    assert.deepEqual(lines, ["unknown key in env file: NOPE"]);
  });

  test("rejects a key that comes from the wrangler vars", async () => {
    writeEnvFile(fixture, `${STAGING_ENV_FILE}\nCLOUD_TRIAL_ENABLED=false\n`);
    const captures: Capture[] = [];
    const { code, lines } = await run(fixture, stagingArgs(fixture), fakeFetch(captures, () => ({ status: 201 })));
    assert.equal(code, 1);
    assert.equal(captures.length, 0);
    assert.deepEqual(lines, [
      "CLOUD_TRIAL_ENABLED comes from wrangler.jsonc vars; remove it from the env file",
    ]);
  });

  test("rejects a DEPLOYMENT_ENV that does not match --env", async () => {
    writeEnvFile(fixture, `${STAGING_ENV_FILE}\nDEPLOYMENT_ENV=production\n`);
    const captures: Capture[] = [];
    const { code, lines } = await run(fixture, stagingArgs(fixture), fakeFetch(captures, () => ({ status: 201 })));
    assert.equal(code, 1);
    assert.equal(captures.length, 0);
    assert.deepEqual(lines, ["DEPLOYMENT_ENV in env file does not match --env"]);
  });

  test("rejects an env file without DEPLOYMENT_ENV with the exact message", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE.replace("DEPLOYMENT_ENV=staging\n", ""));
    const captures: Capture[] = [];
    const { code, lines } = await run(fixture, stagingArgs(fixture), fakeFetch(captures, () => ({ status: 201 })));
    assert.equal(code, 1);
    assert.equal(captures.length, 0);
    assert.deepEqual(lines, ["env file must declare DEPLOYMENT_ENV=staging"]);
  });

  test("rejects a staging env file with --env production before any fetch", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    const captures: Capture[] = [];
    let fetchCalls = 0;
    const fake = fakeFetch(captures, () => {
      fetchCalls += 1;
      return { status: 201 };
    });
    const { code, lines } = await run(
      fixture,
      [
        "--url",
        "https://pinar.dev",
        "--env",
        "production",
        "--env-file",
        fixture.envFile,
        "--api-key-file",
        fixture.keyFile,
        "--no-build",
      ],
      fake,
      { releaseProblems: () => ({ problems: [], tag: "v1.0.0", version: "1.0.0" }) },
    );
    assert.equal(code, 1);
    assert.equal(fetchCalls, 0);
    assert.equal(captures.length, 0);
    assert.deepEqual(lines, ["DEPLOYMENT_ENV in env file does not match --env"]);
  });

  test("reports every missing required env", async () => {
    writeEnvFile(fixture, "DEPLOYMENT_ENV=staging\n");
    const captures: Capture[] = [];
    const { code, lines } = await run(fixture, stagingArgs(fixture), fakeFetch(captures, () => ({ status: 201 })));
    assert.equal(code, 1);
    assert.equal(captures.length, 0);
    assert.deepEqual(lines, [
      "missing required env: DATABASE_URL, AUTH_PEPPER, EXTENSION_ORIGIN, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET",
    ]);
  });

  test("reports only the missing required envs", async () => {
    writeEnvFile(
      fixture,
      "DEPLOYMENT_ENV=staging\nDATABASE_URL=http://pinar-stg.edger.svc.cluster.local:8080\n",
    );
    const captures: Capture[] = [];
    const { code, lines } = await run(fixture, stagingArgs(fixture), fakeFetch(captures, () => ({ status: 201 })));
    assert.equal(code, 1);
    assert.equal(captures.length, 0);
    assert.deepEqual(lines, [
      "missing required env: AUTH_PEPPER, EXTENSION_ORIGIN, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET",
    ]);
  });

  test("lets the edgerCloudEnv group error out on a partial group", async () => {
    writeEnvFile(
      fixture,
      "DEPLOYMENT_ENV=staging\nS3_ENDPOINT=https://pinar-stg.r2.cloudflarestorage.com\n",
    );
    const captures: Capture[] = [];
    const { code, lines } = await run(fixture, stagingArgs(fixture), fakeFetch(captures, () => ({ status: 201 })));
    assert.equal(code, 1);
    assert.equal(captures.length, 0);
    assert.deepEqual(lines, [
      "incomplete S3 configuration: missing S3_ACCESS_KEY_ID, S3_BUCKET, S3_SECRET_ACCESS_KEY",
    ]);
  });

  test("lets the invalid DATABASE_URL error out", async () => {
    writeEnvFile(fixture, `${STAGING_ENV_FILE.replace("DATABASE_URL=http://pinar-stg.edger.svc.cluster.local:8080", "DATABASE_URL=not a url")}`);
    const captures: Capture[] = [];
    const { code, lines } = await run(fixture, stagingArgs(fixture), fakeFetch(captures, () => ({ status: 201 })));
    assert.equal(code, 1);
    assert.equal(captures.length, 0);
    assert.deepEqual(lines, ["invalid DATABASE_URL"]);
  });

  // The reviewer's leak scenarios: a hostile response/transport may echo
  // the manifest values or the api key; no sentinel may reach the log.
  const REVIEWER_ENV_FILE = [
    "DEPLOYMENT_ENV=staging",
    "DATABASE_URL=http://pinar-stg.edger.svc.cluster.local:8080",
    "AUTH_PEPPER=FAKE_ENV_SENTINEL",
    "EXTENSION_ORIGIN=https://chrome.google.com",
    "STRIPE_SECRET_KEY=FAKE_STRIPE",
    "STRIPE_WEBHOOK_SECRET=FAKE_WEBHOOK",
  ].join("\n");

  function assertNoSentinel(lines: string[]): void {
    for (const sentinel of ["FAKE_API_SENTINEL", "FAKE_ENV_SENTINEL"]) {
      assert.ok(
        !lines.some((line) => line.includes(sentinel)),
        `sentinel leaked: ${sentinel} in ${JSON.stringify(lines)}`,
      );
    }
  }

  test("an error field that echoes a secret is never printed", async () => {
    writeEnvFile(fixture, REVIEWER_ENV_FILE);
    writeFileSync(fixture.keyFile, "FAKE_API_SENTINEL", { mode: 0o600 });
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      stagingArgs(fixture, ["--version", "1.2.3"]),
      fakeFetch(captures, () => ({
        body: JSON.stringify({ error: "invalid AUTH_PEPPER FAKE_ENV_SENTINEL" }),
        status: 400,
      })),
    );
    assert.equal(code, 1);
    assert.equal(captures.length, 1);
    assert.deepEqual(lines, ["install failed: 400"]);
    assertNoSentinel(lines);
    // The `error` field is ignored even when it looks like a machine code:
    // only the `code` field may reach the message.
    const { lines: lines2 } = await run(
      fixture,
      stagingArgs(fixture, ["--version", "1.2.3"]),
      fakeFetch([], () => ({
        body: JSON.stringify({ error: "SOME_MACHINE_CODE_ECHO" }),
        status: 400,
      })),
    );
    assert.deepEqual(lines2, ["install failed: 400"]);
  });

  test("a matching code field that is the api key is printed redacted", async () => {
    writeEnvFile(fixture, REVIEWER_ENV_FILE);
    writeFileSync(fixture.keyFile, "FAKE_API_SENTINEL", { mode: 0o600 });
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      stagingArgs(fixture, ["--version", "1.2.3"]),
      fakeFetch(captures, () => ({
        body: JSON.stringify({ code: "FAKE_API_SENTINEL" }),
        status: 409,
      })),
    );
    assert.equal(code, 1);
    assert.equal(captures.length, 1);
    assert.deepEqual(lines, ["install failed: 409 <redacted>"]);
    assertNoSentinel(lines);
  });

  test("a transport error that echoes the api key is redacted", async () => {
    writeEnvFile(fixture, REVIEWER_ENV_FILE);
    writeFileSync(fixture.keyFile, "FAKE_API_SENTINEL", { mode: 0o600 });
    const { code, lines } = await run(fixture, stagingArgs(fixture, ["--version", "1.2.3"]), async () => {
      throw new Error("transport echoed FAKE_API_SENTINEL");
    });
    assert.equal(code, 1);
    assert.deepEqual(lines, ["transport echoed <redacted>"]);
    assertNoSentinel(lines);
  });

  test("keeps a machine code and never prints the error field", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      stagingArgs(fixture, ["--version", "1.2.3"]),
      fakeFetch(captures, () => ({
        body: JSON.stringify({
          code: "DEPLOY_PUBLIC_VERSION_IMMUTABLE",
          error: "invalid AUTH_PEPPER pepper-staging-000000",
        }),
        status: 409,
      })),
    );
    assert.equal(code, 1);
    assert.equal(captures.length, 1);
    assert.deepEqual(lines, ["install failed: 409 DEPLOY_PUBLIC_VERSION_IMMUTABLE"]);
    assert.ok(!lines.some((line) => line.includes("pepper-staging-000000")));
  });

  test("drops a code that does not look like a machine code", async () => {
    writeEnvFile(fixture, STAGING_ENV_FILE);
    const captures: Capture[] = [];
    const { code, lines } = await run(
      fixture,
      stagingArgs(fixture, ["--version", "1.2.3"]),
      fakeFetch(captures, () => ({
        body: JSON.stringify({ code: "invalid AUTH_PEPPER x" }),
        status: 400,
      })),
    );
    assert.equal(code, 1);
    assert.equal(captures.length, 1);
    assert.deepEqual(lines, ["install failed: 400"]);
  });
});
