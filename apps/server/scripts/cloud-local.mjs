import { spawn, spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CURRENT_LEGAL_VERSION } from "../src/lib/legal-documents";

const SERVER_DIRECTORY = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = 3000;
const DEFAULT_STATE_PATH = ".wrangler/state/cloud-local";
const LOCAL_DEV_SECRETS = {
  AUTH_PEPPER: "pinar-cloud-local-development-only",
  // Deterministic id of the unpacked extension staged with DEV_EXTENSION_KEY
  // (see tests/e2e/cloud/free-extension-flow.e2e.test.ts).
  EXTENSION_ORIGIN: "chrome-extension://bobfbkbogoiemdcjchoakflgepmekdeh",
  STRIPE_SECRET_KEY: "sk_test_cloud_local_not_configured",
  STRIPE_WEBHOOK_SECRET: "whsec_cloud_local_not_configured",
};

export const CloudLocalProfiles = {
  founder: {
    code: "FNDR2826",
    credits: 500,
    email: "founder.cloud-local@pinar.test",
    plan: "founder",
  },
  free: {
    code: "FRCLD826",
    credits: 5,
    plan: "free",
  },
  pro: {
    code: "PRCLD826",
    credits: 200,
    email: "pro.cloud-local@pinar.test",
    plan: "pro",
  },
};

function argumentValue(args, index, name) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  return value;
}

export function parseCloudLocalOptions(args) {
  const options = {
    port: DEFAULT_PORT,
    profile: "pro",
    serve: false,
    statePath: DEFAULT_STATE_PATH,
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--serve") {
      options.serve = true;
    } else if (argument === "--port") {
      options.port = Number(argumentValue(args, index, "--port"));
      index += 1;
    } else if (argument === "--profile") {
      options.profile = argumentValue(args, index, "--profile");
      index += 1;
    } else if (argument === "--state-path") {
      options.statePath = argumentValue(args, index, "--state-path");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error("--port must be an integer between 1 and 65535");
  }
  if (!(options.profile in CloudLocalProfiles)) {
    throw new Error(`--profile must be one of: ${Object.keys(CloudLocalProfiles).join(", ")}`);
  }
  return options;
}

function addUtcMonths(date, months) {
  const next = new Date(date);
  const day = next.getUTCDate();
  next.setUTCDate(1);
  next.setUTCMonth(next.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function extensionCodeHash(pepper, code) {
  return createHmac("sha256", pepper).update(`extension-code:${code}`).digest("hex");
}

export function installationTokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function buildCloudLocalFixture(profileName, pepper, now = new Date()) {
  const profile = CloudLocalProfiles[profileName];
  if (!profile) throw new Error(`Unknown cloud-local profile: ${profileName}`);
  const nextMonth = addUtcMonths(now, 1).toISOString();
  const creditExpiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const suffix = profile.plan;
  if (profile.plan === "free") {
    return {
      ...profile,
      creditExpiry,
      extensionCodeHash: extensionCodeHash(pepper, profile.code),
      installationId: "ins_cloud_local_free00000000",
      installationToken: `pit_${"cloudlocalfree".padEnd(43, "0")}`,
      nextRefillAt: null,
      now: now.toISOString(),
      userId: null,
    };
  }
  return {
    ...profile,
    creditExpiry,
    extensionCodeHash: extensionCodeHash(pepper, profile.code),
    nextRefillAt: profile.plan === "pro" ? nextMonth : null,
    now: now.toISOString(),
    userId: `usr_cloud_local_${suffix}`,
  };
}

export function buildCloudLocalSeedSql(fixture) {
  if (fixture.plan === "free") {
    const codeExpiresAt = new Date(Date.parse(fixture.now) + 24 * 60 * 60 * 1000).toISOString();
    return [
      `INSERT INTO installations (id, token_hash, status, created_at, updated_at, last_seen_at) VALUES (${sqlString(fixture.installationId)}, ${sqlString(installationTokenHash(fixture.installationToken))}, 'active', ${sqlString(fixture.now)}, ${sqlString(fixture.now)}, ${sqlString(fixture.now)}) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash, status='active', updated_at=excluded.updated_at, last_seen_at=excluded.last_seen_at;`,
      `INSERT OR IGNORE INTO legal_acceptances (id, owner_type, owner_id, terms_version, privacy_version, acceptable_use_version, locale, source, evidence_id, accepted_at, created_at) VALUES ('lga_cloud_local_free00000000', 'installation', ${sqlString(fixture.installationId)}, ${sqlString(CURRENT_LEGAL_VERSION)}, ${sqlString(CURRENT_LEGAL_VERSION)}, ${sqlString(CURRENT_LEGAL_VERSION)}, 'en', 'remote_free', ${sqlString(`remote-free:${fixture.installationId}:${CURRENT_LEGAL_VERSION}`)}, ${sqlString(fixture.now)}, ${sqlString(fixture.now)});`,
      // Canonical free-grant source id: a later real registerInstallation call
      // for this installation dedupes against it instead of double-granting.
      `DELETE FROM ai_credit_grants WHERE owner_type = 'installation' AND owner_id = ${sqlString(fixture.installationId)} AND source_id = ${sqlString(`free:${fixture.installationId}`)};`,
      `INSERT INTO ai_credit_grants (id, owner_type, owner_id, source_type, source_id, credits, consumed_credits, expires_at, created_at) VALUES ('grant_cloud_local_free', 'installation', ${sqlString(fixture.installationId)}, 'free_initial', ${sqlString(`free:${fixture.installationId}`)}, ${fixture.credits}, 0, NULL, ${sqlString(fixture.now)});`,
      `INSERT INTO extension_codes (code_hash, owner_type, owner_id, expires_at, used_at, created_at) VALUES (${sqlString(fixture.extensionCodeHash)}, 'installation', ${sqlString(fixture.installationId)}, ${sqlString(codeExpiresAt)}, NULL, ${sqlString(fixture.now)}) ON CONFLICT(code_hash) DO UPDATE SET owner_type='installation', owner_id=excluded.owner_id, expires_at=excluded.expires_at, used_at=NULL, created_at=excluded.created_at;`,
    ].join("\n");
  }
  const sessionBytes = 128 * 1024 * 1024;
  const permanent = 1;
  const projectId = `prj_cloud_local_${fixture.plan}`;
  const collectionId = `col_cloud_local_${fixture.plan}`;
  const sessionId = `session_cloud_local_${fixture.plan}`;
  const monthlyCredits = fixture.plan === "pro" ? fixture.credits : 0;
  const permanentSource = "founder_initial";
  const grants = fixture.plan === "pro"
    ? [
      `INSERT INTO ai_credit_grants (id, owner_type, owner_id, source_type, source_id, credits, consumed_credits, expires_at, created_at) VALUES (${sqlString(`grant_cloud_local_${fixture.plan}_monthly`)}, 'account', ${sqlString(fixture.userId)}, 'pro_monthly', ${sqlString(`cloud-local:${fixture.plan}:monthly`)}, ${monthlyCredits}, 20, ${sqlString(fixture.nextRefillAt)}, ${sqlString(fixture.now)});`,
      `INSERT INTO ai_credit_grants (id, owner_type, owner_id, source_type, source_id, credits, consumed_credits, expires_at, created_at) VALUES (${sqlString(`grant_cloud_local_${fixture.plan}_expiring`)}, 'account', ${sqlString(fixture.userId)}, 'purchase', ${sqlString(`cloud-local:${fixture.plan}:expiring`)}, 20, 0, ${sqlString(fixture.creditExpiry)}, ${sqlString(fixture.now)});`,
    ]
    : [
      `INSERT INTO ai_credit_grants (id, owner_type, owner_id, source_type, source_id, credits, consumed_credits, expires_at, created_at) VALUES (${sqlString(`grant_cloud_local_${fixture.plan}`)}, 'account', ${sqlString(fixture.userId)}, ${sqlString(permanentSource)}, ${sqlString(`cloud-local:${fixture.plan}:initial`)}, ${fixture.credits}, 0, NULL, ${sqlString(fixture.now)});`,
    ];
  return [
    `INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at, ai_credit_refill_at) VALUES (${sqlString(fixture.userId)}, ${sqlString(fixture.email)}, ${sqlString(fixture.plan)}, 1, 'active', ${sqlString(fixture.now)}, ${sqlString(fixture.now)}, ${fixture.nextRefillAt ? sqlString(fixture.nextRefillAt) : "NULL"}) ON CONFLICT(id) DO UPDATE SET email=excluded.email, plan=excluded.plan, ever_paid=1, billing_status='active', updated_at=excluded.updated_at, ai_credit_refill_at=excluded.ai_credit_refill_at;`,
    `DELETE FROM ai_credit_grants WHERE owner_type = 'account' AND owner_id = ${sqlString(fixture.userId)} AND source_id LIKE 'cloud-local:%';`,
    ...grants,
    `DELETE FROM storage_grants WHERE user_id = ${sqlString(fixture.userId)} AND source_id LIKE 'cloud-local:%';`,
    `INSERT INTO projects (id, owner_id, name, icon, position, is_protected, created_at, updated_at) VALUES (${sqlString(projectId)}, ${sqlString(fixture.userId)}, 'Personal', 'user-round', 0, 1, ${sqlString(fixture.now)}, ${sqlString(fixture.now)}) ON CONFLICT(id) DO UPDATE SET owner_id=excluded.owner_id, updated_at=excluded.updated_at;`,
    `INSERT INTO collections (id, project_id, owner_id, parent_id, name, position, is_protected, created_at, updated_at) VALUES (${sqlString(collectionId)}, ${sqlString(projectId)}, ${sqlString(fixture.userId)}, NULL, 'Inbox', 0, 1, ${sqlString(fixture.now)}, ${sqlString(fixture.now)}) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id, owner_id=excluded.owner_id, updated_at=excluded.updated_at;`,
    `DELETE FROM sessions WHERE user_id = ${sqlString(fixture.userId)} AND id LIKE 'session_cloud_local_%';`,
    `INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size, collection_id, position, retention_expires_at) VALUES (${sqlString(sessionId)}, 'https://example.test/cloud-local', 'Cloud runtime fixture', '', '', 0, '[]', ${sqlString(fixture.now)}, ${sqlString(fixture.userId)}, ${sqlString(fixture.plan)}, ${permanent}, ${sessionBytes}, ${sqlString(collectionId)}, 0, NULL);`,
    `INSERT INTO extension_codes (code_hash, owner_type, owner_id, expires_at, used_at, created_at) VALUES (${sqlString(fixture.extensionCodeHash)}, 'account', ${sqlString(fixture.userId)}, ${sqlString(new Date(Date.parse(fixture.now) + 24 * 60 * 60 * 1000).toISOString())}, NULL, ${sqlString(fixture.now)}) ON CONFLICT(code_hash) DO UPDATE SET owner_type='account', owner_id=excluded.owner_id, expires_at=excluded.expires_at, used_at=NULL, created_at=excluded.created_at;`,
  ].join("\n");
}

function runWrangler(args, statePath) {
  const result = spawnSync("bunx", ["wrangler", ...args, "--local", "--persist-to", statePath], {
    cwd: SERVER_DIRECTORY,
    env: { ...process.env, CI: "1", WRANGLER_LOG_PATH: resolve(statePath, "wrangler.log") },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`wrangler ${args.join(" ")} failed`);
}

export function prepareCloudLocal(options) {
  const statePath = isAbsolute(options.statePath)
    ? options.statePath
    : resolve(SERVER_DIRECTORY, options.statePath);
  const fixture = buildCloudLocalFixture(options.profile, LOCAL_DEV_SECRETS.AUTH_PEPPER);
  mkdirSync(statePath, { recursive: true });
  runWrangler(["d1", "migrations", "apply", "pinar-dev"], statePath);
  const seedPath = resolve(statePath, "cloud-local-seed.sql");
  writeFileSync(seedPath, buildCloudLocalSeedSql(fixture));
  runWrangler(["d1", "execute", "pinar-dev", "--file", seedPath, "--yes"], statePath);
  const origin = `http://127.0.0.1:${options.port}`;
  const loginUrl = `${origin}/sign-in?extensionCode=${fixture.code}&returnTo=%2Fapp`;
  process.stdout.write(`\nCloud runtime prepared with isolated local bindings.\nProfile: ${options.profile}\nLogin: ${loginUrl}\nState: ${statePath}\n\n`);
  return { fixture, loginUrl, statePath };
}

function serveCloudLocal(options, prepared) {
  const child = spawn("bunx", ["vite", "dev", "--host", "127.0.0.1", "--port", String(options.port), "--strictPort"], {
    cwd: SERVER_DIRECTORY,
    env: {
      ...process.env,
      ...LOCAL_DEV_SECRETS,
      PINAR_CLOUD_STATE_PATH: prepared.statePath,
      PINAR_CLOUD_ORIGIN: `http://127.0.0.1:${options.port}`,
      WRANGLER_LOG_PATH: resolve(prepared.statePath, "wrangler.log"),
    },
    stdio: "inherit",
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
  });
}

if (import.meta.main) {
  try {
    const options = parseCloudLocalOptions(process.argv.slice(2));
    const prepared = prepareCloudLocal(options);
    if (options.serve) serveCloudLocal(options, prepared);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
