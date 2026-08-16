import assert from "node:assert/strict";

const VALID_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

type ApiClient = (path: string, init?: RequestInit) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function jsonRecord(response: Response) {
  const body: unknown = await response.json();
  assert.ok(isRecord(body));
  return body;
}

function idOf(value: unknown) {
  assert.ok(isRecord(value));
  assert.equal(typeof value.id, "string");
  return value.id;
}

async function post(client: ApiClient, path: string, body: unknown) {
  return client(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function exerciseProjectApiContract(client: ApiClient) {
  const initialTree = await jsonRecord(await client("/api/project-tree"));
  assert.ok(isRecord(initialTree.tree));
  assert.ok(Array.isArray(initialTree.tree.projects));
  const personal = initialTree.tree.projects[0];
  const personalId = idOf(personal);
  assert.ok(isRecord(personal));
  assert.ok(Array.isArray(personal.collections));
  const inboxId = idOf(personal.collections[0]);

  const alphaBody = await jsonRecord(await post(client, "/api/projects", { name: "Alpha" }));
  const betaBody = await jsonRecord(await post(client, "/api/projects", { name: "Beta" }));
  const alphaId = idOf(alphaBody.project);
  const betaId = idOf(betaBody.project);

  const renameProject = await client(`/api/projects/${alphaId}`, {
    body: JSON.stringify({ name: "Alpha renamed" }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  assert.equal(renameProject.status, 200);
  assert.equal((await jsonRecord(renameProject)).project && true, true);
  assert.equal((await post(client, "/api/projects/reorder", { ids: [betaId, alphaId, personalId] })).status, 200);
  const projectsBody = await jsonRecord(await client("/api/projects"));
  assert.ok(Array.isArray(projectsBody.projects));
  assert.deepEqual(projectsBody.projects.map(idOf), [betaId, alphaId, personalId]);

  const reviewBody = await jsonRecord(await post(client, `/api/projects/${alphaId}/collections`, { name: "Review" }));
  const readyBody = await jsonRecord(await post(client, `/api/projects/${alphaId}/collections`, { name: "Ready" }));
  const reviewId = idOf(reviewBody.collection);
  const readyId = idOf(readyBody.collection);
  const nestedBody = await jsonRecord(await post(
    client,
    `/api/projects/${alphaId}/collections`,
    { name: "Nested", parentId: reviewId },
  ));
  const nestedId = idOf(nestedBody.collection);
  // Mutation captured: ignoring parentId during creation leaves the collection at the root.
  assert.equal(isRecord(nestedBody.collection) && nestedBody.collection.parentId, reviewId);
  assert.equal((await post(client, `/api/projects/${alphaId}/collections/reorder`, {
    items: [
      { id: readyId, parentId: null },
      { id: reviewId, parentId: null },
      { id: nestedId, parentId: reviewId },
    ],
  })).status, 200);
  assert.equal((await post(client, `/api/projects/${alphaId}/collections/reorder`, {
    items: [
      { id: readyId, parentId: null },
      { id: reviewId, parentId: nestedId },
      { id: nestedId, parentId: reviewId },
    ],
  })).status, 400);
  const renameCollection = await client(`/api/collections/${readyId}`, {
    body: JSON.stringify({ name: "Done" }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
  assert.equal(renameCollection.status, 200);
  const collectionsBody = await jsonRecord(await client(`/api/projects/${alphaId}/collections`));
  assert.ok(Array.isArray(collectionsBody.collections));
  assert.deepEqual(collectionsBody.collections.map(idOf), [readyId, reviewId, nestedId]);
  assert.equal(
    collectionsBody.collections.find((item) => idOf(item) === nestedId)?.parentId,
    reviewId,
  );

  for (const id of ["contract_session_one", "contract_session_two"]) {
    const upload = await post(client, "/api/shots", {
      collectionId: reviewId,
      id,
      image: VALID_PNG,
      page: { title: id },
      pins: [],
    });
    assert.equal(upload.status, 201);
  }
  const reorderSessions = await jsonRecord(await post(
    client,
    `/api/collections/${reviewId}/sessions/reorder`,
    { ids: ["contract_session_two", "contract_session_one"] },
  ));
  assert.ok(Array.isArray(reorderSessions.sessions));
  assert.deepEqual(reorderSessions.sessions.map(idOf), ["contract_session_two", "contract_session_one"]);

  const moved = await jsonRecord(await post(client, "/api/sessions/contract_session_one/move", { collectionId: readyId }));
  assert.ok(isRecord(moved.session));
  assert.equal(moved.session.collectionId, readyId);
  assert.equal((await client(`/api/collections/${readyId}`, { method: "DELETE" })).status, 200);
  assert.equal((await jsonRecord(await client("/api/sessions/contract_session_one"))).session && true, true);
  const movedAfterCollectionDelete = await jsonRecord(await client("/api/sessions/contract_session_one"));
  assert.ok(isRecord(movedAfterCollectionDelete.session));
  assert.equal(movedAfterCollectionDelete.session.collectionId, inboxId);

  assert.equal((await client(`/api/collections/${reviewId}`, { method: "DELETE" })).status, 200);
  const promotedCollections = await jsonRecord(await client(`/api/projects/${alphaId}/collections`));
  assert.ok(Array.isArray(promotedCollections.collections));
  const promotedNested = promotedCollections.collections.find((item) => idOf(item) === nestedId);
  assert.ok(isRecord(promotedNested));
  assert.equal(promotedNested.parentId, null);

  assert.equal((await client(`/api/projects/${alphaId}`, { method: "DELETE" })).status, 200);
  const movedAfterProjectDelete = await jsonRecord(await client("/api/sessions/contract_session_two"));
  assert.ok(isRecord(movedAfterProjectDelete.session));
  assert.equal(movedAfterProjectDelete.session.collectionId, inboxId);
  assert.equal((await client(`/api/projects/${personalId}`, { method: "DELETE" })).status, 409);
  assert.equal((await client(`/api/collections/${inboxId}`, { method: "DELETE" })).status, 409);
}
