export const GITHUB_RELEASES_LATEST = "https://github.com/djalmajr/pinar/releases/latest";
export const GITHUB_RELEASES_LATEST_DOWNLOAD = `${GITHUB_RELEASES_LATEST}/download`;
export const WINDOWS_HELPER_INSTALL_URL = "https://pinar.dev/install.ps1";
export const LINUX_HELPER_INSTALL_URL = "https://pinar.dev/install.sh";

export function macosDesktopDmgFile(arch = "arm64") {
  return `macos-${arch}-Pinar.dmg`;
}

export function macosDesktopDmgUrl(arch = "arm64") {
  return `${GITHUB_RELEASES_LATEST_DOWNLOAD}/${macosDesktopDmgFile(arch)}`;
}

export function windowsDesktopSetupFile() {
  return "win-x64-Pinar-Setup.exe";
}

export function windowsDesktopSetupUrl() {
  return `${GITHUB_RELEASES_LATEST_DOWNLOAD}/${windowsDesktopSetupFile()}`;
}

export function freeInstallUrl(userAgent = "") {
  if (/Windows NT/i.test(userAgent)) return windowsDesktopSetupUrl();
  if (/Linux/i.test(userAgent) && !/Android/i.test(userAgent)) return LINUX_HELPER_INSTALL_URL;
  return macosDesktopDmgUrl();
}
