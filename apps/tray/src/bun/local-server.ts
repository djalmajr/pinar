import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const PORTS = Array.from({ length: 10 }, (_, index) => 17373 + index);

export async function findHealthyPort(): Promise<number | null> {
	for (const port of PORTS) {
		try {
			const response = await fetch(`http://127.0.0.1:${port}/api/health`);
			const body = (await response.json()) as { ok?: boolean; service?: string };
			if (response.ok && body.ok === true && body.service === "pinar") return port;
		} catch {
			// The helper is not on this port.
		}
	}
	return null;
}

export function pinarHome() {
	return process.env.PINAR_HOME ?? join(homedir(), ".pinar");
}

export function ensurePinarHome(root = pinarHome()) {
	mkdirSync(root, { recursive: true });
	mkdirSync(join(root, "shots"), { recursive: true });
	return root;
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

export function runningAppRoot(execPath = process.execPath) {
	const bundle = runningAppBundle(execPath);
	if (bundle) return bundle;
	let current = dirname(execPath);
	for (let i = 0; i < 8; i += 1) {
		if (
			existsSync(join(current, "Helpers", "pinar.exe")) ||
			existsSync(join(current, "Pinar.exe")) ||
			existsSync(join(current, "Pinar-dev.exe"))
		) {
			return current;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

export function bundledHelperCandidates(bundle: string) {
	return [
		join(bundle, "Contents", "Helpers", "pinar"),
		join(bundle, "Contents", "Resources", "app", "Helpers", "pinar"),
		join(bundle, "Helpers", "pinar.exe"),
		join(bundle, "Resources", "app", "Helpers", "pinar.exe"),
		join(bundle, "pinar.exe"),
	];
}

export function bundledHelperPath(execPath = process.execPath) {
	const root = runningAppRoot(execPath);
	if (!root) return null;
	return bundledHelperCandidates(root).find((path) => existsSync(path)) ?? null;
}

export function usesShell(bin: string, platform = process.platform) {
	return platform === "win32" && (bin.endsWith(".cmd") || bin.endsWith(".bat"));
}

export function pinarBin(execPath = process.execPath): string {
	if (process.env.PINAR_BIN) return process.env.PINAR_BIN;
	const bundled = bundledHelperPath(execPath);
	if (bundled) return bundled;
	if (process.platform !== "darwin") {
		const exe = join(pinarHome(), "bin", process.platform === "win32" ? "pinar.exe" : "pinar");
		if (existsSync(exe)) return exe;
		if (process.platform === "win32") {
			const cmd = join(pinarHome(), "bin", "pinar.cmd");
			if (existsSync(cmd)) return cmd;
		}
	}
	return process.platform === "win32" ? "pinar.cmd" : "pinar";
}

function spawnPinar(args: string[]) {
	const bin = pinarBin();
	const child = spawn(bin, args, {
		detached: true,
		env: process.env,
		shell: usesShell(bin),
		stdio: "ignore",
		windowsHide: true,
	});
	child.unref();
	return child;
}

export function runPinarCommand(args: string[]): Promise<number> {
	return new Promise((resolve, reject) => {
		const bin = pinarBin();
		const child = spawn(bin, args, {
			env: process.env,
			shell: usesShell(bin),
			stdio: "ignore",
			windowsHide: true,
		});
		child.on("error", reject);
		child.on("close", (code) => resolve(code ?? 1));
	});
}

export type StopServerDeps = {
	healthyPort?: () => Promise<number | null>;
	killPort?: (port: number, seen: Set<number>) => Promise<void>;
	run?: (args: string[]) => Promise<number>;
	unhealthyTimeoutMs?: number;
	wait?: (ms: number) => Promise<void>;
};

export async function waitUntilUnhealthy(
	timeoutMs = 2000,
	healthyPort: () => Promise<number | null> = findHealthyPort,
	wait: (ms: number) => Promise<void> = sleep,
) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if ((await healthyPort()) == null) return true;
		await wait(50);
	}
	return (await healthyPort()) == null;
}

export function startServer() {
	spawnPinar(["ensure"]);
}

export function installBundledHooks() {
	const bin = pinarBin();
	if (!process.env.PINAR_BIN && !existsSync(bin)) return;
	spawnPinar(["install-hooks"]);
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntilHealthy(timeoutMs = 2000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const port = await findHealthyPort();
		if (port != null) return port;
		await sleep(50);
	}
	return findHealthyPort();
}

export async function stopServer(deps: StopServerDeps = {}) {
	const healthyPort = deps.healthyPort ?? findHealthyPort;
	const killPort = deps.killPort ?? killListeningPid;
	const run = deps.run ?? runPinarCommand;
	const wait = deps.wait ?? sleep;
	const unhealthyTimeoutMs = deps.unhealthyTimeoutMs ?? 2000;
	try {
		await run(["stop"]);
	} catch {
		// Missing binary or spawn failure — fall through to health + lsof.
	}
	if (await waitUntilUnhealthy(unhealthyTimeoutMs, healthyPort, wait)) return;
	const seen = new Set<number>();
	for (let n = 0; n < PORTS.length; n += 1) {
		const port = await healthyPort();
		if (port == null) return;
		const before = seen.size;
		await killPort(port, seen);
		if (seen.size === before) return;
	}
	await waitUntilUnhealthy(unhealthyTimeoutMs, healthyPort, wait);
}

export async function restartServer() {
	await stopServer();
	startServer();
	await waitUntilHealthy();
}

export function parseNetstatListeningPid(stdout: string, port: number) {
	const suffix = `:${port}`;
	for (const line of stdout.split(/\r?\n/)) {
		if (!/LISTENING/i.test(line)) continue;
		const cols = line.trim().split(/\s+/);
		const local = cols[1] ?? "";
		if (!local.endsWith(suffix)) continue;
		const pid = Number(cols[cols.length - 1]);
		if (Number.isInteger(pid) && pid > 0) return pid;
	}
	return null;
}

async function commandStdout(argv: string[]) {
	const child = spawn(argv[0], argv.slice(1), {
		stdio: ["ignore", "pipe", "ignore"],
		windowsHide: true,
	});
	return await new Promise<string>((resolve) => {
		let data = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			data += chunk;
		});
		child.on("error", () => resolve(""));
		child.on("close", () => resolve(data));
	});
}

async function findOsListeningPid(port: number) {
	if (process.platform === "win32") {
		const stdout = await commandStdout(["netstat", "-ano", "-p", "tcp"]);
		return parseNetstatListeningPid(stdout, port);
	}
	const stdout = await commandStdout(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
	const pid = Number(stdout.trim().split(/\s+/)[0]);
	return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function killListeningPid(port: number, seen = new Set<number>()) {
	const pid = await findOsListeningPid(port);
	if (pid == null || seen.has(pid)) return;
	seen.add(pid);
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		if (process.platform === "win32") {
			spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
		}
	}
	await sleep(150);
	try {
		process.kill(pid, 0);
		if (process.platform === "win32") {
			spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
		} else {
			process.kill(pid, "SIGKILL");
		}
	} catch {
		// Already gone.
	}
}

export function workspaceUrl(port: number) {
	return `http://127.0.0.1:${port}/app`;
}
