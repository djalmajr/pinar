# Usabilidade — Encontrar instaladores e canais de patrocínio

- **Persona:** novice
- **Data:** 2026-08-17
- **Entrada:** https://stg.pinar.dev/
- **Veredito:** ❌ bloqueado em "Use Free"

## Walkthrough

1. Entendi pela landing que o modo local mantém screenshots e anotações no dispositivo.
2. Naveguei por **View plans** e encontrei o card Free.
3. Cliquei em **Use Free** como link e como botão; o controle recebeu foco, mas a URL permaneceu em `/pricing`.
4. O fluxo parou conforme a regra de não contornar a UI; README, instaladores e links de apoio posteriores não foram declarados exercitados.

## Findings (priorizados)

| # | Severity | Step | What happened | Suggested fix |
|---|---|---|---|---|
| 1 | blocker | 3 | `Use Free` renderiza um `button` dentro de um `a`; o clique no Browser não abre a documentação. | Renderizar um único Button com raiz `a`, `target="_blank"` e `rel="noopener noreferrer"`. |

## Key screens

- `screenshots/2026-08-17/publico-instalar-e-apoiar--01-use-free-sem-navegacao.png`

## Cobertura automatizada

- `tests/e2e/publico/pricing.e2e.test.ts` falhou no DOM aninhado e passou após a correção local.
- Staging continua bloqueado até a correção seguir o fluxo normal de entrega.
- Manual-only pendente: abrir README, verificar os dois instaladores e os links de patrocínio depois do deploy.
