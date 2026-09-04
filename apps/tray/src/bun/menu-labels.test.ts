import { describe, expect, test } from "bun:test";
import {
  detectTrayLanguage,
  formatTrayLabel,
  trayMenuLabels,
} from "./menu-labels";

describe("tray menu labels", () => {
  test("Portuguese labels match the help article", () => {
    const labels = trayMenuLabels("pt");
    expect(labels.folder).toBe("Abrir pasta");
    expect(labels.login).toBe("Iniciar no login");
    expect(labels.openWorkspace).toBe("Abrir o workspace");
    expect(labels.localServerOff).toBe("Servidor local: desligado");
    expect(labels.start).toBe("Iniciar");
  });

  test("English labels keep the published menu copy", () => {
    const labels = trayMenuLabels("en");
    expect(labels.folder).toBe("Open Folder");
    expect(labels.login).toBe("Start at Login");
    expect(labels.openWorkspace).toBe("Open Workspace");
    expect(labels.localServerOff).toBe("Local Server: Off");
    expect(labels.start).toBe("Start");
  });

  test("detects PINAR_LANGUAGE before the OS locale", () => {
    expect(detectTrayLanguage({ PINAR_LANGUAGE: "pt" }, "en-US")).toBe("pt");
    expect(detectTrayLanguage({ LANG: "ja_JP.UTF-8" }, "en-US")).toBe("ja");
    expect(detectTrayLanguage({}, "zh-CN")).toBe("zh");
    expect(detectTrayLanguage({}, "en-GB")).toBe("en");
  });

  test("fills the update version into localized templates", () => {
    expect(formatTrayLabel(trayMenuLabels("en").updateTo, "0.3.0")).toBe(
      "Update to 0.3.0",
    );
    expect(formatTrayLabel(trayMenuLabels("pt").downloading, "0.3.0")).toBe(
      "Baixando 0.3.0…",
    );
  });
});
