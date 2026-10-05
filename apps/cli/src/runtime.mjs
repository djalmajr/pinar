export function isCompiledModuleUrl(url) {
  return url.includes("$bunfs") || /\/(?:~|%7E)BUN\//i.test(url);
}
