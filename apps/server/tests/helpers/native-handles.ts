// Bun releases SQLite files only after the closed connection is collected:
// node:sqlite keeps unfinalized statements until GC, and @libsql/client frees
// its native handle in a finalizer that runs on the next event-loop turn. On
// Windows an open handle makes deleting the file fail with EBUSY, so teardown
// that removes a closed database runs this first. POSIX deletes open files, so
// the full collection runs on Windows only.
export async function releaseClosedDatabases() {
  if (process.platform !== "win32") return;
  Bun.gc(true);
  await new Promise((resolve) => setImmediate(resolve));
}
