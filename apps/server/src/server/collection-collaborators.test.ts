import assert from "node:assert/strict";
import { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, test } from "node:test";
import {
  type CloudEnv,
  handleCloudApiRequest,
  handleCloudPublicRequest,
  resetCloudMemoryStateForTests,
  seedCloudAccountForTests,
  seedCloudWebSessionForTests,
} from "./cloud-api";

const TEST_ENV: CloudEnv = {
  AUTH_PEPPER: "test-auth-pepper",
  EXTENSION_ORIGIN: "chrome-extension://pinar-test",
};

const VALID_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const VALID_PNG_BYTES = Uint8Array.from(Buffer.from(VALID_PNG_BASE64, "base64"));

function bucketBinding() {
  const store = new Map<string, Uint8Array>();
  const binding = {
    async delete(key: string) {
      store.delete(key);
    },
    async get(key: string) {
      const data = store.get(key);
      if (!data) return null;
      return {
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(data);
            controller.close();
          },
        }),
        httpEtag: "test-etag",
        writeHttpMetadata(headers: Headers) {
          headers.set("content-type", "image/png");
        },
      };
    },
    async put(key: string, value: Uint8Array) {
      store.set(key, value);
    },
  } as unknown as NonNullable<CloudEnv["PINAR_BUCKET"]>;
  return { binding, store };
}

function emailBinding() {
  const sent: Array<{ html?: string; subject?: string; text?: string; to?: string }> = [];
  const binding = {
    async send(message: unknown) {
      sent.push(message as { html?: string; subject?: string; text?: string; to?: string });
      return { messageId: `test-email-${sent.length}` };
    },
  } as unknown as NonNullable<CloudEnv["EMAIL"]>;
  return { binding, sent };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  const body: unknown = await response.json();
  assert.ok(isRecord(body), "Expected response body to be an object");
  return body;
}

describe("cloud collection collaborators and ACL", () => {
  beforeEach(() => {
    resetCloudMemoryStateForTests();
  });

  test("Free owner cannot invite; Pro owner invites; guest sees pending invite in GET /api/collection-invitations", async () => {
    const mail = emailBinding();
    const env: CloudEnv = { ...TEST_ENV, EMAIL: mail.binding };

    const freeOwner = await seedCloudWebSessionForTests({ email: "free-owner@example.com", plan: "free" }, env);
    const proOwner = await seedCloudWebSessionForTests({ email: "pro-owner@example.com", plan: "pro" }, env);
    const guest = await seedCloudWebSessionForTests({ email: "guest@example.com", plan: "free" }, env);

    // Create project and collection for pro owner
    const createProjectRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "Design QA" }),
      headers: { cookie: proOwner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(createProjectRes.status, 201);
    const projectBody = await jsonBody(createProjectRes);
    const projectId = (projectBody.project as Record<string, unknown>).id as string;

    const createCollectionRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Sprint 42" }),
      headers: { cookie: proOwner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(createCollectionRes.status, 201);
    const collectionBody = await jsonBody(createCollectionRes);
    const collectionId = (collectionBody.collection as Record<string, unknown>).id as string;

    // Create project and collection for free owner
    const freeProjectRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "Free Project" }),
      headers: { cookie: freeOwner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const freeProjBody = await jsonBody(freeProjectRes);
    const freeProjId = (freeProjBody.project as Record<string, unknown>).id as string;

    const freeColRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${freeProjId}/collections`, {
      body: JSON.stringify({ name: "Free Collection" }),
      headers: { cookie: freeOwner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const freeColBody = await jsonBody(freeColRes);
    const freeColId = (freeColBody.collection as Record<string, unknown>).id as string;

    // 1. Free owner attempts to invite collaborator -> 403 Forbidden
    const freeInviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${freeColId}/collaborators`, {
      body: JSON.stringify({ email: "guest@example.com" }),
      headers: { cookie: freeOwner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(freeInviteRes.status, 403);
    const freeInviteBody = await jsonBody(freeInviteRes);
    assert.match(String(freeInviteBody.error), /pro plan required/i);

    // 2. Pro owner invites collaborator -> 201 Created
    const proInviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "guest@example.com" }),
      headers: { cookie: proOwner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(proInviteRes.status, 201);
    const proInviteBody = await jsonBody(proInviteRes);
    assert.equal(proInviteBody.ok, true);
    assert.ok(isRecord(proInviteBody.collaborator));
    assert.equal(proInviteBody.collaborator.email, "guest@example.com");
    assert.equal(proInviteBody.collaborator.status, "pending");
    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0]?.to, "guest@example.com");

    // 3. Pro owner cannot invite themselves
    const selfInviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "pro-owner@example.com" }),
      headers: { cookie: proOwner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(selfInviteRes.status, 400);

    // 4. Duplicate invitation is rejected with 409 Conflict
    const dupInviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "GUEST@EXAMPLE.COM" }),
      headers: { cookie: proOwner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(dupInviteRes.status, 409);

    // 5. Guest sees pending invite
    const guestInvitesRes = await handleCloudApiRequest(new Request("https://pinar.test/api/collection-invitations", {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(guestInvitesRes.status, 200);
    const guestInvitesBody = await jsonBody(guestInvitesRes);
    assert.equal(guestInvitesBody.ok, true);
    assert.ok(Array.isArray(guestInvitesBody.invitations));
    assert.equal(guestInvitesBody.invitations.length, 1);
    assert.equal((guestInvitesBody.invitations[0] as Record<string, unknown>).collectionId, collectionId);
    assert.equal((guestInvitesBody.invitations[0] as Record<string, unknown>).collectionName, "Sprint 42");
    assert.equal((guestInvitesBody.invitations[0] as Record<string, unknown>).ownerEmail, "pro-owner@example.com");
  });

  test("Only the invited email account can accept; other account gets 403; stranger sees empty invitations", async () => {
    const env: CloudEnv = { ...TEST_ENV };
    const proOwner = await seedCloudWebSessionForTests({ email: "lead@agency.com", plan: "pro" }, env);
    const targetGuest = await seedCloudWebSessionForTests({ email: "reviewer@client.com", plan: "free" }, env);
    const otherUser = await seedCloudWebSessionForTests({ email: "intruder@evil.com", plan: "free" }, env);

    // Setup collection
    const projRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "Client Work" }),
      headers: { cookie: proOwner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const projectId = ((await jsonBody(projRes)).project as Record<string, unknown>).id as string;

    const colRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Review V1" }),
      headers: { cookie: proOwner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const collectionId = ((await jsonBody(colRes)).collection as Record<string, unknown>).id as string;

    // Invite reviewer@client.com
    const inviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "reviewer@client.com" }),
      headers: { cookie: proOwner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const inviteBody = await jsonBody(inviteRes);
    const membershipId = (inviteBody.collaborator as Record<string, unknown>).id as string;

    // Intruder does not see the invitation
    const intruderInvitesRes = await handleCloudApiRequest(new Request("https://pinar.test/api/collection-invitations", {
      headers: { cookie: otherUser.cookie },
      method: "GET",
    }), env);
    const intruderInvitesBody = await jsonBody(intruderInvitesRes);
    assert.deepEqual(intruderInvitesBody.invitations, []);

    // Intruder tries to accept -> 403 Forbidden
    const intruderAcceptRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membershipId}/accept`, {
      headers: { cookie: otherUser.cookie },
      method: "POST",
    }), env);
    assert.equal(intruderAcceptRes.status, 403);

    // Target guest accepts -> 200 OK
    const guestAcceptRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membershipId}/accept`, {
      headers: { cookie: targetGuest.cookie },
      method: "POST",
    }), env);
    assert.equal(guestAcceptRes.status, 200);
    const guestAcceptBody = await jsonBody(guestAcceptRes);
    assert.equal(guestAcceptBody.ok, true);
    assert.equal(guestAcceptBody.collectionId, collectionId);
    assert.ok(isRecord(guestAcceptBody.collection));

    // After accept, invitation no longer shows in pending list
    const pendingAfterRes = await handleCloudApiRequest(new Request("https://pinar.test/api/collection-invitations", {
      headers: { cookie: targetGuest.cookie },
      method: "GET",
    }), env);
    const pendingAfterBody = await jsonBody(pendingAfterRes);
    assert.deepEqual(pendingAfterBody.invitations, []);
  });

  test("Accepted collaborator accesses collection, sessions, shot image, viewer markdown, and reviews pins", async () => {
    const bucket = bucketBinding();
    const env: CloudEnv = { ...TEST_ENV, PINAR_BUCKET: bucket.binding };

    const owner = await seedCloudWebSessionForTests({ email: "owner@studio.com", plan: "pro" }, env);
    const guest = await seedCloudWebSessionForTests({ email: "qa@client.com", plan: "free" }, env);

    // 1. Create project and collection
    const projRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "E-Commerce Rebrand" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const projectId = ((await jsonBody(projRes)).project as Record<string, unknown>).id as string;

    const colRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Checkout Flow" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const collectionId = ((await jsonBody(colRes)).collection as Record<string, unknown>).id as string;

    // 2. Upload a session and a shot into that collection
    const sessionId = "sess_checkout_test_01";
    await bucket.binding.put(`shots/${sessionId}.png`, VALID_PNG_BYTES, { httpMetadata: { contentType: "image/png" } });
    const shotUploadRes = await handleCloudApiRequest(new Request("https://pinar.test/api/history", {
      body: JSON.stringify({
        collectionId,
        id: sessionId,
        page: { title: "Payment Screen", url: "https://example.test/pay" },
        pins: [
          { comment: "Button is off-center", id: "pin_01", number: 1 },
          { comment: "Copy error here", id: "pin_02", number: 2 },
        ],
        shotId: sessionId,
      }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(shotUploadRes.status, 201);

    // 3. Invite and accept
    const inviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "qa@client.com" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const membershipId = ((await jsonBody(inviteRes)).collaborator as Record<string, unknown>).id as string;

    await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membershipId}/accept`, {
      headers: { cookie: guest.cookie },
      method: "POST",
    }), env);

    // 4. Guest fetches shared collections
    const sharedRes = await handleCloudApiRequest(new Request("https://pinar.test/api/shared-collections", {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(sharedRes.status, 200);
    const sharedBody = await jsonBody(sharedRes);
    assert.equal(sharedBody.ok, true);
    assert.ok(Array.isArray(sharedBody.collections));
    assert.equal(sharedBody.collections.length, 1);
    assert.equal((sharedBody.collections[0] as Record<string, unknown>).id, collectionId);
    assert.equal((sharedBody.collections[0] as Record<string, unknown>).name, "Checkout Flow");
    assert.equal((sharedBody.collections[0] as Record<string, unknown>).ownerEmail, "owner@studio.com");
    assert.equal((sharedBody.collections[0] as Record<string, unknown>).sessionCount, 1);

    // 5. Guest loads collection details with sessions
    const colDetailsRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(colDetailsRes.status, 200);
    const colDetailsBody = await jsonBody(colDetailsRes);
    assert.equal(colDetailsBody.ok, true);
    const collectionData = colDetailsBody.collection as Record<string, unknown>;
    assert.equal(collectionData.name, "Checkout Flow");
    assert.ok(Array.isArray(collectionData.sessions));
    assert.equal((collectionData.sessions as unknown[]).length, 1);

    // 6. Guest loads session
    const sessionRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(sessionRes.status, 200);
    const sessionBody = await jsonBody(sessionRes);
    const sessionData = sessionBody.session as Record<string, unknown>;
    assert.equal(sessionData.id, sessionId);
    assert.equal((sessionData.page as Record<string, unknown>).title, "Payment Screen");

    // 7. Guest loads shot image directly without public share token
    const shotImageRes = await handleCloudPublicRequest(new Request(`https://pinar.test/shots/${sessionId}.png`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(shotImageRes.status, 200);
    assert.equal(shotImageRes.headers.get("content-type"), "image/png");

    // 8. Guest loads markdown view
    const mdRes = await handleCloudPublicRequest(new Request(`https://pinar.test/v/${sessionId}.md`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(mdRes.status, 200);
    const mdText = await mdRes.text();
    assert.match(mdText, /Payment Screen/);
    assert.equal(mdRes.headers.get("cache-control"), "private, no-store");

    // 9. Guest loads collection markdown view
    const colMdRes = await handleCloudPublicRequest(new Request(`https://pinar.test/c/${collectionId}.md`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(colMdRes.status, 200);
    const colMdText = await colMdRes.text();
    assert.match(colMdText, /Checkout Flow/);
    assert.equal(colMdRes.headers.get("cache-control"), "private, no-store");
    const ownerColMdRes = await handleCloudPublicRequest(new Request(`https://pinar.test/c/${collectionId}.md`, {
      headers: { cookie: owner.cookie },
      method: "GET",
    }), env);
    assert.equal(ownerColMdRes.status, 200);
    assert.match(await ownerColMdRes.text(), /Checkout Flow/);
    assert.equal(ownerColMdRes.headers.get("cache-control"), "private, no-store");

    // 10. Agent changes pin, and guest reviews pin (accept then reopen)
    const execRes = await handleCloudApiRequest(new Request("https://pinar.test/api/agent-executions", {
      body: JSON.stringify({
        agent: "cursor",
        captureId: sessionId,
        idempotencyKey: "exec_collab_test_01",
        results: [{ commit: "c1", files: ["index.html"], pinId: "pin_01", status: "changed", summary: "Centered button" }],
      }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(execRes.status, 201);

    const pinAcceptRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}/pins/pin_01/review`, {
      body: JSON.stringify({ action: "accept" }),
      headers: { cookie: guest.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(pinAcceptRes.status, 200);
    const pinAcceptBody = await jsonBody(pinAcceptRes);
    assert.equal(pinAcceptBody.ok, true);
    assert.equal((pinAcceptBody.review as Record<string, unknown>).status, "accepted");

    const pinReopenRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}/pins/pin_01/review`, {
      body: JSON.stringify({ action: "reopen" }),
      headers: { cookie: guest.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(pinReopenRes.status, 200);
    const pinReopenBody = await jsonBody(pinReopenRes);
    assert.equal(pinReopenBody.ok, true);
    assert.equal((pinReopenBody.review as Record<string, unknown>).status, "reopened");
  });

  test("Strict non-inheritance: collaborator cannot access subcollection, sibling collection, or isolated ID", async () => {
    const env: CloudEnv = { ...TEST_ENV };
    const owner = await seedCloudWebSessionForTests({ email: "architect@org.com", plan: "pro" }, env);
    const guest = await seedCloudWebSessionForTests({ email: "contractor@org.com", plan: "free" }, env);

    // 1. Create project
    const projRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "Core Architecture" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const projectId = ((await jsonBody(projRes)).project as Record<string, unknown>).id as string;

    // 2. Create parent collection A (shared)
    const colARes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Parent Collection A" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const colAId = ((await jsonBody(colARes)).collection as Record<string, unknown>).id as string;

    // 3. Create subcollection A1 under parent collection A
    const subColRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Subcollection A1", parentId: colAId }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const subColId = ((await jsonBody(subColRes)).collection as Record<string, unknown>).id as string;

    // 4. Create sibling collection B in the same project
    const colBRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Sibling Collection B" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const colBId = ((await jsonBody(colBRes)).collection as Record<string, unknown>).id as string;

    // Upload sessions to subcollection and sibling
    const subSessionId = "sess_sub_01";
    await handleCloudApiRequest(new Request("https://pinar.test/api/history", {
      body: JSON.stringify({
        collectionId: subColId,
        id: subSessionId,
        page: { title: "Sub Page", url: "https://example.test/sub" },
        pins: [{ comment: "Sub pin", id: "p_sub", number: 1 }],
      }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);

    const siblingSessionId = "sess_sibling_01";
    await handleCloudApiRequest(new Request("https://pinar.test/api/history", {
      body: JSON.stringify({
        collectionId: colBId,
        id: siblingSessionId,
        page: { title: "Sibling Page", url: "https://example.test/sibling" },
        pins: [{ comment: "Sibling pin", id: "p_sib", number: 1 }],
      }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);

    // Invite contractor to Collection A ONLY and accept
    const inviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${colAId}/collaborators`, {
      body: JSON.stringify({ email: "contractor@org.com" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const membershipId = ((await jsonBody(inviteRes)).collaborator as Record<string, unknown>).id as string;
    await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membershipId}/accept`, {
      headers: { cookie: guest.cookie },
      method: "POST",
    }), env);

    // Guest has access to Collection A
    const accARes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${colAId}`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(accARes.status, 200);

    // Guest CANNOT access Subcollection A1 (404)
    const accSubRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${subColId}`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(accSubRes.status, 404);

    // Guest CANNOT access subcollection session (404)
    const accSubSessRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${subSessionId}`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(accSubSessRes.status, 404);

    // Guest CANNOT access Sibling Collection B (404)
    const accBRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${colBId}`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(accBRes.status, 404);

    // Guest CANNOT access sibling session (404)
    const accSibSessRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${siblingSessionId}`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(accSibSessRes.status, 404);

    // Guest cannot guess isolated unknown IDs (404)
    const isolatedRes = await handleCloudApiRequest(new Request("https://pinar.test/api/collections/col_isolated_9999", {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(isolatedRes.status, 404);
  });

  test("Mutations remain owner-only: collaborator cannot delete, patch, rename, invite, or reorder", async () => {
    const env: CloudEnv = { ...TEST_ENV };
    const owner = await seedCloudWebSessionForTests({ email: "founder@startup.io", plan: "pro" }, env);
    const guest = await seedCloudWebSessionForTests({ email: "guest@startup.io", plan: "free" }, env);

    const projRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "Alpha Project" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const projectId = ((await jsonBody(projRes)).project as Record<string, unknown>).id as string;

    const colRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Alpha Collection" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const collectionId = ((await jsonBody(colRes)).collection as Record<string, unknown>).id as string;

    const sessionId = "sess_mutation_guard_01";
    await handleCloudApiRequest(new Request("https://pinar.test/api/history", {
      body: JSON.stringify({
        collectionId,
        id: sessionId,
        page: { title: "Protected Session", url: "https://example.test/protected" },
        pins: [{ comment: "Protected pin", id: "pin_guard", number: 1 }],
      }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);

    // Invite and accept guest
    const inviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "guest@startup.io" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const membershipId = ((await jsonBody(inviteRes)).collaborator as Record<string, unknown>).id as string;
    await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membershipId}/accept`, {
      headers: { cookie: guest.cookie },
      method: "POST",
    }), env);

    // 1. Guest cannot delete session (404)
    const delSessRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/history/${sessionId}`, {
      headers: { cookie: guest.cookie },
      method: "DELETE",
    }), env);
    assert.equal(delSessRes.status, 404);

    // 2. Guest cannot update session fields (404)
    const patchSessRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}`, {
      body: JSON.stringify({ page: { title: "Hacked Title", url: "https://hacked.test" } }),
      headers: { cookie: guest.cookie, "content-type": "application/json" },
      method: "PATCH",
    }), env);
    assert.equal(patchSessRes.status, 404);

    // 3. Guest cannot rename collection (404)
    const patchColRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
      body: JSON.stringify({ name: "Hacked Collection" }),
      headers: { cookie: guest.cookie, "content-type": "application/json" },
      method: "PATCH",
    }), env);
    assert.equal(patchColRes.status, 404);

    // 4. Guest cannot delete collection (409/404)
    const delColRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
      headers: { cookie: guest.cookie },
      method: "DELETE",
    }), env);
    assert.ok(delColRes.status === 404 || delColRes.status === 409);

    // 5. Guest cannot invite another collaborator (404)
    const inviteThirdRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "third@other.com" }),
      headers: { cookie: guest.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(inviteThirdRes.status, 404);

    // 6. Guest cannot reorder sessions (404)
    const reorderRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/sessions/reorder`, {
      body: JSON.stringify({ ids: [sessionId] }),
      headers: { cookie: guest.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(reorderRes.status, 404);
  });

  test("Owner revokes collaborator: immediately blocks access to collection, session, shot image and reviews", async () => {
    const bucket = bucketBinding();
    const env: CloudEnv = { ...TEST_ENV, PINAR_BUCKET: bucket.binding };

    const owner = await seedCloudWebSessionForTests({ email: "boss@corp.com", plan: "pro" }, env);
    const guest = await seedCloudWebSessionForTests({ email: "temp@contractor.com", plan: "free" }, env);

    const projRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "Confidential Project" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const projectId = ((await jsonBody(projRes)).project as Record<string, unknown>).id as string;

    const colRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Secret Batch" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const collectionId = ((await jsonBody(colRes)).collection as Record<string, unknown>).id as string;

    const sessionId = "sess_confidential_01";
    await bucket.binding.put(`shots/${sessionId}.png`, VALID_PNG_BYTES, { httpMetadata: { contentType: "image/png" } });
    await handleCloudApiRequest(new Request("https://pinar.test/api/history", {
      body: JSON.stringify({
        collectionId,
        id: sessionId,
        page: { title: "Secret Page", url: "https://secret.test" },
        pins: [{ comment: "Leak risk", id: "pin_secret", number: 1 }],
        shotId: sessionId,
      }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);

    // Invite and accept
    const inviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "temp@contractor.com" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const membershipId = ((await jsonBody(inviteRes)).collaborator as Record<string, unknown>).id as string;

    await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membershipId}/accept`, {
      headers: { cookie: guest.cookie },
      method: "POST",
    }), env);

    // Verify access before revocation
    const beforeColRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(beforeColRes.status, 200);

    // Owner lists collaborators
    const listCollabRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      headers: { cookie: owner.cookie },
      method: "GET",
    }), env);
    assert.equal(listCollabRes.status, 200);
    const listCollabBody = await jsonBody(listCollabRes);
    assert.ok(Array.isArray(listCollabBody.collaborators));
    assert.equal(listCollabBody.collaborators.length, 1);
    assert.equal((listCollabBody.collaborators[0] as Record<string, unknown>).status, "accepted");

    // Owner revokes collaborator
    const revokeRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators/${membershipId}`, {
      headers: { cookie: owner.cookie },
      method: "DELETE",
    }), env);
    assert.equal(revokeRes.status, 200);
    const revokeBody = await jsonBody(revokeRes);
    assert.equal(revokeBody.ok, true);

    // Immediate cutoff:
    // 1. GET /api/collections/:id -> 404
    const afterColRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(afterColRes.status, 404);

    // 2. GET /api/sessions/:id -> 404
    const afterSessRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(afterSessRes.status, 404);

    // 3. GET /shots/:id.png -> 404
    const afterShotRes = await handleCloudPublicRequest(new Request(`https://pinar.test/shots/${sessionId}.png`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(afterShotRes.status, 404);

    const revokedSessionMd = await handleCloudPublicRequest(new Request(`https://pinar.test/v/${sessionId}.md`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(revokedSessionMd.status, 404);
    assert.equal(await revokedSessionMd.text(), "Not found");
    assert.equal(revokedSessionMd.headers.get("cache-control"), null);
    const revokedCollectionMd = await handleCloudPublicRequest(new Request(`https://pinar.test/c/${collectionId}.md`, {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    assert.equal(revokedCollectionMd.status, 404);
    assert.equal(await revokedCollectionMd.text(), "Not found");
    assert.equal(revokedCollectionMd.headers.get("cache-control"), null);

    // 4. POST review -> 404
    const afterReviewRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}/pins/pin_secret/review`, {
      body: JSON.stringify({ action: "accept" }),
      headers: { cookie: guest.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(afterReviewRes.status, 404);

    // 5. GET /api/shared-collections -> empty
    const afterSharedRes = await handleCloudApiRequest(new Request("https://pinar.test/api/shared-collections", {
      headers: { cookie: guest.cookie },
      method: "GET",
    }), env);
    const afterSharedBody = await jsonBody(afterSharedRes);
    assert.deepEqual(afterSharedBody.collections, []);
  });

  test("Owner subscription downgrade suspends accepted collaborator access; restoring Pro immediately restores it", async () => {
    const bucket = bucketBinding();
    const env: CloudEnv = { ...TEST_ENV, PINAR_BUCKET: bucket.binding };
    const owner = await seedCloudWebSessionForTests({ email: "founder@bootstrap.co", plan: "pro" }, env);
    const guest1 = await seedCloudWebSessionForTests({ email: "guest1@partner.co", plan: "free" }, env);
    const stranger = await seedCloudWebSessionForTests({ email: "stranger@other.com", plan: "free" }, env);

    const projRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "Bootstrap Project" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const projectId = ((await jsonBody(projRes)).project as Record<string, unknown>).id as string;

    const colRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Shared Assets" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const collectionId = ((await jsonBody(colRes)).collection as Record<string, unknown>).id as string;

    const sessionId = "sess_suspension_test_01";
    await bucket.binding.put(`shots/${sessionId}.png`, VALID_PNG_BYTES, { httpMetadata: { contentType: "image/png" } });
    await handleCloudApiRequest(new Request("https://pinar.test/api/history", {
      body: JSON.stringify({
        collectionId,
        id: sessionId,
        page: { title: "Asset Page", url: "https://example.test/asset" },
        pins: [{ comment: "Fix color", id: "pin_susp", number: 1 }],
        shotId: sessionId,
      }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);

    // While Pro, owner invites guest1
    const inviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "guest1@partner.co" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const membershipId = ((await jsonBody(inviteRes)).collaborator as Record<string, unknown>).id as string;

    // Guest1 accepts
    await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membershipId}/accept`, {
      headers: { cookie: guest1.cookie },
      method: "POST",
    }), env);

    // Active access while owner is Pro
    const initialSharedRes = await handleCloudApiRequest(new Request("https://pinar.test/api/shared-collections", {
      headers: { cookie: guest1.cookie },
      method: "GET",
    }), env);
    const initialSharedBody = await jsonBody(initialSharedRes);
    assert.equal(initialSharedBody.ok, true);
    const initialItems = initialSharedBody.collections as Record<string, unknown>[];
    assert.equal(initialItems.length, 1);
    assert.equal(initialItems[0]?.status, "active");
    assert.equal(initialItems[0]?.isSuspended, false);
    assert.equal("ownerPlan" in (initialItems[0] || {}), false);

    // Simulate owner downgrade to Free
    seedCloudAccountForTests({
      billingStatus: "active",
      email: "founder@bootstrap.co",
      id: owner.accountId,
      plan: "free",
    });

    // 1. New invites are blocked with 403 Forbidden
    const newInviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "guest2@partner.co" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(newInviteRes.status, 403);

    // 2. GET /api/shared-collections lists the collection as suspended, WITHOUT ownerPlan
    const suspendedSharedRes = await handleCloudApiRequest(new Request("https://pinar.test/api/shared-collections", {
      headers: { cookie: guest1.cookie },
      method: "GET",
    }), env);
    assert.equal(suspendedSharedRes.status, 200);
    const suspendedSharedBody = await jsonBody(suspendedSharedRes);
    const suspendedItems = suspendedSharedBody.collections as Record<string, unknown>[];
    assert.equal(suspendedItems.length, 1);
    assert.equal(suspendedItems[0]?.id, collectionId);
    assert.equal(suspendedItems[0]?.status, "suspended");
    assert.equal(suspendedItems[0]?.isSuspended, true);
    assert.equal("ownerPlan" in (suspendedItems[0] || {}), false);

    // 3. GET /api/collections/:id returns 403 with { code: "collection_suspended", error: "Collection access is suspended" }
    const suspendedColRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
      headers: { cookie: guest1.cookie },
      method: "GET",
    }), env);
    assert.equal(suspendedColRes.status, 403);
    const suspendedColBody = await jsonBody(suspendedColRes);
    assert.equal(suspendedColBody.code, "collection_suspended");
    assert.equal(suspendedColBody.error, "Collection access is suspended");

    // 4. Stranger without accepted membership gets generic 404 (does NOT leak collection existence or suspension)
    const strangerColRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
      headers: { cookie: stranger.cookie },
      method: "GET",
    }), env);
    assert.equal(strangerColRes.status, 404);
    const strangerColBody = await jsonBody(strangerColRes);
    assert.equal(strangerColBody.error, "Collection not found");

    // 5. Direct session and review tell the accepted member the collection is suspended.
    const ownerSessRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}`, {
      headers: { cookie: owner.cookie },
      method: "GET",
    }), env);
    assert.equal(ownerSessRes.status, 200);

    const sessRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}`, {
      headers: { cookie: guest1.cookie },
      method: "GET",
    }), env);
    assert.equal(sessRes.status, 403);
    const sessBody = await jsonBody(sessRes);
    assert.equal(sessBody.code, "collection_suspended");
    assert.equal(sessBody.error, "Collection access is suspended");

    const strangerSessRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}`, {
      headers: { cookie: stranger.cookie },
      method: "GET",
    }), env);
    assert.equal(strangerSessRes.status, 404);
    const strangerSessBody = await jsonBody(strangerSessRes);
    assert.equal(strangerSessBody.error, "Session not found");
    assert.equal("code" in strangerSessBody, false);

    const shotRes = await handleCloudPublicRequest(new Request(`https://pinar.test/shots/${sessionId}.png`, {
      headers: { cookie: guest1.cookie },
      method: "GET",
    }), env);
    assert.equal(shotRes.status, 404);

    const mdRes = await handleCloudPublicRequest(new Request(`https://pinar.test/v/${sessionId}.md`, {
      headers: { cookie: guest1.cookie },
      method: "GET",
    }), env);
    assert.equal(mdRes.status, 404);

    const reviewRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}/pins/pin_susp/review`, {
      body: JSON.stringify({ action: "accept" }),
      headers: { cookie: guest1.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(reviewRes.status, 403);
    const reviewBody = await jsonBody(reviewRes);
    assert.equal(reviewBody.code, "collection_suspended");
    assert.equal(reviewBody.error, "Collection access is suspended");

    const strangerReviewRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}/pins/pin_susp/review`, {
      body: JSON.stringify({ action: "accept" }),
      headers: { cookie: stranger.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(strangerReviewRes.status, 404);
    assert.equal((await jsonBody(strangerReviewRes)).code, undefined);

    // 6. Owner upgrades back to Pro -> access is restored WITHOUT re-inviting!
    seedCloudAccountForTests({
      billingStatus: "active",
      email: "founder@bootstrap.co",
      id: owner.accountId,
      plan: "pro",
    });

    const restoredSharedRes = await handleCloudApiRequest(new Request("https://pinar.test/api/shared-collections", {
      headers: { cookie: guest1.cookie },
      method: "GET",
    }), env);
    const restoredSharedBody = await jsonBody(restoredSharedRes);
    const restoredItems = restoredSharedBody.collections as Record<string, unknown>[];
    assert.equal(restoredItems[0]?.status, "active");
    assert.equal(restoredItems[0]?.isSuspended, false);

    const restoredColRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
      headers: { cookie: guest1.cookie },
      method: "GET",
    }), env);
    assert.equal(restoredColRes.status, 200);

    const restoredSessRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}`, {
      headers: { cookie: guest1.cookie },
      method: "GET",
    }), env);
    assert.equal(restoredSessRes.status, 200);

    const restoredReviewRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}/pins/pin_susp/review`, {
      body: JSON.stringify({ action: "accept" }),
      headers: { cookie: guest1.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(restoredReviewRes.status, 409);
    assert.equal((await jsonBody(restoredReviewRes)).code, "invalid_transition");
  });

  test("Account-bound authorization: strictly uses user_id, no email fallback once accepted", async () => {
    const env: CloudEnv = { ...TEST_ENV };
    const owner = await seedCloudWebSessionForTests({ email: "owner@agency.com", plan: "pro" }, env);
    const originalGuest = await seedCloudWebSessionForTests({ email: "shared-email@corp.com", plan: "free" }, env);

    const projRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "Agency Project" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const projectId = ((await jsonBody(projRes)).project as Record<string, unknown>).id as string;

    const colRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Branding" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const collectionId = ((await jsonBody(colRes)).collection as Record<string, unknown>).id as string;

    // Invite and originalGuest accepts
    const inviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "shared-email@corp.com" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const membershipId = ((await jsonBody(inviteRes)).collaborator as Record<string, unknown>).id as string;

    await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membershipId}/accept`, {
      headers: { cookie: originalGuest.cookie },
      method: "POST",
    }), env);

    // Create another account with the same email but different account ID (simulating duplicate/stale session or fixture)
    const duplicateEmailGuest = await seedCloudWebSessionForTests({ email: "shared-email@corp.com", plan: "free" }, env);
    assert.notEqual(duplicateEmailGuest.accountId, originalGuest.accountId);

    // Original guest has access
    const origAccessRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
      headers: { cookie: originalGuest.cookie },
      method: "GET",
    }), env);
    assert.equal(origAccessRes.status, 200);

    // Duplicate email account CANNOT access because user_id does not match
    const dupAccessRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
      headers: { cookie: duplicateEmailGuest.cookie },
      method: "GET",
    }), env);
    assert.equal(dupAccessRes.status, 404);

    const dupSharedRes = await handleCloudApiRequest(new Request("https://pinar.test/api/shared-collections", {
      headers: { cookie: duplicateEmailGuest.cookie },
      method: "GET",
    }), env);
    const dupSharedBody = await jsonBody(dupSharedRes);
    assert.deepEqual(dupSharedBody.collections, []);
  });

  test("Atomic status transitions & race condition: revoke before accept, double accept, revoke already revoked", async () => {
    const env: CloudEnv = { ...TEST_ENV };
    const owner = await seedCloudWebSessionForTests({ email: "admin@corp.com", plan: "pro" }, env);
    const guest = await seedCloudWebSessionForTests({ email: "race@partner.com", plan: "free" }, env);

    const projRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "Race Test Proj" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const projectId = ((await jsonBody(projRes)).project as Record<string, unknown>).id as string;

    const colRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Race Collection" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const collectionId = ((await jsonBody(colRes)).collection as Record<string, unknown>).id as string;

    // 1. Race protection: Owner revokes pending invitation before guest accepts
    const invite1Res = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "race@partner.com" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const membership1Id = ((await jsonBody(invite1Res)).collaborator as Record<string, unknown>).id as string;

    const revoke1Res = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators/${membership1Id}`, {
      headers: { cookie: owner.cookie },
      method: "DELETE",
    }), env);
    assert.equal(revoke1Res.status, 200);

    // Guest attempts to accept revoked invitation -> 404
    const acceptRevokedRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membership1Id}/accept`, {
      headers: { cookie: guest.cookie },
      method: "POST",
    }), env);
    assert.equal(acceptRevokedRes.status, 404);

    // Revoking an already revoked collaborator -> 404
    const doubleRevokeRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators/${membership1Id}`, {
      headers: { cookie: owner.cookie },
      method: "DELETE",
    }), env);
    assert.equal(doubleRevokeRes.status, 404);

    // 2. Double accept prevention
    const invite2Res = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "race@partner.com" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const membership2Id = ((await jsonBody(invite2Res)).collaborator as Record<string, unknown>).id as string;

    const accept1Res = await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membership2Id}/accept`, {
      headers: { cookie: guest.cookie },
      method: "POST",
    }), env);
    assert.equal(accept1Res.status, 200);

    // Second accept of the same invitation -> 404
    const accept2Res = await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membership2Id}/accept`, {
      headers: { cookie: guest.cookie },
      method: "POST",
    }), env);
    assert.equal(accept2Res.status, 404);
  });

  test("revoked member still receives 404 on a suspended collection session and review", async () => {
    const env: CloudEnv = { ...TEST_ENV };
    const owner = await seedCloudWebSessionForTests({ email: "owner-revoke@example.test", plan: "pro" }, env);
    const guest = await seedCloudWebSessionForTests({ email: "revoked@example.test", plan: "free" }, env);

    const projRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "Revoke Project" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const projectId = ((await jsonBody(projRes)).project as Record<string, unknown>).id as string;
    const colRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Revoke Collection" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const collectionId = ((await jsonBody(colRes)).collection as Record<string, unknown>).id as string;
    const sessionId = "sess_revoked_suspend_01";
    await handleCloudApiRequest(new Request("https://pinar.test/api/history", {
      body: JSON.stringify({
        collectionId,
        id: sessionId,
        page: { title: "Revoked", url: "https://example.test/revoked" },
        pins: [{ comment: "note", id: "pin_revoked", number: 1 }],
      }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const inviteRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "revoked@example.test" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const membershipId = ((await jsonBody(inviteRes)).collaborator as Record<string, unknown>).id as string;
    assert.equal((await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${membershipId}/accept`, {
      headers: { cookie: guest.cookie },
      method: "POST",
    }), env)).status, 200);
    assert.equal((await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators/${membershipId}`, {
      headers: { cookie: owner.cookie },
      method: "DELETE",
    }), env)).status, 200);
    seedCloudAccountForTests({
      email: "owner-revoke@example.test",
      id: owner.accountId,
      plan: "free",
    });

    const sessionRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}`, {
      headers: { cookie: guest.cookie },
    }), env);
    assert.equal(sessionRes.status, 404);
    const sessionBody = await jsonBody(sessionRes);
    assert.equal(sessionBody.error, "Session not found");
    assert.equal(sessionBody.code, undefined);
    const reviewRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/sessions/${sessionId}/pins/pin_revoked/review`, {
      body: JSON.stringify({ action: "accept" }),
      headers: { cookie: guest.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    assert.equal(reviewRes.status, 404);
    assert.equal((await jsonBody(reviewRes)).code, undefined);
  });

  test("deleting a collection removes pending and accepted memberships", async () => {
    const env: CloudEnv = { ...TEST_ENV };
    const owner = await seedCloudWebSessionForTests({ email: "owner-delete@example.test", plan: "pro" }, env);
    const pendingGuest = await seedCloudWebSessionForTests({ email: "pending-delete@example.test", plan: "free" }, env);
    const acceptedGuest = await seedCloudWebSessionForTests({ email: "accepted-delete@example.test", plan: "free" }, env);
    const projRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
      body: JSON.stringify({ name: "Delete Project" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const projectId = ((await jsonBody(projRes)).project as Record<string, unknown>).id as string;
    const colRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
      body: JSON.stringify({ name: "Delete Me" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const collectionId = ((await jsonBody(colRes)).collection as Record<string, unknown>).id as string;
    const pendingRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "pending-delete@example.test" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const pendingId = ((await jsonBody(pendingRes)).collaborator as Record<string, unknown>).id as string;
    const acceptedRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
      body: JSON.stringify({ email: "accepted-delete@example.test" }),
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      method: "POST",
    }), env);
    const acceptedId = ((await jsonBody(acceptedRes)).collaborator as Record<string, unknown>).id as string;
    assert.equal((await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${acceptedId}/accept`, {
      headers: { cookie: acceptedGuest.cookie },
      method: "POST",
    }), env)).status, 200);

    const deleted = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
      headers: { cookie: owner.cookie },
      method: "DELETE",
    }), env);
    assert.equal(deleted.status, 200);

    const invitations = await jsonBody(await handleCloudApiRequest(new Request("https://pinar.test/api/collection-invitations", {
      headers: { cookie: pendingGuest.cookie },
    }), env));
    assert.deepEqual(invitations.invitations, []);
    const shared = await jsonBody(await handleCloudApiRequest(new Request("https://pinar.test/api/shared-collections", {
      headers: { cookie: acceptedGuest.cookie },
    }), env));
    assert.deepEqual(shared.collections, []);
    const acceptGone = await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${pendingId}/accept`, {
      headers: { cookie: pendingGuest.cookie },
      method: "POST",
    }), env);
    assert.equal(acceptGone.status, 404);
    assert.equal((await jsonBody(acceptGone)).error, "Invitation not found");
  });

  test("deleting a collection removes collaborator rows in SQLite", async () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    const directory = new URL("../../migrations/", import.meta.url);
    for (const file of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) {
      sqlite.exec(readFileSync(new URL(file, directory), "utf8"));
    }
    const statement = (query: string) => {
      let params: unknown[] = [];
      const bound = {
        async all() {
          return { results: sqlite.query(query).all(...params) as Record<string, unknown>[] };
        },
        bind(...values: unknown[]) {
          params = values.map((value) => value === undefined ? null : value);
          return bound;
        },
        async first() {
          return (sqlite.query(query).get(...params) as Record<string, unknown> | null) ?? null;
        },
        async run() {
          sqlite.query(query).run(...params);
          const changes = sqlite.query("SELECT changes() AS changes").get() as { changes: number };
          return { meta: { changes: changes.changes } };
        },
      };
      return bound;
    };
    const env: CloudEnv = {
      ...TEST_ENV,
      DB: {
        async batch(statements) {
          const results = [];
          for (const item of statements) results.push(await item.run());
          return results;
        },
        prepare(query: string) {
          return statement(query);
        },
      },
    };
    try {
      const now = "2026-09-25T12:00:00.000Z";
      sqlite.exec(
        "INSERT INTO users (id, email, plan, ever_paid, billing_status, created_at, updated_at) VALUES "
        + "('usr_d1_owner', 'd1-owner@example.test', 'pro', 1, 'active', '2026-09-25T12:00:00.000Z', '2026-09-25T12:00:00.000Z'), "
        + "('usr_d1_pending', 'd1-pending@example.test', 'free', 0, 'active', '2026-09-25T12:00:00.000Z', '2026-09-25T12:00:00.000Z'), "
        + "('usr_d1_accepted', 'd1-accepted@example.test', 'free', 0, 'active', '2026-09-25T12:00:00.000Z', '2026-09-25T12:00:00.000Z')",
      );
      async function sessionCookie(userId: string, token: string) {
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
        const tokenHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        sqlite.query(
          "INSERT INTO web_sessions (token_hash, owner_type, owner_id, expires_at, revoked_at, created_at) VALUES (?, 'account', ?, '2027-09-25T12:00:00.000Z', NULL, ?)",
        ).run(tokenHash, userId, now);
        return `pinar_session=${token}`;
      }
      const ownerCookie = await sessionCookie("usr_d1_owner", `pws_${"o".repeat(43)}`);
      const pendingCookie = await sessionCookie("usr_d1_pending", `pws_${"p".repeat(43)}`);
      const acceptedCookie = await sessionCookie("usr_d1_accepted", `pws_${"a".repeat(43)}`);
      const projRes = await handleCloudApiRequest(new Request("https://pinar.test/api/projects", {
        body: JSON.stringify({ name: "D1 Project" }),
        headers: { cookie: ownerCookie, "content-type": "application/json" },
        method: "POST",
      }), env);
      assert.equal(projRes.status, 201);
      const projectId = ((await jsonBody(projRes)).project as Record<string, unknown>).id as string;
      const colRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/projects/${projectId}/collections`, {
        body: JSON.stringify({ name: "D1 Collection" }),
        headers: { cookie: ownerCookie, "content-type": "application/json" },
        method: "POST",
      }), env);
      assert.equal(colRes.status, 201);
      const collectionId = ((await jsonBody(colRes)).collection as Record<string, unknown>).id as string;
      const sessionId = "d1_share_session_01";
      const saved = await handleCloudApiRequest(new Request("https://pinar.test/api/history", {
        body: JSON.stringify({
          collectionId,
          id: sessionId,
          page: { title: "Shared Screen", url: "https://example.test/shared" },
          pins: [{ comment: "Visible on the public link", id: "pin_share", number: 1 }],
        }),
        headers: { cookie: ownerCookie, "content-type": "application/json" },
        method: "POST",
      }), env);
      assert.equal(saved.status, 201);
      const sessionShare = await jsonBody(await handleCloudApiRequest(new Request("https://pinar.test/api/shares/publish", {
        body: JSON.stringify({ resourceId: sessionId, resourceType: "session" }),
        headers: { cookie: ownerCookie, "content-type": "application/json" },
        method: "POST",
      }), env));
      const collectionShare = await jsonBody(await handleCloudApiRequest(new Request("https://pinar.test/api/shares/publish", {
        body: JSON.stringify({ resourceId: collectionId, resourceType: "collection" }),
        headers: { cookie: ownerCookie, "content-type": "application/json" },
        method: "POST",
      }), env));
      const sessionToken = (sessionShare.shareToken as Record<string, unknown>).token;
      const collectionToken = (collectionShare.shareToken as Record<string, unknown>).token;
      const anonymousSession = await handleCloudPublicRequest(
        new Request(`https://pinar.test/v/${sessionId}.md?token=${sessionToken}`),
        env,
      );
      assert.equal(anonymousSession.status, 200);
      assert.match(await anonymousSession.text(), /Shared Screen/);
      assert.equal(anonymousSession.headers.get("cache-control"), "public, max-age=60");
      const strangerSession = await handleCloudPublicRequest(
        new Request(`https://pinar.test/v/${sessionId}.md?token=${sessionToken}`, {
          headers: { cookie: pendingCookie },
        }),
        env,
      );
      assert.equal(strangerSession.status, 200);
      assert.match(await strangerSession.text(), /Shared Screen/);
      assert.equal(strangerSession.headers.get("cache-control"), "public, max-age=60");
      const ownerSession = await handleCloudPublicRequest(
        new Request(`https://pinar.test/v/${sessionId}.md?token=${sessionToken}`, {
          headers: { cookie: ownerCookie },
        }),
        env,
      );
      assert.equal(ownerSession.status, 200);
      assert.match(await ownerSession.text(), /Shared Screen/);
      assert.equal(ownerSession.headers.get("cache-control"), "private, no-store");
      const anonymousCollection = await handleCloudPublicRequest(
        new Request(`https://pinar.test/c/${collectionId}.md?token=${collectionToken}`),
        env,
      );
      assert.equal(anonymousCollection.status, 200);
      assert.match(await anonymousCollection.text(), /D1 Collection/);
      assert.equal(anonymousCollection.headers.get("cache-control"), "public, max-age=60");
      const strangerCollection = await handleCloudPublicRequest(
        new Request(`https://pinar.test/c/${collectionId}.md?token=${collectionToken}`, {
          headers: { cookie: pendingCookie },
        }),
        env,
      );
      assert.equal(strangerCollection.status, 200);
      assert.match(await strangerCollection.text(), /D1 Collection/);
      assert.equal(strangerCollection.headers.get("cache-control"), "public, max-age=60");
      const pendingRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
        body: JSON.stringify({ email: "d1-pending@example.test" }),
        headers: { cookie: ownerCookie, "content-type": "application/json" },
        method: "POST",
      }), env);
      assert.equal(pendingRes.status, 201);
      const pendingId = ((await jsonBody(pendingRes)).collaborator as Record<string, unknown>).id as string;
      const acceptedRes = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}/collaborators`, {
        body: JSON.stringify({ email: "d1-accepted@example.test" }),
        headers: { cookie: ownerCookie, "content-type": "application/json" },
        method: "POST",
      }), env);
      assert.equal(acceptedRes.status, 201);
      const acceptedId = ((await jsonBody(acceptedRes)).collaborator as Record<string, unknown>).id as string;
      assert.equal((await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${acceptedId}/accept`, {
        headers: { cookie: acceptedCookie },
        method: "POST",
      }), env)).status, 200);

      const deleted = await handleCloudApiRequest(new Request(`https://pinar.test/api/collections/${collectionId}`, {
        headers: { cookie: ownerCookie },
        method: "DELETE",
      }), env);
      assert.equal(deleted.status, 200);
      const remaining = sqlite.query(
        "SELECT COUNT(*) AS count FROM collection_collaborators WHERE collection_id = ?",
      ).get(collectionId) as { count: number };
      assert.equal(remaining.count, 0);
      const invitations = await jsonBody(await handleCloudApiRequest(new Request("https://pinar.test/api/collection-invitations", {
        headers: { cookie: pendingCookie },
      }), env));
      assert.deepEqual(invitations.invitations, []);
      const shared = await jsonBody(await handleCloudApiRequest(new Request("https://pinar.test/api/shared-collections", {
        headers: { cookie: acceptedCookie },
      }), env));
      assert.deepEqual(shared.collections, []);
      const acceptGone = await handleCloudApiRequest(new Request(`https://pinar.test/api/collection-invitations/${pendingId}/accept`, {
        headers: { cookie: pendingCookie },
        method: "POST",
      }), env);
      assert.equal(acceptGone.status, 404);
    } finally {
      sqlite.close();
    }
  });
});
