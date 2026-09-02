import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { footerYear } from "./server-footer";

const pageSource = (page: string) =>
  readFileSync(new URL(`../pages/${page}.tsx`, import.meta.url), "utf8");
const componentSource = (component: string) =>
  readFileSync(new URL(`../components/${component}.tsx`, import.meta.url), "utf8");

describe("ServerFooter", () => {
  test("derives the copyright year at render time", () => {
    assert.equal(footerYear(new Date("2026-08-22T12:00:00Z")), 2026);
  });

  test("keeps the full footer only on institutional public pages", () => {
    for (const page of ["Landing", "Pricing", "LegalDocument", "Help", "Releases"]) {
      assert.match(pageSource(page), /<ServerFooter\b/);
    }

    for (const page of ["SignIn", "Success", "HistoryDashboard", "WebViewer"]) {
      assert.doesNotMatch(pageSource(page), /<ServerFooter\b/);
    }

    assert.match(pageSource("WebViewer"), /shouldUseWorkspaceChrome/);
    assert.match(pageSource("WebViewer"), /WorkspaceChrome/);
    assert.match(pageSource("HistoryDashboard"), /<WorkspaceChrome>/);

    assert.match(pageSource("SignIn"), /<FairSourceSupportCard\b/);
  });

  test("aligns the public header and legal footer with the main content width", () => {
    assert.match(componentSource("ServerHeader"), /max-w-6xl/);
    assert.match(componentSource("ServerFooter"), /min-h-24 w-full flex-col/);
    assert.doesNotMatch(componentSource("ServerFooter"), /max-w-4xl flex-col/);
    assert.match(pageSource("Landing"), /<main[^>]+max-w-6xl[^>]+px-5/);
    assert.match(pageSource("Pricing"), /<main[^>]+max-w-6xl[^>]+px-5/);
    assert.match(pageSource("LegalDocument"), /<main[^>]+max-w-6xl[^>]+px-5/);
    assert.match(pageSource("Help"), /<main[^>]+max-w-6xl[^>]+px-5/);
    assert.doesNotMatch(pageSource("LegalDocument"), /max-w-4xl/);
    assert.match(pageSource("Releases"), /<main[^>]+max-w-6xl[^>]+px-5/);
  });
});
