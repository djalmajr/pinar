---
id: publico-instalar-e-apoiar
name: Encontrar instaladores e canais de patrocínio
reference: README.md; apps/server/src/pages/Landing.tsx; apps/server/src/components/ServerFooter.tsx; apps/server/src/routes/install[.]sh.ts; apps/server/src/routes/install[.]ps1.ts
persona: novice
entry: "https://stg.pinar.dev/"
preconditions:
  - Staging acessível no ponto de entrada
  - Visitante ou usuário Free
---

## User goal

Encontrar uma forma segura de instalar o Pinar e, se quiser, apoiar o projeto.

## Steps

1. Na landing, **ler o card "Private by default"** → entende que o servidor local mantém dados no dispositivo.
2. **Clicar em "View plans" e localizar o card Free** → CTA "Use Free" está visível.
3. **Clicar em "Use Free"** → repositório/README abre com instruções para Unix e PowerShell.
4. **Voltar ao Pinar e localizar o rodapé** → bloco de patrocínio aparece para visitante/Free.
5. **Inspecionar "Buy Me a Coffee" e "Sponsor on GitHub"** → links apontam aos domínios esperados e abrem externamente.
6. **Usar os links/comandos documentados dos instaladores** → Unix e PowerShell respondem como texto executável, sem HTML inesperado.

## Expected result

O visitante entende instalação local e encontra os dois canais de apoio sem sair
do fluxo público por um link enganoso.
