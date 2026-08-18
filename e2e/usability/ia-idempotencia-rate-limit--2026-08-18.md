# Usabilidade — Idempotência e rate limit de IA

- **Data:** 2026-08-18
- **Ambiente:** build local, Chromium
- **Veredito:** ✅ single-flight visível e rate limit recuperável

Durante a chamada, o modal permaneceu em **Summarizing…** com somente um request. A resposta `ai_rate_limited` ofereceu **Try again**; a nova tentativa usou outro request id e concluiu. Replay, concorrência de reserva, saldo e ledger permanecem provados pelos testes de integração.
