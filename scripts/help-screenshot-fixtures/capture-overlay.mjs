const MARK = "#6691F2";
const PIN_COLORS = ["#0069A8", "#0E7490", "#C2410C"];
const BUBBLE_BODY =
  "M2 12C2 6.477 6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10a10 10 0 0 1-4.262-.951l-4.537.93a1 1 0 0 1-1.18-1.18l.93-4.537A10 10 0 0 1 2 12";
const BUBBLE_DOTS = `${BUBBLE_BODY}m10-4a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2H9a1 1 0 1 1 0-2h2V9a1 1 0 0 1 1-1`;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function bubbleSvg(color, variant = "plain") {
  if (variant === "dots") {
    return `<svg class="mark" viewBox="1.8 1.8 20.4 20.4" aria-hidden="true"><path fill="${color}" fill-rule="evenodd" clip-rule="evenodd" d="${BUBBLE_DOTS}"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="${color}" stroke="#fff" stroke-width="1.15" fill-rule="evenodd" clip-rule="evenodd" d="${BUBBLE_BODY}"/></svg>`;
}

function markerHtml(number, color, pending = false) {
  const cls = pending ? "marker is-pending" : "marker";
  return `<button type="button" class="${cls}" data-marker="${number}">${bubbleSvg(color)}<span class="marker-n">${number}</span></button>`;
}

const ALERT_SVG = `<svg class="progress-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4"/><path d="M12 17h.01"/><path d="M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20h15.4a2 2 0 0 0 1.7-2.8L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`;
const CHECK_SVG = `<svg class="progress-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;

export function overlayFixtureHtml(copy, { language, sendMod, batchShortcut, mode = "capture" }) {
  const pin = escapeHtml(copy.overlay_hint_pin);
  const tune = escapeHtml(copy.overlay_hint_tune_long);
  const copyHint = escapeHtml(copy.overlay_hint_copy_long);
  const mask = escapeHtml(copy.overlay_hint_mask_long);
  const regions = escapeHtml(copy.overlay_hint_regions);
  const clear = escapeHtml(copy.overlay_hint_clear_long);
  const batchIdle = escapeHtml(copy.batch_idle);
  const send = escapeHtml(sendMod);
  const batchKey = escapeHtml(batchShortcut);
  const reviewing = escapeHtml(copy.overlay_reviewing);
  const placePin = escapeHtml(copy.overlay_place_pin);
  const copyFailed = escapeHtml(copy.overlay_copy_failed);
  const copied = escapeHtml(copy.overlay_copied);
  const isReview = mode === "review";
  const isCopyFailed = mode === "copy-failed";
  const isCopied = mode === "copied";
  const isFullPage = mode === "full-page";
  const isShortcuts = mode === "shortcuts";
  const isTypes = mode === "types";
  const isPins = mode === "pins";
  const isSelection = mode === "selection";
  const isMasks = mode === "masks";
  const showMask = mode === "capture" || isMasks;
  const showRegion = mode === "capture" || isFullPage || isTypes;
  const showPins = !isShortcuts;
  const pendingFirst = isReview;
  const reportKind = isCopyFailed ? "error" : isCopied ? "ok" : "";
  const reportLabel = isCopyFailed ? copyFailed : copied;
  const reportIcon = isCopyFailed ? ALERT_SVG : CHECK_SVG;

  return `<!doctype html>
<html lang="${escapeHtml(language)}">
<head>
  <meta charset="utf-8">
  <title>Pinar overlay fixture</title>
  <style>
    html, body { margin: 0; background: #eef2f7; }
    [hidden] { display: none !important; }
    body {
      color: #111827;
      font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      min-height: 100vh;
    }
    .page { margin: 0 auto; max-width: 920px; padding: 84px 24px 32px; }
    .shop {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, .08);
      overflow: hidden;
    }
    .shop-bar {
      align-items: center;
      background: #f8fafc;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      padding: 16px 28px;
    }
    .shop-name { font: 700 15px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .shop-nav { color: #64748b; display: flex; gap: 18px; font-size: 13px; }
    .invoice { display: grid; gap: 28px; grid-template-columns: 1.4fr .9fr; padding: 28px; }
    h1 { font-size: 28px; letter-spacing: -.02em; margin: 0 0 8px; }
    .muted { color: #64748b; margin: 0; }
    .email {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      margin-top: 18px;
      padding: 12px 14px;
    }
    .email strong { display: block; font-size: 11px; letter-spacing: .04em; text-transform: uppercase; }
    .lines { border-top: 1px solid #e5e7eb; display: grid; gap: 12px; margin-top: 22px; padding-top: 18px; }
    .line { display: flex; justify-content: space-between; }
    .totals {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 14px;
      padding: 20px;
    }
    .totals h2 { font-size: 16px; margin: 0 0 14px; }
    .pay {
      background: #111827;
      border: 0;
      border-radius: 10px;
      color: #fff;
      font: 600 14px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      margin-top: 18px;
      padding: 12px 16px;
      width: 100%;
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
      position: fixed;
      top: 16px;
      transform: translateX(-50%);
      white-space: nowrap;
      z-index: 3;
    }
    .view { align-items: center; display: flex; gap: 12px; min-width: 0; position: relative; z-index: 1; }
    .view[hidden] { display: none !important; }
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
    .batch-pill { align-items: center; display: inline-flex; flex: 0 0 auto; gap: 5px; white-space: nowrap; }
    .pin-region {
      border: 2px solid;
      box-sizing: border-box;
      pointer-events: none;
      position: fixed;
      z-index: 1;
    }
    .privacy-mask {
      background: rgba(17, 24, 39, 0.72);
      border: 2px dashed #111827;
      box-sizing: border-box;
      position: fixed;
      z-index: 1;
    }
    .privacy-mask-label {
      color: #fff;
      font: 600 10px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      left: 6px;
      letter-spacing: 0.02em;
      position: absolute;
      text-transform: uppercase;
      top: 6px;
    }
    .marker {
      background: transparent;
      border: 0;
      height: 28px;
      padding: 0;
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
    .marker.is-pending svg {
      filter: drop-shadow(0 0 0 2px #fff) drop-shadow(0 0 0 3px #C2410C) drop-shadow(0 1px 2px rgba(15, 23, 42, 0.45));
    }
    .status { color: #262626; font-weight: 500; }
    .status[data-kind="error"] { color: #E5484D; }
    .toast {
      background: rgba(255,255,255,.96);
      border: 1px solid rgba(15,23,42,.18);
      border-radius: 8px;
      box-shadow: 0 8px 20px rgba(15,23,42,.14), 0 1px 2px rgba(15,23,42,.08);
      color: #262626;
      font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      left: 50%;
      padding: 7px 10px;
      position: fixed;
      top: 68px;
      transform: translateX(-50%);
      white-space: nowrap;
      z-index: 3;
    }
    .toast[data-kind="error"] { color: #E5484D; }
    .progress-view { gap: 12px; }
    .progress-text { font-weight: 400; }
    .progress-icon svg { display: none; height: 20px; width: 20px; }
    .toolbar[data-kind="error"] .progress-text { color: #E5484D; }
    .toolbar[data-kind="error"] .progress-alert { color: #E5484D; display: block; }
    .toolbar[data-kind="ok"] .progress-text { color: #1F7A4D; }
    .toolbar[data-kind="ok"] .progress-check { color: #1F7A4D; display: block; }
    .outline {
      border: 2px solid #5794FF;
      background: rgba(87,148,255,.055);
      box-sizing: border-box;
      pointer-events: none;
      position: fixed;
      z-index: 1;
    }
    .long-doc { max-width: 720px; padding-bottom: 80px; }
    .long-doc p { color: #475569; margin: 0 0 16px; }
  </style>
</head>
<body>
  <div class="toolbar" data-overlay-toolbar="true"${reportKind ? ` data-kind="${reportKind}"` : ""}>
    <div class="view online-view"${isCopyFailed || isCopied ? " hidden" : ""}>
      <span class="state-icon" aria-hidden="true">${bubbleSvg(MARK, "dots")}</span>
      <span class="instructions"${isReview ? " hidden" : ""}>
        <span class="hint" data-hint="pin">${pin}</span>
        <span class="hint" data-hint="tune"><span class="keys"><kbd>↑</kbd><kbd>↓</kbd></span><span>${tune}</span></span>
        <span class="hint" data-hint="copy"><span class="keys"><kbd>${send}+↵</kbd><kbd>Alt+↵</kbd></span><span>${copyHint}</span></span>
        <span class="hint" data-hint="mask"><span class="keys"><kbd>M</kbd></span><span>${mask}</span></span>
        <span class="hint" data-hint="regions"><span class="keys"><kbd>R</kbd></span><span>${regions}</span></span>
        <span class="hint" data-hint="clear"><span class="keys"><kbd>esc</kbd></span><span>${clear}</span></span>
      </span>
      <span class="status"${isReview ? ' data-kind="info"' : " hidden"}>${reviewing}</span>
      <span class="batch-pill"${isReview || isCopyFailed || isCopied ? " hidden" : ""}>
        <kbd>${batchKey}</kbd>
        <span>${batchIdle}</span>
      </span>
    </div>
    <div class="view progress-view"${isCopyFailed || isCopied ? "" : " hidden"}>
      <span class="state-icon progress-icon" aria-hidden="true">${reportIcon}</span>
      <span class="progress-text">${reportLabel}</span>
    </div>
  </div>
  ${isReview ? `<div class="toast" data-kind="info">${placePin}</div>` : ""}
  <main class="page${isFullPage ? " long-doc" : ""}">
    <section class="shop">
      <header class="shop-bar">
        <div class="shop-name">Harbor Supply</div>
        <div class="shop-nav"><span>Catalog</span><span>Orders</span><span>Account</span></div>
      </header>
      <div class="invoice">
        <div>
          <h1 id="invoice-title">Invoice 1842</h1>
          <p class="muted">Review the billed items, then confirm the payment method.</p>
          <div class="email" id="customer-email">
            <strong>Customer</strong>
            billing@harbor.example
          </div>
          <div class="lines">
            <div class="line"><span>Studio lamp · 2×</span><span>$180.00</span></div>
            <div class="line"><span>Clamp mount</span><span>$42.00</span></div>
            <div class="line"><span>Spare bulb pack</span><span>$24.00</span></div>
          </div>
          ${isFullPage ? `<p>Harbor Supply keeps packing notes, warehouse aisle, and carrier pickup on one document so the receiving desk can scroll without switching tools.</p><p>The stitched capture follows this column through the packing checklist, the signature block, and the footer conditions that sit below the first viewport.</p><p>Aisle B holds lamps. Aisle C holds mounts. Confirm both rows before the driver leaves the dock.</p><p>Signature: ______________________ Date: ________</p>` : ""}
        </div>
        <aside class="totals" id="totals-card">
          <h2>Order total</h2>
          <div class="line"><span>Subtotal</span><span>$246.00</span></div>
          <div class="line"><span>Tax</span><span>$19.68</span></div>
          <div class="line"><strong>Due today</strong><strong>$265.68</strong></div>
          <button class="pay" id="pay-button" type="button">Pay invoice</button>
        </aside>
      </div>
    </section>
  </main>
  ${isSelection ? `<div class="outline" id="selection-outline"></div>` : ""}
  ${showRegion ? `<div class="pin-region" id="region-1"></div>` : `<div class="pin-region" id="region-1" hidden></div>`}
  ${showMask ? `<div class="privacy-mask" id="mask-1" data-source="user"><span class="privacy-mask-label">Hidden</span></div>` : `<div class="privacy-mask" id="mask-1" hidden></div>`}
  ${showPins ? markerHtml(1, PIN_COLORS[0], pendingFirst) : ""}
  ${showPins && !isSelection && !isMasks ? markerHtml(2, PIN_COLORS[1], false) : ""}
  ${isPins ? markerHtml(3, PIN_COLORS[2], false) : ""}
  <script>
    const title = document.getElementById("invoice-title").getBoundingClientRect();
    const pay = document.getElementById("pay-button").getBoundingClientRect();
    const totals = document.getElementById("totals-card").getBoundingClientRect();
    const email = document.getElementById("customer-email").getBoundingClientRect();
    const markers = document.querySelectorAll(".marker");
    if (markers[0]) {
      markers[0].style.left = (title.left + 28) + "px";
      markers[0].style.top = (title.top + 8) + "px";
    }
    if (markers[1]) {
      markers[1].style.left = (pay.left + pay.width - 18) + "px";
      markers[1].style.top = (pay.top + 8) + "px";
    }
    if (markers[2]) {
      markers[2].style.left = (email.left + 24) + "px";
      markers[2].style.top = (email.top + 8) + "px";
    }
    const outline = document.getElementById("selection-outline");
    if (outline) {
      outline.style.left = title.left - 8 + "px";
      outline.style.top = title.top - 8 + "px";
      outline.style.width = title.width + 16 + "px";
      outline.style.height = title.height + 16 + "px";
    }
    const region = document.getElementById("region-1");
    region.style.left = totals.left + "px";
    region.style.top = totals.top + "px";
    region.style.width = totals.width + "px";
    region.style.height = totals.height + "px";
    region.style.borderColor = "${PIN_COLORS[1]}";
    region.style.background = "rgba(14, 116, 144, 0.08)";
    const mask = document.getElementById("mask-1");
    mask.style.left = email.left + "px";
    mask.style.top = email.top + "px";
    mask.style.width = email.width + "px";
    mask.style.height = email.height + "px";
  </script>
</body>
</html>`;
}
