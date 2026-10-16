import { CONTENT_INJECTION_FILES } from "../../../extension/session.js";
import { resolve } from "node:path";
import type { Frame, Page } from "@playwright/test";

// Single source of truth for the content-script harnesses: the same array
// background.js passes to chrome.scripting.executeScript
// (extension/session.js), in the same order. Harnesses must inject the
// content scripts through this helper; anything extra (stubs, feature
// scripts) is added after the helper call, with a comment saying why.
export async function injectExtensionScripts(context: Page | Frame): Promise<void> {
  for (const file of CONTENT_INJECTION_FILES) {
    await context.addScriptTag({ path: resolve(process.cwd(), "extension", file) });
  }
}
