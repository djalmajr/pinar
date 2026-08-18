---
id: auth-aceitar-politicas-free-remoto
name: Aceitar políticas atuais antes de habilitar o Free remoto
reference: apps/extension/src/options/OptionsApp.tsx; extension/legal-consent.js; extension/background.js; apps/server/src/server/cloud-api.ts
persona: usuario-extensao
entry: "chrome-extension://<id>/options.html"
preconditions:
  - Extensão instalada e ainda em modo local
  - Bundle legal remoto disponível
---

## User goal

Ativar o armazenamento remoto Free sabendo quais versões legais aceitei, sem
ser obrigado a aceitar políticas para continuar usando o modo local.

## Steps

1. Em Storage, **manter Local Server** → Save funciona sem aceite legal remoto.
2. **Selecionar Remote Server** → aparecem checkbox, versão e links para Terms, Privacy e Acceptable Use.
3. Sem marcar o checkbox, **inspecionar Save** → permanece desabilitado.
4. **Abrir cada política** → link público correto abre em nova aba.
5. **Aceitar e salvar** → a extensão persiste versões, locale e timestamp, e registra a instalação remotamente.
6. **Recarregar opções** → aceite da mesma versão permanece marcado.
7. **Simular versão nova no servidor** → aceite antigo deixa de ser válido e Remote exige novo consentimento.
8. **Voltar ao Local Server** → modo local continua disponível sem novo aceite.

## Expected result

Free remoto só registra ou autentica uma instalação com aceite da versão
corrente; modo local permanece independente e uma versão nova exige novo aceite.
