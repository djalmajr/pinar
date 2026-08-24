import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { pinarBin, pinarHome } from "./local-server";

export const LOGIN_LABEL = "dev.pinar.local";

export function loginPlistPath() {
	return join(homedir(), "Library", "LaunchAgents", `${LOGIN_LABEL}.plist`);
}

export function desktopPrefsPath() {
	return join(pinarHome(), "desktop.json");
}

export function runningAppBundle(execPath = process.execPath) {
	let current = dirname(execPath);
	for (let i = 0; i < 8; i += 1) {
		if (current.endsWith(".app")) return current;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

export function loginAppBundle() {
	const installed = join(homedir(), "Applications", "Pinar.app");
	if (existsSync(installed)) return installed;
	return runningAppBundle();
}

export async function isServerLoginEnabled() {
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

export async function ensureDefaultLogin() {
	if (process.platform !== "darwin") return;
	const prefs = await readPrefs();
	if (!prefs.loginConfigured) {
		await setServerLoginEnabled(true);
		return;
	}
	if (prefs.loginEnabled) {
		await setServerLoginEnabled(true);
	}
}

export async function setServerLoginEnabled(enabled: boolean) {
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
