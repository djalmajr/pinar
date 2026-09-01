(() => {
  if (globalThis.__pinarToggle) {
    globalThis.__pinarToggle();
    return;
  }

  const DRAG_THRESHOLD = 6;
  const BLUE = "#5794FF";
  const MARK = "#6691F2";
  // Keep in sync with extension/pin-colors.js. Content scripts are loaded as classic scripts.
  const PIN_COLORS = [
    "#0069A8",
    "#0E7490",
    "#0F766E",
    "#15803D",
    "#4D7C0F",
    "#A16207",
    "#C2410C",
    "#B91C1C",
    "#BE185D",
    "#7E22CE",
    "#4338CA",
  ];
  const pinColor = (number = 1) => PIN_COLORS[(Math.max(1, Math.trunc(number)) - 1) % PIN_COLORS.length];
  const BUBBLE_BODY = "M2 12C2 6.477 6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10a10 10 0 0 1-4.262-.951l-4.537.93a1 1 0 0 1-1.18-1.18l.93-4.537A10 10 0 0 1 2 12";
  const BUBBLE_DOTS = `${BUBBLE_BODY}m10-4a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2H9a1 1 0 1 1 0-2h2V9a1 1 0 0 1 1-1`;
  const bubbleSvg = ({ className = "", color = MARK, variant = "plain" } = {}) => {
    if (variant === "dots") {
      return `<svg class="${className}" viewBox="1.8 1.8 20.4 20.4" aria-hidden="true"><path fill="${color}" fill-rule="evenodd" clip-rule="evenodd" d="${BUBBLE_DOTS}"/></svg>`;
    }
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path fill="${color}" stroke="#fff" stroke-width="1.15" fill-rule="evenodd" clip-rule="evenodd" d="${BUBBLE_BODY}"/></svg>`;
  };
  const apple = /mac|iphone|ipad|ipod/i.test(
    `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`,
  );
  const sendMod = apple ? "⌘" : "Ctrl";
  const FRAME_ACTIVITY = "pinar:frame-activity";
  const FRAME_CANCEL = "pinar:frame-cancel";
  const FRAME_CLEAR = "pinar:frame-clear";
  const FRAME_HIDE = "pinar:frame-hide";
  const FRAME_PATH_REQUEST = "pinar:frame-path-request";
  const FRAME_PATH_REPLY = "pinar:frame-path-reply";
  const FRAME_RECT_REQUEST = "pinar:frame-rect-request";
  const FRAME_RECT_REPLY = "pinar:frame-rect-reply";
  const FRAME_SEND = "pinar:frame-send";
  const FRAME_SHOW = "pinar:frame-show";
  const isEmbedded = globalThis.top !== globalThis;
  const showToolbar = !isEmbedded;
  const {
    anchorInBox,
    documentBox,
    documentPoint,
    geometryLabel,
    pinDocumentGeometry,
    projectPin,
  } = globalThis.__pinarCoordinateSpace;
  const { joinFrameDomPath, splitFrameDomPath } = globalThis.__pinarFramePath;
  const {
    captureFingerprint,
    isPendingLocation,
    locateResultMeta,
    resolveLocator,
    stableSelector,
  } = globalThis.__pinarLocators;
  const {
    documentBoxes,
    parseExtraKeys,
    scanSensitiveDocuments,
    sanitizeCapture,
  } = globalThis.__pinarPrivacy;
  const {
    handleComposerKeyDown,
    stopComposerKeyboardEvent,
  } = globalThis.__pinarKeyboardEvents;

  const state = {
    active: true,
    batch: { active: false, label: "", shortcut: "" },
    sending: false,
    finishEarly: null,
    reopenAfterSend: false,
    status: null,
    statusTimer: 0,
    pins: [],
    tabPinCount: 0,
    drag: null,
    draft: null,
    hoverPinId: null,
    pointer: null,
    maskMode: false,
    userMasks: [],
    dismissedMaskIds: new Set(),
    reviewMode: false,
    reviewSessionId: null,
    reviews: [],
    repositionPinId: null,
    unavailable: false,
  };

  const selection = {
    current: document.body,
    rememberedChildren: new Map(),
  };

  const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="7.5" stroke="white" stroke-width="2.5"/><circle cx="12" cy="12" r="7.5" stroke="${BLUE}" stroke-width="1.5"/><path d="M12 2V6M12 18V22M2 12H6M18 12H22" stroke="white" stroke-width="2.5" stroke-linecap="round"/><path d="M12 2V6M12 18V22M2 12H6M18 12H22" stroke="${BLUE}" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="${BLUE}" stroke="white" stroke-width="1"/></svg>`;
  const CURSOR_URL = `url("data:image/svg+xml,${encodeURIComponent(CURSOR_SVG)}") 12 12, crosshair`;
  const STYLE_ID = "pinar-global-style";

  function applyGlobalStyles() {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = `
      html[data-pinar-active],
      html[data-pinar-active] * {
        cursor: ${CURSOR_URL} !important;
        -webkit-user-select: none !important;
        user-select: none !important;
      }
    `;
  }

  function removeGlobalStyles() {
    document.getElementById(STYLE_ID)?.remove();
  }

  const host = document.createElement("div");
  host.setAttribute("data-pinar", "host");
  Object.assign(host.style, {
    all: "initial",
    inset: "0",
    pointerEvents: "none",
    position: "fixed",
    zIndex: "2147483646",
  });
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .toolbar, .composer, .preview {
        cursor: default;
        -webkit-user-select: auto;
        user-select: auto;
      }
      .marker, .icon-btn, .btn-cancel, .btn-add {
        cursor: pointer !important;
      }
      .toolbar {
        background: rgba(255,255,255,.96);
        border: 1px solid rgba(15,23,42,.18);
        border-radius: 8px;
        box-shadow: 0 10px 28px rgba(15,23,42,.18), 0 1px 2px rgba(15,23,42,.10);
        box-sizing: border-box;
        color: #262626;
        display: flex;
        align-items: center;
        font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        left: 50%;
        max-width: calc(100vw - 32px);
        min-height: 44px;
        overflow: hidden;
        padding: 7px 14px 7px 12px;
        pointer-events: auto;
        position: fixed;
        top: 16px;
        transform: translateX(-50%);
        transition: opacity 90ms ease;
        white-space: nowrap;
        z-index: 3;
      }
      .toolbar.pass-through { opacity: 0; pointer-events: none; }
      .toast {
        background: rgba(255,255,255,.96);
        border: 1px solid rgba(15,23,42,.18);
        border-radius: 8px;
        box-shadow: 0 8px 20px rgba(15,23,42,.14), 0 1px 2px rgba(15,23,42,.08);
        color: #262626;
        font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        left: 50%;
        padding: 7px 10px;
        pointer-events: none;
        position: fixed;
        top: 68px;
        transform: translateX(-50%);
        white-space: nowrap;
        z-index: 3;
      }
      .toast[hidden] { display: none; }
      .toast[data-kind="error"] { color: #E5484D; }
      .toast[data-kind="ok"] { color: #1F7A4D; }
      .view { align-items: center; display: flex; gap: 12px; min-width: 0; position: relative; z-index: 1; }
      .view[hidden] { display: none !important; }
      .state-icon { display: grid; flex: 0 0 1.25rem; height: 1.25rem; place-items: center; width: 1.25rem; }
      .mark { display: block; height: 1.25rem; width: 1.25rem; }
      .instructions { align-items: center; display: flex; gap: 12px; min-width: 0; overflow: hidden; }
      .hint { align-items: center; display: inline-flex; gap: 5px; }
      .keys { align-items: center; display: inline-flex; gap: 3px; }
      kbd {
        align-items: center;
        background: #FAFAFA;
        border: 1px solid #D7D7D7;
        border-bottom-color: #BEBEBE;
        border-radius: 5px;
        box-shadow: 0 1px 1px rgba(0,0,0,.08);
        box-sizing: border-box;
        color: #333;
        display: inline-flex;
        font: 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        height: 24px;
        justify-content: center;
        min-width: 24px;
        padding: 0 6px;
        text-align: center;
      }
      .hint + .hint::before {
        background: #B7B7B7;
        border-radius: 50%;
        content: "";
        flex: 0 0 3px;
        height: 3px;
        margin-right: 7px;
        width: 3px;
      }
      .short { display: none; }
      /* The bar degrades in stages instead of clipping: first the wording gets
         terse, then the hints leave one by one, least essential first. Batch state
         is never dropped - it is state, not a teaching aid. */
      @media (max-width: 1180px) {
        .long { display: none; }
        .short { display: inline; }
      }
      @media (max-width: 1000px) {
        .hint[data-hint="pin"] { display: none; }
        .hint[data-hint="tune"]::before { display: none; }
      }
      @media (max-width: 860px) { .hint[data-hint="mask"] { display: none; } }
      @media (max-width: 760px) {
        .hint[data-hint="tune"] { display: none; }
        .hint[data-hint="copy"]::before { display: none; }
      }
      @media (max-width: 660px) { .hint[data-hint="clear"] { display: none; } }
      .status { color: #262626; font-weight: 500; }
      .status[data-kind="error"] { color: #E5484D; }
      .status[data-kind="ok"] { color: #1F7A4D; }
      .icon-btn {
        align-items: center;
        background: transparent;
        border: 0;
        border-radius: 6px;
        box-sizing: border-box;
        color: #737373;
        display: none;
        flex: 0 0 32px;
        height: 32px;
        justify-content: center;
        padding: 0;
        width: 32px;
      }
      .icon-btn.is-ready { display: inline-flex; }
      .icon-btn svg { display: block; height: 20px; width: 20px; }
      .icon-btn:hover { background: #F4F4F5; color: #262626; }
      .outline {
        background: rgba(87,148,255,.055);
        border: 2px solid ${BLUE};
        box-sizing: border-box;
        display: none;
        pointer-events: none;
        position: fixed;
        transition: left 35ms linear, top 35ms linear, width 35ms linear, height 35ms linear;
        z-index: 1;
      }
      .outline.area {
        background: rgba(87,148,255,.10);
        border: 2px dashed ${BLUE};
        box-shadow: 0 0 0 1px rgba(255,255,255,.5), inset 0 0 0 1px rgba(255,255,255,.3);
      }
      .outline.is-dragging {
        transition: none !important;
      }
      .outline-badge {
        align-items: center;
        background: var(--outline-color, ${BLUE});
        backdrop-filter: blur(4px);
        border-radius: 4px;
        bottom: -24px;
        color: #fff;
        display: none;
        font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 3px 6px;
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        white-space: nowrap;
      }
      .outline.show-geometry .outline-badge {
        display: inline-flex;
      }
      .outline.badge-above .outline-badge {
        bottom: 6px;
        top: auto;
      }
      .marker {
        background: transparent;
        border: 0;
        height: 28px;
        padding: 0;
        pointer-events: auto;
        position: fixed;
        transform: translate(-50%, -92%);
        width: 28px;
        z-index: 2;
      }
      .marker.is-pending svg {
        filter: drop-shadow(0 0 0 2px #fff) drop-shadow(0 0 0 3px #C2410C) drop-shadow(0 1px 2px rgba(15, 23, 42, 0.45));
      }
      .marker svg {
        display: block;
        filter: drop-shadow(0 1px 2px rgba(15, 23, 42, 0.45));
        height: 28px;
        width: 28px;
      }
      .marker-n {
        color: #fff;
        font: 700 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        left: 0;
        pointer-events: none;
        position: absolute;
        right: 0;
        text-align: center;
        top: 46%;
        transform: translateY(-55%);
      }
      .preview {
        align-items: center;
        background: #fff;
        border: 1px solid rgba(15,23,42,.14);
        border-radius: 8px;
        box-shadow: 0 8px 24px rgba(15,23,42,.14);
        display: none;
        font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        gap: 10px;
        max-width: 280px;
        padding: 6px 14px 6px 8px;
        pointer-events: none;
        position: fixed;
        z-index: 4;
      }
      .preview.is-open { display: flex; }
      .preview-n {
        align-items: center;
        background: ${MARK};
        border-radius: 999px;
        color: #fff;
        display: inline-flex;
        flex: 0 0 28px;
        font: 700 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        height: 28px;
        justify-content: center;
        width: 28px;
      }
      .preview-text {
        color: #111;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
        /* The batch reads as one more hint: same colour, same separator. Its state
         is the wording, not decoration - "Batch off" versus a live count. It only
         differs in living outside .instructions, so the hints clip before it. */
      .batch-pill {
        align-items: center;
        display: inline-flex;
        flex: 0 0 auto;
        gap: 5px;
        white-space: nowrap;
      }
      .batch-pill::before {
        background: #B7B7B7;
        border-radius: 50%;
        content: "";
        flex: 0 0 3px;
        height: 3px;
        margin-right: 7px;
        width: 3px;
      }
      .composer {
        background: transparent;
        display: none;
        font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        pointer-events: auto;
        position: fixed;
        z-index: 4;
      }
      .composer.is-open { display: block; }
      .composer-card {
        background: #fff;
        border: 1px solid rgba(15,23,42,.14);
        border-radius: 8px;
        box-shadow: 0 12px 32px rgba(15,23,42,.16);
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 260px;
        padding: 10px 10px 8px;
        width: 280px;
      }
      .composer-target {
        align-items: center;
        align-self: flex-start;
        background: #F4F4F5;
        border: 1px solid #E4E4E7;
        border-radius: 6px;
        color: #525252;
        display: inline-flex;
        font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        padding: 5px 8px;
      }
      .composer-target[hidden] { display: none; }
      .composer textarea {
        border: 0;
        box-sizing: border-box;
        color: #111;
        display: block;
        font: 14px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        min-height: 24px;
        outline: none;
        overflow: hidden;
        padding: 4px 4px 2px;
        resize: none;
        width: 100%;
      }
      .composer-actions {
        align-items: center;
        display: flex;
        gap: 8px;
        justify-content: flex-end;
        padding: 0;
      }
      .composer-actions .icon-btn { display: inline-flex; margin-right: auto; }
      .btn-cancel, .btn-add {
        border: 0;
        border-radius: 6px;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        height: 32px;
        padding: 0 14px;
      }
      .btn-cancel { background: #f4f4f5; color: #111; }
      .btn-add { background: ${MARK}; color: #fff; }
      .privacy-mask {
        background: rgba(17, 24, 39, 0.72);
        border: 2px solid #111827;
        box-sizing: border-box;
        cursor: pointer !important;
        pointer-events: auto;
        position: fixed;
        z-index: 1;
      }
      .privacy-mask[data-source="user"] { border-style: dashed; }
      .privacy-mask-label {
        color: #fff;
        font: 600 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        left: 6px;
        letter-spacing: 0.02em;
        position: absolute;
        text-transform: uppercase;
        top: 6px;
      }
      html[data-pinar-mask-mode] .outline.area {
        background: rgba(17, 24, 39, 0.28);
        border: 2px dashed #111827;
      }
    </style>
    ${showToolbar ? `
    <div class="toolbar">
      <div class="view online-view" data-ref="onlineView">
        <span class="state-icon" aria-hidden="true">
          ${bubbleSvg({ className: "mark", variant: "dots" })}
        </span>
        <span class="instructions" data-ref="instructions">
          <span class="hint" data-hint="pin">Click or drag to pin</span>
          <span class="hint" data-hint="tune"><span class="keys"><kbd>↑</kbd><kbd>↓</kbd></span><span class="long">to fine-tune selection</span><span class="short">Fine-tune</span></span>
          <span class="hint" data-hint="copy"><span class="keys"><kbd>${sendMod}</kbd><kbd>↵</kbd></span><span class="long">to copy</span><span class="short">Copy</span></span>
          <span class="hint" data-hint="mask"><span class="keys"><kbd>M</kbd></span><span class="long">hide region</span><span class="short">Hide</span></span>
          <span class="hint" data-hint="clear"><span class="keys"><kbd>esc</kbd></span><span class="long">to clear</span><span class="short">Clear</span></span>
        </span>
        <span class="status" data-ref="toolbarStatus" hidden></span>
        <span class="batch-pill" data-ref="batchPill">
          <kbd data-ref="batchPillKey" hidden></kbd>
          <span data-ref="batchPillText"></span>
        </span>
      </div>
    </div>
    <div class="toast" data-ref="toast" role="status" aria-live="polite" hidden></div>` : ""}
    <div class="outline" data-ref="outline"><span class="outline-badge" data-ref="outlineBadge"></span></div>
    <div data-ref="layer"></div>
    <div class="preview" data-ref="preview" hidden>
      <span class="preview-n" data-ref="previewN">1</span>
      <span class="preview-text" data-ref="previewText"></span>
    </div>
    <div class="composer" data-ref="composer" hidden>
      <div class="composer-card">
        <span class="composer-target" data-ref="selectionTag" hidden></span>
        <textarea data-ref="input" rows="1" placeholder="Comment"></textarea>
        <div class="composer-actions">
          <button type="button" class="icon-btn is-ready" data-ref="deleteDraft" title="Delete" aria-label="Delete">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 11v6m-4-6v6M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M4 7h16M7 7l2-4h6l2 4"/>
            </svg>
          </button>
          <button type="button" class="btn-cancel" data-ref="cancel">Cancel</button>
          <button type="button" class="btn-add" data-ref="save">Add</button>
        </div>
      </div>
    </div>
  `;

  const ui = {
    cancel: shadow.querySelector("[data-ref=cancel]"),
    composer: shadow.querySelector("[data-ref=composer]"),
    deleteDraft: shadow.querySelector("[data-ref=deleteDraft]"),
    input: shadow.querySelector("[data-ref=input]"),
    instructions: shadow.querySelector("[data-ref=instructions]"),
    layer: shadow.querySelector("[data-ref=layer]"),
    outline: shadow.querySelector("[data-ref=outline]"),
    outlineBadge: shadow.querySelector("[data-ref=outlineBadge]"),
    preview: shadow.querySelector("[data-ref=preview]"),
    previewN: shadow.querySelector("[data-ref=previewN]"),
    previewText: shadow.querySelector("[data-ref=previewText]"),
    save: shadow.querySelector("[data-ref=save]"),
    selectionTag: shadow.querySelector("[data-ref=selectionTag]"),
    toast: shadow.querySelector("[data-ref=toast]"),
    toolbar: shadow.querySelector(".toolbar"),
    toolbarStatus: shadow.querySelector("[data-ref=toolbarStatus]"),
    batchPill: shadow.querySelector("[data-ref=batchPill]"),
    batchPillKey: shadow.querySelector("[data-ref=batchPillKey]"),
    batchPillText: shadow.querySelector("[data-ref=batchPillText]"),
  };

  document.documentElement.append(host);

  // Interactions with our own UI (composer, toolbar) must not bubble into the
  // page: dismiss layers treat target=host as an "outside" press and close
  // their dialogs. Our listeners live inside the shadow root, below the host,
  // so they run before these stoppers.
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick"]) {
    host.addEventListener(type, (event) => event.stopPropagation());
  }

  function isHostNode(node) {
    return node === host || host.contains(node);
  }

  function setHoveredTarget(target) {
    if (!target || isHostNode(target) || target === document.documentElement) return selection.current;
    selection.current = target;
    return selection.current;
  }

  function selectParent() {
    const parent = selection.current?.parentElement;
    if (!parent || parent === document.documentElement || isHostNode(parent)) return selection.current;
    selection.rememberedChildren.set(parent, selection.current);
    selection.current = parent;
    return selection.current;
  }

  function selectChild() {
    if (!selection.current) return null;
    const remembered = selection.rememberedChildren.get(selection.current);
    const child = remembered?.parentElement === selection.current
      ? remembered
      : selection.current.firstElementChild;
    if (child && !isHostNode(child)) selection.current = child;
    return selection.current;
  }

  function pageMetaContent(selectors) {
    for (const selector of selectors) {
      const value = document.querySelector(selector)?.getAttribute("content")?.trim();
      if (value) return value;
    }
    return "";
  }

  function pageContext() {
    const description = pageMetaContent([
      'meta[name="description"]',
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
    ]);
    const title = pageMetaContent(['meta[property="og:title"]', 'meta[name="twitter:title"]'])
      || (document.title || "").trim();
    return {
      ...(description ? { description } : {}),
      title,
      url: location.href,
      viewport: {
        dpr: window.devicePixelRatio || 1,
        height: window.innerHeight,
        width: window.innerWidth,
      },
    };
  }

  function currentScroll() {
    return {
      x: window.scrollX,
      y: window.scrollY,
    };
  }

  function pageMetrics() {
    const root = document.documentElement;
    const body = document.body;
    return {
      documentHeight: Math.max(
        window.innerHeight,
        root.scrollHeight,
        root.offsetHeight,
        body?.scrollHeight ?? 0,
        body?.offsetHeight ?? 0,
      ),
      documentWidth: Math.max(
        window.innerWidth,
        root.scrollWidth,
        root.offsetWidth,
        body?.scrollWidth ?? 0,
        body?.offsetWidth ?? 0,
      ),
      originalScroll: currentScroll(),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
    };
  }

  function waitForCapturePaint(delay = 80) {
    return new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, delay)));
    });
  }

  async function prepareCapture(startY) {
    await restoreCapture();
    const root = document.documentElement;
    const originalRootStyle = root.getAttribute("style");
    const originalScroll = currentScroll();
    root.style.setProperty("scroll-behavior", "auto", "important");
    window.scrollTo(0, startY);
    await waitForCapturePaint();

    const positioned = [];
    for (const element of document.querySelectorAll("body *")) {
      if (isHostNode(element)) continue;
      const position = getComputedStyle(element).position;
      if (position !== "fixed" && position !== "sticky") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 && rect.height <= 0) continue;
      positioned.push({ element, style: element.getAttribute("style") });
      if (position === "fixed") {
        element.style.setProperty("position", "absolute", "important");
        element.style.setProperty("inset", "auto", "important");
        // Fixed dialogs are commonly centered with translate/transform. Once
        // their measured rect becomes the absolute top/left, those transforms
        // must be neutralized or the screenshot applies the offset twice.
        element.style.setProperty("transform", "none", "important");
        element.style.setProperty("translate", "none", "important");
        element.style.setProperty("scale", "none", "important");
        element.style.setProperty("rotate", "none", "important");
        element.style.setProperty("top", `${rect.top + window.scrollY}px`, "important");
        element.style.setProperty("left", `${rect.left + window.scrollX}px`, "important");
        element.style.setProperty("width", `${rect.width}px`, "important");
        element.style.setProperty("height", `${rect.height}px`, "important");
        element.style.setProperty("margin", "0", "important");
      } else {
        element.style.setProperty("position", "relative", "important");
        element.style.setProperty("inset", "auto", "important");
      }
    }

    globalThis.__pinarCaptureState = { originalRootStyle, originalScroll, positioned };
    window.scrollTo(0, startY);
    await waitForCapturePaint();
    return pageMetrics();
  }

  async function scrollCapture(scrollY) {
    window.scrollTo(0, scrollY);
    await waitForCapturePaint(120);
    return currentScroll();
  }

  async function restoreCapture() {
    const capture = globalThis.__pinarCaptureState;
    if (!capture) return;
    for (const { element, style } of capture.positioned) {
      if (!element.isConnected) continue;
      if (style == null) element.removeAttribute("style");
      else element.setAttribute("style", style);
    }
    if (capture.originalRootStyle == null) document.documentElement.removeAttribute("style");
    else document.documentElement.setAttribute("style", capture.originalRootStyle);
    window.scrollTo(capture.originalScroll.x, capture.originalScroll.y);
    delete globalThis.__pinarCaptureState;
    await waitForCapturePaint(0);
  }

  function locatePin(pin) {
    pin = freezeHistorical(pin);
    if (pin.location?.evidence?.includes("manual-reposition")) {
      return { ...pin, location: pin.location };
    }
    if (pin.kind !== "element") {
      return { ...projectPin(pin, currentScroll()), location: pin.location };
    }
    const localPath = splitFrameDomPath(pin.path || "").at(-1) || pin.path;
    const result = resolveLocator(document, {
      cssSelector: pin.selector,
      domPath: localPath,
      fingerprint: pin.fingerprint,
      geometry: pin.historicalBox || pin.box ? { box: pin.historicalBox || pin.box } : undefined,
      innerText: pin.text,
      kind: pin.kind,
      tag: pin.tag,
    });
    const location = locateResultMeta(result);
    if (result.element && (location.confidence === "exact" || location.confidence === "probable")) {
      const box = boxOf(result.element);
      return {
        ...pin,
        anchor: anchorInBox(pin, box),
        box,
        location,
      };
    }
    return { ...projectPin(pin, currentScroll()), location };
  }

  function freezeHistorical(pin) {
    if (!state.reviewMode) return pin;
    return {
      ...pin,
      historicalAnchor: pin.historicalAnchor || pin.anchor,
      historicalBox: pin.historicalBox || pin.box,
    };
  }

  function reviewStatusFor(pin) {
    const pinId = pin.id || pin.pinId;
    const review = state.reviews.find((item) => item.pinId === pinId);
    return review?.status || (state.reviewMode ? "open" : "");
  }

  function viewportPin(pin) {
    if (pin.kind === "element") return locatePin(pin);
    return projectPin(pin, currentScroll());
  }

  function cssPath(element) {
    if (element.id) return `#${CSS.escape(element.id)}`;
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      if (node.id) {
        parts[0] = `#${CSS.escape(node.id)}`;
        break;
      }
      node = node.parentElement;
    }
    return parts.length ? parts.join(" > ") : "body";
  }

  function treePath(element) {
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && parts.length < 12) {
      let part = node.tagName.toLowerCase();
      if (node.id) part += `#${CSS.escape(node.id)}`;
      else {
        const testId = node.getAttribute("data-testid") || node.getAttribute("data-test");
        if (testId) part += `[data-testid=${JSON.stringify(testId)}]`;
        else if (node.classList.length) {
          part += `.${[...node.classList].slice(0, 2).map((name) => CSS.escape(name)).join(".")}`;
        }
      }
      parts.unshift(part);
      if (node === document.body || node === document.documentElement) break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  function labelFor(element) {
    return (
      element.getAttribute("aria-label") ||
      element.getAttribute("name") ||
      element.id ||
      element.tagName.toLowerCase()
    );
  }

  function visibleText(element) {
    return (element.innerText || "").replace(/\s+/g, " ").trim().slice(0, 160);
  }

  function boxOf(element) {
    const rect = element.getBoundingClientRect();
    return {
      height: Math.max(1, Math.round(rect.height)),
      width: Math.max(1, Math.round(rect.width)),
      x: Math.round(rect.left),
      y: Math.round(rect.top),
    };
  }

  function requestTopOffset() {
    return new Promise((resolve) => {
      if (!isEmbedded) {
        resolve({ offset: { x: 0, y: 0 }, topScroll: currentScroll() });
        return;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        window.removeEventListener("message", onReply);
        resolve({ offset: { x: 0, y: 0 }, topScroll: { x: 0, y: 0 } });
      }, 200);
      function onReply(event) {
        if (event.data?.type !== FRAME_RECT_REPLY || event.data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onReply);
        resolve({
          offset: event.data.offset ?? { x: 0, y: 0 },
          topScroll: event.data.topScroll ?? { x: 0, y: 0 },
        });
      }
      window.addEventListener("message", onReply);
      window.parent.postMessage({ id, type: FRAME_RECT_REQUEST }, "*");
    });
  }

  function requestFramePaths() {
    return new Promise((resolve) => {
      if (!isEmbedded) {
        resolve([]);
        return;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        window.removeEventListener("message", onReply);
        resolve([]);
      }, 400);
      function onReply(event) {
        if (event.data?.type !== FRAME_PATH_REPLY || event.data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onReply);
        resolve(Array.isArray(event.data.paths) ? event.data.paths : []);
      }
      window.addEventListener("message", onReply);
      window.parent.postMessage({ id, type: FRAME_PATH_REQUEST }, "*");
    });
  }

  function fromUi(event) {
    if (ui.toolbar?.classList.contains("pass-through")) return false;
    return event.composedPath().some((node) => node === host);
  }

  function targetFromPoint(x, y) {
    const stack = document.elementsFromPoint(x, y);
    return stack.find((node) => !isHostNode(node) && node.tagName !== "HTML" && !node.matches?.("iframe,frame")) ?? null;
  }

  function renderChrome() {
    const selectedTag = state.draft?.kind === "element" ? state.draft.tag : "";
    if (ui.selectionTag) {
      ui.selectionTag.hidden = !selectedTag;
      ui.selectionTag.textContent = selectedTag ? `<${selectedTag}>` : "";
    }
    if (!ui.toolbar) return;
    const hasStatus = Boolean(state.status);
    if (ui.instructions) ui.instructions.hidden = state.reviewMode;
    if (ui.toast) {
      ui.toast.hidden = !hasStatus;
      ui.toast.textContent = state.status?.text ?? "";
      ui.toast.dataset.kind = state.status?.kind ?? "";
    }
    if (ui.toolbarStatus) {
      // Review owns this slot; the batch pill has its own so one never hides the other.
      const banner = state.reviewMode ? reviewBannerText() : "";
      ui.toolbarStatus.hidden = !banner;
      ui.toolbarStatus.textContent = banner;
      ui.toolbarStatus.dataset.kind = state.reviewMode && state.unavailable ? "error" : "info";
    }
    if (ui.batchPill) {
      ui.batchPillText.textContent = state.batch.label;
      ui.batchPillKey.textContent = state.batch.shortcut;
      ui.batchPillKey.hidden = !state.batch.shortcut;
    }
    document.documentElement.toggleAttribute("data-pinar-mask-mode", state.maskMode);
    document.documentElement.toggleAttribute("data-pinar-review", state.reviewMode);
  }

  function reviewBannerText() {
    if (state.unavailable) return "Original page is unavailable";
    if (state.repositionPinId) return "Click the correct element to place this pin";
    return "Reviewing saved session · pending pins need a manual place";
  }

  function setStatus(text, kind = "info") {
    clearTimeout(state.statusTimer);
    state.status = text ? { kind, text } : null;
    renderChrome();
  }

  function flashStatus(text, kind = "error") {
    setStatus(text, kind);
    state.statusTimer = setTimeout(() => {
      state.status = null;
      renderChrome();
    }, 1800);
  }

  // The batch lives in the service worker; the overlay mirrors it. Pull once on
  // mount, then rely on the batch:changed push so the pill cannot go stale when
  // the batch moves from the menu, the shortcut or another tab.
  function applyBatchState(next) {
    state.batch = {
      active: Boolean(next?.active),
      label: next?.label || "",
      shortcut: next?.shortcut || "",
    };
    renderChrome();
    if (next?.toast) flashStatus(next.toast, "ok");
  }

  async function syncBatchLabel() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "batch:get" });
      applyBatchState(response?.ok ? response : null);
    } catch {
      applyBatchState(null);
    }
  }

  function hideOutline() {
    ui.outline.style.display = "none";
  }

  function colorWithAlpha(color, alpha) {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return `rgba(87, 148, 255, ${alpha})`;
    const value = Number.parseInt(color.slice(1), 16);
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
  }

  function showOutline(box, area = false, dragging = false, color = BLUE, showGeometry = false) {
    ui.outline.classList.toggle("area", area);
    ui.outline.classList.toggle("is-dragging", dragging);
    ui.outline.classList.toggle("show-geometry", showGeometry);
    ui.outline.classList.toggle("badge-above", box.y + box.height + 32 > innerHeight);
    Object.assign(ui.outline.style, {
      display: "block",
      background: colorWithAlpha(color, area ? 0.1 : 0.055),
      borderColor: color,
      "--outline-color": color,
      height: `${box.height}px`,
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.width}px`,
    });
    if (ui.outlineBadge) {
      ui.outlineBadge.textContent = geometryLabel(box);
    }
  }

  function canSelect() {
    return state.active && !state.unavailable && (!state.reviewMode || Boolean(state.repositionPinId));
  }

  function updateOutline() {
    if (!canSelect()) {
      hideOutline();
      return;
    }
    if (state.drag) {
      showOutline(
        normBox(state.drag),
        true,
        true,
        state.maskMode ? "#111827" : pinColor(state.pins.length + 1),
        true,
      );
      return;
    }
    if (state.draft) {
      const draft = viewportPin(state.draft);
      showOutline(
        draft.box,
        draft.kind === "area",
        false,
        draft.color || pinColor(state.pins.length + 1),
        true,
      );
      return;
    }
    if (state.hoverPinId) {
      const pin = state.pins.find((item) => item.id === state.hoverPinId);
      if (pin?.box) {
        const visiblePin = viewportPin(pin);
        showOutline(visiblePin.box, pin.kind === "area", false, pin.color || pinColor(state.pins.indexOf(pin) + 1));
        return;
      }
    }
    if (selection.current && state.active) {
      showOutline(boxOf(selection.current), false, false, BLUE, true);
      return;
    }
    hideOutline();
  }

  function pinPoint(pin) {
    if (pin.anchor) return pin.anchor;
    return {
      x: pin.box.x + pin.box.width / 2,
      y: pin.box.y + pin.box.height / 2,
    };
  }

  function markerHtml(point, index, pinId, color = pinColor(index + 1), location, reviewStatus) {
    const body = `${bubbleSvg({ color })}<span class="marker-n">${index + 1}</span>`;
    const pending = isPendingLocation(location);
    const confidence = location?.confidence ? ` data-location-confidence="${escapeAttr(location.confidence)}"` : "";
    const review = reviewStatus ? ` data-review-status="${escapeAttr(reviewStatus)}"` : "";
    const cls = pending ? "marker is-pending" : "marker";
    if (pinId) {
      return `<button type="button" class="${cls}" data-pin="${pinId}"${confidence}${review} style="left:${point.x}px;top:${point.y}px">${body}</button>`;
    }
    return `<span class="${cls}" data-draft="1"${confidence} style="left:${point.x}px;top:${point.y}px">${body}</span>`;
  }

  function renderMarkers() {
    const scroll = currentScroll();
    const masks = activeMaskRegions().map((mask) => {
      const box = {
        height: mask.box.height,
        width: mask.box.width,
        x: mask.box.x - scroll.x,
        y: mask.box.y - scroll.y,
      };
      const label = mask.unevaluated ? "Can't inspect" : "Hidden";
      return `<button type="button" class="privacy-mask" data-privacy-mask="${escapeAttr(mask.id)}" data-source="${mask.source}" style="left:${box.x}px;top:${box.y}px;width:${box.width}px;height:${box.height}px"><span class="privacy-mask-label">${label}</span></button>`;
    });
    const markers = state.pins.map((pin, index) => {
      const visible = viewportPin(pin);
      return markerHtml(
        pinPoint(visible),
        index,
        pin.id,
        pin.color,
        visible.location,
        reviewStatusFor(pin),
      );
    });
    if (state.draft && !state.draft.editId) {
      const visible = viewportPin(state.draft);
      markers.push(markerHtml(pinPoint(visible), state.pins.length, undefined, state.draft.color, visible.location));
    }
    ui.layer.innerHTML = `${masks.join("")}${markers.join("")}`;
    placeComposer();
    placePreview();
  }

  function activeScan() {
    const scan = scanSensitiveDocuments();
    const pinsUnevaluated = state.pins.some((pin) => pin.location?.warning === "cross-origin-frame");
    return {
      ...scan,
      unevaluated: scan.unevaluated || pinsUnevaluated,
    };
  }

  function activeMaskRegions() {
    const scan = activeScan();
    const auto = documentBoxes(
      scan.masks.filter((mask) => !state.dismissedMaskIds.has(mask.id)),
      currentScroll(),
    );
    return [...auto, ...state.userMasks];
  }

  function addUserMask(box) {
    const scroll = currentScroll();
    state.userMasks = [
      ...state.userMasks,
      {
        box: {
          height: box.height,
          width: box.width,
          x: box.x + scroll.x,
          y: box.y + scroll.y,
        },
        category: "manual",
        id: `user:${crypto.randomUUID()}`,
        source: "user",
      },
    ];
    renderMarkers();
    flashStatus("Region hidden · click the mask to restore", "ok");
  }

  function removeMask(id) {
    if (!id) return;
    if (id.startsWith("user:")) {
      state.userMasks = state.userMasks.filter((mask) => mask.id !== id);
    } else {
      state.dismissedMaskIds.add(id);
    }
    renderMarkers();
  }

  function toggleMaskMode() {
    if (state.draft) return;
    state.maskMode = !state.maskMode;
    renderChrome();
    flashStatus(state.maskMode ? "Drag to hide a region · click a mask to restore" : "Pin mode", "ok");
  }

  function escapeAttr(value) {
    return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  }

  function normBox(drag) {
    const x = Math.min(drag.x0, drag.x1);
    const y = Math.min(drag.y0, drag.y1);
    return {
      height: Math.max(1, Math.abs(drag.y1 - drag.y0)),
      width: Math.max(1, Math.abs(drag.x1 - drag.x0)),
      x,
      y,
    };
  }

  function pinAnchor(pin) {
    const point = pinPoint(viewportPin(pin));
    return {
      left: Math.min(window.innerWidth - 340, Math.max(8, point.x + 28)),
      top: Math.min(window.innerHeight - 180, Math.max(56, point.y - 8)),
    };
  }

  function placePreview() {
    const pin = state.pins.find((item) => item.id === state.hoverPinId);
    if (!pin || state.draft) {
      ui.preview.hidden = true;
      ui.preview.classList.remove("is-open");
      return;
    }
    const index = state.pins.indexOf(pin);
    const pos = pinAnchor(pin);
    ui.previewN.textContent = String(index + 1);
    ui.previewN.style.background = pin.color || pinColor(index + 1);
    ui.previewText.textContent = pin.comment.replaceAll("\n", " ");
    const visible = viewportPin(pin);
    const bits = [];
    if (state.reviewMode) bits.push(reviewStatusFor(pin) || "open");
    if (visible.location?.confidence) bits.push(visible.location.confidence);
    if (isPendingLocation(visible.location)) bits.push("Needs review");
    if (bits.length) ui.previewText.textContent = `${ui.previewText.textContent} · ${bits.join(" · ")}`;
    ui.preview.style.left = `${pos.left}px`;
    ui.preview.style.top = `${pos.top}px`;
    ui.preview.hidden = false;
    ui.preview.classList.add("is-open");
  }

  function placeComposer() {
    if (!state.draft) {
      ui.composer.hidden = true;
      ui.composer.classList.remove("is-open");
      return;
    }
    const pos = pinAnchor(state.draft);
    ui.composer.style.left = `${pos.left}px`;
    ui.composer.style.top = `${pos.top}px`;
    ui.composer.hidden = false;
    ui.composer.classList.add("is-open");
  }

  let composerFocusRetryTimer = 0;
  let composerFocusRetries = 0;
  let claimingComposerFocus = false;

  function claimComposerFocus() {
    if (!state.draft) return;
    // Guard against synchronous recursion: focus() dispatches focus events,
    // and an aggressive page trap stealing focus inside that dispatch would
    // re-enter through keepComposerFocus.
    claimingComposerFocus = true;
    try {
      ui.input.focus({ preventScroll: true });
    } finally {
      claimingComposerFocus = false;
    }
    if (shadow.activeElement === ui.input) {
      composerFocusRetries = 0;
      return;
    }
    // Focus refused or synchronously stolen by a page focus trap; retry a few
    // times, then surrender instead of fighting the page forever.
    if (composerFocusRetries >= 5) return;
    composerFocusRetries += 1;
    clearTimeout(composerFocusRetryTimer);
    composerFocusRetryTimer = setTimeout(claimComposerFocus, 100);
  }

  function openDraft(draft) {
    if (!canSelect()) return;
    state.hoverPinId = null;
    state.draft = draft;
    ui.input.value = draft.comment ?? "";
    renderChrome();
    updateOutline();
    renderMarkers();
    fitInput();
    composerFocusRetries = 0;
    queueMicrotask(() => {
      fitInput();
      claimComposerFocus();
      ui.input.setSelectionRange(ui.input.value.length, ui.input.value.length);
    });
  }

  function keepComposerFocus(event) {
    if (!state.draft) return;
    event.stopImmediatePropagation();
    if (claimingComposerFocus || event.composedPath().includes(host)) return;
    // The page moved focus elsewhere while the composer is open; pull it back.
    claimComposerFocus();
  }

  function shieldComposerFocusOut(event) {
    if (!state.draft) return;
    // Hide the handoff from page focus traps: when focus moves into our
    // composer, the page must not see its own element losing focus, or traps
    // (e.g. dialog focus locks) immediately steal focus back.
    const related = event.relatedTarget;
    if (related === host || host.contains(related)) event.stopImmediatePropagation();
  }

  function openPinEditor(id) {
    const pin = state.pins.find((item) => item.id === id);
    if (!pin) return;
    openDraft({ ...pin, editId: pin.id });
  }

  function saveDraft() {
    if (!state.draft) return true;
    const comment = ui.input.value.trim();
    if (!comment) {
      ui.input.focus();
      return false;
    }
    if (state.draft.editId) {
      const pin = state.pins.find((item) => item.id === state.draft.editId);
      if (pin) pin.comment = comment;
    } else {
      state.pins.push({
        ...state.draft,
        color: state.draft.color || pinColor(state.pins.length + 1),
        comment,
        id: crypto.randomUUID(),
      });
    }
    state.draft = null;
    renderChrome();
    void syncPins();
    updateOutline();
    renderMarkers();
    return true;
  }

  function deleteDraft() {
    if (state.draft?.editId) {
      state.pins = state.pins.filter((pin) => pin.id !== state.draft.editId);
      void syncPins();
    }
    cancelDraft();
  }

  async function syncPins() {
    const { offset, topScroll } = await requestTopOffset();
    const pins = state.pins.map((pin) => {
      if (isEmbedded) {
        const visiblePin = viewportPin(pin);
        return {
          ...visiblePin,
          scroll: { x: 0, y: 0 },
          topBox: {
            ...visiblePin.box,
            x: visiblePin.box.x + offset.x + topScroll.x,
            y: visiblePin.box.y + offset.y + topScroll.y,
          },
        };
      }

      let liveBox;
      let working = freezeHistorical(pin);
      if (working.kind === "element" && !working.viewportAnchored) {
        const located = locatePin(working);
        working = {
          ...working,
          historicalAnchor: located.historicalAnchor,
          historicalBox: located.historicalBox,
          location: located.location,
        };
        if (located.location?.confidence === "exact" || located.location?.confidence === "probable") {
          liveBox = located.box;
        }
      }
      const geometry = pinDocumentGeometry(working, currentScroll(), liveBox);
      return {
        ...working,
        anchor: geometry.anchor,
        box: geometry.box,
        historicalAnchor: working.historicalAnchor,
        historicalBox: working.historicalBox,
        scroll: { x: 0, y: 0 },
        topBox: geometry.box,
      };
    });
    const response = await chrome.runtime.sendMessage({
      pins,
      sessionId: state.reviewSessionId || undefined,
      type: "pins:sync",
    }).catch(() => null);
    const synced = response?.ok === true;
    if (synced) {
      const colorsById = new Map(response.pins.map((pin) => [pin.id, pin.color]));
      state.pins = state.pins.map((pin) => ({ ...pin, color: colorsById.get(pin.id) || pin.color }));
      state.tabPinCount = response.pins.length;
    }
    renderChrome();
    renderMarkers();
    return synced;
  }

  function cancelDraft() {
    state.draft = null;
    renderChrome();
    updateOutline();
    renderMarkers();
  }

  function resetLocalPins() {
    state.pins = [];
    state.draft = null;
    state.tabPinCount = 0;
    state.hoverPinId = null;
    state.maskMode = false;
    state.userMasks = [];
    state.dismissedMaskIds = new Set();
    state.reviewMode = false;
    state.reviewSessionId = null;
    state.reviews = [];
    state.repositionPinId = null;
    state.unavailable = false;
    renderChrome();
    updateOutline();
    renderMarkers();
  }

  async function clearPins() {
    resetLocalPins();
    await chrome.runtime.sendMessage({ type: "pins:clear" }).catch(() => null);
  }

  async function discardAnnotations() {
    await clearPins();
    broadcast(FRAME_CLEAR);
  }

  function broadcastToChildFrames(type) {
    for (let index = 0; index < window.frames.length; index += 1) {
      window.frames[index].postMessage({ type }, "*");
    }
  }

  function broadcast(type) {
    if (isEmbedded) window.top.postMessage({ type }, "*");
    else broadcastToChildFrames(type);
  }

  function dismiss() {
    resetLocalPins();
    setVisible(false);
  }

  function isMounted() {
    return host.isConnected;
  }

  function activateFrame() {
    if (isEmbedded) window.top.postMessage({ type: FRAME_ACTIVITY }, "*");
  }

  function onPointerMove(event) {
    if (!isMounted() || !state.active) return;
    state.pointer = { x: event.clientX, y: event.clientY };
    activateFrame();
    if (!canSelect()) {
      hideOutline();
      return;
    }
    if (ui.toolbar) {
      const rect = ui.toolbar.getBoundingClientRect();
      const overToolbar = event.clientX >= rect.left && event.clientX <= rect.right
        && event.clientY >= rect.top && event.clientY <= rect.bottom;
      ui.toolbar.classList.toggle("pass-through", overToolbar && !state.draft);
    }
    if (state.drag) {
      state.drag.x1 = event.clientX;
      state.drag.y1 = event.clientY;
      if (Math.hypot(state.drag.x1 - state.drag.x0, state.drag.y1 - state.drag.y0) > DRAG_THRESHOLD) {
        state.drag.moved = true;
      }
      updateOutline();
      return;
    }
    if (state.draft) return;
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    if (hit?.matches?.("iframe,frame")) {
      hideOutline();
      return;
    }
    const target = targetFromPoint(event.clientX, event.clientY);
    if (target) setHoveredTarget(target);
    updateOutline();
  }

  function onPointerDown(event) {
    if (!isMounted()) return;
    // Page apps must not react to pointer input while pin mode is active —
    // e.g. dialogs dismiss on "outside" presses because the event target is
    // our overlay, not the dialog subtree.
    if (state.active && !fromUi(event)) event.stopImmediatePropagation();
    if (!canSelect() || event.button !== 0 || fromUi(event) || state.draft) return;
    if (document.elementFromPoint(event.clientX, event.clientY)?.matches?.("iframe,frame")) return;
    state.drag = { moved: false, x0: event.clientX, x1: event.clientX, y0: event.clientY, y1: event.clientY };
    event.preventDefault();
  }

  async function openAreaDraft(box, anchorPoint) {
    const anchor = anchorPoint ?? { x: box.x, y: box.y };
    const scroll = currentScroll();
    openDraft({
      anchor,
      box,
      documentAnchor: documentPoint(anchor, scroll),
      documentBox: documentBox(box, scroll),
      kind: "area",
      label: `selected area (${box.width}×${box.height}px)`,
      scroll,
    });
  }

  function onPointerUp(event) {
    if (!isMounted()) return;
    if (state.active && !fromUi(event)) event.stopImmediatePropagation();
    if (!state.drag) return;
    if (!canSelect()) {
      state.drag = null;
      hideOutline();
      return;
    }
    const drag = state.drag;
    state.drag = null;
    if (drag.moved) {
      const box = normBox(drag);
      if (box.width >= DRAG_THRESHOLD && box.height >= DRAG_THRESHOLD) {
        if (state.maskMode) {
          addUserMask(box);
          return;
        }
        void openAreaDraft(box, { x: box.x, y: box.y });
      } else {
        updateOutline();
      }
      return;
    }
    if (state.maskMode) {
      updateOutline();
      return;
    }
    const target = selection.current ?? targetFromPoint(event.clientX, event.clientY);
    if (!target) {
      updateOutline();
      return;
    }
    if (state.repositionPinId) {
      applyManualPlace(state.repositionPinId, target);
      event.preventDefault();
      return;
    }
    void openElementDraft(target, { x: event.clientX, y: event.clientY });
    event.preventDefault();
  }

  async function openElementDraft(element, point) {
    const box = boxOf(element);
    const anchor = point ?? state.pointer ?? {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
    const scroll = currentScroll();
    const position = getComputedStyle(element).position;
    const path = joinFrameDomPath(await requestFramePaths(), treePath(element));
    const fingerprint = captureFingerprint(element);
    openDraft({
      anchor,
      box,
      documentAnchor: documentPoint(anchor, scroll),
      documentBox: documentBox(box, scroll),
      fingerprint,
      kind: "element",
      label: labelFor(element),
      location: { confidence: "exact", evidence: ["captured"], score: 1, strategy: "stable-selector" },
      path,
      selector: stableSelector(document, element) || cssPath(element),
      scroll,
      tag: element.tagName.toLowerCase(),
      text: visibleText(element),
      viewportAnchored: position === "fixed" || position === "sticky",
    });
  }

  function onClick(event) {
    if (!isMounted() || fromUi(event)) return;
    if (state.active) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  function isModEnter(event) {
    return event.key === "Enter" && (event.metaKey || event.ctrlKey);
  }

  // Physical keys whose keydown we suppressed; their keyup/keypress must be
  // suppressed too, even if the same key deactivated pin mode meanwhile.
  const ownedKeyCodes = new Set();

  function onKey(event) {
    if (!isMounted() || !state.active) return;
    // onKey fully owns these two keys: never let the page see them, even when
    // they originate inside the composer (e.g. Esc closing a page modal).
    if (isModEnter(event)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      ownedKeyCodes.add(event.code);
      void sendPins();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      ownedKeyCodes.add(event.code);
      if (state.draft) {
        cancelDraft();
        return;
      }
      if (state.maskMode) {
        state.maskMode = false;
        renderChrome();
        return;
      }
      void discardAnnotations().then(() => {
        setVisible(false);
        if (isEmbedded) window.top.postMessage({ type: FRAME_HIDE }, "*");
        else broadcast(FRAME_HIDE);
      });
      return;
    }
    // While pin mode is active the page app must never react to keys. Events
    // from our UI keep propagating so the composer's own handlers still run.
    const path = event.composedPath();
    if (!path.includes(host)) {
      event.stopImmediatePropagation();
      // Also block native actions on focused page elements (button/checkbox
      // activation, typing into inputs). Keys aimed at the document itself keep
      // their defaults so keyboard scrolling still works.
      const target = path[0];
      if (target !== window && target !== document && target !== document.documentElement && target !== document.body) {
        event.preventDefault();
      }
    }
    if (!canSelect() || state.draft) return;
    if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      toggleMaskMode();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectParent();
      updateOutline();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectChild();
      updateOutline();
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (selection.current) void openElementDraft(selection.current);
    }
  }

  function onPageKeyEvent(event) {
    // Consume before the active guard: Esc that deactivates pin mode must not
    // leak its own keyup to the page once state.active flips to false.
    if (ownedKeyCodes.has(event.code)) {
      event.stopImmediatePropagation();
      if (event.type === "keyup") ownedKeyCodes.delete(event.code);
      return;
    }
    if (!isMounted() || !state.active) return;
    // Keys onKey owns on keydown stay owned here too, regardless of origin:
    // apps may react to Escape/Mod+Enter on keyup even with keydown blocked.
    if (event.key === "Escape" || isModEnter(event)) {
      event.stopImmediatePropagation();
      return;
    }
    if (!event.composedPath().includes(host)) event.stopImmediatePropagation();
  }

  async function writePlainText(text) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("aria-hidden", "true");
      textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
      document.documentElement.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        return document.execCommand("copy");
      } finally {
        textarea.remove();
      }
    }
  }

  function handoffStatusText(result) {
    const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
    if (!result?.degraded) return "Copied";
    const parts = ["Copied"];
    if (warnings.includes("screenshot_missing")) parts.push("no screenshot");
    if (warnings.includes("helper_unavailable")) parts.push("helper unavailable");
    else if (warnings.includes("viewer_unavailable")) parts.push("no viewer");
    return parts.join(" · ");
  }

  async function sendPins() {
    if (!isMounted() || !state.active || state.sending) return;
    if (isEmbedded) {
      if (!saveDraft()) {
        flashStatus("Write a comment first");
        return;
      }
      await syncPins();
      window.top.postMessage({ type: FRAME_SEND }, "*");
      return;
    }
    if (!saveDraft()) {
      flashStatus("Write a comment first");
      return;
    }
    if (state.pins.length === 0 && !state.draft) {
      flashStatus("Add a pin first");
      return;
    }
    let extraQueryKeys = [];
    try {
      const stored = await chrome.storage.sync.get({ sensitiveQueryKeys: "" });
      extraQueryKeys = parseExtraKeys(stored.sensitiveQueryKeys);
    } catch {
      extraQueryKeys = [];
    }
    state.sending = true;
    setStatus("Copying…");
    try {
      const refreshed = await chrome.runtime.sendMessage({ type: "pins:refresh" }).catch(() => null);
      if (!refreshed?.ok) throw new Error(refreshed?.error || "pin positions could not be refreshed");
      const listed = await chrome.runtime.sendMessage({ type: "pins:list" }).catch(() => null);
      const pins = listed?.pins ?? state.pins;
      if (pins.length === 0) {
        flashStatus("Add a pin first");
        return;
      }
      const scan = activeScan();
      const maskRegions = activeMaskRegions();
      await chrome.runtime.sendMessage({ hidden: true, type: "overlays:hidden" }).catch(() => null);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const capture = await chrome.runtime.sendMessage({
        dpr: window.devicePixelRatio || 1,
        maskRegions,
        pins,
        type: "capture",
      }).catch((error) => ({ error: String(error), ok: false }));
      const shot = capture?.ok ? capture.shot : null;
      const sanitized = sanitizeCapture({
        fields: scan.fields,
        page: pageContext(),
        pins: pins.map((pin) => ({ ...pin, pinId: pin.pinId || pin.id })),
        unevaluated: scan.unevaluated,
      }, { extraQueryKeys });
      const captureId = crypto.randomUUID();
      const copied = await chrome.runtime.sendMessage({
        captureId,
        fields: scan.fields.map((field) => ({ attrs: field.attrs })),
        page: sanitized.page,
        pins: sanitized.pins,
        privacy: sanitized.privacy,
        schemaVersion: 1,
        shot,
        type: "clipboard",
        warnings: sanitized.warnings,
      }).catch((error) => ({ error: String(error), ok: false }));
      const locallyCopied = copied?.plain ? await writePlainText(copied.plain) : false;
      if (!copied?.ok && !locallyCopied) throw new Error(copied?.error || "clipboard write failed");
      setStatus(handoffStatusText(copied), "ok");
      // The confirmation lingers briefly, but a toggle request cuts it short
      // instead of racing the shutdown below (see toggle()).
      await new Promise((resolve) => {
        state.finishEarly = resolve;
        setTimeout(resolve, 1400);
      });
      state.finishEarly = null;
      // Do not restore overlays first — that would flash iframe pins after
      // the top toolbar is already gone. session:end dismisses every frame.
      await chrome.runtime.sendMessage({ type: "session:end" }).catch(() => null);
      await clearPins();
      broadcast(FRAME_CLEAR);
      setStatus(null);
      setVisible(false);
      broadcast(FRAME_HIDE);
    } catch (error) {
      await chrome.runtime.sendMessage({ hidden: false, type: "overlays:hidden" }).catch(() => null);
      console.warn("Pinar copy failed", error);
      flashStatus("Copy failed");
    } finally {
      state.sending = false;
      state.finishEarly = null;
      if (state.reopenAfterSend) {
        // The user asked for the toolbar while the previous capture was still
        // closing: give them a fresh one now that the old state is gone.
        state.reopenAfterSend = false;
        setVisible(true);
        broadcast(FRAME_SHOW);
      }
    }
  }

  function frameElementForSource(source) {
    for (const node of document.querySelectorAll("iframe,frame")) {
      if (node.contentWindow === source) return node;
    }
    return null;
  }

  function replyFramePath(event) {
    const iframe = frameElementForSource(event.source);
    if (!iframe) return;
    const localPath = treePath(iframe);
    void requestFramePaths().then((parentPaths) => {
      event.source?.postMessage({
        id: event.data.id,
        paths: [...parentPaths, localPath],
        type: FRAME_PATH_REPLY,
      }, "*");
    });
  }

  function replyFrameRect(event) {
    const iframe = frameElementForSource(event.source);
    const rect = iframe?.getBoundingClientRect();
    const local = rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 };
    void requestTopOffset().then(({ offset: parentOffset, topScroll }) => {
      event.source?.postMessage({
        id: event.data.id,
        offset: { x: parentOffset.x + local.x, y: parentOffset.y + local.y },
        topScroll,
        type: FRAME_RECT_REPLY,
      }, "*");
    });
  }

  function onFrameMessage(event) {
    if (event.source === window) return;
    if (event.data?.type === FRAME_RECT_REQUEST) {
      replyFrameRect(event);
      return;
    }
    if (event.data?.type === FRAME_PATH_REQUEST) {
      replyFramePath(event);
      return;
    }
    if (event.data?.type === FRAME_CLEAR) {
      resetLocalPins();
      broadcastToChildFrames(FRAME_CLEAR);
      return;
    }
    if (event.data?.type === FRAME_HIDE) {
      setVisible(false);
      broadcastToChildFrames(FRAME_HIDE);
      return;
    }
    if (event.data?.type === FRAME_SHOW) {
      setVisible(true);
      broadcastToChildFrames(FRAME_SHOW);
      return;
    }
    if (event.data?.type === FRAME_CANCEL) {
      resetLocalPins();
      setVisible(false);
      broadcastToChildFrames(FRAME_CANCEL);
      return;
    }
    if (!isEmbedded && event.data?.type === FRAME_SEND) {
      void sendPins();
      return;
    }
    if (!isEmbedded && event.data?.type === FRAME_ACTIVITY) {
      hideOutline();
    }
  }

  function setHidden(hidden) {
    host.style.display = hidden || !state.active ? "none" : "";
    if (hidden) {
      document.documentElement.removeAttribute("data-pinar-active");
      document.documentElement.removeAttribute("data-pinar-mask-mode");
    } else if (state.active) {
      document.documentElement.setAttribute("data-pinar-active", "true");
      applyGlobalStyles();
    }
  }

  function isVisible() {
    return host.isConnected && state.active && host.style.display !== "none";
  }

  function setVisible(visible) {
    if (visible && !host.isConnected) document.documentElement.append(host);
    state.active = visible;
    host.style.display = visible ? "" : "none";
    if (visible) {
      // The toolbar fades while the pointer hovers it so the page beneath can
      // be pinned. That class is only recomputed on pointermove, which is
      // ignored while hidden - so whatever the pointer was doing at the last
      // capture would otherwise decide whether the next activation is visible.
      ui.toolbar?.classList.remove("pass-through");
      document.documentElement.setAttribute("data-pinar-active", "true");
      applyGlobalStyles();
      renderChrome();
      updateOutline();
      renderMarkers();
      void syncBatchLabel();
      return;
    }
    document.documentElement.removeAttribute("data-pinar-active");
    document.documentElement.removeAttribute("data-pinar-mask-mode");
    removeGlobalStyles();
    hideOutline();
  }

  function fitInput() {
    ui.input.style.height = "0";
    ui.input.style.height = `${Math.max(24, ui.input.scrollHeight)}px`;
  }

  ui.input.addEventListener("input", fitInput);
  ui.input.addEventListener("keydown", (event) => {
    if (handleComposerKeyDown(event)) saveDraft();
  });
  ui.input.addEventListener("keypress", stopComposerKeyboardEvent);
  ui.input.addEventListener("keyup", stopComposerKeyboardEvent);

  ui.cancel.addEventListener("click", () => cancelDraft());
  ui.deleteDraft.addEventListener("click", () => deleteDraft());
  ui.save.addEventListener("click", () => saveDraft());
  ui.layer.addEventListener("pointerover", (event) => {
    const button = event.target.closest("[data-pin]");
    if (!button || state.draft) return;
    state.hoverPinId = button.getAttribute("data-pin");
    updateOutline();
    placePreview();
  });
  ui.layer.addEventListener("pointerleave", () => {
    state.hoverPinId = null;
    updateOutline();
    placePreview();
  });
  ui.layer.addEventListener("click", (event) => {
    const mask = event.target.closest("[data-privacy-mask]");
    if (mask) {
      event.preventDefault();
      event.stopPropagation();
      removeMask(mask.getAttribute("data-privacy-mask"));
      return;
    }
    const button = event.target.closest("[data-pin]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const pinId = button.getAttribute("data-pin");
    const pin = state.pins.find((item) => item.id === pinId);
    if (state.reviewMode && pin && isPendingLocation(viewportPin(pin).location)) {
      state.repositionPinId = pinId;
      renderChrome();
      flashStatus("Click the correct element to place this pin", "ok");
      return;
    }
    openPinEditor(pinId);
  });

  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("focusin", keepComposerFocus, true);
  window.addEventListener("focusout", shieldComposerFocusOut, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("keypress", onPageKeyEvent, true);
  window.addEventListener("keyup", onPageKeyEvent, true);
  window.addEventListener("message", onFrameMessage);
  window.addEventListener("scroll", () => {
    if (isMounted()) {
      updateOutline();
      renderMarkers();
    }
  }, true);
  window.addEventListener("resize", () => {
    if (isMounted()) {
      updateOutline();
      renderMarkers();
    }
  });

  let relocateTimer = 0;
  function scheduleRelocate() {
    if (relocateTimer) return;
    relocateTimer = window.setTimeout(() => {
      relocateTimer = 0;
      if (isMounted()) renderMarkers();
    }, 32);
  }
  const relocateObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (record.target === host || host.contains(record.target)) continue;
      if (record.type === "childList") {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (nodes.length && nodes.every((node) => node === host || host.contains(node))) continue;
      }
      scheduleRelocate();
      return;
    }
  });
  relocateObserver.observe(document.documentElement, {
    attributeFilter: ["aria-label", "class", "data-testid", "id", "name"],
    attributes: true,
    childList: true,
    subtree: true,
  });

  function pinBelongsHere(pin) {
    const parts = splitFrameDomPath(pin.path || pin.domPath || "");
    if (isEmbedded) return parts.length > 1;
    return parts.length <= 1;
  }

  function hydrateSession(payload) {
    const session = payload?.session;
    const sessionId = payload?.sessionId;
    if (!session || (session.id !== sessionId && session.captureId !== sessionId)) return false;
    state.reviewMode = true;
    state.reviewSessionId = session.id || sessionId;
    state.reviews = Array.isArray(payload.reviews) ? payload.reviews : [];
    state.unavailable = false;
    state.repositionPinId = null;
    state.draft = null;
    state.pins = (session.pins || []).filter(pinBelongsHere).map((pin) => freezeHistorical({
      ...pin,
      id: pin.id || pin.pinId,
      kind: pin.kind || (pin.type === "area" ? "area" : "element"),
    }));
    if (!state.active) {
      state.active = true;
      document.documentElement.setAttribute("data-pinar-active", "true");
      applyGlobalStyles();
    }
    renderChrome();
    void syncPins();
    return true;
  }

  function showUnavailable(reason) {
    state.reviewMode = true;
    state.unavailable = true;
    state.repositionPinId = null;
    state.pins = [];
    setStatus(reason === "origin_mismatch"
      ? "This page is not the original capture URL"
      : "Original page is unavailable", "error");
    renderChrome();
    renderMarkers();
    return true;
  }

  function applyManualPlace(pinId, element) {
    const index = state.pins.findIndex((pin) => pin.id === pinId);
    if (index < 0 || !element) return false;
    const current = freezeHistorical(state.pins[index]);
    const box = boxOf(element);
    const historicalSelector = current.selector;
    const historicalPath = current.path;
    const historicalFingerprint = current.fingerprint;
    current.anchor = anchorInBox(current, box);
    current.box = box;
    current.location = {
      confidence: "exact",
      evidence: ["manual-reposition"],
      score: 1,
      strategy: "geometry",
    };
    current.locationHistory = [
      ...(current.locationHistory || []),
      {
        at: new Date().toISOString(),
        confidence: "exact",
        source: "manual",
        strategy: "geometry",
      },
    ];
    current.selector = historicalSelector;
    current.path = historicalPath;
    current.fingerprint = historicalFingerprint;
    state.pins[index] = current;
    state.repositionPinId = null;
    void syncPins();
    updateOutline();
    renderMarkers();
    renderChrome();
    return true;
  }

  function repositionPin(pinId, selector) {
    const element = selector ? document.querySelector(selector) : selection.current;
    if (!element) return false;
    return applyManualPlace(pinId, element);
  }

  function teardown() {
    if (!host.isConnected && !state.active) return;
    clearTimeout(state.statusTimer);
    clearTimeout(relocateTimer);
    relocateObserver.disconnect();
    state.active = false;
    document.documentElement.removeAttribute("data-pinar-active");
    document.documentElement.removeAttribute("data-pinar-mask-mode");
    removeGlobalStyles();
    host.remove();
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("focusin", keepComposerFocus, true);
    window.removeEventListener("focusout", shieldComposerFocusOut, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("keypress", onPageKeyEvent, true);
    window.removeEventListener("keyup", onPageKeyEvent, true);
    window.removeEventListener("message", onFrameMessage);
    delete globalThis.__pinarToggle;
    delete globalThis.__pinarSetHidden;
    delete globalThis.__pinarDismiss;
    delete globalThis.__pinarSyncPins;
    delete globalThis.__pinarCaptureMetrics;
    delete globalThis.__pinarPrepareCapture;
    delete globalThis.__pinarRestoreCapture;
    delete globalThis.__pinarScrollCapture;
    delete globalThis.__pinarHydrateSession;
    delete globalThis.__pinarShowUnavailable;
    delete globalThis.__pinarRepositionPin;
  }

  function toggle() {
    if (state.sending) {
      // A capture is mid-flight: screenshot, clipboard, confirmation, then the
      // tear-down. Flipping visibility now would either put the toolbar in the
      // screenshot or resurrect the finished session for the tear-down to wipe
      // again, taking the user's next pins with it. Queue the request instead:
      // the confirmation ends early and a fresh toolbar opens once the old
      // state is gone.
      state.reopenAfterSend = true;
      state.finishEarly?.();
      return;
    }
    setVisible(!isVisible());
    globalThis.__pinarToggle = toggle;
    globalThis.__pinarSetHidden = setHidden;
    globalThis.__pinarDismiss = dismiss;
  }

  globalThis.__pinarToggle = toggle;
  globalThis.__pinarSetHidden = setHidden;
  globalThis.__pinarDismiss = dismiss;
  globalThis.__pinarSyncPins = syncPins;
  globalThis.__pinarCaptureMetrics = pageMetrics;
  globalThis.__pinarPrepareCapture = prepareCapture;
  globalThis.__pinarRestoreCapture = restoreCapture;
  globalThis.__pinarScrollCapture = scrollCapture;
  globalThis.__pinarHydrateSession = hydrateSession;
  globalThis.__pinarShowUnavailable = showUnavailable;
  globalThis.__pinarRepositionPin = repositionPin;
  globalThis.chrome?.runtime?.onMessage?.addListener?.((message, _sender, sendResponse) => {
    if (message?.type === "session:hydrate") {
      sendResponse({ ok: hydrateSession(message) });
      return false;
    }
    if (message?.type === "batch:changed") {
      applyBatchState(message);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "session:unavailable") {
      sendResponse({ ok: showUnavailable(message.reason) });
      return false;
    }
    return false;
  });
  document.documentElement.setAttribute("data-pinar-active", "true");
  applyGlobalStyles();
  renderChrome();
  updateOutline();
  renderMarkers();
  void syncBatchLabel();
})();
