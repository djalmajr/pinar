# Usabilidade — Falha e reembolso de IA

- **Data:** 2026-08-18
- **Ambiente:** build local, Chromium; falhas determinísticas
- **Veredito:** ✅ falha informa não cobrança e retry preserva id quando necessário

Falha terminal mostrou **No credit was charged** e **Try again**. Um estado `ai_refund_pending` manteve o request id no retry seguinte; a recuperação terminou em resumo sem duplicar a identidade da reserva. A integração continua sendo a prova do saldo restaurado e do ledger `refunded`.
