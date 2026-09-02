import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { collectionDestination, defaultDestination, destinationKey, resolveDestinationPreference } from "./destination.js";

const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const optionsSrc = readFileSync(new URL("../apps/extension/src/options/OptionsApp.tsx", import.meta.url), "utf8");

const tree = {
  projects: [{
    collections: [{ id: "inbox", isProtected: true }, { id: "review", isProtected: false }],
    id: "personal",
  }],
};

describe("capture destination", () => {
  test("keeps local and each configured cloud server in separate preference buckets", () => {
    assert.equal(destinationKey({ storageMode: "local" }, "http://127.0.0.1:17373"), "local");
    assert.equal(destinationKey({ storageMode: "local" }), "local:unavailable");
    assert.equal(destinationKey({ cloudUrl: "", storageMode: "cloud" }), "cloud:https://pinar.dev");
    assert.equal(destinationKey({ cloudUrl: "https://pinar.dev/", storageMode: "cloud" }), "cloud:https://pinar.dev");
    assert.equal(destinationKey({ cloudUrl: "https://staging.pinar.dev", storageMode: "cloud" }), "cloud:https://staging.pinar.dev");
  });

  test("falls back to the protected collection when a saved destination disappeared", () => {
    assert.deepEqual(resolveDestinationPreference(tree, { collectionId: "review" }), {
      collectionId: "review",
      projectId: "personal",
    });
    assert.deepEqual(resolveDestinationPreference(tree, { collectionId: "deleted" }), {
      collectionId: "inbox",
      projectId: "personal",
    });
  });

  // Mutation captured: removing the first-collection fallback leaves valid legacy trees without a destination.
  test("uses the first collection only when a tree has no protected destination", () => {
    const legacyTree = {
      projects: [{ collections: [{ id: "legacy" }], id: "project-legacy" }],
    };
    assert.deepEqual(defaultDestination(legacyTree), {
      collectionId: "legacy",
      projectId: "project-legacy",
    });
    assert.equal(defaultDestination({ projects: [] }), null);
    assert.equal(collectionDestination(null, "missing"), null);
  });

  test("resolves the destination in the background and sends the effective collection with captures", () => {
    assert.doesNotMatch(contentSrc, /data-ref="projectSelect"|data-ref="collectionSelect"|message\.destination/);
    assert.match(optionsSrc, /type: "destination:get"/);
    assert.match(optionsSrc, /collectionId, type: "destination:set"/);
    assert.match(optionsSrc, /flattenDestinationCollections\(destinationCollections\)/);
    assert.match(backgroundSrc, /getCaptureDestinationContext\(settings\)/);
    assert.match(backgroundSrc, /JSON\.stringify\(payload\)/);
    assert.match(backgroundSrc, /includeScreenshot,/);
    assert.equal((backgroundSrc.match(/body: JSON\.stringify\(payload\)/g) || []).length, 2);
    assert.match(backgroundSrc, /privacy,/);
    assert.match(backgroundSrc, /storeDestination\(settings, "", body\.destination\)/);
    assert.match(backgroundSrc, /localFetch\(base, "\/api\/shots"/);
    assert.match(backgroundSrc, /localFetch\(localBase, "\/api\/project-tree"\)/);
    assert.match(backgroundSrc, /\/api\/preferences/);
    assert.match(backgroundSrc, /preferences:get/);
    assert.match(backgroundSrc, /preferences:set/);
    assert.match(backgroundSrc, /\$\{base\}\/api\/local\/capability/);
    assert.match(backgroundSrc, /"x-pinar-capability": token/);
    assert.doesNotMatch(backgroundSrc, /\/api\/local\/capability\?/);
    assert.doesNotMatch(backgroundSrc, /console\.(?:log|info|debug|warn)\([^)]*token/);
  });

  test("offers storage, preferences and account tabs without legacy credentials", () => {
    assert.match(optionsSrc, /<TabsTrigger value="storage">\{t\.tab_storage\}<\/TabsTrigger>/);
    assert.match(optionsSrc, /<TabsTrigger value="preferences">\{t\.tab_preferences\}<\/TabsTrigger>/);
    assert.match(optionsSrc, /<TabsTrigger value="account">\{t\.tab_account\}<\/TabsTrigger>/);
    assert.match(optionsSrc, /type: "auth:extension-code"/);
    assert.match(optionsSrc, /type: "auth:email-code:verify"/);
    assert.match(optionsSrc, /type: "auth:logout"/);
    assert.match(optionsSrc, /authSession\?\.kind === "account"/);
    assert.doesNotMatch(optionsSrc, /authSession\?\.kind === "installation"/);
    assert.match(optionsSrc, /t\.screenshot_label/);
    assert.match(optionsSrc, /t\.handoff_mode_label/);
    assert.match(optionsSrc, /type: "preferences:get"/);
    assert.match(optionsSrc, /type: "preferences:set"/);
    assert.match(optionsSrc, /copyOnFinishBatch: settings\.copyOnFinishBatch/);
    assert.match(optionsSrc, /includeViewer: settings\.includeViewer/);
    assert.match(optionsSrc, /includeScreenshot: settings\.includeScreenshot/);
    assert.match(backgroundSrc, /patch\.handoffMode = message\.handoffMode === "full" \? "full" : "compact"/);
    assert.match(optionsSrc, /t\.btn_upgrade_pro/);
    assert.doesNotMatch(optionsSrc, /t\.btn_subscription/);
    assert.doesNotMatch(optionsSrc, /license|identity:regenerate|installationId/i);
  });

  test("language and theme each occupy a full settings row like the workspace dialog", () => {
    const interfaceSection = optionsSrc.slice(
      optionsSrc.indexOf("{t.section_interface}"),
      optionsSrc.indexOf("{t.section_handoff}"),
    );
    assert.match(interfaceSection, /<SettingRow size="xs" description=\{t\.language_desc\} title=\{t\.language_label\}>/);
    assert.match(interfaceSection, /<SettingRow size="xs" description=\{t\.theme_desc\} title=\{t\.theme_label\}>/);
    assert.match(optionsSrc, /<SettingRow size="xs" description=\{t\.handoff_mode_desc\}/);
    assert.match(optionsSrc, /<SettingRow size="xs" description=\{t\.copy_on_finish_batch_desc\} title=\{t\.copy_on_finish_batch_label\}>/);
    assert.match(optionsSrc, /<SettingRow layout="stack" size="xs" description=\{t\.privacy_query_keys_desc\} title=\{t\.privacy_query_keys_label\}>/);
    // Mutation captured: w-52 + w-full stretches the trigger; the menu then inherits --anchor-width and looks padded.
    assert.doesNotMatch(optionsSrc, /controlClassName="w-52"/);
    assert.match(interfaceSection, /SelectTrigger aria-label=\{t\.language_label\}><SelectValue \/>/);
    assert.match(optionsSrc, /SelectTrigger aria-label=\{t\.copy_on_finish_batch_label\}><SelectValue \/>/);
    assert.match(interfaceSection, /SelectContent align="end" alignItemWithTrigger=\{false\} className="w-max min-w-min"/);
    assert.match(optionsSrc, /SelectContent align="end" alignItemWithTrigger=\{false\} className="w-max min-w-min"/);
    assert.match(interfaceSection, /variant="segmented"/);
    assert.match(interfaceSection, /aria-label=\{t\.theme_system\}/);
    assert.match(interfaceSection, /aria-label=\{t\.theme_light\}/);
    assert.match(interfaceSection, /aria-label=\{t\.theme_dark\}/);
    assert.doesNotMatch(interfaceSection, /sm:grid-cols-2/);
    assert.doesNotMatch(interfaceSection, /\{t\.theme_system\}<\/TabsTrigger>/);
    assert.doesNotMatch(interfaceSection, /\{t\.theme_light\}<\/TabsTrigger>/);
    assert.doesNotMatch(interfaceSection, /\{t\.theme_dark\}<\/TabsTrigger>/);
    // Mutation captured: dropping the separators leaves preference sections as an undifferentiated stack.
    assert.match(optionsSrc, /\{t\.section_interface\}[\s\S]*<\/section>\s*<Separator \/>\s*<section[\s\S]*\{t\.section_handoff\}/);
    assert.match(optionsSrc, /\{t\.section_handoff\}[\s\S]*<\/section>\s*<Separator \/>\s*<section[\s\S]*\{t\.section_privacy\}/);
    assert.match(optionsSrc, /\{t\.storage_title\}[\s\S]*<\/section>\s*<Separator \/>\s*<section[\s\S]*\{t\.storage_status_title\}/);
    assert.match(optionsSrc, /\{t\.storage_status_title\}[\s\S]*<\/section>\s*<Separator \/>\s*<section[\s\S]*\{t\.capture_destination_label\}/);
    assert.match(optionsSrc, /\{t\.shortcuts_browser_title\}[\s\S]*<\/section>\s*<Separator \/>\s*<section[\s\S]*\{t\.shortcuts_overlay_title\}/);
    assert.match(optionsSrc, /\{t\.account_free_title\}[\s\S]*<\/section>\s*<Separator \/>/);
    assert.equal([...optionsSrc.matchAll(/<Separator \/>/g)].length, 6);
    // Mutation captured: mb-8 under the section description is larger than the gap-5 between preference rows.
    assert.match(optionsSrc, /const SECTION_DESC = "mt-0\.5 mb-5 text-xs text-muted-foreground"/);
    assert.match(optionsSrc, /\{t\.section_interface_desc\}<\/p>\s*<div className="flex flex-col gap-3">/);
    assert.match(optionsSrc, /\{t\.section_handoff_desc\}<\/p>\s*<div className="flex flex-col gap-3">/);
    assert.match(optionsSrc, /\{t\.section_privacy_desc\}<\/p>\s*<div className="flex flex-col gap-3">/);
    assert.doesNotMatch(optionsSrc, /SECTION_LEAD/);
    assert.equal([...optionsSrc.matchAll(/className=\{SECTION_DESC\}/g)].length, 11);
    assert.match(optionsSrc, /\{t\.section_interface_desc\}/);
    assert.match(optionsSrc, /\{t\.section_handoff_desc\}/);
    assert.match(optionsSrc, /\{t\.section_privacy_desc\}/);
    assert.match(optionsSrc, /\{t\.storage_title_desc\}/);
    // Mutation captured: gap-2.5 plus py-2 on each radio leaves a large gap between Local and Remote.
    assert.match(optionsSrc, /\{t\.storage_title_desc\}<\/p>\s*<div className="flex flex-col gap-1">/);
    assert.match(optionsSrc, /px-2 py-1 hover:bg-muted\/50">\s*<input checked=\{settings\.storageMode === "local"\}/);
    assert.match(optionsSrc, /px-2 py-1 hover:bg-muted\/50">\s*<input checked=\{settings\.storageMode === "cloud"\}/);
    assert.match(optionsSrc, /\{t\.storage_status_title_desc\}/);
    assert.match(optionsSrc, /\{t\.capture_destination_desc\}/);
    assert.match(optionsSrc, /\{t\.account_title_desc\}/);
  });

  test("extension setting rows stay compact xs while the workspace dialog stays sm", () => {
    const settingsSrc = readFileSync(new URL("../packages/ui/src/components/settings.tsx", import.meta.url), "utf8");
    const dialogSrc = readFileSync(new URL("../apps/server/src/components/GlobalSettingsDialog.tsx", import.meta.url), "utf8");
    // Mutation captured: omitting size="xs" or switching compact titles to text-sm makes Options larger than the rest of the page.
    assert.match(settingsSrc, /compact \? "text-xs font-semibold" : "text-sm font-medium"/);
    assert.match(settingsSrc, /min-w-0 flex-1/);
    // Mutation captured: leading-5 on text-xs descriptions opens line-height to 20px; mt-1 keeps the subtitle away from the title.
    assert.match(settingsSrc, /compact \? "mt-0\.5 text-xs" : "mt-0\.5 text-sm leading-5"/);
    const optionRows = [...optionsSrc.matchAll(/<SettingRow\b[^>]*>/g)].map((match) => match[0]);
    assert.ok(optionRows.length >= 10);
    for (const row of optionRows) {
      assert.match(row, /\ssize="xs"/);
    }
    assert.doesNotMatch(dialogSrc, /<SettingRow[^>]*\ssize="xs"/);
    assert.match(settingsSrc, /layout === "stack"/);
    assert.doesNotMatch(optionsSrc, /controlClassName="w-52"/);
    assert.match(optionsSrc, /<p className=\{SECTION_DESC\}>\{t\.shortcuts_browser_desc\}<\/p>/);
    assert.match(optionsSrc, /<p className=\{SECTION_DESC\}>\{t\.shortcuts_overlay_desc\}<\/p>/);
    assert.doesNotMatch(optionsSrc, /text-xs leading-5/);
    assert.doesNotMatch(optionsSrc, /mt-1 block text-xs/);
  });

  test("opens the default workspace", () => {
    assert.match(optionsSrc, /type: "app:open"/);
    assert.match(backgroundSrc, /withLanguage\(`\$\{base\}\/app`\)/);
    assert.doesNotMatch(backgroundSrc, /withLanguage\(`\$\{base\}\/`\)/);
    assert.doesNotMatch(backgroundSrc, /browser-ticket|\/history/);
  });

  test("carries the current remote legal acceptance into account activation", () => {
    assert.match(backgroundSrc, /const legalAcceptance = await registerRemoteInstallation\(endpoint, identity\)/);
    assert.match(backgroundSrc, /body: JSON\.stringify\(\{[\s\S]*code,[\s\S]*email,[\s\S]*installationId: identity\.id,[\s\S]*installationToken: identity\.token,[\s\S]*legalAcceptance,[\s\S]*\}\)/);
  });

  test("coalesces concurrent first-load registration requests for one installation", () => {
    assert.match(backgroundSrc, /const registerInstallationOnce = createSingleFlight\(\)/);
    assert.match(backgroundSrc, /return registerInstallationOnce\(cacheKey, async \(\) => \{/);
  });

  test("reconciles delivery preferences from the server and PATCHes on save", () => {
    assert.match(backgroundSrc, /includeViewer/);
    assert.match(backgroundSrc, /copyOnFinishBatch/);
    assert.match(backgroundSrc, /captureDestination/);
    assert.match(optionsSrc, /type: "preferences:get"/);
    assert.match(optionsSrc, /applyDeliveryResponse\(current, response\)/);
    assert.match(optionsSrc, /merged\.language \?\? current\.language/);
    assert.match(backgroundSrc, /await cacheDeliveryPreferences\(remote, settings\)/);
    assert.match(backgroundSrc, /if \(preferences\.language\) syncPatch\.language = preferences\.language/);
    assert.match(backgroundSrc, /await storeDestination\(resolved, localBase, preferences\.captureDestination\)/);
    assert.match(optionsSrc, /copyOnFinishBatch: settings\.copyOnFinishBatch/);
    assert.match(optionsSrc, /copyViewerContent: settings\.copyViewerContent/);
    assert.match(optionsSrc, /includeViewer: settings\.includeViewer/);
    assert.match(optionsSrc, /language: settings\.language/);
    assert.match(optionsSrc, /sensitiveQueryKeys: settings\.sensitiveQueryKeys/);
    assert.match(optionsSrc, /type: "preferences:set"/);
    assert.match(backgroundSrc, /method: "PATCH"/);
    assert.match(backgroundSrc, /setDeliveryPreferences\(\{ captureDestination: destination \}\)/);
    assert.match(backgroundSrc, /mode: remotePrefs\?\.copyOnFinishBatch \?\? settings\.copyOnFinishBatch/);
    assert.match(backgroundSrc, /includeViewer = remotePrefs\?\.includeViewer \?\? settings\.includeViewer !== false/);
  });
});
