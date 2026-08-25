import { readFileSync } from "node:fs";
import { join } from "node:path";
import trayPackage from "../../package.json" with { type: "json" };

export const GITHUB_RELEASE_BASE_URL =
	"https://github.com/djalmajr/pinar/releases/latest/download";

export const APP_IDENTIFIER = "dev.pinar.local";

const PACKAGED_VERSION_PATH = join("..", "Resources", "version.json");

export function appVersion(
	readJson: (path: string) => unknown = (path) => JSON.parse(readFileSync(path, "utf8")),
) {
	try {
		const info = readJson(PACKAGED_VERSION_PATH);
		if (
			info &&
			typeof info === "object" &&
			"version" in info &&
			typeof info.version === "string" &&
			info.version.length > 0
		) {
			return info.version;
		}
	} catch {
		// Dev and tests: packaged version.json is missing.
	}
	return trayPackage.version;
}

export function versionMenuItem(version = appVersion()) {
	return {
		enabled: false,
		label: `Pinar ${version}`,
		type: "normal" as const,
	};
}

const SAFE_HASH = /^[a-z0-9]{1,13}$/;

export type UpdateChannel = "stable" | "canary" | "dev";

export type UpdateManifest = {
	schemaVersion: 1;
	identifier: string;
	channel: string;
	version: string;
	hash: string;
	platform: string;
	arch: string;
	artifact: { file: string };
};

export type LocalUpdateIdentity = {
	identifier: string;
	channel: UpdateChannel;
	hash: string;
	platform: string;
	arch: string;
	version?: string;
};

/** Negative when `left` is older than `right`. */
export function compareReleaseVersions(left: string, right: string) {
	const parts = (value: string) =>
		value.split(/[.+-]/).map((part) => {
			const n = Number.parseInt(part, 10);
			return Number.isFinite(n) ? n : 0;
		});
	const a = parts(left);
	const b = parts(right);
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i += 1) {
		const delta = (a[i] ?? 0) - (b[i] ?? 0);
		if (delta !== 0) return delta > 0 ? 1 : -1;
	}
	return 0;
}

export function shouldOfferUpdate({
	localHash,
	localVersion,
	remoteHash,
	remoteVersion,
}: {
	localHash: string;
	localVersion?: string;
	remoteHash: string;
	remoteVersion: string;
}) {
	if (!remoteHash || remoteHash === localHash) return false;
	if (localVersion && compareReleaseVersions(remoteVersion, localVersion) < 0) return false;
	return true;
}

export type RemoteUpdateCheck = {
	updateAvailable: boolean;
	version: string;
	hash: string;
	artifactFile: string;
	artifactUrl: string;
};

export type UpdateUiState = {
	checking: boolean;
	available: boolean;
	ready: boolean;
	version: string;
};

export function platformPrefix(
	channel: UpdateChannel = "stable",
	os = "macos",
	arch = "arm64",
) {
	return `${channel}-${os}-${arch}`;
}

export function updateManifestUrl(baseUrl: string, prefix = platformPrefix()) {
	return `${baseUrl.replace(/\/+$/, "")}/${prefix}-update.json`;
}

export function updateArtifactUrl(baseUrl: string, file: string) {
	if (!isSafeArtifactFileName(file)) throw new Error("unsafe artifact filename");
	return `${baseUrl.replace(/\/+$/, "")}/${encodeURIComponent(file)}`;
}

export function parseUpdateManifest(
	document: unknown,
	expected: Omit<LocalUpdateIdentity, "hash">,
): UpdateManifest {
	if (!document || typeof document !== "object" || Array.isArray(document)) {
		throw new Error("Invalid update manifest: unsupported schemaVersion");
	}
	const record = document as Record<string, unknown>;
	if (record.schemaVersion !== 1) {
		throw new Error("Invalid update manifest: unsupported schemaVersion");
	}
	const identifier = requireString(record, "identifier");
	const channel = requireString(record, "channel");
	const version = requireString(record, "version");
	const hash = requireString(record, "hash");
	const platform = requireString(record, "platform");
	const arch = requireString(record, "arch");
	if (
		identifier !== expected.identifier ||
		channel !== expected.channel ||
		platform !== expected.platform ||
		arch !== expected.arch
	) {
		throw new Error("Invalid update manifest: release identity does not match this app");
	}
	if (!isSafeVersion(version) || !SAFE_HASH.test(hash)) {
		throw new Error("Invalid update manifest: unsafe release metadata");
	}
	const artifactValue = record.artifact;
	if (!artifactValue || typeof artifactValue !== "object" || Array.isArray(artifactValue)) {
		throw new Error("Invalid update manifest: artifact is required");
	}
	const file = requireString(artifactValue as Record<string, unknown>, "file");
	const requiredPrefix = `${platformPrefix(expected.channel, expected.platform, expected.arch)}-`;
	if (!isSafeArtifactFileName(file) || !file.startsWith(requiredPrefix)) {
		throw new Error("Invalid update manifest: unsafe artifact filename");
	}
	return {
		schemaVersion: 1,
		identifier,
		channel,
		version,
		hash,
		platform,
		arch,
		artifact: { file },
	};
}

export async function checkRemoteUpdate({
	baseUrl,
	local,
	fetcher = fetch,
}: {
	baseUrl: string;
	local: LocalUpdateIdentity;
	fetcher?: typeof fetch;
}): Promise<RemoteUpdateCheck> {
	const url = `${updateManifestUrl(baseUrl, platformPrefix(local.channel, local.platform, local.arch))}?${crypto.randomUUID().slice(0, 8)}`;
	const response = await fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	const manifest = parseUpdateManifest(await response.json(), local);
	return {
		updateAvailable: shouldOfferUpdate({
			localHash: local.hash,
			localVersion: local.version,
			remoteHash: manifest.hash,
			remoteVersion: manifest.version,
		}),
		version: manifest.version,
		hash: manifest.hash,
		artifactFile: manifest.artifact.file,
		artifactUrl: updateArtifactUrl(baseUrl, manifest.artifact.file),
	};
}

export async function downloadUpdateArtifact(
	url: string,
	dest: string,
	fetcher = fetch,
) {
	const response = await fetcher(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	await Bun.write(dest, response);
	const file = Bun.file(dest);
	return file.size;
}

export function updateMenuItem(state: UpdateUiState) {
	if (state.checking && !state.ready) {
		return {
			action: "check-update",
			enabled: false,
			label: state.available ? `Downloading ${state.version}…` : "Checking for Updates…",
			type: "normal" as const,
		};
	}
	if (state.ready && state.version) {
		return {
			action: "apply-update",
			enabled: true,
			label: `Update to ${state.version}`,
			type: "normal" as const,
		};
	}
	return {
		action: "check-update",
		enabled: true,
		label: "Check for Updates…",
		type: "normal" as const,
	};
}

function requireString(record: Record<string, unknown>, key: string) {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Invalid update manifest: ${key} is required`);
	}
	return value;
}

function isSafeVersion(value: string) {
	return value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeArtifactFileName(value: string) {
	return (
		value.length > ".tar.zst".length &&
		value.length <= 1024 &&
		value.endsWith(".tar.zst") &&
		!/[\u0000-\u001f\u007f/\\:]/.test(value)
	);
}
