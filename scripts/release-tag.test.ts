import { describe, expect, test } from "bun:test";
import { classifyReleaseTag } from "./release-tag.mjs";

describe("classifyReleaseTag", () => {
  test("closed product tags ship production and desktop", () => {
    expect(classifyReleaseTag("v0.3.5")).toEqual({
      channel: "production",
      kind: "closed",
      tag: "v0.3.5",
      version: "0.3.5",
    });
    expect(classifyReleaseTag("v1.0.0")).toMatchObject({ kind: "closed", channel: "production" });
  });

  test("prerelease product tags ship staging only", () => {
    expect(classifyReleaseTag("v1.0.0-0")).toEqual({
      channel: "staging",
      kind: "prerelease",
      tag: "v1.0.0-0",
      version: "1.0.0-0",
    });
    expect(classifyReleaseTag("v1.0.0-rc.1")).toEqual({
      channel: "staging",
      kind: "prerelease",
      tag: "v1.0.0-rc.1",
      version: "1.0.0-rc.1",
    });
    expect(classifyReleaseTag("v0.4.0-alpha.1").kind).toBe("prerelease");
    expect(classifyReleaseTag("v0.4.0-beta.2").channel).toBe("staging");
  });

  test("extension tags stay on the independent channel", () => {
    expect(classifyReleaseTag("ext-v0.5.3")).toEqual({
      channel: "extension",
      kind: "extension",
      tag: "ext-v0.5.3",
      version: "0.5.3",
    });
  });

  test("rejects incomplete or unrelated names", () => {
    expect(() => classifyReleaseTag("v1.0")).toThrow("unrecognized");
    expect(() => classifyReleaseTag("1.0.0")).toThrow("unrecognized");
    expect(() => classifyReleaseTag("extension-v0.5.3")).toThrow("unrecognized");
    expect(() => classifyReleaseTag("v1.0.0-")).toThrow("unrecognized");
    expect(() => classifyReleaseTag("")).toThrow("required");
  });
});
