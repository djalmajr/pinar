export interface CodeCountdown {
  expired: boolean;
  time: string;
}

export function remainingCodeCountdown(expiresAt: string, nowMs: number): CodeCountdown {
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresMs)) return { expired: true, time: "0:00" };
  const remainingMs = Math.max(0, expiresMs - nowMs);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    expired: remainingMs <= 0,
    time: `${minutes}:${String(seconds).padStart(2, "0")}`,
  };
}
