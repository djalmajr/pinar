import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

test("gives the extension action a rebindable default shortcut", () => {
  assert.ok(
    manifest.action,
    "the action must exist for _execute_action to bind",
  );
  assert.equal(
    manifest.action.default_popup,
    undefined,
    "a default_popup would make _execute_action open the popup instead of firing onClicked",
  );
  const action = manifest.commands?._execute_action;
  assert.ok(action, "commands._execute_action must be declared");
  assert.match(action.suggested_key.default, /^(Alt|Ctrl|Command|MacCtrl)\+/);
});

test("never duplicates the toggle the action already performs", () => {
  for (const name of Object.keys(manifest.commands ?? {})) {
    if (name === "_execute_action") continue;
    assert.doesNotMatch(
      name,
      /toggle|toolbar/i,
      `${name} duplicates the action toggle; bind _execute_action instead`,
    );
  }
});

test("stays within the four suggested-key slots Chrome honors", () => {
  const suggested = Object.values(manifest.commands ?? {}).filter(
    (command) => command.suggested_key,
  );
  assert.ok(
    suggested.length <= 4,
    `${suggested.length} commands request a suggested key; Chrome honors at most 4`,
  );
});
