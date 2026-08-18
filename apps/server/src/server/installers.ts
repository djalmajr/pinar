import powershellInstaller from "../../../../install.ps1?raw";
import unixInstaller from "../../../../install.sh?raw";

export function installerResponse(pathname: string) {
  const body = pathname === "/install.sh"
    ? unixInstaller
    : pathname === "/install.ps1"
      ? powershellInstaller
      : null;
  if (body === null) return null;
  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
