import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pinarBin, pinarHome, runningAppBundle } from "./local-server";

export const LOGIN_LABEL = "dev.pinar.local";
export const WINDOWS_RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
export const WINDOWS_RUN_VALUE = "Pinar";

export function loginPlistPath() {
	return join(homedir(), "Library", "LaunchAgents", `${LOGIN_LABEL}.plist`);
}

export function desktopPrefsPath() {
	return join(pinarHome(), "desktop.json");
}

export function loginAppBundle() {
	const installed = join(homedir(), "Applications", "Pinar.app");
	if (existsSync(installed)) return installed;
	return runningAppBundle();
}

export function windowsInstallDir(home = homedir(), localAppData = process.env.LOCALAPPDATA) {
	const base = localAppData || join(home, "AppData", "Local");
	return join(base, "Programs", "Pinar");
}

export function isPinarWindowsExe(execPath: string) {
	const name = basename(execPath).toLowerCase();
	if (name === "pinar.exe" || name === "pinar-dev.exe") return true;
	if (name !== "launcher.exe") return false;
	return /[/\\]pinar[/\\]bin[/\\]launcher\.exe$/i.test(execPath);
}

export function windowsInstallExePath(
	home = homedir(),
	localAppData = process.env.LOCALAPPDATA,
) {
	const dest = windowsInstallDir(home, localAppData);
	const launcher = join(dest, "bin", "launcher.exe");
	const pinar = join(dest, "Pinar.exe");
	if (existsSync(launcher) && existsSync(join(dest, "bin", "cottontail.exe"))) return launcher;
	if (existsSync(pinar)) return pinar;
	return launcher;
}

export function loginExePath(execPath = process.execPath) {
	const installed = windowsInstallExePath();
	if (existsSync(installed)) return installed;
	if (isPinarWindowsExe(execPath) && existsSync(execPath)) return execPath;
	return null;
}

export function windowsRunAddArgs(exePath: string) {
	return ["add", WINDOWS_RUN_KEY, "/v", WINDOWS_RUN_VALUE, "/t", "REG_SZ", "/d", exePath, "/f"];
}

export function windowsRunDeleteArgs() {
	return ["delete", WINDOWS_RUN_KEY, "/v", WINDOWS_RUN_VALUE, "/f"];
}

export function parseRegQueryHasValue(stdout: string, name = WINDOWS_RUN_VALUE) {
	return stdout.toLowerCase().includes(name.toLowerCase());
}

export async function isServerLoginEnabled() {
	if (process.platform === "win32") return isWindowsRunEnabled();
	if (process.platform !== "darwin") return false;
	try {
		const text = await readFile(loginPlistPath(), "utf8");
		return text.includes(LOGIN_LABEL);
	} catch {
		return false;
	}
}

async function readPrefs() {
	try {
		return JSON.parse(await readFile(desktopPrefsPath(), "utf8")) as {
			loginConfigured?: boolean;
			loginEnabled?: boolean;
		};
	} catch {
		return {};
	}
}

async function writePrefs(next: { loginConfigured?: boolean; loginEnabled?: boolean }) {
	await mkdir(pinarHome(), { recursive: true });
	await writeFile(desktopPrefsPath(), `${JSON.stringify(next)}\n`, "utf8");
}

export function shouldConfigureDefaultLogin(
	prefs: { loginConfigured?: boolean; loginEnabled?: boolean },
	loginAgentExists: boolean,
) {
	if (!prefs.loginConfigured) return true;
	return prefs.loginEnabled === true && !loginAgentExists;
}

export async function ensureDefaultLogin() {
	if (process.platform === "win32") {
		const prefs = await readPrefs();
		if (loginExePath() && shouldConfigureDefaultLogin(prefs, await isWindowsRunEnabled())) {
			await setServerLoginEnabled(true);
		}
		return;
	}
	if (process.platform !== "darwin") return;
	const prefs = await readPrefs();
	if (shouldConfigureDefaultLogin(prefs, existsSync(loginPlistPath()))) {
		await setServerLoginEnabled(true);
	}
}

export async function setServerLoginEnabled(enabled: boolean) {
	if (process.platform === "win32") {
		if (enabled) await addWindowsRun();
		else await removeWindowsRun();
		await writePrefs({ loginConfigured: true, loginEnabled: enabled });
		return;
	}
	if (process.platform !== "darwin") return;
	const path = loginPlistPath();
	if (!enabled) {
		await unloadLoginAgent();
		try {
			await unlink(path);
		} catch {
			// Missing plist is already off.
		}
		await writePrefs({ loginConfigured: true, loginEnabled: false });
		return;
	}
	const app = loginAppBundle();
	const plist = app
		? loginPlistForApp(app)
		: loginPlistForBin(pinarBin());
	if (!app) {
		const program = pinarBin();
		if (!existsSync(program) && !process.env.PINAR_BIN) {
			throw new Error("Pinar binary not found. Install the local server first.");
		}
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, plist, "utf8");
	await loadLoginAgent(path);
	await writePrefs({ loginConfigured: true, loginEnabled: true });
}

export function loginPlistForApp(appPath: string) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LOGIN_LABEL}</string>
	<key>LimitLoadToSessionType</key>
	<string>Aqua</string>
	<key>ProgramArguments</key>
	<array>
		<string>/usr/bin/open</string>
		<string>-ga</string>
		<string>${escapeXml(appPath)}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
</dict>
</plist>
`;
}

function loginPlistForBin(program: string) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LOGIN_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${escapeXml(program)}</string>
		<string>ensure</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
</dict>
</plist>
`;
}

function escapeXml(value: string) {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

async function loadLoginAgent(path: string) {
	const uid = String(process.getuid?.() ?? "");
	await runLaunchctl(["bootout", `gui/${uid}`, path]).catch(() => undefined);
	await runLaunchctl(["bootstrap", `gui/${uid}`, path]).catch(async () => {
		await runLaunchctl(["load", "-w", path]);
	});
}

async function unloadLoginAgent() {
	const uid = String(process.getuid?.() ?? "");
	const path = loginPlistPath();
	await runLaunchctl(["bootout", `gui/${uid}`, path]).catch(async () => {
		await runLaunchctl(["unload", "-w", path]).catch(() => undefined);
	});
}

function runLaunchctl(args: string[]) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn("launchctl", args, { stdio: "ignore" });
		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`launchctl ${args[0]} exited ${code}`));
		});
	});
}

function runReg(args: string[]) {
	return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
		const child = spawn("reg", args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
		let stdout = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code: code ?? 1, stdout }));
	});
}

async function isWindowsRunEnabled() {
	try {
		const result = await runReg(["query", WINDOWS_RUN_KEY, "/v", WINDOWS_RUN_VALUE]);
		return result.code === 0 && parseRegQueryHasValue(result.stdout);
	} catch {
		return false;
	}
}

async function addWindowsRun() {
	const exe = loginExePath();
	if (!exe) throw new Error("Pinar executable not found. Install the local server first.");
	const result = await runReg(windowsRunAddArgs(exe));
	if (result.code !== 0) throw new Error(`reg add ${WINDOWS_RUN_VALUE} exited ${result.code}`);
}

async function removeWindowsRun() {
	await runReg(windowsRunDeleteArgs()).catch(() => undefined);
}
