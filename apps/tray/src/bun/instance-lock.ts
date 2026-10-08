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
const STILL_ACTIVE = 259;
const MAX_IMAGE_PATH = 32_768;

function imageName(path: string) {
	return path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
}

/**
 * Whether `pid` is a running process with the same executable as this one.
 * OpenProcess also opens a process that already exited while some handle
 * still keeps its object alive, and a recycled PID may belong to another
 * program, so both the exit code and the image name are checked.
 */
async function windowsProcessExists(pid: number) {
	const { dlopen, FFIType, ptr } = await import("bun:ffi");
	const kernel32 = dlopen("kernel32.dll", {
		CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
		GetExitCodeProcess: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		OpenProcess: {
			args: [FFIType.u32, FFIType.i32, FFIType.u32],
			returns: FFIType.ptr,
		},
		QueryFullProcessImageNameW: {
			args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr],
			returns: FFIType.i32,
		},
	});
	try {
		const handle = kernel32.symbols.OpenProcess(
			PROCESS_QUERY_LIMITED_INFORMATION,
			0,
			pid,
		);
		if (!handle) return false;
		try {
			const exitCode = new Uint32Array(1);
			if (!kernel32.symbols.GetExitCodeProcess(handle, ptr(exitCode))) return false;
			if (exitCode[0] !== STILL_ACTIVE) return false;
			const buffer = new Uint16Array(MAX_IMAGE_PATH);
			const size = new Uint32Array([MAX_IMAGE_PATH]);
			if (!kernel32.symbols.QueryFullProcessImageNameW(handle, 0, ptr(buffer), ptr(size))) return true;
			const image = String.fromCharCode(...buffer.subarray(0, size[0]));
			return imageName(image) === imageName(process.execPath);
		} finally {
			kernel32.symbols.CloseHandle(handle);
		}
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
