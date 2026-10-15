import type { CloudEnv } from "../cloud-api";

// REST email adapter for the self-hosted EdgeR runtime: it replaces the
// Cloudflare `EMAIL` binding with the Cloudflare Email Service API, using the
// same request shape as the Cinzel server (bearer auth, `redirect: "error"`,
// 15 s timeout, status + numeric error codes in failures only).

const REQUEST_TIMEOUT_MS = 15_000;

interface CloudflareErrorEntry {
  code?: unknown;
}

interface CloudflareEnvelope {
  errors?: CloudflareErrorEntry[];
  messages?: unknown;
  result?: unknown;
  success?: unknown;
}

export interface RestEmailConfig {
  accountId: string;
  apiToken: string;
  fetch?: typeof fetch;
}

// Annotating the return with the binding's type is the cast-free proof that
// this adapter can replace the EMAIL binding in CloudEnv.
export type RestEmail = NonNullable<CloudEnv["EMAIL"]>;

// A `cloudflare:email` EmailMessage instance always carries its raw MIME body;
// the builder form never has such a field.
function isEmailMessage(message: EmailMessage | EmailMessageBuilder): message is EmailMessage {
  return typeof (message as { raw?: unknown }).raw !== "undefined";
}

function recipientEmail(value: string | { email: string }): string {
  return typeof value === "string" ? value : value.email;
}

function recipientList(
  value: string | { email: string } | (string | { email: string })[],
): string | string[] {
  return Array.isArray(value) ? value.map(recipientEmail) : recipientEmail(value);
}

// The Cloudflare REST envelope is read the way Cinzel reads it: defensively,
// tolerating a missing or non-object body. The message id is not pinned by the
// binding's result type, so read it from the usual envelope locations in both
// naming styles and fall back to "" when absent.
function readMessageId(envelope: CloudflareEnvelope): string {
  const sources = [envelope.result];
  if (Array.isArray(envelope.messages)) sources.push(envelope.messages[0]);
  for (const source of sources) {
    if (source === null || typeof source !== "object") continue;
    const record = source as Record<string, unknown>;
    const id = record.messageId ?? record.message_id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return "";
}

export function createRestEmail(config: RestEmailConfig): RestEmail {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/email/sending/send`;
  return {
    async send(message: EmailMessage | EmailMessageBuilder): Promise<EmailSendResult> {
      if (isEmailMessage(message)) {
        throw new Error("EmailMessage is not supported by the REST email adapter");
      }
      const response = await fetchImpl(endpoint, {
        body: JSON.stringify({
          from: recipientEmail(message.from),
          html: message.html,
          subject: message.subject,
          text: message.text,
          to: message.to === undefined ? undefined : recipientList(message.to),
        }),
        headers: {
          Authorization: `Bearer ${config.apiToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      let envelope: CloudflareEnvelope = {};
      try {
        const parsed: unknown = await response.json();
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          envelope = parsed as CloudflareEnvelope;
        }
      } catch {
        envelope = {};
      }
      if (!response.ok || envelope.success !== true) {
        // Status + numeric Cloudflare codes only: never the token, the sent
        // body or any error message text.
        const codes = Array.isArray(envelope.errors)
          ? envelope.errors
              .map((entry) => entry.code)
              .filter((code): code is number => typeof code === "number")
          : [];
        const suffix = codes.length > 0 ? ` ${codes.join(", ")}` : "";
        throw new Error(`email send failed: ${response.status}${suffix}`);
      }
      return { messageId: readMessageId(envelope) };
    },
  };
}
