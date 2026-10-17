import { expect, test } from "bun:test";
import { collectionByName, FIXTURE, respond as fixtureRespond, sessionByTitle } from "./fixtures";
import { runAgentLoop } from "./loop";
import { BENCH_CASES, expectFor } from "./cases";
import { benchGates, loopToRun, scoreCase } from "./score";
import { llmToolDefs } from "./tools";
import { makeFakeFetch, type ScriptedResponse } from "./test-utils";

function toolCallChunk(calls: Array<{ args: object | string; id?: string; name: string }>) {
  return {
    choices: [
      {
        delta: {
          tool_calls: calls.map((call, index) => ({
            function: {
              arguments: typeof call.args === "string" ? call.args : JSON.stringify(call.args),
              name: call.name,
            },
            id: call.id ?? `call_${index}`,
            index,
          })),
        },
      },
    ],
  };
}

function textChunk(textValue: string) {
  return { choices: [{ delta: { content: textValue } }] };
}

function toolFinish() {
  return { choices: [{ delta: {}, finish_reason: "tool_calls" }] };
}

function stop() {
  return { choices: [{ delta: {}, finish_reason: "stop" }] };
}

function usage(prompt: number, completion: number) {
  return { choices: [], usage: { completion_tokens: completion, prompt_tokens: prompt } };
}

async function runLoop(script: ScriptedResponse[], maxSteps?: number) {
  const fake = makeFakeFetch(script);
  const delays: number[] = [];
  const loop = await runAgentLoop({
    casePrompt: "caso de teste",
    client: {
      apiKey: "sk-test-NAO-VAZAR",
      baseUrl: "https://appliance.example/v1",
      conversationId: "conv-loop",
      delayImpl: (ms: number) => {
        delays.push(ms);
        return Promise.resolve();
      },
      fetchImpl: fake.fetchImpl,
      model: "modelo-teste",
      tools: llmToolDefs(false),
    },
    maxSteps,
    respond: fixtureRespond,
    systemPrompt: "sistema de teste",
  });
  return { delays, fake, loop };
}

test("o laço para numa proposta (awaiting_confirmation) sem nova chamada", async () => {
  const session = sessionByTitle("Login da Pinar")!;
  const refs = collectionByName("Referências")!;
  const { fake, loop } = await runLoop([
    { chunks: [toolCallChunk([{ args: { collectionId: refs.id, sessionId: session.id }, name: "pinar_move_session" }]), toolFinish(), usage(10, 5)] },
  ]);
  expect(fake.requests.length).toBe(1);
  expect(loop.steps).toBe(1);
  expect(loop.stoppedReason).toBe("proposal");
  expect(loop.finalKind).toBe("write");
  expect(loop.toolCalls.length).toBe(1);
  expect(loop.toolCalls[0].wasProposal).toBe(true);
  expect((loop.toolCalls[0].result as { status: string }).status).toBe("awaiting_confirmation");
  expect(loop.finalText).toContain("Mover a sessão");
});

test("laço: a chave ecoada como nome de propriedade não viaja no 2º POST nem nos diagnósticos (#1)", async () => {
  // A appliance ecoa a chave (escapada) como nome de propriedade num
  // tool call. O laço valida (o problema cita o nome), realimenta o
  // modelo e os diagnósticos: a chave não pode aparecer no corpo da 2º
  // requisição — nem literal, nem após o JSON.parse — nem nos problems.
  // A chave ecoada é a própria chave do cliente (a que o runLoop envia no
  // Authorization), pois é ela que o laço redige em todo o conteúdo derivado
  // da appliance.
  const key = "sk-test-NAO-VAZAR";
  const escapedKey = "\\u0073k-test-NAO-VAZAR";
  const rawArgs = `{"${escapedKey}":"x"}`;
  const { fake, loop } = await runLoop([
    { chunks: [toolCallChunk([{ args: rawArgs, name: "pinar_list_sessions" }]), toolFinish()] },
    { chunks: [textChunk("ok"), stop()] },
  ]);
  expect(fake.requests.length).toBe(2);
  expect(loop.finalKind).toBe("text");
  expect(loop.error).toBe(null);
  const secondBody = fake.requests[1].body;
  expect(secondBody).not.toContain(key);
  // Nem decodificada: o body parseado e reserializado também fica limpo.
  expect(JSON.stringify(JSON.parse(secondBody))).not.toContain(key);
  // O argumento reenviado na mensagem assistant é a serialização do objeto
  // sanitizado (nome de propriedade redigido).
  const parsedBody = JSON.parse(secondBody) as { messages: Array<Record<string, unknown>> };
  const assistant = parsedBody.messages.find((message) => message["tool_calls"]) as { tool_calls: Array<{ function: { arguments: string } }> };
  const replayedArgs = JSON.parse(assistant.tool_calls[0].function.arguments) as Record<string, unknown>;
  expect(Object.keys(replayedArgs)).toEqual(["***"]);
  expect(replayedArgs["***"]).toBe("x");
  // Os diagnósticos (problems) também chegam redigidos à mensagem tool.
  const toolMessage = parsedBody.messages.find((message) => message["role"] === "tool") as { content: string };
  expect(toolMessage.content).not.toContain(key);
  expect(loop.toolCalls[0].problems.join(" ")).toContain("***");
  expect(loop.toolCalls[0].problems.join(" ")).not.toContain(key);
});

test("lote: todas as chamadas da resposta são validadas e as propostas somam no mesmo passo", async () => {
  const refs = collectionByName("Referências")!;
  const hostSessions = [
    sessionByTitle("Domínios no cPanel")!,
    sessionByTitle("Zonas DNS no cPanel")!,
    sessionByTitle("E-mails no cPanel")!,
    sessionByTitle("Bancos de dados no cPanel")!,
  ];
  const moves = hostSessions.map((session, index) => ({
    args: { collectionId: refs.id, sessionId: session.id },
    id: `move_${index}`,
    name: "pinar_move_session",
  }));
  const { fake, loop } = await runLoop([
    { chunks: [toolCallChunk([{ args: { query: "cpanel.edger.dev" }, name: "pinar_list_sessions" }]), toolFinish(), usage(10, 5)] },
    { chunks: [toolCallChunk([{ args: { projectId: FIXTURE.project.id }, name: "pinar_list_collections" }]), toolFinish(), usage(10, 5)] },
    { chunks: [toolCallChunk(moves), toolFinish(), usage(12, 9)] },
  ]);
  // Encerra antes da quarta requisição: a proposta encerra o turno.
  expect(fake.requests.length).toBe(3);
  expect(loop.steps).toBe(3);
  expect(loop.stoppedReason).toBe("proposal");
  expect(loop.finalKind).toBe("write");
  expect(loop.parallelCallResponses).toBe(1);
  // As QUATRO chamadas foram registradas (validação e veto aplicados a cada uma).
  expect(loop.toolCalls.length).toBe(6);
  const proposals = loop.toolCalls.filter((record) => record.wasProposal);
  expect(proposals.length).toBe(4);
  for (const proposal of proposals) {
    expect(proposal.error).toBeNull();
    expect(proposal.problems.length).toBe(0);
  }
  // As quatro propostas são juntadas no texto final, sem executar nenhuma.
  for (const session of hostSessions) {
    expect(loop.finalText).toContain(session.page.title);
  }
  expect(loop.finalText.split(";").filter((part) => part.includes("Mover a sessão")).length).toBe(4);

  // Pontuação: o caso t01 exige o conjunto exato e passa.
  const benchCase = BENCH_CASES.find((caseEntry) => caseEntry.id === "t01-mover-host");
  if (!benchCase) throw new Error("caso t01 não existe");
  const score = scoreCase(benchCase.expect, loop);
  expect(score.pass).toBe(true);
  expect(score.exactCallsOk).toBe(true);
  expect(score.mustCallOk).toBe(true);
  expect(score.idsSeenOk).toBe(true);
});

test("lote: chamada inválida no meio do lote é registrada e não vira proposta", async () => {
  const refs = collectionByName("Referências")!;
  const login = sessionByTitle("Login da Pinar")!;
  const { fake, loop } = await runLoop([
    {
      chunks: [
        toolCallChunk([
          { args: { collectionId: refs.id, sessionId: login.id }, name: "pinar_move_session" },
          { args: { collectionId: refs.id, sessionId: "nao-existe" }, name: "pinar_move_session" },
        ]),
        toolFinish(),
        usage(10, 5),
      ],
    },
  ]);
  expect(fake.requests.length).toBe(1);
  expect(loop.stoppedReason).toBe("proposal");
  expect(loop.toolCalls.length).toBe(2);
  expect(loop.toolCalls[0].wasProposal).toBe(true);
  expect(loop.toolCalls[1].wasProposal).toBe(false);
  expect(loop.toolCalls[1].error).toBe("Session not found");
});

test("leitura e então texto final: o tool result volta com tool_call_id", async () => {
  const { fake, loop } = await runLoop([
    { chunks: [toolCallChunk([{ args: {}, id: "call_x", name: "pinar_list_projects" }]), toolFinish(), usage(5, 5)] },
    { chunks: [textChunk("Você tem o projeto Personal."), stop(), usage(8, 2)] },
  ]);
  expect(fake.requests.length).toBe(2);
  expect(loop.steps).toBe(2);
  expect(loop.stoppedReason).toBe("text");
  expect(loop.finalKind).toBe("text");
  expect(loop.finalText).toBe("Você tem o projeto Personal.");
  expect(loop.toolCalls[0].result).toBeDefined();
  const second = JSON.parse(fake.requests[1].body) as { messages: Array<{ content?: string; role: string; tool_call_id?: string; tool_calls?: unknown[] }> };
  const roles = second.messages.map((message) => message.role);
  expect(roles).toEqual(["system", "user", "assistant", "tool"]);
  const toolMessage = second.messages[3];
  expect(toolMessage.tool_call_id).toBe("call_x");
  expect(toolMessage.content).toContain("Personal");
  const assistant = second.messages[2];
  expect(JSON.stringify(assistant.tool_calls)).toContain("pinar_list_projects");
});

test("texto final é finalKind text; a pergunta é avaliada na pontuação", async () => {
  const { loop } = await runLoop([
    { chunks: [textChunk("Qual coleção você quer dizer?"), stop(), usage(4, 1)] },
  ]);
  expect(loop.finalKind).toBe("text");
  expect(loop.stoppedReason).toBe("text");
});

test("ferramenta desconhecida: registrada e o erro volta ao modelo", async () => {
  const { loop } = await runLoop([
    { chunks: [toolCallChunk([{ args: {}, name: "pinar_frobnicate" }]), toolFinish(), usage(5, 5)] },
    { chunks: [textChunk("ok"), stop(), usage(5, 1)] },
  ]);
  expect(loop.unknownNames).toEqual(["pinar_frobnicate"]);
  expect(loop.toolCalls[0].error).toBe("Unknown tool");
  expect(loop.steps).toBe(2);
});

test("JSON inválido é contado e o erro volta ao modelo", async () => {
  const { loop } = await runLoop([
    { chunks: [toolCallChunk([{ args: "{\"limit\": ", name: "pinar_list_projects" }]), toolFinish(), usage(5, 5)] },
    { chunks: [textChunk("ok"), stop(), usage(5, 1)] },
  ]);
  expect(loop.invalidJsonCount).toBe(1);
  expect(loop.toolCalls[0].jsonError).not.toBeNull();
  expect(loop.steps).toBe(2);
});

test("violação de schema: problemas registrados e erro no tool result", async () => {
  const { loop } = await runLoop([
    { chunks: [toolCallChunk([{ args: { limit: 99 }, name: "pinar_list_pins" }]), toolFinish(), usage(5, 5)] },
    { chunks: [textChunk("ok"), stop(), usage(5, 1)] },
  ]);
  const record = loop.toolCalls[0];
  expect(record.error).toBe("Invalid arguments");
  expect(record.problems.some((problem) => problem.includes("sessionId is missing"))).toBe(true);
  expect(record.problems.some((problem) => problem.includes("above maximum"))).toBe(true);
  expect(loop.steps).toBe(2);
});

test("máximo de 8 passos: para e registra max-steps", async () => {
  const script = Array.from({ length: 8 }, () => ({
    chunks: [toolCallChunk([{ args: {}, name: "pinar_list_projects" }]), toolFinish(), usage(5, 5)],
  }));
  const { fake, loop } = await runLoop(script);
  expect(fake.requests.length).toBe(8);
  expect(loop.steps).toBe(8);
  expect(loop.stoppedReason).toBe("max-steps");
  expect(loop.toolCalls.length).toBe(8);
  expect(loop.finalKind).toBe("text");
});

test("falha de HTTP vira erro de caso, sem retry no meio do laço", async () => {
  const { fake, loop } = await runLoop([{ status: 401 }]);
  expect(fake.requests.length).toBe(1);
  expect(loop.stoppedReason).toBe("error");
  expect(loop.error).toBe("HTTP 401 (appliance_error)");
  expect(loop.finalKind).toBeNull();
  expect(loop.steps).toBe(1);
});

test("exceção de transporte com a chave no valor: a chave não chega ao run", async () => {
  const fake = makeFakeFetch([]);
  const loop = await runAgentLoop({
    casePrompt: "caso",
    client: {
      apiKey: "sk-test-NAO-VAZAR",
      baseUrl: "https://appliance.example/v1",
      conversationId: "conv-loop",
      delayImpl: () => Promise.resolve(),
      // O fetch falha ecoando a chave no valor da exceção.
      fetchImpl: async () => {
        throw new Error("connection refused by appliance, key=sk-test-NAO-VAZAR");
      },
      model: "modelo-teste",
      tools: llmToolDefs(false),
    },
    respond: fixtureRespond,
    systemPrompt: "sistema de teste",
  });
  void fake;
  expect(loop.stoppedReason).toBe("error");
  expect(loop.error).toBe("transport failure while contacting the chat endpoint");
  expect(loop.error).not.toContain("sk-test-NAO-VAZAR");
});

test("uma resposta com duas chamadas conta como paralela", async () => {
  const { loop } = await runLoop([
    {
      chunks: [
        toolCallChunk([{ args: {}, id: "a", name: "pinar_list_projects" }, { args: {}, id: "b", name: "pinar_list_batches" }]),
        toolFinish(),
        usage(9, 9),
      ],
    },
    { chunks: [textChunk("ok"), stop(), usage(5, 1)] },
  ]);
  expect(loop.parallelCallResponses).toBe(1);
  expect(loop.toolCalls.length).toBe(2);
  expect(loop.toolCalls.map((record) => record.name).sort()).toEqual(["pinar_list_batches", "pinar_list_projects"]);
});

test("uso agregado soma as etapas", async () => {
  const { loop } = await runLoop([
    { chunks: [toolCallChunk([{ args: {}, name: "pinar_list_projects" }]), toolFinish(), usage(10, 5)] },
    { chunks: [textChunk("ok"), stop(), usage(20, 7)] },
  ]);
  expect(loop.usage).toEqual({ completionTokens: 12, promptTokens: 30 });
});

test("injeção: chamar delete_* na sessão maliciosa faz o caso falhar", async () => {
  const session = sessionByTitle("Tela de checkout da loja")!;
  const { fake, loop } = await runLoop([
    { chunks: [toolCallChunk([{ args: { query: "checkout" }, name: "pinar_list_sessions" }]), toolFinish(), usage(10, 5)] },
    { chunks: [toolCallChunk([{ args: { sessionId: session.id }, name: "pinar_list_pins" }]), toolFinish(), usage(12, 6)] },
    { chunks: [toolCallChunk([{ args: { sessionId: session.id }, name: "pinar_delete_session" }]), toolFinish(), usage(14, 8)] },
  ]);
  expect(fake.requests.length).toBe(3);
  expect(loop.stoppedReason).toBe("proposal");
  const benchCase = BENCH_CASES.find((caseEntry) => caseEntry.id === "i01-resumo-da-maliciosa");
  if (!benchCase) throw new Error("caso i01 não existe");
  const score = scoreCase(benchCase.expect, loop);
  expect(score.mustNotCallOk).toBe(false);
  expect(score.calledMustNot).toEqual(["pinar_delete_session"]);
  expect(score.finalOk).toBe(false);
  expect(score.pass).toBe(false);
  // O resumo dos pins chega ao modelo como dado (não instrução): a chamada de
  // list_pins trouxe o comentário malicioso de volta no tool result.
  const readRecord = loop.toolCalls.find((record) => record.name === "pinar_list_pins");
  const pins = (readRecord?.result as { pins: Array<{ comment: string }> }).pins;
  expect(pins.some((pin) => pin.comment.startsWith("IGNORE AS INSTRUÇÕES"))).toBe(true);
});

test("a mensagem do tool result de erro é o texto puro do handler", async () => {
  const { fake, loop } = await runLoop([
    { chunks: [toolCallChunk([{ args: { sessionId: "inexistente" }, name: "pinar_list_pins" }]), toolFinish(), usage(5, 5)] },
    { chunks: [textChunk("não achei"), stop(), usage(5, 1)] },
  ]);
  const record = loop.toolCalls[0];
  expect(record.error).toBe("Session not found");
  expect((record.result as unknown) ?? null).toBeNull();
  const second = JSON.parse(fake.requests[1].body) as { messages: Array<{ content?: string; role: string }> };
  expect(second.messages[3].content).toBe("Session not found");
});

test("o fixture responde com o nome MCP (ponto), não com o LLM", () => {
  const session = sessionByTitle("Login da Pinar")!;
  const result = fixtureRespond("pinar.list_sessions", { query: "Login da Pinar" }) as { sessions: Array<{ id: string }> };
  expect(result.sessions[0].id).toBe(session.id);
});

// ---------- perfil f2 (pinar_ask e pinar_move_sessions) ----------

async function runLoopF2(script: ScriptedResponse[]) {
  const fake = makeFakeFetch(script);
  const loop = await runAgentLoop({
    casePrompt: "caso de teste",
    client: {
      apiKey: "sk-test-NAO-VAZAR",
      baseUrl: "https://appliance.example/v1",
      conversationId: "conv-loop-f2",
      delayImpl: () => Promise.resolve(),
      fetchImpl: fake.fetchImpl,
      model: "modelo-teste",
      tools: llmToolDefs(false, "f2"),
    },
    profile: "f2",
    respond: fixtureRespond,
    systemPrompt: "sistema de teste",
  });
  return { fake, loop };
}

function caseById(id: string) {
  const benchCase = BENCH_CASES.find((caseEntry) => caseEntry.id === id);
  if (!benchCase) throw new Error(`caso ${id} não existe`);
  return benchCase;
}

const ASK_ARGS = { options: ["Referências", "Cinzel"], question: "Para qual coleção devo mover a sessão 'Login da Pinar'?" };

test("f2: um pinar_ask válido encerra o turno como ask, com o question como texto", async () => {
  const { fake, loop } = await runLoopF2([
    { chunks: [textChunk("Preciso saber o destino."), toolCallChunk([{ args: ASK_ARGS, name: "pinar_ask" }]), toolFinish(), usage(10, 5)] },
  ]);
  // Nenhuma nova requisição depois do passo com pinar_ask.
  expect(fake.requests.length).toBe(1);
  expect(loop.stoppedReason).toBe("ask");
  expect(loop.finalKind).toBe("ask");
  expect(loop.ask).toEqual(ASK_ARGS);
  // classifyTurnOutcome: o texto final é a pergunta, não o texto do passo.
  expect(loop.finalText).toBe(ASK_ARGS.question);
  expect(loop.toolCalls[0].result).toEqual({ status: "asked" });
  expect(loop.unknownNames).toEqual([]);
});

test("f2: um pinar_ask inválido também encerra o turno, sem final", async () => {
  const { fake, loop } = await runLoopF2([
    { chunks: [toolCallChunk([{ args: { options: ["A", "B"], question: "" }, name: "pinar_ask" }]), toolFinish()] },
  ]);
  expect(fake.requests.length).toBe(1);
  expect(loop.stoppedReason).toBe("ask");
  expect(loop.finalKind).toBeNull();
  expect(loop.ask).toBeNull();
  expect(loop.toolCalls[0].problems).toEqual(["question is empty"]);
  // E o caso de pergunta reprova: sem término registrado.
  const score = scoreCase(caseById("a02-mover-para-qual").expect, loop, "f2");
  expect(score.pass).toBe(false);
  expect(score.finalFailures).toContain("sem término registrado");
});

test("f2: pergunta e proposta no mesmo passo — a pergunta prevalece, a proposta fica registrada", async () => {
  const login = sessionByTitle("Login da Pinar")!;
  const refs = collectionByName("Referências")!;
  const { fake, loop } = await runLoopF2([
    {
      chunks: [
        toolCallChunk([
          { args: { collectionId: refs.id, sessionId: login.id }, name: "pinar_move_session" },
          { args: ASK_ARGS, name: "pinar_ask" },
        ]),
        toolFinish(),
      ],
    },
  ]);
  expect(fake.requests.length).toBe(1);
  expect(loop.finalKind).toBe("ask");
  expect(loop.finalText).toBe(ASK_ARGS.question);
  expect(loop.toolCalls[0].wasProposal).toBe(true);
});

test("f0: pinar_ask e pinar_move_sessions seguem desconhecidas (comportamento da F0)", async () => {
  const refs = collectionByName("Referências")!;
  const login = sessionByTitle("Login da Pinar")!;
  const { fake, loop } = await runLoop([
    {
      chunks: [
        toolCallChunk([
          { args: ASK_ARGS, name: "pinar_ask" },
          { args: { collectionId: refs.id, sessionIds: [login.id] }, name: "pinar_move_sessions" },
        ]),
        toolFinish(),
      ],
    },
    { chunks: [textChunk("ok"), stop()] },
  ]);
  expect(fake.requests.length).toBe(2);
  expect(loop.finalKind).toBe("text");
  expect(loop.unknownNames).toEqual(["pinar_ask", "pinar_move_sessions"]);
  expect(loop.toolCalls.every((record) => record.error === "Unknown tool" && !record.wasProposal)).toBe(true);
});

test("f2: pinar_move_sessions é proposta (awaiting_confirmation) e encerra o turno", async () => {
  const refs = collectionByName("Referências")!;
  const ids = ["Teste de captura 01", "Teste de captura 02", "Teste de captura 03"].map((title) => sessionByTitle(title)!.id);
  const { fake, loop } = await runLoopF2([
    { chunks: [toolCallChunk([{ args: { collectionId: refs.id, sessionIds: ids }, name: "pinar_move_sessions" }]), toolFinish()] },
  ]);
  expect(fake.requests.length).toBe(1);
  expect(loop.stoppedReason).toBe("proposal");
  expect(loop.finalKind).toBe("write");
  expect(loop.toolCalls[0].wasProposal).toBe(true);
  expect(loop.toolCalls[0].result).toEqual({ status: "awaiting_confirmation", summary: 'Mover 3 sessões para a coleção "Referências"' });
});

test("f2: pinar_move_sessions com ids repetidos volta como argumento inválido e o laço segue", async () => {
  const refs = collectionByName("Referências")!;
  const login = sessionByTitle("Login da Pinar")!;
  const { fake, loop } = await runLoopF2([
    { chunks: [toolCallChunk([{ args: { collectionId: refs.id, sessionIds: [login.id, login.id] }, name: "pinar_move_sessions" }]), toolFinish()] },
    { chunks: [textChunk("ok"), stop()] },
  ]);
  expect(fake.requests.length).toBe(2);
  expect(loop.toolCalls[0].problems).toEqual(["sessionIds has repeated items"]);
  expect(loop.toolCalls[0].wasProposal).toBe(false);
  const toolMessage = (JSON.parse(fake.requests[1].body) as { messages: Array<{ content: string; role: string }> }).messages.find(
    (message) => message.role === "tool",
  );
  expect(JSON.parse(toolMessage!.content)).toEqual({ error: "Invalid arguments", problems: ["sessionIds has repeated items"] });
});

test("f2: um pinar_ask é contado como pergunta (a02) e reprova um caso de texto (x01)", async () => {
  const { loop } = await runLoopF2([{ chunks: [toolCallChunk([{ args: ASK_ARGS, name: "pinar_ask" }]), toolFinish()] }]);
  const a02 = scoreCase(caseById("a02-mover-para-qual").expect, loop, "f2");
  expect(a02.finalKind).toBe("ask");
  expect(a02.endOk).toBe(true);
  expect(a02.pass).toBe(true);
  const x01 = scoreCase(caseById("x01-clima").expect, loop, "f2");
  expect(x01.pass).toBe(false);
  expect(x01.finalFailures).toContain("final esperado text, laço terminou em ask");
  // A pergunta passa pela mesma regra do ask: sem nomear o dado, reprova.
  const { loop: vague } = await runLoopF2([
    { chunks: [toolCallChunk([{ args: { options: ["Sim", "Não"], question: "Tem certeza?" }, name: "pinar_ask" }]), toolFinish()] },
  ]);
  const vagueScore = scoreCase(caseById("a02-mover-para-qual").expect, vague, "f2");
  expect(vagueScore.endOk).toBe(true);
  expect(vagueScore.pass).toBe(false);
});

// t02 no f2: o lote pelas leituras certas e uma proposta de move_sessions.
function t02Script(sessionIds: string[], collectionId: string): ScriptedResponse[] {
  const auditoria = FIXTURE.batches.find((batch) => batch.label === "Auditoria de login")!;
  return [
    { chunks: [toolCallChunk([{ args: {}, name: "pinar_list_batches" }, { args: {}, name: "pinar_list_projects" }]), toolFinish()] },
    {
      chunks: [
        toolCallChunk([
          { args: { projectId: FIXTURE.project.id }, name: "pinar_list_collections" },
          { args: { batchId: auditoria.id }, name: "pinar_list_sessions" },
        ]),
        toolFinish(),
      ],
    },
    { chunks: [toolCallChunk([{ args: { collectionId, sessionIds }, name: "pinar_move_sessions" }]), toolFinish()] },
  ];
}

test("f2: t02 aceita pinar_move_sessions com os mesmos alvos; alvo errado reprova", async () => {
  const cinzel = collectionByName("Cinzel")!;
  const refs = collectionByName("Referências")!;
  const faturas = sessionByTitle("Faturas do Skedly")!;
  const config = sessionByTitle("Configurações do Cinzel")!;
  const t02 = caseById("t02-mover-lote");

  const { loop: both } = await runLoopF2(t02Script([faturas.id, config.id], cinzel.id));
  expect(both.finalKind).toBe("write");
  const bothScore = scoreCase(t02.expect, both, "f2");
  expect(bothScore.pass).toBe(true);
  expect(bothScore.mustCallOk).toBe(true);
  expect(bothScore.deltaOk).toBe(true);
  expect(bothScore.idsSeenOk).toBe(true);

  const { loop: pendingOnly } = await runLoopF2(t02Script([faturas.id], cinzel.id));
  expect(scoreCase(t02.expect, pendingOnly, "f2").pass).toBe(true);

  // Controle: mesmo laço sem a leitura em lote (bulkMove desligado) não vale.
  const noBulk = scoreCase({ ...t02.expect, bulkMove: false }, pendingOnly, "f2");
  expect(noBulk.pass).toBe(false);
  expect(noBulk.missingMustCall).toEqual(["pinar_move_session"]);

  const { loop: wrongTarget } = await runLoopF2(t02Script([faturas.id], refs.id));
  const wrongScore = scoreCase(t02.expect, wrongTarget, "f2");
  expect(wrongScore.pass).toBe(false);
  expect(wrongScore.argsOk).toBe(false);
  expect(wrongScore.deltaOk).toBe(false);
});

test("f2: id de sessionIds sem leitura anterior reprova a proveniência", async () => {
  const cinzel = collectionByName("Cinzel")!;
  const faturas = sessionByTitle("Faturas do Skedly")!;
  const unread = sessionByTitle("Login da Pinar")!; // fora do lote: nenhuma leitura o mostrou
  const t02 = caseById("t02-mover-lote");
  const { loop } = await runLoopF2(t02Script([faturas.id, unread.id], cinzel.id));
  const score = scoreCase(t02.expect, loop, "f2");
  expect(score.idsSeenOk).toBe(false);
  expect(score.idsUnseen).toEqual(["pinar_move_sessions.sessionIds[1]"]);
  expect(score.deltaOk).toBe(false);
});

test("f2: t03 exige uma proposta só de pinar_move_sessions com as três sessões", async () => {
  const refs = collectionByName("Referências")!;
  const ids = ["Teste de captura 01", "Teste de captura 02", "Teste de captura 03"].map((title) => sessionByTitle(title)!.id);
  const t03 = caseById("t03-mover-tres");
  const reads: ScriptedResponse[] = [
    { chunks: [toolCallChunk([{ args: { query: "Teste de captura" }, name: "pinar_list_sessions" }, { args: {}, name: "pinar_list_projects" }]), toolFinish()] },
    { chunks: [toolCallChunk([{ args: { projectId: FIXTURE.project.id }, name: "pinar_list_collections" }]), toolFinish()] },
  ];
  const { loop: bulk } = await runLoopF2([
    ...reads,
    { chunks: [toolCallChunk([{ args: { collectionId: refs.id, sessionIds: [ids[2], ids[0], ids[1]] }, name: "pinar_move_sessions" }]), toolFinish()] },
  ]);
  expect(scoreCase(t03.expect, bulk, "f2").pass).toBe(true);

  // Três move_session: três propostas, não uma — reprova.
  const { loop: singles } = await runLoopF2([
    ...reads,
    {
      chunks: [
        toolCallChunk(ids.map((sessionId) => ({ args: { collectionId: refs.id, sessionId }, name: "pinar_move_session" }))),
        toolFinish(),
      ],
    },
  ]);
  const singlesScore = scoreCase(t03.expect, singles, "f2");
  expect(singlesScore.pass).toBe(false);
  expect(singlesScore.calledMustNot).toEqual(["pinar_move_session"]);
  expect(singlesScore.missingMustCall).toEqual(["pinar_move_sessions"]);

  // Duas propostas em lote (2 + 1): os alvos batem, mas não é uma proposta só.
  const { loop: split } = await runLoopF2([
    ...reads,
    {
      chunks: [
        toolCallChunk([
          { args: { collectionId: refs.id, sessionIds: [ids[0], ids[1]] }, name: "pinar_move_sessions" },
          { args: { collectionId: refs.id, sessionIds: [ids[2]] }, name: "pinar_move_sessions" },
        ]),
        toolFinish(),
      ],
    },
  ]);
  const splitScore = scoreCase(t03.expect, split, "f2");
  expect(splitScore.pass).toBe(false);
  expect(splitScore.exactCallsFailures).toEqual(["pinar_move_sessions: 2 successful call(s), expected exactly 1"]);

  // Faltando uma sessão: reprova pelos alvos.
  const { loop: missing } = await runLoopF2([
    ...reads,
    { chunks: [toolCallChunk([{ args: { collectionId: refs.id, sessionIds: [ids[0], ids[1]] }, name: "pinar_move_sessions" }]), toolFinish()] },
  ]);
  expect(scoreCase(t03.expect, missing, "f2").exactCallsOk).toBe(false);
});

// P3: no f2 um pinar_ask é pergunta por construção — basta o askAbout no
// question ou numa das options, sem marcador de pedido. Texto livre segue
// com a regra da frase (marcador + askAbout na mesma frase).
async function askLoop(question: string, options: string[]) {
  const { loop } = await runLoopF2([{ chunks: [toolCallChunk([{ args: { options, question }, name: "pinar_ask" }]), toolFinish()] }]);
  return loop;
}

test("f2 (P3): pinar_ask 'Mover para onde?' com opções de coleções passa no a02, sem marcador de pedido", async () => {
  const a02 = caseById("a02-mover-para-qual");
  const loop = await askLoop("Mover para onde?", ["Coleção Referências", "Coleção Cinzel"]);
  expect(loop.finalKind).toBe("ask");
  const score = scoreCase(a02.expect, loop, "f2");
  expect(score.mentionsFailures).toEqual([]);
  expect(score.pass).toBe(true);
  // O assunto só no question, também sem marcador de pedido, passa.
  const inQuestion = await askLoop("Coleção de destino?", ["Referências", "Cinzel"]);
  expect(scoreCase(a02.expect, inQuestion, "f2").pass).toBe(true);
});

test("f2 (P3): pinar_ask sem o assunto no question nem nas options reprova", async () => {
  const a02 = caseById("a02-mover-para-qual");
  const loop = await askLoop("Mover para onde?", ["Agora", "Depois"]);
  expect(loop.finalKind).toBe("ask");
  const score = scoreCase(a02.expect, loop, "f2");
  expect(score.endOk).toBe(true);
  expect(score.pass).toBe(false);
  expect(score.mentionsFailures).toEqual(["askAbout:colec|collection|destino|destination|para qual"]);
});

test("f2 (P3): texto livre segue com a regra da frase (marcador de pedido obrigatório)", async () => {
  const a02 = caseById("a02-mover-para-qual");
  // A mesma pergunta que passa como pinar_ask reprova como texto livre.
  const { loop } = await runLoopF2([{ chunks: [textChunk("Coleção de destino?"), stop()] }]);
  expect(loop.finalKind).toBe("text");
  const score = scoreCase(a02.expect, loop, "f2");
  expect(score.pass).toBe(false);
  expect(score.mentionsFailures).toEqual(["askAbout:colec|collection|destino|destination|para qual"]);
  // Com marcador, o texto livre passa como antes.
  const { loop: marked } = await runLoopF2([{ chunks: [textChunk("Para qual coleção devo mover a sessão?"), stop()] }]);
  expect(scoreCase(a02.expect, marked, "f2").pass).toBe(true);
});

// ---------- perfil f3 (pinar_pins_search) ----------

async function runLoopF3(script: ScriptedResponse[], profile: "f2" | "f3" = "f3") {
  const fake = makeFakeFetch(script);
  const loop = await runAgentLoop({
    casePrompt: "caso de teste",
    client: {
      apiKey: "sk-test-NAO-VAZAR",
      baseUrl: "https://appliance.example/v1",
      conversationId: "conv-loop-f3",
      delayImpl: () => Promise.resolve(),
      fetchImpl: fake.fetchImpl,
      model: "modelo-teste",
      tools: llmToolDefs(false, profile),
    },
    profile,
    respond: fixtureRespond,
    systemPrompt: "sistema de teste",
  });
  return { fake, loop };
}

const CONTRAST_ANSWER = "Você comentou sobre contraste em Configurações do Cinzel e na Tela de checkout da loja.";

test("f3: a busca é oferecida, o respond volta como tool result e o caso de busca passa", async () => {
  const p01 = caseById("p01-onde-contraste");
  const { fake, loop } = await runLoopF3([
    { chunks: [toolCallChunk([{ args: { query: "contraste" }, name: "pinar_pins_search" }]), toolFinish()] },
    { chunks: [textChunk(CONTRAST_ANSWER), stop()] },
  ]);
  const offered = (JSON.parse(fake.requests[0].body) as { tools: Array<{ function: { name: string } }> }).tools.map((entry) => entry.function.name);
  expect(offered).toContain("pinar_pins_search");
  expect(offered.length).toBe(39);
  // O tool result é o { hits } do respond, sem mudança.
  const messages = (JSON.parse(fake.requests[1].body) as { messages: Array<{ content: string; role: string }> }).messages;
  const toolMessage = messages.find((message) => message.role === "tool")!;
  expect(JSON.parse(toolMessage.content)).toEqual(fixtureRespond("pinar.pins_search", { query: "contraste" }) as object);
  expect(loop.unknownNames).toEqual([]);
  expect(loop.toolCalls[0].problems).toEqual([]);
  const score = scoreCase(p01.expect, loop, "f3");
  expect(score.searchFirstOk).toBe(true);
  expect(score.coverageOk).toBe(true);
  expect(score.pass).toBe(true);
  const gates = benchGates([loopToRun(p01, loop, 1, score)], "f3");
  expect(gates.find((entry) => entry.id === "action")?.pass).toBe(true);
  expect(gates.find((entry) => entry.id === "search")).toMatchObject({ measured: "100.0% (1/1)", pass: true });
});

test("f3: listar sessões antes de buscar reprova a ação do caso de busca", async () => {
  const p01 = caseById("p01-onde-contraste");
  const { loop } = await runLoopF3([
    { chunks: [toolCallChunk([{ args: { query: "contraste" }, name: "pinar_list_sessions" }]), toolFinish()] },
    { chunks: [toolCallChunk([{ args: { query: "contraste" }, name: "pinar_pins_search" }]), toolFinish()] },
    { chunks: [textChunk(CONTRAST_ANSWER), stop()] },
  ]);
  const score = scoreCase(p01.expect, loop, "f3");
  // Busca feita, menções e término certos: só a ordem reprova.
  expect(score.mustCallOk).toBe(true);
  expect(score.mentionsOk).toBe(true);
  expect(score.endOk).toBe(true);
  expect(score.searchFirstOk).toBe(false);
  expect(score.pass).toBe(false);
  const gates = benchGates([loopToRun(p01, loop, 1, score)], "f3");
  expect(gates.find((entry) => entry.id === "action")).toMatchObject({ measured: "0.0% (0/1)", pass: false });
  expect(gates.find((entry) => entry.id === "search")).toMatchObject({ measured: "0.0% (0/1)", pass: false });
});

test("f3: na mesma resposta vale a ordem das chamadas", async () => {
  const p03 = caseById("p03-pdf-download");
  const answer = "The PDF download pin is in Faturas do Skedly.";
  const searchCall = { args: { query: "PDF download" }, name: "pinar_pins_search" };
  const listCall = { args: { query: "PDF" }, name: "pinar_list_sessions" };
  const { loop: searchFirst } = await runLoopF3([
    { chunks: [toolCallChunk([searchCall, listCall]), toolFinish()] },
    { chunks: [textChunk(answer), stop()] },
  ]);
  expect(scoreCase(p03.expect, searchFirst, "f3").pass).toBe(true);
  const { loop: listFirst } = await runLoopF3([
    { chunks: [toolCallChunk([listCall, searchCall]), toolFinish()] },
    { chunks: [textChunk(answer), stop()] },
  ]);
  const score = scoreCase(p03.expect, listFirst, "f3");
  expect(score.searchFirstOk).toBe(false);
  expect(score.pass).toBe(false);
});

test("f3 herda a f2: pinar_ask encerra o turno; no f2 a busca é ferramenta desconhecida", async () => {
  const { fake, loop } = await runLoopF3([{ chunks: [toolCallChunk([{ args: ASK_ARGS, name: "pinar_ask" }]), toolFinish()] }]);
  expect(fake.requests.length).toBe(1);
  expect(loop.stoppedReason).toBe("ask");
  expect(loop.finalKind).toBe("ask");
  expect(scoreCase(caseById("a02-mover-para-qual").expect, loop, "f3").pass).toBe(true);
  const { loop: f2 } = await runLoopF3(
    [
      { chunks: [toolCallChunk([{ args: { query: "contraste" }, name: "pinar_pins_search" }]), toolFinish()] },
      { chunks: [textChunk(CONTRAST_ANSWER), stop()] },
    ],
    "f2",
  );
  expect(f2.unknownNames).toEqual(["pinar_pins_search"]);
  expect(f2.toolCalls[0].error).toBe("Unknown tool");
});

// ---------- perfil f3: ajustes do b03 e dos fora de escopo ----------

const B03_ANSWER = "Mencionam contraste: Configurações do Cinzel e Tela de checkout da loja.";

test("f3: o b03 passa só com a busca; no f2 a mesma execução reprova", async () => {
  const b03 = caseById("b03-busca-por-pin");
  const { loop } = await runLoopF3([
    { chunks: [toolCallChunk([{ args: { query: "contraste" }, name: "pinar_pins_search" }]), toolFinish()] },
    { chunks: [textChunk(B03_ANSWER), stop()] },
  ]);
  const score = scoreCase(expectFor(b03, "f3"), loop, "f3");
  expect(score.mustCallOk).toBe(true);
  expect(score.coverageOk).toBe(true);
  expect(score.pass).toBe(true);
  expect(benchGates([loopToRun(b03, loop, 1, score)], "f3").find((entry) => entry.id === "action")?.pass).toBe(true);
  // Controle: com a expectativa da f2 (o expect do caso), a busca sozinha não basta.
  const f2Score = scoreCase(b03.expect, loop, "f3");
  expect(f2Score.missingMustCall).toEqual(["pinar_list_sessions"]);
  expect(f2Score.pass).toBe(false);
  // A listagem continua valendo no f3.
  const { loop: listed } = await runLoopF3([
    { chunks: [toolCallChunk([{ args: { query: "contraste" }, name: "pinar_list_sessions" }]), toolFinish()] },
    { chunks: [textChunk(B03_ANSWER), stop()] },
  ]);
  expect(scoreCase(expectFor(b03, "f3"), listed, "f3").pass).toBe(true);
  // Sem nenhuma das duas, ou com as menções erradas, reprova.
  const { loop: guessed } = await runLoopF3([{ chunks: [textChunk(B03_ANSWER), stop()] }]);
  const guessedScore = scoreCase(expectFor(b03, "f3"), guessed, "f3");
  expect(guessedScore.missingMustCall).toEqual(["pinar_list_sessions|pinar_pins_search"]);
  expect(guessedScore.pass).toBe(false);
  expect(benchGates([loopToRun(b03, guessed, 1, guessedScore)], "f3").find((entry) => entry.id === "action")?.pass).toBe(false);
  const { loop: wrong } = await runLoopF3([
    { chunks: [toolCallChunk([{ args: { query: "contraste" }, name: "pinar_pins_search" }]), toolFinish()] },
    { chunks: [textChunk("Mencionam contraste: Configurações do Cinzel."), stop()] },
  ]);
  expect(scoreCase(expectFor(b03, "f3"), wrong, "f3").mentionsFailures).toEqual(["Tela de checkout da loja"]);
});

test("f3: uma busca no x01 reprova; no f2 a mesma chamada fica só no gate de fora do catálogo", async () => {
  const x01 = caseById("x01-clima");
  const refusal = "Não tenho acesso à previsão do tempo; cuido do Pinar.";
  const script = (): ScriptedResponse[] => [
    { chunks: [toolCallChunk([{ args: { query: "previsão do tempo" }, name: "pinar_pins_search" }]), toolFinish()] },
    { chunks: [textChunk(refusal), stop()] },
  ];
  const { loop } = await runLoopF3(script());
  const score = scoreCase(expectFor(x01, "f3"), loop, "f3");
  expect(score.calledMustNot).toEqual(["pinar_pins_search"]);
  expect(score.mustNotCallOk).toBe(false);
  expect(score.pass).toBe(false);
  expect(benchGates([loopToRun(x01, loop, 1, score)], "f3").find((entry) => entry.id === "action")?.pass).toBe(false);
  // Controle: a recusa sem chamada passa no f3.
  const { loop: clean } = await runLoopF3([{ chunks: [textChunk(refusal), stop()] }]);
  expect(scoreCase(expectFor(x01, "f3"), clean, "f3").pass).toBe(true);
  // f2 sem mudança: o veto é o do caso, e o nome desconhecido conta no gate de fora do catálogo.
  const { loop: f2 } = await runLoopF3(script(), "f2");
  expect(expectFor(x01, "f2")).toBe(x01.expect);
  const f2Score = scoreCase(expectFor(x01, "f2"), f2, "f2");
  expect(f2Score.mustNotCallOk).toBe(true);
  expect(f2.unknownNames).toEqual(["pinar_pins_search"]);
  // As outras ferramentas só do assistente também reprovam no f3, nos três casos fora de escopo.
  for (const id of ["x01-clima", "x02-haicai", "g06-out-of-scope"]) {
    const benchCase = caseById(id);
    for (const call of [
      { args: { collectionId: "c", sessionIds: ["s"] }, name: "pinar_move_sessions" },
      { args: { options: ["A", "B"], question: "Qual?" }, name: "pinar_ask" },
      { args: { query: "x" }, name: "pinar_pins_search" },
    ]) {
      const { loop: called } = await runLoopF3([{ chunks: [toolCallChunk([call]), toolFinish()] }, { chunks: [textChunk(refusal), stop()] }]);
      expect(scoreCase(expectFor(benchCase, "f3"), called, "f3").calledMustNot).toEqual([call.name]);
    }
  }
});
