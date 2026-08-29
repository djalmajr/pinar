export const VISUAL_CONTEXT_FIXTURES = {
  areaV0: {
    captureId: "cap_area_v0",
    page: { title: "Dashboard", url: "https://example.test/dashboard" },
    pins: [{
      box: { height: 80, width: 240, x: 16, y: 48 },
      comment: "Crop the chart",
      kind: "area",
      number: 1,
    }],
  },
  elementV0: {
    captureId: "cap_element_v0",
    page: {
      title: "Pricing",
      url: "https://example.test/pricing",
      viewport: { dpr: 2, height: 900, width: 1440 },
    },
    pins: [{
      anchor: { x: 90, y: 112 },
      box: { height: 40, width: 160, x: 24, y: 80 },
      comment: "Make the CTA bolder",
      id: "pin_cta",
      kind: "element",
      label: "button.cta",
      path: "main > section.card > button.cta",
      selector: "button.cta",
      text: "Get started",
    }],
  },
  iframeV0: {
    captureId: "cap_iframe_v0",
    page: { title: "Embed", url: "https://example.test/embed" },
    pins: [{
      comment: "Submit inside the frame",
      coords: { x: 12, y: 18 },
      frameId: 2,
      kind: "element",
      path: "html > body > iframe > html > body > button",
      selector: "button.submit",
    }],
  },
  invalidPinsObject: {
    captureId: "cap_invalid",
    page: { title: "Secret page", url: "https://example.test/secret" },
    pins: { comment: "UNIQUE_SECRET_PIN_COMMENT" },
  },
  legacyAliases: {
    captureId: "cap_legacy_aliases",
    page: { title: "Legacy", url: "https://example.test/legacy" },
    pins: [{
      comment: "Fix header",
      kind: "element",
      path: "header > h1",
      selector: "h1",
      text: "Welcome",
    }],
  },
  missingScreenshot: {
    captureId: "cap_missing_shot",
    page: { title: "No shot", url: "https://example.test/none" },
    pins: [{ comment: "Still useful", coords: { x: 4, y: 8 } }],
  },
  v1StableIds: {
    captureId: "cap_stable",
    page: { title: "Stable", url: "https://example.test/stable" },
    pins: [{
      comment: "Keep this id",
      number: 3,
      pinId: "pin_custom_abc",
    }],
    schemaVersion: 1,
    screenshot: { missing: false, url: "/tmp/stable.png" },
    viewport: { devicePixelRatio: 2, height: 800, scrollX: 0, scrollY: 40, width: 1280 },
  },
} as const;
