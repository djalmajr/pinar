import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	APP_IDENTIFIER,
	GITHUB_RELEASE_BASE_URL,
	appVersion,
	checkRemoteUpdate,
	downloadUpdateArtifact,
	parseUpdateManifest,
	platformPrefix,
	shouldOfferUpdate,
	updateArtifactUrl,
	updateManifestUrl,
	updateMenuItem,
	versionMenuItem,
} from "./update";

const LOCAL = {
	arch: "arm64",
	channel: "stable" as const,
	hash: "oldhash00001",
	identifier: APP_IDENTIFIER,
	platform: "macos",
};

const MANIFEST = {
	arch: "arm64",
	artifact: { file: "stable-macos-arm64-Pinar.app.tar.zst" },
	channel: "stable",
	hash: "newhash00002",
	identifier: APP_IDENTIFIER,
	platform: "macos",
	schemaVersion: 1 as const,
	version: "0.1.2",
};

const ARTIFACTS = join(import.meta.dir, "../../artifacts");
const REAL_MANIFEST = join(ARTIFACTS, "stable-macos-arm64-update.json");
const REAL_TARBALL = join(ARTIFACTS, "stable-macos-arm64-Pinar.app.tar.zst");

function githubDownloadPath(file: string) {
	return `/djalmajr/pinar/releases/latest/download/${file}`;
}

async function serveGitHubLayout(files: Record<string, string | Uint8Array | Blob>) {
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			const url = new URL(request.url);
			const file = decodeURIComponent(url.pathname.split("/").pop() ?? "");
			const body = files[file];
			if (body == null) return new Response("not found", { status: 404 });
			if (request.method === "HEAD") {
				const size =
					typeof body === "string"
						? Buffer.byteLength(body)
						: body instanceof Blob
							? body.size
							: body.byteLength;
				return new Response(null, {
					headers: { "content-length": String(size) },
					status: 200,
				});
			}
			return new Response(body);
		},
	});
	const baseUrl = `http://127.0.0.1:${server.port}/djalmajr/pinar/releases/latest/download`;
	return { baseUrl, server };
}

async function makeTinyTarball() {
	const root = await mkdtemp(join(tmpdir(), "pinar-update-"));
	const app = join(root, "Pinar.app", "Contents");
	await mkdir(app, { recursive: true });
	await writeFile(join(app, "Info.plist"), "<plist><string>0.1.2</string></plist>\n");
	const dest = join(root, "stable-macos-arm64-Pinar.app.tar.zst");
	const tar = Bun.spawn(["tar", "-c", "Pinar.app"], { cwd: root, stdout: "pipe" });
	const zstd = Bun.spawn(["zstd", "-q", "-o", dest], { stdin: tar.stdout, stdout: "ignore" });
	const tarCode = await tar.exited;
	const zstdCode = await zstd.exited;
	if (tarCode !== 0 || zstdCode !== 0) throw new Error("failed to create fixture tar.zst");
	return dest;
}

describe("GitHub Releases update contract", () => {
	test("latest/download URLs are flat Electrobun artifact names", () => {
		const prefix = platformPrefix();
		expect(prefix).toBe("stable-macos-arm64");
		expect(updateManifestUrl(GITHUB_RELEASE_BASE_URL)).toBe(
			`${GITHUB_RELEASE_BASE_URL}/stable-macos-arm64-update.json`,
		);
		expect(updateArtifactUrl(GITHUB_RELEASE_BASE_URL, MANIFEST.artifact.file)).toBe(
			`${GITHUB_RELEASE_BASE_URL}/stable-macos-arm64-Pinar.app.tar.zst`,
		);
		expect(githubDownloadPath("stable-macos-arm64-update.json")).toBe(
			"/djalmajr/pinar/releases/latest/download/stable-macos-arm64-update.json",
		);
	});

	test("parseUpdateManifest rejects a different app identity", () => {
		expect(() =>
			parseUpdateManifest({ ...MANIFEST, identifier: "app.markdraw" }, LOCAL),
		).toThrow(/identity/);
	});

	test("menu labels follow check → download → apply", () => {
		expect(versionMenuItem("0.1.2")).toEqual({
			enabled: false,
			label: "Pinar 0.1.2",
			type: "normal",
		});
		expect(appVersion(() => ({ version: "9.9.9" }))).toBe("9.9.9");
		expect(appVersion(() => {
			throw new Error("missing");
		})).toMatch(/^\d+\.\d+\.\d+/);
		expect(updateMenuItem({ available: false, checking: false, ready: false, version: "" }).label).toBe(
			"Check for Updates…",
		);
		expect(updateMenuItem({ available: false, checking: true, ready: false, version: "" }).enabled).toBe(
			false,
		);
		expect(updateMenuItem({ available: true, checking: true, ready: false, version: "0.1.2" }).label).toBe(
			"Downloading 0.1.2…",
		);
		expect(updateMenuItem({ available: true, checking: false, ready: true, version: "0.1.2" })).toEqual({
			action: "apply-update",
			enabled: true,
			label: "Update to 0.1.2",
			type: "normal",
		});
	});

	test("offers only a newer release version when the installed version is known", () => {
		expect(
			shouldOfferUpdate({
				localHash: "localhash0001",
				localVersion: "0.1.2",
				remoteHash: "remotehash001",
				remoteVersion: "0.1.1",
			}),
		).toBe(false);
		expect(
			shouldOfferUpdate({
				localHash: "localhash0001",
				localVersion: "0.1.2",
				remoteHash: "remotehash001",
				remoteVersion: "0.1.2",
			}),
		).toBe(false);
		expect(
			shouldOfferUpdate({
				localHash: "localhash0001",
				localVersion: "0.1.2",
				remoteHash: "remotehash001",
				remoteVersion: "0.1.3",
			}),
		).toBe(true);
		expect(
			shouldOfferUpdate({
				localHash: "samehash00001",
				localVersion: "0.1.1",
				remoteHash: "samehash00001",
				remoteVersion: "0.1.2",
			}),
		).toBe(false);
	});

	test("checkRemoteUpdate ignores an older GitHub latest", async () => {
		const { baseUrl, server } = await serveGitHubLayout({
			"stable-macos-arm64-update.json": JSON.stringify({ ...MANIFEST, version: "0.1.1", hash: "oldrelhash01" }),
		});
		try {
			const newerLocal = await checkRemoteUpdate({
				baseUrl,
				local: { ...LOCAL, version: "0.1.2" },
			});
			expect(newerLocal.updateAvailable).toBe(false);
			expect(newerLocal.version).toBe("0.1.1");
			const olderLocal = await checkRemoteUpdate({
				baseUrl,
				local: { ...LOCAL, version: "0.1.0" },
			});
			expect(olderLocal.updateAvailable).toBe(true);
		} finally {
			server.stop(true);
		}
	});

	test("GitHub-style host reports an update when the hash changes", async () => {
		const tarball = await makeTinyTarball();
		const bytes = await Bun.file(tarball).bytes();
		const { baseUrl, server } = await serveGitHubLayout({
			"stable-macos-arm64-Pinar.app.tar.zst": bytes,
			"stable-macos-arm64-update.json": JSON.stringify(MANIFEST),
		});
		try {
			const stale = await checkRemoteUpdate({ baseUrl, local: LOCAL });
			expect(stale.updateAvailable).toBe(true);
			expect(stale.version).toBe("0.1.2");
			expect(stale.artifactUrl).toBe(`${baseUrl}/stable-macos-arm64-Pinar.app.tar.zst`);

			const dest = join(await mkdtemp(join(tmpdir(), "pinar-dl-")), "update.tar.zst");
			const size = await downloadUpdateArtifact(stale.artifactUrl, dest);
			expect(size).toBe(bytes.byteLength);

			const listed = Bun.spawn(["zstd", "-dc", dest], { stdout: "pipe", stderr: "ignore" });
			const tar = Bun.spawn(["tar", "-t"], { stdin: listed.stdout, stdout: "pipe" });
			const listing = await new Response(tar.stdout).text();
			expect(await listed.exited).toBe(0);
			expect(await tar.exited).toBe(0);
			expect(listing).toContain("Pinar.app/Contents/Info.plist");

			const current = await checkRemoteUpdate({
				baseUrl,
				local: { ...LOCAL, hash: MANIFEST.hash },
			});
			expect(current.updateAvailable).toBe(false);
		} finally {
			server.stop(true);
		}
	});

	test.skipIf(!existsSync(REAL_TARBALL))(
		"stable update archive bakes GitHub latest/download as baseUrl",
		async () => {
			const extract = await mkdtemp(join(tmpdir(), "pinar-ver-"));
			const listed = Bun.spawn(["zstd", "-dc", REAL_TARBALL], { stdout: "pipe", stderr: "ignore" });
			const tar = Bun.spawn(
				["tar", "-x", "-C", extract, "Pinar.app/Contents/Resources/version.json"],
				{ stdin: listed.stdout, stdout: "ignore" },
			);
			expect(await listed.exited).toBe(0);
			expect(await tar.exited).toBe(0);
			const version = JSON.parse(
				await Bun.file(join(extract, "Pinar.app/Contents/Resources/version.json")).text(),
			) as { baseUrl?: string; identifier?: string; channel?: string; version?: string };
			expect(version.identifier).toBe(APP_IDENTIFIER);
			expect(version.channel).toBe("stable");
			expect(version.version).toMatch(/^\d+\.\d+\.\d+$/);
			expect(version.baseUrl).toBe(GITHUB_RELEASE_BASE_URL);
		},
	);

	test.skipIf(!existsSync(REAL_MANIFEST))(
		"Hutch artifacts use the GitHub Releases filenames Electrobun fetches",
		async () => {
			const document = JSON.parse(await Bun.file(REAL_MANIFEST).text()) as unknown;
			const manifest = parseUpdateManifest(document, {
				arch: "arm64",
				channel: "stable",
				identifier: APP_IDENTIFIER,
				platform: "macos",
			});
			expect(manifest.artifact.file).toBe("stable-macos-arm64-Pinar.app.tar.zst");
			expect(existsSync(join(ARTIFACTS, manifest.artifact.file))).toBe(true);
			expect(updateManifestUrl(GITHUB_RELEASE_BASE_URL)).toBe(
				`${GITHUB_RELEASE_BASE_URL}/stable-macos-arm64-update.json`,
			);
			expect(/^[a-z0-9]{1,13}$/.test(manifest.hash)).toBe(true);
			expect(existsSync(REAL_TARBALL)).toBe(true);
		},
	);

	test("GitHub /releases/latest/download serves a matching stable macos bundle when published", async () => {
		const response = await fetch(updateManifestUrl(GITHUB_RELEASE_BASE_URL), {
			redirect: "follow",
			signal: AbortSignal.timeout(15_000),
		});
		expect(response.ok).toBe(true);
		const manifest = parseUpdateManifest(await response.json(), {
			arch: "arm64",
			channel: "stable",
			identifier: APP_IDENTIFIER,
			platform: "macos",
		});
		const stale = await checkRemoteUpdate({
			baseUrl: GITHUB_RELEASE_BASE_URL,
			local: LOCAL,
		});
		expect(stale.updateAvailable).toBe(true);
		expect(stale.version).toBe(manifest.version);
		const artifact = await fetch(stale.artifactUrl, {
			headers: { Range: "bytes=0-3" },
			redirect: "follow",
			signal: AbortSignal.timeout(15_000),
		});
		expect([200, 206]).toContain(artifact.status);
		expect([...new Uint8Array(await artifact.arrayBuffer())]).toEqual([0x28, 0xb5, 0x2f, 0xfd]);
		const current = await checkRemoteUpdate({
			baseUrl: GITHUB_RELEASE_BASE_URL,
			local: { ...LOCAL, hash: manifest.hash },
		});
		expect(current.updateAvailable).toBe(false);
	}, 20_000);
});
