import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import deMessages from "../lib/ui-locales/de";
import enMessages from "../lib/ui-locales/en";
import esMessages from "../lib/ui-locales/es";
import frMessages from "../lib/ui-locales/fr";
import jaMessages from "../lib/ui-locales/ja";
import ptMessages from "../lib/ui-locales/pt";
import zhMessages from "../lib/ui-locales/zh";

const pricingSource = readFileSync(new URL("./Pricing.tsx", import.meta.url), "utf8");

function pricingCheckoutMessage(
  status: number,
  data: unknown,
  copy: { addonRequiresPro: string; unavailable: string },
): string {
  const start = pricingSource.indexOf("export function pricingCheckoutMessage");
  const end = pricingSource.indexOf("interface PricingAmountProps");
  const source = pricingSource.slice(start, end).replace(
    /export function pricingCheckoutMessage\([\s\S]*?\): string \{/,
    "function pricingCheckoutMessage(status, data, copy) {",
  );
  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === "object";
  return new Function(
    "isRecord",
    "status",
    "data",
    "copy",
    `${source}\nreturn pricingCheckoutMessage(status, data, copy);`,
  )(isRecord, status, data, copy) as string;
}

describe("pricing offer variants (DJA-185)", () => {
  test("reads trialEnabled defensivamente without premature flash before loading", () => {
    assert.match(
      pricingSource,
      /trialEnabled\s*=\s*Boolean\([\s\S]*?"trialEnabled"\s+in\s+pricing[\s\S]*?trialEnabled === true[\s\S]*?\)/,
    );
  });

  test("trialEnabled=false preserves existing Free Cloud and omits trial offer", () => {
    // When trialEnabled is false, Free card uses standard keys
    assert.match(pricingSource, /trialEnabled \? t\("pricing\.freeLocalTitle"\) : t\("pricing\.free"\)/);
    assert.match(
      pricingSource,
      /trialEnabled\s*\?\s*t\("pricing\.freeLocalDescription"\)\s*:\s*t\("pricing\.freeDescription"\)/,
    );
    assert.match(
      pricingSource,
      /trialEnabled\s*\?\s*t\("pricing\.freeLocalScope"\)\s*:\s*t\("pricing\.freeScope"\)/,
    );
    // Retention and storage in cloud are kept when false
    assert.match(pricingSource, /t\("pricing\.freeRetention"\)/);
    assert.match(pricingSource, /t\("pricing\.freeStorage"\)/);
    // Button uses useFree when false
    assert.match(pricingSource, /trialEnabled \? t\("pricing\.installLocal"\) : t\("pricing\.useFree"\)/);
  });

  test("trialEnabled=true presents local/self-hosted app without permanent free cloud promises", () => {
    // Self-hosted server option is shown when true
    assert.match(pricingSource, /t\("pricing\.freeSelfHosted"\)/);
    assert.match(pricingSource, /t\("pricing\.everythingLocalPlus"\)/);

    // Free local keys do not promise permanent free cloud
    const locales = [enMessages, ptMessages, esMessages, deMessages, frMessages, jaMessages, zhMessages];
    for (const locale of locales) {
      assert.ok(locale["pricing.freeLocalTitle"]);
      assert.ok(locale["pricing.freeLocalDescription"]);
      assert.ok(locale["pricing.freeLocalScope"]);
      assert.ok(locale["pricing.freeSelfHosted"]);
      assert.ok(locale["pricing.installLocal"]);
      // Confirm that the local description does not promise free cloud
      assert.doesNotMatch(locale["pricing.freeLocalDescription"], /cloud|nuvem|nube/i);
    }
  });

  test("trialEnabled=true offers 14-day 250 MB trial below Pro CTA without voice/AI promises", () => {
    // Pro card offers trial link to /sign-in?returnTo=%2Fapp
    assert.match(pricingSource, /href="\/sign-in\?returnTo=%2Fapp"/);
    assert.match(pricingSource, /t\("pricing\.startTrial"\)/);
    assert.match(pricingSource, /t\("pricing\.trialDetails"\)/);

    // Check exact quota and duration in trialDetails across locales
    assert.equal(
      ptMessages["pricing.trialDetails"],
      "14 dias de Pinar Cloud, até 250 MB, sem cartão.",
    );
    assert.equal(
      enMessages["pricing.trialDetails"],
      "14 days of Pinar Cloud, up to 250 MB, no credit card required.",
    );

    // Verify voice/AI is NOT mentioned in the trial offer
    const locales = [enMessages, ptMessages, esMessages, deMessages, frMessages, jaMessages, zhMessages];
    for (const locale of locales) {
      assert.doesNotMatch(locale["pricing.trialDetails"], /\b(ai|ia|voice|voz)\b/i);
      assert.doesNotMatch(locale["pricing.startTrial"], /\b(ai|ia|voice|voz)\b/i);
    }
  });

  test("local installation CTA points to freeInstallUrl", () => {
    assert.match(pricingSource, /freeInstallUrl\(navigator\.userAgent\)/);
    assert.match(pricingSource, /href=\{freeHref\}/);
  });

  test("trialEnabled shows the add-on Pro note and flag off keeps the published add-on copy", () => {
    const note = pricingSource.slice(
      pricingSource.indexOf('t("pricing.addOnsDescription")'),
      pricingSource.indexOf('t("pricing.buyAddOn")'),
    );
    assert.match(note, /trialEnabled \? \([\s\S]*t\("pricing\.addOnsTrialNote"\)/);
    assert.doesNotMatch(pricingSource, /session\?\.plan|authSession/);
    const locales = [enMessages, ptMessages, esMessages, deMessages, frMessages, jaMessages, zhMessages];
    for (const locale of locales) {
      assert.match(locale["pricing.addOnsTrialNote"], /Pro/);
      assert.match(locale["pricing.addonRequiresPro"], /Pro/);
      assert.ok(locale["pricing.addOnsDescription"]);
      assert.ok(locale["pricing.buyAddOn"]);
    }
  });

  test("402 cloud_pro_required_for_addon uses the localized toast and hides the server payload", () => {
    const copy = {
      addonRequiresPro: enMessages["pricing.addonRequiresPro"],
      unavailable: enMessages["pricing.checkoutUnavailable"],
    };
    assert.equal(
      pricingCheckoutMessage(402, {
        code: "cloud_pro_required_for_addon",
        error: "raw server text",
        leak: "secret",
      }, copy),
      copy.addonRequiresPro,
    );
    assert.equal(
      pricingCheckoutMessage(402, { code: "insufficient_ai_credits", error: "Not enough AI credits" }, copy),
      "Not enough AI credits",
    );
    assert.equal(
      pricingCheckoutMessage(503, { code: "checkout_unavailable", error: "stripe down" }, copy),
      copy.unavailable,
    );
    assert.equal(pricingCheckoutMessage(400, { error: "Offer is unavailable" }, copy), "Offer is unavailable");
  });
});
