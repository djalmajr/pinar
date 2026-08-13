---
name: pinar
description: >
  Read visual page annotations the user left in the Pinar Chrome
  extension (element pins, area comments, screenshots) and turn them into
  code changes. Use when the user mentions page feedback, annotations, pins,
  on-page comments, "aplica o feedback", or "address my comments on the page".
---

# Pinar

The user annotates a live page in Chrome and copies the bundle with ⌘/Ctrl+Enter. This skill does not browse for them.

1. Prefer what they pasted: comment, DOM path, selector, and screenshots.
2. If they did not paste and MCP is available, call `feedback_status` and `feedback_take` only when `sentWaiting` is true.
3. If nothing was copied or pasted, tell the user to press ⌘/Ctrl+Enter in the extension and paste here. Do not invent pins.
4. Treat each pin comment as an instruction about that DOM path/selector only.
5. Keep the change scoped to the pins unless the user expands the task.
