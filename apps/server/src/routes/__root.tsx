import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { Toaster } from "@pinar/ui";
import appCss from "@pinar/ui/styles.css?url";
import { RoutePending } from "@/components/RoutePending";
import { ServerI18nProvider } from "@/lib/i18n";

const themeScript = `
  try {
    const saved = localStorage.getItem("pinar-theme");
    const dark = saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch {}
`;

function RootDocument() {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} suppressHydrationWarning />
        <HeadContent />
      </head>
      <body suppressHydrationWarning>
        <ServerI18nProvider>
          <RoutePending />
          <Outlet />
          <Toaster position="bottom-center" />
        </ServerI18nProvider>
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRoute({
  component: RootDocument,
  head: () => ({
    links: [{ href: appCss, rel: "stylesheet" }],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { content: "#0878be", name: "theme-color" },
      { title: "Pinar" },
    ],
  }),
});
