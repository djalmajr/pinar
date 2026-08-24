import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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

export function pinarBin(): string {
	if (process.env.PINAR_BIN) return process.env.PINAR_BIN;
	const installed = join(pinarHome(), "bin", process.platform === "win32" ? "pinar.cmd" : "pinar");
	if (existsSync(installed)) return installed;
	return process.platform === "win32" ? "pinar.cmd" : "pinar";
}

function spawnPinar(args: string[]) {
	const child = spawn(pinarBin(), args, {
		detached: true,
		env: process.env,
		stdio: "ignore",
	});
	child.unref();
	return child;
}

export function startServer() {
	spawnPinar(["ensure"]);
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

export async function stopServer() {
	const seen = new Set<number>();
	for (let n = 0; n < PORTS.length; n += 1) {
		const port = await findHealthyPort();
		if (port == null) return;
		const before = [...seen];
		await killListeningPid(port, seen);
		if (seen.size === before.length) return;
	}
}

export async function restartServer() {
	await stopServer();
	startServer();
	await waitUntilHealthy();
}

async function killListeningPid(port: number, seen = new Set<number>()) {
	if (process.platform === "win32") return;
	const child = spawn("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	const stdout = await new Promise<string>((resolve, reject) => {
		let data = "";
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			data += chunk;
		});
		child.on("error", reject);
		child.on("close", () => resolve(data));
	});
	const pids = stdout
		.trim()
		.split(/\s+/)
		.map((value) => Number(value))
		.filter((pid) => Number.isInteger(pid) && pid > 0 && !seen.has(pid));
	for (const pid of pids) seen.add(pid);
	for (const pid of pids) {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// Already gone.
		}
	}
	await sleep(150);
	for (const pid of pids) {
		try {
			process.kill(pid, 0);
			process.kill(pid, "SIGKILL");
		} catch {
			// Already gone.
		}
	}
}

export function workspaceUrl(port: number) {
	return `http://127.0.0.1:${port}/app`;
}

