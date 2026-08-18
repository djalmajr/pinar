---
id: publico-consultar-politicas
name: Consultar políticas legais versionadas em português e inglês
reference: apps/server/src/pages/LegalDocument.tsx; apps/server/src/lib/legal-documents.ts; apps/server/src/components/ServerFooter.tsx
persona: visitante
entry: "https://stg.pinar.dev/"
preconditions:
  - Site público disponível
---

## User goal

Entender quem opera o serviço, quais dados são tratados, as regras de uso,
retenção, reembolso, licença e suboperadores antes de criar uma conta ou pagar.

## Steps

1. No rodapé público, **abrir Terms** → documento exibe título, versão e data efetiva.
2. **Percorrer todos os links legais** → Privacy, Acceptable Use, Retention, Refunds, Fair Source e Subprocessors abrem sem autenticação.
3. **Conferir operador e contato** → identidade pública e e-mail de contato são consistentes.
4. **Conferir Founder e Pro** → cotas, ausência de promessa perpétua e recuperação após cancelamento são explícitas.
5. **Conferir Fair Source** → distingue código disponível de Open Source aprovado pela OSI e aponta para a licença do repositório.
6. **Alternar para português** → títulos e corpo mudam para português sem trocar de documento.
7. **Recarregar a página** → idioma escolhido e versão permanecem visíveis.

## Expected result

Os sete documentos são públicos, bilíngues, versionados, coerentes entre si e
navegáveis antes de qualquer aceite.
