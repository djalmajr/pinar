import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";

const extensionPath = (file: string) => resolve(process.cwd(), "extension", file);

const fixture = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Voice comment fixture</title></head>
  <body>
    <main style="display:flex;gap:32px;padding:140px 48px">
      <button id="first" style="height:96px;width:180px">First target</button>
      <button id="second" style="height:96px;width:180px">Second target</button>
      <button id="third" style="height:96px;width:180px">Third target</button>
    </main>
  </body>
</html>`;

async function installVoiceHarness(
  page: Page,
  voiceAvailability = { available: true, ok: true, reason: null as string | null },
) {
  await page.addInitScript(() => {
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function attachOpenShadow(init) {
      return original.call(this, { ...init, mode: "open" });
    };
  });
  await page.route("**/voice-comment-fixture", (route) => route.fulfill({
    body: fixture,
    contentType: "text/html",
  }));
  await page.goto("/voice-comment-fixture");
  await page.evaluate((availability) => {
    const runtimeState = { messages: [] as any[], pins: [] as any[] };
    (globalThis as any).__pinarRuntimeState = runtimeState;
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: async (message: any) => {
          runtimeState.messages.push(structuredClone(message));
          if (message.type === "voice:availability") return availability;
          if (message.type === "voice:transcribe") {
            await new Promise((resolvePromise) => setTimeout(resolvePromise, 350));
            return {
              ok: true,
              result: {
                acceptanceCriteria: [],
                comment: "Align the button",
                transcript: "Align the button",
              },
            };
          }
          if (message.type === "pins:sync") {
            runtimeState.pins = structuredClone(message.pins);
            return { ok: true, pins: structuredClone(runtimeState.pins) };
          }
          if (message.type === "pins:list") return { ok: true, pins: structuredClone(runtimeState.pins) };
          return { ok: true };
        },
      },
    };

    const track = { stop() {} };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [track] }) },
    });

    class FakeMediaRecorder extends EventTarget {
      static isTypeSupported() { return true; }
      mimeType = "audio/webm";
      state = "inactive";
      start() { this.state = "recording"; }
      stop() {
        if (this.state !== "recording") return;
        this.state = "inactive";
        const dataEvent = new Event("dataavailable");
        Object.defineProperty(dataEvent, "data", {
          value: new Blob(["voice"], { type: this.mimeType }),
        });
        queueMicrotask(() => {
          this.dispatchEvent(dataEvent);
          this.dispatchEvent(new Event("stop"));
        });
      }
    }

    class FakeAudioContext {
      state = "running";
      close() { this.state = "closed"; return Promise.resolve(); }
      createAnalyser() {
        return {
          disconnect() {},
          fftSize: 256,
          getByteTimeDomainData(data: Uint8Array) {
            data.forEach((_, index) => { data[index] = index % 2 ? 166 : 90; });
          },
        };
      }
      createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
      resume() { return Promise.resolve(); }
    }

    (globalThis as any).AudioContext = FakeAudioContext;
    (globalThis as any).MediaRecorder = FakeMediaRecorder;
  }, voiceAvailability);

  for (const file of ["coordinates.js", "frame-path.js", "locators.js", "privacy.js", "keyboard.js", "voice.js", "content.js"]) {
    await page.addScriptTag({ path: extensionPath(file) });
  }
  await expect(page.locator('[data-pinar="host"]')).toBeVisible();
}

async function openComposer(page: Page, selector: string) {
  const bounds = await page.locator(selector).boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) return;
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(page.locator('[data-pinar="host"] [data-ref="composer"]')).toBeVisible();
}

// Mutation captured: hiding an unavailable voice control removes the plan explanation entirely.
test("unavailable voice control stays visible and explains the Pro requirement", async ({ page }) => {
  await installVoiceHarness(page, { available: false, ok: true, reason: "pro_required" });
  await openComposer(page, "#first");
  const composer = page.locator('[data-pinar="host"] [data-ref="composer"]');
  const voice = composer.locator('[data-ref="voice"]');
  const voiceControl = composer.locator('[data-ref="voiceControl"]');
  const tooltip = composer.locator('[data-ref="voiceTooltip"]');

  await expect(voice).toBeVisible();
  await expect(voice).toBeDisabled();
  await expect(voice).toHaveAttribute("aria-label", /Pinar Pro/);
  await expect(voiceControl).toHaveAttribute("tabindex", "0");
  await voiceControl.hover();
  await expect(tooltip).toContainText("Voice comments are included with Pinar Pro");
  await expect(tooltip).toHaveCSS("opacity", "1");
  await page.mouse.move(0, 0);
  await voiceControl.focus();
  await expect(tooltip).toHaveCSS("opacity", "1");
});

// Mutation captured: leaving the standard actions visible makes the recorder overlap the composer footer.
test("voice timeline supports review, direct send and cancellation without redundant status", async ({ page }) => {
  await installVoiceHarness(page);
  await openComposer(page, "#first");
  const composer = page.locator('[data-pinar="host"] [data-ref="composer"]');
  const actions = composer.locator('[data-ref="composerActions"]');
  const session = composer.locator('[data-ref="voiceSession"]');
  const input = composer.locator("textarea");
  const idleComposerBox = await composer.locator(".composer-card").boundingBox();
  expect(idleComposerBox).not.toBeNull();

  // Mutation captured: assigning the latest transcript to the field erases existing text and ignores the cursor.
  await input.fill("Start end");
  await input.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(6, 6));
  await composer.getByRole("button", { name: "Speak comment" }).click();
  await expect(session).toBeVisible();
  await expect(actions).toBeHidden();
  await expect(composer.locator('[data-ref="voiceElapsed"]')).toHaveText(/\d+s \/ 120s/);
  const recordingComposerBox = await composer.locator(".composer-card").boundingBox();
  expect(recordingComposerBox).not.toBeNull();
  if (!idleComposerBox || !recordingComposerBox) throw new Error("Composer geometry is unavailable");
  for (const axis of ["x", "y", "width", "height"] as const) {
    expect(recordingComposerBox[axis]).toBeCloseTo(idleComposerBox[axis], 1);
  }
  const geometry = await session.evaluate((element) => {
    const cancel = element.querySelector("[data-ref=voiceCancel]")?.getBoundingClientRect();
    const cancelIcon = element.querySelector("[data-ref=voiceCancel] svg")?.getBoundingClientRect();
    const microphone = element.querySelector("[data-ref=voiceMeta] svg")?.getBoundingClientRect();
    const elapsed = element.querySelector("[data-ref=voiceElapsed]")?.getBoundingClientRect();
    const send = element.querySelector("[data-ref=voiceSend]")?.getBoundingClientRect();
    const sendIcon = element.querySelector("[data-ref=voiceSend] svg")?.getBoundingClientRect();
    const sessionBox = element.getBoundingClientRect();
    const stop = element.querySelector("[data-ref=voiceStop]")?.getBoundingClientRect();
    const stopButton = element.querySelector("[data-ref=voiceStop]");
    const stopIcon = element.querySelector("[data-ref=voiceStop] svg")?.getBoundingClientRect();
    const stopGlyph = element.querySelector("[data-ref=voiceStop] rect")?.getBoundingClientRect();
    const wave = element.querySelector("[data-ref=voiceWave]")?.getBoundingClientRect();
    return {
      actionSizes: [cancel, stop, send].map((box) => box ? [box.width, box.height] : null),
      cancelRadius: cancel ? getComputedStyle(element.querySelector("[data-ref=voiceCancel]") as Element).borderRadius : "",
      edgeInsets: cancel && send ? {
        left: cancel.left - sessionBox.left,
        right: sessionBox.right - send.right,
      } : null,
      elapsedAfterMicrophone: Boolean(microphone && elapsed && elapsed.left >= microphone.right),
      iconSizes: [cancelIcon, stopIcon, sendIcon].map((box) => box ? [box.width, box.height] : null),
      sendRadius: send ? getComputedStyle(element.querySelector("[data-ref=voiceSend]") as Element).borderRadius : "",
      stopGlyphSize: stopGlyph ? [stopGlyph.width, stopGlyph.height] : null,
      stopPadding: stopButton ? getComputedStyle(stopButton).padding : "",
      waveRatio: wave ? wave.width / sessionBox.width : 0,
    };
  });
  // Mutation captured: removing the horizontal inset leaves the edge controls touching the waveform container.
  expect(geometry.edgeInsets?.left).toBeGreaterThanOrEqual(4);
  expect(geometry.edgeInsets?.right).toBeGreaterThanOrEqual(4);
  // Mutation captured: fully rounded controls ignore the extension's established six-pixel button radius.
  expect(geometry.cancelRadius).toBe("6px");
  expect(geometry.sendRadius).toBe("6px");
  expect(geometry.actionSizes).toEqual([[32, 32], [32, 32], [32, 32]]);
  expect(geometry.iconSizes).toEqual([[17, 17], [17, 17], [17, 17]]);
  expect(geometry.stopGlyphSize?.[0]).toBeGreaterThan(10);
  expect(geometry.stopGlyphSize?.[1]).toBeGreaterThan(10);
  expect(geometry.stopPadding).toBe("0px");
  expect(geometry.elapsedAfterMicrophone).toBe(true);
  expect(geometry.waveRatio).toBeGreaterThan(0.3);
  const spacing = await session.evaluate((element) => {
    const sessionStyle = getComputedStyle(element);
    const actionsStyle = getComputedStyle(element.parentElement?.querySelector("[data-ref=composerActions]") as Element);
    return {
      actionsGap: actionsStyle.gap,
      actionsPadding: actionsStyle.padding,
      sessionGap: sessionStyle.gap,
      sessionPadding: sessionStyle.padding,
    };
  });
  expect(spacing.sessionGap).toBe(spacing.actionsGap);
  expect(spacing.sessionPadding).toBe(spacing.actionsPadding);
  await expect.poll(() => composer.locator("[data-ref=voiceWaveTrack] i").evaluateAll((bars) => (
    bars.filter((bar) => Number.parseFloat(getComputedStyle(bar).height) > 3).length
  ))).toBeGreaterThan(1);
  await page.waitForTimeout(120);
  const recordingBarHeight = await composer.locator("[data-ref=voiceWaveTrack] i").evaluateAll((bars) => (
    Math.max(...bars.map((bar) => bar.getBoundingClientRect().height))
  ));

  await composer.getByRole("button", { name: "Stop recording" }).click();
  await expect(session).toHaveClass(/is-processing/);
  await expect(composer.getByText("Transcribing and organizing…")).toHaveCount(0);
  // Mutation captured: scaling the processing bars makes the waveform visibly shorter than the recording timeline.
  const processingBarHeight = await composer.locator("[data-ref=voiceWaveTrack] i").evaluateAll((bars) => {
    for (const bar of bars) {
      for (const animation of bar.getAnimations()) {
        animation.pause();
        animation.currentTime = 0;
      }
    }
    return Math.max(...bars.map((bar) => bar.getBoundingClientRect().height));
  });
  expect(processingBarHeight).toBeCloseTo(recordingBarHeight, 1);
  const processingComposerBox = await composer.locator(".composer-card").boundingBox();
  expect(processingComposerBox).not.toBeNull();
  if (!processingComposerBox) throw new Error("Composer geometry is unavailable while processing");
  for (const axis of ["x", "y", "width", "height"] as const) {
    expect(processingComposerBox[axis]).toBeCloseTo(idleComposerBox[axis], 1);
  }
  await expect(input).toHaveValue("Start Align the button end");
  await expect(session).toBeHidden();
  await expect(actions).toBeVisible();
  await expect(composer.getByText("Voice comment ready to review")).toHaveCount(0);

  await composer.getByRole("button", { name: "Speak comment" }).click();
  await composer.getByRole("button", { name: "Stop recording" }).click();
  await expect(input).toHaveValue("Start Align the button Align the button end");
  await composer.getByRole("button", { name: "Add" }).click();

  await openComposer(page, "#second");
  await composer.getByRole("button", { name: "Speak comment" }).click();
  await session.locator('[data-ref="voiceSend"]').click();
  await expect(session).toHaveClass(/is-processing/);
  await expect(composer).toBeHidden();
  await expect(page.locator('[data-pinar="host"] [data-pin]')).toHaveCount(2);

  await openComposer(page, "#third");
  await composer.getByRole("button", { name: "Speak comment" }).click();
  await session.locator('[data-ref="voiceCancel"]').click();
  await expect(session).toBeHidden();
  await expect(actions).toBeVisible();
  await expect(composer.locator("textarea")).toHaveValue("");

  const state = await page.evaluate(() => (globalThis as any).__pinarRuntimeState);
  expect(state.pins.map((pin: any) => pin.comment)).toEqual([
    "Start Align the button Align the button end",
    "Align the button",
  ]);
  expect(state.messages.filter((message: any) => message.type === "voice:transcribe")).toHaveLength(3);
});
