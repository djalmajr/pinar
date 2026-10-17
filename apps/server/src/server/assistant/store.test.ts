import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ASSISTANT_MESSAGE_ID_PATTERN,
  ASSISTANT_THREAD_ID_PATTERN,
  ASSISTANT_TITLE_MAX,
  assistantThreadTitle,
  newAssistantMessageId,
  newAssistantThreadId,
} from "./store";

describe("assistant store helpers", () => {
  test("assistantThreadTitle collapses whitespace, trims, and cuts at 80 characters", () => {
    assert.equal(assistantThreadTitle("  fix   the   header  "), "fix the header");
    assert.equal(assistantThreadTitle(""), "…");
    assert.equal(assistantThreadTitle("  \n\t  "), "…");

    const exact = "a".repeat(ASSISTANT_TITLE_MAX);
    assert.equal(assistantThreadTitle(exact), exact);

    const long = `${"b".repeat(ASSISTANT_TITLE_MAX)}cd`;
    const expected = `${"b".repeat(ASSISTANT_TITLE_MAX - 1)}…`;
    assert.equal(assistantThreadTitle(long), expected);
    assert.equal(expected.length, ASSISTANT_TITLE_MAX);
  });

  test("cuts the title by grapheme without splitting a surrogate pair or a combining mark", () => {
    // 78 a's + one emoji grapheme + xyz: the cut must keep the emoji whole.
    const emojiTitle = assistantThreadTitle(`a${"a".repeat(77)}😀xyz`);
    assert.equal(emojiTitle, `a${"a".repeat(77)}😀…`);
    assert.ok(emojiTitle.isWellFormed(), "no isolated surrogate after the cut");

    // 78 a's + é written as e + combining acute (one grapheme) + xyz: the
    // combining mark must stay attached to its base at the limit.
    const combiningTitle = assistantThreadTitle(`a${"a".repeat(77)}e\u0301xyz`);
    assert.equal(combiningTitle, `a${"a".repeat(77)}e\u0301…`);

    // A single emoji alone is one grapheme, far below the ceiling.
    assert.equal(assistantThreadTitle("😀"), "😀");
  });

  test("id generators produce the contract shapes", () => {
    assert.match(newAssistantThreadId(), ASSISTANT_THREAD_ID_PATTERN);
    assert.match(newAssistantMessageId(), ASSISTANT_MESSAGE_ID_PATTERN);
    assert.notEqual(newAssistantThreadId(), newAssistantThreadId());
    assert.notEqual(newAssistantMessageId(), newAssistantMessageId());
  });
});
