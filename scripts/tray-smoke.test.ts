import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_PORT,
	DEFAULT_TIMEOUT_MS,
	DESKTOP_PREFS,
	defaultAppDir,
	decide,
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

describe("isInsideAppDir", () => {
	test("win32 containment is case-insensitive and prefix-safe", () => {
		const appDir = "C:\\Users\\x\\builds\\stable-win-x64\\app";
		expect(isInsideAppDir("C:\\users\\x\\BUILDS\\stable-win-x64\\app\\Resources\\app\\Helpers\\pinar.exe", appDir)).toBe(true);
		expect(isInsideAppDir("C:\\Users\\x\\builds\\stable-win-x64\\app\\evil.exe", appDir)).toBe(true);
		expect(isInsideAppDir("C:\\Users\\x\\builds\\stable-win-x64\\app-evil\\pinar.exe", appDir)).toBe(false);
		expect(isInsideAppDir("C:\\Users\\x\\builds\\stable-win-x64\\other\\pinar.exe", appDir)).toBe(false);
	});

	test("unix containment uses / separators", () => {
		const appDir = "/tmp/builds/stable-linux-x64";
		expect(isInsideAppDir("/tmp/builds/stable-linux-x64/Helpers/pinar", appDir)).toBe(true);
		expect(isInsideAppDir("/tmp/builds/stable-linux-x64-evil/pinar", appDir)).toBe(false);
	});

	test("null or empty input is never inside", () => {
		expect(isInsideAppDir(null, "/tmp/app")).toBe(false);
		expect(isInsideAppDir("/tmp/app/exe", "")).toBe(false);
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

describe("runSmoke", () => {
	/** Every launcher candidate for every platform, so the fixture resolves
	 * on any host; each win32 stub always has its runtime next to it, so the
	 * self-extracting-wrapper detection stays null. */
	const LAUNCHER_FIXTURES = [
		join("bin", "launcher.exe"),
		join("bin", "cottontail.exe"),
		join("Pinar", "bin", "launcher.exe"),
		join("Pinar", "bin", "cottontail.exe"),
		join("app", "bin", "launcher.exe"),
		join("app", "bin", "cottontail.exe"),
		"launcher.exe",
		"Pinar.exe",
		join("app", "Pinar.exe"),
		join("Pinar", "launcher.exe"),
		join("app", "launcher.exe"),
		join("Pinar.app", "Contents", "MacOS", "launcher"),
		join("Pinar.app", "Contents", "MacOS", "Pinar"),
		join("app", "Pinar.app", "Contents", "MacOS", "launcher"),
		join("app", "Pinar.app", "Contents", "MacOS", "Pinar"),
		"Pinar",
		"Pinar-dev",
		join("app", "Pinar"),
		join("app", "Pinar-dev"),
	];

	function makeAppDir() {
		const root = mkdtempSync(join(tmpdir(), "pinar-smoke-app-"));
		for (const rel of LAUNCHER_FIXTURES) {
			const path = join(root, rel);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, "");
		}
		return root;
	}

	/** A fake launcher: records the spawn and (optionally) pre-writes tray.pid.
	 * The child stays live (exitCode/signalCode null) until cleanup signals it,
	 * at which point it exits — matching a real launcher that only dies when
	 * the kill reaches it. Pass `{ alreadyExited: true }` to model a launcher
	 * that exited on its own before cleanup (PID-reuse scenario). */
	function fakeSpawn(childPid, trayPid, opts = {}) {
		const calls = [];
		let child;
		const spawnFn = (launcher, _args, spawnOpts) => {
			calls.push(launcher);
			if (trayPid != null) {
				const pinarHome = spawnOpts.env.PINAR_HOME;
				mkdirSync(pinarHome, { recursive: true });
				writeFileSync(join(pinarHome, "tray.pid"), `${trayPid}\n`);
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

	test("never kills a tray.pid pid outside the launched tree and launch dir", async () => {
		const appDir = makeAppDir();
		const foreign = 99991;
		const childPid = 7777;
		const killCalls = [];
		const { spawnFn, calls } = fakeSpawn(childPid, foreign);
		try {
			const result = await runSmoke(
				{ appDir, port: 17395, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async () => null, // nothing is related to the launched child
					isAlive: async (pid) => pid === foreign || pid === childPid,
					imageOf: async () => "C:\\outside\\foreign\\bin\\pinar.exe",
					killTree: async (pid) => {
						killCalls.push(pid);
					},
					listeningPid: () => null,
				},
			);
			expect(calls).toHaveLength(1);
			expect(result.ok).toBe(false);
			expect(result.jsExecuted).toBe(false);
			// Only the launcher this run spawned is terminated.
			expect(killCalls).toEqual([childPid]);
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("kills a tray.pid pid that is inside the launched process tree", async () => {
		const appDir = makeAppDir();
		const foreign = 99992;
		const childPid = 7778;
		const killCalls = [];
		const { spawnFn } = fakeSpawn(childPid, foreign);
		try {
			const result = await runSmoke(
				{ appDir, port: 17396, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async (pid) => (pid === foreign ? childPid : null),
					isAlive: async (pid) => pid === foreign || pid === childPid,
					imageOf: async () => "C:\\outside\\foreign\\bin\\pinar.exe",
					killTree: async (pid) => {
						killCalls.push(pid);
					},
					listeningPid: () => null,
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
		const { spawnFn } = fakeSpawn(childPid, foreign);
		try {
			await runSmoke(
				{ appDir, port: 17397, timeoutMs: 1_500, log: null, keepHome: false },
				{
					spawn: spawnFn,
					parentOf: async () => null, // not in the tree: the image decides
					isAlive: async (pid) => pid === foreign || pid === childPid,
					imageOf: async (pid) => (pid === foreign ? join(appDir, "Pinar", "bin", "pinar.exe") : null),
					killTree: async (pid) => {
						killCalls.push(pid);
					},
					listeningPid: () => null,
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
				},
			);
			expect(result.ok).toBe(false);
			expect(result.jsExecuted).toBe(false);
			expect(result.reason).toContain("already in use by pid 42424");
			expect(spawned).toBe(0); // refused before launching anything
			expect(killCalls).toEqual([]); // and nothing was killed
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

	test("does not kill a helper on the port that is outside the launched tree and dir", async () => {
		const appDir = makeAppDir();
		const foreignHelper = 99994;
		const childPid = 7780;
		const killCalls = [];
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
					isAlive: async (pid) => pid === childPid,
					imageOf: async (pid) => (pid === foreignHelper ? "C:\\outside\\helpers\\pinar.exe" : null),
					killTree: async (pid) => {
						killCalls.push(pid);
					},
					listeningPid: () => {
						listeningCalls += 1;
						return listeningCalls <= 1 ? null : foreignHelper;
					},
				},
			);
			expect(listeningCalls).toBeGreaterThan(1); // cleanup probe ran
			expect(result.ok).toBe(false);
			expect(killCalls).toEqual([childPid]); // the foreign helper survived
		} finally {
			rmSync(appDir, { recursive: true, force: true });
		}
	});

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
});

