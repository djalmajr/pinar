#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DEVELOPMENT_EXTENSION_KEY } from "../extension/environment.js";

const ARCHIVE_EPOCH = new Date("1980-01-01T00:00:00.000Z");
// The official Chrome Web Store extension's public key, preserved from the previous
// tracked manifest. Manual --unpacked releases keep this stable production identity.
export const OFFICIAL_EXTENSION_PUBLIC_KEY = "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs4GNk+Y7qUYEDxmfXQid38tICmGg81x+EpHftKZ+JsnLjqPE24eWNmyM8muS2hzcT8UjFNWHxAvm0RTDCodMzu0QaE9hWSflU/pLVch8EDzo3y8MSHH5VuBzWsTlCdbxUkM8LoBB7r//B2F5Q62h7CYjaWON1OcJpiFlP7oByMoWwNCdT6lgBU/3IrrgAnCvD3wQMfd9DAwJtalr/uqu8LWgHzmyiHVHRZGww9EUO0jPw2dn9FIpqPM2JbP/r/svJqrC02ygewWASLx83cOjJMDzySGfxCBaB+aFfrk5mC+Vl5Sb8LAJL8aaU0BeNlZrv+bc5u6mBhf9tJIoicQEwwIDAQAB";
const UNPACKED_EXTENSION_ID = "idpeaokdndjedekacfdfbilcolpholbo";
const BASE64_PUBLIC_KEY = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const RUNTIME_DIRECTORIES = ["_locales", "dist", "icons"];
const RUNTIME_FILES = ["manifest.json", "offscreen.html"];
const root = fileURLToPath(new URL("..", import.meta.url));

function normalizedPath(path) {
  return path.split(sep).join("/");
}

function walkFiles(directory, base = directory) {
  const entries = [];
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, item.name);
    if (item.isDirectory()) entries.push(...walkFiles(absolute, base));
    if (item.isFile()) entries.push(normalizedPath(relative(base, absolute)));
  }
  return entries;
}

export function extensionVersions(rootDirectory = root) {
  const manifest = JSON.parse(readFileSync(join(rootDirectory, "extension/manifest.json"), "utf8"));
  const extensionPackage = JSON.parse(readFileSync(join(rootDirectory, "apps/extension/package.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`invalid extension version: ${manifest.version}`);
  if (manifest.version !== extensionPackage.version) {
    throw new Error(`extension version mismatch: manifest=${manifest.version}, package=${extensionPackage.version}`);
  }
  return { manifest, version: manifest.version };
}

function extensionIdFromManifestKey(key) {
  if (typeof key !== "string" || !key || key.trim() !== key || !BASE64_PUBLIC_KEY.test(key)) {
    throw new Error("manifest key is not valid base64 public key material");
  }
  const publicKey = Buffer.from(key, "base64");
  if (!publicKey.length || publicKey.toString("base64") !== key) {
    throw new Error("manifest key is not valid base64 public key material");
  }
  const digest = createHash("sha256").update(publicKey).digest();
  return [...digest.subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join("");
}

function assertDevelopmentSourceKey(manifest) {
  // The tracked repository manifest must carry the recognized development key.
  // Any other material (missing, malformed, or an unrecognized/foreign key) is
  // rejected outright instead of being packaged.
  if (typeof manifest.key !== "string" || manifest.key.length === 0) {
    throw new Error("source manifest.key is missing; the repository extension must carry the recognized development key");
  }
  if (manifest.key !== DEVELOPMENT_EXTENSION_KEY) {
    throw new Error("source manifest.key is not the recognized development key; refusing unrecognized key material");
  }
}

export function releaseManifest(manifest, { unpacked = false } = {}) {
  assertDevelopmentSourceKey(manifest);
  const release = { ...manifest };
  if (!unpacked) {
    delete release.key;
    return release;
  }
  release.key = OFFICIAL_EXTENSION_PUBLIC_KEY;
  if (extensionIdFromManifestKey(release.key) !== UNPACKED_EXTENSION_ID) {
    throw new Error("official unpacked extension key does not derive the expected extension ID");
  }
  return release;
}

export function collectExtensionEntries(rootDirectory = root) {
  const extensionDirectory = join(rootDirectory, "extension");
  const entries = [...RUNTIME_FILES];
  for (const item of readdirSync(extensionDirectory, { withFileTypes: true })) {
    if (item.isFile() && item.name.endsWith(".js") && !item.name.endsWith(".test.js")) entries.push(item.name);
  }
  for (const directory of RUNTIME_DIRECTORIES) {
    entries.push(...walkFiles(join(extensionDirectory, directory)).map((entry) => `${directory}/${entry}`));
  }
  return [...new Set(entries)].sort();
}

export function validateEntryPaths(entries) {
  const problems = [];
  if (!entries.includes("manifest.json")) problems.push("manifest.json must be at the archive root");
  for (const entry of entries) {
    if (entry.startsWith("/") || entry.split("/").includes("..")) problems.push(`unsafe archive path: ${entry}`);
    if (/\.test\.[cm]?[jt]s$/i.test(entry)) problems.push(`test file is forbidden: ${entry}`);
    if (/\.d\.ts$/i.test(entry)) problems.push(`TypeScript declaration is forbidden: ${entry}`);
    if (/\.map$/i.test(entry)) problems.push(`source map is forbidden: ${entry}`);
    if (/\.zip$/i.test(entry)) problems.push(`nested archive is forbidden: ${entry}`);
  }
  if (problems.length) throw new Error(problems.join("\n"));
}

export function validateManifestFiles({ entries, manifest, rootDirectory = root }) {
  const available = new Set(entries);
  const required = [manifest.background?.service_worker, manifest.options_ui?.page];
  for (const contentScript of manifest.content_scripts ?? []) required.push(...(contentScript.js ?? []));
  for (const icon of Object.values(manifest.action?.default_icon ?? {})) required.push(icon);
  for (const icon of Object.values(manifest.icons ?? {})) required.push(icon);
  if (manifest.default_locale) required.push(`_locales/${manifest.default_locale}/messages.json`);
  const missing = required.filter(Boolean).filter((entry) => !available.has(entry));

  const optionsPage = manifest.options_ui?.page;
  if (optionsPage && available.has(optionsPage)) {
    const html = readFileSync(join(rootDirectory, "extension", optionsPage), "utf8");
    for (const match of html.matchAll(/(?:href|src)="([^"?#]+)"/g)) {
      if (/^(?:data:|https?:)/.test(match[1])) continue;
      const referenced = normalizedPath(join(dirname(optionsPage), match[1]));
      if (!available.has(referenced)) missing.push(referenced);
    }
  }

  if (missing.length) throw new Error(`runtime files missing from archive:\n${[...new Set(missing)].sort().join("\n")}`);
}

export function validateReleaseTag(tag, version) {
  const expected = `ext-v${version}`;
  if (tag !== expected) throw new Error(`extension release tag must be ${expected}; received ${tag}`);
}

export function parseOptions(args) {
  const options = { unpacked: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--unpacked") {
      options.unpacked = true;
      continue;
    }
    if (argument !== "--expected-version" && argument !== "--output") {
      throw new Error(`unknown option: ${argument}`);
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value`);
    if (argument === "--expected-version") options.expectedVersion = value;
    if (argument === "--output") options.output = value;
    index += 1;
  }
  return options;
}

export function packageExtension({ expectedVersion, output, unpacked = false, rootDirectory = root, runBuild = true } = {}) {
  if (runBuild) execFileSync("bun", ["run", "build:ext"], { cwd: rootDirectory, stdio: "inherit" });
  const { manifest, version } = extensionVersions(rootDirectory);
  if (expectedVersion && expectedVersion !== version) {
    throw new Error(`expected extension ${expectedVersion}; source is ${version}`);
  }

  const packagedManifest = releaseManifest(manifest, { unpacked });
  const entries = collectExtensionEntries(rootDirectory);
  validateEntryPaths(entries);
  validateManifestFiles({ entries, manifest, rootDirectory });

  const suffix = unpacked ? "-unpacked" : "";
  const outputPath = resolve(rootDirectory, output ?? `extension/pinar-extension-${version}${suffix}.zip`);
  const outputDirectory = dirname(outputPath);
  mkdirSync(outputDirectory, { recursive: true });
  const stagingDirectory = mkdtempSync(join(tmpdir(), "pinar-extension-package-"));
  const temporaryArchive = join(outputDirectory, `.pinar-extension-${version}-${process.pid}.zip`);

  try {
    for (const entry of entries) {
      const source = join(rootDirectory, "extension", entry);
      const destination = join(stagingDirectory, entry);
      mkdirSync(dirname(destination), { recursive: true });
      if (entry === "manifest.json") writeFileSync(destination, `${JSON.stringify(packagedManifest, null, 2)}\n`);
      else copyFileSync(source, destination);
      utimesSync(destination, ARCHIVE_EPOCH, ARCHIVE_EPOCH);
    }
    execFileSync("zip", ["-q", "-X", temporaryArchive, ...entries], {
      cwd: stagingDirectory,
      env: { ...process.env, TZ: "UTC" },
    });
    const archiveEntries = execFileSync("unzip", ["-Z1", temporaryArchive], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    validateEntryPaths(archiveEntries);
    if (archiveEntries.join("\n") !== entries.join("\n")) throw new Error("archive entries differ from the validated runtime file list");
    renameSync(temporaryArchive, outputPath);
  } finally {
    rmSync(stagingDirectory, { force: true, recursive: true });
    rmSync(temporaryArchive, { force: true });
  }

  const bytes = readFileSync(outputPath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { entries, outputPath, sha256, size: statSync(outputPath).size, version };
}

if (import.meta.main) {
  const result = packageExtension(parseOptions(process.argv.slice(2)));
  console.log(`package-extension: ${result.version}`);
  console.log(`file: ${result.outputPath}`);
  console.log(`entries: ${result.entries.length}`);
  console.log(`size: ${result.size}`);
  console.log(`sha256: ${result.sha256}`);
}
