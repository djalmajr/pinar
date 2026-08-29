import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./frame-path.js", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const { joinFrameDomPath, splitFrameDomPath } = context.__pinarFramePath;

describe("frame DOM paths", () => {
  test("joins nested iframe paths from the top document to the selected element", () => {
    // Mutation captured: dropping the ancestor paths reproduces the truncated iframe path reported by the user.
    const path = joinFrameDomPath(
      ["body > iframe#workspace-shell", "body > iframe#application-frame"],
      "body > main > button#iframe-target",
    );

    assert.equal(
      path,
      "body > iframe#workspace-shell ::frame:: body > iframe#application-frame ::frame:: body > main > button#iframe-target",
    );
  });

  test("keeps the existing path unchanged in the top document", () => {
    assert.equal(joinFrameDomPath([], "body > main > button#target"), "body > main > button#target");
  });

  test("splits nested iframe paths back into per-document selectors", () => {
    assert.equal(
      splitFrameDomPath("body > iframe#workspace-shell ::frame:: body > iframe#application-frame ::frame:: body > main > button#iframe-target").join(" | "),
      "body > iframe#workspace-shell | body > iframe#application-frame | body > main > button#iframe-target",
    );
  });
});
