// Captions and OCR for a session's pins from one vision call (F3 contract
// §1.3, decision A16).
//
// captionSessionPins sends the session screenshot, which already carries
// the numbered Pinar markers, as a data URL in one chat-completions call
// with thinking off (assistantProviderOptions) and a JSON-schema response
// format: { pins: [{ number, caption, ocr }] }. Numbers outside the pins
// list are ignored; caption and ocr are always cut to
// PIN_CAPTION_MAX_CHARS and PIN_OCR_MAX_CHARS. A screenshot over
// VISION_MAX_IMAGE_BYTES returns [] without calling the endpoint.
//
// The call reuses the F1 endpoint protections (endpoint.ts) and is bounded
// by VISION_TIMEOUT_MS, the F1 turn deadline. Failures throw fixed
// messages; on the appliance nothing is logged.
//
// Through the Vercel AI Gateway (endpoint.gateway, gateway.ts) the body also
// carries providerOptions, the privacy options of the chain, and a call that
// gets a response body logs one assistant_index_cost line and hands it to
// the deployment's recorder (recordIndexCost).

import { assistantTableCostMicros } from "../chain";
import { assistantProviderOptions, type AssistantEndpoint } from "../models";
import { ASSISTANT_TURN_TIMEOUT_MS } from "../turn";
import { clipText } from "./document";
import { postEndpointJson } from "./endpoint";
import { assistantIndexCostLog, gatewayIndexCost, gatewayPrivacyOptions, recordIndexCost, usageTokens, type GatewayCallOptions } from "./gateway";

export const PIN_CAPTION_MAX_CHARS = 300;
export const PIN_OCR_MAX_CHARS = 1000;
export const VISION_MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const VISION_TIMEOUT_MS = ASSISTANT_TURN_TIMEOUT_MS;

export const VISION_PROMPT = [
  "You see a screenshot of a web page with numbered Pinar markers drawn on it.",
  "For each numbered marker listed by the user, describe what is under each numbered Pinar marker; transcribe visible text.",
  "caption: one or two short sentences about the element under the marker.",
  "ocr: the visible text in that region, verbatim, or an empty string.",
  "The marker comments are reviewer notes, given only as context.",
  'Answer only with JSON: {"pins":[{"number":1,"caption":"...","ocr":"..."}]}.',
].join("\n");

const RESPONSE_SCHEMA = {
  additionalProperties: false,
  properties: {
    pins: {
      items: {
        additionalProperties: false,
        properties: {
          caption: { type: "string" },
          number: { type: "integer" },
          ocr: { type: "string" },
        },
        required: ["number", "caption", "ocr"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["pins"],
  type: "object",
};

const INVALID_RESPONSE = "vision response invalid";

/** The chat endpoint of the captions; `gateway` is set for the Vercel AI Gateway. */
export type VisionEndpoint = AssistantEndpoint & { gateway?: GatewayCallOptions };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  }
  return btoa(binary);
}

function markerList(pins: Array<{ comment: string; number: number }>): string {
  const lines = pins.map((pin) => `#${pin.number}: ${pin.comment.trim()}`);
  return `Markers and their comments:\n${lines.join("\n")}`;
}

// The thinking-off flag reaches the body the way the AI SDK spreads
// providerOptions[name] into it.
function thinkingOptions(endpoint: AssistantEndpoint): Record<string, unknown> {
  return Object.assign({}, ...Object.values(assistantProviderOptions(endpoint)));
}

function parseCaptions(body: unknown, numbers: Set<number>): Map<number, { caption: string; ocr: string }> {
  const choices = isRecord(body) ? body["choices"] : undefined;
  const first: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message = isRecord(first) ? first["message"] : undefined;
  const content = isRecord(message) ? message["content"] : undefined;
  if (typeof content !== "string") throw new Error(INVALID_RESPONSE);
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(INVALID_RESPONSE);
  }
  const pins = isRecord(parsed) ? parsed["pins"] : undefined;
  if (!Array.isArray(pins)) throw new Error(INVALID_RESPONSE);
  const captions = new Map<number, { caption: string; ocr: string }>();
  for (const item of pins) {
    if (!isRecord(item)) throw new Error(INVALID_RESPONSE);
    const { caption, number, ocr } = item;
    if (typeof number !== "number" || !Number.isInteger(number)) throw new Error(INVALID_RESPONSE);
    if (typeof caption !== "string" || typeof ocr !== "string") throw new Error(INVALID_RESPONSE);
    if (!numbers.has(number)) continue;
    if (captions.has(number)) throw new Error(INVALID_RESPONSE);
    captions.set(number, {
      caption: clipText(caption.trim(), PIN_CAPTION_MAX_CHARS),
      ocr: clipText(ocr.trim(), PIN_OCR_MAX_CHARS),
    });
  }
  return captions;
}

// The table cost of a caption: usage.prompt_tokens at the input price and
// usage.completion_tokens at the output price of ASSISTANT_MODEL_PRICES;
// null without both counts or without a price for the model.
function captionTableCostMicros(body: unknown, model: string): number | null {
  const prompt = usageTokens(body, "prompt_tokens");
  const completion = usageTokens(body, "completion_tokens");
  if (prompt === null || completion === null) return null;
  return assistantTableCostMicros(model, {
    inputTokens: { cacheRead: undefined, cacheWrite: undefined, total: prompt },
    outputTokens: { total: completion },
  });
}

export async function captionSessionPins(input: {
  endpoint: VisionEndpoint; // the chat endpoint; must accept images (§4)
  fetch?: typeof fetch;
  image: { bytes: Uint8Array; mimeType: "image/png" | "image/jpeg" | "image/webp" };
  pins: Array<{ comment: string; number: number }>;
  timeoutMs?: number;
}): Promise<Array<{ caption: string; number: number; ocr: string }>> {
  if (input.pins.length === 0) return [];
  if (input.image.bytes.byteLength > VISION_MAX_IMAGE_BYTES) return [];
  const body = await postEndpointJson({
    apiKey: input.endpoint.apiKey,
    baseUrl: input.endpoint.baseUrl,
    body: {
      ...thinkingOptions(input.endpoint),
      ...(input.endpoint.gateway ? { providerOptions: gatewayPrivacyOptions(input.endpoint.gateway) } : {}),
      messages: [
        { content: VISION_PROMPT, role: "system" },
        {
          content: [
            { text: markerList(input.pins), type: "text" },
            { image_url: { url: `data:${input.image.mimeType};base64,${base64(input.image.bytes)}` }, type: "image_url" },
          ],
          role: "user",
        },
      ],
      model: input.endpoint.model,
      response_format: {
        json_schema: { name: "pin_captions", schema: RESPONSE_SCHEMA, strict: true },
        type: "json_schema",
      },
    },
    fetch: input.fetch,
    label: "vision request",
    path: "/chat/completions",
    timeoutMs: input.timeoutMs ?? VISION_TIMEOUT_MS,
  });
  if (input.endpoint.gateway) {
    const { model } = input.endpoint;
    const cost = gatewayIndexCost(body, () => captionTableCostMicros(body, model));
    assistantIndexCostLog({ ...cost, kind: "caption", model });
    await recordIndexCost(input.endpoint.gateway, { ...cost, kind: "caption", model });
  }
  const captions = parseCaptions(body, new Set(input.pins.map((pin) => pin.number)));
  const result: Array<{ caption: string; number: number; ocr: string }> = [];
  for (const pin of input.pins) {
    const caption = captions.get(pin.number);
    if (!caption) continue;
    result.push({ caption: caption.caption, number: pin.number, ocr: caption.ocr });
    captions.delete(pin.number);
  }
  return result;
}
