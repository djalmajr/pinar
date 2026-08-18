---
id: extensao-preferencias
name: Persistir idioma, tema, histórico e viewer
reference: apps/extension/src/options/OptionsApp.tsx; packages/shared/src/i18n/index.ts
persona: accessibility
entry: "chrome-extension://<extension-id>/dist/options.html"
preconditions:
  - Extensão carregada com storage.sync limpo
  - Locale do navegador pt-BR
---

## User goal

Começar no idioma do navegador e personalizar a extensão de forma persistente.

## Steps

1. Na primeira abertura, **aguardar detecção** → interface inicia em português para pt-BR.
2. Em Preferences, **selecionar English** → toda a UI muda.
3. **Selecionar tema escuro** → contraste e ícones atualizam.
4. **Desativar History** → configuração fica pendente de salvar.
5. **Desativar Include viewer** → Copy viewer content também fica indisponível.
6. **Salvar** → toast confirma persistência.
7. **Fechar e reabrir opções** → idioma, tema e toggles permanecem.
8. **Reativar viewer e conteúdo do viewer** → dependência do toggle funciona.
9. **Criar captura** → bundle respeita as preferências salvas.

## Expected result

Autodetecção inicial e preferências explícitas funcionam sem combinações inválidas.
