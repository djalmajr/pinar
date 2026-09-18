import { readFileSync, writeFileSync } from "node:fs";

type InstanceLockOptions = {
	isProcessAlive?: (pid: number) => boolean | Promise<boolean>;
	pid?: number;
};

type ProcessIsAliveOptions = {
	platform?: NodeJS.Platform;
	signalProcess?: (pid: number) => void;
	windowsProcessExists?: (pid: number) => boolean | Promise<boolean>;
};

const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

async function windowsProcessExists(pid: number) {
	const { dlopen, FFIType } = await import("bun:ffi");
	const kernel32 = dlopen("kernel32.dll", {
		CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
		OpenProcess: {
			args: [FFIType.u32, FFIType.i32, FFIType.u32],
			returns: FFIType.ptr,
		},
	});
	try {
		const handle = kernel32.symbols.OpenProcess(
			PROCESS_QUERY_LIMITED_INFORMATION,
			0,
			pid,
		);
		if (!handle) return false;
		kernel32.symbols.CloseHandle(handle);
		return true;
	} finally {
		kernel32.close();
	}
}

export async function processIsAlive(
	pid: number,
	{
		platform = process.platform,
		signalProcess = (candidate) => process.kill(candidate, 0),
		windowsProcessExists: probeWindowsProcess = windowsProcessExists,
	}: ProcessIsAliveOptions = {},
) {
	if (platform === "win32") {
		try {
			return await probeWindowsProcess(pid);
		} catch (error) {
			console.error(`pinar tray could not inspect Windows process ${pid}`, error);
		}
	}
	try {
		signalProcess(pid);
		return true;
	} catch {
		return false;
	}
}

export async function claimInstanceLock(
	path: string,
	onDuplicate: (existingPid: number) => void,
	{
		isProcessAlive = processIsAlive,
		pid = process.pid,
	}: InstanceLockOptions = {},
) {
	try {
		const existing = Number(readFileSync(path, "utf8").trim());
		if (
			Number.isInteger(existing) &&
			existing > 0 &&
			existing !== pid &&
			(await isProcessAlive(existing))
		) {
			onDuplicate(existing);
			return false;
		}
	} catch {
		// Missing or unreadable lock is treated as stale.
	}

	writeFileSync(path, `${pid}\n`);
	return true;
}
