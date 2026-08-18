---
id: publico-alternar-idioma-tema
name: Detectar e alternar idioma e tema nas páginas públicas
reference: apps/server/src/components/ServerHeader.tsx; apps/server/src/lib/i18n.tsx; apps/server/src/routes/__root.tsx
persona: accessibility
entry: "https://stg.pinar.dev/"
preconditions:
  - Staging acessível no ponto de entrada
  - Primeira execução usa um perfil sem `pinar-language` salvo
  - Locale do navegador configurado como `pt-BR`
---

## User goal

Ler o produto no idioma e contraste preferidos e manter a escolha ao navegar.

## Steps

1. Na primeira landing, **aguardar a detecção do navegador** → textos iniciam em português por causa de `pt-BR`.
2. **Abrir "Idioma" e escolher English** → textos mudam para inglês.
3. **Recarregar a página** → escolha manual em inglês vence o locale `pt-BR`.
4. **Abrir "Language" e escolher Português** → textos voltam ao português.
5. **Clicar em "Alternar tema"** → tema muda e mantém contraste legível.
6. **Clicar em "Planos"** → idioma e tema persistem na página de preços.
7. **Recarregar e voltar ao Início** → preferências continuam aplicadas.

## Expected result

O idioma inicia pelo locale detectado; escolhas manuais e tema persistem entre páginas e recarga.
