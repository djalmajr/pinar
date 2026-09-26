import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseVisualCapture, VISUAL_CONTEXT_FIXTURES } from "@pinar/shared";
import { CURRENT_LEGAL_VERSION } from "../lib/legal-documents";
import { handleApiRequest, handlePublicRequest, resetLocalApiForTests } from "./api.local";
import { handleCloudApiRequest, handleCloudPublicRequest, resetCloudMemoryStateForTests } from "./cloud-api";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

for (const mode of ["local", "cloud"]) test(`${mode}: progressive screenshots form one session and combined handoff`, async () => {
  const previousHome = process.env.PINAR_HOME;
  const origin = mode === "local" ? "http://127.0.0.1:17373" : "https://pinar.test";
  const identity = { id: `ins_${"C".repeat(24)}`, token: `pit_${"c".repeat(43)}` };
  const headers = mode === "cloud" ? { authorization: `Bearer ${identity.token}`, "x-pinar-installation-id": identity.id } : {};
  const env = { AUTH_PEPPER: "isolated-session-contract" };
  process.env.PINAR_HOME = mkdtempSync(join(tmpdir(), "pinar-session-contract-"));
  resetLocalApiForTests();
  resetCloudMemoryStateForTests();
  const request = (path: string, body?: unknown, method = body ? "POST" : "GET") => {
    const req = new Request(`${origin}${path}`, { method, headers: { ...headers, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return mode === "local" ? handleApiRequest(req) : handleCloudApiRequest(req, env);
  };
  try {
    if (mode === "cloud") {
      const registered = await request("/api/installations", { installationId: identity.id, installationToken: identity.token, legalAcceptance: { accepted: true, locale: "en", termsVersion: CURRENT_LEGAL_VERSION, privacyVersion: CURRENT_LEGAL_VERSION, acceptableUseVersion: CURRENT_LEGAL_VERSION } });
      expect(registered.status).toBe(201);
    }
    const capture = parseVisualCapture(VISUAL_CONTEXT_FIXTURES.elementV0);
    const batch = { id: "review_contract", label: "Review session", startedAt: new Date().toISOString() };
    for (let index = 0; index < 3; index++) {
      const id = `review_capture_${index}`;
      const uploaded = await request("/api/shots", { ...capture, id, captureId: id, image: png, batch, page: { title: `Page ${index}`, url: `${origin}/page/${index > 0 ? 2 : 1}` }, pins: [{ ...capture.pins[0], id: `pin_${index}`, pinId: `pin_${index}`, comment: `Comment ${index}` }] });
      expect(uploaded.status).toBe(201);
    }
    const history = await (await request("/api/history?batchId=review_contract")).json() as any;
    expect(history.sessions).toHaveLength(3);
    expect(new Set(history.sessions.map((session: any) => session.batchId)).size).toBe(1);
    expect(new Set(history.sessions.map((session: any) => session.shotUrl)).size).toBe(3);
    const finished = await request("/api/batches/review_contract/finish", { finishedAt: new Date().toISOString() });
    expect(finished.status).toBe(200);
    const response = await request("/api/batches/review_contract/markdown");
    expect(response.status).toBe(200);
    const markdown = await response.text();
    expect(markdown).not.toContain("Reference only: full viewer Markdown");
    for (let index = 0; index < 3; index++) {
      expect(markdown).toContain(`Comment ${index}`);
      expect(markdown).toContain(`review_capture_${index}`);
      expect(markdown).toContain(`pin_${index}`);
    }
    const explicitDetailedResponse = await request("/api/batches/review_contract/markdown?includeViewerContent=1");
    expect(explicitDetailedResponse.status).toBe(200);
    expect(await explicitDetailedResponse.text()).toContain("Reference only: full viewer Markdown");
    const preferencePatch = await request(
      "/api/preferences",
      { copyViewerContent: true },
      "PATCH",
    );
    expect(preferencePatch.status).toBe(200);
    const detailedResponse = await request("/api/batches/review_contract/markdown");
    expect(detailedResponse.status).toBe(200);
    const detailed = await detailedResponse.text();
    expect(detailed).toContain("Reference only: full viewer Markdown");
    expect(detailed).toContain("### Page 0");
    expect(detailed).toContain("captureId\":\"review_capture_0\"");
    expect(detailed).toContain("pinId\":\"pin_0\"");
    expect(detailed).not.toContain("token=");
    const pageResponse = await request("/api/sessions/review_capture_0/markdown");
    expect(pageResponse.status).toBe(200);
    const pageMarkdown = await pageResponse.text();
    expect(pageMarkdown).toContain("captureId\":\"review_capture_0\"");
    expect(pageMarkdown).toContain("pinId\":\"pin_0\"");
    expect(pageMarkdown).not.toContain("token=");
    const includeViewerOff = await request(
      "/api/preferences",
      { includeViewer: false },
      "PATCH",
    );
    expect(includeViewerOff.status).toBe(200);
    const compactAfterViewerOff = await request("/api/batches/review_contract/markdown");
    expect(compactAfterViewerOff.status).toBe(200);
    expect(await compactAfterViewerOff.text()).not.toContain("Reference only: full viewer Markdown");
    const explicitAfterViewerOff = await request("/api/batches/review_contract/markdown?includeViewerContent=1");
    expect(explicitAfterViewerOff.status).toBe(200);
    expect(await explicitAfterViewerOff.text()).not.toContain("Reference only: full viewer Markdown");
    const pageAfterViewerOff = await request("/api/sessions/review_capture_0/markdown");
    expect(pageAfterViewerOff.status).toBe(200);
    expect(await pageAfterViewerOff.text()).not.toContain("Reference only: full viewer Markdown");
    if (mode === "cloud") {
      const anonymous = await handleCloudApiRequest(new Request(`${origin}/api/batches/review_contract/markdown`), env);
      expect(anonymous.status).toBe(401);
      const anonymousPage = await handleCloudApiRequest(new Request(`${origin}/api/sessions/review_capture_0/markdown`), env);
      expect(anonymousPage.status).toBe(401);
      const publicResponse = await handleCloudPublicRequest(new Request(`${origin}/b/review_contract.md`), env);
      expect(publicResponse.status).toBe(404);
      const other = { id: `ins_${"D".repeat(24)}`, token: `pit_${"d".repeat(43)}` };
      expect((await request("/api/installations", { installationId: other.id, installationToken: other.token, legalAcceptance: { accepted: true, locale: "en", termsVersion: CURRENT_LEGAL_VERSION, privacyVersion: CURRENT_LEGAL_VERSION, acceptableUseVersion: CURRENT_LEGAL_VERSION } })).status).toBe(201);
      const denied = await handleCloudApiRequest(new Request(`${origin}/api/batches/review_contract/markdown`, { headers: { authorization: `Bearer ${other.token}`, "x-pinar-installation-id": other.id } }), env);
      expect(denied.status).toBe(404);
      const deniedPage = await handleCloudApiRequest(new Request(`${origin}/api/sessions/review_capture_0/markdown`, { headers: { authorization: `Bearer ${other.token}`, "x-pinar-installation-id": other.id } }), env);
      expect(deniedPage.status).toBe(404);
    } else {
      const publicResponse = await handlePublicRequest(new Request(`${origin}/b/review_contract.md`));
      expect(publicResponse.status).toBe(200);
      expect(await publicResponse.text()).not.toContain("Reference only: full viewer Markdown");
    }
    expect((await request("/api/history/review_capture_1", undefined, "DELETE")).status).toBe(200);
    expect((await (await request("/api/history?batchId=review_contract")).json() as any).sessions).toHaveLength(2);
  } finally {
    resetLocalApiForTests();
    resetCloudMemoryStateForTests();
    if (previousHome === undefined) delete process.env.PINAR_HOME;
    else process.env.PINAR_HOME = previousHome;
  }
});
