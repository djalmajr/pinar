import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import type { ComponentTarget } from "@pinar/shared";
import {
  aiEnv,
  getJson,
  isRecord,
  jsonBody,
  paidProCookie,
  postJson,
  uploadCapture,
} from "../../../tests/helpers/cloud-ai";
import { resetCloudMemoryStateForTests } from "../cloud-api";

const SESSION_ID = "component_session_0001";
const MODEL = "@cf/qwen/qwen2.5-coder-32b-instruct";

const CARD_PIN = {
  box: { height: 220, width: 320, x: 40, y: 120 },
  comment: "Save this pricing card",
  coords: { x: 60, y: 140 },
  number: 1,
  pinId: "pin_card",
  snapshot: {
    fonts: [{ family: "Inter", src: "https://fonts.gstatic.com/s/inter/v13/inter.woff2", weight: "600" }],
    icons: [{ kind: "class", name: "lucide-check" }],
    nodeCount: 4,
    root: {
      attrs: { class: "plan-card" },
      children: [
        { styles: { "font-size": "20px", "font-weight": "600" }, tag: "h3", text: "Team" },
        { styles: { "font-size": "32px" }, tag: "p", text: "$29" },
        { attrs: { class: "lucide-check" }, tag: "i" },
      ],
      styles: { "background-color": "rgb(255, 255, 255)", "border-radius": "12px", padding: "24px" },
      tag: "article",
    },
    truncated: false,
    version: 1,
  },
  tag: "article",
  type: "point",
};

const BUTTON_PIN = {
  box: { height: 40, width: 140, x: 300, y: 500 },
  comment: "Save this button",
  coords: { x: 310, y: 510 },
  number: 2,
  pinId: "pin_button",
  snapshot: {
    fonts: [],
    icons: [{ kind: "class", name: "fas fa-arrow-right" }],
    nodeCount: 2,
    root: {
      attrs: { "aria-label": "Continue to checkout", class: "btn btn-primary", type: "button" },
      children: [{ attrs: { class: "fas fa-arrow-right" }, tag: "i" }],
      styles: { "background-color": "rgb(37, 99, 235)", color: "rgb(255, 255, 255)", padding: "10px 16px" },
      tag: "button",
      text: "Continue",
    },
    truncated: false,
    version: 1,
  },
  tag: "button",
  type: "point",
};

const PRICING_TABLE_PIN = {
  comment: "Save the comparison table",
  coords: { x: 100, y: 800 },
  number: 3,
  pinId: "pin_table",
  snapshot: {
    fonts: [],
    icons: [],
    nodeCount: 3,
    root: {
      children: [
        { children: [{ tag: "th", text: "Plan" }, { tag: "th", text: "Price" }], tag: "tr" },
        { children: [{ tag: "td", text: "Team" }, { tag: "td", text: "$29" }], tag: "tr" },
      ],
      styles: { "border-collapse": "collapse" },
      tag: "table",
    },
    truncated: false,
    version: 1,
  },
  tag: "table",
  type: "point",
};

const FORM_PIN = {
  comment: "Save the newsletter form",
  coords: { x: 100, y: 1200 },
  number: 4,
  pinId: "pin_form",
  snapshot: {
    fonts: [],
    icons: [],
    nodeCount: 3,
    root: {
      children: [
        { attrs: { for: "email" }, tag: "label", text: "Email" },
        { attrs: { id: "email", name: "email", type: "email" }, tag: "input" },
      ],
      tag: "form",
    },
    truncated: false,
    version: 1,
  },
  tag: "form",
  type: "point",
};

const PLAIN_PIN = {
  comment: "No structure captured here",
  coords: { x: 10, y: 10 },
  number: 5,
  pinId: "pin_plain",
  type: "point",
};

const PREVIEW = "<!doctype html><html><head><link rel=\"stylesheet\" href=\"https://fonts.googleapis.com/css2?family=Inter:wght@600&display=swap\"><style>.plan-card{padding:24px}</style></head><body><article class=\"plan-card\"><h3>Team</h3></article></body></html>";

const SOURCES: Record<ComponentTarget, Record<string, string>> = {
  html: {
    "component.css": ".plan-card { padding: 24px; border-radius: 12px; }",
    "component.html": "<article class=\"plan-card\"><h3>Team</h3><p>$29</p><iconify-icon icon=\"lucide:check\"></iconify-icon></article>",
  },
  "preact-htm": {
    "component.js": "import { h } from \"https://esm.sh/preact@10\";\nimport htm from \"https://esm.sh/htm@3\";\nconst html = htm.bind(h);\nexport function Component() { return html`<article class=\"plan-card\">Team</article>`; }",
  },
  "react-tailwind": {
    "Component.tsx": "import { Icon } from \"@iconify/react\";\nexport default function Component() { return <article className=\"rounded-xl bg-white p-6\"><Icon icon=\"lucide:check\" /></article>; }",
  },
};

function modelReply(target: ComponentTarget) {
  const files = { "preview.html": PREVIEW, ...SOURCES[target] };
  const blocks = Object.entries(files).map(([path, content]) => `===FILE: ${path}===\n${content}\n===END===`).join("\n");
  const dependencies = target === "react-tailwind" ? "@iconify/react" : "https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js";
  return `${blocks}\n===DEPENDENCIES===\n${dependencies}\n===NOTES===\nInter loaded from Google Fonts`;
}

interface ModelCall {
  input: unknown;
  model: string;
}

function stubEnv(reply: (call: ModelCall) => string) {
  const calls: ModelCall[] = [];
  const env = aiEnv(async (model, input) => {
    const call = { input, model };
    calls.push(call);
    return {
      choices: [{ message: { content: reply(call) } }],
      usage: { completion_tokens: 900, prompt_tokens: 2_400 },
    };
  });
  return { calls, env };
}

async function seeded(reply: (call: ModelCall) => string) {
  const stub = stubEnv(reply);
  const paid = await paidProCookie(stub.env);
  const uploaded = await uploadCapture(paid.cookie, {
    id: SESSION_ID,
    pins: [CARD_PIN, BUTTON_PIN, PRICING_TABLE_PIN, FORM_PIN, PLAIN_PIN],
  }, paid.env);
  assert.equal(uploaded.status, 201);
  return { calls: stub.calls, cookie: paid.cookie, env: paid.env };
}

function exportRequest(cookie: string, env: Parameters<typeof postJson>[3], body: Record<string, unknown>) {
  return postJson("/api/ai/component-export", { sessionId: SESSION_ID, ...body }, cookie, env);
}

async function balance(cookie: string, env: Parameters<typeof getJson>[2]) {
  const entitlements = await jsonBody(await getJson("/api/account/entitlements", cookie, env));
  assert.ok(isRecord(entitlements.aiCredits));
  return entitlements.aiCredits.balance;
}

async function storedPin(cookie: string, env: Parameters<typeof getJson>[2], pinId: string) {
  const body = await jsonBody(await getJson(`/api/sessions/${SESSION_ID}`, cookie, env));
  assert.ok(isRecord(body.session));
  assert.ok(Array.isArray(body.session.pins));
  const pin = body.session.pins.find((item: unknown) => isRecord(item) && item.pinId === pinId);
  assert.ok(isRecord(pin));
  return pin;
}

describe("POST /api/ai/component-export", () => {
  beforeEach(() => resetCloudMemoryStateForTests());

  for (const [target, pinId, requiredFile] of [
    ["html", "pin_card", "component.html"],
    ["react-tailwind", "pin_button", "Component.tsx"],
    ["preact-htm", "pin_table", "component.js"],
  ] as const) {
    test(`exports ${target} from the snapshot, persists the component and the target preference`, async () => {
      const { calls, cookie, env } = await seeded(() => modelReply(target));

      const response = await exportRequest(cookie, env, { pinId, requestId: `component_req_${target}_1`, target });

      assert.equal(response.status, 200);
      const body = await jsonBody(response);
      assert.equal(body.creditsCharged, 10);
      assert.equal(body.idempotent, false);
      assert.ok(isRecord(body.aiCredits));
      assert.equal(body.aiCredits.balance, 190);
      assert.ok(isRecord(body.result));
      assert.equal(body.result.target, target);
      assert.equal(body.result.preview, PREVIEW);
      assert.ok(Array.isArray(body.result.files));
      assert.ok(body.result.files.some((file: unknown) => isRecord(file) && file.path === requiredFile));
      assert.deepEqual(body.result.notes, ["Inter loaded from Google Fonts"]);
      assert.equal(body.result.model, MODEL);

      assert.equal(calls.length, 1);
      assert.equal(calls[0].model, MODEL);
      assert.ok(isRecord(calls[0].input));
      assert.equal(calls[0].input.max_tokens, 4_096);
      assert.equal(calls[0].input.temperature, 0.1);
      assert.ok(Array.isArray(calls[0].input.messages));
      const [system, user] = calls[0].input.messages;
      assert.ok(isRecord(system) && isRecord(user));
      assert.match(String(system.content), /untrusted data/);
      assert.match(String(system.content), /===FILE: preview.html===/);
      assert.match(String(system.content), new RegExp(requiredFile.replace(".", "\\.")));
      const payload: unknown = JSON.parse(String(user.content));
      assert.ok(isRecord(payload));
      assert.equal(payload.target, target);
      assert.ok(isRecord(payload.snapshot));
      assert.ok(isRecord(payload.snapshot.root));

      const pin = await storedPin(cookie, env, pinId);
      assert.ok(isRecord(pin.component));
      assert.equal(pin.component.target, target);
      assert.equal(pin.component.preview, PREVIEW);
      const preferences = await jsonBody(await getJson("/api/preferences", cookie, env));
      assert.equal(preferences.componentTarget, target);
    });
  }

  test("maps the card fonts and icons and the button aria attributes into the prompt", async () => {
    const { calls, cookie, env } = await seeded(() => modelReply("html"));

    assert.equal((await exportRequest(cookie, env, { pinId: "pin_card", requestId: "component_req_card_map", target: "html" })).status, 200);
    assert.equal((await exportRequest(cookie, env, { pinId: "pin_button", requestId: "component_req_button_map", target: "html" })).status, 200);

    const payloads = calls.map((call) => {
      assert.ok(isRecord(call.input) && Array.isArray(call.input.messages) && isRecord(call.input.messages[1]));
      const parsed: unknown = JSON.parse(String(call.input.messages[1].content));
      assert.ok(isRecord(parsed));
      return parsed;
    });
    assert.ok(Array.isArray(payloads[0].fonts) && isRecord(payloads[0].fonts[0]));
    assert.equal(payloads[0].fonts[0].link, "https://fonts.googleapis.com/css2?family=Inter:wght@600&display=swap");
    assert.ok(Array.isArray(payloads[0].icons) && isRecord(payloads[0].icons[0]));
    assert.equal(payloads[0].icons[0].iconify, "lucide:check");
    assert.deepEqual(payloads[0].box, { height: 220, width: 320, x: 40, y: 120 });
    assert.ok(Array.isArray(payloads[1].icons) && isRecord(payloads[1].icons[0]));
    assert.equal(payloads[1].icons[0].iconify, "fa6-solid:arrow-right");
    assert.ok(isRecord(payloads[1].snapshot) && isRecord(payloads[1].snapshot.root) && isRecord(payloads[1].snapshot.root.attrs));
    assert.equal(payloads[1].snapshot.root.attrs["aria-label"], "Continue to checkout");
    assert.equal(await balance(cookie, env), 180);
  });

  test("replays the same requestId without calling the model again", async () => {
    const { calls, cookie, env } = await seeded(() => modelReply("react-tailwind"));
    const body = { pinId: "pin_form", requestId: "component_req_replay_1", target: "react-tailwind" };

    const first = await jsonBody(await exportRequest(cookie, env, body));
    const replay = await jsonBody(await exportRequest(cookie, env, body));

    assert.equal(replay.idempotent, true);
    assert.deepEqual(replay.result, first.result);
    assert.equal(calls.length, 1);
    assert.equal(await balance(cookie, env), 190);
  });

  test("refunds the credits when the model returns an empty or malformed reply", async () => {
    let reply = "";
    const { calls, cookie, env } = await seeded(() => reply);

    const empty = await exportRequest(cookie, env, { pinId: "pin_card", requestId: "component_req_empty_1", target: "html" });
    assert.equal(empty.status, 503);
    assert.equal((await jsonBody(empty)).code, "invalid_ai_response");
    assert.equal(await balance(cookie, env), 200);

    reply = "===FILE: component.html===\n<div />\n===END===";
    const malformed = await exportRequest(cookie, env, { pinId: "pin_card", requestId: "component_req_malformed_1", target: "html" });
    assert.equal(malformed.status, 503);
    assert.equal((await jsonBody(malformed)).code, "invalid_ai_response");
    assert.equal(await balance(cookie, env), 200);
    assert.equal(calls.length, 2);
    const pin = await storedPin(cookie, env, "pin_card");
    assert.equal(pin.component, undefined);
  });

  test("rejects a pin without a snapshot with 422 and no charge", async () => {
    const { calls, cookie, env } = await seeded(() => modelReply("html"));

    const response = await exportRequest(cookie, env, { pinId: "pin_plain", requestId: "component_req_plain_1", target: "html" });

    assert.equal(response.status, 422);
    assert.equal((await jsonBody(response)).code, "snapshot_required");
    assert.equal(calls.length, 0);
    assert.equal(await balance(cookie, env), 200);
  });

  test("rejects an invalid target and an unknown pin", async () => {
    const { calls, cookie, env } = await seeded(() => modelReply("html"));

    const invalid = await exportRequest(cookie, env, { pinId: "pin_card", requestId: "component_req_invalid_1", target: "vue" });
    assert.equal(invalid.status, 400);
    assert.equal((await jsonBody(invalid)).code, "invalid_target");
    const missing = await exportRequest(cookie, env, { pinId: "pin_missing", requestId: "component_req_missing_1", target: "html" });
    assert.equal(missing.status, 404);
    assert.equal(calls.length, 0);
  });
});
