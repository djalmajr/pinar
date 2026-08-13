# Pinar

Visual page annotations are copied to the clipboard by the Chrome extension (⌘/Ctrl+Enter).

When the user pastes annotations, or says they copied/annotated a page:

1. Use the pasted markdown/HTML as the source of truth (comment, DOM path, selector, screenshots).
2. If they did not paste and an `ai-feedback` MCP server is connected, call `feedback_status` then `feedback_take` only if `sentWaiting` is true.
3. Change only what the pins describe.

Do not expect the extension to inject a prompt into the composer. The user pastes.
