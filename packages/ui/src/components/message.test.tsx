// O tsconfig da raiz só carrega os tipos do Node; quem roda este arquivo é o bun test.
// @ts-expect-error -- bun:test resolves only under the Bun runtime
import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageGroup,
  MessageHeader,
} from "./message.js";

// Render estático sem DOM: o tema escuro troca só as variáveis CSS dos
// tokens (`bg-muted`, `text-muted-foreground`), então o markup dentro de
// `.dark` é o mesmo do claro.
function messageTree(align?: "start" | "end") {
  return (
    <MessageGroup>
      <Message align={align}>
        <MessageAvatar>P</MessageAvatar>
        <MessageContent>
          <MessageHeader>Pinar</MessageHeader>
          <p>oi</p>
          <MessageFooter>agora</MessageFooter>
        </MessageContent>
      </Message>
    </MessageGroup>
  );
}

describe("message", () => {
  it("renderiza as partes com os slots e o alinhamento padrão no início", () => {
    const html = renderToStaticMarkup(messageTree());
    for (const slot of ["message-group", "message", "message-avatar", "message-content", "message-header", "message-footer"]) {
      expect(html).toContain(`data-slot="${slot}"`);
    }
    expect(html).toContain('data-align="start"');
    expect(html).toContain(">oi</p>");
  });

  it("align=end vira data-align=end, que inverte a linha", () => {
    const html = renderToStaticMarkup(messageTree("end"));
    expect(html).toContain('data-align="end"');
    expect(html).toContain("data-[align=end]:flex-row-reverse");
  });

  it("usa os tokens do Pinar e o mesmo markup em claro e escuro", () => {
    const light = renderToStaticMarkup(messageTree());
    const dark = renderToStaticMarkup(<div className="dark">{messageTree()}</div>);
    expect(light).toContain("bg-muted");
    expect(light).toContain("text-muted-foreground");
    expect(dark).toBe(`<div class="dark">${light}</div>`);
  });
});
