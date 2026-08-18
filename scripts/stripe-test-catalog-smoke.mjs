const ENV_PATH = new URL("../.env.local", import.meta.url);
const STRIPE_API_VERSION = "2026-07-29.dahlia";
const integrationIdentifiers = new Map();

function randomLetters(size = 8) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function parseEnv(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    values.set(trimmed.slice(0, separator), trimmed.slice(separator + 1));
  }
  return values;
}

function required(values, name) {
  const value = values.get(name);
  if (!value) throw new Error(`${name} is required in .env.local`);
  return value;
}

async function createCheckoutSession({
  currency,
  idempotencyKey,
  mode,
  offer,
  priceId,
  secretKey,
  unitAmount,
}) {
  const integrationIdentifier = integrationIdentifiers.get(idempotencyKey)
    || `pinar_test_${randomLetters()}`;
  integrationIdentifiers.set(idempotencyKey, integrationIdentifier);
  const body = new URLSearchParams({
    allow_promotion_codes: "true",
    cancel_url: "https://pinar.dev/pricing?stripe_test=cancel",
    integration_identifier: integrationIdentifier,
    "line_items[0][price]": priceId,
    "line_items[0][quantity]": "1",
    "metadata[pinar_offer]": offer,
    mode,
    success_url: "https://pinar.dev/success?stripe_test={CHECKOUT_SESSION_ID}",
  });
  if (mode === "subscription") {
    body.set("subscription_data[metadata][pinar_offer]", offer);
  } else {
    body.set("customer_creation", "always");
  }
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    body,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Idempotency-Key": idempotencyKey,
      "Stripe-Version": STRIPE_API_VERSION,
    },
    method: "POST",
  });
  const result = await response.json();
  if (!response.ok) {
    const message = typeof result?.error?.message === "string" ? result.error.message : "Stripe request failed";
    throw new Error(message);
  }
  if (result.livemode !== false || result.object !== "checkout.session" || result.status !== "open") {
    throw new Error(`Unexpected Checkout Session state for ${offer}`);
  }
  if (result.mode !== mode || result.metadata?.pinar_offer !== offer) {
    throw new Error(`Checkout Session contract mismatch for ${offer}`);
  }
  if (result.amount_total !== unitAmount || result.currency !== currency) {
    throw new Error(
      `Checkout Session amount mismatch for ${offer}: expected ${currency} ${unitAmount}, `
      + `received ${String(result.currency)} ${String(result.amount_total)}`,
    );
  }
  return {
    amountTotal: result.amount_total,
    currency: result.currency,
    id: result.id,
    mode: result.mode,
    offer,
    paymentStatus: result.payment_status,
    status: result.status,
  };
}

const values = parseEnv(await Bun.file(ENV_PATH).text());
const secretKey = required(values, "STRIPE_TEST_RESTRICTED_KEY");
if (!secretKey.startsWith("rk_test_")) {
  throw new Error("Refusing to run: STRIPE_TEST_RESTRICTED_KEY is not a Stripe test key");
}

const offers = [
  { currency: "usd", mode: "subscription", offer: "pro_month", price: "STRIPE_TEST_PRICE_MONTHLY", unitAmount: 299 },
  { currency: "brl", mode: "subscription", offer: "pro_month", price: "STRIPE_TEST_PRICE_BR_MONTHLY", unitAmount: 490 },
  { currency: "usd", mode: "subscription", offer: "pro_year", price: "STRIPE_TEST_PRICE_YEARLY", unitAmount: 1900 },
  { currency: "brl", mode: "subscription", offer: "pro_year", price: "STRIPE_TEST_PRICE_BR_YEARLY", unitAmount: 3990 },
  { currency: "usd", mode: "payment", offer: "founder", price: "STRIPE_TEST_PRICE_FOUNDER", unitAmount: 3900 },
  { currency: "brl", mode: "payment", offer: "founder", price: "STRIPE_TEST_PRICE_BR_FOUNDER", unitAmount: 12990 },
  { currency: "usd", mode: "payment", offer: "ai_credits_1000", price: "STRIPE_TEST_PRICE_AI_CREDITS_1000", unitAmount: 299 },
  { currency: "brl", mode: "payment", offer: "ai_credits_1000", price: "STRIPE_TEST_PRICE_BR_AI_CREDITS_1000", unitAmount: 990 },
  { currency: "usd", mode: "payment", offer: "storage_5gb_12m", price: "STRIPE_TEST_PRICE_STORAGE_5GB_12M", unitAmount: 299 },
  { currency: "brl", mode: "payment", offer: "storage_5gb_12m", price: "STRIPE_TEST_PRICE_BR_STORAGE_5GB_12M", unitAmount: 990 },
  { currency: "usd", mode: "payment", offer: "storage_20gb_12m", price: "STRIPE_TEST_PRICE_STORAGE_20GB_12M", unitAmount: 799 },
  { currency: "brl", mode: "payment", offer: "storage_20gb_12m", price: "STRIPE_TEST_PRICE_BR_STORAGE_20GB_12M", unitAmount: 2990 },
];

const runId = crypto.randomUUID().replaceAll("-", "");
const sessions = [];
for (const entry of offers) {
  const priceId = required(values, entry.price);
  if (!priceId.startsWith("price_") || priceId.includes("live")) {
    throw new Error(`Refusing to use invalid test price from ${entry.price}`);
  }
  const idempotencyKey = `pinar:test:${entry.offer}:${entry.currency}:${runId}`;
  sessions.push(await createCheckoutSession({
    currency: entry.currency,
    idempotencyKey,
    mode: entry.mode,
    offer: entry.offer,
    priceId,
    secretKey,
    unitAmount: entry.unitAmount,
  }));
}

const first = offers[0];
const replay = await createCheckoutSession({
  currency: first.currency,
  idempotencyKey: `pinar:test:${first.offer}:${first.currency}:${runId}`,
  mode: first.mode,
  offer: first.offer,
  priceId: required(values, first.price),
  secretKey,
  unitAmount: first.unitAmount,
});
if (replay.id !== sessions[0].id) throw new Error("Stripe idempotency replay created a different session");

console.log(JSON.stringify({
  created: sessions.length,
  idempotencyReplay: true,
  sessions,
}, null, 2));
