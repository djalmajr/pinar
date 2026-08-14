(() => {
  if (globalThis.__aiFeedbackToggle) {
    globalThis.__aiFeedbackToggle();
    return;
  }

  const DRAG_THRESHOLD = 6;
  const BLUE = "#5794FF";
  const MARK = "#6691F2";
  const BUBBLE_BODY = "M2 12C2 6.477 6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10a10 10 0 0 1-4.262-.951l-4.537.93a1 1 0 0 1-1.18-1.18l.93-4.537A10 10 0 0 1 2 12";
  const BUBBLE_DOTS = `${BUBBLE_BODY}m10-4a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2H9a1 1 0 1 1 0-2h2V9a1 1 0 0 1 1-1`;
  const bubbleSvg = ({ className = "", variant = "plain" } = {}) => {
    if (variant === "dots") {
      return `<svg class="${className}" viewBox="1.8 1.8 20.4 20.4" aria-hidden="true"><path fill="${MARK}" fill-rule="evenodd" clip-rule="evenodd" d="${BUBBLE_DOTS}"/></svg>`;
    }
    return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path fill="${MARK}" stroke="#fff" stroke-width="1.15" fill-rule="evenodd" clip-rule="evenodd" d="${BUBBLE_BODY}"/></svg>`;
  };
  const apple = /mac|iphone|ipad|ipod/i.test(
    `${navigator.userAgentData?.platform ?? ""} ${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`,
  );
  const sendMod = apple ? "⌘" : "Ctrl";
  const FRAME_ACTIVITY = "ai-feedback:frame-activity";
  const FRAME_CANCEL = "ai-feedback:frame-cancel";
  const FRAME_CLEAR = "ai-feedback:frame-clear";
  const FRAME_HIDE = "ai-feedback:frame-hide";
  const FRAME_RECT_REQUEST = "ai-feedback:frame-rect-request";
  const FRAME_RECT_REPLY = "ai-feedback:frame-rect-reply";
  const FRAME_SEND = "ai-feedback:frame-send";
  const FRAME_SHOW = "ai-feedback:frame-show";
  const isEmbedded = globalThis.top !== globalThis;
  const showToolbar = !isEmbedded;

  const state = {
    active: true,
    sending: false,
    status: null,
    statusTimer: 0,
    pins: [],
    tabPinCount: 0,
    drag: null,
    draft: null,
    hoverPinId: null,
    pointer: null,
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
  host.setAttribute("data-ai-feedback", "host");
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
        border-radius: 999px;
        box-shadow: 0 10px 28px rgba(15,23,42,.18), 0 1px 2px rgba(15,23,42,.10);
        box-sizing: border-box;
        color: #262626;
        display: flex;
        align-items: center;
        font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        left: 50%;
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
      .view { align-items: center; display: flex; gap: 12px; position: relative; z-index: 1; }
      .view[hidden] { display: none !important; }
      .state-icon { display: grid; flex: 0 0 1.25rem; height: 1.25rem; place-items: center; width: 1.25rem; }
      .mark { display: block; height: 1.25rem; width: 1.25rem; }
      .instructions { align-items: center; display: flex; gap: 12px; }
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
      .sep { background: #B7B7B7; border-radius: 50%; flex: 0 0 3px; height: 3px; width: 3px; }
      .status { color: #262626; font-weight: 500; }
      .status[data-kind="error"] { color: #E5484D; }
      .status[data-kind="ok"] { color: #1F7A4D; }
      .icon-btn {
        align-items: center;
        background: transparent;
        border: 0;
        border-radius: 999px;
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
        background: rgba(15,23,42,.85);
        backdrop-filter: blur(4px);
        border-radius: 4px;
        bottom: 6px;
        color: #fff;
        display: none;
        font: 600 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        padding: 3px 6px;
        position: absolute;
        right: 6px;
        white-space: nowrap;
      }
      .outline.area.is-dragging .outline-badge {
        display: inline-flex;
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
        border-radius: 999px;
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
        border-radius: 16px;
        box-shadow: 0 12px 32px rgba(15,23,42,.16);
        display: flex;
        flex-direction: column;
        gap: 10px;
        min-width: 260px;
        padding: 10px 10px 8px;
        width: 280px;
      }
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
        border-radius: 999px;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        height: 32px;
        padding: 0 14px;
      }
      .btn-cancel { background: #f4f4f5; color: #111; }
      .btn-add { background: ${MARK}; color: #fff; }
    </style>
    ${showToolbar ? `
    <div class="toolbar">
      <div class="view online-view" data-ref="onlineView">
        <span class="state-icon" aria-hidden="true">
          ${bubbleSvg({ className: "mark", variant: "dots" })}
        </span>
        <span class="instructions" data-ref="instructions">
          <span class="hint">Click or drag to pin</span>
          <span class="sep"></span>
          <span class="hint"><span class="keys"><kbd>↑</kbd><kbd>↓</kbd></span> to fine-tune selection</span>
          <span class="sep"></span>
          <span class="hint"><span class="keys"><kbd>${sendMod}</kbd><kbd>↵</kbd></span> to copy</span>
          <span class="sep"></span>
          <span class="hint"><span class="keys"><kbd>esc</kbd></span> to clear</span>
        </span>
        <span class="status" data-ref="status" hidden></span>
      </div>
    </div>` : ""}
    <div class="outline" data-ref="outline"><span class="outline-badge" data-ref="outlineBadge"></span></div>
    <div data-ref="layer"></div>
    <div class="preview" data-ref="preview" hidden>
      <span class="preview-n" data-ref="previewN">1</span>
      <span class="preview-text" data-ref="previewText"></span>
    </div>
    <div class="composer" data-ref="composer" hidden>
      <div class="composer-card">
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
    status: shadow.querySelector("[data-ref=status]"),
    toolbar: shadow.querySelector(".toolbar"),
  };

  document.documentElement.append(host);

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

  function pageContext() {
    return {
      title: document.title,
      url: location.href,
      viewport: {
        dpr: window.devicePixelRatio || 1,
        height: window.innerHeight,
        width: window.innerWidth,
      },
    };
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
        resolve({ x: 0, y: 0 });
        return;
      }
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        window.removeEventListener("message", onReply);
        resolve({ x: 0, y: 0 });
      }, 200);
      function onReply(event) {
        if (event.data?.type !== FRAME_RECT_REPLY || event.data.id !== id) return;
        clearTimeout(timer);
        window.removeEventListener("message", onReply);
        resolve(event.data.offset ?? { x: 0, y: 0 });
      }
      window.addEventListener("message", onReply);
      window.parent.postMessage({ id, type: FRAME_RECT_REQUEST }, "*");
    });
  }

  async function topBox(element) {
    const box = boxOf(element);
    const offset = await requestTopOffset();
    return {
      height: box.height,
      width: box.width,
      x: box.x + offset.x,
      y: box.y + offset.y,
    };
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
    if (!ui.toolbar) return;
    const hasStatus = Boolean(state.status);
    if (ui.instructions) ui.instructions.hidden = hasStatus;
    if (ui.status) {
      ui.status.hidden = !hasStatus;
      ui.status.textContent = state.status?.text ?? "";
      ui.status.dataset.kind = state.status?.kind ?? "";
    }
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

  function hideOutline() {
    ui.outline.style.display = "none";
  }

  function showOutline(box, area = false, dragging = false) {
    ui.outline.classList.toggle("area", area);
    ui.outline.classList.toggle("is-dragging", dragging);
    Object.assign(ui.outline.style, {
      display: "block",
      height: `${box.height}px`,
      left: `${box.x}px`,
      top: `${box.y}px`,
      width: `${box.width}px`,
    });
    if (ui.outlineBadge) {
      ui.outlineBadge.textContent = `${box.width} × ${box.height} px`;
    }
  }

  function canSelect() {
    return state.active;
  }

  function updateOutline() {
    if (!canSelect()) {
      hideOutline();
      return;
    }
    if (state.drag) {
      showOutline(normBox(state.drag), true, true);
      return;
    }
    if (state.draft) {
      showOutline(state.draft.box, state.draft.kind === "area", false);
      return;
    }
    if (state.hoverPinId) {
      const pin = state.pins.find((item) => item.id === state.hoverPinId);
      if (pin?.box) {
        showOutline(pin.box, pin.kind === "area", false);
        return;
      }
    }
    if (selection.current && state.active) {
      showOutline(boxOf(selection.current), false, false);
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

  function markerHtml(point, index, pinId) {
    const body = `${bubbleSvg()}<span class="marker-n">${index + 1}</span>`;
    if (pinId) {
      return `<button type="button" class="marker" data-pin="${pinId}" style="left:${point.x}px;top:${point.y}px">${body}</button>`;
    }
    return `<span class="marker" data-draft="1" style="left:${point.x}px;top:${point.y}px">${body}</span>`;
  }

  function renderMarkers() {
    const markers = state.pins.map((pin, index) => markerHtml(pinPoint(pin), index, pin.id));
    if (state.draft && !state.draft.editId) {
      markers.push(markerHtml(pinPoint(state.draft), state.pins.length));
    }
    ui.layer.innerHTML = markers.join("");
    placeComposer();
    placePreview();
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
    const point = pinPoint(pin);
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
    ui.previewText.textContent = pin.comment.replaceAll("\n", " ");
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

  function openDraft(draft) {
    if (!canSelect()) return;
    state.hoverPinId = null;
    state.draft = draft;
    ui.input.value = draft.comment ?? "";
    updateOutline();
    renderMarkers();
    fitInput();
    queueMicrotask(() => {
      fitInput();
      ui.input.focus();
      ui.input.setSelectionRange(ui.input.value.length, ui.input.value.length);
    });
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
      state.pins.push({ ...state.draft, comment, id: crypto.randomUUID() });
    }
    state.draft = null;
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
    const response = await chrome.runtime.sendMessage({ pins: state.pins, type: "pins:sync" }).catch(() => null);
    if (response?.ok) state.tabPinCount = response.pins.length;
    renderChrome();
  }

  function cancelDraft() {
    state.draft = null;
    updateOutline();
    renderMarkers();
  }

  function resetLocalPins() {
    state.pins = [];
    state.draft = null;
    state.tabPinCount = 0;
    state.hoverPinId = null;
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
    if (!isMounted() || !canSelect() || event.button !== 0 || fromUi(event) || state.draft) return;
    if (document.elementFromPoint(event.clientX, event.clientY)?.matches?.("iframe,frame")) return;
    state.drag = { moved: false, x0: event.clientX, x1: event.clientX, y0: event.clientY, y1: event.clientY };
    event.preventDefault();
  }

  async function openAreaDraft(box, anchorPoint) {
    const offset = await requestTopOffset();
    const anchor = anchorPoint ?? { x: box.x, y: box.y };
    openDraft({
      anchor,
      box,
      kind: "area",
      label: `selected area (${box.width}×${box.height}px)`,
      topBox: {
        height: box.height,
        width: box.width,
        x: box.x + offset.x,
        y: box.y + offset.y,
      },
    });
  }

  function onPointerUp(event) {
    if (!isMounted() || !state.drag) return;
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
        void openAreaDraft(box, { x: box.x, y: box.y });
      } else {
        updateOutline();
      }
      return;
    }
    const target = selection.current ?? targetFromPoint(event.clientX, event.clientY);
    if (!target) {
      updateOutline();
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
    openDraft({
      anchor,
      box,
      kind: "element",
      label: labelFor(element),
      path: treePath(element),
      selector: cssPath(element),
      text: visibleText(element),
      topBox: await topBox(element),
    });
  }

  function onClick(event) {
    if (!isMounted() || fromUi(event)) return;
    if (canSelect()) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function isModEnter(event) {
    return event.key === "Enter" && (event.metaKey || event.ctrlKey);
  }

  function onKey(event) {
    if (!isMounted() || !state.active) return;
    if (isModEnter(event)) {
      event.preventDefault();
      event.stopPropagation();
      void sendPins();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (state.draft) {
        cancelDraft();
        return;
      }
      void discardAnnotations().then(() => {
        setVisible(false);
        if (isEmbedded) window.top.postMessage({ type: FRAME_HIDE }, "*");
        else broadcast(FRAME_HIDE);
      });
      return;
    }
    if (!canSelect() || state.draft) return;
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
    state.sending = true;
    setStatus("Copying…");
    try {
      await syncPins();
      const listed = await chrome.runtime.sendMessage({ type: "pins:list" }).catch(() => null);
      const pins = listed?.pins ?? state.pins;
      if (pins.length === 0) {
        flashStatus("Add a pin first");
        return;
      }
      await chrome.runtime.sendMessage({ hidden: true, type: "overlays:hidden" }).catch(() => null);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const capture = await chrome.runtime.sendMessage({
        dpr: window.devicePixelRatio || 1,
        pins,
        type: "capture",
      });
      if (!capture?.ok) throw new Error(capture?.error || "capture failed");
      const page = pageContext();
      const copied = await chrome.runtime.sendMessage({
        page,
        pins,
        shot: capture.shot,
        type: "clipboard",
      });
      if (!copied?.ok) throw new Error(copied?.error || "clipboard write failed");
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
      console.warn("ai-feedback copy failed", error);
      flashStatus("Copy failed");
    } finally {
      state.sending = false;
    }
  }

  function replyFrameRect(event) {
    let iframe = null;
    for (const node of document.querySelectorAll("iframe,frame")) {
      if (node.contentWindow === event.source) {
        iframe = node;
        break;
      }
    }
    const rect = iframe?.getBoundingClientRect();
    const local = rect ? { x: rect.left, y: rect.top } : { x: 0, y: 0 };
    void requestTopOffset().then((parentOffset) => {
      event.source?.postMessage({
        id: event.data.id,
        offset: { x: parentOffset.x + local.x, y: parentOffset.y + local.y },
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
      document.documentElement.setAttribute("data-pinar-active", "true");
      applyGlobalStyles();
      renderChrome();
      updateOutline();
      renderMarkers();
      return;
    }
    document.documentElement.removeAttribute("data-pinar-active");
    removeGlobalStyles();
    hideOutline();
  }

  function fitInput() {
    ui.input.style.height = "0";
    ui.input.style.height = `${Math.max(24, ui.input.scrollHeight)}px`;
  }

  ui.input.addEventListener("input", fitInput);
  ui.input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.metaKey || event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    saveDraft();
  });

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
    const button = event.target.closest("[data-pin]");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    openPinEditor(button.getAttribute("data-pin"));
  });

  window.addEventListener("pointerdown", onPointerDown, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKey, true);
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

  function teardown() {
    if (!host.isConnected && !state.active) return;
    clearTimeout(state.statusTimer);
    state.active = false;
    document.documentElement.removeAttribute("data-pinar-active");
    removeGlobalStyles();
    host.remove();
    window.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("message", onFrameMessage);
    delete globalThis.__aiFeedbackToggle;
    delete globalThis.__aiFeedbackSetHidden;
    delete globalThis.__aiFeedbackDismiss;
  }

  function toggle() {
    setVisible(!isVisible());
    globalThis.__aiFeedbackToggle = toggle;
    globalThis.__aiFeedbackSetHidden = setHidden;
    globalThis.__aiFeedbackDismiss = dismiss;
  }

  globalThis.__aiFeedbackToggle = toggle;
  globalThis.__aiFeedbackSetHidden = setHidden;
  globalThis.__aiFeedbackDismiss = dismiss;
  document.documentElement.setAttribute("data-pinar-active", "true");
  applyGlobalStyles();
  renderChrome();
  updateOutline();
  renderMarkers();
})();
