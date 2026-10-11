import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
	copyFileSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	realpathSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { afterAll, describe, expect, test } from "bun:test";
import {
	DEFAULT_PORT,
	DEFAULT_TIMEOUT_MS,
	DESKTOP_PREFS,
	MAX_WRAPPER_DECOMPRESSED_BYTES,
	MAX_WRAPPER_ENTRIES,
	SAMPLE_INTERVAL_MS,
	TASKKILL_TIMEOUT_MS,
	darwinWrapperPayloadTarZst,
	defaultAppDir,
	decide,
	extractWrapperPayload,
	isHealthyHealth,
	identityOfFor,
	imageOfFor,
	isInsideAppDir,
	killTreeFor,
	launcherCandidates,
	parseArgs,
	parseNetstatListeningPid,
	parsePid,
	parsePort,
	parseTasklistCsvLine,
	probeHealthDetail,
	probeResidueKeepsSandbox,
	psScript,
	readTailFile,
	readTrayPid,
	resolveLauncher,
	runSmoke,
	smokeEnv,
	tasklistCsvHasPid,
	validatePlainTar,
	validateZstdSingleFrame,
	wrapperPayloadTarZst,
	zstdDeclaredContentSize,
	zstdPreallocationBound,
} from "./tray-smoke.mjs";
import {
	boundedIdentityProbe,
	captureChildIdentity,
	cliSandboxDecision,
	shouldRemoveSandbox,
	teardownChild,
	waitChildOutcome,
} from "./child-teardown.mjs";

describe("parseArgs", () => {
	test("defaults: port 17390, timeout 90000, no app-dir/log", () => {
		const args = parseArgs([]);
		expect(args.appDir).toBeNull();
		expect(args.port).toBe(DEFAULT_PORT);
		expect(args.port).toBe(17390);
		expect(args.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
		expect(args.timeoutMs).toBe(90_000);
		expect(args.log).toBeNull();
		expect(args.keepHome).toBe(false);
	});

	test("parses every flag", () => {
		const args = parseArgs([
			"--app-dir",
			"C:\\builds\\stable-win-x64",
			"--port",
			"17392",
			"--timeout-ms",
			"120000",
			"--log",
			"C:\\evidence\\smoke.log",
			"--keep-home",
		]);
		expect(args.appDir).toBe("C:\\builds\\stable-win-x64");
		expect(args.port).toBe(17392);
		expect(args.timeoutMs).toBe(120_000);
		expect(args.log).toBe("C:\\evidence\\smoke.log");
		expect(args.keepHome).toBe(true);
	});

	test("rejects an out-of-range or non-numeric port", () => {
		expect(() => parseArgs(["--port", "0"])).toThrow(/out of range|invalid/);
		expect(() => parseArgs(["--port", "65536"])).toThrow(/out of range|invalid/);
		expect(() => parseArgs(["--port", "abc"])).toThrow(/invalid/);
	});

	test("rejects a timeout below 1000 or not an integer", () => {
		expect(() => parseArgs(["--timeout-ms", "500"])).toThrow(/timeout/);
		expect(() => parseArgs(["--timeout-ms", "10.5"])).toThrow(/timeout/);
		expect(() => parseArgs(["--timeout-ms", "junk"])).toThrow(/timeout/);
	});

	test("rejects unknown flags and missing values", () => {
		expect(() => parseArgs(["--bogus"])).toThrow(/unknown argument/);
		expect(() => parseArgs(["--port"])).toThrow(/missing value/);
		expect(() => parseArgs(["--port", "--timeout-ms", "2000"])).toThrow(/missing value/);
	});
});

describe("parsePort", () => {
	test("accepts the full valid range", () => {
		expect(parsePort("1")).toBe(1);
		expect(parsePort("17390")).toBe(17390);
		expect(parsePort("65535")).toBe(65535);
	});

	test("rejects invalid values", () => {
		for (const bad of ["0", "65536", "-5", "1.5", "1e3", "", "0x10", "  ", null, 17390]) {
			expect(() => parsePort(bad)).toThrow();
		}
	});
});

describe("parsePid (SM-6 strict PID parsing)", () => {
	test("accepts bare decimal PIDs in 1..2147483647 with surrounding whitespace", () => {
		expect(parsePid("1")).toBe(1);
		expect(parsePid("1234")).toBe(1234);
		expect(parsePid("  4321  \n")).toBe(4321);
		expect(parsePid("2147483647")).toBe(2147483647);
	});

	test("rejects every malformed value with null (never normalizes)", () => {
		for (const bad of ["12abc", "1e3", "0x1f", " ", "0", "-5", "99999999999", "42x", " 42 x", "1.0", "+42", "04 2", "", null, 42]) {
			expect(parsePid(bad)).toBeNull();
		}
		// Above the 32-bit PID bound:
		expect(parsePid("2147483648")).toBeNull();
	});
});

describe("isHealthyHealth", () => {
	test("accepts only ok===true and service===\"pinar\"", () => {
		expect(isHealthyHealth({ ok: true, service: "pinar" })).toBe(true);
		expect(isHealthyHealth({ ok: true, service: "pinar", version: "0.7.0" })).toBe(true);
	});

	test("rejects every other body", () => {
		expect(isHealthyHealth({ ok: true, service: "other" })).toBe(false);
		expect(isHealthyHealth({ ok: false, service: "pinar" })).toBe(false);
		expect(isHealthyHealth({ ok: "true", service: "pinar" })).toBe(false);
		expect(isHealthyHealth({ ok: true })).toBe(false);
		expect(isHealthyHealth({ service: "pinar" })).toBe(false);
		expect(isHealthyHealth(null)).toBe(false);
		expect(isHealthyHealth(undefined)).toBe(false);
		expect(isHealthyHealth("ok")).toBe(false);
	});
});

describe("decide", () => {
	test("success only when fresh pid file + live pid + in tree + healthy", () => {
		expect(
			decide({ freshPidFile: true, pidAlive: true, inTree: true, healthOk: true, trayPid: 4242 }),
		).toEqual({ jsExecuted: true, ok: true, reason: null });
	});

	test("no tray.pid after the timeout", () => {
		expect(decide({ freshPidFile: false, pidAlive: false, inTree: false, healthOk: false, timeoutMs: 45_000 })).toEqual({
			jsExecuted: false,
			ok: false,
			reason: "no tray.pid after 45000ms",
		});
	});

	test("a stale or dead pid is not JS execution", () => {
		expect(decide({ freshPidFile: true, pidAlive: false, inTree: true, healthOk: true, trayPid: 999 })).toEqual({
			jsExecuted: false,
			ok: false,
			reason: "tray.pid pid 999 is not alive",
		});
		expect(
			decide({ freshPidFile: true, pidAlive: true, inTree: false, healthOk: true, trayPid: 999 }),
		).toEqual({
			jsExecuted: false,
			ok: false,
			reason: "tray.pid pid 999 is outside the launched process tree",
		});
	});

	test("JS executed but the helper never came up is not a success", () => {
		expect(decide({ freshPidFile: true, pidAlive: true, inTree: true, healthOk: false, trayPid: 4242 })).toEqual({
			jsExecuted: true,
			ok: false,
			reason: "health not ok on the pinned port",
		});
	});
});

describe("launcher resolution", () => {
	test("win32 prefers the launcher.exe next to the runtime in bin/", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-win-"));
		try {
			mkdirSync(join(root, "bin"), { recursive: true });
			writeFileSync(join(root, "bin", "launcher.exe"), "");
			writeFileSync(join(root, "bin", "cottontail.exe"), "");
			expect(resolveLauncher(root, "win32")).toBe(join(root, "bin", "launcher.exe"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("win32 accepts the Pinar/ and app/ nested layouts and the bare runtime fallback", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-win2-"));
		try {
			mkdirSync(join(root, "Pinar", "bin"), { recursive: true });
			writeFileSync(join(root, "Pinar", "bin", "launcher.exe"), "");
			expect(resolveLauncher(root, "win32")).toBe(join(root, "Pinar", "bin", "launcher.exe"));

			const nested = mkdtempSync(join(tmpdir(), "pinar-smoke-win3-"));
			mkdirSync(join(nested, "app", "bin"), { recursive: true });
			writeFileSync(join(nested, "app", "bin", "launcher.exe"), "");
			expect(resolveLauncher(nested, "win32")).toBe(join(nested, "app", "bin", "launcher.exe"));
			rmSync(nested, { recursive: true, force: true });

			const bare = mkdtempSync(join(tmpdir(), "pinar-smoke-win4-"));
			mkdirSync(join(bare, "bin"), { recursive: true });
			writeFileSync(join(bare, "bin", "cottontail.exe"), "");
			expect(resolveLauncher(bare, "win32")).toBe(join(bare, "bin", "cottontail.exe"));
			rmSync(bare, { recursive: true, force: true });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("darwin resolves the Electrobun bundle launcher under Contents/MacOS", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-mac-"));
		try {
			const exe = join(root, "Pinar.app", "Contents", "MacOS", "launcher");
			mkdirSync(dirname(exe), { recursive: true });
			writeFileSync(exe, "");
			expect(resolveLauncher(root, "darwin")).toBe(exe);
			expect(launcherCandidates(root, "darwin")).toHaveLength(4);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("darwin falls back to the product-named executable and prefers launcher when both exist", () => {
		const onlyProduct = mkdtempSync(join(tmpdir(), "pinar-smoke-mac2-"));
		const productExe = join(onlyProduct, "Pinar.app", "Contents", "MacOS", "Pinar");
		mkdirSync(dirname(productExe), { recursive: true });
		writeFileSync(productExe, "");
		const nested = mkdtempSync(join(tmpdir(), "pinar-smoke-mac3-"));
		const nestedExe = join(nested, "app", "Pinar.app", "Contents", "MacOS", "launcher");
		mkdirSync(dirname(nestedExe), { recursive: true });
		writeFileSync(nestedExe, "");
		const both = mkdtempSync(join(tmpdir(), "pinar-smoke-mac4-"));
		mkdirSync(join(both, "Pinar.app", "Contents", "MacOS"), { recursive: true });
		writeFileSync(join(both, "Pinar.app", "Contents", "MacOS", "launcher"), "");
		writeFileSync(join(both, "Pinar.app", "Contents", "MacOS", "Pinar"), "");
		try {
			expect(resolveLauncher(onlyProduct, "darwin")).toBe(productExe);
			expect(resolveLauncher(nested, "darwin")).toBe(nestedExe);
			expect(resolveLauncher(both, "darwin")).toBe(join(both, "Pinar.app", "Contents", "MacOS", "launcher"));
		} finally {
			rmSync(onlyProduct, { recursive: true, force: true });
			rmSync(nested, { recursive: true, force: true });
			rmSync(both, { recursive: true, force: true });
		}
	});

	test("linux resolves the Pinar binary", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-linux-"));
		try {
			writeFileSync(join(root, "Pinar"), "");
			expect(resolveLauncher(root, "linux")).toBe(join(root, "Pinar"));
			expect(launcherCandidates(root, "linux")[0]).toBe(join(root, "Pinar"));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("returns null when no candidate exists", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-empty-"));
		try {
			expect(resolveLauncher(root, "win32")).toBeNull();
			expect(resolveLauncher(root, "darwin")).toBeNull();
			expect(resolveLauncher(root, "linux")).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("per-platform fixture layout", () => {
	test("each platform builds only its own fixture: first candidate resolves, no candidate is an ancestor of another", () => {
		for (const platform of ["win32", "darwin", "linux"] as const) {
			const root = makeAppDir(platform);
			try {
				const candidates = launcherCandidates(root, platform);
				expect(resolveLauncher(root, platform)).toBe(candidates[0]);
				// Lexically: no candidate path may be an ancestor directory
				// of another candidate in the same platform list (that is
				// what made the old all-platforms fixture write the linux
				// `Pinar` file over the win32 `Pinar/` directory).
				for (const ancestor of candidates) {
					for (const other of candidates) {
						if (ancestor === other) continue;
						const a = ancestor.replace(/\\/g, "/");
						const b = other.replace(/\\/g, "/");
						expect(b.startsWith(a + "/")).toBe(false);
					}
				}
			} finally {
				rmSync(root, { recursive: true, force: true });
			}
		}
	});
});

describe("defaultAppDir", () => {
	test("points at apps/tray/build for the named platform", () => {
		// Pure path computation (no fs): an absolute, non-existent root keeps
		// the expectations identical on every platform.
		const root = join(tmpdir(), "pinar-smoke-defapp", "repo");
		expect(defaultAppDir(join(root, "scripts"), "win32", "x64")).toBe(
			join(root, "apps", "tray", "build", "stable-win-x64"),
		);
		expect(defaultAppDir(join(root, "scripts"), "win32", "arm64")).toBe(
			join(root, "apps", "tray", "build", "stable-win-arm64"),
		);
		expect(defaultAppDir(join(root, "scripts"), "darwin", "arm64")).toBe(
			join(root, "apps", "tray", "build", "stable-macos-arm64"),
		);
		expect(defaultAppDir(join(root, "scripts"), "darwin", "x64")).toBe(
			join(root, "apps", "tray", "build", "stable-macos-x64"),
		);
		expect(defaultAppDir(join(root, "scripts"), "linux", "x64")).toBe(
			join(root, "apps", "tray", "build", "stable-linux-x64"),
		);
	});
});

describe("smokeEnv", () => {
	test("sandboxes PINAR_HOME, HOME, USERPROFILE and pins PINAR_PORT", () => {
		const env = smokeEnv("C:\\temp\\smoke-1", 17391, {
			platform: "win32",
			baseEnv: { FOO: "bar" },
		});
		expect(env.PINAR_HOME).toBe(join("C:\\temp\\smoke-1", ".pinar"));
		expect(env.HOME).toBe(join("C:\\temp\\smoke-1", "home"));
		expect(env.USERPROFILE).toBe(join("C:\\temp\\smoke-1", "home"));
		expect(env.PINAR_PORT).toBe("17391");
		expect(env.LOCALAPPDATA).toBe(join("C:\\temp\\smoke-1", "home", "AppData", "Local"));
		expect(env.APPDATA).toBe(join("C:\\temp\\smoke-1", "home", "AppData", "Roaming"));
		expect(env.FOO).toBe("bar");
	});

	test("unix env does not set Windows-only variables", () => {
		const env = smokeEnv("/tmp/smoke-2", 17392, { platform: "linux", baseEnv: {} });
		expect(env.LOCALAPPDATA).toBeUndefined();
		expect(env.APPDATA).toBeUndefined();
		expect(env.PINAR_PORT).toBe("17392");
	});

	// SM-4: the smoke child environment is hardened against inherited
	// state: every inherited PINAR_* (allowlist) is dropped, and the
	// temp/home state roots are overridden to paths inside the sandbox.
	test("SM-4: every inherited PINAR_* is dropped; the smoke's own two are kept", () => {
		const env = smokeEnv("C:\\temp\\smoke-4", 17394, {
			platform: "win32",
			baseEnv: {
				PINAR_HOME: "C:\\old\\pinar",
				PINAR_PORT: "17373",
				PINAR_BIN: "C:\\old\\pinar\\bin",
				PINAR_UPDATE_BASE_URL: "https://example.invalid/update",
				PINAR_ANYTHING_ELSE: "x",
				FOO: "bar",
			},
		});
		expect(env.PINAR_HOME).toBe(join("C:\\temp\\smoke-4", ".pinar")); // re-set by the smoke
		expect(env.PINAR_PORT).toBe("17394"); // re-set by the smoke
		expect(env.PINAR_BIN).toBeUndefined();
		expect(env.PINAR_UPDATE_BASE_URL).toBeUndefined();
		expect(env.PINAR_ANYTHING_ELSE).toBeUndefined();
		expect(env.FOO).toBe("bar"); // non-PINAR base env still inherited
	});

	test("SM-4: TEMP/TMP/TMPDIR point inside the sandbox on every platform", () => {
		for (const platform of ["win32", "darwin", "linux"] as const) {
			const env = smokeEnv("/tmp/smoke-4b", 17395, { platform, baseEnv: { TEMP: "/tmp", TMP: "/tmp", TMPDIR: "/tmp" } });
			expect(env.TEMP).toBe(join("/tmp/smoke-4b", "tmp"));
			expect(env.TMP).toBe(join("/tmp/smoke-4b", "tmp"));
			expect(env.TMPDIR).toBe(join("/tmp/smoke-4b", "tmp"));
		}
	});

	test("SM-4: win32 HOMEDRIVE/HOMEPATH split from the sandbox home", () => {
		const env = smokeEnv("C:\\Users\\runner\\AppData\\Local\\Temp\\smoke-4c", 17396, {
			platform: "win32",
			baseEnv: { HOMEDRIVE: "D:", HOMEPATH: "\\oldhome" },
		});
		expect(env.HOMEDRIVE).toBe("C:");
		expect(env.HOMEPATH).toBe("\\Users\\runner\\AppData\\Local\\Temp\\smoke-4c\\home");
	});

	test("SM-4: POSIX XDG_* roots sit under the sandbox home", () => {
		const env = smokeEnv("/tmp/smoke-4d", 17397, {
			platform: "linux",
			baseEnv: { XDG_CONFIG_HOME: "/old/.config" },
		});
		const home = join("/tmp/smoke-4d", "home");
		expect(env.XDG_CONFIG_HOME).toBe(join(home, ".config"));
		expect(env.XDG_DATA_HOME).toBe(join(home, ".local", "share"));
		expect(env.XDG_CACHE_HOME).toBe(join(home, ".cache"));
		expect(env.XDG_STATE_HOME).toBe(join(home, ".local", "state"));
	});
});

describe("readTrayPid", () => {
	test("missing file is not a fresh pid file", () => {
		expect(readTrayPid(join(tmpdir(), "pinar-smoke-nope.pid"), 0)).toEqual({
			exists: false,
			pid: null,
			fresh: false,
		});
	});

	test("a file written before the launch is not fresh", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-pid-"));
		try {
			const path = join(root, "tray.pid");
			writeFileSync(path, "1234\n");
			const past = new Date(Date.now() - 60_000);
			utimesSync(path, past, past);
			expect(readTrayPid(path, Date.now() - 5_000)).toEqual({ exists: true, pid: 1234, fresh: false });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("a file written at/after the launch is fresh with its pid", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-pid2-"));
		try {
			const path = join(root, "tray.pid");
			const startMs = Date.now() - 1_000;
			writeFileSync(path, "4321\n");
			expect(readTrayPid(path, startMs)).toEqual({ exists: true, pid: 4321, fresh: true });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("invalid content yields no pid and is never fresh", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-pid3-"));
		try {
			const path = join(root, "tray.pid");
			writeFileSync(path, "not-a-pid\n");
			expect(readTrayPid(path, Date.now() - 1_000)).toEqual({ exists: true, pid: null, fresh: false });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	// SM-6: the tray.pid content goes through the strict parsePid (digits
	// only, 1..2^31-1) — no Number() normalization of malformed values.
	test("SM-6: malformed tray.pid values are rejected (strict parse, no normalization)", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-pid4-"));
		try {
			const path = join(root, "tray.pid");
			for (const bad of ["1e3\n", "0x1f\n", "0\n", "-5\n", "99999999999\n", "12abc\n", "42 x\n"]) {
				writeFileSync(path, bad);
				expect(readTrayPid(path, Date.now() - 1_000)).toEqual({ exists: true, pid: null, fresh: false });
			}
			// The strict bound is inclusive:
			writeFileSync(path, "2147483647\n");
			expect(readTrayPid(path, Date.now() - 1_000).pid).toBe(2147483647);
			writeFileSync(path, "2147483648\n");
			expect(readTrayPid(path, Date.now() - 1_000).pid).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("isInsideAppDir (canonical)", () => {
	/** Injectable realpath: a map from EXACT input string to canonical path;
	 * anything else throws ENOENT (fail closed). */
	function fakeRealpath(map) {
		return (p) => {
			if (typeof p !== "string" || p === "" || !Object.prototype.hasOwnProperty.call(map, p)) {
				const error = new Error(`ENOENT: no such file or directory, realpath '${p}'`);
				error.code = "ENOENT";
				throw error;
			}
			return map[p];
		};
	}
	const win = (map) => ({ platform: "win32", realpath: fakeRealpath(map) });
	const posix = (map) => ({ platform: "posix", realpath: fakeRealpath(map) });

	test("win32 8.3: a short dir canonicalizes to the long dir of the image (F2)", () => {
		const shortDir = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\pinar-tray-smoke-abc\\extracted";
		const longImage = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\pinar-tray-smoke-abc\\extracted\\Helpers\\pinar.exe";
		expect(
			isInsideAppDir(longImage, shortDir, win({
				[longImage]: longImage,
				[shortDir]: "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\pinar-tray-smoke-abc\\extracted",
			})),
		).toBe(true);
		// The reverse spelling of the same image (short form) is inside too:
		// the injected canonicalizer maps every spelling to the same
		// canonical path.
		const canonicalBase = "C:\\Users\\runneradmin\\AppData\\Local\\Temp\\pinar-tray-smoke-abc\\extracted";
		const shortImage = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\pinar-tray-smoke-abc\\extracted\\Helpers\\pinar.exe";
		expect(
			isInsideAppDir(shortImage, canonicalBase, win({
				[shortImage]: `${canonicalBase}\\Helpers\\pinar.exe`,
				[canonicalBase]: canonicalBase,
			})),
		).toBe(true);
	});

	test("win32: containment is case-insensitive, separator-agnostic and prefix-safe", () => {
		const appDir = "C:\\Users\\x\\builds\\stable-win-x64\\app";
		const options = win({
			"C:\\users\\x\\BUILDS\\stable-win-x64\\app\\Resources\\app\\Helpers\\pinar.exe":
				"C:\\Users\\x\\builds\\stable-win-x64\\app\\Resources\\app\\Helpers\\pinar.exe",
			[appDir]: appDir,
			"C:\\Users\\x\\builds\\stable-win-x64\\app\\evil.exe": "C:\\Users\\x\\builds\\stable-win-x64\\app\\evil.exe",
			"C:\\Users\\x\\builds\\stable-win-x64\\app-evil\\pinar.exe":
				"C:\\Users\\x\\builds\\stable-win-x64\\app-evil\\pinar.exe",
			"C:\\Users\\x\\builds\\stable-win-x64\\other\\pinar.exe":
				"C:\\Users\\x\\builds\\stable-win-x64\\other\\pinar.exe",
		});
		expect(isInsideAppDir("C:\\users\\x\\BUILDS\\stable-win-x64\\app\\Resources\\app\\Helpers\\pinar.exe", appDir, options)).toBe(true);
		// Mixed / and \ separators on the image side.
		expect(
			isInsideAppDir("c:/users/x/builds/stable-win-x64/app/evil.exe", appDir, {
				platform: "win32",
				realpath: fakeRealpath({
					"c:/users/x/builds/stable-win-x64/app/evil.exe": "C:\\Users\\x\\builds\\stable-win-x64\\app\\evil.exe",
					[appDir]: appDir,
				}),
			}),
		).toBe(true);
		expect(isInsideAppDir("C:\\Users\\x\\builds\\stable-win-x64\\app-evil\\pinar.exe", appDir, options)).toBe(false);
		expect(isInsideAppDir("C:\\Users\\x\\builds\\stable-win-x64\\other\\pinar.exe", appDir, options)).toBe(false);
	});

	test("sibling prefix is not inside (win32 and posix)", () => {
		expect(
			isInsideAppDir("C:\\a\\app-evil\\x.exe", "C:\\a\\app", win({
				"C:\\a\\app-evil\\x.exe": "C:\\a\\app-evil\\x.exe",
				"C:\\a\\app": "C:\\a\\app",
			})),
		).toBe(false);
		expect(
			isInsideAppDir("/tmp/app-evil/pinar", "/tmp/app", posix({
				"/tmp/app-evil/pinar": "/tmp/app-evil/pinar",
				"/tmp/app": "/tmp/app",
			})),
		).toBe(false);
	});

	test("unix containment uses / separators and is case-sensitive", () => {
		const appDir = "/tmp/builds/stable-linux-x64";
		expect(isInsideAppDir("/tmp/builds/stable-linux-x64/Helpers/pinar", appDir, posix({
			"/tmp/builds/stable-linux-x64/Helpers/pinar": "/tmp/builds/stable-linux-x64/Helpers/pinar",
			[appDir]: appDir,
		}))).toBe(true);
		// Case difference on posix: a different directory.
		expect(isInsideAppDir("/tmp/builds/STABLE-LINUX-X64/Helpers/pinar", appDir, posix({
			"/tmp/builds/STABLE-LINUX-X64/Helpers/pinar": "/tmp/builds/STABLE-LINUX-X64/Helpers/pinar",
			[appDir]: appDir,
		}))).toBe(false);
	});

	test("posix: a symlinked image that escapes the dir is not inside", () => {
		// `link` lexically sits under /opt/app but resolves to /elsewhere.
		expect(
			isInsideAppDir("/opt/app/link/pinar", "/opt/app", posix({
				"/opt/app/link/pinar": "/elsewhere/pinar",
				"/opt/app": "/opt/app",
			})),
		).toBe(false);
	});

	test("posix: a dir that is itself a symlink to the real dir is inside", () => {
		expect(
			isInsideAppDir("/opt/app/x/pinar", "/opt/link-to-app", posix({
				"/opt/app/x/pinar": "/opt/app/x/pinar",
				"/opt/link-to-app": "/opt/app",
			})),
		).toBe(true);
	});

	test("win32: a different drive is not inside", () => {
		expect(
			isInsideAppDir("D:\\a\\app\\x.exe", "C:\\a\\app", win({
				"D:\\a\\app\\x.exe": "D:\\a\\app\\x.exe",
				"C:\\a\\app": "C:\\a\\app",
			})),
		).toBe(false);
	});

	test("realpath throwing for the image or for the dir fails closed", () => {
		const throwing = () => {
			const error = new Error("ENOENT: no such file or directory");
			error.code = "ENOENT";
			throw error;
		};
		expect(isInsideAppDir("C:\\a\\app\\x.exe", "C:\\a\\app", { platform: "win32", realpath: throwing })).toBe(false);
		expect(
			isInsideAppDir("C:\\a\\app\\x.exe", "C:\\a\\app", {
				platform: "win32",
				realpath: (p) => (p === "C:\\a\\app" ? "C:\\a\\app" : throwing()),
			}),
		).toBe(false);
	});

	test("null or empty input is never inside", () => {
		expect(isInsideAppDir(null, "/tmp/app")).toBe(false);
		expect(isInsideAppDir("/tmp/app/exe", "")).toBe(false);
		expect(isInsideAppDir("", "/tmp/app")).toBe(false);
	});

	test("a `..foo` child (a name that starts with two dots) is inside", () => {
		expect(
			isInsideAppDir("C:\\a\\app\\..foo\\x.exe", "C:\\a\\app", win({
				"C:\\a\\app\\..foo\\x.exe": "C:\\a\\app\\..foo\\x.exe",
				"C:\\a\\app": "C:\\a\\app",
			})),
		).toBe(true);
		expect(
			isInsideAppDir("/tmp/app/..foo/x", "/tmp/app", posix({
				"/tmp/app/..foo/x": "/tmp/app/..foo/x",
				"/tmp/app": "/tmp/app",
			})),
		).toBe(true);
	});
});

describe("netstat listening pid", () => {
	test("parses the pid for the exact local port", () => {
		const stdout = [
			"  TCP    127.0.0.1:17390        0.0.0.0:0              LISTENING       31337",
			"  TCP    127.0.0.1:17373        0.0.0.0:0              LISTENING       41156",
			"  TCP    192.168.1.10:17390     0.0.0.0:0              LISTENING       9999",
		].join("\r\n");
		expect(parseNetstatListeningPid(stdout, 17390)).toBe(31337);
		expect(parseNetstatListeningPid(stdout, 17391)).toBeNull();
	});

	// SM-6: the pid column goes through the strict parsePid — a malformed
	// listener pid is no listener (never normalized to a number).
	test("SM-6: a malformed pid column is not a listener", () => {
		for (const bad of ["1e3", "0x1f", "0", "-5", "99999999999", "42x"]) {
			const stdout = `  TCP    127.0.0.1:17390        0.0.0.0:0              LISTENING       ${bad}`;
			expect(parseNetstatListeningPid(stdout, 17390)).toBeNull();
		}
		const good = `  TCP    127.0.0.1:17390        0.0.0.0:0              LISTENING       4242`;
		expect(parseNetstatListeningPid(good, 17390)).toBe(4242);
	});
});

describe("tasklist csv parsers", () => {
	const row = '"cottontail.exe","131260","Console","1","812,444 K"';

	test("parses a tasklist CSV row into image + numeric pid", () => {
		expect(parseTasklistCsvLine(row)).toEqual({ image: "cottontail.exe", pid: 131260 });
	});

	test("parses a row whose image name contains spaces", () => {
		const parsed = parseTasklistCsvLine('"C:\\Program Files \\ Pinar\\bin\\launcher.exe","195852","Console","1","1,204 K"');
		expect(parsed).toEqual({ image: "C:\\Program Files \\ Pinar\\bin\\launcher.exe", pid: 195852 });
	});

	test("returns null for the no-match INFO line and empty input", () => {
		expect(parseTasklistCsvLine("INFO: No tasks are running which match the specified criteria.")).toBeNull();
		expect(parseTasklistCsvLine("")).toBeNull();
	});

	// SM-6: the pid field is the strict parsePid (nullable) — a malformed
	// pid is null, and the trusted-numeric exact comparison can never match
	// a real positive pid on it.
	test("SM-6: a malformed pid column is null and never matches", () => {
		for (const bad of ["1e3", "0x1f", "0", "-5", "99999999999", "42x"]) {
			const row = `"pinar.exe","${bad}","Console","1","51,000 K"`;
			expect(parseTasklistCsvLine(row)?.pid).toBeNull();
			expect(tasklistCsvHasPid(row, 42)).toBe(false);
		}
	});

	test("matches the pid exactly (no prefix collisions)", () => {
		expect(tasklistCsvHasPid(row, 131260)).toBe(true);
		expect(tasklistCsvHasPid(row, "131260")).toBe(true);
		expect(tasklistCsvHasPid(row, 1312)).toBe(false);
		expect(tasklistCsvHasPid(row, 1312600)).toBe(false);
	});

	test("reports false for tasklist no-match output", () => {
		expect(tasklistCsvHasPid("INFO: No tasks are running which match the specified criteria.\r\n", 131260)).toBe(false);
	});

	test("scans multiple rows", () => {
		const out = [row, '"pinar.exe","29036","Console","1","51,000 K"'].join("\r\n");
		expect(tasklistCsvHasPid(out, 29036)).toBe(true);
		expect(tasklistCsvHasPid(out, 42)).toBe(false);
	});
});

describe("wrapper payload detection", () => {
	test("finds the payload inside a stable-win-x64 wrapper dir", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-wrap-"));
		try {
			const wrapper = join(root, "stable-win-x64", "Pinar");
			mkdirSync(join(wrapper, "bin"), { recursive: true });
			mkdirSync(join(wrapper, "Resources"), { recursive: true });
			writeFileSync(join(wrapper, "bin", "launcher.exe"), "");
			writeFileSync(join(wrapper, "Resources", "abc123.tar.zst"), "");
			expect(wrapperPayloadTarZst(join(root, "stable-win-x64"))).toBe(
				join(wrapper, "Resources", "abc123.tar.zst"),
			);
		}
		finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("finds the payload when appDir is the Pinar wrapper itself", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-wrap2-"));
		try {
			const wrapper = join(root, "Pinar");
			mkdirSync(join(wrapper, "bin"), { recursive: true });
			mkdirSync(join(wrapper, "Resources"), { recursive: true });
			writeFileSync(join(wrapper, "bin", "launcher.exe"), "");
			writeFileSync(join(wrapper, "Resources", "def456.tar.zst"), "");
			expect(wrapperPayloadTarZst(wrapper)).toBe(join(wrapper, "Resources", "def456.tar.zst"));
		}
		finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("returns null for an already-extracted app dir", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-wrap3-"));
		try {
			const wrapper = join(root, "Pinar");
			mkdirSync(join(wrapper, "bin"), { recursive: true });
			mkdirSync(join(wrapper, "Resources"), { recursive: true });
			writeFileSync(join(wrapper, "bin", "launcher.exe"), "");
			writeFileSync(join(wrapper, "bin", "cottontail.exe"), "");
			writeFileSync(join(wrapper, "Resources", "abc123.tar.zst"), "");
			expect(wrapperPayloadTarZst(root)).toBeNull();
			expect(wrapperPayloadTarZst(wrapper)).toBeNull();
		}
		finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("returns null when there is no wrapper at all", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-wrap4-"));
		try {
			mkdirSync(join(root, "bin"), { recursive: true });
			writeFileSync(join(root, "bin", "launcher.exe"), "");
			writeFileSync(join(root, "bin", "cottontail.exe"), "");
			expect(wrapperPayloadTarZst(root)).toBeNull();
		}
		finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("desktop prefs seed", () => {
	test("login is configured and disabled", () => {
		expect(DESKTOP_PREFS).toEqual({ loginConfigured: true, loginEnabled: false });
	});
});

describe("imageOfFor darwin branch", () => {
	test("returns the ps -o comm= path for a live pid", async () => {
		const imageOf = imageOfFor("darwin", {
			ps: () => ({ status: 0, stdout: "/Applications/Pinar.app/Contents/MacOS/launcher\n" }),
		});
		expect(await imageOf(1234)).toBe("/Applications/Pinar.app/Contents/MacOS/launcher");
	});

	test("trims whitespace from the ps output", async () => {
		const imageOf = imageOfFor("darwin", {
			ps: () => ({ status: 0, stdout: "  /opt/pinar/Pinar.app/Contents/MacOS/Pinar  \n" }),
		});
		expect(await imageOf(42)).toBe("/opt/pinar/Pinar.app/Contents/MacOS/Pinar");
	});

	test("empty ps output resolves to null", async () => {
		const imageOf = imageOfFor("darwin", { ps: () => ({ status: 0, stdout: "\n" }) });
		expect(await imageOf(99)).toBeNull();
	});

	test("a failed ps (non-zero status) resolves to null", async () => {
		const imageOf = imageOfFor("darwin", { ps: () => ({ status: 1, stdout: "" }) });
		expect(await imageOf(99)).toBeNull();
	});

	test("linux keeps the /proc/<pid>/exe lookup", () => {
		const imageOf = imageOfFor("linux", { procDir: "/tmp/fakeproc" });
		// No such link: the resolver swallows the error and reports null.
		return expect(imageOf(31337)).resolves.toBeNull();
	});

	// The win32 branch maps a timed-out probe to an UNKNOWN image (null —
	// fail closed: no ownership match on it) and records the residue when
	// the probe child was not reaped (review rv-fin-sec F1).
	test("win32: an unreaped timed-out image probe is an unknown image and records the residue", async () => {
		const residue: [string, number][] = [];
		const imageOf = imageOfFor("win32", {
			probeDir: "/tmp/fake-probes",
			runPsWin: async () => ({ ok: false, stdout: "C:\\Pinar\\Pinar.exe\n", stderr: "", code: null, timedOut: true, unreaped: true }),
			onResidue: (kind: string, pid: number) => residue.push([kind, pid]),
		});
		expect(await imageOf(55)).toBeNull(); // unknown image: fail closed
		expect(residue).toEqual([["image", 55]]);
	});

	test("win32: a reaped timed-out image probe is an unknown image with no residue", async () => {
		const residue: [string, number][] = [];
		const imageOf = imageOfFor("win32", {
			probeDir: "/tmp/fake-probes",
			runPsWin: async () => ({ ok: false, stdout: "", stderr: "", code: null, timedOut: true, unreaped: false }),
			onResidue: (kind: string, pid: number) => residue.push([kind, pid]),
		});
		expect(await imageOf(55)).toBeNull();
		expect(residue).toEqual([]);
	});
});

type IdentityState =
	| { state: "alive"; id: string }
	| { state: "gone" }
	| { state: "unknown"; error: string };

/** Scripted identityOf: a per-PID queue of states consumed one per call;
 * the last state repeats. Records every call. */
function scriptedIdentity(perPid: Record<number, IdentityState[]>): {
	identityOf: (pid: number) => Promise<IdentityState>;
	calls: Map<number, number>;
} {
	const calls = new Map<number, number>();
	return {
		identityOf: async (pid) => {
			const n = (calls.get(pid) ?? 0) + 1;
			calls.set(pid, n);
			const queue = perPid[pid] ?? [];
			return queue[Math.min(n, queue.length) - 1];
		},
		calls,
	};
}

describe("identityOfFor", () => {
	// --- win32 (CIM CreationDate) ------------------------------------------
	const win = (run: (pid: number) => { code: number | null; stdout: string; stderr: string }) =>
		identityOfFor("win32", { probeDir: "/tmp/fake-probes", runPsWin: async () => run(0) });

	test("win32: exit 0 with a run of digits is alive with the file time as id", async () => {
		const identityOf = win(() => ({ code: 0, stdout: "133850432100000000\n", stderr: "" }));
		expect(await identityOf(1234)).toEqual({ state: "alive", id: "133850432100000000" });
	});

	test("win32: exit 3 proves the PID is gone", async () => {
		const identityOf = win(() => ({ code: 3, stdout: "", stderr: "" }));
		expect(await identityOf(1234)).toEqual({ state: "gone" });
	});

	test("win32: exit 2 (CIM failure) is unknown", async () => {
		const identityOf = win(() => ({ code: 2, stdout: "", stderr: "access denied" }));
		const out = await identityOf(1234);
		expect(out.state).toBe("unknown");
	});

	test("win32: exit 4 (no CreationDate) is unknown", async () => {
		const identityOf = win(() => ({ code: 4, stdout: "", stderr: "" }));
		const out = await identityOf(1234);
		expect(out.state).toBe("unknown");
	});

	test("win32: a null exit code (timeout kill) is unknown", async () => {
		const identityOf = win(() => ({ code: null, stdout: "", stderr: "" }));
		const out = await identityOf(1234);
		expect(out.state).toBe("unknown");
	});

	test("win32: exit 0 with non-digit stdout is unknown", async () => {
		const identityOf = win(() => ({ code: 0, stdout: "not-a-time\n", stderr: "" }));
		const out = await identityOf(1234);
		expect(out.state).toBe("unknown");
	});

	test("win32: exit 0 with empty stdout is unknown", async () => {
		const identityOf = win(() => ({ code: 0, stdout: "\n", stderr: "" }));
		const out = await identityOf(1234);
		expect(out.state).toBe("unknown");
	});

	test("win32: a throwing runner is unknown, never a throw", async () => {
		const identityOf = identityOfFor("win32", {
			probeDir: "/tmp/fake-probes",
			runPsWin: async () => {
				throw new Error("runner exploded");
			},
		});
		const out = await identityOf(1234);
		expect(out.state).toBe("unknown");
	});

	// A timed-out probe (a psScript deadline) is unknown by construction —
	// never alive or gone — and an UNREAPED timed-out probe is residue:
	// the caller's onResidue is called so the smoke retains its sandbox and
	// reports it (review rv-fin-sec F1). A reaped timeout is plain unknown.
	test("win32: a timed-out probe is unknown even with digit stdout", async () => {
		const identityOf = identityOfFor("win32", {
			probeDir: "/tmp/fake-probes",
			runPsWin: async () => ({ ok: false, stdout: "133850432100000000\n", stderr: "", code: null, timedOut: true, unreaped: false }),
		});
		const out = await identityOf(1234);
		expect(out.state).toBe("unknown");
		expect(out.error).toContain("timed out");
	});

	test("win32: an unreaped timed-out probe records the residue", async () => {
		const residue: [string, number][] = [];
		const identityOf = identityOfFor("win32", {
			probeDir: "/tmp/fake-probes",
			runPsWin: async () => ({ ok: false, stdout: "", stderr: "", code: null, timedOut: true, unreaped: true }),
			onResidue: (kind: string, pid: number) => residue.push([kind, pid]),
		});
		const out = await identityOf(4321);
		expect(out.state).toBe("unknown");
		expect(residue).toEqual([["identity", 4321]]);
	});

	test("win32: a reaped timed-out probe records no residue", async () => {
		const residue: [string, number][] = [];
		const identityOf = identityOfFor("win32", {
			probeDir: "/tmp/fake-probes",
			runPsWin: async () => ({ ok: false, stdout: "", stderr: "", code: null, timedOut: true, unreaped: false }),
			onResidue: (kind: string, pid: number) => residue.push([kind, pid]),
		});
		const out = await identityOf(4321);
		expect(out.state).toBe("unknown");
		expect(residue).toEqual([]);
	});

	// --- darwin (ps stat=,lstart=,comm=) ------------------------------------
	// SM-2: the darwin id is `<lstart>|<executable path>` — the lstart text
	// has one-second precision, so the id also binds the executable path
	// (which for the smoke lives inside the unique mkdtemp sandbox).
	const mac = (run: () => { status: number | null; stdout: string; error?: unknown }) =>
		identityOfFor("darwin", { runPs: () => run() });

	test("darwin: stat 0 with Ss, an lstart and the comm path is alive with the lstart|path id", async () => {
		const identityOf = mac(() => ({
			status: 0,
			stdout: "Ss   Sat Oct 10 04:22:18 2026 /opt/pinar/Pinar.app/Contents/MacOS/launcher",
		}));
		expect(await identityOf(42)).toEqual({
			state: "alive",
			id: "Sat Oct 10 04:22:18 2026|/opt/pinar/Pinar.app/Contents/MacOS/launcher",
		});
	});

	test("darwin: the comm path may contain spaces (the remainder after stat + 5 lstart tokens)", async () => {
		const identityOf = mac(() => ({
			status: 0,
			stdout: "S    Sat Oct 10 04:22:18 2026 /App Files/Pinar app/Contents/MacOS/Pinar",
		}));
		expect(await identityOf(42)).toEqual({
			state: "alive",
			id: "Sat Oct 10 04:22:18 2026|/App Files/Pinar app/Contents/MacOS/Pinar",
		});
	});

	test("darwin: the SAME lstart with a different path is a different id", async () => {
		const a = mac(() => ({ status: 0, stdout: "Ss  Sat Oct 10 04:22:18 2026 /a/bin/x" }));
		const b = mac(() => ({ status: 0, stdout: "Ss  Sat Oct 10 04:22:18 2026 /b/bin/x" }));
		expect((await a(42)).id).not.toBe((await b(42)).id);
	});

	test("darwin: a missing comm path is unknown (fail closed)", async () => {
		const identityOf = mac(() => ({ status: 0, stdout: "Ss   Sat Oct 10 04:22:18 2026" }));
		const out = await identityOf(42);
		expect(out.state).toBe("unknown");
	});

	test("darwin: an empty comm path is unknown (fail closed)", async () => {
		const identityOf = mac(() => ({ status: 0, stdout: "Ss   Sat Oct 10 04:22:18 2026 " }));
		const out = await identityOf(42);
		expect(out.state).toBe("unknown");
	});

	test("darwin: stat 0 with a Z stat is gone", async () => {
		const identityOf = mac(() => ({ status: 0, stdout: "Z    Sat Oct 10 04:22:18 2026 /a/bin/x" }));
		expect(await identityOf(42)).toEqual({ state: "gone" });
	});

	test("darwin: status 1 with empty output proves gone", async () => {
		const identityOf = mac(() => ({ status: 1, stdout: "" }));
		expect(await identityOf(42)).toEqual({ state: "gone" });
	});

	test("darwin: status 1 with stdout is unknown", async () => {
		const identityOf = mac(() => ({ status: 1, stdout: "garbled" }));
		const out = await identityOf(42);
		expect(out.state).toBe("unknown");
	});

	test("darwin: status 2 is unknown", async () => {
		const identityOf = mac(() => ({ status: 2, stdout: "" }));
		const out = await identityOf(42);
		expect(out.state).toBe("unknown");
	});

	test("darwin: a spawn error is unknown", async () => {
		const identityOf = mac(() => ({ status: null, stdout: "", error: new Error("ENOENT: ps") }));
		const out = await identityOf(42);
		expect(out.state).toBe("unknown");
	});

	// --- linux (/proc/<pid>/stat) -------------------------------------------
	test("linux: a live stat entry with a comm containing ') (' is alive with the starttime as id", async () => {
		const procDir = mkdtempSync(join(tmpdir(), "pinar-smoke-proc-"));
		try {
			// comm = "weird ) ( name": the numeric fields start after the LAST
			// ")" — a naive first-paren split would take the wrong fields.
			mkdirSync(join(procDir, "12345"), { recursive: true });
			writeFileSync(
				join(procDir, "12345", "stat"),
				"12345 (weird ) ( name) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 987654321\n",
			);
			const identityOf = identityOfFor("linux", { procDir });
			expect(await identityOf(12345)).toEqual({ state: "alive", id: "987654321" });
		} finally {
			rmSync(procDir, { recursive: true, force: true });
		}
	});

	test("linux: a Z state is gone", async () => {
		const procDir = mkdtempSync(join(tmpdir(), "pinar-smoke-proc-"));
		try {
			mkdirSync(join(procDir, "12345"), { recursive: true });
			writeFileSync(
				join(procDir, "12345", "stat"),
				"12345 (zombie) Z 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 1\n",
			);
			const identityOf = identityOfFor("linux", { procDir });
			expect(await identityOf(12345)).toEqual({ state: "gone" });
		} finally {
			rmSync(procDir, { recursive: true, force: true });
		}
	});

	test("linux: a missing stat entry is gone", async () => {
		const procDir = mkdtempSync(join(tmpdir(), "pinar-smoke-proc-"));
		try {
			const identityOf = identityOfFor("linux", { procDir });
			expect(await identityOf(31337)).toEqual({ state: "gone" });
		} finally {
			rmSync(procDir, { recursive: true, force: true });
		}
	});

	test("linux: a stat without a closing paren is unknown", async () => {
		const procDir = mkdtempSync(join(tmpdir(), "pinar-smoke-proc-"));
		try {
			mkdirSync(join(procDir, "12345"), { recursive: true });
			writeFileSync(join(procDir, "12345", "stat"), "12345 (never closed S 1 2\n");
			const identityOf = identityOfFor("linux", { procDir });
			const out = await identityOf(12345);
			expect(out.state).toBe("unknown");
		} finally {
			rmSync(procDir, { recursive: true, force: true });
		}
	});

	test("linux: a truncated stat without a starttime is unknown", async () => {
		const procDir = mkdtempSync(join(tmpdir(), "pinar-smoke-proc-"));
		try {
			mkdirSync(join(procDir, "12345"), { recursive: true });
			writeFileSync(join(procDir, "12345", "stat"), "12345 (short) S 1 2\n");
			const identityOf = identityOfFor("linux", { procDir });
			const out = await identityOf(12345);
			expect(out.state).toBe("unknown");
		} finally {
			rmSync(procDir, { recursive: true, force: true });
		}
	});

	test("linux: an unreadable stat entry (a directory) is unknown, never gone", async () => {
		const procDir = mkdtempSync(join(tmpdir(), "pinar-smoke-proc-"));
		try {
			// A DIRECTORY named `stat`: the read fails with something other
			// than ENOENT/ESRCH, which must not be treated as gone.
			mkdirSync(join(procDir, "12345", "stat"), { recursive: true });
			const identityOf = identityOfFor("linux", { procDir });
			const out = await identityOf(12345);
			expect(out.state).toBe("unknown");
		} finally {
			rmSync(procDir, { recursive: true, force: true });
		}
	});
});

/* Shared runSmoke fixtures/helpers (module scope: used by several suites). */

/** ONLY the given platform's launcher candidates (plus, for win32, the
 * cottontail.exe runtime next to each bin/launcher.exe stub so the
 * self-extracting-wrapper detection stays null). The old all-platforms
 * fixture wrote the linux `Pinar` FILE over the win32 `Pinar/` DIRECTORY:
 * EISDIR on POSIX, and a silent file-over-directory "success" on Windows
 * Bun. The exists-as-directory guard below makes every platform fail
 * loudly instead. */
function makeAppDir(platform = process.platform) {
	const root = mkdtempSync(join(tmpdir(), "pinar-smoke-app-"));
	const files = launcherCandidates(root, platform).slice();
	if (platform === "win32") {
		for (const stub of files) {
			if (stub.endsWith(join("bin", "launcher.exe"))) {
				files.push(join(dirname(stub), "cottontail.exe"));
			}
		}
	}
	for (const file of files) {
		if (existsSync(file) && statSync(file).isDirectory()) {
			throw new Error(`fixture collision: ${file} already exists as a directory`);
		}
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, "");
	}
	return root;
}

/** A fake launcher: records the spawn and (optionally) pre-writes
 * tray.pid. The child stays live (exitCode/signalCode null) until
 * cleanup signals it, at which point it exits — matching a real launcher
 * that only dies when the kill reaches it. `backdate` models a tray.pid
 * written by an earlier run (mtime before this launch). Pass
 * `{ alreadyExited: true }` to model a launcher that exited on its own
 * before cleanup (PID-reuse scenario). */
function fakeSpawn(childPid, trayPid, opts = {}) {
	const calls = [];
	let child;
	const spawnFn = (launcher, _args, spawnOpts) => {
		calls.push(launcher);
		if (trayPid != null) {
			const pinarHome = spawnOpts.env.PINAR_HOME;
			mkdirSync(pinarHome, { recursive: true });
			const pidFile = join(pinarHome, "tray.pid");
			writeFileSync(pidFile, `${trayPid}\n`);
			// NTFS mtime can land up to ~0.4 ms BEFORE the Date.now() that
			// runSmoke records as startMs in the same tick; stamp the file 1 s
			// in the future so readTrayPid's `mtimeMs >= startMs` sees it as
			// fresh (a real tray writes the file after the child starts).
			const freshStamp = new Date(Date.now() + 1_000);
			utimesSync(pidFile, freshStamp, freshStamp);
			if (opts.backdate) {
				const past = new Date(Date.now() - 120_000);
				utimesSync(pidFile, past, past);
			}
		}
		const closeListeners = [];
		child = {
			pid: childPid,
			exitCode: opts.alreadyExited ? 0 : null,
			signalCode: null,
			stdout: null,
			stderr: null,
			on(event, fn) {
				if (event !== "close" || opts.alreadyExited) return;
				closeListeners.push(fn);
				// The launcher exits right after the signal: resolves
				// waitClose without waiting the real 5 s timeout.
				queueMicrotask(() => {
					child.exitCode = 0;
					for (const listener of closeListeners.splice(0)) listener(0);
				});
			},
		};
		return child;
	};
	return { spawnFn, calls };
}

describe("runSmoke", () => {
	test("never kills a tray.pid pid outside the launched tree and launch dir", async () => {
		const appDir = makeAppDir();
		const foreign = 99991;
		const childPid = 7777;
		const killCalls = [];
		const killed = new Set();
		const { spawnFn, calls } = fakeSpawn(childPid, foreign);
		try {
			const result = await runSmoke(
				{ appDir, port: 17395, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async () => null, // nothing is related to the launched child
					isAlive: async (pid) => (killed.has(pid) ? false : pid === foreign || pid === childPid),
					// Non-existent image: the canonical check fails closed.
					imageOf: async () => "C:\\outside\\foreign\\bin\\pinar.exe",
					killTree: async (pid) => {
						killCalls.push(pid);
						killed.add(pid);
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(calls).toHaveLength(1);
			expect(result.ok).toBe(false);
			expect(result.jsExecuted).toBe(false);
			// Only the launcher this run spawned is terminated.
			expect(killCalls).toEqual([childPid]);
			// The foreign tray pid is recorded as a refusal, and cleanup is clean.
			expect(result.cleanup.ok).toBe(true);
			expect(result.cleanup.refused.some((entry) => entry.includes(String(foreign)))).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("kills a tray.pid pid that is inside the launched process tree", async () => {
		const appDir = makeAppDir();
		const foreign = 99992;
		const childPid = 7778;
		const killCalls = [];
		const killed = new Set();
		const { spawnFn } = fakeSpawn(childPid, foreign);
		try {
			const result = await runSmoke(
				{ appDir, port: 17396, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async (pid) => (pid === foreign ? childPid : null),
					isAlive: async (pid) => (killed.has(pid) ? false : pid === foreign || pid === childPid),
					imageOf: async () => "C:\\outside\\foreign\\bin\\pinar.exe",
					killTree: async (pid) => {
						killCalls.push(pid);
						killed.add(pid);
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(result.ok).toBe(false); // health never came up on the pinned port
			expect(killCalls).toContain(foreign);
			expect(killCalls).toContain(childPid);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("kills a tray.pid pid whose image is inside the launched build dir", async () => {
		const appDir = makeAppDir();
		const foreign = 99993;
		const childPid = 7779;
		const killCalls = [];
		const killed = new Set();
		const { spawnFn } = fakeSpawn(childPid, foreign);
		try {
			await runSmoke(
				{ appDir, port: 17397, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async () => null, // not in the tree: the image decides
					isAlive: async (pid) => (killed.has(pid) ? false : pid === foreign || pid === childPid),
					// A REAL file inside the current platform's fixture.
					imageOf: async (pid) => (pid === foreign ? launcherCandidates(appDir, process.platform)[0] : null),
					killTree: async (pid) => {
						killCalls.push(pid);
						killed.add(pid);
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(killCalls).toContain(foreign);
			expect(killCalls).toContain(childPid);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("refuses to launch when the pinned port is already in use by any pid", async () => {
		const appDir = makeAppDir();
		const killCalls = [];
		let spawned = 0;
		try {
			const result = await runSmoke(
				{ appDir, port: 17398, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: () => {
						spawned += 1;
						throw new Error("spawn must not run");
					},
					parentOf: async () => null,
					isAlive: async () => false,
					imageOf: async () => null,
					killTree: async (pid) => {
						killCalls.push(pid);
					},
					listeningPid: (port) => (port === 17398 ? 42424 : null),
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(result.ok).toBe(false);
			expect(result.jsExecuted).toBe(false);
			expect(result.reason).toContain("already in use by pid 42424");
			expect(spawned).toBe(0); // refused before launching anything
			expect(killCalls).toEqual([]); // and nothing was killed
			// The pre-existing listener is recorded as a refusal.
			expect(result.cleanup.refused.some((entry) => entry.includes("42424"))).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a pre-busy port whose listener image is inside the app dir is never killed", async () => {
		// Regression (F2 cleanup ownership): the pre-existing listener's
		// image lies INSIDE the app dir fixture — a refusal before spawn must
		// still kill nothing (the old finally killed it via launchRoot).
		const appDir = makeAppDir();
		const killCalls = [];
		let spawned = 0;
		try {
			const result = await runSmoke(
				{ appDir, port: 17407, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: () => {
						spawned += 1;
						throw new Error("spawn must not run");
					},
					parentOf: async () => null,
					isAlive: async (pid) => pid === 42424,
					imageOf: async (pid) => (pid === 42424 ? launcherCandidates(appDir, process.platform)[0] : null),
					killTree: async (pid) => {
						killCalls.push(pid);
					},
					listeningPid: (port) => (port === 17407 ? 42424 : null),
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(spawned).toBe(0);
			expect(result.ok).toBe(false);
			expect(result.reason).toContain("already in use");
			expect(killCalls).toEqual([]);
			expect(result.cleanup.refused.some((entry) => entry.includes("42424"))).toBe(true);
			expect(result.cleanup.errors).toEqual([]);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a pre-spawn failure (launcher not found) with a listener inside the app dir kills nothing", async () => {
		const appDir = mkdtempSync(join(tmpdir(), "pinar-smoke-empty2-"));
		const marker = join(appDir, "marker.txt");
		writeFileSync(marker, "");
		const killCalls = [];
		let spawned = 0;
		try {
			const result = await runSmoke(
				{ appDir, port: 17408, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: () => {
						spawned += 1;
						throw new Error("spawn must not run");
					},
					parentOf: async () => null,
					isAlive: async (pid) => pid === 55555,
					imageOf: async (pid) => (pid === 55555 ? marker : null),
					killTree: async (pid) => {
						killCalls.push(pid);
					},
					listeningPid: (port) => (port === 17408 ? 55555 : null),
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(spawned).toBe(0);
			expect(result.ok).toBe(false);
			expect(result.reason).toContain("launcher not found");
			expect(killCalls).toEqual([]);
			expect(result.cleanup.refused.some((entry) => entry.includes("55555"))).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("does not kill a helper on the port that is outside the launched tree and dir", async () => {
		const appDir = makeAppDir();
		const foreignHelper = 99994;
		const childPid = 7780;
		const killCalls = [];
		const killed = new Set();
		const { spawnFn } = fakeSpawn(childPid, null);
		// The port is free before the launch (first probe); by cleanup a
		// foreign process holds it, and it must survive.
		let listeningCalls = 0;
		try {
			const result = await runSmoke(
				{ appDir, port: 17395, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async () => null,
					isAlive: async (pid) => (killed.has(pid) ? false : pid === childPid || pid === foreignHelper),
					imageOf: async (pid) => (pid === foreignHelper ? "C:\\outside\\helpers\\pinar.exe" : null),
					killTree: async (pid) => {
						killCalls.push(pid);
						killed.add(pid);
					},
					listeningPid: () => {
						listeningCalls += 1;
						return listeningCalls <= 1 ? null : foreignHelper;
					},
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(listeningCalls).toBeGreaterThan(1); // cleanup probe ran
			expect(result.ok).toBe(false);
			expect(killCalls).toEqual([childPid]); // the foreign helper survived
			expect(result.cleanup.refused.some((entry) => entry.includes(String(foreignHelper)))).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("does not signal the launcher once it has already exited on its own", async () => {
		const appDir = makeAppDir();
		const childPid = 7781;
		const killCalls = [];
		const { spawnFn, calls } = fakeSpawn(childPid, null, { alreadyExited: true });
		try {
			const result = await runSmoke(
				{ appDir, port: 17398, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async () => null,
					isAlive: async () => false,
					imageOf: async () => null,
					killTree: async (pid) => {
						killCalls.push(pid);
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(calls).toHaveLength(1); // the launcher did spawn
			expect(result.ok).toBe(false);
			// The launcher exited before cleanup: its PID may be reused, so
			// nothing signals it. (A live launcher is still signalled — see the
			// killCalls assertions in the tests above.)
			expect(killCalls).toEqual([]);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a failed sandbox removal keeps the startup facts and reports cleanup failure", async () => {
		const appDir = makeAppDir();
		const childPid = 90001;
		const trayPid = 90002;
		const killCalls = [];
		const killed = new Set();
		const { spawnFn } = fakeSpawn(childPid, trayPid);
		let healthCalls = 0;
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17410, timeoutMs: 2_000, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async (pid) => (pid === trayPid ? childPid : null),
					isAlive: async (pid) => (killed.has(pid) ? false : pid === trayPid || pid === childPid),
					imageOf: async () => null,
					killTree: async (pid) => {
						killCalls.push(pid);
						killed.add(pid);
					},
					listeningPid: () => null,
					// The pre-launch probe must see a free/unhealthy port;
					// the helper only comes up after the (fake) spawn.
					probeHealth: async () => {
						healthCalls += 1;
						return { healthy: healthCalls > 1 };
					},
					removeDir: (p) => {
						const error = new Error(`rmSync: EBUSY: resource busy or locked, rmdir '${p}'`);
						(error as NodeJS.ErrnoException).code = "EBUSY";
						throw error;
					},
				},
			);
			expect(result.ok).toBe(false);
			expect(result.jsExecuted).toBe(true);
			expect(result.trayPid).toBe(trayPid);
			expect(result.health).toBe(true);
			expect(result.cleanup.ok).toBe(false);
			expect(result.cleanup.errors.some((entry) => entry.includes("EBUSY"))).toBe(true);
			expect(result.sandbox).toBeTruthy();
			expect(result.sandboxRetained).toBe(true);
			expect(result.reason).toMatch(/^cleanup failed:/);
			expect(killCalls).toContain(trayPid);
			expect(killCalls).toContain(childPid);
		} finally {
			// The retained sandbox is removed here (it is test evidence, not
			// a fixture the next test needs).
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a killTree that throws is recorded in cleanup.errors and runSmoke resolves", async () => {
		const appDir = makeAppDir();
		const childPid = 90003;
		const { spawnFn } = fakeSpawn(childPid, null);
		try {
			const result = await runSmoke(
				{ appDir, port: 17411, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async () => null,
					isAlive: async (pid) => pid === childPid,
					imageOf: async () => null,
					killTree: async () => {
						throw new Error("boom-kill");
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(result.ok).toBe(false);
			expect(result.cleanup.ok).toBe(false);
			expect(result.cleanup.errors.some((entry) => entry.includes("boom-kill"))).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a stale tray.pid (mtime before the launch) is never a cleanup candidate", async () => {
		const appDir = makeAppDir();
		const childPid = 91001;
		const stalePid = 91002;
		const killCalls = [];
		const killed = new Set();
		const { spawnFn } = fakeSpawn(childPid, stalePid, { backdate: true });
		try {
			const result = await runSmoke(
				{ appDir, port: 17412, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async () => null,
					isAlive: async (pid) => (killed.has(pid) ? false : pid === childPid || pid === stalePid),
					// If the stale pid were (wrongly) trusted, its image would
					// look like it is inside the launched build dir:
					imageOf: async (pid) => (pid === stalePid ? launcherCandidates(appDir, process.platform)[0] : null),
					killTree: async (pid) => {
						killCalls.push(pid);
						killed.add(pid);
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(result.ok).toBe(false);
			expect(result.jsExecuted).toBe(false);
			expect(result.trayPid).toBeNull(); // the stale pid was never adopted
			// Only the launched launcher is terminated — the stale pid's
			// (live, in-dir-image) PID is never killed.
			expect(killCalls).toEqual([childPid]);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("--keep-home success reports the kept sandbox on disk", async () => {
		const appDir = makeAppDir();
		const childPid = 92001;
		const trayPid = 92002;
		const killed = new Set();
		const { spawnFn } = fakeSpawn(childPid, trayPid);
		let healthCalls = 0;
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17413, timeoutMs: 2_000, log: null, keepHome: true },
				{
					spawn: spawnFn,
					parentOf: async (pid) => (pid === trayPid ? childPid : null),
					isAlive: async (pid) => (killed.has(pid) ? false : pid === trayPid || pid === childPid),
					imageOf: async () => null,
					killTree: async (pid) => {
						killed.add(pid);
					},
					listeningPid: () => null,
					// The pre-launch probe must see a free/unhealthy port.
					probeHealth: async () => {
						healthCalls += 1;
						return { healthy: healthCalls > 1 };
					},
				},
			);
			expect(result.ok).toBe(true);
			expect(result.cleanup.ok).toBe(true);
			expect(result.jsExecuted).toBe(true);
			expect(result.sandbox).toBeTruthy();
			expect(result.sandboxRetained).toBe(true);
			expect(existsSync(result.sandbox)).toBe(true);
		} finally {
			// The test removes the kept sandbox.
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	// --- PID reuse via an exited launcher ---------------------------------
	// Once the launcher has exited, its PID can be reused by an unrelated
	// process; tree membership (pid === launcher pid, or a recorded parent
	// edge to it) is no longer evidence — only canonical image containment
	// inside the launch dir qualifies.

	test("a port listener reusing an exited launcher pid (image outside) is refused", async () => {
		const appDir = makeAppDir();
		const outsideDir = mkdtempSync(join(tmpdir(), "pinar-smoke-outside-"));
		writeFileSync(join(outsideDir, "unrelated.exe"), "");
		const launcherPid = 77001; // reused by an unrelated live process
		const { spawnFn } = fakeSpawn(launcherPid, null, { alreadyExited: true });
		let launched = false;
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17415, timeoutMs: 1_000, log: null, keepHome: false },
				{
					// SM-7: the spawn-phase flag replaces the call counter —
					// the SM-7 diagnostic samples also probe listeningPid
					// during the wait loop.
					spawn: (launcher: string, args: string[], opts: { env: Record<string, string> }) => {
						launched = true;
						return spawnFn(launcher, args, opts);
					},
					parentOf: async () => null,
					isAlive: async () => true, // the reused pid is alive
					imageOf: async (pid) => (pid === launcherPid ? join(outsideDir, "unrelated.exe") : null),
					killTree: async () => {
						throw new Error("killTree must not be called");
					},
					listeningPid: (port) => {
						// Free before the spawn; held by the reused pid once this
						// run has launched (the cleanup decision sees it; the
						// bounded post-kill poll runs its full budget against the
						// still-held port, which is reported, never re-signalled).
						return port === 17415 && launched ? launcherPid : null;
					},
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(result.ok).toBe(false);
			expect(result.cleanup.killed).toEqual([]);
			expect(result.cleanup.refused.some((entry) => entry.includes(String(launcherPid)))).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
			rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	test("a fresh tray.pid whose parent is the exited launcher (image outside) is not killed", async () => {
		const appDir = makeAppDir();
		const outsideDir = mkdtempSync(join(tmpdir(), "pinar-smoke-outside-"));
		writeFileSync(join(outsideDir, "unrelated.exe"), "");
		const launcherPid = 77002;
		const trayPid = 77003;
		const { spawnFn } = fakeSpawn(launcherPid, trayPid, { alreadyExited: true });
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17416, timeoutMs: 1_000, log: null, keepHome: false },
				{
					spawn: spawnFn,
					// The recorded parent edge points at the exited launcher pid.
					parentOf: async (pid) => (pid === trayPid ? launcherPid : null),
					isAlive: async () => true,
					imageOf: async (pid) => (pid === trayPid ? join(outsideDir, "unrelated.exe") : null),
					killTree: async () => {
						throw new Error("killTree must not be called");
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(result.ok).toBe(false);
			expect(result.cleanup.killed).toEqual([]);
			expect(result.cleanup.refused.some((entry) => entry.includes(String(trayPid)))).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
			rmSync(outsideDir, { recursive: true, force: true });
		}
	});

	test("a helper whose image is inside the launch dir is killed even after the launcher exited", async () => {
		const appDir = makeAppDir();
		const launcherPid = 77005;
		const helperPid = 77004;
		const killed = new Set();
		const { spawnFn } = fakeSpawn(launcherPid, null, { alreadyExited: true });
		const helperExe = join(appDir, "helper-inside.exe");
		writeFileSync(helperExe, "");
		let launched = false;
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17417, timeoutMs: 1_000, log: null, keepHome: false },
				{
					// SM-7: the spawn-phase flag replaces the call counter —
					// the SM-7 diagnostic samples also probe listeningPid
					// during the wait loop.
					spawn: (launcher: string, args: string[], opts: { env: Record<string, string> }) => {
						launched = true;
						return spawnFn(launcher, args, opts);
					},
					parentOf: async () => null,
					isAlive: async (pid) => !killed.has(pid),
					imageOf: async (pid) => (pid === helperPid ? helperExe : null),
					killTree: async (pid) => {
						killed.add(pid);
					},
					listeningPid: (port) => {
						if (port !== 17417) return null;
						// The helper holds the port once this run has launched,
						// until the (fake) kill reaches it — the bounded poll
						// then settles.
						return launched && !killed.has(helperPid) ? helperPid : null;
					},
					probeHealth: async () => ({ healthy: false }),
				},
			);
			// Image containment still justifies the kill after the launcher
			// exited (the real-smoke shape: launcher exits after the tray dies,
			// the helper is found by image).
			expect(result.cleanup.killed).toEqual([helperPid]);
			expect(result.cleanup.ok).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a throwing spawn hook is reported, resolves and retains the sandbox on --keep-home", async () => {
		const appDir = makeAppDir();
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17418, timeoutMs: 1_000, log: null, keepHome: true },
				{
					spawn: () => {
						throw new Error("spawn failed early");
					},
					isAlive: async () => false,
					imageOf: async () => null,
					killTree: async () => {
						throw new Error("killTree must not be called");
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(result.ok).toBe(false);
			expect(result.reason.startsWith("launcher spawn failed:")).toBe(true);
			expect(result.launcherPid).toBeUndefined(); // nothing was started
			expect(result.cleanup.killed).toEqual([]);
			expect(result.cleanup.ok).toBe(true);
			expect(result.sandbox).toBeTruthy();
			expect(result.sandboxRetained).toBe(true);
			expect(existsSync(result.sandbox)).toBe(true);
		} finally {
			// The test removes the kept sandbox.
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	});
});

/* ---------------- cleanup identity binding (P2) ---------------------------
 *
 * Every kill decision and every post-kill verdict is bound to a process
 * identity captured BEFORE the signal: a reused PID (a different id, or no
 * process) counts as the original process being gone — reported in
 * cleanup.reused, never re-signalled — while an owned survivor (same id) or
 * an unknown probe fails the cleanup. All tests below use healthy startups
 * with an already-exited launcher, so killTree is called for the tray PID
 * alone and its exact call count is asserted.
 */

// Healthy startup (fresh tray.pid in the launched tree + health) for the
// kill/verdict/diagnostics tests. The pre-launch health probe must be
// unhealthy (a healthy helper before launch refuses the spawn); the
// helper comes up only after the (fake) spawn.
const healthyHooks = (appDir: string, childPid: number, trayPid: number, extra: Record<string, unknown>) => {
	let healthCalls = 0;
	return {
		parentOf: async (pid: number) => (pid === trayPid ? childPid : null),
		isAlive: async (pid: number) => pid === trayPid,
		// Image containment inside the app dir fixture proves ownership
		// after the launcher exited (the tree edge is no longer evidence).
		imageOf: async (pid: number) =>
			pid === trayPid ? launcherCandidates(appDir, process.platform)[0] : null,
		listeningPid: () => null,
		probeHealth: async () => {
			healthCalls += 1;
			return { healthy: healthCalls > 1 };
		},
		...extra,
	};
};

/* ---------------- SM-7: failure diagnostics ------------------------------ */

describe("runSmoke failure diagnostics (SM-7)", () => {
	// The deterministic fakes: never-healthy port, a port owner that appears
	// only AFTER the pre-spawn port check (so the run is not refused before
	// spawning), an in-tree tray pid, and an injected probeHealthDetail.
	// The samples are taken from the wait loop (≤1 per SAMPLE_INTERVAL_MS)
	// plus one forced final sample — every probe inside a sample is an
	// existing bounded probe. The port owner is never ALIVE (isAlive false),
	// so the cleanup refuses it (ownership) and no kill is ever attempted.
	const failingHooks = (appDir: string, childPid: number, trayPid: number, extras: Record<string, unknown> = {}) => {
		let listeningCalls = 0;
		const killCalls: number[] = [];
		const killedPids = new Set<number>();
		return {
			parentOf: async (pid: number) => (pid === trayPid ? childPid : null),
			isAlive: async (pid: number) => (killedPids.has(pid) ? false : pid === trayPid || pid === childPid),
			imageOf: async (pid: number) =>
				pid === trayPid || pid === 8888 ? launcherCandidates(appDir, process.platform)[0] : null,
			identityOf: async (pid: number) =>
				killedPids.has(pid) ? { state: "gone" } : { state: "alive", id: "A" },
			// A FAKE killTree: the suite must never signal a process it did
			// not spawn (the default win32 killTree would taskkill a real pid
			// if one were recycled to the fixture pid).
			killTree: async (pid: number) => {
				killCalls.push(pid);
				killedPids.add(pid);
			},
			// Call 1 is the pre-spawn refusal probe (free port: null); every
			// later call (samples + cleanup) sees the port owner — until a
			// (fake) kill has happened, then the port is free and the bounded
			// post-kill poll settles instead of running its full budget.
			listeningPid: () => {
				listeningCalls += 1;
				return listeningCalls === 1 ? null : killCalls.length === 0 ? 8888 : null;
			},
			probeHealth: async () => ({ healthy: false }),
			probeHealthDetail: async () => ({ ok: false, status: null, service: null, error: "injected detail" }),
			groupExists: () => "absent",
			...extras,
		};
	};

	test("diagnostics are present on a health timeout with the documented shape; absent on success", async () => {
		const appDir = makeAppDir();
		const childPid = 96001;
		const trayPid = 96002;
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17401, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					// The pinned port never answers healthy: the run times out
					// on the health (the CI 38156214350 failure shape).
					...failingHooks(appDir, childPid, trayPid, {}),
				}),
			);
			expect(result.ok).toBe(false);
			const diag = result.diagnostics;
			expect(diag).toBeDefined();
			// The samples: ≤14, each with the documented shape.
			expect(Array.isArray(diag.samples)).toBe(true);
			expect(diag.samples.length).toBeLessThanOrEqual(14);
			expect(diag.samples.length).toBeGreaterThanOrEqual(1);
			for (const s of diag.samples) {
				expect(typeof s.tMs).toBe("number");
				expect(s.health).toBeDefined();
				expect(s.portOwnerPid).toBe(8888);
				expect(s.portOwnerInTree).toBe(false); // the owner is not in the launched tree
				expect(Array.isArray(s.helpers)).toBe(true);
				// The port owner's image is inside the launch dir → listed
				// (no command lines, only { pid, inTree }).
				expect(s.helpers.some((h) => h.pid === 8888 && h.inTree === false)).toBe(true);
			}
			// lastHealth: the injected detail probe.
			expect(diag.lastHealth).toEqual({ ok: false, status: null, service: null, error: "injected detail" });
			expect(diag.trayPid).toBe(trayPid);
			// server.pid: the strict parse (absent in this sandbox).
			expect(diag.serverPid).toEqual({ value: null, reason: "absent" });
			// sandboxFiles: ≤60 { relPath, size }, the seeded desktop.json is in.
			expect(Array.isArray(diag.sandboxFiles)).toBe(true);
			expect(diag.sandboxFiles.length).toBeLessThanOrEqual(60);
			expect(diag.sandboxFiles.some((f) => f.relPath === ".pinar/desktop.json")).toBe(true);
			for (const f of diag.sandboxFiles) {
				expect(typeof f.relPath).toBe("string");
				expect(typeof f.size).toBe("number");
			}
			// logTails: an object (no *.log in this sandbox → empty).
			expect(typeof diag.logTails).toBe("object");
			expect(Object.keys(diag.logTails)).toHaveLength(0);
			// And on success the field is absent (byte-for-byte unchanged):
			const appDir2 = makeAppDir();
			const childPid2 = 96003;
			const trayPid2 = 96004;
			const { spawnFn: spawnFn2 } = fakeSpawn(childPid2, trayPid2, { alreadyExited: true });
			let healthCalls = 0;
			const okResult = await runSmoke(
				{ appDir: appDir2, port: 17402, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir2, childPid2, trayPid2, {
					spawn: spawnFn2,
					...failingHooks(appDir2, childPid2, trayPid2, {}),
					probeHealth: async () => {
						healthCalls += 1;
						return { healthy: healthCalls > 1 };
					},
				}),
			);
			rmSync(appDir2, { recursive: true, force: true });
			expect(okResult.ok).toBe(true);
			expect(okResult.diagnostics).toBeUndefined(); // the success JSON is unchanged
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 20_000);

	test("the samples are bounded: at most one per 10 s cadence plus the final sample (≤14 over a 13.5 s run)", async () => {
		const appDir = makeAppDir();
		const childPid = 96005;
		const trayPid = 96006;
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		let result;
		try {
			// A REAL 13.5 s run: the cadence samples at ~1 s / ~11 s
			// (≥ SAMPLE_INTERVAL_MS apart) plus the one forced final sample.
			result = await runSmoke(
				{ appDir, port: 17403, timeoutMs: 13_500, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, failingHooks(appDir, childPid, trayPid, { spawn: spawnFn })),
			);
			expect(result.ok).toBe(false);
			const samples = result.diagnostics.samples;
			expect(samples.length).toBeLessThanOrEqual(14); // the hard cap
			expect(samples.length).toBeGreaterThanOrEqual(3); // 1 s + 11 s + the final sample
			// tMs is monotonically increasing and the CADENCE samples (all but
			// the forced final one) are ≥ 10 s apart (1 s jitter tolerance):
			for (let i = 1; i < samples.length; i += 1) {
				expect(samples[i].tMs).toBeGreaterThan(samples[i - 1].tMs);
			}
			for (let i = 1; i < samples.length - 1; i += 1) {
				expect(samples[i].tMs - samples[i - 1].tMs).toBeGreaterThanOrEqual(SAMPLE_INTERVAL_MS - 1_000);
			}
			expect(SAMPLE_INTERVAL_MS).toBe(10_000);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 20_000);

	test("log tails are truncated to 4096 bytes per file and 16 KiB total; the tail is the LAST bytes", async () => {
		const appDir = makeAppDir();
		const childPid = 96007;
		const trayPid = 96008;
		const secretLogs: string[] = [];
		const spawnFn = (launcher: string, _args: string[], opts: { env: Record<string, string> }) => {
			const pinarHome = opts.env.PINAR_HOME;
			mkdirSync(pinarHome, { recursive: true });
			// Four 10 KiB logs: each tail is the last 4096 bytes and the total
			// of all tails is ≤ 16 KiB.
			for (let i = 0; i < 4; i += 1) {
				const body = `log-${i}-`.repeat(1000) + `END-${i}`;
				secretLogs.push(body);
				writeFileSync(join(pinarHome, `log${i}.log`), body);
			}
			return {
				pid: childPid,
				exitCode: null,
				signalCode: null,
				stdout: null,
				stderr: null,
				on() {},
			};
		};
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17404, timeoutMs: 1_500, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					...failingHooks(appDir, childPid, trayPid, {}),
				}),
			);
			expect(result.ok).toBe(false);
			const tails = result.diagnostics.logTails;
			let total = 0;
			for (const [relPath, text] of Object.entries(tails)) {
				expect(relPath).toMatch(/^\.pinar\/log[0-3]\.log$/);
				const bytes = Buffer.byteLength(text, "utf8");
				expect(bytes).toBeLessThanOrEqual(4_096); // per-file bound
				total += bytes;
				const n = Number(relPath.match(/log(\d)\.log$/)![1]);
				// The tail is the LAST 4096 bytes of the seeded log:
				expect(text).toBe(secretLogs[n].slice(-4_096));
			}
			expect(total).toBeLessThanOrEqual(16_384); // the total bound
			expect(Object.keys(tails).length).toBeGreaterThanOrEqual(1);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 20_000);

	test("a strict parse is applied to .pinar/server.pid (unparseable → null + reason)", async () => {
		const appDir = makeAppDir();
		const childPid = 96009;
		const trayPid = 96010;
		const withServerPid = (content: string) => (launcher: string, _args: string[], opts: { env: Record<string, string> }) => {
			const pinarHome = opts.env.PINAR_HOME;
			mkdirSync(pinarHome, { recursive: true });
			writeFileSync(join(pinarHome, "server.pid"), content);
			return { pid: childPid, exitCode: null, signalCode: null, stdout: null, stderr: null, on() {} };
		};
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17405, timeoutMs: 1_500, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: withServerPid("1e3\n"),
					...failingHooks(appDir, childPid, trayPid, {}),
				}),
			);
			expect(result.diagnostics.serverPid.value).toBeNull();
			expect(result.diagnostics.serverPid.reason).toContain("unparseable");
			result = await runSmoke(
				{ appDir, port: 17406, timeoutMs: 1_500, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: withServerPid("4242\n"),
					...failingHooks(appDir, childPid, trayPid, {}),
				}),
			);
			expect(result.diagnostics.serverPid).toEqual({ value: 4242, reason: null });
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 20_000);

	test("env is never dumped: an inherited secret env var never appears in the diagnostics", async () => {
		const appDir = makeAppDir();
		const childPid = 96011;
		const trayPid = 96012;
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const secret = `smoke-env-secret-${Date.now()}`;
		process.env.__SMOKE_SECRET__ = secret;
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17407, timeoutMs: 1_500, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					...failingHooks(appDir, childPid, trayPid, {}),
				}),
			);
			// The child env inherited the secret (smokeEnv inherits the base
			// env) — the diagnostics must still not contain it: only files
			// from inside the sandbox are captured, never env.
			expect(JSON.stringify(result.diagnostics)).not.toContain(secret);
		} finally {
			delete process.env.__SMOKE_SECRET__;
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 20_000);
});

describe("cleanup identity binding", () => {
	// Healthy startup (fresh tray.pid in the launched tree + health) for the
	// kill/verdict tests below. The pre-launch health probe must be
	// unhealthy (a healthy helper before launch refuses the spawn); the
	// helper comes up only after the (fake) spawn.
	test("a killed pid reused by a different process settles with a cleanup.reused entry", async () => {
		const appDir = makeAppDir();
		const childPid = 93001;
		const trayPid = 93002;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "alive", id: "A" }, // before the signal
				{ state: "alive", id: "A" }, // at the signal (unchanged)
				{ state: "alive", id: "B" }, // after the kill: a different process
			],
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17425, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf,
				}),
			);
			expect(result.ok).toBe(true);
			expect(result.reason).toBeNull();
			expect(result.jsExecuted).toBe(true);
			expect(result.trayPid).toBe(trayPid);
			expect(result.health).toBe(true);
			expect(result.cleanup.ok).toBe(true);
			expect(result.cleanup.killed).toEqual([trayPid]);
			expect(result.cleanup.errors).toEqual([]);
			expect(result.cleanup.reused).toHaveLength(1);
			expect(result.cleanup.reused[0]).toContain(String(trayPid));
			expect(result.cleanup.reused[0]).toContain("not signalled");
			expect(killCalls.filter((pid) => pid === trayPid)).toHaveLength(1);
			expect(killCalls).toEqual([trayPid]); // exactly one killTree call total
			expect(result.cleanup.sandboxRemoved).toBe(true);
			expect(result.sandboxRetained).toBe(false);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a killed pid still alive with the same identity fails the cleanup (owned survivor)", async () => {
		const appDir = makeAppDir();
		const childPid = 93003;
		const trayPid = 93004;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "alive", id: "A" }, // before
				{ state: "alive", id: "A" }, // at the signal
				{ state: "alive", id: "A" }, // after the kill: the SAME process
			],
		});
		try {
			// The 10 s bounded poll really runs (the process never settles).
			const result = await runSmoke(
				{ appDir, port: 17426, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf,
				}),
			);
			expect(result.ok).toBe(false);
			expect(result.cleanup.ok).toBe(false);
			expect(result.cleanup.errors).toEqual([`pid ${trayPid} still alive after cleanup`]);
			expect(result.reason).toMatch(/^cleanup failed: pid \d+ still alive after cleanup/);
			// The startup facts are preserved.
			expect(result.jsExecuted).toBe(true);
			expect(result.trayPid).toBe(trayPid);
			expect(result.health).toBe(true);
			expect(result.cleanup.killed).toEqual([trayPid]);
			expect(result.cleanup.reused).toEqual([]);
			expect(killCalls).toEqual([trayPid]); // one signal, no retry
			expect(result.cleanup.sandboxRemoved).toBe(true); // default removeDir is unchanged
			expect(result.sandboxRetained).toBe(false);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("an owned survivor with a locked sandbox keeps the sandbox (EBUSY) without changing sandbox semantics", async () => {
		const appDir = makeAppDir();
		const childPid = 93005;
		const trayPid = 93006;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [{ state: "alive", id: "A" }], // alive A for every probe
		});
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17427, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf,
					removeDir: (p: string) => {
						const error = new Error(`rmSync: EBUSY: resource busy or locked, rmdir '${p}'`);
						(error as NodeJS.ErrnoException).code = "EBUSY";
						throw error;
					},
				}),
			);
			expect(result.ok).toBe(false);
			expect(result.cleanup.ok).toBe(false);
			expect(result.cleanup.errors.some((entry) => entry.includes("still alive after cleanup"))).toBe(true);
			expect(result.cleanup.errors.some((entry) => entry.includes("EBUSY"))).toBe(true);
			expect(result.sandboxRetained).toBe(true);
			expect(result.sandbox).toBeTruthy();
		} finally {
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("a killed pid that is gone after the poll settles the cleanup", async () => {
		const appDir = makeAppDir();
		const childPid = 93007;
		const trayPid = 93008;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "alive", id: "A" }, // before
				{ state: "alive", id: "A" }, // at the signal
				{ state: "gone" }, // after the kill: the OS proved it is gone
			],
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17428, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf,
				}),
			);
			expect(result.ok).toBe(true);
			expect(result.cleanup.ok).toBe(true);
			expect(result.cleanup.errors).toEqual([]);
			expect(result.cleanup.reused).toEqual([]);
			expect(result.cleanup.killed).toEqual([trayPid]);
			expect(killCalls).toEqual([trayPid]);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a probe that reports gone before the signal refuses the kill", async () => {
		const appDir = makeAppDir();
		const childPid = 93009;
		const trayPid = 93010;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [{ state: "gone" }], // gone already at `before`
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17429, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf,
				}),
			);
			expect(killCalls).toEqual([]);
			expect(result.cleanup.killed).toEqual([]);
			expect(result.cleanup.refused.some((entry) => entry.includes(String(trayPid)) && entry.includes("not alive at cleanup"))).toBe(true);
			expect(result.cleanup.errors).toEqual([]);
			expect(result.cleanup.ok).toBe(true);
			expect(result.ok).toBe(true);
			expect(result.reason).toBeNull();
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("an unknown identity after the kill is never treated as gone", async () => {
		const appDir = makeAppDir();
		const childPid = 93011;
		const trayPid = 93012;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "alive", id: "A" }, // before
				{ state: "alive", id: "A" }, // at the signal
				{ state: "unknown", error: "probe failed" }, // after the kill
			],
		});
		try {
			// The 10 s bounded poll really runs (unknown never settles).
			const result = await runSmoke(
				{ appDir, port: 17430, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf,
				}),
			);
			expect(result.ok).toBe(false);
			expect(result.cleanup.ok).toBe(false);
			expect(result.cleanup.errors).toEqual([`pid ${trayPid} liveness unknown after cleanup: probe failed`]);
			expect(result.cleanup.reused).toEqual([]);
			expect(killCalls).toEqual([trayPid]); // never re-signalled
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("a throwing identity hook becomes unknown and fails the cleanup, never gone", async () => {
		const appDir = makeAppDir();
		const childPid = 93013;
		const trayPid = 93014;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		try {
			const result = await runSmoke(
				{ appDir, port: 17431, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf: async () => {
						throw new Error("identity probe exploded");
					},
				}),
			);
			expect(result.ok).toBe(false);
			expect(result.cleanup.ok).toBe(false);
			// Pre-signal unknown does not block a kill whose ownership was
			// proven; the post-kill unknown then fails the cleanup.
			expect(killCalls).toEqual([trayPid]);
			expect(result.cleanup.killed).toEqual([trayPid]);
			expect(result.cleanup.errors.some((entry) => entry.includes("liveness unknown after cleanup"))).toBe(true);
			expect(result.cleanup.errors.some((entry) => entry.includes("identity probe exploded"))).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("a pre-signal unknown identity with proven ownership is killed; a post-kill alive is an unknown-identity error", async () => {
		const appDir = makeAppDir();
		const childPid = 93015;
		const trayPid = 93016;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "unknown", error: "probe down" }, // before
				{ state: "unknown", error: "probe down" }, // at the signal
				{ state: "alive", id: "X" }, // after the kill
			],
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17432, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf,
				}),
			);
			expect(killCalls).toEqual([trayPid]); // the kill happened
			expect(result.ok).toBe(false);
			expect(result.cleanup.ok).toBe(false);
			expect(result.cleanup.errors).toEqual([
				`pid ${trayPid} is alive after cleanup and its pre-signal identity is unknown; cannot prove the original process exited`,
			]);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("a pre-signal unknown identity with a post-kill gone settles the cleanup", async () => {
		const appDir = makeAppDir();
		const childPid = 93017;
		const trayPid = 93018;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "unknown", error: "probe down" }, // before
				{ state: "unknown", error: "probe down" }, // at the signal
				{ state: "gone" }, // after the kill: a proven gone is accepted
			],
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17433, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf,
				}),
			);
			expect(killCalls).toEqual([trayPid]);
			expect(result.ok).toBe(true);
			expect(result.cleanup.ok).toBe(true);
			expect(result.cleanup.errors).toEqual([]);
			expect(result.cleanup.reused).toEqual([]);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("an identity change between the ownership check and the signal is refused without a signal", async () => {
		const appDir = makeAppDir();
		const childPid = 93019;
		const trayPid = 93020;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "alive", id: "A" }, // before
				{ state: "alive", id: "B" }, // at the signal: a different process
			],
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17434, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf,
				}),
			);
			expect(killCalls).toEqual([]); // killTree NOT called for that PID
			expect(result.cleanup.killed).toEqual([]);
			expect(result.cleanup.refused.some((entry) => entry.includes(String(trayPid)) && entry.includes("identity changed"))).toBe(true);
			expect(result.cleanup.refused.some((entry) => entry.includes("A -> B"))).toBe(true);
			expect(result.cleanup.errors).toEqual([]);
			expect(result.ok).toBe(true);
			expect(result.reason).toBeNull();
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a process that dies late in the bounded poll settles (late death is credited)", async () => {
		const appDir = makeAppDir();
		const childPid = 93021;
		const trayPid = 93022;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "alive", id: "A" }, // before
				{ state: "alive", id: "A" }, // at the signal
				{ state: "alive", id: "A" }, // post-kill probe 1: still there
				{ state: "alive", id: "A" }, // post-kill probe 2: still there
				{ state: "alive", id: "A" }, // post-kill probe 3: still there
				{ state: "gone" }, // post-kill probe 4: late death
			],
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17435, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf,
				}),
			);
			expect(result.ok).toBe(true);
			expect(result.cleanup.ok).toBe(true);
			expect(result.cleanup.errors).toEqual([]);
			expect(result.cleanup.reused).toEqual([]);
			expect(killCalls).toEqual([trayPid]);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 30_000);

	test("a pid that becomes a different process late in the poll settles with a reused entry", async () => {
		const appDir = makeAppDir();
		const childPid = 93023;
		const trayPid = 93024;
		const killCalls: number[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "alive", id: "A" }, // before
				{ state: "alive", id: "A" }, // at the signal
				{ state: "alive", id: "A" }, // post-kill probe 1: still there
				{ state: "alive", id: "A" }, // post-kill probe 2: still there
				{ state: "alive", id: "B" }, // post-kill probe 3: a different process
			],
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17436, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					identityOf,
				}),
			);
			expect(result.ok).toBe(true);
			expect(result.cleanup.ok).toBe(true);
			expect(result.cleanup.errors).toEqual([]);
			expect(result.cleanup.reused).toHaveLength(1);
			expect(result.cleanup.reused[0]).toContain(String(trayPid));
			expect(killCalls).toEqual([trayPid]); // the reused process is not signalled
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 30_000);

	test("tryKill passes the bound pre-signal identity to killTree and records a reused outcome (0 signals)", async () => {
		const appDir = makeAppDir();
		const childPid = 93041;
		const trayPid = 93042;
		const seen: { pid: number; ctx: { boundId: string | null } }[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "alive", id: "A" }, // before
				{ state: "alive", id: "A" }, // at the signal → bound
			],
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17437, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					identityOf,
					killTree: async (pid: number, ctx: { boundId: string | null }) => {
						seen.push({ pid, ctx });
						return { state: "reused", signals: [], esrch: [], errors: [], detail: "bound A, now B" };
					},
				}),
			);
			// The boundId is the pre-signal identity bound by tryKill.
			expect(seen).toEqual([{ pid: trayPid, ctx: { boundId: "A" } }]);
			expect(result.cleanup.killed).toEqual([]); // 0 signals → not a killed pid
			expect(result.cleanup.reused).toHaveLength(1);
			expect(result.cleanup.reused[0]).toContain(`killTree(tray.pid pid ${trayPid})`);
			expect(result.cleanup.reused[0]).toContain("not signalled");
			expect(result.cleanup.errors).toEqual([]);
			expect(result.cleanup.ok).toBe(true);
			expect(result.ok).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("an unknown killTree outcome with signals sent records an error and RETAINS the sandbox", async () => {
		const appDir = makeAppDir();
		const childPid = 93043;
		const trayPid = 93044;
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [{ state: "alive", id: "A" }], // alive A for every probe
		});
		let result;
		try {
			// The 10 s bounded poll really runs: a signalled pid whose verdict
			// stays alive-with-the-same-id never settles.
			result = await runSmoke(
				{ appDir, port: 17438, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					identityOf,
					killTree: async () => ({
						state: "unknown",
						signals: [[-trayPid, "SIGTERM"], [trayPid, "SIGTERM"]],
						esrch: [],
						errors: [],
						detail: "identity probe threw: ps exploded",
					}),
				}),
			);
			expect(result.cleanup.killed).toEqual([trayPid]); // 2 signals were sent
			expect(
				result.cleanup.errors.some((entry) =>
					entry.includes(`killTree(tray.pid pid ${trayPid}) incomplete: identity unknown, no further signals sent: identity probe threw: ps exploded`),
				),
			).toBe(true);
			expect(result.cleanup.errors.some((entry) => entry.includes("still alive after cleanup"))).toBe(true);
			expect(result.sandboxRetained).toBe(true);
			expect(result.sandbox).toBeTruthy();
			expect(result.cleanup.ok).toBe(false);
			expect(result.ok).toBe(false);
		} finally {
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("an unknown killTree outcome with NO signal sent records an error, kills nothing and removes the sandbox", async () => {
		const appDir = makeAppDir();
		const childPid = 93045;
		const trayPid = 93046;
		const seen: { boundId: string | null }[] = [];
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "unknown", error: "probe down" }, // before → boundId null
				{ state: "unknown", error: "probe down" }, // at the signal
			],
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17439, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					identityOf,
					killTree: async (_pid: number, ctx: { boundId: string | null }) => {
						seen.push(ctx);
						return { state: "unknown", signals: [], esrch: [], errors: [], detail: "boundId null; refused" };
					},
				}),
			);
			expect(seen).toEqual([{ boundId: null }]); // pre-signal identity was unknown
			expect(result.cleanup.killed).toEqual([]);
			expect(result.cleanup.errors).toEqual([
				`killTree(tray.pid pid ${trayPid}) incomplete: identity unknown, no further signals sent: boundId null; refused`,
			]);
			expect(result.cleanup.reused).toEqual([]);
			expect(result.cleanup.sandboxRemoved).toBe(true); // no signalled process → no retention
			expect(result.sandboxRetained).toBe(false);
			expect(result.cleanup.ok).toBe(false);
			expect(result.ok).toBe(false);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a non-zero taskkill status in the outcome is recorded as an incomplete killTree error", async () => {
		const appDir = makeAppDir();
		const childPid = 93047;
		const trayPid = 93048;
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "alive", id: "A" }, // before
				{ state: "alive", id: "A" }, // at the signal
				{ state: "gone" }, // post-kill verdict: the OS proved it is gone
			],
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17440, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					identityOf,
					killTree: async () => ({
						// Legacy injected hook: it reports the status without the
						// new `failed` state (kept for the status-capture consumer).
						state: "signalled",
						signals: [`taskkill /PID ${trayPid} /T /F`],
						esrch: [],
						errors: [],
						taskkillStatus: 128,
					}),
				}),
			);
			expect(result.cleanup.killed).toEqual([trayPid]); // the taskkill was attempted
			expect(result.cleanup.errors).toEqual([
				`killTree(tray.pid pid ${trayPid}) incomplete: taskkill exited 128`,
			]);
			expect(result.cleanup.reused).toEqual([]);
			expect(result.cleanup.sandboxRemoved).toBe(true);
			expect(result.sandboxRetained).toBe(false);
			expect(result.cleanup.ok).toBe(false);
			expect(result.ok).toBe(false);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	// SM-1: a `failed` taskkill outcome (non-zero / timeout / spawn fault /
	// malformed error) is NEVER counted as killed — the precise error text
	// is the cleanup error and cleanup.ok is false.
	test("SM-1: a failed taskkill outcome is never counted as killed and fails the cleanup", async () => {
		const appDir = makeAppDir();
		const childPid = 93049;
		const trayPid = 93050;
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "alive", id: "A" }, // before
				{ state: "alive", id: "A" }, // at the signal
				// The failed taskkill leaves the process possibly alive: the
				// post-kill verdict sees it alive with the bound id — the
				// failure is the taskkill's, reported exactly once.
				{ state: "alive", id: "A" },
			],
		});
		try {
			const result = await runSmoke(
				{ appDir, port: 17440, timeoutMs: 2_000, log: null, keepHome: false },
				healthyHooks(appDir, childPid, trayPid, {
					spawn: spawnFn,
					identityOf,
					killTree: async () => ({
						state: "failed",
						signals: [],
						esrch: [],
						errors: ["exited 128"],
						taskkillStatus: 128,
					}),
				}),
			);
			expect(result.cleanup.killed).toEqual([]); // a failed taskkill never counts as killed
			// The precise failure text is the killTree's own (exactly once);
			// the un-signalled pid never joins the post-kill verdict (nothing
			// was signalled), so no "still alive" error is appended.
			expect(result.cleanup.errors).toEqual([
				`killTree(tray.pid pid ${trayPid}) incomplete: exited 128`,
			]);
			expect(result.cleanup.ok).toBe(false);
			expect(result.ok).toBe(false);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});
});

describe("killTreeFor POSIX signal sequence", () => {
	// The REAL factory with an injected kill (records [pid, signal] for every
	// signal actually attempted), an injected sleep (no real wait) and a
	// scripted identity probe: the recorded calls are the ACTUAL signal list,
	// so every case asserts the exact list (no extra signals).
	type Probe = IdentityState | "throw";
	const scripted = (states: Probe[]) => {
		let next = 0;
		return async () => {
			const state = states[Math.min(next, states.length - 1)];
			next += 1;
			if (state === "throw") throw new Error("identity probe exploded");
			return state;
		};
	};
	const run = (
		platform: "linux" | "darwin",
		states: Probe[],
		boundId: string | null,
		killSideEffect: (pid: number, signal: string) => void = () => {},
		pgidOf: ((pid: number) => Promise<number | null>) | null = null,
	) => {
		const calls: [number, string][] = [];
		const killTree = killTreeFor(platform, {
			kill: (pid: number, signal: string) => {
				killSideEffect(pid, signal);
				calls.push([pid, signal]);
			},
			sleep: async () => {},
			identityOf: scripted(states),
			// SM-2 leader gate: default is the proven leader (pgid === pid),
			// so the pre-SM-2 group-signal expectations hold; the refusal
			// cases below inject a non-leader / unknown / throwing probe.
			pgidOf: pgidOf ?? (async (pid) => pid),
		});
		return killTree(4242, { boundId }).then((outcome) => ({ calls, outcome }));
	};
	const onPosix = (name: string, fn: (platform: "linux" | "darwin") => Promise<void>) => {
		for (const platform of ["linux", "darwin"] as const) {
			test(`${name} [${platform}]`, () => fn(platform));
		}
	};

	onPosix("death after group TERM: the group TERM is the only call of that step, no KILL, outcome gone", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 (SIGTERM): still ours
				{ state: "gone" }, // step 2 (SIGKILL): the OS proved it is gone
			],
			"A",
		);
		expect(calls).toEqual([[-4242, "SIGTERM"]]);
		expect(calls.every(([target]) => target === -4242)).toBe(true); // group only
		expect(outcome.state).toBe("gone");
		expect(outcome.detail).toBe("signals already sent; pid gone before the SIGKILL step");
		expect(outcome.errors).toEqual([]);
	});

	onPosix("same-identity survivor: group TERM then group KILL then gone after SIGKILL", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 (SIGTERM)
				{ state: "alive", id: "A" }, // step 2 (SIGKILL)
				{ state: "gone" }, // final probe after SIGKILL
			],
			"A",
		);
		expect(calls).toEqual([
			[-4242, "SIGTERM"],
			[-4242, "SIGKILL"],
		]);
		expect(outcome.state).toBe("gone");
		expect(outcome.groupSignalled).toBe(true);
	});

	onPosix("same-identity survivor: group TERM then group KILL then still alive classifies survivor", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 (SIGTERM)
				{ state: "alive", id: "A" }, // step 2 (SIGKILL)
				{ state: "alive", id: "A" }, // final probe: still alive with the bound id
			],
			"A",
		);
		expect(calls).toEqual([
			[-4242, "SIGTERM"],
			[-4242, "SIGKILL"],
		]);
		expect(outcome.state).toBe("survivor");
	});

	onPosix("reused before TERM: 0 signals, outcome reused", async (platform) => {
		const { calls, outcome } = await run(platform, [{ state: "alive", id: "B" }], "A");
		expect(calls).toEqual([]);
		expect(outcome.state).toBe("reused");
	});

	onPosix("gone before TERM: 0 signals, outcome gone", async (platform) => {
		const { calls, outcome } = await run(platform, [{ state: "gone" }], "A");
		expect(calls).toEqual([]);
		expect(outcome.state).toBe("gone");
	});

	onPosix(
		"the PID was recycled right after the group TERM: only the group TERM was sent, no further call, outcome reused",
		async (platform) => {
			const { calls, outcome } = await run(
				platform,
				[
					{ state: "alive", id: "A" }, // step 1: group TERM delivered
					{ state: "alive", id: "B" }, // step 2: the PID was recycled
				],
				"A",
			);
			expect(calls).toEqual([[-4242, "SIGTERM"]]);
			expect(calls.every(([target]) => target === -4242)).toBe(true); // no bare call was ever made
			expect(outcome.state).toBe("reused");
			expect(outcome.detail).toBe("refused further signals; pid now owned by id B (bound A)");
		},
	);

	onPosix("reuse after group KILL: no further call", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 (SIGTERM)
				{ state: "alive", id: "A" }, // step 2 (SIGKILL)
				{ state: "alive", id: "B" }, // final probe: the PID was recycled
			],
			"A",
		);
		expect(calls).toEqual([
			[-4242, "SIGTERM"],
			[-4242, "SIGKILL"],
		]);
		expect(calls.every(([target]) => target === -4242)).toBe(true);
		expect(outcome.state).toBe("reused");
		expect(outcome.detail).toBe("refused further signals; pid now owned by id B (bound A)");
	});

	onPosix("unknown before TERM: 0 signals, outcome unknown", async (platform) => {
		const { calls, outcome } = await run(platform, [{ state: "unknown", error: "probe failed" }], "A");
		expect(calls).toEqual([]);
		expect(outcome.state).toBe("unknown");
	});

	onPosix("unknown after the group TERM: no KILL, outcome unknown", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1
				{ state: "unknown", error: "probe failed" }, // step 2: indecisive
			],
			"A",
		);
		expect(calls).toEqual([[-4242, "SIGTERM"]]);
		expect(outcome.state).toBe("unknown");
		expect(outcome.detail).toBe("signals already sent; probe failed");
	});

	onPosix("a throwing probe is unknown: 0 signals, outcome unknown", async (platform) => {
		const { calls, outcome } = await run(platform, ["throw"], "A");
		expect(calls).toEqual([]);
		expect(outcome.state).toBe("unknown");
		expect(outcome.detail).toContain("identity probe threw");
	});

	onPosix("boundId null: 0 signals even when the probe says alive, outcome unknown", async (platform) => {
		const { calls, outcome } = await run(platform, [{ state: "alive", id: "A" }], null);
		expect(calls).toEqual([]);
		expect(outcome.state).toBe("unknown");
	});

	onPosix(
		"group ESRCH: the re-prove still the bound id → the bare pid fallback is signalled (ESRCH recorded, not a failure)",
		async (platform) => {
			const { calls, outcome } = await run(
				platform,
				[
					{ state: "alive", id: "A" }, // step 1 probe
					{ state: "alive", id: "A" }, // re-probe after the group ESRCH → bare TERM
					{ state: "alive", id: "A" }, // step 2 probe
					{ state: "alive", id: "A" }, // re-probe after the group ESRCH → bare KILL
					{ state: "gone" }, // final probe
				],
				"A",
				(pid, signal) => {
					if (pid === -4242) {
						const error = new Error(`kill ${signal} failed: ESRCH: no such process`);
						(error as NodeJS.ErrnoException).code = "ESRCH";
						throw error;
					}
				},
			);
			// The group call was never delivered, so the re-proved bare pid was
			// signalled in both steps; the ESRCHs never failed them.
			expect(calls).toEqual([
				[4242, "SIGTERM"],
				[4242, "SIGKILL"],
			]);
			expect(outcome.state).toBe("gone");
			expect(outcome.errors).toEqual([]);
			expect(outcome.esrch).toHaveLength(2);
			expect(outcome.signals).toEqual(calls); // only DELIVERED signals count as sent
			expect(outcome.groupSignalled).toBe(false);
		},
	);

	onPosix("group ESRCH: the re-probe says reused → no bare call", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 probe
				{ state: "alive", id: "B" }, // re-probe after the group ESRCH
			],
			"A",
			(pid) => {
				if (pid === -4242) {
					const error = new Error("kill SIGTERM failed: ESRCH: no such process");
					(error as NodeJS.ErrnoException).code = "ESRCH";
					throw error;
				}
			},
		);
		expect(calls).toEqual([]);
		expect(outcome.signals).toEqual([]); // the ESRCH'd group attempt was never delivered
		expect(outcome.state).toBe("reused");
		expect(outcome.esrch).toHaveLength(1);
	});

	onPosix("group ESRCH: the re-probe says gone → no bare call", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 probe
				{ state: "gone" }, // re-probe after the group ESRCH
			],
			"A",
			() => {
				const error = new Error("kill SIGTERM failed: ESRCH: no such process");
				(error as NodeJS.ErrnoException).code = "ESRCH";
				throw error;
			},
		);
		expect(calls).toEqual([]);
		expect(outcome.signals).toEqual([]); // the ESRCH'd group attempt was never delivered
		expect(outcome.state).toBe("gone");
		expect(outcome.esrch).toHaveLength(1);
	});

	onPosix("group ESRCH: the re-probe is unknown → no bare call, outcome unknown", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 probe
				{ state: "unknown", error: "probe failed" }, // re-probe after the group ESRCH
			],
			"A",
			(pid) => {
				if (pid === -4242) {
					const error = new Error("kill SIGTERM failed: ESRCH: no such process");
					(error as NodeJS.ErrnoException).code = "ESRCH";
					throw error;
				}
			},
		);
		expect(calls).toEqual([]);
		expect(outcome.signals).toEqual([]); // the ESRCH'd group attempt was never delivered
		expect(outcome.state).toBe("unknown");
	});

	onPosix("a non-ESRCH group error is recorded; the re-proved bare pid fallback is still signalled", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 probe (group TERM delivered)
				{ state: "alive", id: "A" }, // step 2 probe (group KILL EPERM)
				{ state: "alive", id: "A" }, // re-probe after the group error → bare KILL
				{ state: "gone" }, // final probe
			],
			"A",
			(pid, signal) => {
				if (pid === -4242 && signal === "SIGKILL") {
					const error = new Error("kill SIGKILL failed: operation not permitted");
					(error as NodeJS.ErrnoException).code = "EPERM";
					throw error;
				}
			},
		);
		expect(calls).toEqual([
			[-4242, "SIGTERM"],
			[4242, "SIGKILL"],
		]);
		expect(outcome.state).toBe("gone");
		expect(outcome.errors).toEqual(["kill(-4242, SIGKILL) failed: EPERM: kill SIGKILL failed: operation not permitted"]);
	});

	// SM-2 leader gate: a group signal goes out ONLY when `ps -o pgid=`
	// proves the bound pid is its own process-group leader (pgid === pid).
	// Unknown, a different pgid, or a probe failure → NO group signal:
	// the bare pid is signalled (the identity was re-proved at the step
	// start) and outcome.groupRefused records the reason.
	onPosix("SM-2: a non-leader pgid refuses the group signal; the bare pid is signalled and groupRefused is recorded", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 probe (leader refused → bare TERM)
				{ state: "alive", id: "A" }, // step 2 probe (leader refused → bare KILL)
				{ state: "gone" }, // final probe
			],
			"A",
			() => {},
			async () => 7777, // a DIFFERENT pgid: the pid is not its own leader
		);
		expect(calls).toEqual([
			[4242, "SIGTERM"],
			[4242, "SIGKILL"],
		]);
		expect(calls.every(([target]) => target === 4242)).toBe(true); // no group call ever
		expect(outcome.state).toBe("gone");
		expect(outcome.groupSignalled).toBe(false);
		expect(outcome.groupRefused).toBe("pid 4242 is not a process-group leader (pgid 7777); group signal refused");
		expect(outcome.signals).toEqual(calls); // only DELIVERED signals count
	});

	onPosix("SM-2: an unknown pgid (null probe) refuses the group signal (fail closed)", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 probe (leader unknown → bare TERM)
				{ state: "gone" }, // step 2: the bare TERM took it
			],
			"A",
			() => {},
			async () => null, // the pgid probe could not decide
		);
		expect(calls).toEqual([[4242, "SIGTERM"]]);
		expect(outcome.state).toBe("gone");
		expect(outcome.groupSignalled).toBe(false);
		expect(outcome.groupRefused).toBe("process-group leader could not be proven for pid 4242; group signal refused");
	});

	onPosix("SM-2: a throwing pgid probe refuses the group signal (fail closed, the fault is named)", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 probe (leader probe threw → bare TERM)
				{ state: "gone" }, // step 2: the bare TERM took it
			],
			"A",
			() => {},
			async () => {
				throw new Error("ps pgid failed: ENOENT");
			},
		);
		expect(calls).toEqual([[4242, "SIGTERM"]]);
		expect(outcome.state).toBe("gone");
		expect(outcome.groupSignalled).toBe(false);
		expect(outcome.groupRefused).toContain("process-group leader could not be proven for pid 4242");
		expect(outcome.groupRefused).toContain("ps pgid failed: ENOENT");
	});

	onPosix("SM-2: a proven leader (pgid === pid) keeps the group signal; groupRefused stays null", async (platform) => {
		const { calls, outcome } = await run(
			platform,
			[
				{ state: "alive", id: "A" }, // step 1 probe (leader proven → group TERM)
				{ state: "gone" }, // step 2: the group TERM took it
			],
			"A",
			() => {},
			async (pid) => pid, // proven leader
		);
		expect(calls).toEqual([[-4242, "SIGTERM"]]);
		expect(outcome.state).toBe("gone");
		expect(outcome.groupSignalled).toBe(true);
		expect(outcome.groupRefused).toBeNull();
	});

	// S2's "unknown stops" rule applies to the win32 branch too (review
	// rv-fin-sec F3): the bound identity is re-proved IMMEDIATELY before the
	// taskkill; a null bound, or a fresh probe that is not alive with that
	// id, refuses the taskkill (fail closed). The status-capture behavior is
	// unchanged for the matching-alive-id case.
	const win32Identity = (id: string) => async () => ({ state: "alive", id });

	// SM-1: the taskkill string is DELIVERED (counted in `signals`) only when
	// the run returned status 0 with no error and no signal; every other
	// outcome is state `failed` with a precise error and the status kept.
	test("SM-1: exactly one taskkill call; a non-zero status is a failed outcome with the precise error, never thrown", async () => {
		const taskkillCalls: number[] = [];
		const killTree = killTreeFor("win32", {
			sleep: async () => {},
			identityOf: win32Identity("133850432100000000"),
			runTaskkill: async (pid: number) => {
				taskkillCalls.push(pid);
				return 128;
			},
		});
		const outcome = await killTree(5151, { boundId: "133850432100000000" });
		expect(taskkillCalls).toEqual([5151]); // exactly one taskkill
		expect(outcome.state).toBe("failed");
		expect(outcome.taskkillStatus).toBe(128);
		expect(outcome.signals).toEqual([]); // not delivered
		expect(outcome.errors).toEqual(["exited 128"]);
	});

	test("SM-1: a zero status is a clean kill (delivered); a taskkill spawn error is a failed outcome", async () => {
		const ok = await killTreeFor("win32", {
			sleep: async () => {},
			identityOf: win32Identity("133850432100000000"),
			runTaskkill: async () => ({ status: 0 }),
		})(777, { boundId: "133850432100000000" });
		expect(ok.state).toBe("signalled");
		expect(ok.taskkillStatus).toBe(0);
		expect(ok.signals).toEqual([`taskkill /PID 777 /T /F`]);
		expect(ok.errors).toEqual([]);
		const broken = await killTreeFor("win32", {
			sleep: async () => {},
			identityOf: win32Identity("133850432100000000"),
			runTaskkill: async () => ({ status: null, error: "taskkill spawn failed: ENOENT" }),
		})(777, { boundId: "133850432100000000" });
		expect(broken.state).toBe("failed");
		expect(broken.taskkillStatus).toBeNull();
		expect(broken.signals).toEqual([]);
		expect(broken.errors).toEqual(["spawn failed: taskkill spawn failed: ENOENT"]);
	});

	test("SM-1: a timed-out taskkill (signal set, or ERR_CHILD_PROCESS_TIMEOUT) is a failed timeout outcome", async () => {
		const bySignal = await killTreeFor("win32", {
			sleep: async () => {},
			identityOf: win32Identity("133850432100000000"),
			// spawnSync's timeout kill: status null, signal "SIGTERM".
			runTaskkill: async () => ({ status: null, signal: "SIGTERM", error: null }),
		})(777, { boundId: "133850432100000000" });
		expect(bySignal.state).toBe("failed");
		expect(bySignal.signals).toEqual([]);
		expect(bySignal.errors).toEqual([`timed out after ${TASKKILL_TIMEOUT_MS}ms`]);
		expect(TASKKILL_TIMEOUT_MS).toBe(8_000); // the SAME value as teardownChild's default

		const byCode = await killTreeFor("win32", {
			sleep: async () => {},
			identityOf: win32Identity("133850432100000000"),
			runTaskkill: async () => ({
				status: null,
				signal: null,
				error: Object.assign(new Error("spawnSync taskkill ETIMEDOUT"), { code: "ERR_CHILD_PROCESS_TIMEOUT" }),
			}),
		})(777, { boundId: "133850432100000000" });
		expect(byCode.state).toBe("failed");
		expect(byCode.errors).toEqual([`timed out after ${TASKKILL_TIMEOUT_MS}ms`]);

		const byMessage = await killTreeFor("win32", {
			sleep: async () => {},
			identityOf: win32Identity("133850432100000000"),
			runTaskkill: async () => {
				throw Object.assign(new Error("taskkill ETIMEDOUT after 8000ms"), { code: "ETIMEDOUT" });
			},
		})(777, { boundId: "133850432100000000" });
		expect(byMessage.state).toBe("failed");
		expect(byMessage.errors).toEqual([`timed out after ${TASKKILL_TIMEOUT_MS}ms`]);
	});

	test("SM-1: a malformed runner error (neither an Error with a message nor a non-empty string) fails closed", async () => {
		for (const malformed of [42, true, 0, {}, []]) {
			const outcome = await killTreeFor("win32", {
				sleep: async () => {},
				identityOf: win32Identity("133850432100000000"),
				runTaskkill: async () => ({ status: null, error: malformed }),
			})(777, { boundId: "133850432100000000" });
			expect(outcome.state).toBe("failed");
			expect(outcome.signals).toEqual([]);
			expect(outcome.errors[0]).toContain("malformed runner error (");
		}
	});

	test("SM-1: a missing or non-integer status is a failed `no exit status` outcome", async () => {
		const missing = await killTreeFor("win32", {
			sleep: async () => {},
			identityOf: win32Identity("133850432100000000"),
			runTaskkill: async () => ({}),
		})(777, { boundId: "133850432100000000" });
		expect(missing.state).toBe("failed");
		expect(missing.taskkillStatus).toBeNull();
		expect(missing.errors).toEqual(["no exit status"]);
		const nonInteger = await killTreeFor("win32", {
			sleep: async () => {},
			identityOf: win32Identity("133850432100000000"),
			runTaskkill: async () => ({ status: 1.5 }),
		})(777, { boundId: "133850432100000000" });
		expect(nonInteger.state).toBe("failed");
		expect(nonInteger.taskkillStatus).toBeNull(); // a non-integer status is no exit status
		expect(nonInteger.errors).toEqual(["no exit status"]);
	});

	test("win32: a null bound identity refuses the taskkill (fail closed, no signal)", async () => {
		const taskkillCalls: number[] = [];
		const killTree = killTreeFor("win32", {
			sleep: async () => {},
			identityOf: win32Identity("133850432100000000"),
			runTaskkill: async (pid: number) => {
				taskkillCalls.push(pid);
				return 0;
			},
		});
		const outcome = await killTree(5151, { boundId: null });
		expect(taskkillCalls).toEqual([]); // no taskkill at all
		expect(outcome.state).toBe("unknown");
		expect(outcome.signals).toEqual([]);
		expect(outcome.detail).toContain("boundId null");
		expect(outcome.errors).toEqual([]);
	});

	test("win32: a fresh unknown probe refuses the taskkill (fail closed, no signal)", async () => {
		const taskkillCalls: number[] = [];
		const killTree = killTreeFor("win32", {
			sleep: async () => {},
			identityOf: async () => ({ state: "unknown", error: "CIM provider unavailable" }),
			runTaskkill: async (pid: number) => {
				taskkillCalls.push(pid);
				return 0;
			},
		});
		const outcome = await killTree(5151, { boundId: "133850432100000000" });
		expect(taskkillCalls).toEqual([]);
		expect(outcome.state).toBe("unknown");
		expect(outcome.signals).toEqual([]);
		expect(outcome.detail).toBe("CIM provider unavailable");
	});

	test("win32: a fresh probe with a different id refuses (reused, no signal)", async () => {
		const taskkillCalls: number[] = [];
		const killTree = killTreeFor("win32", {
			sleep: async () => {},
			identityOf: win32Identity("999999999999999999"),
			runTaskkill: async (pid: number) => {
				taskkillCalls.push(pid);
				return 0;
			},
		});
		const outcome = await killTree(5151, { boundId: "133850432100000000" });
		expect(taskkillCalls).toEqual([]);
		expect(outcome.state).toBe("reused");
		expect(outcome.signals).toEqual([]);
		expect(outcome.detail).toContain("999999999999999999");
	});

	test("win32: a fresh gone probe stops before the taskkill (no signal)", async () => {
		const taskkillCalls: number[] = [];
		const killTree = killTreeFor("win32", {
			sleep: async () => {},
			identityOf: async () => ({ state: "gone" }),
			runTaskkill: async (pid: number) => {
				taskkillCalls.push(pid);
				return 0;
			},
		});
		const outcome = await killTree(5151, { boundId: "133850432100000000" });
		expect(taskkillCalls).toEqual([]);
		expect(outcome.state).toBe("gone");
		expect(outcome.signals).toEqual([]);
	});
});

describe("probeResidueKeepsSandbox (unreaped probe residue)", () => {
	// A timed-out probe whose child was not reaped is residue (review
	// rv-fin-sec F1): the smoke reports it in cleanup.errors and retains
	// the sandbox instead of removing it silently.
	const makeCleanup = () => ({ ok: false, killed: [] as number[], refused: [] as string[], errors: [] as string[], reused: [] as string[], sandboxRemoved: false });

	test("no residue: the sandbox may be removed", () => {
		const cleanup = makeCleanup();
		expect(probeResidueKeepsSandbox([], cleanup)).toBe(false);
		expect(cleanup.errors).toEqual([]);
	});

	test("residue: the sandbox is kept and every entry is reported", () => {
		const cleanup = makeCleanup();
		expect(probeResidueKeepsSandbox([{ kind: "identity", pid: 77 }, { kind: "image", pid: 78 }], cleanup)).toBe(true);
		expect(cleanup.errors).toEqual([
			"probe residue: the identity probe for pid 77 hit its deadline and its child was not reaped (it may still be running); the sandbox is retained",
			"probe residue: the image probe for pid 78 hit its deadline and its child was not reaped (it may still be running); the sandbox is retained",
		]);
	});
});

describe("psScript (deterministic seams — review rv-fin-sec F1)", () => {
	// The probe .ps1 path: the FIXED `<SystemRoot>\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` (no
	// spawnSync discovery), and on the 20 s deadline a HELD-handle kill
	// (`child.kill()` — never `taskkill /PID` / `process.kill(pid)`), then a
	// wait for the REAL close up to the 2 s probe kill-wait value, then
	// ALWAYS a settlement (unreaped: true when no close was observed). The
	// fake child's pid never exists on this host, so even a restored
	// numeric-PID kill would be a no-op here — the held-handle killCalls and
	// the settlement shape are what catch it.
	const makeTimers = () => {
		const timers = new Map<number, { id: number; delay: number; fn: () => void; cleared: boolean }>();
		let next = 1;
		return {
			setTimeout: (fn: () => void, delay: number) => {
				const id = next++;
				timers.set(id, { id, delay, fn, cleared: false });
				return id;
			},
			clearTimeout: (id: unknown) => {
				const t = timers.get(id as number);
				if (t) t.cleared = true;
			},
			pending: () => [...timers.values()].filter((t) => !t.cleared).map((t) => t.delay),
			fire: (delay: number) => {
				for (const t of [...timers.values()]) {
					if (!t.cleared && t.delay === delay) {
						// A fired timer is no longer pending (runtime semantics)
						// — even if its callback settles synchronously.
						t.cleared = true;
						t.fn();
					}
				}
			},
		};
	};
	const makeChild = (pid: number) => {
		const child = new EventEmitter() as EventEmitter & { pid: number; stdout: EventEmitter; stderr: EventEmitter; kill: () => boolean };
		const stdout = new EventEmitter();
		const stderr = new EventEmitter();
		const killCalls: string[] = [];
		child.pid = pid;
		child.stdout = stdout;
		child.stderr = stderr;
		child.kill = () => {
			killCalls.push("held-handle");
			return true;
		};
		return { child, stdout, stderr, killCalls };
	};
	const flushMicrotasks = async () => {
		for (let i = 0; i < 5; i += 1) await Promise.resolve();
	};
	type Handles = {
		promise: Promise<unknown>;
		spawnCalls: [string, string[]][];
		spawnSyncCalls: unknown[][];
		processKillCalls: [unknown, unknown][];
		restore: () => void;
	};
	const start = (child: ReturnType<typeof makeChild>["child"], t: ReturnType<typeof makeTimers>): Handles => {
		const spawnCalls: [string, string[]][] = [];
		const spawnSyncCalls: unknown[][] = [];
		const processKillCalls: [unknown, unknown][] = [];
		const realKill = process.kill;
		process.kill = ((pid: unknown, signal?: unknown) => {
			processKillCalls.push([pid, signal]);
			return true;
		}) as typeof process.kill;
		const promise = psScript("/tmp/identity-4242.ps1", ["4242"], 20_000, {
			spawn: (exe: string, args: string[]) => {
				spawnCalls.push([exe, args]);
				return child;
			},
			spawnSync: (...a: unknown[]) => {
				spawnSyncCalls.push(a);
				return { error: null, status: 1 };
			},
			setTimeout: t.setTimeout,
			clearTimeout: t.clearTimeout,
		});
		return {
			promise,
			spawnCalls,
			spawnSyncCalls,
			processKillCalls,
			restore: () => {
				process.kill = realKill;
			},
		};
	};

	test("spawns the FIXED System32 PowerShell with -NoProfile -File; no spawnSync on the path", async () => {
		const t = makeTimers();
		const { child } = makeChild(4242);
		const h = start(child, t);
		try {
			child.emit("close", 0);
			await h.promise;
			const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? "C:\\Windows";
			expect(h.spawnCalls).toEqual([
				[join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-File", "/tmp/identity-4242.ps1", "4242"]],
			]);
			expect(h.spawnSyncCalls).toEqual([]); // no discovery, no taskkill
			expect(h.processKillCalls).toEqual([]);
		} finally {
			h.restore();
		}
	});

	test("a close before the deadline settles the normal shape and clears the deadline timer", async () => {
		const t = makeTimers();
		const { child, stdout } = makeChild(4242);
		const h = start(child, t);
		try {
			stdout.emit("data", "133850432100000000\n");
			child.emit("close", 0);
			const out = (await h.promise) as { ok: boolean; stdout: string; stderr: string; code: number | null };
			expect(out).toEqual({ ok: true, stdout: "133850432100000000\n", stderr: "", code: 0 });
			expect(t.pending()).toEqual([]);
			expect(h.spawnSyncCalls).toEqual([]);
		} finally {
			h.restore();
		}
	});

	test("deadline: the held handle is killed exactly once (never taskkill /PID or process.kill), and the real close settles timedOut with unreaped false", async () => {
		const t = makeTimers();
		const { child, killCalls } = makeChild(987654321);
		const h = start(child, t);
		let settleCount = 0;
		let settled: unknown = null;
		h.promise.then((r) => {
			settleCount += 1;
			settled = r;
		});
		try {
			t.fire(20_000); // the 20 s deadline
			expect(killCalls.length).toBe(1); // the held-handle kill
			expect(h.processKillCalls).toEqual([]); // never process.kill(pid, …)
			expect(h.spawnSyncCalls).toEqual([]); // never taskkill /PID <pid>
			child.emit("close", 1); // the real close after the kill
			await flushMicrotasks();
			expect(settleCount).toBe(1);
			expect(settled).toEqual({ ok: false, stdout: "", stderr: "", code: null, timedOut: true, unreaped: false });
			expect(t.pending()).toEqual([]); // the close-wait timer was cleared
			expect(child.listenerCount("close")).toBe(0); // the close listener was removed
			expect(child.listenerCount("error")).toBe(0);
		} finally {
			h.restore();
		}
	});

	test("deadline: no close within the 2 s kill-wait still settles within the bound, unreaped true", async () => {
		const t = makeTimers();
		const { child, killCalls } = makeChild(987654322);
		const h = start(child, t);
		let settleCount = 0;
		let settled: unknown = null;
		h.promise.then(
			(r) => {
				settleCount += 1;
				settled = r;
			},
			() => {
				settleCount += 1;
				settled = "REJECTED";
			},
		);
		try {
			t.fire(20_000);
			expect(killCalls.length).toBe(1);
			t.fire(2_000); // the probe kill-wait value expires
			await flushMicrotasks();
			expect(settleCount).toBe(1); // the promise is never left unsettled
			expect(settled).toEqual({ ok: false, stdout: "", stderr: "", code: null, timedOut: true, unreaped: true });
			expect(t.pending()).toEqual([]);
		} finally {
			h.restore();
		}
	});

	test("a spawn error settles the spawn-failed shape and clears the timer", async () => {
		const t = makeTimers();
		const { child } = makeChild(1);
		const h = start(child, t);
		try {
			child.emit("error", new Error("boom"));
			const out = (await h.promise) as { ok: boolean; stdout: string; stderr: string; code: number | null };
			expect(out.ok).toBe(false);
			expect(out.stdout).toBe("");
			expect(out.stderr).toContain("spawn failed");
			expect(out.code).toBeNull();
			expect(t.pending()).toEqual([]);
		} finally {
			h.restore();
		}
	});

	test("an error after the deadline does not settle — it is recorded as killError and the armed close-wait settles", async () => {
		const t = makeTimers();
		const { child } = makeChild(987654323);
		const h = start(child, t);
		let settleCount = 0;
		let settled: unknown = null;
		h.promise.then((r) => {
			settleCount += 1;
			settled = r;
		});
		try {
			t.fire(20_000); // deadline: the close-wait is armed, then the kill
			child.emit("error", new Error("late")); // must NOT settle
			await flushMicrotasks();
			expect(settleCount).toBe(0);
			t.fire(2_000); // the already-armed close-wait settles
			await flushMicrotasks();
			expect(settleCount).toBe(1);
			expect(settled).toEqual({ ok: false, stdout: "", stderr: "", code: null, timedOut: true, unreaped: true, killError: "late" });
			expect(t.pending()).toEqual([]);
			expect(child.listenerCount("close")).toBe(0);
			expect(child.listenerCount("error")).toBe(0);
		} finally {
			h.restore();
		}
	});

	// Bun's ChildProcess.kill emits close/error SYNCHRONOUSLY from its
	// catch: the close-wait must be armed BEFORE the kill (matching
	// boundedIdentityProbe), so a synchronous settle cannot leave a timer
	// scheduled after settlement (review rv-s5-sec finding 1).
	test("a close emitted SYNCHRONOUSLY inside kill() settles once with unreaped false and zero pending timers", async () => {
		const t = makeTimers();
		const { child, killCalls } = makeChild(987654324);
		child.kill = () => {
			killCalls.push("held-handle");
			child.emit("close", 1); // synchronous inside kill()
			return true;
		};
		const h = start(child, t);
		let settleCount = 0;
		let settled: unknown = null;
		h.promise.then((r) => {
			settleCount += 1;
			settled = r;
		});
		try {
			t.fire(20_000);
			await flushMicrotasks();
			expect(settleCount).toBe(1); // settled exactly once
			expect(settled).toEqual({ ok: false, stdout: "", stderr: "", code: null, timedOut: true, unreaped: false });
			expect(t.pending()).toEqual([]); // the close-wait armed before the kill was cleared
			expect(child.listenerCount("close")).toBe(0);
			expect(child.listenerCount("error")).toBe(0);
			expect(killCalls.length).toBe(1);
		} finally {
			h.restore();
		}
	});

	test("an error emitted SYNCHRONOUSLY inside kill() does not settle — recorded as killError, and the armed close-wait settles unreaped", async () => {
		const t = makeTimers();
		const { child, killCalls } = makeChild(987654325);
		child.kill = () => {
			killCalls.push("held-handle");
			child.emit("error", new Error("boom")); // synchronous inside kill()
			return true;
		};
		const h = start(child, t);
		let settleCount = 0;
		let settled: unknown = null;
		h.promise.then((r) => {
			settleCount += 1;
			settled = r;
		});
		try {
			t.fire(20_000);
			await flushMicrotasks();
			expect(settleCount).toBe(0); // the synchronous error did not settle
			t.fire(2_000); // the already-armed close-wait settles
			await flushMicrotasks();
			expect(settleCount).toBe(1);
			expect(settled).toEqual({ ok: false, stdout: "", stderr: "", code: null, timedOut: true, unreaped: true, killError: "boom" });
			expect(t.pending()).toEqual([]);
			expect(child.listenerCount("close")).toBe(0);
			expect(child.listenerCount("error")).toBe(0);
			expect(killCalls.length).toBe(1);
		} finally {
			h.restore();
		}
	});
});

/* ---------------- runSmoke probe residue retention -----------------------
 *
 * An unreaped probe child must reach the FINAL result (review rv-s5-sec
 * finding 2): the default win32 probes are driven through the injected
 * win32 runners (the real psScript pipeline — `hooks.runPsWin` for the
 * identity, `hooks.runPsWinImage` for the image, `hooks.runPsWinParent` for
 * the parent), and when one of them reports `unreaped: true` runSmoke
 * retains the sandbox and reports the probe-residue fact in
 * cleanup.errors — never removes the sandbox silently. The launcher stays
 * alive during cleanup (the fake child does not pre-exit) so the
 * ownership tree check reaches the parent probe. Every run declares
 * `platform: "win32"` so EVERY platform-dependent builder in the run
 * (identity, parent, image, kill, the image-containment decision) uses the
 * SAME declared platform on every host — on a POSIX host the injected
 * win32 runners would otherwise be ignored (the builders would bind to the
 * host platform and ownership would fail closed with no kill). The app dir
 * fixture is the win32 layout so the image probe's path exists on the host
 * filesystem.
 */

describe("runSmoke probe residue retention", () => {
	const RESIDUE_TAIL = " hit its deadline and its child was not reaped (it may still be running); the sandbox is retained";

	test("an unreaped identity probe retains the sandbox with the residue fact in cleanup.errors", async () => {
		const appDir = makeAppDir("win32");
		const childPid = 94101;
		const trayPid = 94102;
		const killCalls: number[] = [];
		const identityCalls = new Map<number, number>();
		let healthCalls = 0;
		const { spawnFn } = fakeSpawn(childPid, trayPid);
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17446, timeoutMs: 3_000, log: null, keepHome: false },
				{
					platform: "win32",
					spawn: spawnFn,
					isAlive: async (pid: number) => pid === trayPid,
					listeningPid: () => null,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					probeHealth: async () => {
						healthCalls += 1;
						return { healthy: healthCalls > 1 };
					},
					runPsWin: async (pid: number) => {
						const p = pid;
						const n = (identityCalls.get(p) ?? 0) + 1;
						identityCalls.set(p, n);
						if (p === trayPid) {
							if (n === 1) return { ok: false, stdout: "", stderr: "", code: null, timedOut: true, unreaped: true };
							if (n === 2) return { ok: true, stdout: "133850432100000000\n", stderr: "", code: 0 };
							return { ok: false, stdout: "", stderr: "", code: 3 }; // gone for the poll and verdict
						}
						return { ok: false, stdout: "", stderr: "", code: 3 }; // the launcher pid: gone (refused)
					},
					runPsWinImage: async () => ({ ok: true, stdout: `${launcherCandidates(appDir, "win32")[0]}\n`, stderr: "", code: 0 }),
					runPsWinParent: async () => ({ ok: true, stdout: `${childPid}\n`, stderr: "", code: 0 }),
				},
			);
			// the kill still happened (the identity was alive at the signal)
			expect(killCalls).toEqual([trayPid]);
			expect(result.cleanup.killed).toEqual([trayPid]);
			expect(result.sandboxRetained).toBe(true);
			expect(result.sandbox).toBeTruthy();
			expect(existsSync(result.sandbox)).toBe(true); // not removed
			expect(result.cleanup.ok).toBe(false);
			expect(result.ok).toBe(false);
			expect(result.cleanup.errors).toEqual([`probe residue: the identity probe for pid ${trayPid}${RESIDUE_TAIL}`]);
			expect(result.reason).toBe(`cleanup failed: probe residue: the identity probe for pid ${trayPid}${RESIDUE_TAIL}`);
		} finally {
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("an unreaped parent probe retains the sandbox (ownership falls back to the image)", async () => {
		const appDir = makeAppDir("win32");
		const childPid = 94201;
		const trayPid = 94202;
		const killCalls: number[] = [];
		const identityCalls = new Map<number, number>();
		const parentUnreaped = new Set<number>();
		// The parent probe degrades (unreaped) exactly once, after the startup
		// is confirmed healthy: during the health wait it still reports the
		// launcher pid, so decide() sees the tray in the tree and the run
		// succeeds; the first cleanup observation is unreaped (the residue),
		// later probes fail normally (no further residue).
		let healthy = false;
		let healthCalls = 0;
		const { spawnFn } = fakeSpawn(childPid, trayPid);
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17447, timeoutMs: 3_000, log: null, keepHome: false },
				{
					platform: "win32",
					spawn: spawnFn,
					isAlive: async (pid: number) => pid === trayPid,
					listeningPid: () => null,
					killTree: async (pid: number) => {
						killCalls.push(pid);
					},
					probeHealth: async () => {
						healthCalls += 1;
						if (healthCalls > 1) healthy = true;
						return { healthy: healthCalls > 1 };
					},
					runPsWin: async (pid: number) => {
						const p = pid;
						const n = (identityCalls.get(p) ?? 0) + 1;
						identityCalls.set(p, n);
						if (p === trayPid) {
							if (n <= 2) return { ok: true, stdout: "133850432100000001\n", stderr: "", code: 0 };
							return { ok: false, stdout: "", stderr: "", code: 3 }; // gone for the poll and verdict
						}
						return { ok: false, stdout: "", stderr: "", code: 3 };
					},
					runPsWinImage: async () => ({ ok: true, stdout: `${launcherCandidates(appDir, "win32")[0]}\n`, stderr: "", code: 0 }),
					runPsWinParent: async (pid: number) => {
						if (!healthy) return { ok: true, stdout: `${childPid}\n`, stderr: "", code: 0 };
						if (!parentUnreaped.has(pid)) {
							parentUnreaped.add(pid);
							return { ok: false, stdout: "", stderr: "", code: null, timedOut: true, unreaped: true };
						}
						return { ok: false, stdout: "", stderr: "", code: 1 }; // later probes fail without residue
					},
				},
			);
			expect(killCalls).toEqual([trayPid]);
			expect(result.cleanup.killed).toEqual([trayPid]);
			expect(result.sandboxRetained).toBe(true);
			expect(result.sandbox).toBeTruthy();
			expect(existsSync(result.sandbox)).toBe(true); // not removed
			expect(result.cleanup.ok).toBe(false);
			expect(result.ok).toBe(false);
			// exactly the parent residue fact — no identity residue
			expect(result.cleanup.errors).toEqual([`probe residue: the parent probe for pid ${trayPid}${RESIDUE_TAIL}`]);
			expect(result.reason).toBe(`cleanup failed: probe residue: the parent probe for pid ${trayPid}${RESIDUE_TAIL}`);
		} finally {
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	});
});

/* ---------------- runSmoke POSIX-declared cleanup (every OS) ---------------
 *
 * Residue (`unreaped: true`) is defined only for the win32 PowerShell
 * probes, so the POSIX seams get their own explicit coverage that runs on
 * EVERY OS (the platform is declared, never the host): the identity and
 * image probes are the module's real POSIX builders
 * (`identityOfFor("linux" | "darwin")`, `imageOfFor`), the kill sequence is
 * the real `killTreeFor` (injected `kill` — no real signal is sent), and
 * the runs prove (a) the kill is bound to the proven identity (a reused
 * PID is refused, never signalled), (b) ownership still refuses
 * gone/unknown (a gone pid is refused before the signal; an unknown
 * identity refuses with an error, no signal), and (c) no probe-residue
 * fact is invented on POSIX (cleanup.errors stays empty and the sandbox is
 * removed). The launcher is already exited in every run, so the tree edge
 * is no longer evidence and ownership falls back to the image probe.
 */

describe("runSmoke POSIX-declared cleanup (runs on every OS)", () => {
	// A valid /proc/<pid>/stat line for the linux identity fixture: the
	// state field is S and the numeric field at index 19 after the last ")"
	// (starttime) carries the identity.
	const writeProcStat = (procDir: string, pid: number, id: string) => {
		const dir = join(procDir, String(pid));
		mkdirSync(dir, { recursive: true });
		// state(0) + 18 filler fields + starttime(19).
		writeFileSync(join(dir, "stat"), `${pid} (pinar) S 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 ${id} 0 0 0\n`);
	};
	// A /proc/<pid>/exe pointing at the app dir for the linux image fixture.
	// Windows cannot create file symlinks without elevation, so a directory
	// junction targets the app dir itself (a canonical path equal to the
	// launch root is inside it); on POSIX a plain symlink with the same
	// target. readlink yields the app dir in both cases.
	const linkProcExe = (procDir: string, pid: number, appDir: string) => {
		mkdirSync(join(procDir, String(pid)), { recursive: true });
		const exe = join(procDir, String(pid), "exe");
		try {
			symlinkSync(appDir, exe, "junction");
		} catch {
			symlinkSync(appDir, exe);
		}
	};

	test("a linux-declared run kills through the bound identity: only the group TERM is delivered, the KILL step sees gone, no residue fact, sandbox removed", async () => {
		const appDir = makeAppDir("linux");
		const procDir = mkdtempSync(join(tmpdir(), "pinar-smoke-proc-"));
		const childPid = 94301;
		const trayPid = 94302;
		const BOUND_ID = "1741000000";
		const killCalls: [number, string][] = [];
		let alive = true;
		try {
			writeProcStat(procDir, trayPid, BOUND_ID);
			linkProcExe(procDir, trayPid, appDir);
			const identityOf = identityOfFor("linux", { procDir });
			const imageOf = imageOfFor("linux", { procDir });
			const killTree = killTreeFor("linux", {
				identityOf,
				sleep: async () => {},
				// SM-2 leader gate: the tray pid is proven its own group leader.
				pgidOf: async () => trayPid,
				kill: (pid: number, signal: string) => {
					killCalls.push([pid, signal]);
					if (signal === "SIGTERM") {
						// The original exits on the group TERM: its stat file
						// disappears, so the KILL step re-proves the bound
						// identity and sees the pid gone.
						rmSync(join(procDir, String(trayPid), "stat"), { force: true });
						alive = false;
					}
				},
			});
			let healthCalls = 0;
			const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
			const result = await runSmoke(
				{ appDir, port: 17448, timeoutMs: 2_000, log: null, keepHome: false },
				{
					platform: "linux",
					spawn: spawnFn,
					parentOf: async (pid: number) => (pid === trayPid ? childPid : null),
					isAlive: async () => alive,
					identityOf,
					imageOf,
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: ++healthCalls > 1 }),
					killTree,
					groupExists: () => "absent",
				},
			);
			expect(result.ok).toBe(true);
			expect(result.reason).toBeNull();
			// The group TERM is the only delivered signal: the KILL step
			// re-proved the bound identity and saw the pid gone.
			expect(killCalls).toEqual([[-trayPid, "SIGTERM"]]);
			expect(result.cleanup.killed).toEqual([trayPid]);
			expect(result.cleanup.errors).toEqual([]); // no probe-residue fact on POSIX
			expect(result.cleanup.reused).toEqual([]);
			expect(result.cleanup.refused).toEqual([]);
			expect(result.cleanup.sandboxRemoved).toBe(true);
			expect(result.sandboxRetained).toBe(false);
		} finally {
			rmSync(procDir, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a linux-declared run refuses the KILL step after a PID reuse following the pre-signal bind: only the group TERM was delivered, the reuse is reported", async () => {
		const appDir = makeAppDir("linux");
		const procDir = mkdtempSync(join(tmpdir(), "pinar-smoke-proc-"));
		const childPid = 94401;
		const trayPid = 94402;
		const BOUND_ID = "1742000000";
		const REUSED_ID = "1742000001";
		const killCalls: [number, string][] = [];
		try {
			writeProcStat(procDir, trayPid, BOUND_ID);
			linkProcExe(procDir, trayPid, appDir);
			const identityOf = identityOfFor("linux", { procDir });
			const imageOf = imageOfFor("linux", { procDir });
			const killTree = killTreeFor("linux", {
				identityOf,
				sleep: async () => {},
				// SM-2 leader gate: the tray pid is proven its own group leader.
				pgidOf: async () => trayPid,
				kill: (pid: number, signal: string) => {
					killCalls.push([pid, signal]);
					if (signal === "SIGTERM") {
						// The original exits on the group TERM and the OS hands
						// the PID to a different process: the stat file now
						// carries a DIFFERENT starttime (identity).
						writeProcStat(procDir, trayPid, REUSED_ID);
					}
				},
			});
			let healthCalls = 0;
			const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
			const result = await runSmoke(
				{ appDir, port: 17449, timeoutMs: 2_000, log: null, keepHome: false },
				{
					platform: "linux",
					spawn: spawnFn,
					parentOf: async (pid: number) => (pid === trayPid ? childPid : null),
					isAlive: async () => true, // the reused pid is alive
					identityOf,
					imageOf,
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: ++healthCalls > 1 }),
					killTree,
					groupExists: () => "absent",
				},
			);
			// The KILL step was refused by the identity bind: the only
			// delivered signal is the group TERM.
			expect(killCalls).toEqual([[-trayPid, "SIGTERM"]]);
			expect(result.cleanup.killed).toEqual([trayPid]);
			expect(result.cleanup.errors).toEqual([]);
			expect(result.cleanup.reused.some((entry) =>
				entry.includes(`refused further signals; pid now owned by id ${REUSED_ID} (bound ${BOUND_ID})`),
			)).toBe(true);
			expect(result.cleanup.reused.some((entry) => entry.includes(`original process (id ${BOUND_ID}) exited`))).toBe(true);
			expect(result.ok).toBe(true);
			expect(result.reason).toBeNull();
			expect(result.cleanup.sandboxRemoved).toBe(true);
		} finally {
			rmSync(procDir, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a darwin-declared run refuses a gone tray pid: no signal, the refusal is recorded, the sandbox is removed", async () => {
		const appDir = makeAppDir("darwin");
		const childPid = 94501;
		const trayPid = 94502;
		const killCalls: [number, string][] = [];
		try {
			// status 1 with empty output proves gone (the darwin identity seam
			// — no real ps is spawned).
			const identityOf = identityOfFor("darwin", { runPs: () => ({ status: 1, stdout: "" }) });
			// The image still proves containment (coarse evidence says "ours"): the
			// fine-grained identity probe proving gone is what must refuse the
			// kill — a contained, live-looking pid with no identity is never signalled.
			const imageOf = imageOfFor("darwin", {
				ps: () => ({ status: 0, stdout: `${launcherCandidates(appDir, "darwin")[0]}\n` }),
			});
			const killTree = killTreeFor("darwin", {
				identityOf,
				sleep: async () => {},
				kill: (pid: number, signal: string) => {
					killCalls.push([pid, signal]);
				},
			});
			let healthCalls = 0;
			const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
			const result = await runSmoke(
				{ appDir, port: 17450, timeoutMs: 2_000, log: null, keepHome: false },
				{
					platform: "darwin",
					spawn: spawnFn,
					// Coarse liveness (the legacy isAlive seam) still says
					// alive; the fine-grained identity probe proves gone — the
					// kill is refused on the identity.
					parentOf: async (pid: number) => (pid === trayPid ? childPid : null),
					isAlive: async () => true,
					identityOf,
					imageOf,
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: ++healthCalls > 1 }),
					killTree,
				},
			);
			expect(killCalls).toEqual([]);
			expect(result.cleanup.killed).toEqual([]);
			expect(result.cleanup.refused).toEqual([`tray.pid pid ${trayPid}: not alive at cleanup`]);
			expect(result.cleanup.errors).toEqual([]);
			expect(result.ok).toBe(true);
			expect(result.reason).toBeNull();
			expect(result.cleanup.sandboxRemoved).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a darwin-declared run refuses to signal on an unknown identity: the error names the identity, no signal is sent", async () => {
		const appDir = makeAppDir("darwin");
		const childPid = 94601;
		const trayPid = 94602;
		const killCalls: [number, string][] = [];
		try {
			// A probe fault (status 2) is unknown — never gone, never alive.
			const identityOf = identityOfFor("darwin", {
				runPs: (pid: number) => (pid === trayPid ? { status: 2, stdout: "boom" } : { status: 1, stdout: "" }),
			});
			const imageOf = imageOfFor("darwin", {
				ps: () => ({ status: 0, stdout: `${launcherCandidates(appDir, "darwin")[0]}\n` }),
			});
			const killTree = killTreeFor("darwin", {
				identityOf,
				sleep: async () => {},
				kill: (pid: number, signal: string) => {
					killCalls.push([pid, signal]);
				},
			});
			let healthCalls = 0;
			const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
			const result = await runSmoke(
				{ appDir, port: 17451, timeoutMs: 2_000, log: null, keepHome: false },
				{
					platform: "darwin",
					spawn: spawnFn,
					// The launcher is already exited: ownership falls back to
					// the contained image — the only thing standing between the
					// pid and a signal is the identity.
					parentOf: async (pid: number) => (pid === trayPid ? childPid : null),
					isAlive: async () => true,
					identityOf,
					imageOf,
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: ++healthCalls > 1 }),
					killTree,
				},
			);
			expect(killCalls).toEqual([]); // fail closed: no signal without a proven identity
			expect(result.cleanup.killed).toEqual([]);
			expect(result.cleanup.refused).toEqual([]);
			expect(result.cleanup.errors).toEqual([
				`killTree(tray.pid pid ${trayPid}) incomplete: identity unknown, no further signals sent: ps exited 2 with output "boom"`,
			]);
			expect(result.ok).toBe(false);
			expect(result.reason).toBe(
				`cleanup failed: killTree(tray.pid pid ${trayPid}) incomplete: identity unknown, no further signals sent: ps exited 2 with output "boom"`,
			);
			expect(result.cleanup.sandboxRemoved).toBe(true); // nothing was signalled: nothing is retained
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});
});

describe("group-empty check after a group-signalled kill (POSIX)", () => {
	// Ports the reviewer's non-listening-descendant scenarios through the REAL
	// inner factory: the leader (group) is signalled, and the group must be
	// proven EMPTY before success is credited. `groupExists` is injected (a
	// real signal-0 probe on the host would not be hermetic); exactly one
	// signal — the group TERM — is ever sent, never on the old PGID after the
	// leader is gone.
	const descendantHooks = (appDir: string, leaderPid: number, port: number, groupState: () => "present" | "absent" | "unknown") => {
		let leaderAlive = true;
		let descendantAlive = true;
		let child;
		const calls: [number, string][] = [];
		const identityOf = async () => (leaderAlive ? { state: "alive", id: "owned-leader" } : { state: "gone" });
		const killTree = killTreeFor("linux", {
			identityOf,
			sleep: async () => {},
			// SM-2 leader gate: the leader is proven its own group leader.
			pgidOf: async () => leaderPid,
			kill: (pid: number, signal: string) => {
				calls.push([pid, signal]);
				if (signal === "SIGTERM") {
					leaderAlive = false;
					child.exitCode = 0; // the leader exits on TERM
				}
				if (pid < 0 && signal === "SIGKILL") descendantAlive = false; // the group KILL
			},
		});
		let healthCalls = 0;
		const run = () =>
			runSmoke(
				{ appDir, port, timeoutMs: 2_000, keepHome: false, log: null },
				{
					platform: "linux",
					spawn: (_file: string, _args: string[], opts: { env: Record<string, string>; detached?: boolean }) => {
						expect(opts.detached).toBe(true);
						const pidFile = join(opts.env.PINAR_HOME, "tray.pid");
						writeFileSync(pidFile, `${leaderPid}\n`);
						const stamp = new Date(Date.now() + 1_000);
						utimesSync(pidFile, stamp, stamp);
						child = { pid: leaderPid, exitCode: null, signalCode: null, stdout: null, stderr: null, on() {} };
						return child;
					},
					parentOf: async () => null,
					imageOf: async () => launcherCandidates(appDir, "linux")[0],
					isAlive: async () => leaderAlive,
					identityOf,
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: ++healthCalls > 1 }),
					killTree,
					groupExists: groupState,
					removeDir: () => {},
				},
			);
		return { run, calls, descendant: () => descendantAlive };
	};

	test("a TERM-resistant non-listening group member fails cleanup: the error names the group, the sandbox is retained, no extra signal", async () => {
		const appDir = makeAppDir("linux");
		const leaderPid = 94101;
		let result;
		const { run, calls, descendant } = descendantHooks(appDir, leaderPid, 17441, () => "present");
		try {
			// The 10 s bounded post-kill poll really runs: the group never
			// becomes absent, so this is a real transition (present, forever).
			result = await run();
			expect(descendant()).toBe(true); // no SIGKILL reached the group
			expect(calls).toEqual([[-leaderPid, "SIGTERM"]]); // exactly one signal ever
			expect(result.ok).toBe(false);
			expect(result.cleanup.ok).toBe(false);
			expect(result.cleanup.killed).toEqual([leaderPid]);
			expect(result.cleanup.errors).toEqual([`process group ${leaderPid} still has members after cleanup`]);
			expect(result.sandboxRetained).toBe(true);
			expect(result.sandbox).toBeTruthy();
		} finally {
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("a group member that exits during the poll settles (present then absent → ok)", async () => {
		const appDir = makeAppDir("linux");
		const leaderPid = 94102;
		let groupProbes = 0;
		const { run, calls } = descendantHooks(appDir, leaderPid, 17442, () => {
			groupProbes += 1;
			return groupProbes < 3 ? "present" : "absent";
		});
		let result;
		try {
			// Observable transition inside the bounded poll: present, present,
			// then absent → settled early, no error.
			result = await run();
			expect(calls).toEqual([[-leaderPid, "SIGTERM"]]);
			expect(result.ok).toBe(true);
			expect(result.cleanup.ok).toBe(true);
			expect(result.cleanup.errors).toEqual([]);
			expect(groupProbes).toBeGreaterThanOrEqual(3);
			expect(result.cleanup.sandboxRemoved).toBe(true);
			expect(result.sandboxRetained).toBe(false);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("an unknown group state fails cleanup and retains the sandbox", async () => {
		const appDir = makeAppDir("linux");
		const leaderPid = 94103;
		let result;
		const { run, calls } = descendantHooks(appDir, leaderPid, 17443, () => "unknown");
		try {
			// The 10 s bounded post-kill poll really runs: unknown is never
			// settled, so the fail-closed verdict comes after the deadline.
			result = await run();
			expect(calls).toEqual([[-leaderPid, "SIGTERM"]]);
			expect(result.ok).toBe(false);
			expect(result.cleanup.errors).toEqual([
				`process group ${leaderPid} state unknown after cleanup: the group-existence probe could not decide`,
				]);
			expect(result.sandboxRetained).toBe(true);
			expect(result.sandbox).toBeTruthy();
		} finally {
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("a non-leader tray pid (group ESRCH path) never triggers a group check", async () => {
		const appDir = makeAppDir("linux");
		const childPid = 94104;
		const trayPid = 94105;
		let groupChecks = 0;
		let healthCalls = 0;
		const { spawnFn } = fakeSpawn(childPid, trayPid, { alreadyExited: true });
		// The scripted identity is SHARED between runSmoke (tryKill's
		// before/atSignal probes + verdict) and the factory (step probes,
		// re-probes, final probe): the bound id must match what the factory
		// re-proves.
		const { identityOf } = scriptedIdentity({
			[trayPid]: [
				{ state: "alive", id: "A" }, // tryKill: pre-signal
				{ state: "alive", id: "A" }, // tryKill: at signal
				{ state: "alive", id: "A" }, // factory step 1 (group ESRCH)
				{ state: "alive", id: "A" }, // re-probe → bare TERM
				{ state: "alive", id: "A" }, // factory step 2 (group ESRCH)
				{ state: "alive", id: "A" }, // re-probe → bare KILL
				{ state: "gone" }, // factory final probe
			],
		});
		const killTree = killTreeFor("linux", {
			identityOf,
			sleep: async () => {},
			// SM-2 leader gate: the leader proof SUCCEEDS (pgid === pid) — the
			// ESRCH below is the leader proof going stale between the probe
			// and the group signal (the pre-SM-2 non-leader case).
			pgidOf: async () => trayPid,
			kill: (pid: number, signal: string) => {
				if (pid < 0) {
					const error = new Error(`kill ${signal} failed: ESRCH: no such process`);
					(error as NodeJS.ErrnoException).code = "ESRCH";
					throw error;
				}
			},
		});
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17444, timeoutMs: 2_000, keepHome: false, log: null },
				{
					platform: "linux",
					parentOf: async (pid: number) => (pid === trayPid ? childPid : null),
					isAlive: async (pid: number) => pid === trayPid,
					imageOf: async (pid: number) => (pid === trayPid ? launcherCandidates(appDir, "linux")[0] : null),
					identityOf,
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: ++healthCalls > 1 }),
					spawn: spawnFn,
					killTree,
					groupExists: () => {
						groupChecks += 1;
						return "absent";
					},
				},
			);
			// The group was never signalled (ESRCH on both group attempts), so
			// the group-empty check must never run.
			expect(groupChecks).toBe(0);
			expect(result.ok).toBe(true);
			expect(result.cleanup.ok).toBe(true);
			expect(result.cleanup.killed).toEqual([trayPid]);
			expect(result.cleanup.errors).toEqual([]);
		} finally {
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("a port helper that is a group member and is killed later is not misreported", async () => {
		// The group check must run AFTER all tryKill calls (tray.pid, launcher,
		// port helper): the helper is a member of the leader's group and is
		// killed by its OWN tryKill later in the cleanup — a group check that
		// ran before that kill would see the helper and fail closed in error.
		const appDir = makeAppDir("linux");
		const childPid = 94107;
		const leaderPid = 94101;
		const helperPid = 94106;
		let leaderAlive = true;
		let helperAlive = true;
		let helperListening = false; // the helper starts serving the port once the tray is up
		const calls: [number, string][] = [];
		const scripted = scriptedIdentity({
			[leaderPid]: [
				{ state: "alive", id: "L" }, // tryKill: before
				{ state: "alive", id: "L" }, // tryKill: at signal
				{ state: "alive", id: "L" }, // factory step 1 (group TERM delivered)
				{ state: "gone" }, // factory step 2: the leader died on TERM
			],
			[helperPid]: [
				{ state: "alive", id: "H" }, // tryKill: before
				{ state: "alive", id: "H" }, // tryKill: at signal
				{ state: "alive", id: "H" }, // factory step 1 (group refused: not a leader → bare TERM)
				{ state: "gone" }, // factory step 2: the helper died on TERM
			],
		});
		const killTree = killTreeFor("linux", {
			identityOf: scripted.identityOf,
			sleep: async () => {},
			// SM-2 leader gate: the leader is proven its own group leader;
			// the helper is NOT (a different pgid) → its group signal is
			// refused and the bare pid is signalled instead.
			pgidOf: async (pid: number) => (pid === leaderPid ? leaderPid : 99999),
			kill: (pid: number, signal: string) => {
				if (pid === -leaderPid && signal === "SIGTERM") {
					leaderAlive = false; // the group TERM takes the leader
					calls.push([pid, signal]);
					return;
				}
				if (pid < 0) {
					const error = new Error(`kill ${signal} failed: ESRCH: no such process`);
					(error as NodeJS.ErrnoException).code = "ESRCH";
					throw error; // a -pid call must never reach the helper
				}
				if (pid === helperPid && signal === "SIGTERM") helperAlive = false;
				calls.push([pid, signal]);
			},
		});
		const { spawnFn } = fakeSpawn(childPid, leaderPid, { alreadyExited: true });
		let groupChecks = 0;
		let healthCalls = 0;
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17445, timeoutMs: 2_000, keepHome: false, log: null },
				{
					platform: "linux",
					parentOf: async (pid: number) => (pid === leaderPid || pid === helperPid ? childPid : null),
					isAlive: async (pid: number) => (pid === leaderPid ? leaderAlive : pid === helperPid ? helperAlive : false),
					imageOf: async (pid: number) =>
						pid === leaderPid || pid === helperPid ? launcherCandidates(appDir, "linux")[0] : null,
					identityOf: scripted.identityOf,
					listeningPid: () => (helperListening && helperAlive ? helperPid : null),
					probeHealth: async () => {
						healthCalls += 1;
						if (healthCalls > 1) helperListening = true; // the helper comes up with the app
						return { healthy: healthCalls > 1 };
					},
					spawn: spawnFn,
					killTree,
					groupExists: () => {
						groupChecks += 1;
						// The group 94101 has members while the helper (a group
						// member) is alive; empty once both leader and helper die.
						return helperAlive ? "present" : "absent";
					},
					removeDir: () => {},
				},
			);
			// Exactly two signals: the group TERM on the leader (a proven
			// leader), then the bare TERM on the helper (the leader gate
			// refused its group signal: it is not its own group leader).
			expect(calls).toEqual([
				[-leaderPid, "SIGTERM"],
				[helperPid, "SIGTERM"],
			]);
			expect(result.ok).toBe(true);
			expect(result.cleanup.ok).toBe(true);
			expect(result.cleanup.errors).toEqual([]);
			expect(result.cleanup.killed).toEqual([leaderPid, helperPid]);
			expect(groupChecks).toBeGreaterThanOrEqual(1); // the group WAS checked (after the helper kill)
			expect(result.cleanup.sandboxRemoved).toBe(true);
		} finally {
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	});
});

/* ---------------- win32 8.3 short paths (real) ---------------------------- */

// bun:test has no runtime self-skip, so the real short-path tests are
// declared with test.skip (and an explicit message) when this machine's
// volume has 8.3 names disabled. The fixture (a long-named dir + its 8.3
// form) is built once at import time, on win32 only.
const shortPathFixture = (() => {
	if (process.platform !== "win32") return null;
	const root = mkdtempSync(join(tmpdir(), "pinar-smoke-83base-"));
	const longDir = join(root, "averyverylongpinarsmoketestnamefortesting");
	mkdirSync(longDir, { recursive: true });
	const out = spawnSync("cmd", ["/d", "/c", "for", "%I", "in", `(${longDir})`, "do", "@echo", "%~sI"], {
		encoding: "utf8",
		windowsHide: true,
	});
	const shortDir = String(out.stdout ?? "").trim();
	// Warm the CIM service so the real Win32_Process probe inside the tests
	// does not pay first-call latency inside its own timeout.
	spawnSync("powershell", [
		"-NoProfile",
		"-Command",
		"Get-CimInstance Win32_Process -Filter \"ProcessId=$PID\" | Out-Null",
	], { stdio: "ignore", windowsHide: true });
	return { root, longDir, shortDir, shortNamesDisabled: shortDir === "" || shortDir === longDir };
})();

afterAll(() => {
	if (shortPathFixture != null) {
		rmSync(shortPathFixture.root, { recursive: true, force: true });
	}
});

describe("win32 8.3 short paths (real)", () => {
	// bun:test has no runtime self-skip. On a volume where 8.3 names are
	// disabled (short form equals long form) the tests are declared with
	// test.skip and an EXPLICIT message — never a silent pass.
	const declare =
		process.platform === "win32" && shortPathFixture != null && shortPathFixture.shortNamesDisabled
			? (name, fn) =>
					test.skip(
						`${name} (skipped: 8.3 short names disabled on this volume — the short form equals the long form)`,
						fn,
					)
			: (name, fn, timeout) => test.skipIf(process.platform !== "win32")(name, fn, timeout);

	declare(
		"win32 real 8.3: the CIM image (short or long form) is inside both spellings of the dir",
		async () => {
			const fx = shortPathFixture;
			if (fx == null) throw new Error("fixture unavailable");
			const probeDir = mkdtempSync(join(tmpdir(), "pinar-smoke-cim-"));
			let pid = null;
			try {
				const source = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "PING.EXE");
				const exe = join(fx.longDir, "ping.exe");
				copyFileSync(source, exe);
				// Spawn through the SHORT path: Win32_Process may report the
				// image in either spelling.
				const child = spawn(join(fx.shortDir, "ping.exe"), ["-n", "30", "127.0.0.1"], {
					stdio: "ignore",
					windowsHide: true,
				});
				pid = child.pid;
				if (pid == null) throw new Error("spawn returned no pid");
				child.on("error", () => undefined);
				await new Promise((resolve) => setTimeout(resolve, 700));
				const imageOf = imageOfFor("win32", { probeDir });
				const image = await imageOf(pid);
				expect(image).not.toBeNull();
				const imageLower = String(image).toLowerCase();
				const shortExe = join(fx.shortDir, "ping.exe").toLowerCase();
				const longExe = join(fx.longDir, "ping.exe").toLowerCase();
				expect([shortExe, longExe]).toContain(imageLower);
				// Containment holds for BOTH spellings of the dir (F2).
				expect(isInsideAppDir(String(image), fx.shortDir)).toBe(true);
				expect(isInsideAppDir(String(image), fx.longDir)).toBe(true);
				// A sibling dir is never inside.
				const evilDir = join(fx.root, "averyverylongpinarsmoketestnamefortesting-evil");
				mkdirSync(evilDir, { recursive: true });
				expect(isInsideAppDir(String(image), evilDir)).toBe(false);
			} finally {
				if (pid != null) {
					spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
					// Verify it is gone.
					const out = spawnSync("tasklist", ["/NH", "/FI", `PID eq ${pid}`, "/FO", "CSV"], {
						encoding: "utf8",
						windowsHide: true,
					});
					expect(tasklistCsvHasPid(out.stdout, pid)).toBe(false);
				}
				rmSync(probeDir, { recursive: true, force: true });
			}
		},
		60_000,
	);

	declare(
		"win32 real 8.3 TEMP: a helper with a long-form image inside the short-form sandbox is killed",
		async () => {
			const fx = shortPathFixture;
			if (fx == null) throw new Error("fixture unavailable");
			const oldTmp = process.env.TMP;
			const oldTemp = process.env.TEMP;
			const appDir = mkdtempSync(join(tmpdir(), "pinar-smoke-83app-"));
			const childPid = 88001;
			const helperPid = 88002;
			const killCalls = [];
			const killed = new Set();
			let capturedHome = null;
			let listeningCalls = 0;
			try {
				// Wrapper fixture with a REAL tar.zst payload so the
				// extraction inside runSmoke runs for real: launchRoot becomes
				// the extracted dir INSIDE the sandbox (under the short TEMP).
				const wrapper = join(appDir, "Pinar");
				mkdirSync(join(wrapper, "bin"), { recursive: true });
				mkdirSync(join(wrapper, "Resources"), { recursive: true });
				writeFileSync(join(wrapper, "bin", "launcher.exe"), ""); // stub, no runtime
				const src = join(appDir, "payload-src");
				mkdirSync(join(src, "bin"), { recursive: true });
				writeFileSync(join(src, "bin", "launcher.exe"), "");
				writeFileSync(join(src, "helper.exe"), "");
				const payload = join(wrapper, "Resources", "abc123.tar.zst");
				const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
				// SM-3: explicit top-level entries (no `.` — the platform bsdtar
				// emits `./` entries when given `.` as the argument, and the
				// extractor now rejects `.` segments).
				const packed = spawnSync(tar, ["-a", "-cf", payload, "-C", src, "bin", "helper.exe"], { stdio: "ignore", windowsHide: true });
				expect(packed.status).toBe(0);
				process.env.TMP = fx.shortDir;
				process.env.TEMP = fx.shortDir;
				const result = await runSmoke(
					{ appDir, port: 17414, timeoutMs: 1_500, log: null, keepHome: false },
					{
						spawn: (_launcher, _args, spawnOpts) => {
							capturedHome = spawnOpts.env.PINAR_HOME;
							return { pid: childPid, exitCode: null, signalCode: null, stdout: null, stderr: null, on() {} };
						},
						parentOf: async () => null,
						isAlive: async (pid) => (killed.has(pid) ? false : pid === childPid || pid === helperPid),
						// The LONG canonical form of a file inside the
						// sandbox, derived from the fake spawn's
						// env.PINAR_HOME (mimics a CIM ExecutablePath that
						// reports the long spelling of a short-built sandbox).
						imageOf: async (pid) => {
							if (pid !== helperPid || capturedHome == null) return null;
							const sandbox = dirname(capturedHome);
							return realpathSync.native(join(sandbox, "extracted", "helper.exe"));
						},
						killTree: async (pid) => {
							killCalls.push(pid);
							killed.add(pid);
						},
						listeningPid: (port) => {
							listeningCalls += 1;
							if (port !== 17414) return null;
							if (killed.has(helperPid)) return null;
							return listeningCalls > 1 ? helperPid : null;
						},
						probeHealth: async () => ({ healthy: false }),
					},
				);
				expect(killCalls).toContain(helperPid);
				expect(killCalls).toContain(childPid);
				expect(result.cleanup.ok).toBe(true);
				expect(result.cleanup.errors).toEqual([]);
				// Startup itself never succeeded (no tray.pid): the point is
				// that the helper was recognized as ours and killed.
				expect(result.ok).toBe(false);
				expect(result.sandboxRetained).toBe(false);
			} finally {
				// Restoring `undefined` would store the string "undefined"; delete
				// the variable when it was not set.
				if (oldTmp === undefined) delete process.env.TMP;
				else process.env.TMP = oldTmp;
				if (oldTemp === undefined) delete process.env.TEMP;
				else process.env.TEMP = oldTemp;
				rmSync(appDir, { recursive: true, force: true });
			}
		},
		60_000,
	);
});

/* ---------------- real symlink containment (posix) ------------------------ */

test.skipIf(process.platform === "win32")("posix: real symlinks — containment is decided on canonical paths", () => {
	const root = mkdtempSync(join(tmpdir(), "pinar-smoke-symlink-"));
	try {
		const realDir = join(root, "real");
		mkdirSync(realDir, { recursive: true });
		writeFileSync(join(realDir, "pinar"), "x");
		const linkDir = join(root, "link-to-real");
		symlinkSync(realDir, linkDir); // the dir itself is a symlink
		const outside = join(root, "outside");
		mkdirSync(outside, { recursive: true });
		writeFileSync(join(outside, "pinar"), "y");
		symlinkSync(outside, join(linkDir, "sub")); // escapes the real dir
		const image = join(linkDir, "sub", "pinar"); // lexically under linkDir
		// Dir that is itself a symlink to the real dir: inside.
		expect(isInsideAppDir(join(linkDir, "pinar"), realDir)).toBe(true);
		// Lexically under the dir, canonically outside: NOT inside.
		expect(isInsideAppDir(image, linkDir)).toBe(false);
		// A real sibling is not inside.
		expect(isInsideAppDir(join(outside, "pinar"), realDir)).toBe(false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

/* ---------------- F6: darwin wrapper materialization ----------------------- */

/** The platform tar (System32 bsdtar on win32) — the same selection runSmoke
 * uses for extraction. */
function platformTar(): string {
	return process.platform === "win32"
		? join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe")
		: "/usr/bin/tar";
}

/** A REAL `.tar.zst` from a fixture dir: plain tar via the platform tar,
 * compressed in-process with Bun (the same zstd the smoke decompresses).
 * The top-level entries are passed EXPLICITLY (never `.`): the SM-3
 * tar-name policy rejects `.` segments, and `.` as the argument makes
 * bsdtar emit `./`-prefixed member names. */
function realTarZst(destFile: string, srcDir: string): void {
	const plain = join(dirname(destFile), "plain-fixture.tar");
	const entries = readdirSync(srcDir).sort();
	const packed = spawnSync(platformTar(), ["-cf", plain, "-C", srcDir, ...entries], {
		stdio: "ignore",
		windowsHide: true,
	});
	expect(packed.status).toBe(0);
	writeFileSync(destFile, Bun.zstdCompressSync(readFileSync(plain)));
	rmSync(plain, { force: true });
}

const TAR_BLOCK = 512;

/** Minimal ustar entry (test-only writer): 100-byte name, optional ustar
 * `prefix` (a long path split across the two fields), typeflag, symlink
 * target; correct header checksum (or a deliberately wrong one). */
function tarEntry(
	name: string,
	data: Buffer = Buffer.alloc(0),
	options: { type?: string; linkname?: string; prefix?: string; badChecksum?: boolean } = {},
): Buffer {
	const { type = "0", linkname = "", prefix = "", badChecksum = false } = options;
	const h = Buffer.alloc(TAR_BLOCK, 0);
	const nameBytes = Buffer.from(name, "latin1");
	if (nameBytes.length > 100) throw new Error("fixture: name too long");
	nameBytes.copy(h, 0);
	h.write("000644", 100, 6, "ascii"); // mode
	h.write("000000", 108, 6, "ascii"); // uid
	h.write("000000", 116, 6, "ascii"); // gid
	h.write(data.length.toString(8).padStart(11, "0"), 124, 11, "ascii"); // size
	h.write("000000000000", 136, 12, "ascii"); // mtime
	h.fill(0x20, 148, 156); // chksum placeholder (spaces)
	h[156] = Buffer.from(type, "ascii")[0]; // typeflag
	Buffer.from(linkname, "latin1").copy(h, 157);
	h.write("ustar", 257, 5, "ascii"); // magic (NUL at 262)
	h.write("00", 263, 2, "ascii"); // version
	if (prefix !== "") {
		const prefixBytes = Buffer.from(prefix, "latin1");
		if (prefixBytes.length > 155) throw new Error("fixture: prefix too long");
		prefixBytes.copy(h, 345);
	}
	let sum = 0;
	for (let i = 0; i < TAR_BLOCK; i += 1) sum += h[i];
	h.write((badChecksum ? sum + 1 : sum).toString(8).padStart(6, "0"), 148, 6, "ascii");
	h[154] = 0x00;
	h[155] = 0x20;
	const pad = data.length % TAR_BLOCK === 0 ? 0 : TAR_BLOCK - (data.length % TAR_BLOCK);
	return Buffer.concat([h, data, Buffer.alloc(pad, 0)]);
}

/** A complete plain tar (entries + the standard two zero terminator blocks). */
function tarArchive(...blocks: Buffer[]): Buffer {
	return Buffer.concat([...blocks, Buffer.alloc(TAR_BLOCK * 2, 0)]);
}

/** zstd-compress a hand-rolled plain tar into a REAL `.tar.zst` file. */
function zstFromPlain(destFile: string, plain: Buffer): void {
	writeFileSync(destFile, Bun.zstdCompressSync(plain));
}

/** The inner darwin app every darwin fixture carries: a launcher plus a
 * Resources/app file cleanup can prove ownership by image. */
function buildInnerAppPayload(srcDir: string, payloadFile: string): void {
	const innerLauncher = join(srcDir, "Pinar.app", "Contents", "MacOS", "launcher");
	mkdirSync(dirname(innerLauncher), { recursive: true });
	writeFileSync(innerLauncher, "#!/bin/sh\n# inner app launcher (fixture)\n");
	const helper = join(srcDir, "Pinar.app", "Contents", "Resources", "app", "pinar-helper");
	mkdirSync(dirname(helper), { recursive: true });
	writeFileSync(helper, "helper\n");
	realTarZst(payloadFile, srcDir);
}

/** A darwin wrapper build dir: `Pinar.app` with the Electrobun extractor
 * stub, metadata.json and a REAL `Contents/Resources/<hash>.tar.zst`. */
function makeDarwinWrapperAppDir(
	buildPayload: (srcDir: string, payloadFile: string) => void,
): { root: string; wrapperLauncher: string; payloadFile: string } {
	const root = mkdtempSync(join(tmpdir(), "pinar-smoke-dwrap-"));
	const bundle = join(root, "Pinar.app");
	const wrapperLauncher = join(bundle, "Contents", "MacOS", "launcher");
	mkdirSync(dirname(wrapperLauncher), { recursive: true });
	writeFileSync(wrapperLauncher, "#!/bin/sh\necho 'Self-extractor v1.3 starting...'\n");
	const resources = join(bundle, "Contents", "Resources");
	mkdirSync(resources, { recursive: true });
	writeFileSync(join(resources, "metadata.json"), "{}\n");
	const payloadFile = join(resources, "1yc6wooh4msck.tar.zst");
	buildPayload(join(root, "payload-src"), payloadFile);
	return { root, wrapperLauncher, payloadFile };
}

/** A win32 wrapper build dir: `Pinar/` with the launcher.exe stub (no
 * runtime) and a REAL `Resources/<hash>.tar.zst`. */
function makeWinWrapperAppDir(
	buildSrc: (srcDir: string) => void,
): { root: string; wrapperLauncher: string; payloadFile: string } {
	const root = mkdtempSync(join(tmpdir(), "pinar-smoke-wwrap-"));
	const wrapper = join(root, "Pinar");
	mkdirSync(join(wrapper, "bin"), { recursive: true });
	writeFileSync(join(wrapper, "bin", "launcher.exe"), ""); // stub, no runtime
	mkdirSync(join(wrapper, "Resources"), { recursive: true });
	const payloadFile = join(wrapper, "Resources", "abc123.tar.zst");
	const srcDir = join(root, "payload-src");
	buildSrc(srcDir);
	realTarZst(payloadFile, srcDir);
	return { root, wrapperLauncher: join(wrapper, "bin", "launcher.exe"), payloadFile };
}

/** sha256 + relative path list of a whole tree (dirs + files), sorted —
 * the "build artifact unmodified" proof. */
function snapshotTree(rootDir: string): string[] {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const full = join(dir, entry.name);
			const rel = relative(rootDir, full);
			if (entry.isDirectory()) {
				out.push(`dir:${rel}`);
				walk(full);
			} else {
				out.push(`${rel}=${createHash("sha256").update(readFileSync(full)).digest("hex")}`);
			}
		}
	};
	walk(rootDir);
	return out;
}

/** All `pinar-tray-smoke-*` sandboxes currently in tmpdir (residue check). */
function smokeSandboxes(): string[] {
	return readdirSync(tmpdir()).filter((entry) => entry.startsWith("pinar-tray-smoke-"));
}

describe("darwin wrapper payload detection", () => {
	test("finds the payload in a Pinar.app wrapper bundle (nested and as appDir)", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-dwrap1-"));
		try {
			const bundle = join(root, "Pinar.app");
			mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
			writeFileSync(join(bundle, "Contents", "MacOS", "launcher"), "");
			mkdirSync(join(bundle, "Contents", "Resources"), { recursive: true });
			writeFileSync(join(bundle, "Contents", "Resources", "abc123.tar.zst"), "");
			writeFileSync(join(bundle, "Contents", "Resources", "metadata.json"), "{}");
			// The join(appDir, "Pinar.app") candidate:
			expect(darwinWrapperPayloadTarZst(root)).toBe(
				join(bundle, "Contents", "Resources", "abc123.tar.zst"),
			);
			// An appDir that IS the Pinar.app bundle (basename ends with .app):
			expect(darwinWrapperPayloadTarZst(bundle)).toBe(
				join(bundle, "Contents", "Resources", "abc123.tar.zst"),
			);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("returns null when Contents/Resources/app is present (an extracted app)", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-dwrap2-"));
		try {
			const bundle = join(root, "Pinar.app");
			mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
			writeFileSync(join(bundle, "Contents", "MacOS", "launcher"), "");
			mkdirSync(join(bundle, "Contents", "Resources", "app"), { recursive: true });
			writeFileSync(join(bundle, "Contents", "Resources", "app", "marker"), "");
			writeFileSync(join(bundle, "Contents", "Resources", "abc123.tar.zst"), "");
			expect(darwinWrapperPayloadTarZst(root)).toBeNull();
			expect(darwinWrapperPayloadTarZst(bundle)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("returns null when Contents/Resources holds no .tar.zst", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-dwrap3-"));
		try {
			const bundle = join(root, "Pinar.app");
			mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
			writeFileSync(join(bundle, "Contents", "MacOS", "launcher"), "");
			mkdirSync(join(bundle, "Contents", "Resources"), { recursive: true });
			writeFileSync(join(bundle, "Contents", "Resources", "metadata.json"), "{}");
			expect(darwinWrapperPayloadTarZst(root)).toBeNull();
			expect(darwinWrapperPayloadTarZst(bundle)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("returns null when there is no wrapper at all", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-dwrap4-"));
		try {
			// Empty dir, and a dir whose appDir basename does not end in .app
			// without a nested Pinar.app.
			expect(darwinWrapperPayloadTarZst(root)).toBeNull();
			const withApp = join(root, "Pinar.app");
			mkdirSync(join(withApp, "Contents", "Resources", "app"), { recursive: true });
			writeFileSync(join(withApp, "Contents", "Resources", "abc123.tar.zst"), "");
			// No Contents/MacOS/launcher stub: not a wrapper.
			expect(darwinWrapperPayloadTarZst(root)).toBeNull();
			expect(darwinWrapperPayloadTarZst(withApp)).toBeNull();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test("throws when the wrapper holds two .tar.zst payloads (fail closed)", () => {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-dwrap5-"));
		try {
			const bundle = join(root, "Pinar.app");
			mkdirSync(join(bundle, "Contents", "MacOS"), { recursive: true });
			writeFileSync(join(bundle, "Contents", "MacOS", "launcher"), "");
			mkdirSync(join(bundle, "Contents", "Resources"), { recursive: true });
			writeFileSync(join(bundle, "Contents", "Resources", "abc123.tar.zst"), "");
			writeFileSync(join(bundle, "Contents", "Resources", "def456.tar.zst"), "");
			expect(() => darwinWrapperPayloadTarZst(root)).toThrow(/ambiguous/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

test("win32 wrapper detection fails closed on two payloads (ambiguous)", () => {
	const root = mkdtempSync(join(tmpdir(), "pinar-smoke-wrap5-"));
	try {
		const wrapper = join(root, "Pinar");
		mkdirSync(join(wrapper, "bin"), { recursive: true });
		mkdirSync(join(wrapper, "Resources"), { recursive: true });
		writeFileSync(join(wrapper, "bin", "launcher.exe"), "");
		writeFileSync(join(wrapper, "Resources", "abc123.tar.zst"), "");
		writeFileSync(join(wrapper, "Resources", "def456.tar.zst"), "");
		expect(() => wrapperPayloadTarZst(root)).toThrow(/ambiguous/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

describe("darwin runSmoke: real wrapper payload materialization", () => {
	test("extracts the real .tar.zst into this run's sandbox and spawns the INNER launcher only", async () => {
		const fx = makeDarwinWrapperAppDir(buildInnerAppPayload);
		const before = snapshotTree(fx.root);
		const childPid = 78001;
		const trayPid = 78002;
		const outsidePid = 78003;
		const outsideDir = mkdtempSync(join(tmpdir(), "pinar-smoke-dout-"));
		writeFileSync(join(outsideDir, "outside-helper.exe"), "");
		const killCalls: number[] = [];
		const killed = new Set<number>();
		const { spawnFn, calls } = fakeSpawn(childPid, trayPid);
		let capturedSandbox: string | null = null;
		let launched = false;
		let childClosed = false;
		let result;
		try {
			result = await runSmoke(
				{ appDir: fx.root, port: 17420, timeoutMs: 1_500, log: null, keepHome: false },
				{
					platform: "darwin",
					spawn: (launcher: string, args: unknown[], opts: { env: Record<string, string> }) => {
						// Canonicalize while the sandbox still exists (cleanup
						// removes it before the assertions run).
						capturedSandbox = realpathSync.native(dirname(opts.env.PINAR_HOME));
						launched = true;
						const child = spawnFn(launcher, args, opts);
						// Track the (fake) close so the port owner can be
						// modelled by the child's liveness: the cleanup
						// decision runs before the close, the post-kill poll
						// after it.
						const origOn = child.on?.bind(child);
						child.on = (event: string, fn?: unknown) => {
							if (event === "close") childClosed = true;
							return origOn?.(event, fn);
						};
						return child;
					},
					parentOf: async () => null,
					isAlive: async (pid) =>
						killed.has(pid) ? false : pid === childPid || pid === trayPid || pid === outsidePid,
					// The tray helper's image is INSIDE the extracted dir (killed
					// by cleanup); the port helper's image is outside (survives).
					imageOf: async (pid) => {
						if (pid === outsidePid) return join(outsideDir, "outside-helper.exe");
						if (pid === trayPid && capturedSandbox != null) {
							return join(
								capturedSandbox,
								"extracted",
								"Pinar.app",
								"Contents",
								"Resources",
								"app",
								"pinar-helper",
							);
						}
						return null;
					},
					killTree: async (pid) => {
						killCalls.push(pid);
						killed.add(pid);
					},
					listeningPid: (port) => {
						// SM-7: the SM-7 diagnostic samples also probe
						// listeningPid during the wait loop (this run fails —
						// the fake parentOf never puts the tray in the tree),
						// so the port owner cannot be modelled by a call
						// counter. The outside helper holds the port from spawn
						// until the (fake) launcher close reaches it: the
						// samples and the cleanup decision (both before the
						// close) see it, the post-kill poll (after the close)
						// does not — so the poll settles and the cleanup stays
						// error-free.
						return port === 17420 && launched && !childClosed ? outsidePid : null;
					},
					probeHealth: async () => ({ healthy: false }),
				},
			);
			// The wrapper launcher is NEVER passed to spawn; the single spawn is
			// the inner launcher under the canonical extracted dir.
			expect(calls).toHaveLength(1);
			expect(calls[0]).not.toBe(fx.wrapperLauncher);
			expect(capturedSandbox).not.toBeNull();
			expect(result.launchDir).toBe(join(capturedSandbox!, "extracted"));
			expect(basename(result.launchDir)).toBe("extracted");
			expect(basename(dirname(result.launchDir))).toMatch(/^pinar-tray-smoke-/);
			expect(calls[0]).toBe(join(result.launchDir, "Pinar.app", "Contents", "MacOS", "launcher"));
			expect(result.launcher).toBe(calls[0]);
			// The build artifact (the whole wrapper fixture tree) is
			// byte-for-byte unchanged on the success path.
			expect(snapshotTree(fx.root)).toEqual(before);
			// Cleanup: the helper whose image is inside the extracted dir and
			// the launcher are killed; the outside helper is refused.
			expect(killCalls).toContain(trayPid);
			expect(killCalls).toContain(childPid);
			expect(killCalls).not.toContain(outsidePid);
			expect(result.cleanup.killed).toEqual([trayPid, childPid]);
			expect(result.cleanup.refused.some((entry) => entry.includes(String(outsidePid)))).toBe(true);
			expect(result.cleanup.errors).toEqual([]);
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
			rmSync(outsideDir, { recursive: true, force: true });
		}
	}, 60_000);
});

describe("darwin runSmoke: fail-closed matrix (real .tar.zst archives)", () => {
	const escapeTarget = join(tmpdir(), "pinar-smoke-escape-file");

	type MatrixCase = {
		name: string;
		reason: RegExp;
		build: (srcDir: string, payloadFile: string) => void;
		escapeCheck?: string;
	};

	const cases: MatrixCase[] = [
		{
			name: "a ../escape entry is rejected and nothing lands outside the sandbox",
			reason: /"\.\." segment in entry name/,
			build: (_srcDir, payloadFile) =>
				zstFromPlain(payloadFile, tarArchive(tarEntry("../../pinar-smoke-escape-file", Buffer.from("boom\n")))),
			escapeCheck: escapeTarget,
		},
		{
			name: "an absolute entry is rejected",
			reason: /absolute entry name/,
			build: (_srcDir, payloadFile) =>
				zstFromPlain(payloadFile, tarArchive(tarEntry("/etc/passwd", Buffer.from("x\n")))),
		},
		{
			name: "a hardlink entry (unsupported type 1) is rejected",
			reason: /unsupported tar entry type/,
			build: (_srcDir, payloadFile) =>
				zstFromPlain(
					payloadFile,
					tarArchive(
						tarEntry("a.txt", Buffer.from("a\n")),
						tarEntry("b.txt", Buffer.alloc(0), { type: "1", linkname: "a.txt" }),
					),
				),
		},
		{
			name: "a symlink escaping the archive root is rejected",
			reason: /symlink target: "\.\." segment in entry name: \.\.\/\.\.\/outside-target/,
			build: (_srcDir, payloadFile) =>
				zstFromPlain(
					payloadFile,
					tarArchive(tarEntry("link", Buffer.alloc(0), { type: "2", linkname: "../../outside-target" })),
				),
		},
		{
			name: "corrupt zstd bytes are rejected",
			// SM-5: the rejection now happens BEFORE decompression (the frame
			// walk refuses a non-zstd magic), so the message is the validation
			// message, not a decompression failure.
			reason: /zstd frame validation/,
			build: (_srcDir, payloadFile) =>
				writeFileSync(payloadFile, Buffer.from("this is definitely not a zstd frame", "latin1")),
		},
		{
			name: "a truncated tar is rejected",
			reason: /truncated tar archive/,
			build: (_srcDir, payloadFile) => {
				const full = tarArchive(tarEntry("file.txt", Buffer.from("data\n")));
				zstFromPlain(payloadFile, full.subarray(0, full.length - 100));
			},
		},
		{
			name: "a bad header checksum is rejected",
			reason: /bad header checksum/,
			build: (_srcDir, payloadFile) =>
				zstFromPlain(payloadFile, tarArchive(tarEntry("file.txt", Buffer.from("x\n"), { badChecksum: true }))),
		},
		{
			name: "an inner payload that is itself a wrapper is rejected",
			reason: /extracted payload is still a self-extracting wrapper/,
			build: (srcDir, payloadFile) => {
				// The "inner app" is itself a darwin wrapper.
				const innerLauncher = join(srcDir, "Pinar.app", "Contents", "MacOS", "launcher");
				mkdirSync(dirname(innerLauncher), { recursive: true });
				writeFileSync(innerLauncher, "stub");
				const innerResources = join(srcDir, "Pinar.app", "Contents", "Resources");
				mkdirSync(innerResources, { recursive: true });
				writeFileSync(join(innerResources, "nested.tar.zst"), "nested");
				realTarZst(payloadFile, srcDir);
			},
		},
		{
			name: "a payload without Pinar.app/Contents/MacOS/launcher is rejected",
			reason: /launcher not found under/,
			build: (srcDir, payloadFile) => {
				const other = join(srcDir, "other", "marker.txt");
				mkdirSync(dirname(other), { recursive: true });
				writeFileSync(other, "no launcher here\n");
				realTarZst(payloadFile, srcDir);
			},
		},
		{
			name: "two payloads in the wrapper Resources are rejected (ambiguous detection)",
			reason: /unsafe or ambiguous wrapper payload/,
			build: (_srcDir, payloadFile) => {
				// Detection fails before any archive is read: the second payload
				// makes the wrapper ambiguous.
				writeFileSync(payloadFile, "x");
				writeFileSync(join(dirname(payloadFile), "second.tar.zst"), "y");
			},
		},
	];

	for (const matrixCase of cases) {
		test(matrixCase.name, async () => {
			const fx = makeDarwinWrapperAppDir(matrixCase.build);
			const before = snapshotTree(fx.root);
			const sandboxesBefore = smokeSandboxes();
			const spawnCalls: string[] = [];
			const killCalls: number[] = [];
			try {
				const result = await runSmoke(
					{ appDir: fx.root, port: 17421, timeoutMs: 1_000, log: null, keepHome: false },
					{
						platform: "darwin",
						spawn: (launcher: string) => {
							spawnCalls.push(launcher);
							throw new Error("spawn must not run");
						},
						parentOf: async () => null,
						isAlive: async () => false,
						imageOf: async () => null,
						killTree: async (pid: number) => {
							killCalls.push(pid);
							throw new Error("killTree must not run");
						},
						listeningPid: () => null,
						probeHealth: async () => ({ healthy: false }),
					},
				);
				expect(result.ok).toBe(false);
				expect(result.jsExecuted).toBe(false);
				expect(result.reason).toMatch(matrixCase.reason);
				expect(spawnCalls).toHaveLength(0); // nothing was spawned
				expect(killCalls).toHaveLength(0); // nothing was killed
				expect(result.cleanup.killed).toEqual([]);
				expect(result.cleanup.errors).toEqual([]);
				// The sandbox is removed: no pinar-tray-smoke-* dir left from
				// this run.
				expect(smokeSandboxes()).toEqual(sandboxesBefore);
				// The build artifact is byte-for-byte unchanged (failure path).
				expect(snapshotTree(fx.root)).toEqual(before);
				// Nothing was written outside the sandbox.
				if (matrixCase.escapeCheck != null) {
					expect(existsSync(matrixCase.escapeCheck)).toBe(false);
				}
			} finally {
				rmSync(fx.root, { recursive: true, force: true });
				if (matrixCase.escapeCheck != null) {
					rmSync(matrixCase.escapeCheck, { force: true });
				}
			}
		}, 60_000);
	}
});

describe("win32 runSmoke through the same extraction routine", () => {
	test("extracts the real .tar.zst and spawns <extracted>/bin/launcher.exe", async () => {
		const fx = makeWinWrapperAppDir((srcDir) => {
			const exe = join(srcDir, "bin", "launcher.exe");
			mkdirSync(dirname(exe), { recursive: true });
			writeFileSync(exe, "");
		});
		const before = snapshotTree(fx.root);
		const childPid = 78010;
		const killed = new Set<number>();
		const { spawnFn, calls } = fakeSpawn(childPid, null);
		let capturedSandbox: string | null = null;
		try {
			const result = await runSmoke(
				{ appDir: fx.root, port: 17422, timeoutMs: 1_000, log: null, keepHome: false },
				{
					platform: "win32",
					spawn: (launcher: string, args: unknown[], opts: { env: Record<string, string> }) => {
						// Canonicalize while the sandbox still exists (cleanup
						// removes it before the assertions run).
						capturedSandbox = realpathSync.native(dirname(opts.env.PINAR_HOME));
						return spawnFn(launcher, args, opts);
					},
					parentOf: async () => null,
					isAlive: async (pid) => !killed.has(pid) && pid === childPid,
					imageOf: async () => null,
					killTree: async (pid) => {
						killed.add(pid);
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(calls).toHaveLength(1);
			expect(calls[0]).not.toBe(fx.wrapperLauncher);
			expect(capturedSandbox).not.toBeNull();
			expect(result.launchDir).toBe(join(capturedSandbox!, "extracted"));
			expect(calls[0]).toBe(join(result.launchDir, "bin", "launcher.exe"));
			expect(result.launcher).toBe(calls[0]);
			expect(snapshotTree(fx.root)).toEqual(before);
			// The launcher (this run's child) is killed by cleanup.
			expect(result.cleanup.killed).toContain(childPid);
			expect(result.cleanup.errors).toEqual([]);
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	}, 60_000);

	test("a traversal payload fails closed (spawn 0 / kill 0)", async () => {
		const fx = makeWinWrapperAppDir((srcDir) => {
			mkdirSync(srcDir, { recursive: true });
			// A member so the (replaced) wrapper payload packs as a real
			// archive: bsdtar refuses a zero-member `tar -cf`.
			writeFileSync(join(srcDir, "stub.txt"), "stub\n");
		});
		// Replace the real payload with the malicious one.
		zstFromPlain(fx.payloadFile, tarArchive(tarEntry("../../pinar-smoke-escape-file", Buffer.from("boom\n"))));
		const before = snapshotTree(fx.root);
		const sandboxesBefore = smokeSandboxes();
		const spawnCalls: string[] = [];
		const killCalls: number[] = [];
		try {
			const result = await runSmoke(
				{ appDir: fx.root, port: 17422, timeoutMs: 1_000, log: null, keepHome: false },
				{
					platform: "win32",
					spawn: (launcher: string) => {
						spawnCalls.push(launcher);
						throw new Error("spawn must not run");
					},
					parentOf: async () => null,
					isAlive: async () => false,
					imageOf: async () => null,
					killTree: async (pid: number) => {
						killCalls.push(pid);
						throw new Error("killTree must not run");
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(result.ok).toBe(false);
			expect(result.reason).toMatch(/"\.\." segment in entry name/);
			expect(spawnCalls).toHaveLength(0);
			expect(killCalls).toHaveLength(0);
			expect(result.cleanup.killed).toEqual([]);
			expect(smokeSandboxes()).toEqual(sandboxesBefore);
			expect(snapshotTree(fx.root)).toEqual(before);
			expect(existsSync(join(tmpdir(), "pinar-smoke-escape-file"))).toBe(false);
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
			rmSync(join(tmpdir(), "pinar-smoke-escape-file"), { force: true });
		}
	}, 60_000);
});

describe("tray ancestry diagnostic", () => {
	test("a fresh live tray pid outside the tree reports a bounded trayAncestry; nothing extra is killed", async () => {
		const appDir = makeAppDir();
		const childPid = 78020;
		const trayPid = 78021;
		const killCalls: number[] = [];
		const killed = new Set<number>();
		const { spawnFn } = fakeSpawn(childPid, trayPid);
		try {
			const result = await runSmoke(
				{ appDir, port: 17423, timeoutMs: 1_000, log: null, keepHome: false },
				{
					spawn: spawnFn,
					// trayPid → 555 → 1 (init): the chain stops at 1.
					parentOf: async (pid) => (pid === trayPid ? 555 : 1),
					isAlive: async (pid) => (killed.has(pid) ? false : pid === childPid || pid === trayPid),
					imageOf: async () => null,
					killTree: async (pid) => {
						killCalls.push(pid);
						killed.add(pid);
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(result.ok).toBe(false);
			expect(result.reason).toBe(`tray.pid pid ${trayPid} is outside the launched process tree`);
			// Bounded chain from the tray pid upward, stopping at 1 (excluded).
			expect(result.trayAncestry).toEqual([trayPid, 555]);
			// Nothing extra killed: only the launcher this run spawned.
			expect(killCalls).toEqual([childPid]);
			expect(result.cleanup.killed).toEqual([childPid]);
			expect(result.cleanup.refused.some((entry) => entry.includes(String(trayPid)))).toBe(true);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("a repeating ancestry stops without looping", async () => {
		const appDir = makeAppDir();
		const childPid = 78025;
		const trayPid = 78026;
		const killed = new Set<number>();
		const { spawnFn } = fakeSpawn(childPid, trayPid);
		try {
			const result = await runSmoke(
				{ appDir, port: 17423, timeoutMs: 1_000, log: null, keepHome: false },
				{
					spawn: spawnFn,
					// A cycle: trayPid → 600 → trayPid.
					parentOf: async (pid) => (pid === trayPid ? 600 : trayPid),
					isAlive: async (pid) => (killed.has(pid) ? false : pid === childPid || pid === trayPid),
					imageOf: async () => null,
					killTree: async (pid) => {
						killed.add(pid);
					},
					listeningPid: () => null,
					probeHealth: async () => ({ healthy: false }),
				},
			);
			expect(result.ok).toBe(false);
			expect(result.trayAncestry).toEqual([trayPid, 600]);
			expect(result.cleanup.killed).toEqual([childPid]);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);

	test("the success path carries no trayAncestry claim", async () => {
		const appDir = makeAppDir();
		const childPid = 78022;
		const trayPid = 78023;
		const killed = new Set<number>();
		const { spawnFn } = fakeSpawn(childPid, trayPid);
		let healthCalls = 0;
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17424, timeoutMs: 2_000, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async (pid) => (pid === trayPid ? childPid : null),
					isAlive: async (pid) => (killed.has(pid) ? false : pid === childPid || pid === trayPid),
					imageOf: async () => null,
					killTree: async (pid) => {
						killed.add(pid);
					},
					listeningPid: () => null,
					probeHealth: async () => {
						healthCalls += 1;
						return { healthy: healthCalls > 1 };
					},
				},
			);
			expect(result.ok).toBe(true);
			expect(result.jsExecuted).toBe(true);
			expect(result.trayAncestry).toBeUndefined();
		} finally {
			if (result?.sandbox != null) rmSync(result.sandbox, { recursive: true, force: true });
			rmSync(appDir, { recursive: true, force: true });
		}
	}, 60_000);
});

describe("ustar prefix field (amendment 1)", () => {
	// Real zstd + tar extraction: the 5 s default is too tight under host load.
	test("a real archive entry split across prefix+name is validated as one path and extracted", async () => {
		// name "launcher" + prefix "Pinar.app/Contents/MacOS": the joined path
		// is inside the archive root and must extract for real.
		const plain = tarArchive(tarEntry("launcher", Buffer.from("#!/bin/sh\n"), { prefix: "Pinar.app/Contents/MacOS" }));
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-pre-"));
		const payload = join(root, "payload.tar.zst");
		const dest = join(root, "dest");
		mkdirSync(dest, { recursive: true });
		try {
			zstFromPlain(payload, plain);
			await expect(extractWrapperPayload(payload, dest, { scratchDir: root })).resolves.toBeUndefined();
			expect(existsSync(join(dest, "Pinar.app", "Contents", "MacOS", "launcher"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);

	test("a prefix + name containing .. is rejected and nothing is written", async () => {
		const plain = tarArchive(tarEntry("evil", Buffer.from("x\n"), { prefix: "../escape" }));
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-pre2-"));
		const payload = join(root, "payload.tar.zst");
		const dest = join(root, "dest");
		mkdirSync(dest, { recursive: true });
		const escape = join(dirname(root), "escape", "evil");
		try {
			zstFromPlain(payload, plain);
			await expect(extractWrapperPayload(payload, dest, { scratchDir: root })).rejects.toThrow(/\.\./);
			// Validation precedes ANY write: dest is empty, the escape target
			// does not exist.
			expect(readdirSync(dest)).toEqual([]);
			expect(existsSync(escape)).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
			rmSync(join(dirname(root), "escape"), { recursive: true, force: true });
		}
	});
});

describe("tar/zstd fail-closed branches", () => {
	// A tar that must never run: every rejection below throws before the
	// spawn. If a branch were bypassed, spawnSync would fail differently
	// (status null -> "tar -xf exited with null") and wrapper-payload.tar
	// would appear in scratchDir.
	function fixture(prefix: string) {
		const root = mkdtempSync(join(tmpdir(), `pinar-smoke-${prefix}-`));
		const payload = join(root, "payload.tar.zst");
		const dest = join(root, "dest");
		mkdirSync(dest, { recursive: true });
		const tarCommand = join(root, "must-not-run");
		return { root, payload, dest, tarCommand };
	}

	// One end-to-end rejection: write a REAL .tar.zst, extract with the dead
	// tar, assert the rejection names the branch, and prove fail-before-
	// spawn/kill/write: the destination stays empty, wrapper-payload.tar is
	// never written to scratchDir, and the payload artifact is
	// byte-for-byte unchanged.
	async function expectFailClosed(
		fx: { root: string; payload: string; dest: string; tarCommand: string },
		plain: Buffer,
		reason: RegExp,
		extraOptions: Record<string, unknown> = {},
	): Promise<void> {
		zstFromPlain(fx.payload, plain);
		const before = createHash("sha256").update(readFileSync(fx.payload)).digest("hex");
		await expect(
			extractWrapperPayload(fx.payload, fx.dest, {
				scratchDir: fx.root,
				tarCommand: fx.tarCommand,
				...extraOptions,
			}),
		).rejects.toThrow(reason);
		expect(readdirSync(fx.dest)).toEqual([]);
		expect(existsSync(join(fx.root, "wrapper-payload.tar"))).toBe(false);
		expect(createHash("sha256").update(readFileSync(fx.payload)).digest("hex")).toBe(before);
	}

	// Control: a regular file and a directory built with the same builder
	// are accepted, so the negative tests below reject the typeflag itself,
	// not the builder (checksum, name or shape).
	test("control: regular-file and directory entries built with the same builder are accepted", () => {
		expect(validatePlainTar(tarArchive(tarEntry("safe.txt", Buffer.from("x\n"))))).toBe(1);
		expect(validatePlainTar(tarArchive(tarEntry("dir/", Buffer.alloc(0), { type: "5" })))).toBe(1);
	});

	// SM-3 (security S7): NTFS strips trailing dots/spaces from names, so
	// `foo. ` collapses to `foo` (collision) and `.. ` collapses to `..`
	// (escape) once the OS strips them. Every segment that ends with a dot
	// or a space, consists only of dots/spaces, or is `.` / `..` is
	// rejected — on every platform — before the tar ever runs.
	const sm3Cases: Array<[string, RegExp]> = [
		// The review regression: the segment `".. "` (a dot run with a
		// trailing space) is not the literal `..` — it is the trailing-space
		// rule that catches it (the mutation that drops that rule accepts it).
		[".. /escaped.txt", /segment "\.\. " ends with a dot or space in entry name/],
		["foo.", /segment "foo\." ends with a dot or space in entry name/],
		["bar ", /segment "bar " ends with a dot or space in entry name/],
		["Pinar/app.log ", /ends with a dot or space in entry name/],
		["Pinar/.", /"\." segment in entry name/],
		["Pinar/app/./helper", /"\." segment in entry name/],
		["..", /"\.\." segment in entry name/],
		["Pinar/..", /"\.\." segment in entry name/],
		["Pinar/a.. /b.txt", /ends with a dot or space in entry name/], // trailing space on a mid segment
	];
	for (const [name, reason] of sm3Cases) {
		test(`SM-3: the tar name ${JSON.stringify(name)} is rejected before the tar runs`, async () => {
			const fx = fixture("sm3");
			try {
				await expectFailClosed(
					fx,
					tarArchive(tarEntry(name, Buffer.from("x\n"))),
					reason,
				);
			} finally {
				rmSync(fx.root, { recursive: true, force: true });
			}
		}, 60_000);
	}

	test("SM-3 control: interior, leading and adjacent dots are still safe names", () => {
		expect(validatePlainTar(tarArchive(tarEntry("a..b.txt", Buffer.from("x\n"))))).toBe(1);
		expect(validatePlainTar(tarArchive(tarEntry("..foo.txt", Buffer.from("x\n"))))).toBe(1);
		expect(validatePlainTar(tarArchive(tarEntry("Pinar/bin/Pinar.exe", Buffer.from("x\n"))))).toBe(1);
	});

	// Each device/pax/GNU typeflag is rejected on the typeflag alone: the
	// header has a VALID checksum and a safe name.
	const typeflagCases: Array<[string, string, RegExp]> = [
		["3", "character device", /unsupported tar entry type "3"/],
		["4", "block device", /unsupported tar entry type "4"/],
		["6", "fifo", /unsupported tar entry type "6"/],
		["x", "pax extended header", /unsupported tar entry type "x"/],
		["g", "pax global header", /unsupported tar entry type "g"/],
		["L", "GNU long name", /unsupported tar entry type "L"/],
		["K", "GNU long link", /unsupported tar entry type "K"/],
	];
	for (const [type, label, reason] of typeflagCases) {
		test(`a ${label} entry (typeflag ${type}) is rejected, nothing is spawned or written`, async () => {
			const fx = fixture("tzf");
			try {
				await expectFailClosed(
					fx,
					tarArchive(tarEntry("safe.txt", Buffer.from("x\n"), { type })),
					reason,
				);
			} finally {
				rmSync(fx.root, { recursive: true, force: true });
			}
		}, 60_000);
	}

	test("data after the terminator block is rejected, nothing is spawned or written", async () => {
		const fx = fixture("tzt");
		try {
			// A valid entry, the standard two zero blocks, then a VALID
			// header: data after the terminator.
			const plain = Buffer.concat([
				tarArchive(tarEntry("a.txt", Buffer.from("a\n"))),
				tarEntry("b.txt", Buffer.from("b\n")),
			]);
			await expectFailClosed(fx, plain, /data after the terminator/);
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	}, 60_000);

	test("control: extra zero padding after the terminator is accepted", () => {
		const padded = Buffer.concat([
			tarArchive(tarEntry("a.txt", Buffer.from("a\n"))),
			Buffer.alloc(1024),
		]);
		expect(validatePlainTar(padded)).toBe(1);
	});

	// The entry cap is test-only configurable downward (never above the
	// production default) and rejects with the effective cap.
	test("an archive over options.maxEntries is rejected with the effective cap", async () => {
		const fx = fixture("ten");
		try {
			const plain = tarArchive(
				tarEntry("a.txt", Buffer.from("a\n")),
				tarEntry("b.txt", Buffer.from("b\n")),
				tarEntry("c.txt", Buffer.from("c\n")),
			);
			await expectFailClosed(fx, plain, /more than 2 entries/, { maxEntries: 2 });
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	}, 60_000);

	test("control: the same archive is accepted at its entry count and with the default cap", () => {
		const plain = tarArchive(
			tarEntry("a.txt", Buffer.from("a\n")),
			tarEntry("b.txt", Buffer.from("b\n")),
			tarEntry("c.txt", Buffer.from("c\n")),
		);
		expect(validatePlainTar(plain)).toBe(3);
		expect(validatePlainTar(plain, { maxEntries: 3 })).toBe(3);
	});

	test("cap options validate: positive integers not above the defaults", async () => {
		const one = tarArchive(tarEntry("a.txt", Buffer.from("a\n")));
		for (const bad of [0, -1, 4096.5, "4096", MAX_WRAPPER_ENTRIES + 1]) {
			expect(() => validatePlainTar(one, { maxEntries: bad })).toThrow(
				`options.maxEntries must be a positive integer not above ${MAX_WRAPPER_ENTRIES}`,
			);
		}
		expect(validatePlainTar(one, { maxEntries: 1 })).toBe(1);
		for (const bad of [0, -1, 4096.5, "4096", MAX_WRAPPER_DECOMPRESSED_BYTES + 1]) {
			await expect(
				extractWrapperPayload("missing.tar.zst", "missing-dest", { maxDecompressedBytes: bad }),
			).rejects.toThrow(
				`options.maxDecompressedBytes must be a positive integer not above ${MAX_WRAPPER_DECOMPRESSED_BYTES}`,
			);
		}
	});

	// The zstd frame header declares the content size (RFC 8878 §3.1.1.1.4,
	// cross-verified against the zstd CLI and Bun's compressor): the parser
	// reads it, and the undeclared/skippable/unknown cases return null (the
	// post-decompression check stays the guard).
	test("the frame header parse: declared sizes and the undeclared, skippable and unknown cases", () => {
		// Real frames from the same compressor the payload is built with:
		const smallFrame = Buffer.from(Bun.zstdCompressSync(Buffer.alloc(1024, 7)));
		expect(zstdDeclaredContentSize(smallFrame)).toBe(1024);
		// Precise 2-byte FCS boundary values (RFC 8878 §3.1.1.1.4: the
		// 2-byte field is offset by 256, so size = value + 256):
		expect(zstdDeclaredContentSize(Buffer.from(Bun.zstdCompressSync(Buffer.alloc(256, 7))))).toBe(256);
		expect(zstdDeclaredContentSize(Buffer.from(Bun.zstdCompressSync(Buffer.alloc(1000, 7))))).toBe(1000);
		const bigFrame = Buffer.from(Bun.zstdCompressSync(Buffer.alloc(70000, 9)));
		expect(zstdDeclaredContentSize(bigFrame)).toBe(70000);
		// A 4-byte FCS with a window descriptor (single-segment cleared):
		const windowed = Buffer.concat([
			Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
			Buffer.from([0x80]), // 4-byte FCS, window descriptor present
			Buffer.from([0x58]), // window descriptor
			Buffer.from([0x00, 0x00, 0x40, 0x00]), // 4 MiB, little-endian
			Buffer.alloc(8),
		]);
		expect(zstdDeclaredContentSize(windowed)).toBe(4 * 1024 * 1024);
		// Undeclared: FCS flag cleared (a window descriptor, no FCS field):
		const undeclared = Buffer.concat([
			Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
			Buffer.from([0x04]),
			Buffer.alloc(8),
		]);
		expect(zstdDeclaredContentSize(undeclared)).toBeNull();
		// A skippable frame and an unknown magic are not normal frames:
		expect(zstdDeclaredContentSize(Buffer.from([0x50, 0x2a, 0x4d, 0x18, 0x01, 0x00, 0x00, 0x00, 0xab]))).toBeNull();
		expect(zstdDeclaredContentSize(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toBeNull();
		// Too short to hold magic + descriptor:
		expect(zstdDeclaredContentSize(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))).toBeNull();
	});

	// A frame declaring a content size above the configured cap is rejected
	// BEFORE the decompressor is called: the expansion is never allocated.
	test("a frame declaring a content size above the cap is rejected before the decompressor is called", async () => {
		const fx = fixture("tzc");
		try {
			// One 5000-byte entry: plain tar = 512 + 5120 + 1024 = 6656 >
			// 4096, and the real frame Bun writes declares exactly that size.
			const plain = tarArchive(tarEntry("big.txt", Buffer.alloc(5000, 7)));
			zstFromPlain(fx.payload, plain);
			let decompressCalls = 0;
			await expect(
				extractWrapperPayload(fx.payload, fx.dest, {
					scratchDir: fx.root,
					tarCommand: fx.tarCommand,
					maxDecompressedBytes: 4096,
					zstdDecompress: () => {
						decompressCalls += 1;
						throw new Error("the decompressor must not be called");
					},
				}),
			).rejects.toThrow(/declares a zstd content size of \d+ bytes, above the 4096 byte decompression cap/);
			expect(decompressCalls).toBe(0);
			expect(readdirSync(fx.dest)).toEqual([]);
			expect(existsSync(join(fx.root, "wrapper-payload.tar"))).toBe(false);
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	}, 60_000);

	// A REAL .tar.zst whose expansion exceeds the small configured cap is
	// rejected with the cap message (before spawn/kill/write), whatever
	// guard fires: the declared-size pre-check or the post-decompression
	// check.
	test("a real .tar.zst expanding above the configured cap is rejected with the cap message", async () => {
		const fx = fixture("tzc2");
		try {
			const plain = tarArchive(tarEntry("big.txt", Buffer.alloc(5000, 7)));
			await expectFailClosed(fx, plain, /above the 4096 byte decompression cap/, {
				maxDecompressedBytes: 4096,
			});
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	}, 60_000);

	// The post-decompression cap is the guard when the frame declares no
	// (or a smaller) content size than the actual expansion: the decompressor
	// spy returns a real plain tar larger than the cap even though the
	// frame's declared size is under it.
	test("the post-decompression cap rejects when the actual expansion exceeds the cap and the declared size does not", async () => {
		const fx = fixture("tzc3");
		try {
			// A real frame whose declared size (2048) is under the cap:
			zstFromPlain(fx.payload, tarArchive(tarEntry("a.txt", Buffer.from("a\n"))));
			const before = createHash("sha256").update(readFileSync(fx.payload)).digest("hex");
			// ...but the decompressed result is a real plain tar of 6656
			// bytes (one 5000-byte entry), above the 4096 cap:
			const oversized = tarArchive(tarEntry("big.txt", Buffer.alloc(5000, 7)));
			await expect(
				extractWrapperPayload(fx.payload, fx.dest, {
					scratchDir: fx.root,
					tarCommand: fx.tarCommand,
					maxDecompressedBytes: 4096,
					zstdDecompress: () => oversized,
				}),
			).rejects.toThrow(/expands to 6656 bytes, above the 4096 byte decompression cap/);
			expect(readdirSync(fx.dest)).toEqual([]);
			expect(existsSync(join(fx.root, "wrapper-payload.tar"))).toBe(false);
			expect(createHash("sha256").update(readFileSync(fx.payload)).digest("hex")).toBe(before);
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	}, 60_000);

	// Embedded fixture: a real 76-byte .tar.zst frame WITHOUT a
	// Frame_Content_Size (RFC 8878 §3.1.1.1.4: FCS_Flag 0b00, window
	// descriptor, no FCS field, checksum flag set). Provenance: generated
	// once with the job's tools/bin/zstd.exe 1.5.7, `zstd -q
	// --no-content-size -f <tar> -o nfc.tar.zst`, over the 2048-byte plain
	// tar built by the in-file tarEntry/tarArchive helpers (sha256 below);
	// `zstd -l` reports no uncompressed size and Bun decodes it to exactly
	// that tar. SM-5/F-1: the pre-check PROVES this shape (a single
	// structurally complete frame whose walk ends exactly at the input
	// length), returns null for the declared size and computes its
	// pre-allocation bound (2048 bytes for this fixture): a bound above
	// the cap rejects BEFORE decompression, and the post-decompression
	// cap remains the authoritative size guard.
	const NO_FCS_FIXTURE_B64 =
		"KLUv/QQI/QEAJAJhLnR4dAAwMDA2NDQwMDAyNjU1NgAgMAB1c3RhcgAwYQoACgD6gX8gQAHxhtQAkBi8uOkH1gBwrFxlJ1AEdCCYbg==";
	const NO_FCS_PLAIN_SHA256 = "483a674556ad2625826fbb6184749f996c17f4f2aac2e5f454cb9cc08b5e547f";

	test(
		"an undeclared-size frame: the pre-check proves the single frame and bounds its size; a bound above the cap rejects before the decompressor, the post-decompression cap still guards, and the default cap extracts",
		async () => {
		const fx = fixture("nfc");
		try {
			const compressed = Buffer.from(NO_FCS_FIXTURE_B64, "base64");
			writeFileSync(fx.payload, compressed);
			const before = createHash("sha256").update(compressed).digest("hex");
			// Provenance: the embedded frame is the zstd of the plain tar the
		// in-file helpers build:
			expect(createHash("sha256").update(Bun.zstdDecompressSync(compressed)).digest("hex")).toBe(NO_FCS_PLAIN_SHA256);
			expect(createHash("sha256").update(tarArchive(tarEntry("a.txt", Buffer.from("a\n")))).digest("hex")).toBe(NO_FCS_PLAIN_SHA256);
			// The header declares no content size (FCS_Flag 0b00, windowed):
			expect(zstdDeclaredContentSize(compressed)).toBeNull();
			// SM-5/F-1: the frame walk ACCEPTS this frame (a single
			// structurally complete frame: the walk proves frame end = input
			// length), returns null for the declared size and computes its
			// pre-allocation bound (2048 for this fixture):
			expect(validateZstdSingleFrame(compressed)).toBeNull();
			expect(zstdPreallocationBound(compressed)).toBe(2048);
			// F-1: a cap below the 2048-byte BOUND rejects BEFORE ANY
			// decompression (the decompressor is never called and nothing is
			// written) — closing the "the full output is allocated before the
			// cap" window for the one frame shape without a declared size:
			let decompressCalls = 0;
			await expect(
				extractWrapperPayload(fx.payload, fx.dest, {
					scratchDir: fx.root,
					tarCommand: fx.tarCommand,
					maxDecompressedBytes: 1024,
					zstdDecompress: (buf: Buffer) => {
						decompressCalls += 1;
						return Bun.zstdDecompressSync(buf);
					},
				}),
			).rejects.toThrow(/pre-allocation decompressed-size bound is 2048 bytes \(window \+ block walk\), above the 1024 byte decompression cap/);
			expect(decompressCalls).toBe(0);
			expect(readdirSync(fx.dest)).toEqual([]);
			expect(existsSync(join(fx.root, "wrapper-payload.tar"))).toBe(false);
			// …and when the bound is WITHIN the cap, the decompressor runs
			// and the POST-DECOMPRESSION cap remains the authoritative size
			// guard: a decompressor reporting a 5000-byte expansion (above
			// the 3000 cap — and above the 2048 bound) is rejected after
			// decompression, before spawn/kill/write:
			decompressCalls = 0;
			await expect(
				extractWrapperPayload(fx.payload, fx.dest, {
					scratchDir: fx.root,
					tarCommand: fx.tarCommand,
					maxDecompressedBytes: 3000,
					zstdDecompress: () => {
						decompressCalls += 1;
						return Buffer.alloc(5000, 0);
					},
				}),
			).rejects.toThrow(/expands to 5000 bytes, above the 3000 byte decompression cap/);
			expect(decompressCalls).toBe(1);
			expect(readdirSync(fx.dest)).toEqual([]);
			expect(existsSync(join(fx.root, "wrapper-payload.tar"))).toBe(false);
			expect(createHash("sha256").update(readFileSync(fx.payload)).digest("hex")).toBe(before);
			// Default cap: bound (2048) and expansion (2048) are both within
			// the unchanged 2 GiB default: the same bytes pass every
			// validation and extract normally with the real platform tar
			// (same style as the post-extraction containment tests):
			await extractWrapperPayload(fx.payload, fx.dest, { scratchDir: fx.root });
			expect(readFileSync(join(fx.dest, "a.txt"), "utf8")).toBe("a\n");
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	}, 60_000);

	// Dictionary_ID (descriptor bits 1-0: a 0/1/2/4-byte field between the
	// [Window_Descriptor] and the FCS_Field; the real decoders accept it in
	// both segment modes): zero dictionary IDs of each size are inserted
	// into a real Bun-compressed single-segment frame's header (DID_Flag
	// set, field right after the descriptor). Bun decodes each crafted frame
	// to exactly the plain tar, and the parser returns the exact plain size
	// — the P2 from review rv-rt-s3 was this field being skipped by the FCS
	// offset (a one-byte zero Dictionary_ID on a 9 MiB frame mis-declared
	// 2,415,919,104 bytes).
	test("a frame with a one-, two- or four-byte Dictionary_ID declares the exact content size", () => {
		const plain = tarArchive(tarEntry("a.txt", Buffer.from("a\n")));
		const frame = Buffer.from(Bun.zstdCompressSync(plain));
		// A real single-segment 2-byte-FCS frame: pin the shape the crafting
		// relies on (descriptor 0x60).
		expect(frame[4] & 0x03).toBe(0); // no Dictionary_ID yet
		expect(frame[4] & 0x20).not.toBe(0); // single-segment
		expect((frame[4] >> 6) & 0x03).toBe(1); // 2-byte FCS field
		const plainSha = createHash("sha256").update(plain).digest("hex");
		for (const [didFlag, didLength] of [[1, 1], [2, 2], [3, 4]] as const) {
			const crafted = Buffer.concat([
				frame.subarray(0, 4), // magic
				Buffer.from([frame[4] | didFlag]), // descriptor + the DID flag
				Buffer.alloc(didLength, 0), // zero dictionary ID
				frame.subarray(5), // the 2-byte FCS and the blocks, unchanged
			]);
			expect(createHash("sha256").update(Bun.zstdDecompressSync(crafted)).digest("hex")).toBe(plainSha);
			expect(zstdDeclaredContentSize(crafted)).toBe(plain.length);
		}
	});

	// End-to-end: the same one-byte zero Dictionary_ID frame of a small real
	// tar passes the pre-check at the DEFAULT cap and extracts normally with
	// the real platform tar (before the Dictionary_ID offset fix, the
	// reviewer's 9 MiB variant of this frame mis-declared 2,415,919,104
	// bytes and was falsely rejected before decompression — review
	// rv-rt-s3).
	// SM-5: a Dictionary_ID is rejected by the pre-allocation frame walk
	// BEFORE the decompressor is called (RFC 8878 allows it in real
	// decoders, but the payload is a single self-built frame — a DID is a
	// shape that must never appear here).
	test("SM-5: a one-byte Dictionary_ID frame is rejected before the decompressor is called", async () => {
		const fx = fixture("did");
		try {
			const plain = tarArchive(tarEntry("a.txt", Buffer.from("a\n")));
			const frame = Buffer.from(Bun.zstdCompressSync(plain));
			const crafted = Buffer.concat([
				frame.subarray(0, 4),
				Buffer.from([frame[4] | 0x01]), // one-byte Dictionary_ID flag
				Buffer.from([0x00]), // zero dictionary ID
				frame.subarray(5),
			]);
			writeFileSync(fx.payload, crafted);
			expect(createHash("sha256").update(Bun.zstdDecompressSync(crafted)).digest("hex")).toBe(
				createHash("sha256").update(plain).digest("hex"),
			);
			let decompressCalls = 0;
			await expect(
				extractWrapperPayload(fx.payload, fx.dest, {
					scratchDir: fx.root,
					tarCommand: fx.tarCommand,
					zstdDecompress: () => {
						decompressCalls += 1;
						return plain;
					},
				}),
			).rejects.toThrow(/dictionary id \(flag 0b1\) rejected/);
			expect(decompressCalls).toBe(0); // rejected before ANY allocation
			expect(readdirSync(fx.dest)).toEqual([]);
			expect(existsSync(join(fx.root, "wrapper-payload.tar"))).toBe(false);
		} finally {
			rmSync(fx.root, { recursive: true, force: true });
		}
	}, 60_000);

	// The windowed FCS forms the corrected comment names: a 2-byte field
	// (FCS_Flag 0b01, size = value + 256) and a 4-byte field (FCS_Flag
	// 0b10, exact) both parse to the exact content size. The 8-byte form
	// (FCS_Flag 0b11) is not parsed and returns null.
	test("windowed frames with 2-byte and 4-byte FCS fields declare the exact content size", () => {
		const plain = tarArchive(tarEntry("a.txt", Buffer.from("a\n")));
		const frame = Buffer.from(Bun.zstdCompressSync(plain));
		const plainSha = createHash("sha256").update(plain).digest("hex");
		// Windowed 2-byte FCS (the field's value + 256 = the size):
		const twoByte = Buffer.concat([frame.subarray(0, 4), Buffer.from([frame[4] & 0xdf, 0x18]), frame.subarray(5)]);
		expect(createHash("sha256").update(Bun.zstdDecompressSync(twoByte)).digest("hex")).toBe(plainSha);
		expect(zstdDeclaredContentSize(twoByte)).toBe(plain.length);
		// Windowed 4-byte FCS (exact): widen the 2-byte field's size
		// (value + 256) to the exact 4-byte little-endian value:
		const exactSize = frame[5] + frame[6] * 256 + 256;
		const fourByte = Buffer.concat([
			frame.subarray(0, 4),
			Buffer.from([(frame[4] & 0x1f) | 0x80, 0x18]),
			Buffer.from([exactSize & 0xff, (exactSize >> 8) & 0xff, 0x00, 0x00]),
			frame.subarray(7),
		]);
		expect(createHash("sha256").update(Bun.zstdDecompressSync(fourByte)).digest("hex")).toBe(plainSha);
		expect(zstdDeclaredContentSize(fourByte)).toBe(plain.length);
	});

	// The two FCS forms the suite did not lock (review rv-fin-rt finding 1):
	// the 1-byte single-segment field (FCS_Flag 0b00 — exact size, RFC 8878
	// §3.1.1.1) and the 8-byte form (FCS_Flag 0b11 — not parsed; null).
	// Mutants that skip the 1-byte read or parse the 8-byte form instead of
	// returning null go assertion-red here.
	test("a 1-byte single-segment FCS field declares the exact content size", () => {
		// descriptor 0x20: single-segment (0b00100000), FCS_Flag 0b00, no Dictionary_ID
		const oneByte = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, 0x2a]);
		expect(zstdDeclaredContentSize(oneByte)).toBe(42);
		expect(zstdDeclaredContentSize(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20, 0xff]))).toBe(255);
		// Truncated: the FCS byte is missing.
		expect(zstdDeclaredContentSize(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x20]))).toBeNull();
		// FCS_Flag 0b00 on a WINDOWED frame declares no size (the 1-byte
		// field is a single-segment-only form).
		expect(zstdDeclaredContentSize(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x18, 0x2a]))).toBeNull();
	});

	test("FCS_Flag 0b11 (the 8-byte form) is not parsed and returns null", () => {
		// Windowed, no Dictionary_ID: descriptor 0xC0 (0b11000000) + a window byte.
		expect(zstdDeclaredContentSize(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xc0, 0x18]))).toBeNull();
		// Windowed + a one-byte Dictionary_ID: descriptor 0xC1.
		expect(zstdDeclaredContentSize(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xc1, 0x18, 0x00]))).toBeNull();
		// Windowed + a four-byte Dictionary_ID: descriptor 0xC3.
		expect(zstdDeclaredContentSize(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xc3, 0x18, 0x00, 0x00, 0x00]))).toBeNull();
		// Padded long enough for a mutant that parses the 8-byte field to
		// read it and return a number: the correct parser returns null.
		const padded = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xc0, 0x18, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
		expect(zstdDeclaredContentSize(padded)).toBeNull();
	});
});

/**
 * SM-5 (security S9) + F-1: pre-allocation zstd frame validation.
 * `bytes` must be EXACTLY ONE normal zstd frame ending exactly at the
 * input end; every shape the walk cannot prove is rejected BEFORE any
 * decompression (allocation). The NO_FCS fixture (the embedded base64
 * frame — a windowed frame whose FCS_Flag 0b00 declares no content
 * size) is the one accepted shape without a declared size: the walk
 * proves it a single structurally complete frame (frame end = input
 * length) and its pre-allocation bound (the window + block walk sum,
 * see zstdPreallocationBound) is checked against the cap before
 * decompression; the post-decompression cap remains the authoritative
 * size guard.
 */
describe("validateZstdSingleFrame (SM-5 pre-allocation frame walk)", () => {
	const NO_FCS_FIXTURE_B64 =
		"KLUv/QQI/QEAJAJhLnR4dAAwMDA2NDQwMDAyNjU1NgAgMAB1c3RhcgAwYQoACgD6gX8gQAHxhtQAkBi8uOkH1gBwrFxlJ1AEdCCYbg==";
	const realFrame = () => Buffer.from(Bun.zstdCompressSync(tarArchive(tarEntry("a.txt", Buffer.from("a\n")))));

	test("a real single-segment frame passes and returns its declared size", () => {
		const frame = realFrame();
		expect(validateZstdSingleFrame(frame)).toBe(tarArchive(tarEntry("a.txt", Buffer.from("a\n"))).length);
		// The default cap is the unchanged 2 GiB:
		expect(() => validateZstdSingleFrame(frame, 16)).toThrow(/above the 16 byte decompression cap/);
		expect(validateZstdSingleFrame(frame, 2 * 1024 * 1024 * 1024)).not.toBeNull();
	});

	test("the no-content-size windowed fixture passes the walk (frame end = input length) and returns null", () => {
		const compressed = Buffer.from(NO_FCS_FIXTURE_B64, "base64");
		// The walk proves a single structurally complete frame; the declared
		// size is null (FCS_Flag 0b00 on a windowed frame), the pre-
		// allocation bound is computed, and the post-decompression cap
		// remains the authoritative size guard.
		expect(validateZstdSingleFrame(compressed)).toBeNull();
		expect(zstdDeclaredContentSize(compressed)).toBeNull();
		expect(zstdPreallocationBound(compressed)).toBe(2048);
	});

	test("a skippable frame is rejected", () => {
		expect(() =>
			validateZstdSingleFrame(Buffer.from([0x50, 0x2a, 0x4d, 0x18, 0x01, 0x00, 0x00, 0x00, 0xab])),
		).toThrow(/skippable frame/);
	});

	test("a non-zstd magic is rejected", () => {
		expect(() => validateZstdSingleFrame(Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]))).toThrow(/not a zstd frame/);
		expect(() => validateZstdSingleFrame(Buffer.alloc(0))).toThrow(/empty input/);
	});

	test("a dictionary id is rejected", () => {
		const frame = realFrame();
		const crafted = Buffer.concat([frame.subarray(0, 4), Buffer.from([frame[4] | 0x03]), Buffer.alloc(4, 0), frame.subarray(5)]);
		expect(() => validateZstdSingleFrame(crafted)).toThrow(/dictionary id/);
	});

	test("more than one frame / trailing bytes are rejected", () => {
		const frame = realFrame();
		// Two complete frames concatenated: the walk stops at the first frame
		// end and finds trailing bytes (the second frame).
		expect(() => validateZstdSingleFrame(Buffer.concat([frame, frame]))).toThrow(/trailing bytes or more than one frame/);
		// A single trailing NUL byte after a complete frame:
		expect(() => validateZstdSingleFrame(Buffer.concat([frame, Buffer.alloc(1, 0)]))).toThrow(/trailing bytes or more than one frame/);
	});

	test("a reserved block type is rejected", () => {
		// A single-segment frame whose only block uses the reserved type 3:
		// block header word = size<<3 | type=0b11 | last=1. size 5, type 3,
		// last block → (5 << 3) | 3 | 1 = 0x2B; little-endian 3 bytes.
		const crafted = Buffer.concat([
			Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
			Buffer.from([0x60]), // descriptor: 2-byte FCS, no window, no checksum, no DID
			Buffer.from([0x05, 0x00]), // FCS = 5 + 256 = 261 (the size is irrelevant to the walk)
			Buffer.from([0x2f, 0x00, 0x00]), // reserved block, last (word = (5<<3)|(3<<1)|1 = 0x2F)
			Buffer.alloc(5),
		]);
		expect(() => validateZstdSingleFrame(crafted)).toThrow(/reserved block type/);
	});

	test("a block that runs past the input is rejected", () => {
		// Block header claims 100 bytes of raw data but only 5 are present:
		const crafted = Buffer.concat([
			Buffer.from([0x28, 0xb5, 0x2f, 0xfd]),
			Buffer.from([0x60]),
			Buffer.from([0x05, 0x00]),
			Buffer.from([0x21, 0x03, 0x00]), // raw block, size 100, last (word = (100<<3)|0|1 = 0x0321)
			Buffer.alloc(5),
		]);
		expect(() => validateZstdSingleFrame(crafted)).toThrow(/block data runs past the input/);
	});

	test("a truncated frame header is rejected", () => {
		expect(() => validateZstdSingleFrame(Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))).toThrow(/truncated frame header/);
		// Magic + descriptor only (no window descriptor for a windowed frame):
		expect(() => validateZstdSingleFrame(Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x04]))).toThrow(/truncated frame header/);
	});

	test("a checksum-flagged frame consumes the 4-byte content checksum at the frame end", () => {
		// A real frame with the checksum flag set: the walk must consume the
		// trailing 4-byte checksum (a walker that forgets it sees trailing
		// bytes and rejects the valid frame).
		const plain = tarArchive(tarEntry("a.txt", Buffer.from("a\n")));
		const frame = Buffer.from(Bun.zstdCompressSync(plain));
		const withFlag = Buffer.from(frame);
		withFlag[4] |= 0x04; // set the Checksum_Flag (0b100)
		const checksummed = Buffer.concat([withFlag, Buffer.from([0xde, 0xad, 0xbe, 0xef])]);
		expect(() => validateZstdSingleFrame(checksummed)).not.toThrow();
		// …and the same bytes WITHOUT the trailing 4 checksum bytes are a
		// truncated frame:
		expect(() => validateZstdSingleFrame(withFlag)).toThrow(/checksum runs past the input/);
	});
});

describe("F-1: the pre-allocation decompressed-size bound (frames without a declared size)", () => {
	/** A structurally valid WINDOWED, no-FCS (FCS_Flag 0b00) frame: magic,
	 * descriptor 0x00, the given Window_Descriptor, then the block list.
	 * Block types: 0 raw (size data bytes), 1 RLE (size = regenerated size,
	 * 1 data byte), 2 compressed (size data bytes). */
	function windowedNoFcsFrame(windowDescriptor: number, blocks: { type: number; size: number }[]): Buffer {
		const parts: Buffer[] = [Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00, windowDescriptor])];
		blocks.forEach((block, i) => {
			const word = (block.size << 3) | (block.type << 1) | (i === blocks.length - 1 ? 1 : 0);
			const header = Buffer.alloc(3);
			header.writeUInt16LE(word & 0xffff, 0);
			header[2] = (word >> 16) & 0xff;
			parts.push(header, Buffer.alloc(block.type === 1 ? 1 : block.size, 0x01));
		});
		return Buffer.concat(parts);
	}

	test("the bound arithmetic: window exponent/mantissa, raw and RLE exact, compressed capped", () => {
		const blocks = [
			{ type: 2, size: 100 },
			{ type: 2, size: 40 },
			{ type: 0, size: 50 }, // raw → contributes exactly 50
			{ type: 1, size: 3000 }, // RLE → contributes exactly its regenerated size
		];
		// exponent 0, mantissa 0 → windowLog 10, windowBase 1024,
		// windowAdd 0 → Window_Size 1024 → Block_Maximum_Size 1024.
		expect(zstdPreallocationBound(windowedNoFcsFrame(0x00, blocks))).toBe(2 * 1024 + 50 + 3000);
		// exponent 3, mantissa 5 → windowLog 13, windowBase 8192,
		// windowAdd (8192/8)*5 = 5120 → Window_Size 13312 →
		// Block_Maximum_Size 13312 (below 128 KiB).
		expect(zstdPreallocationBound(windowedNoFcsFrame((3 << 3) | 5, blocks))).toBe(2 * 13312 + 50 + 3000);
		// exponent 9, mantissa 7 → windowLog 19, windowBase 524288,
		// windowAdd (524288/8)*7 = 458752 → Window_Size 983040 →
		// Block_Maximum_Size min(983040, 128 KiB) = 131072.
		expect(zstdPreallocationBound(windowedNoFcsFrame((9 << 3) | 7, blocks))).toBe(2 * 131072 + 50 + 3000);
	});

	test("a no-FCS frame whose bound exceeds the injected cap is rejected BEFORE the decompressor is called", async () => {
		// 20 compressed blocks × Block_Maximum_Size 131072 = 2621440,
		// above the injected 1 MiB cap (and far below the 2 GiB default).
		const frame = windowedNoFcsFrame((9 << 3) | 7, Array.from({ length: 20 }, () => ({ type: 2, size: 8 })));
		expect(zstdPreallocationBound(frame)).toBe(20 * 131072);
		expect(() => validateZstdSingleFrame(frame, 1024 * 1024)).toThrow(
			/pre-allocation decompressed-size bound is 2621440 bytes/,
		);
		// Exactly at the cap is NOT above it: accepted.
		expect(validateZstdSingleFrame(frame, 2621440)).toBeNull();
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-f1-"));
		try {
			const payloadFile = join(root, "payload.tar.zst");
			writeFileSync(payloadFile, frame);
			let decompressCalls = 0;
			const spy = () => {
				decompressCalls += 1;
				throw new Error("the decompressor must never run for a bound-oversized frame");
			};
			await expect(
				extractWrapperPayload(payloadFile, join(root, "dest"), {
					platform: "linux",
					maxDecompressedBytes: 1024 * 1024,
					zstdDecompress: spy,
				}),
			).rejects.toThrow(/pre-allocation decompressed-size bound is 2621440 bytes/);
			expect(decompressCalls).toBe(0); // rejected before ANY allocation
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe("post-extraction containment walk", () => {
	// Real zstd + tar extraction: the 5 s default is too tight under host load.
	test("an entry under the destination that resolves outside it fails the extraction", async () => {
		// The validator accepts this payload and the real tar extracts it; the
		// escaping entry (a junction on Windows, a directory symlink elsewhere)
		// models a tar that left something outside the destination. Only the
		// post-extraction walk can catch it.
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-walk-"));
		const payload = join(root, "payload.tar.zst");
		const dest = join(root, "dest");
		const outside = join(root, "outside");
		mkdirSync(dest, { recursive: true });
		mkdirSync(outside, { recursive: true });
		try {
			zstFromPlain(payload, tarArchive(tarEntry("safe.txt", Buffer.from("ok\n"))));
			symlinkSync(outside, join(dest, "escape"), process.platform === "win32" ? "junction" : "dir");
			await expect(extractWrapperPayload(payload, dest, { scratchDir: root })).rejects.toThrow(
				/post-extraction check: entry .*escape resolves outside/,
			);
			// The validated entry itself was extracted: the throw comes from the walk.
			expect(existsSync(join(dest, "safe.txt"))).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}, 60_000);
});

/* ---------------- CLI final JSON line ------------------------------------ */

test("the CLI prints exactly one final JSON line with a cleanup object on failure", async () => {
	const appDir = mkdtempSync(join(tmpdir(), "pinar-smoke-cli-"));
	const script = join(dirname(fileURLToPath(import.meta.url)), "tray-smoke.mjs");
	// Port 17409 is the only real port this suite may use; the run must
	// not launch anything (empty app dir → launcher not found).
	let stdout = "";
	let stderr = "";
	let status: number | null = null;
	const child = spawn(process.execPath, [script, "--app-dir", appDir, "--port", "17409", "--timeout-ms", "1000"], {
		stdio: ["ignore", "pipe", "pipe"],
		windowsHide: true,
	});
	// F3: spawn errors are recorded from the very start — before ANY await —
	// so a failed spawn can never throw through an unhandled "error" event
	// and lose the bookkeeping below.
	let spawnError: Error | null = null;
	const onSpawnError = (error: Error) => {
		spawnError = error;
	};
	child.on("error", onSpawnError);
	const onStdout = (chunk: Buffer | string) => {
		stdout += String(chunk);
	};
	const onStderr = (chunk: Buffer | string) => {
		stderr += String(chunk);
	};
	child.stdout?.on("data", onStdout);
	child.stderr?.on("data", onStderr);
	const tailLines = (text: string) => String(text).split(/\r?\n/).slice(-5).filter((line) => line.length > 0);
	// Bind the child's identity right after spawn, inside the protected
	// lifecycle (the error listener above is attached first): the bounded
	// verified teardown (teardownChild) only signals a pid whose immutable
	// identity (creation time) is still the same one, so a recycled PID can
	// never be signalled. The capture is void to `gone` if the handle
	// already shows an exit when the probe finishes (a pid recycled after a
	// very fast exit). The probe is the OWNED boundedIdentityProbe: one
	// asynchronous probe child per call, no executable discovery, no .ps1
	// files (the CIM query runs inline), and a timed-out probe is killed
	// through its held handle and verified reaped — if it cannot be reaped,
	// the probeResidue tag below keeps the sandbox.
	const identityOf = boundedIdentityProbe(process.platform, {});
	// F2/F3: waitChildOutcome settles on the close, an error, or the inner
	// 20 s deadline; it is created before the identity capture so the
	// deadline runs concurrently with it: worst case 20 s + capture ≤ 8+2 s
	// (probe + kill wait, concurrent with the deadline) + re-probe ≤ 8+2 s +
	// taskkill ≤ 8 s + close wait 10 s ≈ 48 s < the 60 s outer timeout.
	const outcomePromise = waitChildOutcome(child, { deadlineMs: 20_000 });
	const boundIdentity: unknown = child.pid != null ? await captureChildIdentity(child, identityOf) : null;
	try {
		const outcome = await outcomePromise;
		if (outcome.kind === "close") {
			status = outcome.code;
		}
		// F4: teardownChild runs in EVERY path — also when the root
		// already exited: its early return marks the capture's unreaped
		// probe child (boundIdentity) before returning and re-reads
		// reaped from the held handle, so the residue accounting (and the
		// probe pid/error facts) reach the removal predicate in every
		// path. cliSandboxDecision is the single source of truth for the
		// decision (capture tag OR teardown residue). The already-exited
		// path returns early — no probes, no extra budget.
		const teardown: { reaped?: boolean; probeResidue?: boolean } = await teardownChild(child, {
			platform: process.platform,
			identity: identityOf,
			boundIdentity,
			closeTimeoutMs: 10_000,
		});
		const reaped = teardown.reaped === true;
		if (!cliSandboxDecision({ reaped, pid: child.pid, boundIdentity, teardown })) {
			// Fail closed: keep the sandbox (its path is in the message) and
			// fail the test with the preserved facts (pid, identity states,
			// taskkill status, refused/errors, the spawn error, the
			// stdout/stderr tails).
			throw new Error(
				`could not reap the CLI child: pid ${String(child.pid)}, ` +
					`boundIdentity=${JSON.stringify(boundIdentity)}, ` +
					`teardown=${JSON.stringify(teardown)}, ` +
					`spawnError=${spawnError != null ? JSON.stringify(spawnError.message) : "none"}, ` +
					`stdout tail: ${JSON.stringify(tailLines(stdout))}, ` +
					`stderr tail: ${JSON.stringify(tailLines(stderr))}; ` +
					`sandbox ${appDir} left in place`,
			);
		}
		rmSync(appDir, { recursive: true, force: true });
		if (spawnError != null) {
			// F3: a spawn error means "never spawned" (the sandbox was removed
			// above), but the test must still fail clearly with the recorded
			// error — it expects status 1 and one JSON line.
			throw new Error(
				`CLI child spawn failed: ${spawnError.message} ` +
					`(outcome ${outcome.kind}); ` +
					`stdout tail: ${JSON.stringify(tailLines(stdout))}, ` +
					`stderr tail: ${JSON.stringify(tailLines(stderr))}; ` +
					`sandbox ${appDir} removed (the child never spawned)`,
			);
		}
	} finally {
		// The test's own listeners are always cleared here (waitChildOutcome
		// removed its own; its deadline timer is cleared on settlement).
		child.removeListener("error", onSpawnError);
		child.stdout?.removeListener("data", onStdout);
		child.stderr?.removeListener("data", onStderr);
	}
	expect(status).toBe(1);
	const lines = stdout.split(/\r?\n/).filter((line) => line.length > 0);
	expect(lines).toHaveLength(1);
	const parsed = JSON.parse(lines[0]);
	expect(parsed.ok).toBe(false);
	expect(parsed.cleanup).toBeDefined();
	expect(Array.isArray(parsed.cleanup.killed)).toBe(true);
	expect(Array.isArray(parsed.cleanup.refused)).toBe(true);
	expect(Array.isArray(parsed.cleanup.errors)).toBe(true);
	expect(Array.isArray(parsed.cleanup.reused)).toBe(true);
	expect(typeof parsed.cleanup.sandboxRemoved).toBe("boolean");
	// SM-7: a failed run always carries the diagnostics object (never env
	// dumps, only bounded file/health facts). This particular failure is a
	// pre-spawn "launcher not found": the .pinar dir is not created (it is
	// written only once a launcher is found), so sandboxFiles may be empty —
	// the shape, not the content, is the contract.
	expect(parsed.diagnostics).toBeDefined();
	expect(Array.isArray(parsed.diagnostics.samples)).toBe(true);
	expect(parsed.diagnostics.samples.length).toBeLessThanOrEqual(14);
	expect(parsed.diagnostics.lastHealth).toBeDefined();
	expect(parsed.diagnostics.lastHealth.ok).toBe(false); // no helper was launched (launcher missing)
	expect(parsed.diagnostics.trayPid).toBeNull();
	expect(parsed.diagnostics.serverPid).toEqual({ value: null, reason: "absent" }); // sandbox exists, .pinar/server.pid does not
	expect(Array.isArray(parsed.diagnostics.sandboxFiles)).toBe(true);
	expect(parsed.diagnostics.sandboxFiles.length).toBeLessThanOrEqual(60);
	expect(typeof parsed.diagnostics.logTails).toBe("object");
}, 60_000);
