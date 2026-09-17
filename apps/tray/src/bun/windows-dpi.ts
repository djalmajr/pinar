/**
 * The size Windows draws notification-area icons at for the current display
 * scale (`SM_CXSMICON`: 16 px at 100 %, 20 at 125 %, 24 at 150 %, 32 at 200 %).
 * Handing the shell a raster of exactly that size avoids the resample that
 * blurs a 16 px glyph on a scaled display. Falls back to the DPI ratio when the
 * metric is unavailable, and to 16 px when the FFI call fails.
 */
const SM_CXSMICON = 49;
const BASE_DPI = 96;
const BASE_SIZE = 16;

export function smallIconSizeFor({ dpi, metric }: { dpi?: number; metric?: number }) {
	if (Number.isInteger(metric) && (metric as number) >= BASE_SIZE) return metric as number;
	if (Number.isFinite(dpi) && (dpi as number) > 0) {
		return Math.max(BASE_SIZE, Math.round((BASE_SIZE * (dpi as number)) / BASE_DPI));
	}
	return BASE_SIZE;
}

export async function windowsSmallIconSize(platform = process.platform) {
	if (platform !== "win32") return BASE_SIZE;
	try {
		const { dlopen, FFIType } = await import("bun:ffi");
		const user32 = dlopen("user32.dll", {
			GetDpiForSystem: { args: [], returns: FFIType.u32 },
			GetSystemMetrics: { args: [FFIType.i32], returns: FFIType.i32 },
		});
		try {
			return smallIconSizeFor({
				dpi: user32.symbols.GetDpiForSystem(),
				metric: user32.symbols.GetSystemMetrics(SM_CXSMICON),
			});
		} finally {
			user32.close();
		}
	} catch {
		return BASE_SIZE;
	}
}
