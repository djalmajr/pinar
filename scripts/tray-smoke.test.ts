import { spawn, spawnSync } from "node:child_process";
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
	darwinWrapperPayloadTarZst,
	defaultAppDir,
	decide,
	extractWrapperPayload,
	isHealthyHealth,
	imageOfFor,
	isInsideAppDir,
	launcherCandidates,
	parseArgs,
	parseNetstatListeningPid,
	parsePort,
	parseTasklistCsvLine,
	readTrayPid,
	resolveLauncher,
	runSmoke,
	smokeEnv,
	tasklistCsvHasPid,
	wrapperPayloadTarZst,
} from "./tray-smoke.mjs";

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
		let listeningCalls = 0;
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17415, timeoutMs: 1_000, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async () => null,
					isAlive: async () => true, // the reused pid is alive
					imageOf: async (pid) => (pid === launcherPid ? join(outsideDir, "unrelated.exe") : null),
					killTree: async () => {
						throw new Error("killTree must not be called");
					},
					listeningPid: (port) => {
						listeningCalls += 1;
						// Free before the spawn; held by the reused pid at the
						// cleanup decision; the process then exits, so the
						// bounded poll settles.
						return port === 17415 && listeningCalls === 2 ? launcherPid : null;
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
		let listeningCalls = 0;
		let result;
		try {
			result = await runSmoke(
				{ appDir, port: 17417, timeoutMs: 1_000, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async () => null,
					isAlive: async (pid) => !killed.has(pid),
					imageOf: async (pid) => (pid === helperPid ? helperExe : null),
					killTree: async (pid) => {
						killed.add(pid);
					},
					listeningPid: (port) => {
						listeningCalls += 1;
						return port === 17417 && listeningCalls === 2 ? helperPid : null;
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
				const packed = spawnSync(tar, ["-a", "-cf", payload, "-C", src, "."], { stdio: "ignore", windowsHide: true });
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
 * compressed in-process with Bun (the same zstd the smoke decompresses). */
function realTarZst(destFile: string, srcDir: string): void {
	const plain = join(dirname(destFile), "plain-fixture.tar");
	const packed = spawnSync(platformTar(), ["-cf", plain, "-C", srcDir, "."], {
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
		let listeningCalls = 0;
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
						return spawnFn(launcher, args, opts);
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
						listeningCalls += 1;
						return port === 17420 && listeningCalls === 2 ? outsidePid : null;
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
			reason: /zstd decompression/,
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
	});

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

describe("post-extraction containment walk", () => {
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
	});
});

/* ---------------- CLI final JSON line ------------------------------------ */

test("the CLI prints exactly one final JSON line with a cleanup object on failure", () => {
	const appDir = mkdtempSync(join(tmpdir(), "pinar-smoke-cli-"));
	try {
		const script = join(dirname(fileURLToPath(import.meta.url)), "tray-smoke.mjs");
		// Port 17409 is the only real port this suite may use; the run must
		// not launch anything (empty app dir → launcher not found).
		const out = spawnSync(process.execPath, [script, "--app-dir", appDir, "--port", "17409", "--timeout-ms", "1000"], {
			encoding: "utf8",
			windowsHide: true,
		});
		expect(out.status).toBe(1);
		const lines = String(out.stdout ?? "").split(/\r?\n/).filter((line) => line.length > 0);
		expect(lines).toHaveLength(1);
		const parsed = JSON.parse(lines[0]);
		expect(parsed.ok).toBe(false);
		expect(parsed.cleanup).toBeDefined();
		expect(Array.isArray(parsed.cleanup.killed)).toBe(true);
		expect(Array.isArray(parsed.cleanup.refused)).toBe(true);
		expect(Array.isArray(parsed.cleanup.errors)).toBe(true);
		expect(typeof parsed.cleanup.sandboxRemoved).toBe("boolean");
	} finally {
		rmSync(appDir, { recursive: true, force: true });
	}
});
