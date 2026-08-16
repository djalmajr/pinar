import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { destinationKey, resolveDestinationPreference } from "./destination.js";

const backgroundSrc = readFileSync(new URL("./background.js", import.meta.url), "utf8");
const contentSrc = readFileSync(new URL("./content.js", import.meta.url), "utf8");
const optionsSrc = readFileSync(new URL("../apps/extension/src/options/OptionsApp.tsx", import.meta.url), "utf8");
const comboboxSrc = readFileSync(new URL("../packages/ui/src/components/combobox.tsx", import.meta.url), "utf8");

const tree = {
  projects: [{
    collections: [{ id: "inbox", isProtected: true }, { id: "review", isProtected: false }],
    id: "personal",
  }],
};

describe("capture destination", () => {
  test("keeps local and each configured cloud server in separate preference buckets", () => {
    // Mutation captured: using one global key sends a local collection id to the remote API.
    assert.equal(destinationKey({ storageMode: "local" }, "http://127.0.0.1:17373"), "local");
    assert.equal(destinationKey({ cloudUrl: "https://pinar.dev/", storageMode: "cloud" }), "cloud:https://pinar.dev");
    assert.equal(destinationKey({ cloudUrl: "https://staging.pinar.dev", storageMode: "cloud" }), "cloud:https://staging.pinar.dev");
  });

  test("falls back to the protected collection when the saved destination disappeared", () => {
    // Mutation captured: returning a stale id makes the server choose a destination the toolbar does not show.
    assert.deepEqual(resolveDestinationPreference(tree, { collectionId: "review" }), {
      collectionId: "review",
      projectId: "personal",
    });
    assert.deepEqual(resolveDestinationPreference(tree, { collectionId: "deleted" }), {
      collectionId: "inbox",
      projectId: "personal",
    });
  });

  test("global extension selection reaches the shot payload and stores the effective server response", () => {
    // Mutation captured: putting destination controls back in the pass-through toolbar makes them unusable.
    assert.doesNotMatch(contentSrc, /data-ref="projectSelect"/);
    assert.doesNotMatch(contentSrc, /data-ref="collectionSelect"/);
    assert.doesNotMatch(contentSrc, /destination:\s*state\.destination/);
    assert.match(optionsSrc, /requestCaptureDestination\("destination:get"\)/);
    assert.match(optionsSrc, /requestCaptureDestination\("destination:set", collectionId\)/);
    assert.match(optionsSrc, /t\.capture_destination_label/);
    assert.match(backgroundSrc, /JSON\.stringify\(\{ collectionId, id, image: dataUrl, page, pins \}\)/);
    assert.match(backgroundSrc, /storeDestination\(settings, base, body\.destination\)/);
    assert.match(backgroundSrc, /storeDestination\(settings, "", body\.destination\)/);
  });

  test("copy resolves the destination from the active server instead of trusting a stale page id", () => {
    // Mutation captured: trusting message.destination can send a local collection id after switching to cloud.
    assert.doesNotMatch(backgroundSrc, /message\.destination/);
    assert.match(backgroundSrc, /getCaptureDestinationContext\(settings\)/);
  });

  test("options show the protected fallback destination before the server tree is available", () => {
    assert.match(optionsSrc, /DEFAULT_PROJECT_OPTION = \{ label: "Personal"/);
    assert.match(optionsSrc, /DEFAULT_COLLECTION_OPTION = \{ label: "Inbox"/);
    assert.match(optionsSrc, /value=\{selectedDestinationProjectId\}/);
    assert.match(optionsSrc, /value=\{selectedDestinationCollectionId\}/);
  });

  test("options provide searchable projects and a hierarchical collection picker", () => {
    assert.match(optionsSrc, /<Combobox[\s\S]*autoHighlight/);
    assert.match(optionsSrc, /<ComboboxInput/);
    assert.match(optionsSrc, /<ComboboxEmpty>\{t\.no_projects_found\}<\/ComboboxEmpty>/);
    assert.match(optionsSrc, /itemToStringLabel=\{\(projectId\) =>/);
    assert.match(optionsSrc, /itemToStringValue=\{\(projectId\) => String\(projectId\)\}/);
    assert.match(optionsSrc, /flattenDestinationCollections\(destinationCollections\)/);
    assert.match(optionsSrc, /collection\.isProtected \? <IconInbox \/> : <IconFolder \/>/);
    assert.match(optionsSrc, /paddingInlineStart: `\$\{depth \* 16\}px`/);
  });

  test("project popup anchors to the complete combobox trigger width", () => {
    assert.match(comboboxSrc, /<ComboboxPrimitive\.InputGroup/);
    assert.match(comboboxSrc, /w-\(--anchor-width\)/);
  });

  test("options group storage, preferences, and plan in logical tabs", () => {
    assert.match(optionsSrc, /<TabsTrigger value="storage">\{t\.tab_storage\}<\/TabsTrigger>/);
    assert.match(optionsSrc, /<TabsTrigger value="preferences">\{t\.tab_preferences\}<\/TabsTrigger>/);
    assert.match(optionsSrc, /<TabsTrigger value="plan">\{t\.tab_plan\}<\/TabsTrigger>/);
  });

  test("license field uses the same typography as the other form fields", () => {
    assert.doesNotMatch(optionsSrc, /className="h-8 font-mono text-xs"/);
    assert.match(optionsSrc, /<Input\s+className="h-8"\s+placeholder=\{t\.license_placeholder\}/);
  });

  test("header does not draw a separator above the tabs", () => {
    assert.match(optionsSrc, /className="flex items-center justify-between gap-3"/);
    assert.doesNotMatch(optionsSrc, /justify-between gap-3 border-b border-border pb-4/);
    assert.doesNotMatch(optionsSrc, /justify-between gap-3 pb-4/);
  });

  test("GitHub action uses the same outline hover behavior as History", () => {
    assert.match(optionsSrc, /render=\{<a href="https:\/\/github\.com\/djalmajr\/pinar"[\s\S]*?size="icon"[\s\S]*?variant="outline"/);
    assert.doesNotMatch(optionsSrc, /hover:border-primary/);
  });

  test("tab sections and bottom actions do not draw decorative separators", () => {
    assert.equal(
      optionsSrc.match(/<Card className="gap-3 overflow-visible rounded-none py-0 ring-0" size="sm">/g)?.length,
      3,
    );
    assert.equal(optionsSrc.match(/<CardContent className="[^"]*px-0[^"]*">/g)?.length, 3);
    assert.match(optionsSrc, /<CardHeader className="px-0">/);
    assert.doesNotMatch(optionsSrc, /flex-wrap pt-3 border-t border-border mt-1/);
    assert.doesNotMatch(optionsSrc, /flex-wrap pt-3 mt-1/);
    assert.match(optionsSrc, /justify-between gap-2 flex-wrap">/);
  });

  test("bottom actions use the same horizontal button spacing", () => {
    assert.doesNotMatch(optionsSrc, /className="h-8 px-(?:2\.5|3\.5) text-xs/);
    assert.match(optionsSrc, /<IconSave className="w-3\.5 h-3\.5" \/>/);
    assert.match(optionsSrc, /<IconExternalLink \/>/);
    assert.match(optionsSrc, /<IconCoffee \/>/);
    assert.match(optionsSrc, /<IconHeart className="fill-current" \/>/);
  });

  test("storage radio options rely on the radio state without decorated containers", () => {
    assert.equal(
      optionsSrc.match(/className="-mx-2 flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted\/50"/g)?.length,
      2,
    );
    assert.doesNotMatch(optionsSrc, /p-3\.5 rounded-xl border transition-all cursor-pointer/);
    assert.doesNotMatch(optionsSrc, /border-primary bg-primary\/5/);
  });
});
