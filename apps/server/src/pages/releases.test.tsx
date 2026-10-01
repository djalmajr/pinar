import { cloneElement, createElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ServerI18nProvider } from "@/lib/i18n";
import enUi from "@/lib/ui-locales/en";
import {
  defaultReleaseContent,
  findProductRelease,
} from "@/lib/release-content";

// Headless rendering (same approach as pin-discussion.test.tsx): the page's
// non-content dependencies are replaced by minimal stand-ins so the
// assertions only observe the release content structure.
mock.module("@/components/ServerShell", () => ({
  ServerShell: ({ children }: { children: ReactNode }) =>
    createElement("div", null, children),
}));
mock.module("@/components/ServerFooter", () => ({
  ServerFooter: () => null,
}));
// The shared UI package's barrel imports icon specifiers that only the app's
// Vite plugin resolves; the page only needs these three primitives, so the
// package is replaced with minimal structural stand-ins.
mock.module("@pinar/ui", () => ({
  Badge: ({ children }: { children?: ReactNode }) =>
    createElement("span", null, children),
  Button: ({
    children,
    render,
  }: {
    children?: ReactNode;
    render?: ReactElement;
  }) =>
    render ? cloneElement(render, {}, children) : createElement("button", null, children),
  ScrollArea: ({ children }: { children?: ReactNode }) =>
    createElement("div", null, children),
}));
mock.module("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children?: ReactNode;
    to: string;
    params?: Record<string, string>;
  }) =>
    createElement(
      "a",
      {
        href:
          typeof to === "string"
            ? to.replace(/\$(\w+)/g, (_, key) => params?.[key] ?? key)
            : "",
      },
      children,
    ),
}));
for (const icon of ["arrow-left", "arrow-right", "calendar-days", "check"]) {
  mock.module(`~icons/lucide/${icon}`, () => ({
    default: () => null,
  }));
}

const { ReleaseDetailPage, ReleasesPage } = await import("./Releases");

function renderPage(element: ReactNode) {
  return renderToStaticMarkup(
    createElement(
      ServerI18nProvider,
      { children: element, initialLanguage: "en", initialMessages: enUi },
    ),
  );
}

describe("Releases page rendering", () => {
  test("renders the upcoming section exactly when the content ships it", () => {
    const markup = renderPage(createElement(ReleasesPage));
    const content = defaultReleaseContent;
    const upcomingShipped = content.upcoming !== undefined;

    // The section's anchor renders exactly when the content ships upcoming.
    expect(markup.includes("upcoming-release-heading")).toBe(upcomingShipped);

    if (upcomingShipped) {
      const label = content.ui.upcomingRelease!;
      expect(markup).toContain(label);
      expect(markup).toContain(content.upcoming!.title);
      expect(markup).toContain(content.upcoming!.summary);

      // The upcoming section sits above the first published tag and carries
      // neither a tag badge nor a release date of its own.
      const firstTag = content.releases[0].tag;
      const upcomingAt = markup.indexOf("upcoming-release-heading");
      const firstTagAt = markup.indexOf(`>${firstTag}<`);
      expect(upcomingAt).toBeGreaterThanOrEqual(0);
      expect(firstTagAt).toBeGreaterThanOrEqual(0);
      expect(upcomingAt).toBeLessThan(firstTagAt);
      expect(markup.slice(upcomingAt, firstTagAt)).not.toContain("2026");
    }

    // The published list keeps every tag and its tag-based detail link, and
    // no detail route ever points at the untagged upcoming content.
    for (const release of content.releases) {
      expect(markup).toContain(release.tag);
      expect(markup).toContain(`href="/releases/${release.tag.slice(1)}"`);
    }
    expect(markup).not.toContain("href=\"/releases/upcoming\"");
    expect(findProductRelease(content, "upcoming")).toBeNull();
  });

  test("keeps the tag detail route on published tags only", () => {
    const latest = defaultReleaseContent.releases[0];
    expect(
      renderPage(createElement(ReleaseDetailPage, { version: latest.tag.slice(1) })),
    ).toContain(latest.title);
    expect(
      renderPage(createElement(ReleaseDetailPage, { version: "upcoming" })),
    ).toContain(defaultReleaseContent.ui.releaseNotFound);
  });
});
