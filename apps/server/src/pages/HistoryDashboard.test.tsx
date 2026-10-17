import { type ComponentProps, createElement, type ReactElement, type ReactNode } from "react";
import { afterAll, describe, expect, mock, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import type { Session } from "@pinar/shared";
import { ServerI18nProvider } from "@/lib/i18n";
import type { SessionGroup } from "@/lib/session-groups";
import enUi from "@/lib/ui-locales/en";

// Headless rendering of the real page module (same approach as
// lib/auth-session-ssr.test.tsx): only the icon virtual modules, which
// resolve under Vite alone, become empty components. A closed tooltip
// renders nothing on the server, so the real TooltipContent is wrapped to
// record its text; Bun shares module mocks across the run, so the wrapper
// keeps the real exports and is put back after this file.
const ROOTS = [new URL("..", import.meta.url).pathname, new URL("../../../../packages/ui/src", import.meta.url).pathname];
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}
for (const spec of new Set(ROOTS.flatMap(sourceFiles).flatMap((file) => readFileSync(file, "utf8").match(/~icons\/[a-z0-9-]+\/[a-z0-9-]+/g) ?? []))) {
  mock.module(spec, () => ({ default: () => null }));
}

const ui = { ...(await import("@pinar/ui")) };
const tooltips: ReactNode[] = [];
mock.module("@pinar/ui", () => ({
  ...ui,
  TooltipContent: (props: ComponentProps<typeof ui.TooltipContent>) => {
    tooltips.push(props.children);
    return createElement(ui.TooltipContent, props);
  },
}));
afterAll(() => {
  mock.module("@pinar/ui", () => ui);
});

const { CollectionChip, SessionIdentity } = await import("./HistoryDashboard");

const AUTO_FILED = enUi["dashboard.autoFiled"];

function render(element: ReactElement) {
  tooltips.length = 0;
  const html = renderToStaticMarkup(<ServerI18nProvider initialLanguage="en" initialMessages={enUi}>{element}</ServerI18nProvider>);
  const mark = html.match(new RegExp(`<span[^>]*aria-label="${AUTO_FILED}"[^>]*>`))?.[0] ?? "";
  return { html, mark, marked: mark.includes('role="img"') && tooltips.length === 1 && tooltips[0] === AUTO_FILED, tooltips: [...tooltips] };
}

function session(id: string, filedBy?: Session["filedBy"]): Session {
  return {
    createdAt: "2026-10-17T00:00:00.000Z",
    ...(filedBy ? { filedBy } : {}),
    id,
    page: { title: `Page ${id}`, url: `https://example.test/${id}` },
    pins: [],
  };
}

describe("collection chip: automatically filed mark", () => {
  test("shows the mark, with its label and tooltip, only for filedBy auto", () => {
    const filed = render(<CollectionChip filedBy="auto" name="Design" />);
    expect(filed.marked).toBe(true);
    const manual = render(<CollectionChip name="Design" />);
    expect(manual.html).toContain("Design");
    expect(manual.html).not.toContain(AUTO_FILED);
    expect(manual.tooltips).toEqual([]);
  });

  test("the mark takes keyboard focus, so its tooltip opens from the keyboard too", () => {
    for (const element of [<CollectionChip filedBy="auto" name="Design" />, <SessionIdentity heading session={session("a", "auto")} showFiledMark />]) {
      const { mark } = render(element);
      expect(mark).toContain('tabindex="0"');
      expect(mark).toContain(`aria-label="${AUTO_FILED}"`);
    }
  });

  test("without a collection name there is no chip, and no mark", () => {
    const { html, tooltips: shown } = render(<CollectionChip filedBy="auto" />);
    expect(html).toBe("");
    expect(shown).toEqual([]);
  });

  test("the table cell marks the session it renders", () => {
    expect(render(<SessionIdentity collectionName="Design" session={session("a", "auto")} />).marked).toBe(true);
    const manual = render(<SessionIdentity collectionName="Design" session={session("b")} />);
    expect(manual.html).toContain("Design");
    expect(manual.html).not.toContain(AUTO_FILED);
  });

  test("inside a collection the card title carries the mark, once, only for filedBy auto", () => {
    const card = render(<SessionIdentity heading session={session("a", "auto")} showFiledMark />);
    expect(card.marked).toBe(true);
    // The mark sits beside the title, in the same row as the h3.
    expect(card.html).toMatch(new RegExp(`<h3[^>]*>Page a</h3><span[^>]*aria-label="${AUTO_FILED}"`));
    expect(render(<SessionIdentity heading session={session("b")} showFiledMark />).html).not.toContain(AUTO_FILED);
  });

  test("across collections the card title stays plain: the footer chip carries the mark", () => {
    expect(render(<SessionIdentity heading session={session("a", "auto")} />).html).not.toContain(AUTO_FILED);
  });

  test("inside a collection the table cell carries the mark beside the title, without a chip", () => {
    const row = render(<SessionIdentity session={session("a", "auto")} showFiledMark />);
    expect(row.marked).toBe(true);
    expect(row.html).not.toContain("Design");
    expect(row.html).toMatch(new RegExp(`>Page a</span><span[^>]*aria-label="${AUTO_FILED}"`));
    expect(render(<SessionIdentity session={session("b")} showFiledMark />).html).not.toContain(AUTO_FILED);
  });

  test("a session without a title still shows the mark inside a collection", () => {
    const untitled: Session = { ...session("c", "auto"), page: { title: "", url: "https://example.test/c" } };
    expect(render(<SessionIdentity heading session={untitled} showFiledMark />).marked).toBe(true);
    expect(render(<SessionIdentity session={untitled} showFiledMark />).marked).toBe(true);
  });

  test("a grouped batch is marked when any of its captures is", () => {
    const first = session("first");
    const marked: SessionGroup = { ...first, batchId: "batch", captures: [first, session("filed", "auto")] };
    expect(render(<SessionIdentity collectionName="Design" session={marked} />).marked).toBe(true);
    const plain: SessionGroup = { ...first, batchId: "batch", captures: [first, session("second")] };
    expect(render(<SessionIdentity collectionName="Design" session={plain} />).html).not.toContain(AUTO_FILED);
  });
});
