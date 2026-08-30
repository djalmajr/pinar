# Closed-loop release gate

A public release is not ready until this loop has been proven on a supported Chrome install.

Do not treat pixel-to-pixel screenshot comparison as the only visual criterion.

## Automated gate

Run from a checkout:

```sh
bun run test
bunx playwright test --project=chromium tests/e2e/extensao/closed-loop.e2e.test.ts tests/e2e/extensao/pin-handoff.e2e.test.ts tests/e2e/extensao/session-reopen.e2e.test.ts
```

The contract covers `pin → handoff → agent return → correction_ready → accepted`, a second return after reopen, the four agent adapters on one fixture, degraded screenshot/helper warnings, and loop metrics that stay off until an explicit opt-in.

## Chrome (not simulable in Playwright)

Reload the unpacked extension from `extension/` (or `extension/dist` after `bun run build:ext`).

1. Pin an element, copy with ⌘/Ctrl+Enter, and paste the same bundle into each of the four agent composers.
2. Publish a `changed` agent result for that `captureId` / `pinId`.
3. In the viewer, confirm the pin is `correction_ready`, then accept it as a human.
4. Use **Review on page** so only that session hydrates on the original URL.
5. Confirm an unresolved or ambiguous pin stays pending instead of snapping to a lookalike.
6. Reopen the pin, publish a second result, and accept again.
7. Leave **Share anonymous loop metrics** off and confirm the helper/cloud store no events. Turn it on only if you intend to send event name, duration, adapter, and location confidence — never comments, URLs, selectors, screenshots, or DOM.

Record the human accept/reopen decision and keep the before/after capture ids. That record is the Chrome release evidence.
