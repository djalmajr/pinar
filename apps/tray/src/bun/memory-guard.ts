// Electrobun 2.0.1's runtime keeps committing memory in ~32 MB steps even
// when the tray does nothing (it reached ~30 GB after three days on
// Windows). Until the runtime is fixed, the tray replaces itself before the
// growth starves the machine; the local server keeps running.

/** Private (committed) bytes above which the tray restarts itself. */
export const MEMORY_RESTART_LIMIT_BYTES = 2 * 1024 ** 3;

/** The restart limit, overridable in MB with PINAR_TRAY_MEMORY_LIMIT_MB (for support and testing). */
export function memoryRestartLimit(env: Record<string, string | undefined> = process.env) {
	const megabytes = Number(env.PINAR_TRAY_MEMORY_LIMIT_MB);
	return Number.isFinite(megabytes) && megabytes > 0 ? megabytes * 1024 * 1024 : MEMORY_RESTART_LIMIT_BYTES;
}

/** How often the tray checks its own private bytes. */
export const MEMORY_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/** The check interval, overridable in seconds with PINAR_TRAY_MEMORY_CHECK_SECONDS (for testing). */
export function memoryCheckInterval(env: Record<string, string | undefined> = process.env) {
	const seconds = Number(env.PINAR_TRAY_MEMORY_CHECK_SECONDS);
	return Number.isFinite(seconds) && seconds >= 10 ? seconds * 1000 : MEMORY_CHECK_INTERVAL_MS;
}

// PROCESS_MEMORY_COUNTERS_EX on 64-bit Windows: PrivateUsage is the last
// SIZE_T field, after the cb/PageFaultCount pair and eight SIZE_T counters.
const COUNTERS_EX_SIZE = 80;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PRIVATE_USAGE_OFFSET = 72;

/**
 * The process's private (committed) bytes on Windows, or null elsewhere or
 * when the counters cannot be read. The working set stays small while the
 * leak grows, so only this counter shows it.
 */
export async function windowsPrivateBytes(platform = process.platform): Promise<number | null> {
	if (platform !== "win32") return null;
	const { dlopen, FFIType, ptr } = await import("bun:ffi");
	const kernel32 = dlopen("kernel32.dll", {
		CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
		K32GetProcessMemoryInfo: {
			args: [FFIType.ptr, FFIType.ptr, FFIType.u32],
			returns: FFIType.i32,
		},
		OpenProcess: {
			args: [FFIType.u32, FFIType.i32, FFIType.u32],
			returns: FFIType.ptr,
		},
	});
	try {
		// A real handle from OpenProcess: GetCurrentProcess's pseudo-handle
		// (-1) does not survive the pointer conversion in every runtime.
		const handle = kernel32.symbols.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process.pid);
		if (!handle) return null;
		try {
			const counters = new Uint8Array(COUNTERS_EX_SIZE);
			const view = new DataView(counters.buffer);
			view.setUint32(0, COUNTERS_EX_SIZE, true);
			if (!kernel32.symbols.K32GetProcessMemoryInfo(handle, ptr(counters), COUNTERS_EX_SIZE)) return null;
			return Number(view.getBigUint64(PRIVATE_USAGE_OFFSET, true));
		} finally {
			kernel32.symbols.CloseHandle(handle);
		}
	} finally {
		kernel32.close();
	}
}

export function shouldRestartForMemory(
	privateBytes: number | null,
	limit = memoryRestartLimit(),
) {
	return privateBytes != null && privateBytes > limit;
}
