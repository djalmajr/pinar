import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { collectionDestination, defaultDestination, destinationKey, resolveDestinationPreference } from "./destination.js";

const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const optionsSrc = readFileSync(new URL("../apps/extension/src/options/OptionsApp.tsx", import.meta.url), "utf8");
const i18nSrc = readFileSync(new URL("../packages/shared/src/i18n/index.ts", import.meta.url), "utf8");

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
    assert.doesNotMatch(optionsSrc, /type: "destination:get"|type: "destination:set"|flattenDestinationCollections/);
    assert.match(backgroundSrc, /getCaptureDestinationContext\(settings\)/);
    assert.match(backgroundSrc, /JSON\.stringify\(payload\)/);
    assert.match(backgroundSrc, /includeScreenshot,/);
    assert.match(backgroundSrc, /collectionId: draft\.collectionId/);
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

  test("keeps account sign-in in storage settings without a separate account tab", () => {
    assert.match(optionsSrc, /<TabsTrigger value="storage">\{t\.tab_storage\}<\/TabsTrigger>/);
    assert.match(optionsSrc, /<TabsTrigger value="preferences">\{t\.tab_preferences\}<\/TabsTrigger>/);
    assert.match(optionsSrc, /<TabsTrigger value="shortcuts">\{t\.tab_shortcuts\}<\/TabsTrigger>/);
    assert.doesNotMatch(optionsSrc, /<TabsTrigger value="account"/);
    assert.doesNotMatch(optionsSrc, /type: "auth:extension-code"/);
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
    assert.match(optionsSrc, /\{t\.account_email_title\}[\s\S]*type: "auth:email-code:verify"|type: "auth:email-code:verify"[\s\S]*\{t\.account_email_title\}/);
    assert.match(optionsSrc, /hostedSignInUrl\(settings\.cloudUrl, lang\)/);
    assert.doesNotMatch(optionsSrc, /t\.btn_upgrade_pro/);
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
    assert.doesNotMatch(optionsSrc, /<SettingRow size="xs" description=\{t\.copy_on_finish_batch_desc\}/);
    assert.match(optionsSrc, /<SettingRow layout="stack" size="xs" description=\{t\.privacy_query_keys_desc\} title=\{t\.privacy_query_keys_label\}>/);
    // Mutation captured: w-52 + w-full stretches the trigger; the menu then inherits --anchor-width and looks padded.
    assert.doesNotMatch(optionsSrc, /controlClassName="w-52"/);
    assert.match(interfaceSection, /SelectTrigger aria-label=\{t\.language_label\}><SelectValue \/>/);
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
    assert.match(optionsSrc, /\{t\.storage_title\}[\s\S]*\{t\.account_email_title\}[\s\S]*\{voiceAvailable \? <>[\s\S]*\{t\.voice_settings_title\}/);
    assert.doesNotMatch(optionsSrc, /\{t\.storage_status_title\}|\{t\.capture_destination_label\}/);
    assert.match(optionsSrc, /\{t\.shortcuts_browser_title\}[\s\S]*<\/section>\s*<Separator \/>\s*<section[\s\S]*\{t\.shortcuts_overlay_title\}/);
    assert.match(optionsSrc, /<label className="text-xs font-semibold" htmlFor="account-email">\{t\.account_email_title\}<\/label>/);
    assert.doesNotMatch(optionsSrc, /t\.account_email_description/);
    // Mutation captured: mb-8 under the section description is larger than the gap-5 between preference rows.
    assert.match(optionsSrc, /const SECTION_DESC = "mt-0\.5 mb-5 text-xs text-muted-foreground"/);
    assert.match(optionsSrc, /\{t\.section_interface_desc\}<\/p>\s*<div className="flex flex-col gap-3">/);
    assert.match(optionsSrc, /\{t\.section_handoff_desc\}<\/p>\s*<div className="flex flex-col gap-3">/);
    assert.match(optionsSrc, /\{t\.section_privacy_desc\}<\/p>\s*<div className="flex flex-col gap-3">/);
    assert.doesNotMatch(optionsSrc, /SECTION_LEAD/);
    assert.match(optionsSrc, /const voiceAvailable = settings\.storageMode === "cloud"[\s\S]*authSession\?\.kind === "account"[\s\S]*authSession\.plan === "pro"/);
    assert.match(optionsSrc, /\{voiceAvailable \? <>[\s\S]*\{t\.voice_settings_title\}/);
    const voiceBlock = optionsSrc.slice(optionsSrc.indexOf("{voiceAvailable ? <>"), optionsSrc.indexOf("</TabsContent>", optionsSrc.indexOf("{voiceAvailable ? <>")));
    assert.match(voiceBlock, /checked=\{settings\.voicePostProcessing\}/);
    assert.doesNotMatch(voiceBlock, /disabled=/);
    assert.match(optionsSrc, /\{t\.section_interface_desc\}/);
    assert.match(optionsSrc, /\{t\.section_handoff_desc\}/);
    assert.match(optionsSrc, /\{t\.section_privacy_desc\}/);
    assert.match(optionsSrc, /\{t\.storage_title_desc\}/);
    assert.match(optionsSrc, /\{t\.storage_title_desc\}<\/p>\s*<div className="flex flex-col gap-2">/);
    assert.match(optionsSrc, /px-3 py-2 hover:bg-muted\/50">\s*<input checked=\{settings\.storageMode === "local"\}/);
    assert.match(optionsSrc, /px-3 py-2 hover:bg-muted\/50">\s*<input checked=\{settings\.storageMode === "cloud"\}/);
    assert.match(optionsSrc, /<div className="overflow-hidden rounded-lg border">\s*<label[\s\S]*<\/label>\s*\{settings\.storageMode === "cloud" \? \([\s\S]*\{t\.account_email_title\}/);
    assert.match(optionsSrc, /className="h-8 shrink-0 text-xs" disabled=\{emailCodeRequestLoading\} size="sm" type="submit"/);
    assert.match(optionsSrc, /\{environment === "staging" \? t\.staging_desc : t\.remote_desc\}<\/span>[\s\S]*render=\{<a href=\{hostedSignInUrl\(settings\.cloudUrl, lang\)\}[\s\S]*onClick=\{\(event\) => event\.stopPropagation\(\)\}>\{t\.account_create_on_web\}<IconExternalLink data-icon="inline-end" \/><\/Button>\s*<\/label>/);
    assert.match(optionsSrc, /<form className="flex flex-wrap gap-2" onSubmit=\{requestEmailCode\}>[\s\S]*\{t\.btn_send_code\}<\/Button>\s*<\/form>/);
    assert.match(i18nSrc, /account_email_title: "Entrar com e-mail"/);
    assert.match(i18nSrc, /account_create_on_web: 'Criar conta'/);
    assert.doesNotMatch(optionsSrc, /\{t\.storage_status_title_desc\}|\{t\.capture_destination_desc\}/);
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
    const openApp = backgroundSrc.slice(backgroundSrc.indexOf("async function openApp()"), backgroundSrc.indexOf("async function saveShot"));
    assert.doesNotMatch(openApp, /browser-ticket|\/history/);
  });

  test("uses website acceptance and verifies an existing account directly by email code", () => {
    assert.doesNotMatch(optionsSrc, /legalAcceptance|acceptLegal|legalConsent/);
    assert.doesNotMatch(backgroundSrc, /registerRemoteInstallation|registerInstallationOnce/);
    assert.match(backgroundSrc, /installationId: identity\.id/);
    assert.match(backgroundSrc, /installationToken: identity\.token/);
    assert.doesNotMatch(backgroundSrc, /legalAcceptance,/);
  });

  test("exposes voice only to signed-in Pro accounts", () => {
    assert.match(backgroundSrc, /resolveVoiceAvailability\(settings\.storageMode, session\)/);
    assert.match(contentSrc, /ui\.voice\.hidden = false/);
    assert.match(contentSrc, /ui\.voice\.disabled = !voiceAvailable \|\| active/);
    assert.match(contentSrc, /class="voice-tooltip"/);
  });

  test("uses the build-authorized environment in extension settings", () => {
    assert.match(optionsSrc, /cloudEnvironment\(manifest, settings\.cloudUrl\)/);
    assert.match(optionsSrc, /environment === "staging" \? t\.staging_title : t\.remote_title/);
    assert.match(optionsSrc, /environment === "staging" \? t\.staging_desc : t\.remote_desc/);
  });

  test("uses a Windows-specific local storage path description", () => {
    assert.match(optionsSrc, /installPlatform === "win" \? t\.local_desc_windows : t\.local_desc/);
    assert.match(optionsSrc, /\{localStorageDescription\}/);
    assert.equal(i18nSrc.includes('$HOME\\\\.pinar\\\\shots'), true);
  });

  test("requires a device token for Cloud requests and never falls back to an anonymous installation", () => {
    const remote = backgroundSrc.slice(
      backgroundSrc.indexOf("async function remoteFetch("),
      backgroundSrc.indexOf("function audioBlobFromDataUrl("),
    );
    assert.match(remote, /if \(!deviceToken\) throw new Error/);
    assert.match(remote, /deviceAuthHeaders\(deviceToken\)/);
    assert.match(remote, /if \(response.status === 401\) await clearDeviceToken\(storage\)/);
    assert.doesNotMatch(remote, /installationAuthHeaders|resetToFreshInstallation/);
    assert.match(backgroundSrc, /if \(!device\) throw new Error\("Sign in with email/);
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
