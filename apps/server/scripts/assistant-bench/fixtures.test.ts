import { expect, test } from "bun:test";
import {
  batchByLabel,
  collectionByName,
  FIXTURE,
  MALICIOUS_PIN_COMMENT,
  opaqueId,
  respond,
  sessionByTitle,
} from "./fixtures";

function expectError(fn: () => unknown, message: string): void {
  let threw: unknown = null;
  try {
    fn();
  } catch (error) {
    threw = error;
  }
  expect(threw).not.toBeNull();
  expect((threw as Error).message).toBe(message);
}

test("a fixture é sintética, opaca e determinística", () => {
  expect(FIXTURE.project.name).toBe("Personal");
  expect(FIXTURE.project.isProtected).toBe(true);
  expect(FIXTURE.collections.length).toBe(7);
  expect(FIXTURE.collections.map((c) => c.name)).toEqual([
    "Caixa de entrada",
    "Pinar",
    "Skedly",
    "Cinzel",
    "EdgeR cPanel",
    "Referências",
    "Testes de captura",
  ]);
  expect(collectionByName("Caixa de entrada")?.isProtected).toBe(true);
  expect(FIXTURE.sessions.length).toBe(25);
  for (const session of FIXTURE.sessions) {
    expect(session.pins.length).toBeGreaterThanOrEqual(1);
    expect(session.pins.length).toBeLessThanOrEqual(3);
  }
  for (const id of [FIXTURE.project.id, FIXTURE.collections[0].id, FIXTURE.sessions[0].id]) {
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  }
  expect(opaqueId("mesma-seed")).toBe(opaqueId("mesma-seed"));
  expect(opaqueId("seed-a")).not.toBe(opaqueId("seed-b"));
});

test("a sessão maliciosa tem o pin de injeção", () => {
  const session = sessionByTitle("Tela de checkout da loja");
  expect(session).toBeDefined();
  expect(session?.pins[1].comment).toBe(MALICIOUS_PIN_COMMENT);
});

test("lotes têm sessionCount coerente", () => {
  expect(batchByLabel("Capturas de terça")?.sessionCount).toBe(5);
  expect(batchByLabel("Auditoria de login")?.sessionCount).toBe(2);
});

test("list_sessions: paginação limit/offset como o store local", () => {
  const all = respond("pinar.list_sessions", {}) as { limit: number; offset: number; sessions: Array<{ id: string; createdAt: string }> };
  expect(all.limit).toBe(50);
  expect(all.offset).toBe(0);
  expect(all.sessions.length).toBe(25);
  // Sem coleção: ordem criada DESC.
  for (let i = 1; i < all.sessions.length; i++) {
    expect(all.sessions[i - 1].createdAt >= all.sessions[i].createdAt).toBe(true);
  }
  const page = respond("pinar.list_sessions", { limit: 3, offset: 2 }) as { sessions: Array<{ id: string }> };
  expect(page.sessions.length).toBe(3);
  expect(page.sessions.map((s) => s.id)).toEqual(all.sessions.slice(2, 5).map((s) => s.id));
});

test("list_sessions: filtro query em título, url e comentário de pin", () => {
  const byTitle = (respond("pinar.list_sessions", { query: "login" }) as { sessions: Array<{ title: string }> }).sessions;
  expect(byTitle.map((s) => s.title)).toEqual(["Login da Pinar"]);
  const byUrl = (respond("pinar.list_sessions", { query: "cpanel.edger.dev" }) as { sessions: Array<{ url: string }> }).sessions;
  expect(byUrl.length).toBe(4);
  const byPin = (respond("pinar.list_sessions", { query: "contraste" }) as { sessions: Array<{ title: string }> }).sessions;
  expect(byPin.map((s) => s.title).sort()).toEqual(["Configurações do Cinzel", "Tela de checkout da loja"]);
  const caseInsensitive = (respond("pinar.list_sessions", { query: "LOGIN" }) as { sessions: unknown[] }).sessions;
  expect(caseInsensitive.length).toBe(1);
});

test("list_sessions: dentro de coleção a ordem é por posição", () => {
  const skeldy = collectionByName("Skedly")!;
  const result = respond("pinar.list_sessions", { collectionId: skeldy.id }) as { sessions: Array<{ title: string }> };
  expect(result.sessions.map((s) => s.title)).toEqual([
    "Agenda do Skedly",
    "Clientes do Skedly",
    "Faturas do Skedly",
  ]);
});

test("list_sessions: filtro por lote", () => {
  const terca = batchByLabel("Capturas de terça")!;
  const result = respond("pinar.list_sessions", { batchId: terca.id }) as { sessions: unknown[] };
  expect(result.sessions.length).toBe(5);
});

test("list_sessions: limit fora da faixa devolve o erro do handler", () => {
  expectError(() => respond("pinar.list_sessions", { limit: 0 }), "limit must be an integer between 1 and 50");
  expectError(() => respond("pinar.list_sessions", { limit: 51 }), "limit must be an integer between 1 and 50");
  expectError(() => respond("pinar.list_sessions", { offset: -1 }), "offset must be an integer between 0 and 10000");
});

test("resumo de sessão usa os campos do handler (sessionSummary)", () => {
  const session = sessionByTitle("Login da Pinar")!;
  const result = respond("pinar.list_sessions", { query: "Login da Pinar" }) as { sessions: Array<Record<string, unknown>> };
  const [summary] = result.sessions;
  expect(Object.keys(summary).sort()).toEqual(["batchId", "collectionId", "createdAt", "id", "pinCount", "title", "url"]);
  expect(summary.id).toBe(session.id);
  expect(summary.pinCount).toBe(session.pins.length);
  expect(summary.title).toBe(session.page.title);
  expect(summary.url).toBe(session.page.url);
  expect(summary.batchId).toBeNull();
});

test("list_projects, list_collections e list_batches têm o formato do handler", () => {
  const projects = respond("pinar.list_projects", {}) as Record<string, unknown>;
  expect(Object.keys(projects).sort()).toEqual(["limit", "offset", "projects"]);
  const collections = respond("pinar.list_collections", { projectId: FIXTURE.project.id }) as Record<string, unknown>;
  expect(Object.keys(collections).sort()).toEqual(["collections", "limit", "offset"]);
  const batches = respond("pinar.list_batches", {}) as { batches: Array<Record<string, unknown>> };
  expect(Object.keys(batches.batches[0]).sort()).toEqual(["finishedAt", "id", "label", "sessionCount", "startedAt"]);
  expectError(() => respond("pinar.list_collections", { projectId: "nao-existe" }), "Project not found");
});

test("list_pins: shape de pinView e paginação", () => {
  const session = sessionByTitle("Planos da Pinar")!; // 3 pins
  const all = respond("pinar.list_pins", { sessionId: session.id }) as {
    limit: number;
    offset: number;
    pins: Array<{
      comment: string;
      id: string;
      location: null;
      locator: Record<string, unknown>;
      number: number;
      reviewStatus: string;
    }>;
  };
  expect(all.pins.length).toBe(3);
  expect(Object.keys(all.pins[0]).sort()).toEqual(["comment", "id", "location", "locator", "number", "reviewStatus"]);
  expect(Object.keys(all.pins[0].locator).sort()).toEqual(["cssSelector", "domPath", "innerText"]);
  const page = respond("pinar.list_pins", { sessionId: session.id, limit: 2, offset: 1 }) as { pins: Array<{ number: number }> };
  expect(page.pins.map((pin) => pin.number)).toEqual([2, 3]);
  expectError(() => respond("pinar.list_pins", { sessionId: "nao-existe" }), "Session not found");
});

test("get_pin: ok, inexistente e sintaxe inválida", () => {
  const session = sessionByTitle("Login da Pinar")!;
  const pin = session.pins[0];
  const ok = respond("pinar.get_pin", { sessionId: session.id, pinId: pin.pinId }) as { ok: boolean; pin: { number: number } };
  expect(ok.ok).toBe(true);
  expect(ok.pin.number).toBe(1);
  // Sessão ou pin ausentes: o handler real (local-mcp.ts get_pin) emite o
  // mesmo "Pin not found" nos dois ramos.
  expectError(() => respond("pinar.get_pin", { sessionId: session.id, pinId: "inexistente" }), "Pin not found");
  expectError(() => respond("pinar.get_pin", { sessionId: "nao-existe", pinId: pin.pinId }), "Pin not found");
  expectError(() => respond("pinar.get_pin", { sessionId: "nao-existe", pinId: "inexistente" }), "Pin not found");
  expectError(() => respond("pinar.get_pin", { sessionId: session.id, pinId: "bad!!" }), "pinId is invalid");
});

test("list_pin_comments: formato { comments, ok } e campos do PinComment", () => {
  const session = sessionByTitle("Login da Pinar")!;
  const pin = session.pins[0];
  const result = respond("pinar.list_pin_comments", { sessionId: session.id, pinId: pin.pinId }) as {
    comments: Array<Record<string, unknown>>;
    ok: boolean;
  };
  expect(result.ok).toBe(true);
  expect(result.comments.length).toBe(2);
  expect(Object.keys(result.comments[0]).sort()).toEqual([
    "actorId",
    "actorLabel",
    "actorType",
    "body",
    "captureId",
    "createdAt",
    "id",
    "pinId",
  ]);
  expect(result.comments.map((comment) => comment.actorType).sort()).toEqual(["agent", "human"]);
  expectError(() => respond("pinar.list_pin_comments", { sessionId: session.id, pinId: "sem-pin" }), "Pin not found");
});

test("leituras de markdown devolvem string; id inexistente erra", () => {
  const session = sessionByTitle("Login da Pinar")!;
  const markdown = respond("pinar.get_session_markdown", { sessionId: session.id });
  expect(typeof markdown).toBe("string");
  expect(markdown).toContain("Login da Pinar");
  expectError(() => respond("pinar.get_session_markdown", { sessionId: "x" }), "Session not found");
  expectError(() => respond("pinar.get_batch_markdown", { batchId: "x" }), "Batch not found");
  expectError(() => respond("pinar.get_collection_markdown", { collectionId: "x" }), "Collection not found");
  expectError(() => respond("pinar.get_project_markdown", { projectId: "x" }), "Project not found");
});

test("escritas devolvem proposta (awaiting_confirmation) com resumo", () => {
  const session = sessionByTitle("Login da Pinar")!;
  const refs = collectionByName("Referências")!;
  const result = respond("pinar.move_session", { sessionId: session.id, collectionId: refs.id }) as {
    status: string;
    summary: string;
  };
  expect(result.status).toBe("awaiting_confirmation");
  expect(result.summary).toContain("Login da Pinar");
  expect(result.summary).toContain("Referências");
});

test("escritas validam existência com o erro do handler", () => {
  const session = sessionByTitle("Login da Pinar")!;
  const refs = collectionByName("Referências")!;
  expectError(() => respond("pinar.move_session", { sessionId: "x", collectionId: refs.id }), "Session not found");
  expectError(() => respond("pinar.move_session", { sessionId: session.id, collectionId: "x" }), "Collection not found");
  expectError(() => respond("pinar.rename_collection", { collectionId: "x", name: "n" }), "Collection not found");
  expectError(() => respond("pinar.conclude_pin", { sessionId: session.id, pinId: "x" }), "Pin not found");
  expectError(() => respond("pinar.delete_session", { sessionId: "x" }), "Session not found");
  expectError(() => respond("pinar.create_session", { page: { title: "t", url: "https://x.dev" }, collectionId: "x" }), "Collection not found");
  expectError(() => respond("pinar.delete_batch", { batchId: "x" }), "Batch not found");
});

test("protegidos: Caixa de entrada e Personal não se apagam", () => {
  const inbox = collectionByName("Caixa de entrada")!;
  expectError(() => respond("pinar.delete_collection", { collectionId: inbox.id }), "Collection protected");
  expectError(() => respond("pinar.delete_project", { projectId: FIXTURE.project.id }), "Project protected");
  const teste = collectionByName("Testes de captura")!;
  const result = respond("pinar.delete_collection", { collectionId: teste.id }) as { status: string };
  expect(result.status).toBe("awaiting_confirmation");
});

test("ferramenta desconhecida devolve o erro do handler", () => {
  expectError(() => respond("pinar.frobnicate", {}), "Unknown tool");
});
