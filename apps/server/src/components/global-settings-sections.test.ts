import { describe, expect, test } from "bun:test";
import { resolveSettingsSection, showsAiSection, showsAiSettings, type SettingsSection } from "./global-settings-sections";

const SECTIONS: SettingsSection[] = ["about", "agentAccess", "ai", "aiUsage", "capture", "data", "general", "interface"];

describe("global settings sections", () => {
  test("the self-hosted server never offers the AI section, whatever the account", () => {
    expect(showsAiSettings("local", false)).toBe(false);
    expect(showsAiSettings("local", true)).toBe(false);
  });

  test("Cloud offers the AI section only to eligible accounts", () => {
    expect(showsAiSettings("cloud", true)).toBe(true);
    expect(showsAiSettings("cloud", false)).toBe(false);
  });

  test("the self-hosted server always offers the ai configuration section", () => {
    expect(showsAiSection("local")).toBe(true);
  });

  test("Cloud never offers the ai configuration section", () => {
    expect(showsAiSection("cloud")).toBe(false);
  });

  test("a request for the AI section on the self-hosted server lands on General", () => {
    expect(resolveSettingsSection("aiUsage", { runtime: "local", showAgentAccess: false })).toBe("general");
    expect(resolveSettingsSection("aiUsage", { runtime: "local", showAgentAccess: true })).toBe("general");
  });

  test("a request for the ai configuration section is only accepted on the self-hosted server", () => {
    expect(resolveSettingsSection("ai", { runtime: "local", showAgentAccess: false })).toBe("ai");
    expect(resolveSettingsSection("ai", { runtime: "local", showAgentAccess: true })).toBe("ai");
    expect(resolveSettingsSection("ai", { runtime: "cloud", showAgentAccess: false })).toBe("general");
    expect(resolveSettingsSection("ai", { runtime: "cloud", showAgentAccess: true })).toBe("general");
  });

  test("the data section is accepted on every runtime", () => {
    expect(resolveSettingsSection("data", { runtime: "local", showAgentAccess: false })).toBe("data");
    expect(resolveSettingsSection("data", { runtime: "local", showAgentAccess: true })).toBe("data");
    expect(resolveSettingsSection("data", { runtime: "cloud", showAgentAccess: false })).toBe("data");
    expect(resolveSettingsSection("data", { runtime: "cloud", showAgentAccess: true })).toBe("data");
  });

  test("Cloud sections are left as requested", () => {
    for (const section of SECTIONS.filter((item) => item !== "ai")) {
      const expected = section;
      expect(resolveSettingsSection(section, { runtime: "cloud", showAgentAccess: true })).toBe(expected);
    }
    expect(resolveSettingsSection("aiUsage", { runtime: "cloud", showAgentAccess: false })).toBe("aiUsage");
    expect(resolveSettingsSection("agentAccess", { runtime: "cloud", showAgentAccess: false })).toBe("general");
  });

  test("every section other than the cloud-only ones stays reachable on the self-hosted server", () => {
    for (const section of SECTIONS.filter((item) => item !== "aiUsage" && item !== "agentAccess")) {
      expect(resolveSettingsSection(section, { runtime: "local", showAgentAccess: false })).toBe(section);
    }
  });
});
