import { readFileSync, writeFileSync } from "node:fs";

type InstanceLockOptions = {
	isProcessAlive?: (pid: number) => boolean;
	pid?: number;
};

function processIsAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function claimInstanceLock(
	path: string,
	onDuplicate: () => void,
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
			isProcessAlive(existing)
		) {
			onDuplicate();
			return false;
		}
	} catch {
		// Missing or unreadable lock is treated as stale.
	}

	writeFileSync(path, `${pid}\n`);
	return true;
}
