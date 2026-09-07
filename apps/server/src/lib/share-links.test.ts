import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildShareUrl,
  canManageCloudShare,
  fetchActiveShare,
  isActiveShareToken,
  publishShare,
  revokeShare,
  shareMarkdownPath,
} from "./share-links";

const originalFetch = globalThis.fetch;

async function withFetch<T>(
  mock: typeof fetch,
  run: () => Promise<T>,
) {
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

describe("share link helpers", () => {
  test("buildShareUrl writes the canonical tokenized markdown URL", () => {
    assert.equal(
      buildShareUrl("sess_1", "sh_abc", "https://pinar.dev"),
      "https://pinar.dev/v/sess_1.md?token=sh_abc",
    );
    assert.equal(shareMarkdownPath("sess_1"), "/v/sess_1.md");
    assert.equal(shareMarkdownPath("sess_1", "sh_abc"), "/v/sess_1.md?token=sh_abc");
  });

  test("isActiveShareToken treats revoked and expired rows as inactive", () => {
    const now = Date.parse("2026-09-07T12:00:00.000Z");
    assert.equal(isActiveShareToken({ token: "sh_live", status: "active" }, now), true);
    assert.equal(isActiveShareToken({ token: "sh_live", expiresAt: null }, now), true);
    assert.equal(isActiveShareToken({ token: "sh_revoked", status: "revoked" }, now), false);
    assert.equal(isActiveShareToken({
      revokedAt: "2026-09-01T00:00:00.000Z",
      token: "sh_revoked",
    }, now), false);
    assert.equal(isActiveShareToken({
      expiresAt: "2026-09-01T00:00:00.000Z",
      status: "active",
      token: "sh_expired",
    }, now), false);
    assert.equal(isActiveShareToken({ token: "" }, now), false);
  });

  test("fetchActiveShare returns the matching live token", async () => {
    await withFetch(async (input) => {
      assert.equal(String(input), "/api/shares");
      return Response.json({
        ok: true,
        tokens: [
          {
            expiresAt: "2020-01-01T00:00:00.000Z",
            resourceId: "sess_1",
            resourceType: "session",
            status: "active",
            token: "sh_expired",
          },
          {
            resourceId: "sess_1",
            resourceType: "session",
            status: "revoked",
            token: "sh_revoked",
          },
          {
            resourceId: "sess_other",
            resourceType: "session",
            status: "active",
            token: "sh_other",
          },
          {
            expiresAt: null,
            resourceId: "sess_1",
            resourceType: "session",
            status: "active",
            token: "sh_live",
          },
        ],
      });
    }, async () => {
      assert.equal(await fetchActiveShare("session", "sess_1"), "sh_live");
    });
  });

  test("publishShare reads the token from a 201 body", async () => {
    await withFetch(async (input, init) => {
      assert.equal(String(input), "/api/shares/publish");
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        resourceId: "sess_1",
        resourceType: "session",
      });
      return Response.json({
        ok: true,
        shareToken: { expiresAt: null, token: "sh_new" },
      }, { status: 201 });
    }, async () => {
      assert.equal(await publishShare("session", "sess_1"), "sh_new");
    });
  });

  test("revokeShare treats 404 as already unpublished", async () => {
    await withFetch(async () => new Response(null, { status: 404 }), async () => {
      await revokeShare("session", "sess_1");
    });
    await withFetch(async () => new Response(null, { status: 500 }), async () => {
      await assert.rejects(() => revokeShare("session", "sess_1"));
    });
  });

  test("canManageCloudShare is only for authenticated cloud owners", () => {
    const session = { userId: "usr_owner" };
    const account = {
      email: "owner@example.test",
      kind: "account" as const,
      plan: "pro" as const,
      userId: "usr_owner",
    };
    assert.equal(canManageCloudShare("cloud", account, session), true);
    assert.equal(canManageCloudShare("local", account, session), false);
    assert.equal(canManageCloudShare("cloud", null, session), false);
    assert.equal(canManageCloudShare("cloud", account, null), false);
    assert.equal(canManageCloudShare("cloud", { ...account, userId: "usr_other" }, session), false);
    assert.equal(canManageCloudShare("cloud", account, { userId: null }), true);
    assert.equal(canManageCloudShare("cloud", { kind: "local", plan: "free" }, session), false);
    assert.equal(canManageCloudShare("cloud", {
      installationId: "inst_owner",
      kind: "installation",
      plan: "free",
    }, { userId: "inst_owner" }), true);
  });
});
