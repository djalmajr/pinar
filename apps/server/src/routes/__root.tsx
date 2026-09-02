import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
  useRouterState,
} from "@tanstack/react-router";
import type { SupportedLanguage } from "@pinar/shared";
import { Toaster } from "@pinar/ui";
import appCss from "@pinar/ui/styles.css?url";
import { RoutePending } from "@/components/RoutePending";
import { loadUiMessages, ServerI18nProvider } from "@/lib/i18n";
import {
  canonicalHref,
  isIndexablePath,
  languageAlternates,
  readClientLanguage,
} from "@/lib/language";

const themeScript = `
  try {
    const saved = localStorage.getItem("pinar-theme");
    const dark = saved === "dark" || (saved !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  } catch {}
`;

async function resolveLanguageContext(): Promise<{
  language: SupportedLanguage;
  origin: string;
}> {
  // Server-only: `@tanstack/react-start/server` must stay out of the client bundle,
  // so this import is dropped with the dead `import.meta.env.SSR` branch.
  if (import.meta.env.SSR) {
    const { resolveRequestLanguage } = await import("@/lib/language-server");
    return resolveRequestLanguage();
  }
  return { language: readClientLanguage(), origin: location.origin };
}

function RootDocument() {
  const { language, origin } = Route.useRouteContext();
  const { messages } = Route.useLoaderData();
  const { pathname, searchStr } = useRouterState({
    select: (state) => ({
      pathname: state.location.pathname,
      searchStr: state.location.searchStr,
    }),
  });
  const indexable = isIndexablePath(pathname);

  return (
    <html lang={language} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{ __html: themeScript }}
          suppressHydrationWarning
        />
        <HeadContent />
        {indexable ? (
          <link
            href={canonicalHref(origin, pathname, searchStr)}
            rel="canonical"
          />
        ) : null}
        {indexable ? (
          <link
            href={`${origin}${pathname}`}
            hrefLang="x-default"
            rel="alternate"
          />
        ) : null}
        {indexable
          ? languageAlternates(origin, pathname).map((alternate) => (
              <link
                href={alternate.href}
                hrefLang={alternate.language}
                key={alternate.language}
                rel="alternate"
              />
            ))
          : null}
      </head>
      <body suppressHydrationWarning>
        <ServerI18nProvider
          initialLanguage={language}
          initialMessages={messages}
        >
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
  beforeLoad: resolveLanguageContext,
  component: RootDocument,
  head: () => ({
    links: [
      { href: appCss, rel: "stylesheet" },
      { href: "/favicon.svg", rel: "icon", type: "image/svg+xml" },
      {
        href: "/favicon-32.png",
        rel: "icon",
        sizes: "32x32",
        type: "image/png",
      },
      { href: "/apple-touch-icon.png", rel: "apple-touch-icon" },
    ],
    meta: [
      { charSet: "utf-8" },
      { content: "width=device-width, initial-scale=1", name: "viewport" },
      { content: "#0878be", name: "theme-color" },
      { title: "Pinar" },
    ],
  }),
  loader: async ({ context }) => ({
    messages: await loadUiMessages(context.language),
  }),
});
