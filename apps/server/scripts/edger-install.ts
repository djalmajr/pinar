/**
 * Installs the Pinar EdgeR artifact (`dist/edger`, from `bun run build:edger`)
 * on a remote EdgeR control plane, as one worker per environment:
 *
 *   bun run edger:install -- \
 *     --url <edger admin url> --env staging|production --env-file <file> \
 *     [--api-key-file <file>] [--version <semver>] [--artifact-dir <dir>] \
 *     [--no-build] [--no-promote]
 *
 * `staging` installs the worker `pinar-stg` on stg.pinar.dev; `production`
 * installs the worker `pinar` on pinar.dev and www.pinar.dev. The install is
 * always staged; the promote follows right after, unless `--no-promote` is
 * given. With `--env production`, `releaseProblems({ requireTag: true })`
 * from `scripts/release-check.mjs` must pass before anything else.
 *
 * `--artifact-dir <dir>` installs from the given artifact directory instead
 * of building: the installer never runs `bun run build:edger` with it, and
 * the directory must contain a `manifest.yaml` (a usage error otherwise).
 * Without the flag the default is `<rootDir>/apps/server/dist/edger`.
 *
 * The API key and the env values never reach the log: every printed line
 * is redacted against the key and every non-empty env-file value. The
 * filled manifest exists only under a 0700 temporary directory and is
 * removed afterwards.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { edgerCloudEnv } from "../src/server/edger/env";

/**
 * The project tsconfig types `src` against node + workerd (no Bun types),
 * and `scripts` is outside its `include`. The script itself runs on Bun,
 * so the two Bun APIs it uses are declared module-locally: no Bun types
 * leak into the program, and the runtime global satisfies them.
 */
declare const Bun: {
  JSONC: { parse: (text: string) => unknown };
  YAML: { parse: (text: string) => unknown; stringify: (value: unknown) => string };
};

const defaultRoot = fileURLToPath(new URL("../../..", import.meta.url));
const ZIP_CAP = 64 * 1024 * 1024;
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const USAGE =
  "usage: bun run edger:install -- --url <edger admin url> --env staging|production --env-file <file> [--api-key-file <file>] [--version <semver>] [--artifact-dir <dir>] [--no-build] [--no-promote]";

/** EdgeR worker per environment (the wrangler names are a different thing). */
const WORKERS = {
  production: { hosts: ["pinar.dev", "www.pinar.dev"], name: "pinar" },
  staging: { hosts: ["stg.pinar.dev"], name: "pinar-stg" },
} as const;

export type EdgerEnvName = keyof typeof WORKERS;

export interface InstallArgs {
  apiKeyFile?: string;
  /** The artifact directory (`--artifact-dir`); never built when present. */
  artifactDir?: string;
  build: boolean;
  env: EdgerEnvName;
  envFile: string;
  noPromote: boolean;
  url: string;
  version?: string;
}

export interface ReleaseProblemsResult {
  problems: string[];
  tag: string;
  version: string;
}

export type ReleaseProblems = (options: { requireTag?: boolean }) => ReleaseProblemsResult;

export interface RunOptions {
  /** The `dist/edger` directory; defaults to `<rootDir>/apps/server/dist/edger`. */
  artifactDir?: string;
  fetch?: typeof fetch;
  log?: (line: string) => void;
  releaseProblems?: ReleaseProblems;
  /** The repository root; defaults to the checkout the script lives in. */
  rootDir?: string;
  tempParent?: string;
}

export interface InstallPackage {
  manifestPath: string;
  name: string;
  parent: string;
  version: string;
  zipPath: string;
}

export interface WranglerEnv {
  required: string[];
  vars: Record<string, string>;
}

class UsageError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "edger:install failed";
}

/**
 * Env-file keys whose values are not secrets and are short, common words
 * (`pinar-stg`, `auto`, `staging`): redacting them would mask the worker
 * name and the version in the installer's own output.
 */
export const NON_SECRET_ENV_KEYS: ReadonlySet<string> = new Set([
  "AI_EMBEDDING_MODEL",
  "AI_MODEL",
  "AI_TRANSCRIPTION_MODEL",
  "DEPLOYMENT_ENV",
  "S3_BUCKET",
  "S3_REGION",
]);

/**
 * Replaces every occurrence of every known secret with `<redacted>`.
 * Empty secrets and the ones shorter than 4 characters are ignored;
 * longer secrets go first so a secret that contains another is masked
 * whole.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  const needles = [...new Set(secrets)].filter((secret) => secret.length >= 4);
  needles.sort((left, right) => right.length - left.length);
  let out = text;
  for (const needle of needles) out = out.split(needle).join("<redacted>");
  return out;
}

function failUsage(message: string): never {
  throw new UsageError(message);
}

export function assertSemver(version: string): string {
  if (!SEMVER.test(version)) throw new UsageError("--version must be a semver");
  return version;
}

export function parseAdminUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new UsageError("--url must be an absolute http(s) URL without credentials");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UsageError("--url must be an absolute http(s) URL without credentials");
  }
  if (url.username !== "" || url.password !== "") {
    throw new UsageError("--url must be an absolute http(s) URL without credentials");
  }
  return url;
}

export function parseInstallArgs(argv: readonly string[]): InstallArgs {
  const options: {
    apiKeyFile?: string;
    artifactDir?: string;
    env?: EdgerEnvName;
    envFile?: string;
    url?: string;
    version?: string;
  } = {};
  let build = true;
  let noPromote = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") continue;
    if (arg === "--no-build") {
      build = false;
      continue;
    }
    if (arg === "--no-promote") {
      noPromote = true;
      continue;
    }
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    let value = eq === -1 ? undefined : arg.slice(eq + 1);
    const valued =
      flag === "--url" ||
      flag === "--env" ||
      flag === "--env-file" ||
      flag === "--api-key-file" ||
      flag === "--version" ||
      flag === "--artifact-dir";
    if (!valued) failUsage(`unknown argument: ${arg}`);
    if (value === undefined) {
      index += 1;
      value = argv[index];
    }
    if (value === undefined || value.startsWith("--")) {
      failUsage(`${flag} requires a value`);
    }
    if (flag === "--url") {
      parseAdminUrl(value);
      options.url = value;
    } else if (flag === "--env") {
      if (value !== "staging" && value !== "production") {
        failUsage("--env must be staging or production");
      }
      options.env = value;
    } else if (flag === "--env-file") {
      options.envFile = value;
    } else if (flag === "--api-key-file") {
      options.apiKeyFile = value;
    } else if (flag === "--artifact-dir") {
      // A given directory is used as-is, never built: a missing manifest is
      // a usage error, like the other bad arguments.
      if (!existsSync(join(value, "manifest.yaml"))) {
        failUsage(`--artifact-dir ${value} has no manifest.yaml`);
      }
      options.artifactDir = value;
      build = false;
    } else {
      options.version = assertSemver(value);
    }
  }
  if (!options.url) failUsage("--url is required");
  if (!options.env) failUsage("--env is required");
  if (!options.envFile) failUsage("--env-file is required");
  const args: InstallArgs = {
    build,
    env: options.env,
    envFile: options.envFile,
    noPromote,
    url: options.url,
  };
  if (options.apiKeyFile !== undefined) args.apiKeyFile = options.apiKeyFile;
  if (options.artifactDir !== undefined) args.artifactDir = options.artifactDir;
  if (options.version !== undefined) args.version = options.version;
  return args;
}

/**
 * `0600` or stricter: every granted bit must be one of owner read/write.
 * The path, never the content, goes into the error.
 */
function assertPrivateMode(path: string): void {
  let mode: number;
  try {
    mode = statSync(path).mode & 0o7777;
  } catch {
    throw new Error(`cannot read ${path}`);
  }
  if ((mode | 0o600) !== 0o600) {
    throw new Error(`${path} must be mode 0600`);
  }
}

export function readApiKey(
  file: string | undefined,
  env: Record<string, string | undefined>,
): string {
  if (file !== undefined) {
    assertPrivateMode(file);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new Error(`cannot read ${file}`);
    }
    const key = text.trim();
    if (key === "") throw new Error(`${file} is empty`);
    return key;
  }
  const fromEnv = typeof env["EDGER_API_KEY"] === "string" ? env["EDGER_API_KEY"].trim() : "";
  if (fromEnv === "") {
    throw new Error("api key is required: --api-key-file or EDGER_API_KEY");
  }
  return fromEnv;
}

/**
 * `KEY=VALUE` lines; `#` lines and blank lines are ignored; the value runs
 * to the end of the line, without special quoting. A later line with the
 * same key overrides the earlier one. A malformed line is reported by its
 * number only: the line itself may carry a secret.
 */
export function parseEnvFile(text: string): Map<string, string> {
  const values = new Map<string, string>();
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) throw new Error(`invalid line in env file: line ${index + 1}`);
    values.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return values;
}

export function manifestEnvKeys(rootDir: string): string[] {
  const path = join(rootDir, "apps/server/edger/manifest.yaml");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`cannot read ${path}`);
  }
  const manifest = Bun.YAML.parse(text) as { env?: Record<string, unknown> };
  if (!manifest.env || typeof manifest.env !== "object") {
    throw new Error("manifest template is missing env");
  }
  return Object.keys(manifest.env);
}

export function loadWranglerEnv(rootDir: string, envName: EdgerEnvName): WranglerEnv {
  const path = join(rootDir, "apps/server/wrangler.jsonc");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`cannot read ${path}`);
  }
  const config = Bun.JSONC.parse(text) as {
    env?: Record<string, { secrets?: { required?: string[] }; vars?: Record<string, unknown> }>;
  };
  const node = config.env?.[envName];
  if (!node) throw new Error(`wrangler.jsonc has no env ${envName}`);
  const vars: Record<string, string> = {};
  for (const [key, value] of Object.entries(node.vars ?? {})) {
    if (typeof value !== "string") {
      throw new Error(`wrangler.jsonc env ${envName} var ${key} is not a string`);
    }
    vars[key] = value;
  }
  return { required: [...(node.secrets?.required ?? [])], vars };
}

/**
 * The env file must declare its own identity: `DEPLOYMENT_ENV` equal to
 * `--env`. The declared value is metadata only — the final
 * `DEPLOYMENT_ENV` is still `--env` (which is also a wrangler var, so the
 * env file never shadows it). The other keys keep the usual checks:
 * known to the manifest and not present in the wrangler vars.
 */
export function assembleEnv(options: {
  envFileEntries: ReadonlyMap<string, string>;
  envName: EdgerEnvName;
  manifestKeys: readonly string[];
  wrangler: WranglerEnv;
}): Map<string, string> {
  const { envFileEntries, envName, manifestKeys, wrangler } = options;
  const declared = envFileEntries.get("DEPLOYMENT_ENV");
  if (declared === undefined) {
    throw new Error(`env file must declare DEPLOYMENT_ENV=${envName}`);
  }
  if (declared !== envName) {
    throw new Error("DEPLOYMENT_ENV in env file does not match --env");
  }
  for (const [key] of envFileEntries) {
    if (key === "DEPLOYMENT_ENV") continue; // identity: checked above
    if (!manifestKeys.includes(key)) {
      throw new Error(`unknown key in env file: ${key}`);
    }
    if (wrangler.vars[key] !== undefined) {
      throw new Error(`${key} comes from wrangler.jsonc vars; remove it from the env file`);
    }
  }
  const final = new Map<string, string>(Object.entries(wrangler.vars));
  for (const [key, value] of envFileEntries) final.set(key, value);
  final.set("DEPLOYMENT_ENV", envName);
  return final;
}

/**
 * The CloudEnv validation first (its messages already carry only names),
 * then the required set: the database plus the environment's
 * `secrets.required` from `wrangler.jsonc`.
 */
export function validateFinalEnv(
  final: ReadonlyMap<string, string>,
  required: readonly string[],
): void {
  edgerCloudEnv((name) => final.get(name));
  const missing = required.filter((name) => (final.get(name) ?? "").trim() === "");
  if (missing.length > 0) {
    throw new Error(`missing required env: ${missing.join(", ")}`);
  }
}

/**
 * The `allowNet` entry for the database: the URL host plus the explicit
 * port, or 80 for `http`, or 443 for `https` and `libsql`.
 */
export function databaseHostPort(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("invalid DATABASE_URL");
  }
  if (url.hostname === "") throw new Error("invalid DATABASE_URL");
  const port = url.port !== "" ? url.port : url.protocol === "http:" ? "80" : "443";
  return `${url.hostname}:${port}`;
}

/**
 * Fills the manifest copy: `name`, `version`, `hosts`, every `env` key
 * (absent values stay `""`) and the database host appended to `allowNet`.
 * Comments are lost in the installed copy, by design.
 */
export function fillManifest(
  templateText: string,
  options: {
    databaseUrl: string;
    env: ReadonlyMap<string, string>;
    hosts: readonly string[];
    name: string;
    version: string;
  },
): string {
  const manifest = Bun.YAML.parse(templateText) as {
    allowNet?: string[];
    env?: Record<string, string>;
    hosts?: string[];
    name?: string;
    version?: string;
  };
  if (!manifest.env || typeof manifest.env !== "object") {
    throw new Error("manifest template is missing env");
  }
  manifest.name = options.name;
  manifest.version = options.version;
  manifest.hosts = [...options.hosts];
  for (const key of Object.keys(manifest.env)) {
    manifest.env[key] = options.env.get(key) ?? "";
  }
  manifest.allowNet = [...(manifest.allowNet ?? []), databaseHostPort(options.databaseUrl)];
  return Bun.YAML.stringify(manifest);
}

function assertMode(path: string, expected: number): void {
  const mode = statSync(path).mode & 0o777;
  if (mode !== expected) {
    throw new Error(`temporary directory mode is ${mode.toString(8)}, expected ${expected.toString(8)}`);
  }
}

function writePrivateFile(path: string, contents: string): void {
  rmSync(path, { force: true });
  writeFileSync(path, contents, { mode: 0o600, flag: "wx" });
  chmodSync(path, 0o600);
  assertMode(path, 0o600);
}

function zipDirectory(workerDir: string, zipPath: string): void {
  const zip = spawnSync("zip", ["-r", "-X", zipPath, ".", "-x", "*.DS_Store"], {
    cwd: workerDir,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (zip.error) throw new Error(`zip failed: ${zip.error.message}`);
  if (zip.status !== 0) throw new Error(`zip failed: ${zip.stderr.trim()}`);
  const size = statSync(zipPath).size;
  if (size >= ZIP_CAP) throw new Error(`zip is ${size} bytes; cap is ${ZIP_CAP}`);
}

export function createInstallPackage(options: {
  artifactDir: string;
  databaseUrl: string;
  env: ReadonlyMap<string, string>;
  hosts: readonly string[];
  name: string;
  tempParent?: string;
  version: string;
}): InstallPackage {
  const previousUmask = process.umask(0o077);
  let parent = "";
  try {
    parent = mkdtempSync(join(options.tempParent ?? tmpdir(), "pinar-edger-install-"));
  } finally {
    process.umask(previousUmask);
  }
  try {
    chmodSync(parent, 0o700);
    assertMode(parent, 0o700);
    const workerDir = join(parent, "worker");
    cpSync(options.artifactDir, workerDir, { recursive: true });
    const manifestPath = join(workerDir, "manifest.yaml");
    if (!existsSync(manifestPath)) {
      throw new Error("manifest template is missing");
    }
    const filled = fillManifest(readFileSync(manifestPath, "utf8"), {
      databaseUrl: options.databaseUrl,
      env: options.env,
      hosts: options.hosts,
      name: options.name,
      version: options.version,
    });
    writePrivateFile(manifestPath, filled);
    const zipPath = join(parent, "pinar-edger.zip");
    zipDirectory(workerDir, zipPath);
    return { manifestPath, name: options.name, parent, version: options.version, zipPath };
  } catch (error) {
    rmSync(parent, { recursive: true, force: true });
    throw error;
  }
}

function runBuild(serverDir: string): void {
  const built = spawnSync(process.execPath, ["run", "build:edger"], {
    cwd: serverDir,
    stdio: "inherit",
  });
  if (built.error) {
    throw new Error(`bun run build:edger failed: ${built.error.message}`);
  }
  if (built.status !== 0) throw new Error("bun run build:edger failed");
}

function readRootVersion(rootDir: string): string {
  const path = join(rootDir, "package.json");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new Error(`cannot read ${path}`);
  }
  const parsed: unknown = JSON.parse(text);
  const version = (parsed as { version?: unknown }).version;
  if (typeof version !== "string" || version === "") {
    throw new Error("root package.json has no version");
  }
  return version;
}

export function adminEndpoint(base: string, path: string): string {
  const url = parseAdminUrl(base);
  const prefix = url.pathname.replace(/\/+$/, "");
  url.pathname = `${prefix}${path}`;
  url.search = "";
  url.hash = "";
  return url.href;
}

function readJsonString(body: string, key: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const value = (parsed as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

/** A machine error code: uppercase letters, digits and underscores, 2–64. */
const ERROR_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

/**
 * The whole response body may echo the manifest, secrets included, so only
 * the status and the `code` field of a JSON body are reported. The `error`
 * field is never printed; a `code` that does not look like a machine code
 * is dropped and the message is just the status.
 */
function httpFailure(step: string, status: number, body: string): Error {
  const code = readJsonString(body, "code");
  const label = code !== undefined && ERROR_CODE.test(code) ? `${status} ${code}` : `${status}`;
  return new Error(`${step} failed: ${label}`);
}

interface HttpResult {
  body: string;
  status: number;
}

async function postInstall(
  url: string,
  apiKey: string,
  zipPath: string,
  fetchImpl: typeof fetch,
): Promise<HttpResult> {
  const response = await fetchImpl(url, {
    body: new Uint8Array(readFileSync(zipPath)),
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/zip",
    },
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  });
  return { body: await response.text(), status: response.status };
}

async function postPromote(
  url: string,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<HttpResult> {
  const response = await fetchImpl(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/zip",
    },
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
  return { body: await response.text(), status: response.status };
}

/**
 * Remove the temporary install package when the operator hits Ctrl-C
 * (SIGINT, exit 130) or the process is terminated (SIGTERM, exit 143).
 * The normal `finally` never runs on a signal, so the handler removes the
 * directory itself. Registered only while the package exists; the caller
 * removes the listeners in its `finally`.
 */
function watchTempForSignals(parent: string): () => void {
  const cleanup = () => {
    try {
      rmSync(parent, { recursive: true, force: true });
    } catch {
      // Best effort on the signal path; the process is exiting.
    }
  };
  const onSigint = () => {
    cleanup();
    process.exit(130);
  };
  const onSigterm = () => {
    cleanup();
    process.exit(143);
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  return () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
}

/**
 * Runs the install. Returns the exit code (0 ok, 1 failure, 2 usage error)
 * instead of exiting, so the tests drive it; every line the operator sees
 * goes through `log`.
 */
export async function runEdgerInstall(
  argv: readonly string[],
  options: RunOptions = {},
): Promise<number> {
  const baseLog = options.log ?? console.log;
  // Every line the operator sees is redacted against the secrets known so
  // far: the api key, then every non-empty env-file value. Errors raised
  // before a secret is read still pass through with the current list.
  let secrets: string[] = [];
  const log = (line: string): void => baseLog(redactSecrets(line, secrets));
  const fetchImpl = options.fetch ?? fetch;
  const rootDir = options.rootDir ?? defaultRoot;

  let args: InstallArgs;
  try {
    args = parseInstallArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      log(errorMessage(error));
      log(USAGE);
      return 2;
    }
    log(errorMessage(error));
    return 1;
  }

  const artifactDir =
    options.artifactDir ?? args.artifactDir ?? join(rootDir, "apps/server/dist/edger");

  const worker = WORKERS[args.env];
  try {
    if (args.env === "production") {
      const releaseProblems =
        options.releaseProblems ??
        (await import(`file://${join(rootDir, "scripts/release-check.mjs")}`)).releaseProblems;
      const { problems } = releaseProblems({ requireTag: true });
      if (problems.length > 0) {
        log("edger:install: production release check failed:");
        for (const problem of problems) log(`  - ${problem}`);
        return 1;
      }
    }

    const apiKey = readApiKey(args.apiKeyFile, process.env);
    secrets = [apiKey];

    const envFileText = (() => {
      assertPrivateMode(args.envFile);
      try {
        return readFileSync(args.envFile, "utf8");
      } catch {
        throw new Error(`cannot read ${args.envFile}`);
      }
    })();
    const envFileEntries = parseEnvFile(envFileText);
    secrets = [
      apiKey,
      ...[...envFileEntries]
        .filter(([key, value]) => value !== "" && !NON_SECRET_ENV_KEYS.has(key))
        .map(([, value]) => value),
    ];
    const wrangler = loadWranglerEnv(rootDir, args.env);
    const finalEnv = assembleEnv({
      envFileEntries,
      envName: args.env,
      manifestKeys: manifestEnvKeys(rootDir),
      wrangler,
    });
    validateFinalEnv(finalEnv, ["DATABASE_URL", ...wrangler.required]);
    const version = args.version ?? readRootVersion(rootDir);

    if (args.build) runBuild(join(rootDir, "apps/server"));
    if (!existsSync(join(artifactDir, "manifest.yaml"))) {
      throw new Error("dist/edger is missing; run bun run build:edger");
    }

    let pkg: InstallPackage | undefined;
    let stopWatching: (() => void) | undefined;
    try {
      pkg = createInstallPackage({
        artifactDir,
        databaseUrl: finalEnv.get("DATABASE_URL") ?? "",
        env: finalEnv,
        hosts: worker.hosts,
        name: worker.name,
        tempParent: options.tempParent,
        version,
      });
      stopWatching = watchTempForSignals(pkg.parent);
      const installUrl = new URL(adminEndpoint(args.url, "/api/admin/workers/install"));
      installUrl.searchParams.set("staged", "true");
      const installed = await postInstall(installUrl.href, apiKey, pkg.zipPath, fetchImpl);
      if (installed.status < 200 || installed.status >= 300) {
        throw httpFailure("install", installed.status, installed.body);
      }
      log(`installed ${worker.name}@${version} (staged)`);
      if (args.noPromote) {
        // The worker declares `hosts`, so its name route answers 404 since
        // EdgeR EDG-27; a staged version is reached through the
        // control-plane invoke, an internal request.
        const invokeUrl = adminEndpoint(
          args.url,
          `/api/admin/workers/${encodeURIComponent(worker.name)}/invoke/`,
        );
        log(
          `not promoted (--no-promote): test it at ${invokeUrl}<path> with headers x-edger-worker-version: ${version} and x-edger-control-authorization: Bearer <key with workers:invoke>`,
        );
        return 0;
      }
      const promoteUrl = new URL(
        adminEndpoint(args.url, `/api/admin/workers/${encodeURIComponent(worker.name)}/promote`),
      );
      promoteUrl.searchParams.set("version", version);
      const promoted = await postPromote(promoteUrl.href, apiKey, fetchImpl);
      if (promoted.status < 200 || promoted.status >= 300) {
        throw httpFailure("promote", promoted.status, promoted.body);
      }
      log(`promoted ${worker.name}@${version}`);
      return 0;
    } finally {
      stopWatching?.();
      if (pkg) rmSync(pkg.parent, { recursive: true, force: true });
    }
  } catch (error) {
    log(errorMessage(error));
    return 1;
  }
}

function isDirectRun(): boolean {
  const meta = import.meta as ImportMeta & { main?: boolean };
  if (meta.main === true) return true;
  const invoked = process.argv[1];
  if (!invoked) return false;
  return fileURLToPath(import.meta.url) === invoked;
}

async function main(): Promise<void> {
  const code = await runEdgerInstall(process.argv.slice(2));
  if (code !== 0) process.exitCode = code;
}

if (isDirectRun()) void main();
