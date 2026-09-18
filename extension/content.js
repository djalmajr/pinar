(() => {
  if (globalThis.__pinarToggle) {
    globalThis.__pinarToggle();
    return;
  }

  const DRAG_THRESHOLD = 6;
  let reviewDocumentId = crypto.randomUUID();
  let reviewDocumentUrl = location.href;
  function currentReviewDocumentId() {
    if (reviewDocumentUrl !== location.href) {
      reviewDocumentUrl = location.href;
      reviewDocumentId = crypto.randomUUID();
    }
    return reviewDocumentId;
  }
  let pendingReviewSync = Promise.resolve();
  // How long the copy confirmation stays up before the overlay closes.
  const COPY_CONFIRMATION_MS = 2000;
  // How long a copy error stays up before the overlay closes; the pins are kept
  // so reopening lets the user retry.
  const COPY_ERROR_MS = 3000;
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
  const sendMod = apple ? "⌘" : "Alt";
  const FRAME_ACTIVITY = "pinar:frame-activity";
  const FRAME_CANCEL = "pinar:frame-cancel";
  const FRAME_CLEAR = "pinar:frame-clear";
  const FRAME_HIDE = "pinar:frame-hide";
  const FRAME_PATH_REQUEST = "pinar:frame-path-request";
  const FRAME_PATH_REPLY = "pinar:frame-path-reply";
  const FRAME_RECT_REQUEST = "pinar:frame-rect-request";
  const FRAME_RECT_REPLY = "pinar:frame-rect-reply";
  const FRAME_REGIONS = "pinar:frame-regions";
  const FRAME_SEND = "pinar:frame-send";
  const FRAME_SHOW = "pinar:frame-show";
  const isEmbedded = globalThis.top !== globalThis;
  const showToolbar = !isEmbedded;
  const {
    anchorInBox,
    documentBox,
    documentPoint,
    geometryLabel,
    isScrollContainerRecord,
    layoutScroll,
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
    classifyFieldAttrs,
    documentBoxes,
    parseExtraKeys,
    scanSensitiveDocuments,
    sanitizeCapture,
    sanitizeUrl,
  } = globalThis.__pinarPrivacy;
  const evidenceStore = globalThis.__pinarEvidence?.store ?? null;
  const {
    copyShortcutLabel,
    handleComposerKeyDown,
    isCopyShortcut,
    stopComposerKeyboardEvent,
  } = globalThis.__pinarKeyboardEvents;
  const captureSnapshot = globalThis.__pinarSnapshot?.captureSnapshot ?? (() => undefined);
  const {
    boundedVoiceDuration,
    formatVoiceComment,
    preferredVoiceMimeType,
    voiceSignalLevel,
    voiceWaveHeights,
  } = globalThis.__pinarVoice;

  const initialVisible = globalThis.__pinarInitialVisible !== false;
  delete globalThis.__pinarInitialVisible;
  const state = {
    active: initialVisible,
    recording: false,
    recordingCount: 0,
    batch: { active: false, label: "", shortcut: "" },
    sending: false,
    reopenAfterSend: false,
    status: null,
    statusTimer: 0,
    progress: 0,
    progressLabel: null,
    progressKind: "info",
    progressShown: 0,
    progressRaf: 0,
    progressFinal: null,
    progressTweened: null,
    pins: [],
    tabPinCount: 0,
    drag: null,
    draft: null,
    hoverPinId: null,
    pointer: null,
    maskMode: false,
    showPinRegions: true,
    userMasks: [],
    dismissedMaskIds: new Set(),
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

  const FALLBACK_MESSAGES = {
    overlay_add: "Add",
    overlay_add_pin_first: "Add a pin first",
    overlay_cancel: "Cancel",
    overlay_comment: "Comment",
    overlay_copied: "Copied successfully!",
    overlay_copy_failed: "Copy failed",
    overlay_voice_start: "Speak comment",
    overlay_voice_stop: "Stop recording",
    overlay_voice_recording: "Listening… {seconds}s of 120s",
    overlay_voice_processing: "Transcribing and organizing…",
    overlay_voice_transcript: "Transcription",
    overlay_voice_use_transcript: "Use transcription",
    overlay_voice_ready: "Voice comment ready to review",
    overlay_voice_local_only: "Voice comments require the Pinar cloud server",
    overlay_voice_permission: "Allow microphone access to dictate a comment",
    overlay_voice_failed: "The voice comment could not be processed",
    overlay_voice_network: "Pinar Cloud could not be reached. Check your connection and try again.",
    overlay_voice_auth: "Connect the extension to your Pinar Cloud account and try again.",
    overlay_voice_credits: "No AI credits are available for this transcription.",
    overlay_voice_refunded: "Transcription failed temporarily. Your AI credit was refunded; try again.",
    overlay_voice_invalid: "The recording is empty or unsupported. Record it again.",
    overlay_voice_acceptance: "Acceptance criteria",
    overlay_copying: "Saving the annotations…",
    overlay_saved: "Annotations saved successfully!",
    overlay_helper_unavailable: "helper unavailable",
    overlay_hint_clear_long: "Hide",
    overlay_hint_clear_short: "Hide",
    overlay_hint_copy_long: "Conclude and copy",
    overlay_hint_copy_short: "Finish",
    overlay_session_summary: "{pages} pages · {pins} pins",
    overlay_session_start: "Add a pin to start a session",
    overlay_session_review: "Review session",
    overlay_review_short: "Review",
    overlay_session_back: "Back to page",
    overlay_session_saved: "Saved",
    overlay_session_captured: "Captured",
    overlay_session_cancelled: "Session cancelled",
    overlay_session_pending: "Pending — review and retry",
    overlay_session_finish: "Conclude and copy",
    overlay_session_retry: "Retry",
    overlay_session_discard: "Discard session",
    overlay_session_remove: "Remove",
    overlay_session_finished: "Session copied",
    overlay_session_finish_failed: "Could not finish the session · review and retry",
    overlay_hint_mask_long: "Mask",
    overlay_hint_mask_short: "Mask",
    overlay_hint_pin: "Click or drag",
    overlay_hint_regions: "Regions",
    overlay_hint_tune_long: "Adjust selection",
    overlay_hint_tune_short: "Adjust",
    overlay_mask_mode: "Drag to hide a region · click a mask to restore",
    overlay_no_screenshot: "no screenshot",
    overlay_no_viewer: "no viewer",
    overlay_pin_mode: "Pin mode",
    overlay_regions_off: "Showing pins only",
    overlay_regions_on: "Showing pins and regions",
    overlay_region_hidden: "Region hidden · click the mask to restore",
    overlay_write_comment: "Write a comment first",
    overlay_hint_record_long: "Record steps",
    overlay_hint_record_short: "Record",
    overlay_record_started: "Recording steps · use the page, then reopen Pinar, pin and press {mod}+Enter to attach them",
    overlay_record_cancelled: "Recording discarded",
    overlay_recording_badge: "Pinar · recording {count} steps · reopen Pinar, pin and press {mod}+Enter to finish · G discards",
  };
  let messages = {};
  const t = (key) => messages[key] ?? FALLBACK_MESSAGES[key];

  const host = document.createElement("div");
  host.setAttribute("data-pinar", "host");
  Object.assign(host.style, {
    all: "initial",
    inset: "0",
    pointerEvents: "none",
    position: "fixed",
    display: initialVisible ? "" : "none",
    zIndex: "2147483646",
  });
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .toolbar, .composer, .preview, .review-panel {
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
      :host([data-review-open]) .toolbar { display: none; }
      :host([data-review-open]) .marker, :host([data-review-open]) .preview,
      :host([data-review-open]) .outline, :host([data-review-open]) .composer,
      :host([data-review-open]) .privacy-mask, :host([data-review-open]) .toast { display: none !important; }
      .review-panel button:disabled { opacity: .5; cursor: default !important; }
      .review-panel { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); width: 420px; max-width: calc(100vw - 32px); max-height: calc(100vh - 32px); overflow: auto; box-sizing: border-box; padding: 12px; border: 1px solid rgba(15,23,42,.18); border-radius: 8px; background: #fff; color: #262626; box-shadow: 0 10px 28px rgba(15,23,42,.18), 0 1px 2px rgba(15,23,42,.10); pointer-events: auto; font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .review-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
      .review-row { padding: 12px; margin-bottom: 12px; border: 1px solid rgba(15,23,42,.12); border-radius: 12px; background: #fff; overflow-wrap: anywhere; }
      .review-heading { display: flex; align-items: center; gap: 8px; }
      .review-heading strong { flex: 1; min-width: 0; font-size: 12px; }
      .review-remove { flex-shrink: 0; border: 0; background: none; color: #737373; width: 28px; height: 28px; border-radius: 6px; cursor: pointer; display: grid; place-items: center; }
      .review-remove:hover { background: #f5f5f5; color: #262626; }
      .review-pin { display: inline-grid; place-items: center; min-width: 24px; height: 24px; border-radius: 12px 12px 12px 2px; background: ${MARK}; color: #fff; font-size: 12px; font-weight: 600; }
      .review-target { margin-top: 8px; font-size: 13px; font-weight: 600; }
      .review-comment { box-sizing: border-box; display: block; width: 100%; resize: vertical; min-height: 48px; padding: 8px; margin: 4px 0; border: 1px solid transparent; border-radius: 6px; background: #fff; color: #262626; font: inherit; }
      .review-comment:hover { border-color: #e5e5e5; }
      .review-comment:focus { outline: 2px solid ${MARK}; outline-offset: 1px; }
      .review-path { display: block; padding: 8px; background: #f1f3f3; border-radius: 6px; color: #647780; font: 10px/1.4 monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .review-preview { display: block; max-width: 100%; max-height: 100px; margin-top: 8px; border: 1px solid #e5e5e5; border-radius: 6px; object-fit: contain; }
      .review-status { display: block; margin-top: 6px; font-size: 11px; }
      .review-status-banner { padding: 9px 10px; margin-bottom: 12px; border: 1px solid rgba(15,23,42,.12); border-radius: 8px; color: #262626; font-size: 12px; font-weight: 500; }
      .review-status-banner[data-kind="error"] { color: #E5484D; }
      .review-status-banner[data-kind="ok"] { color: #1F7A4D; }
      .review-actions { position: sticky; bottom: -12px; background: #fff; padding: 12px 0; border-top: 1px solid #e5e5e5; }
      .review-row p { margin: 8px 0; }
      .review-row small { color: #737373; }
      .review-panel button:focus-visible { outline: 2px solid ${MARK}; outline-offset: 2px; }
      .toast {
        background: rgba(255,255,255,.96);
        border: 1px solid rgba(15,23,42,.18);
        border-radius: 8px;
        bottom: 16px;
        box-shadow: 0 8px 20px rgba(15,23,42,.14), 0 1px 2px rgba(15,23,42,.08);
        color: #262626;
        font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        max-width: calc(100vw - 32px);
        overflow: hidden;
        padding: 7px 10px;
        pointer-events: none;
        position: fixed;
        right: 16px;
        text-overflow: ellipsis;
        white-space: nowrap;
        z-index: 3;
      }
      .toast[hidden] { display: none; }
      [hidden] { display: none !important; }
      /* After Cmd+Enter the toolbar stays where it is and becomes the progress
         report: its content switches to the saving label with a percentage and a fill grows left to
         right behind it, the way capture tools do. Picker, pins and composer
         leave; --progress is 0..1. */
      :host([data-progress]) .marker, :host([data-progress]) .outline, :host([data-progress]) .composer,
      :host([data-progress]) .preview, :host([data-progress]) .toast { display: none !important; }
      .toolbar::before { background: rgba(15,23,42,.08); content: ""; inset: 0; position: absolute; transform: scaleX(var(--progress, 0)); transform-origin: left center; transition: transform 240ms ease; z-index: 0; }
      .progress-view { gap: 12px; }
      :host([data-progress]) .toolbar, :host([data-confirm]) .toolbar { padding-left: 14px; padding-right: 14px; }
      /* Batch finish reuses that confirmation chrome without a fill or a percentage. */
      :host([data-confirm]) .marker, :host([data-confirm]) .outline, :host([data-confirm]) .composer,
      :host([data-confirm]) .preview, :host([data-confirm]) .toast { display: none !important; }
      :host([data-confirm]) .toolbar::before { display: none; }
      :host([data-confirm]) .progress-pct { display: none; }
      .progress-text { font-weight: 400; }
      .progress-pct { color: #737373; font-variant-numeric: tabular-nums; }
      .toolbar[data-kind="error"] .progress-text { color: #E5484D; }
      .progress-icon svg { display: none; height: 20px; width: 20px; }
      .toolbar[data-kind="info"] .progress-spinner { animation: pinar-spin 0.9s linear infinite; color: #5794FF; display: block; }
      .toolbar[data-kind="ok"] .progress-check { color: #1F7A4D; display: block; }
      .toolbar[data-kind="error"] .progress-alert { color: #E5484D; display: block; }
      @keyframes pinar-spin { to { transform: rotate(360deg); } }
      .toast[data-kind="error"] { color: #E5484D; }
      .toast[data-kind="ok"] { color: #1F7A4D; }
      .view { align-items: center; display: flex; gap: 12px; min-width: 0; position: relative; z-index: 1; }
      .view[hidden] { display: none !important; }
      /* px, never rem: rem follows the host page root font-size, which the shadow root does not isolate. */
      .state-icon { display: grid; flex: 0 0 20px; height: 20px; place-items: center; width: 20px; }
      .mark { display: block; height: 20px; width: 20px; }
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
        .online-view > .state-icon { display: none; }
      }
      @media (max-width: 920px) { .hint[data-hint="regions"] { display: none; } }
      @media (max-width: 980px) { .hint[data-hint="record"] { display: none; } }
      @media (max-width: 860px) { .hint[data-hint="mask"] { display: none; } }
      @media (max-width: 760px) {
        .hint[data-hint="tune"] { display: none; }
      }
      @media (max-width: 660px) { .hint[data-hint="clear"] { display: none; } }
      @media (max-width: 480px) {
        .hint .long, .hint .short { display: none; }
      }
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
      .pin-region {
        border: 2px solid;
        box-sizing: border-box;
        pointer-events: none;
        position: fixed;
        z-index: 1;
      }
      .pin-region.area {
        border-style: dashed;
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
        min-width: 300px;
        padding: 10px 10px 8px;
        width: 340px;
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
      .composer-tools { display: flex; gap: 4px; margin-right: auto; }
      .composer-actions .icon-btn { display: inline-flex; }
      .voice-btn.is-recording { background: ${MARK}; color: #fff; }
      .voice-btn[hidden] { display: none; }
      .voice-btn:disabled { cursor: not-allowed !important; opacity: .45; }
      .voice-feedback { align-items: center; display: flex; gap: 8px; min-height: 16px; padding: 0 4px; }
      .voice-status {
        color: #525252;
        font: 500 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        min-height: 16px;
      }
      .voice-status:empty { display: none; }
      .voice-status[data-kind="error"] { color: #B91C1C; }
      .voice-wave { align-items: center; display: inline-flex; gap: 2px; height: 16px; }
      .voice-wave[hidden], .voice-processing-indicator[hidden] { display: none; }
      .voice-wave i { background: ${MARK}; border-radius: 2px; display: block; height: var(--voice-bar-height, 3px); opacity: var(--voice-bar-opacity, .45); transition: height 70ms ease-out, opacity 70ms ease-out; width: 2px; }
      .voice-processing-indicator { align-items: center; display: inline-flex; gap: 3px; height: 16px; }
      .voice-processing-indicator i { animation: pinar-voice-processing 1s ease-in-out infinite; background: ${MARK}; border-radius: 50%; display: block; height: 5px; opacity: .35; width: 5px; }
      .voice-processing-indicator i:nth-child(2) { animation-delay: .15s; }
      .voice-processing-indicator i:nth-child(3) { animation-delay: .3s; }
      @keyframes pinar-voice-processing { 0%, 60%, 100% { opacity: .3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
      @media (prefers-reduced-motion: reduce) {
        .voice-wave i { transition: none; }
        .voice-processing-indicator i { animation: none; opacity: 1; transform: none; }
      }
      .voice-review {
        background: #F8FAFC;
        border: 1px solid #E2E8F0;
        border-radius: 6px;
        color: #475569;
        padding: 8px;
      }
      .voice-review[hidden] { display: none; }
      .voice-review strong { color: #334155; display: block; font: 600 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin-bottom: 4px; }
      .voice-review p { font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; max-height: 72px; overflow: auto; white-space: pre-wrap; }
      .voice-review button { background: transparent; border: 0; color: ${MARK}; cursor: pointer; font: 600 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin-top: 6px; padding: 0; }
      .voice-review button { background: transparent; border: 0; color: ${MARK}; cursor: pointer; font: 600 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin-top: 6px; padding: 0; }
      .btn-cancel, .btn-add {
        border: 0;
        border-radius: 6px;
        font: 600 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        height: 32px;
        padding: 0 14px;
      }
      .btn-cancel { background: #f4f4f5; color: #111; }
      .btn-add { background: ${MARK}; color: #fff; }
      .btn-add:disabled { cursor: not-allowed !important; opacity: .55; }
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
          <span class="hint" data-hint="pin" data-i18n="overlay_hint_pin">${t("overlay_hint_pin")}</span>
          <span class="hint" data-hint="tune"><span class="keys"><kbd>↑</kbd><kbd>↓</kbd></span><span class="long" data-i18n="overlay_hint_tune_long">${t("overlay_hint_tune_long")}</span><span class="short" data-i18n="overlay_hint_tune_short">${t("overlay_hint_tune_short")}</span></span>
          <span class="hint" data-hint="copy"><span class="keys"><kbd>${copyShortcutLabel(apple)}</kbd></span><span class="long" data-i18n="overlay_hint_copy_long">${t("overlay_hint_copy_long")}</span><span class="short" data-i18n="overlay_hint_copy_short">${t("overlay_hint_copy_short")}</span></span>
          <span class="hint" data-hint="mask"><span class="keys"><kbd>M</kbd></span><span class="long" data-i18n="overlay_hint_mask_long">${t("overlay_hint_mask_long")}</span><span class="short" data-i18n="overlay_hint_mask_short">${t("overlay_hint_mask_short")}</span></span>
          <span class="hint" data-hint="regions"><span class="keys"><kbd>R</kbd></span><span data-i18n="overlay_hint_regions">${t("overlay_hint_regions")}</span></span>
          <span class="hint" data-hint="record"><span class="keys"><kbd>G</kbd></span><span class="long" data-i18n="overlay_hint_record_long">${t("overlay_hint_record_long")}</span><span class="short" data-i18n="overlay_hint_record_short">${t("overlay_hint_record_short")}</span></span>
          <span class="hint" data-hint="review"><span class="keys"><kbd>Tab</kbd></span><span class="long" data-i18n="overlay_session_review">${t("overlay_session_review")}</span><span class="short" data-i18n="overlay_review_short">${t("overlay_review_short")}</span></span>
          <span class="hint" data-hint="clear"><span class="keys"><kbd>esc</kbd></span><span class="long" data-i18n="overlay_hint_clear_long">${t("overlay_hint_clear_long")}</span><span class="short" data-i18n="overlay_hint_clear_short">${t("overlay_hint_clear_short")}</span></span>
        </span>
      </div>
      <div class="view progress-view" data-ref="progressView" hidden>
        <span class="state-icon progress-icon" aria-hidden="true">
          <svg class="progress-spinner" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>
          <svg class="progress-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>
          <svg class="progress-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
        </span>
        <span class="progress-text" data-ref="progressText"></span>
        <span class="progress-pct" data-ref="progressPct"></span>
      </div>
    </div>
    <div class="toast" data-ref="toast" role="status" aria-live="polite" hidden></div>
    <section class="review-panel" data-ref="reviewPanel" role="dialog" aria-label="${t("overlay_session_review")}" hidden>
      <div class="review-status-banner" data-ref="reviewStatus" role="status" aria-live="polite" hidden></div>
      <div data-ref="reviewList"></div>
      <div class="review-actions">
        <button class="btn-add" type="button" data-ref="reviewFinish" data-i18n="overlay_session_finish">${t("overlay_session_finish")}</button>
        <button class="btn-cancel" type="button" data-ref="reviewRetry" data-i18n="overlay_session_retry">${t("overlay_session_retry")}</button>
        <button class="btn-cancel" type="button" data-ref="reviewDiscard" data-i18n="overlay_session_discard">${t("overlay_session_discard")}</button>
      </div>
    </section>` : ""}
    <div class="outline" data-ref="outline"><span class="outline-badge" data-ref="outlineBadge"></span></div>
    <div data-ref="layer"></div>
    <div class="preview" data-ref="preview" hidden>
      <span class="preview-n" data-ref="previewN">1</span>
      <span class="preview-text" data-ref="previewText"></span>
    </div>
    <div class="composer" data-ref="composer" hidden>
      <div class="composer-card">
        <span class="composer-target" data-ref="selectionTag" hidden></span>
        <textarea data-ref="input" rows="1" placeholder="${t("overlay_comment")}"></textarea>
        <div class="voice-review" data-ref="voiceReview" hidden>
          <strong data-ref="voiceTranscriptLabel">${t("overlay_voice_transcript")}</strong>
          <p data-ref="voiceTranscript"></p>
          <button type="button" data-ref="voiceUseTranscript">${t("overlay_voice_use_transcript")}</button>
        </div>
        <div class="voice-feedback">
          <span class="voice-wave" data-ref="voiceWave" aria-hidden="true" hidden><i></i><i></i><i></i><i></i><i></i></span>
          <span class="voice-processing-indicator" data-ref="voiceProcessingIndicator" aria-hidden="true" hidden><i></i><i></i><i></i></span>
          <div class="voice-status" data-ref="voiceStatus" role="status" aria-live="polite"></div>
        </div>
        <div class="composer-actions">
          <span class="composer-tools">
            <button type="button" class="icon-btn is-ready" data-ref="deleteDraft" title="Delete" aria-label="Delete">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 11v6m-4-6v6M6 7v12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7M4 7h16M7 7l2-4h6l2 4"/>
              </svg>
            </button>
            <button type="button" class="icon-btn is-ready voice-btn" data-ref="voice" title="${t("overlay_voice_start")}" aria-label="${t("overlay_voice_start")}">
              <svg data-ref="voiceMic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v3 M8 22h8"/>
              </svg>
              <svg data-ref="voiceStop" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" hidden>
                <rect x="7" y="7" width="10" height="10" rx="1" fill="currentColor" />
              </svg>
            </button>
          </span>
          <button type="button" class="btn-cancel" data-ref="cancel" data-i18n="overlay_cancel">${t("overlay_cancel")}</button>
          <button type="button" class="btn-add" data-ref="save" data-i18n="overlay_add">${t("overlay_add")}</button>
        </div>
      </div>
    </div>
  `;

  const ui = {
    reviewPanel: shadow.querySelector("[data-ref=reviewPanel]"),
    reviewStatus: shadow.querySelector("[data-ref=reviewStatus]"),
    reviewList: shadow.querySelector("[data-ref=reviewList]"),
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
    onlineView: shadow.querySelector("[data-ref=onlineView]"),
    progressView: shadow.querySelector("[data-ref=progressView]"),
    progressText: shadow.querySelector("[data-ref=progressText]"),
    progressPct: shadow.querySelector("[data-ref=progressPct]"),
    voice: shadow.querySelector("[data-ref=voice]"),
    voiceReview: shadow.querySelector("[data-ref=voiceReview]"),
    voiceMic: shadow.querySelector("[data-ref=voiceMic]"),
    voiceStop: shadow.querySelector("[data-ref=voiceStop]"),
    voiceWave: shadow.querySelector("[data-ref=voiceWave]"),
    voiceProcessingIndicator: shadow.querySelector("[data-ref=voiceProcessingIndicator]"),
    voiceStatus: shadow.querySelector("[data-ref=voiceStatus]"),
    voiceTranscript: shadow.querySelector("[data-ref=voiceTranscript]"),
    voiceTranscriptLabel: shadow.querySelector("[data-ref=voiceTranscriptLabel]"),
    voiceUseTranscript: shadow.querySelector("[data-ref=voiceUseTranscript]"),
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
    if (pin.location?.evidence?.includes("manual-reposition")) {
      return { ...pin, location: pin.location };
    }
    if (pin.kind !== "element") {
      return { ...projectPin(pin, pinLayoutScroll(pin)), location: pin.location };
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

  function isScrollContainer(element) {
    if (!element || element === document.documentElement || element === document.body) return false;
    if (element === host || host.contains(element)) return false;
    // Help and the workspace scroll `[data-slot=scroll-area-viewport]`.
    // Trust the slot even when a stylesheet hides the native scrollbar.
    if (element.getAttribute?.("data-slot") === "scroll-area-viewport") {
      return element.scrollHeight > element.clientHeight + 1
        || element.scrollWidth > element.clientWidth + 1;
    }
    const style = getComputedStyle(element);
    return isScrollContainerRecord({
      clientHeight: element.clientHeight,
      clientWidth: element.clientWidth,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      scrollHeight: element.scrollHeight,
      scrollWidth: element.scrollWidth,
    });
  }

  function scrollRootsFromPoint(x, y) {
    const roots = [];
    const seen = new Set();
    function consider(node) {
      while (node && node !== document.documentElement && node !== document.body) {
        if (!seen.has(node) && isScrollContainer(node)) {
          seen.add(node);
          roots.push(node);
        }
        node = node.parentElement;
      }
    }
    const hit = targetFromPoint(x, y);
    if (hit) consider(hit);
    for (const start of document.elementsFromPoint(x, y)) {
      if (isHostNode(start)) continue;
      consider(start);
    }
    for (const viewport of document.querySelectorAll('[data-slot="scroll-area-viewport"]')) {
      const rect = viewport.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      consider(viewport);
    }
    return roots;
  }

  const watchedScrollRoots = new Set();
  function onLayoutScroll() {
    if (!isMounted()) return;
    updateOutline();
    renderMarkers();
  }
  function watchScrollRoots(roots) {
    for (const root of roots) {
      if (!root || watchedScrollRoots.has(root)) continue;
      watchedScrollRoots.add(root);
      root.addEventListener("scroll", onLayoutScroll, { passive: true });
    }
  }
  function unwatchScrollRoots() {
    for (const root of watchedScrollRoots) {
      root.removeEventListener("scroll", onLayoutScroll);
    }
    watchedScrollRoots.clear();
  }

  function pinLayoutScroll(pin) {
    let roots = Array.isArray(pin?.scrollRoots)
      ? pin.scrollRoots.filter((element) => element?.isConnected)
      : [];
    if (roots.length === 0 && pin?.box) {
      roots = scrollRootsFromPoint(
        pin.box.x + pin.box.width / 2,
        pin.box.y + pin.box.height / 2,
      );
      if (pin && Array.isArray(pin.scrollRoots)) pin.scrollRoots = roots;
    }
    watchScrollRoots(roots);
    return layoutScroll(currentScroll(), roots);
  }

  function viewportPin(pin) {
    if (pin.kind === "element") return locatePin(pin);
    return projectPin(pin, pinLayoutScroll(pin));
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

  async function sensitiveQueryKeys() {
    try {
      const stored = await chrome.storage.sync.get({ sensitiveQueryKeys: "" });
      return parseExtraKeys(stored.sensitiveQueryKeys);
    } catch {
      return [];
    }
  }

  // Technical evidence is a list of facts recorded on this page during the
  // session, graded by their link to the pinned element. URLs are redacted
  // here, before the pin ever leaves the frame; nothing is inferred.
  async function collectEvidence(element) {
    if (!evidenceStore) return undefined;
    try {
      const extraKeys = await sensitiveQueryKeys();
      return evidenceStore.collect(element, { redactUrl: (url) => sanitizeUrl(url, extraKeys).url });
    } catch (error) {
      console.warn("Pinar technical evidence skipped", error);
      return undefined;
    }
  }

  // The user's own clicks and typing on the page (not on the Pinar overlay)
  // anchor the after_interaction grade. Listening in the capture phase sees
  // them even when the page stops propagation.
  function trackInteraction(event) {
    if (fromUi(event)) return;
    if (isMounted() && isVisible() && state.active) return;
    evidenceStore?.interact(event.target);
    if (state.recording) reportStep(event);
  }

  // --- Reproduction recording (DJA-171) -----------------------------------
  // The user presses G, uses the page, then reopens Pinar to pin the result.
  // Steps are kept by the background per tab so they survive navigations;
  // the content script only describes what happened, with the same locators
  // a pin carries. Typed values in sensitive fields are never recorded.

  const recordingBadge = document.createElement("div");
  recordingBadge.setAttribute("data-pinar", "recording");
  Object.assign(recordingBadge.style, {
    all: "initial",
    background: "rgba(185, 28, 28, .96)",
    borderRadius: "999px",
    bottom: "16px",
    boxShadow: "0 6px 20px rgba(15,23,42,.25)",
    color: "#fff",
    display: "none",
    font: "600 12px/1.2 -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
    left: "16px",
    padding: "8px 12px",
    pointerEvents: "none",
    position: "fixed",
    zIndex: "2147483645",
  });

  function renderRecordingBadge(hidden = false) {
    const show = state.recording && !hidden && !(isMounted() && isVisible() && state.active);
    if (show) {
      recordingBadge.textContent = `● ${t("overlay_recording_badge").replaceAll("{count}", String(state.recordingCount)).replaceAll("{mod}", sendMod)}`;
      if (!recordingBadge.isConnected) document.documentElement.append(recordingBadge);
    }
    recordingBadge.style.display = show ? "" : "none";
  }

  function stepLocator(element) {
    if (!element || element.nodeType !== 1) return undefined;
    return {
      cssSelector: stableSelector(document, element) || cssPath(element),
      domPath: treePath(element),
      fingerprint: captureFingerprint(element),
      innerText: visibleText(element).slice(0, 60),
      tag: element.tagName.toLowerCase(),
    };
  }

  function fieldValue(element) {
    const tag = element.tagName?.toLowerCase();
    if (tag === "input") {
      const type = (element.getAttribute("type") || element.type || "text").toLowerCase();
      if (type === "checkbox" || type === "radio") return element.checked ? "checked" : "unchecked";
      return String(element.value ?? "");
    }
    if (tag === "select" || tag === "textarea") return String(element.value ?? "");
    if (element.isContentEditable) return String(element.textContent ?? "");
    return "";
  }

  function sensitiveField(element) {
    const attrs = {
      ariaLabel: element.getAttribute?.("aria-label") || "",
      autocomplete: element.getAttribute?.("autocomplete") || element.autocomplete || "",
      id: element.id || "",
      inputMode: element.getAttribute?.("inputmode") || "",
      name: element.getAttribute?.("name") || "",
      role: element.getAttribute?.("role") || "",
      type: (element.getAttribute?.("type") || element.type || "").toLowerCase(),
    };
    return Boolean(classifyFieldAttrs(attrs)) || attrs.type === "password";
  }

  function stepFromEvent(event) {
    const target = event.target;
    if (!target || target.nodeType !== 1) return null;
    const at = new Date().toISOString();
    if (event.type === "click") return { at, kind: "click", locator: stepLocator(target) };
    if (event.type === "input" || event.type === "change") {
      const editable = ["input", "textarea", "select"].includes(target.tagName?.toLowerCase()) || target.isContentEditable;
      if (!editable) return null;
      const step = { at, kind: "input", locator: stepLocator(target) };
      if (sensitiveField(target)) step.redacted = true;
      else step.value = fieldValue(target).slice(0, 200);
      return step;
    }
    if (event.type === "keydown") {
      if (!["Enter", "Escape", "Tab"].includes(event.key)) return null;
      return { at, kind: "key", locator: stepLocator(target), value: event.key };
    }
    return null;
  }

  function applyRecordingResponse(response) {
    if (!response?.ok) return;
    state.recordingCount = response.count ?? state.recordingCount;
    renderRecordingBadge();
  }

  function reportStep(event) {
    let step;
    try {
      step = stepFromEvent(event);
    } catch {
      step = null;
    }
    if (!step) return;
    chrome.runtime.sendMessage({ step, type: "recorder:step" }).then(applyRecordingResponse).catch(() => null);
  }

  let lastRecordedScrollY = null;
  let scrollStepTimer = 0;
  function reportScrollStep() {
    if (!state.recording || isEmbedded) return;
    if (isMounted() && isVisible() && state.active) return;
    clearTimeout(scrollStepTimer);
    scrollStepTimer = setTimeout(() => {
      const y = Math.round(window.scrollY || 0);
      if (lastRecordedScrollY !== null && Math.abs(y - lastRecordedScrollY) < 200) return;
      lastRecordedScrollY = y;
      chrome.runtime.sendMessage({ step: { at: new Date().toISOString(), kind: "scroll", value: `${y}px` }, type: "recorder:step" })
        .then(applyRecordingResponse)
        .catch(() => null);
    }, 400);
  }

  async function toggleRecording() {
    if (state.recording) {
      await chrome.runtime.sendMessage({ type: "recorder:cancel" }).catch(() => null);
      state.recording = false;
      state.recordingCount = 0;
      renderRecordingBadge();
      flashStatus(t("overlay_record_cancelled"));
      return;
    }
    const started = await chrome.runtime.sendMessage({ type: "recorder:start" }).catch(() => null);
    if (!started?.ok) return;
    state.recording = true;
    state.recordingCount = 0;
    lastRecordedScrollY = Math.round(window.scrollY || 0);
    flashStatus(t("overlay_record_started").replaceAll("{mod}", sendMod), "ok");
    // Hand the page back to the user; the badge reminds them Pinar listens.
    setTimeout(() => {
      if (!state.recording) return;
      setVisible(false);
      renderRecordingBadge();
    }, 900);
  }

  // After a navigation the background re-injects the content scripts and asks
  // this frame to carry on: same recording, toolbar out of the way.
  function resumeRecording(status) {
    if (!status?.recording) return false;
    state.recording = true;
    state.recordingCount = status.count ?? 0;
    lastRecordedScrollY = Math.round(window.scrollY || 0);
    setVisible(false);
    renderRecordingBadge();
    return true;
  }

  async function syncRecordingStatus() {
    if (isEmbedded) return;
    try {
      const status = await chrome.runtime.sendMessage({ type: "recorder:status" });
      if (status?.ok) resumeRecording(status);
    } catch {
      /* No background, no recording. */
    }
  }

  // The snapshot is best effort: a page that fights the baseline frame or an
  // exotic element must never block the pin itself.
  function safeSnapshot(element) {
    try {
      return captureSnapshot(element);
    } catch (error) {
      console.warn("Pinar snapshot skipped", error);
      return undefined;
    }
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
    const inProgress = host.hasAttribute("data-progress");
    const inConfirm = host.hasAttribute("data-confirm");
    const report = inProgress || inConfirm;
    if (ui.onlineView) ui.onlineView.hidden = report;
    if (ui.progressView) {
      ui.progressView.hidden = !report;
      ui.progressText.textContent = state.progressLabel ?? "";
      ui.toolbar.dataset.kind = report ? state.progressKind : "";
      ui.toolbar.style.setProperty("--progress", String(inProgress ? state.progress : 0));
      if (inProgress && state.progressTweened !== state.progress) {
        state.progressTweened = state.progress;
        tweenProgressPercent();
      } else if (!inProgress) {
        state.progressTweened = null;
        ui.progressPct.textContent = "";
      }
    }
    const hasStatus = Boolean(state.status);
    if (ui.toast) {
      ui.toast.hidden = !hasStatus;
      ui.toast.replaceChildren(Object.assign(document.createElement("span"), { textContent: state.status?.text ?? "" }));
      ui.toast.dataset.kind = state.status?.kind ?? "";
      ui.toast.style.setProperty("--progress", String(state.progress ?? 0));
    }
    if (ui.reviewStatus) {
      ui.reviewStatus.hidden = !hasStatus;
      ui.reviewStatus.textContent = state.status?.text ?? "";
      ui.reviewStatus.dataset.kind = state.status?.kind ?? "";
    }
    document.documentElement.toggleAttribute("data-pinar-mask-mode", state.maskMode);
  }

  // The percentage moves with the fill (same 240ms as its transition) instead
  // of jumping between phases, and the final (done) label only lands
  // once both have reached 100%: a green done label over a half-full bar is a lie.
  const PROGRESS_TWEEN_MS = 240;
  function tweenProgressPercent() {
    cancelAnimationFrame(state.progressRaf);
    const from = state.progressShown;
    const target = Math.round(state.progress * 100);
    const started = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - started) / PROGRESS_TWEEN_MS);
      state.progressShown = Math.round(from + (target - from) * (1 - (1 - k) * (1 - k)));
      if (ui.progressPct) ui.progressPct.textContent = `${state.progressShown}%`;
      if (k < 1) {
        state.progressRaf = requestAnimationFrame(step);
        return;
      }
      if (target === 100 && state.progressFinal) {
        const { kind, label } = state.progressFinal;
        state.progressFinal = null;
        state.progressLabel = label;
        state.progressKind = kind;
        if (ui.progressText) ui.progressText.textContent = label;
        if (ui.toolbar) ui.toolbar.dataset.kind = kind;
      }
    };
    state.progressRaf = requestAnimationFrame(step);
  }

  function setProgress(label, progress, kind = "info") {
    host.removeAttribute("data-confirm");
    host.setAttribute("data-progress", "");
    state.progress = progress;
    if (progress >= 1 && kind !== "info") {
      // Keep the in-progress wording until the bar is visibly full.
      state.progressFinal = { kind, label };
    } else {
      state.progressLabel = label;
      state.progressKind = kind;
    }
    renderChrome();
  }

  function clearProgress() {
    cancelAnimationFrame(state.progressRaf);
    host.removeAttribute("data-progress");
    host.removeAttribute("data-confirm");
    state.progressFinal = null;
    state.progressLabel = null;
    state.progress = 0;
    state.progressShown = 0;
    state.progressKind = "info";
  }

  function showConfirm(label, kind = "ok") {
    cancelAnimationFrame(state.progressRaf);
    host.removeAttribute("data-progress");
    host.setAttribute("data-confirm", "");
    state.progressFinal = null;
    state.progress = 0;
    state.progressShown = 0;
    state.progressLabel = label;
    state.progressKind = kind;
    if (!host.isConnected) document.documentElement.append(host);
    host.style.display = "";
    ui.toolbar?.classList.remove("pass-through");
    renderChrome();
  }

  function setStatus(text, kind = "info", progress = null) {
    clearTimeout(state.statusTimer);
    state.status = text ? { kind, text } : null;
    if (progress !== null) state.progress = progress;
    if (!text) state.progress = 0;
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
      entries: next?.entries || [],
      nextNumber: next?.nextNumber || 1,
    };
    for (const pin of state.pins) {
      const entry = state.batch.entries.find((entry) => entry.pinId === (pin.pinId || pin.id));
      if (entry?.number) { pin.number = entry.number; pin.color = pinColor(entry.number); }
    }
    renderMarkers();
    renderReviewList();
    if (!next?.toast) {
      renderChrome();
      return;
    }
    const kind = next.toastKind === "error" ? "error" : "ok";
    const wasVisible = isVisible();
    // Same confirmation bar as a finished capture, without the fill or the 100%.
    // The pin toolbar must not come along.
    showConfirm(next.toast, kind);
    clearTimeout(state.statusTimer);
    state.statusTimer = setTimeout(() => {
      host.removeAttribute("data-confirm");
      state.progressLabel = null;
      state.progressKind = "info";
      if (!wasVisible) host.style.display = "none";
      renderChrome();
    }, COPY_CONFIRMATION_MS);
  }

  function renderReviewList() {
    if (!ui.reviewList) return;
    if (shadow.activeElement?.matches(".review-comment:not(:disabled)")) return;
    for (const name of ["reviewFinish", "reviewDiscard"]) {
      shadow.querySelector(`[data-ref=${name}]`).disabled = !state.batch.entries?.length;
    }
    shadow.querySelector("[data-ref=reviewRetry]").hidden = !state.batch.entries?.some((entry) => entry.status !== "saved");
    ui.reviewList.replaceChildren();
    for (const entry of state.batch.entries || []) {
      const row = document.createElement("div");
      row.className = "review-row";
      const heading = document.createElement("div");
      heading.className = "review-heading";
      const badge = document.createElement("span");
      badge.className = "review-pin";
      badge.style.background = pinColor(entry.number);
      badge.textContent = entry.number;
      const title = document.createElement("strong");
      title.textContent = entry.page.title || entry.page.url;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "review-remove";
      remove.title = t("overlay_session_remove");
      remove.setAttribute("aria-label", t("overlay_session_remove"));
      remove.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="m6 6 12 12M6 18 18 6"/></svg>';
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        const response = await chrome.runtime.sendMessage({ type: "review:remove", captureId: entry.captureId });
        if (!response?.ok) { remove.disabled = false; flashStatus(t("overlay_session_pending")); }
      });
      heading.append(badge, title, remove);
      const target = document.createElement("div");
      target.className = "review-target";
      target.textContent = entry.type === "area" ? t("overlay_hint_regions") : entry.tag || "";
      const comment = document.createElement("textarea");
      comment.className = "review-comment";
      comment.value = entry.comment;
      comment.setAttribute("aria-label", t("overlay_comment"));
      comment.rows = 2;
      comment.addEventListener("keydown", (event) => event.stopPropagation());
      comment.addEventListener("change", async () => {
        if (!comment.value.trim()) { comment.value = entry.comment; return; }
        comment.disabled = true;
        const response = await chrome.runtime.sendMessage({ type: "review:edit", captureId: entry.captureId, comment: sanitizeCapture({ fields: activeScan().fields, page: pageContext(), pins: [{ comment: comment.value }] }).pins[0].comment });
        comment.disabled = false;
        status.textContent = t(response?.ok ? "overlay_session_saved" : "overlay_session_pending");
      });
      const status = document.createElement("small");
      status.className = "review-status";
      status.setAttribute("role", "status");
      status.textContent = entry.status === "saved" ? t("overlay_session_captured") : t("overlay_session_pending");
      row.append(heading, target, comment);
      if (entry.path) {
        const path = document.createElement("code");
        path.className = "review-path";
        path.textContent = entry.path;
        path.title = entry.path;
        row.append(path);
      }
      if (!ui.reviewPanel.hidden) chrome.runtime.sendMessage({ type: "review:preview", captureId: entry.captureId }).then((response) => {
        if (!response?.preview || !row.isConnected) return;
        const preview = document.createElement("img");
        preview.className = "review-preview";
        preview.src = response.preview;
        preview.alt = title.textContent;
        row.insertBefore(preview, status);
      }).catch(() => null);
      row.append(status);
      ui.reviewList.append(row);
    }
    if (!state.batch.entries?.length) ui.reviewList.textContent = t("overlay_session_start");
  }

  function setReviewOpen(open) {
    if (!ui.reviewPanel) return;
    ui.reviewPanel.hidden = !open;
    if (open) renderReviewList();
    host.toggleAttribute("data-review-open", open);
    document.documentElement.toggleAttribute("data-pinar-active", state.active && !open);
    if (open) document.documentElement.removeAttribute("data-pinar-mask-mode");
    hideOutline();
  }
  shadow.querySelector("[data-ref=reviewFinish]")?.addEventListener("click", () => void sendPins());
  shadow.querySelector("[data-ref=reviewRetry]")?.addEventListener("click", async () => {
    await syncPins(true);
    const response = await chrome.runtime.sendMessage({ type: "review:retry" });
    if (!response?.ok) flashStatus(t("overlay_session_pending"));
  });
  shadow.querySelector("[data-ref=reviewDiscard]")?.addEventListener("click", async () => {
    const response = await chrome.runtime.sendMessage({ type: "review:discard" });
    if (!response?.ok) flashStatus(t("overlay_session_pending"));
  });

  async function syncBatchLabel() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "batch:get" });
      applyBatchState(response?.ok ? response : null);
    } catch {
      applyBatchState(null);
    }
  }

  function applyOverlayCopy() {
    shadow.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.getAttribute("data-i18n"));
    });
    if (ui.input) ui.input.placeholder = t("overlay_comment");
    if (ui.voiceTranscriptLabel) ui.voiceTranscriptLabel.textContent = t("overlay_voice_transcript");
    if (ui.voiceUseTranscript) ui.voiceUseTranscript.textContent = t("overlay_voice_use_transcript");
    ui.reviewPanel?.setAttribute("aria-label", t("overlay_session_review"));
    renderVoiceControls();
    renderChrome();
  }

  function applyUiMessages(next) {
    ui.toolbar?.classList.remove("pass-through");
    if (!next?.messages || typeof next.messages !== "object") return;
    messages = next.messages;
    applyOverlayCopy();
  }

  async function syncUiMessages() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "ui:messages" });
      if (response?.ok) applyUiMessages(response);
    } catch {
      /* keep English fallback */
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
    // While a capture is being copied the overlay is a status display, not a
    // picker: no outline, no new pins, until it closes or reopens fresh.
    return state.active && !host.hasAttribute("data-review-open") && !state.sending;
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
        state.maskMode ? "#111827" : pinColor(nextPinNumber()),
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
        draft.color || pinColor(nextPinNumber()),
        true,
      );
      return;
    }
    if (state.hoverPinId) {
      const pin = state.pins.find((item) => item.id === state.hoverPinId);
      if (pin?.box) {
        if (state.showPinRegions) {
          hideOutline();
        } else {
          const visiblePin = viewportPin(pin);
          showOutline(visiblePin.box, pin.kind === "area", false, pin.color || pinColor(state.pins.indexOf(pin) + 1));
        }
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

  function markerHtml(point, index, pinId, color = pinColor(index + 1), location) {
    const body = `${bubbleSvg({ color })}<span class="marker-n">${index + 1}</span>`;
    const pending = isPendingLocation(location);
    const confidence = location?.confidence ? ` data-location-confidence="${escapeAttr(location.confidence)}"` : "";
    const cls = pending ? "marker is-pending" : "marker";
    if (pinId) {
      return `<button type="button" class="${cls}" data-pin="${pinId}"${confidence} style="left:${point.x}px;top:${point.y}px">${body}</button>`;
    }
    return `<span class="${cls}" data-draft="1"${confidence} style="left:${point.x}px;top:${point.y}px">${body}</span>`;
  }

  function pinRegionHtml(pin, index) {
    const visible = viewportPin(pin);
    const box = visible.box;
    if (!box || box.width <= 2 || box.height <= 2) return "";
    const color = pin.color || pinColor(index + 1);
    const area = pin.kind === "area";
    return `<div class="pin-region${area ? " area" : ""}" style="background:${colorWithAlpha(color, area ? 0.1 : 0.055)};border-color:${color};height:${box.height}px;left:${box.x}px;top:${box.y}px;width:${box.width}px"></div>`;
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
    const regions = state.showPinRegions
      ? state.pins.map((pin, index) => pinRegionHtml(pin, index)).filter(Boolean)
      : [];
    const markers = state.pins.map((pin, index) => {
      const visible = viewportPin(pin);
      return markerHtml(
        pinPoint(visible),
        (pin.number || index + 1) - 1,
        pin.id,
        pin.color,
        visible.location,
      );
    });
    if (state.draft && !state.draft.editId) {
      const visible = viewportPin(state.draft);
      markers.push(markerHtml(pinPoint(visible), nextPinNumber() - 1, undefined, state.draft.color, visible.location));
    }
    ui.layer.innerHTML = `${masks.join("")}${regions.join("")}${markers.join("")}`;
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
    flashStatus(t("overlay_region_hidden"), "ok");
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
    flashStatus(state.maskMode ? t("overlay_mask_mode") : t("overlay_pin_mode"), "ok");
  }

  function applyPinRegions(show, { flash = false } = {}) {
    state.showPinRegions = Boolean(show);
    renderMarkers();
    updateOutline();
    if (flash) {
      flashStatus(state.showPinRegions ? t("overlay_regions_on") : t("overlay_regions_off"), "ok");
    }
  }

  function togglePinRegions() {
    if (isEmbedded) {
      window.top.postMessage({ type: FRAME_REGIONS }, "*");
      return;
    }
    applyPinRegions(!state.showPinRegions, { flash: true });
    broadcastToChildFrames(FRAME_REGIONS, { show: state.showPinRegions });
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
    ui.previewN.textContent = String(pin.number || index + 1);
    ui.previewN.style.background = pin.color || pinColor(index + 1);
    ui.previewText.textContent = pin.comment.replaceAll("\n", " ");
    const visible = viewportPin(pin);
    const bits = [];
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
  let voiceAvailable = false;
  let voiceRecorder = null;
  let voiceStream = null;
  let voiceStartedAt = 0;
  let voiceTimer = 0;
  let voiceLimitTimer = 0;
  let voiceAudioContext = null;
  let voiceAudioSource = null;
  let voiceAnalyser = null;
  let voiceWaveData = null;
  let voiceWaveFrame = 0;
  let voiceWaveLevel = 0;
  let voiceProcessing = false;
  let voiceTranscriptComment = "";
  const cancelledVoiceRecorders = new WeakSet();

  function renderVoiceControls() {
    if (!ui.voice) return;
    const recording = voiceRecorder?.state === "recording";
    ui.voice.hidden = !voiceAvailable;
    const title = !voiceAvailable
      ? t("overlay_voice_local_only")
      : recording ? t("overlay_voice_stop") : t("overlay_voice_start");
    ui.voice.title = title;
    ui.voice.setAttribute("aria-label", title);
    ui.voice.disabled = voiceProcessing;
    ui.voice.classList.toggle("is-recording", recording);
    ui.voiceMic.hidden = recording;
    ui.voiceStop.hidden = !recording;
    ui.voiceWave.hidden = !recording;
    ui.voiceProcessingIndicator.hidden = !voiceProcessing;
    ui.save.disabled = voiceProcessing || recording;
  }

  function setVoiceStatus(text = "", kind = "info") {
    ui.voiceStatus.textContent = text;
    ui.voiceStatus.dataset.kind = kind;
  }

  function voiceErrorMessage(response) {
    if (response?.status === 401 || response?.status === 403) return t("overlay_voice_auth");
    if (response?.status === 402 || response?.code === "insufficient_ai_credits") return t("overlay_voice_credits");
    if (response?.code === "invalid_audio" || response?.code === "invalid_audio_duration" || response?.code === "unsupported_audio") {
      return t("overlay_voice_invalid");
    }
    if (response?.code === "ai_inference_failed") return t("overlay_voice_refunded");
    if (response?.code === "network_error") return t("overlay_voice_network");
    return t("overlay_voice_failed");
  }

  function clearVoiceTimers() {
    clearInterval(voiceTimer);
    clearTimeout(voiceLimitTimer);
    voiceTimer = 0;
    voiceLimitTimer = 0;
  }

  function renderVoiceWave(level, timestamp = 0) {
    const heights = voiceWaveHeights(level, timestamp / 140);
    for (const [index, bar] of [...ui.voiceWave.children].entries()) {
      bar.style.setProperty("--voice-bar-height", `${heights[index] || 3}px`);
      bar.style.setProperty("--voice-bar-opacity", String(0.45 + Math.min(1, level) * 0.55));
    }
  }

  function stopVoiceMeter() {
    cancelAnimationFrame(voiceWaveFrame);
    voiceWaveFrame = 0;
    try { voiceAudioSource?.disconnect(); } catch { /* already disconnected */ }
    try { voiceAnalyser?.disconnect(); } catch { /* already disconnected */ }
    const context = voiceAudioContext;
    voiceAudioContext = null;
    voiceAudioSource = null;
    voiceAnalyser = null;
    voiceWaveData = null;
    voiceWaveLevel = 0;
    renderVoiceWave(0);
    if (context?.state !== "closed") void context?.close?.().catch(() => null);
  }

  function startVoiceMeter(stream) {
    stopVoiceMeter();
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      voiceAudioContext = new AudioContextClass();
      voiceAudioSource = voiceAudioContext.createMediaStreamSource(stream);
      voiceAnalyser = voiceAudioContext.createAnalyser();
      voiceAnalyser.fftSize = 256;
      voiceAudioSource.connect(voiceAnalyser);
      voiceWaveData = new Uint8Array(voiceAnalyser.fftSize);
      void voiceAudioContext.resume?.().catch(() => null);
      const sample = (timestamp) => {
        if (!voiceAnalyser || voiceStream !== stream) return;
        voiceAnalyser.getByteTimeDomainData(voiceWaveData);
        const measured = voiceSignalLevel(voiceWaveData);
        const smoothing = measured > voiceWaveLevel ? 0.55 : 0.18;
        voiceWaveLevel += (measured - voiceWaveLevel) * smoothing;
        if (voiceWaveLevel < 0.015) voiceWaveLevel = 0;
        renderVoiceWave(voiceWaveLevel, timestamp);
        voiceWaveFrame = requestAnimationFrame(sample);
      };
      voiceWaveFrame = requestAnimationFrame(sample);
    } catch {
      stopVoiceMeter();
    }
  }

  function closeVoiceStream() {
    stopVoiceMeter();
    for (const track of voiceStream?.getTracks?.() || []) track.stop();
    voiceStream = null;
  }

  function discardVoiceRecording() {
    clearVoiceTimers();
    if (voiceRecorder?.state === "recording") {
      cancelledVoiceRecorders.add(voiceRecorder);
      voiceRecorder.stop();
    }
    closeVoiceStream();
    voiceRecorder = null;
    voiceProcessing = false;
    renderVoiceControls();
  }

  function resetVoiceUi() {
    discardVoiceRecording();
    ui.voiceReview.hidden = true;
    ui.voiceTranscript.textContent = "";
    voiceTranscriptComment = "";
    setVoiceStatus();
  }

  async function refreshVoiceAvailability() {
    const response = await chrome.runtime.sendMessage({ type: "voice:availability" }).catch(() => null);
    voiceAvailable = response?.ok === true && response.available === true;
    renderVoiceControls();
  }

  function blobDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
      reader.addEventListener("error", () => reject(reader.error || new Error("Unable to read recording")), { once: true });
      reader.readAsDataURL(blob);
    });
  }

  async function finishVoiceRecording(recorder, stream, chunks) {
    clearVoiceTimers();
    stopVoiceMeter();
    for (const track of stream?.getTracks?.() || []) track.stop();
    if (voiceStream === stream) voiceStream = null;
    if (voiceRecorder === recorder) voiceRecorder = null;
    renderVoiceControls();
    if (cancelledVoiceRecorders.has(recorder)) return;
    const durationSeconds = boundedVoiceDuration(voiceStartedAt, performance.now());
    const blob = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
    if (!blob.size || !state.draft) return;
    voiceProcessing = true;
    setVoiceStatus(t("overlay_voice_processing"));
    renderVoiceControls();
    try {
      const response = await chrome.runtime.sendMessage({
        audioDataUrl: await blobDataUrl(blob),
        durationSeconds,
        requestId: crypto.randomUUID(),
        type: "voice:transcribe",
      });
      if (!response?.ok) throw response || { code: "network_error" };
      const transcript = typeof response.result?.transcript === "string" ? response.result.transcript.trim() : "";
      const structured = formatVoiceComment(response.result, t("overlay_voice_acceptance"));
      if (!transcript || !structured) throw new Error("Voice transcription was empty");
      const sanitized = sanitizeCapture({
        fields: activeScan().fields,
        page: pageContext(),
        pins: [{ comment: structured }],
      }).pins[0]?.comment || "";
      ui.voiceTranscript.textContent = transcript;
      voiceTranscriptComment = sanitizeCapture({
        fields: activeScan().fields,
        page: pageContext(),
        pins: [{ comment: transcript }],
      }).pins[0]?.comment || "";
      ui.voiceReview.hidden = transcript === structured;
      ui.input.value = sanitized;
      fitInput();
      setVoiceStatus(t("overlay_voice_ready"));
      ui.input.focus({ preventScroll: true });
      ui.input.setSelectionRange(ui.input.value.length, ui.input.value.length);
    } catch (error) {
      setVoiceStatus(voiceErrorMessage(error), "error");
    } finally {
      voiceProcessing = false;
      renderVoiceControls();
    }
  }

  async function startVoiceRecording() {
    if (!state.draft || voiceProcessing) return;
    if (voiceRecorder?.state === "recording") {
      voiceRecorder.stop();
      return;
    }
    await refreshVoiceAvailability();
    if (!voiceAvailable) {
      setVoiceStatus(t("overlay_voice_local_only"), "error");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setVoiceStatus(t("overlay_voice_permission"), "error");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStream = stream;
      const mimeType = preferredVoiceMimeType(MediaRecorder);
      const chunks = [];
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      voiceRecorder = recorder;
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data?.size) chunks.push(event.data);
      });
      recorder.addEventListener("stop", () => void finishVoiceRecording(recorder, stream, chunks), { once: true });
      recorder.addEventListener("error", () => {
        discardVoiceRecording();
        setVoiceStatus(t("overlay_voice_failed"), "error");
      }, { once: true });
      voiceStartedAt = performance.now();
      recorder.start(1_000);
      startVoiceMeter(stream);
      const updateElapsed = () => {
        const seconds = Math.min(120, Math.max(0, Math.floor((performance.now() - voiceStartedAt) / 1000)));
        setVoiceStatus(t("overlay_voice_recording").replace("{seconds}", String(seconds)));
      };
      updateElapsed();
      voiceTimer = setInterval(updateElapsed, 1_000);
      voiceLimitTimer = setTimeout(() => {
        if (voiceRecorder?.state === "recording") voiceRecorder.stop();
      }, 120_000);
      renderVoiceControls();
    } catch {
      closeVoiceStream();
      voiceRecorder = null;
      setVoiceStatus(t("overlay_voice_permission"), "error");
      renderVoiceControls();
    }
  }

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
    resetVoiceUi();
    void refreshVoiceAvailability();
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

  function nextPinNumber() {
    return Math.max(state.batch.nextNumber || 1, ...state.pins.map((pin) => (pin.number || 0) + 1));
  }
  function saveDraft() {
    if (!state.draft) return true;
    if (voiceProcessing || voiceRecorder?.state === "recording") return false;
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
        number: nextPinNumber(),
        color: state.draft.color || pinColor(nextPinNumber()),
        comment,
        id: crypto.randomUUID(),
      });
    }
    state.draft = null;
    renderChrome();
    pendingReviewSync = syncPins(true);
    updateOutline();
    renderMarkers();
    return true;
  }

  function deleteDraft() {
    if (state.draft?.editId) {
      state.pins = state.pins.filter((pin) => pin.id !== state.draft.editId);
      pendingReviewSync = syncPins(true);
    }
    cancelDraft();
  }

  async function syncPins(persist = false) {
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
      let working = pin;
      if (working.kind === "area") {
        // Area boxes are viewport rects plus nested layout scroll. Capture
        // tiles the window, so convert the *current* projected viewport box
        // into window-document space. Using the creation-time documentBox
        // leaves the overlay glued to the viewport after a ScrollArea move.
        const visible = projectPin(working, pinLayoutScroll(working));
        const scroll = currentScroll();
        return {
          ...working,
          anchor: documentPoint(visible.anchor, scroll),
          box: documentBox(visible.box, scroll),
          historicalAnchor: working.historicalAnchor,
          historicalBox: working.historicalBox,
          scroll: { x: 0, y: 0 },
          topBox: documentBox(visible.box, scroll),
        };
      }
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
      persist,
      documentId: currentReviewDocumentId(),
      ...(persist ? {
        // Values stay inside the trusted extension long enough for the worker
        // to redact matching secrets from comments/locators before persistence.
        fields: activeScan().fields,
        unevaluated: activeScan().unevaluated,
        masks: activeMaskRegions().map((mask) => ({ ...mask, box: { ...mask.box, x: mask.box.x + (isEmbedded ? offset.x + topScroll.x - currentScroll().x : 0), y: mask.box.y + (isEmbedded ? offset.y + topScroll.y - currentScroll().y : 0) } })),
      } : {}),
      type: "pins:sync",
    }).catch(() => null);
    if (persist && !response?.ok) flashStatus(t("overlay_session_pending"));
    const synced = response?.ok === true;
    if (synced) {
      const colorsById = new Map(response.pins.map((pin) => [pin.id, pin.color]));
      state.pins = state.pins.map((pin) => ({ ...pin, color: pin.number ? pinColor(pin.number) : colorsById.get(pin.id) || pin.color }));
      state.tabPinCount = response.pins.length;
    }
    renderChrome();
    renderMarkers();
    return synced;
  }

  function cancelDraft() {
    resetVoiceUi();
    state.draft = null;
    renderChrome();
    updateOutline();
    renderMarkers();
  }

  function resetLocalPins() {
    resetVoiceUi();
    state.pins = [];
    state.draft = null;
    state.tabPinCount = 0;
    state.hoverPinId = null;
    state.maskMode = false;
    state.userMasks = [];
    state.dismissedMaskIds = new Set();
    renderChrome();
    updateOutline();
    renderMarkers();
  }

  async function clearPins() {
    resetLocalPins();
    await chrome.runtime.sendMessage({ type: "pins:clear" }).catch(() => null);
  }

  async function discardAnnotations() {
    state.pins = [];
    pendingReviewSync = syncPins(true);
    await pendingReviewSync;
    await clearPins();
    broadcast(FRAME_CLEAR);
  }

  function broadcastToChildFrames(type, extra = {}) {
    for (let index = 0; index < window.frames.length; index += 1) {
      window.frames[index].postMessage({ type, ...extra }, "*");
    }
  }

  function broadcast(type) {
    if (isEmbedded) window.top.postMessage({ type }, "*");
    else broadcastToChildFrames(type);
  }

  function dismiss() {
    resetLocalPins();
    evidenceStore?.reset();
    state.recording = false;
    state.recordingCount = 0;
    setVisible(false);
    renderRecordingBadge();
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
    const scrollRoots = scrollRootsFromPoint(
      box.x + box.width / 2,
      box.y + box.height / 2,
    );
    const nestedScroll = layoutScroll(scroll, scrollRoots);
    watchScrollRoots(scrollRoots);
    openDraft({
      anchor,
      box,
      documentAnchor: documentPoint(anchor, nestedScroll),
      documentBox: documentBox(box, nestedScroll),
      evidence: await collectEvidence(null),
      kind: "area",
      label: `selected area (${box.width}×${box.height}px)`,
      layoutScroll: nestedScroll,
      scroll,
      scrollRoots,
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
      evidence: await collectEvidence(element),
      scroll,
      snapshot: safeSnapshot(element),
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

  // Physical keys whose keydown we suppressed; their keyup/keypress must be
  // suppressed too, even if the same key deactivated pin mode meanwhile.
  const ownedKeyCodes = new Set();

  function onKey(event) {
    if (!isMounted()) return;
    if (!state.active) return;
    if (event.composedPath()[0]?.matches?.(".review-comment")) return;
    // onKey fully owns these two keys: never let the page see them, even when
    // they originate inside the composer (e.g. Esc closing a page modal).
    if (isCopyShortcut(event, apple)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      ownedKeyCodes.add(event.code);
      void sendPins();
      return;
    }
    if (!state.draft && !state.sending && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === "Tab") {
      event.preventDefault();
      event.stopImmediatePropagation();
      ownedKeyCodes.add(event.code);
      if (isEmbedded) window.top.postMessage({ type: "pinar:frame-review" }, "*");
      else setReviewOpen(!host.hasAttribute("data-review-open"));
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
      if (host.hasAttribute("data-review-open")) { setReviewOpen(false); return; }
      setVisible(false);
      if (!isEmbedded) void chrome.runtime.sendMessage({ type: "toolbar:visibility", visible: false }).catch(() => null);
      if (isEmbedded) window.top.postMessage({ type: FRAME_HIDE }, "*");
      else broadcast(FRAME_HIDE);
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
    if (
      !path.includes(host)
      && !event.metaKey
      && !event.ctrlKey
      && !event.altKey
      && (event.key === "r" || event.key === "R")
    ) {
      event.preventDefault();
      togglePinRegions();
      return;
    }
    if (!canSelect() || state.draft) return;
    if (event.key === "m" || event.key === "M") {
      event.preventDefault();
      toggleMaskMode();
      return;
    }
    if ((event.key === "g" || event.key === "G") && !isEmbedded) {
      event.preventDefault();
      void toggleRecording();
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
    // apps may react to Escape or the copy shortcut on keyup even with keydown blocked.
    if (event.key === "Escape" || isCopyShortcut(event, apple)) {
      event.stopImmediatePropagation();
      return;
    }
    if (!event.composedPath().includes(host)) event.stopImmediatePropagation();
  }

  async function sendPins() {
    if (!isMounted() || !state.active || state.sending) return;
    if (isEmbedded) {
      if (!saveDraft()) {
        flashStatus(t("overlay_write_comment"));
        return;
      }
      await syncPins();
      await pendingReviewSync;
      window.top.postMessage({ type: FRAME_SEND }, "*");
      return;
    }
    if (!saveDraft()) {
      flashStatus(t("overlay_write_comment"));
      return;
    }
    if (!state.batch.active && state.pins.length === 0) {
      flashStatus(t("overlay_add_pin_first"));
      return;
    }
    state.sending = true;
    host.setAttribute("aria-busy", "true");
    try {
      await pendingReviewSync;
      const result = await chrome.runtime.sendMessage({ type: "review:finish" });
      if (!result?.ok) throw new Error(result?.error || "session_pending");
      await clearPins();
      broadcast(FRAME_CLEAR);
    } catch {
      flashStatus(t("overlay_session_finish_failed"));
      setReviewOpen(true);
    } finally {
      state.sending = false;
      host.setAttribute("aria-busy", "false");
      if (state.reopenAfterSend) {
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
    if (event.data?.type === "pinar:frame-review" && !isEmbedded) {
      setVisible(true);
      setReviewOpen(true);
      return;
    }
    if (event.data?.type === FRAME_SHOW) {
      setVisible(true);
      broadcastToChildFrames(FRAME_SHOW);
      return;
    }
    if (event.data?.type === FRAME_REGIONS) {
      if (isEmbedded) {
        if (typeof event.data.show === "boolean") {
          applyPinRegions(event.data.show);
          broadcastToChildFrames(FRAME_REGIONS, { show: event.data.show });
        } else {
          window.top.postMessage({ type: FRAME_REGIONS }, "*");
        }
        return;
      }
      if (typeof event.data.show === "boolean") return;
      togglePinRegions();
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
    renderRecordingBadge(hidden);
    host.style.display = hidden || !state.active ? "none" : "";
    if (hidden) {
      document.documentElement.removeAttribute("data-pinar-active");
      document.documentElement.removeAttribute("data-pinar-mask-mode");
    } else if (state.active && !host.hasAttribute("data-review-open")) {
      document.documentElement.setAttribute("data-pinar-active", "true");
      applyGlobalStyles();
    }
  }

  function isVisible() {
    return host.isConnected && state.active && host.style.display !== "none";
  }

  function setVisible(visible) {
    if (!visible) {
      setReviewOpen(false);
      discardVoiceRecording();
    }
    if (visible && !host.isConnected) document.documentElement.append(host);
    clearProgress();
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
      void syncUiMessages();
      return;
    }
    document.documentElement.removeAttribute("data-pinar-active");
    document.documentElement.removeAttribute("data-pinar-mask-mode");
    removeGlobalStyles();
    renderRecordingBadge();
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
  ui.voice.addEventListener("click", () => void startVoiceRecording());
  ui.voiceUseTranscript.addEventListener("click", () => {
    if (!voiceTranscriptComment) return;
    ui.input.value = voiceTranscriptComment;
    fitInput();
    ui.input.focus({ preventScroll: true });
  });
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
    openPinEditor(pinId);
  });

  window.addEventListener("click", trackInteraction, true);
  window.addEventListener("input", trackInteraction, true);
  window.addEventListener("change", trackInteraction, true);
  window.addEventListener("keydown", trackInteraction, true);
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
    reportScrollStep();
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

  function teardown() {
    if (!host.isConnected && !state.active) return;
    clearTimeout(state.statusTimer);
    clearTimeout(relocateTimer);
    relocateObserver.disconnect();
    unwatchScrollRoots();
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
    delete globalThis.__pinarResumeRecording;
    recordingBadge.remove();
  }

  function toggle() {
    if (state.sending) {
      // A capture is mid-flight: screenshot, clipboard, confirmation, then the
      // tear-down. Flipping visibility now would either put the toolbar in the
      // screenshot or resurrect the finished session for the tear-down to wipe
      // again, taking the user's next pins with it. Queue the request instead:
      // a fresh toolbar opens once the confirmation has shown and the old
      // state is gone.
      state.reopenAfterSend = true;
      return;
    }
    const visible = !isVisible();
    setVisible(visible);
    if (!isEmbedded) void chrome.runtime.sendMessage({ type: "toolbar:visibility", visible }).catch(() => null);
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
  globalThis.__pinarResumeRecording = resumeRecording;
  globalThis.__pinarReviewContext = () => ({
    documentId: currentReviewDocumentId(), url: location.href, page: pageContext(),
    scroll: currentScroll(), width: window.innerWidth, height: window.innerHeight,
    masks: activeMaskRegions(), unevaluated: activeScan().unevaluated,
  });
  globalThis.chrome?.runtime?.onMessage?.addListener?.((message, _sender, sendResponse) => {
    if (message?.type === "review:navigated") {
      resetLocalPins();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "review:pin-edited") {
      for (const pin of state.pins) if ((pin.pinId || pin.id) === message.pinId) pin.comment = message.comment;
      renderMarkers();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "review:pin-removed") {
      state.pins = state.pins.filter((pin) => (pin.pinId || pin.id) !== message.pinId);
      if (state.draft?.editId === message.pinId) state.draft = null;
      void syncPins();
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "review:ended") {
      resetLocalPins();
      state.recording = false;
      state.recordingCount = 0;
      renderRecordingBadge();
      setReviewOpen(false);
      setVisible(false);
      if (message.feedback === "cancelled" || message.feedback === "finished") {
        host.style.display = "";
        showConfirm(t(message.feedback === "cancelled" ? "overlay_session_cancelled" : "overlay_session_finished"));
        setTimeout(() => { host.removeAttribute("data-confirm"); host.style.display = "none"; }, COPY_CONFIRMATION_MS);
      }
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "copy:progress") {
      if (state.sending && typeof message.progress === "number") {
        setProgress(t("overlay_copying"), message.progress);
      }
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "batch:changed") {
      applyBatchState(message);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "review:open") {
      setVisible(true);
      setReviewOpen(true);
      sendResponse({ ok: true });
      return false;
    }
    if (message?.type === "ui:messages") {
      applyUiMessages(message);
      sendResponse({ ok: true });
      return false;
    }
    return false;
  });
  if (initialVisible) {
    document.documentElement.setAttribute("data-pinar-active", "true");
    applyGlobalStyles();
  }
  renderChrome();
  updateOutline();
  renderMarkers();
  void syncBatchLabel();
  void syncUiMessages();
  void syncRecordingStatus();
})();
