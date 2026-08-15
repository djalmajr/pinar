import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

app.use("*", cors());

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";
const INSTALLATION_ID_PATTERN = /^ins_[A-Za-z0-9_-]{24}$/;
const INSTALLATION_TOKEN_PATTERN = /^pit_[A-Za-z0-9_-]{43}$/;
const BROWSER_TICKET_PATTERN = /^pbt_[A-Za-z0-9_-]{43}$/;
const BROWSER_SESSION_PATTERN = /^pbs_[A-Za-z0-9_-]{43}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const BROWSER_SESSION_COOKIE = "pinar_session";

function generateNanoId(size = 12) {
  const bytes = new Uint8Array(size);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < size; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let id = "";
  for (let i = 0; i < size; i++) id += ALPHABET[bytes[i] & 63];
  return id;
}

function randomCredential(prefix, byteLength = 32) {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure random generation is unavailable");
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${prefix}${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")}`;
}

async function hashCredential(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bearerToken(c) {
  const header = c.req.header("authorization") || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : header.trim();
}

function cookieValue(c, name) {
  const cookies = c.req.header("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[m] || m));
}

function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function extractImageBytes(dataUrl) {
  if (dataUrl.startsWith("data:")) {
    const parts = dataUrl.split(",");
    const base64 = parts[1];
    return base64ToUint8Array(base64);
  }
  return base64ToUint8Array(dataUrl);
}

function sessionFromRow(row) {
  return {
    byteSize: Number(row.byte_size || 0),
    createdAt: row.created_at,
    id: row.id,
    isPermanent: Boolean(row.is_permanent),
    page: { title: row.title, url: row.url },
    pinCount: Number(row.pin_count || 0),
    pins: JSON.parse(row.pins_json || "[]"),
    plan: row.plan || "free",
    shotId: row.shot_id,
    shotUrl: row.shot_url,
    userId: row.user_id,
  };
}

function sessionMatchesQuery(session, query) {
  if (!query) return true;
  const needle = query.toLocaleLowerCase();
  return [
    session.page?.title,
    session.page?.url,
    JSON.stringify(session.pins || []),
  ].some((value) => String(value || "").toLocaleLowerCase().includes(needle));
}

function serveAppShell(c) {
  if (!c.env.ASSETS) return null;
  const url = new URL("/index.html", c.req.url);
  return c.env.ASSETS.fetch(url);
}

async function findPublicSession(c, id) {
  if (!SESSION_ID_PATTERN.test(id)) return null;
  if (c.env.DB) {
    try {
      const row = await c.env.DB.prepare("SELECT * FROM sessions WHERE id = ?").bind(id).first();
      if (row) return sessionFromRow(row);
    } catch {
      return null;
    }
  }
  return memoryStore.get(id) || null;
}

async function listSessionsForPrincipal(c, principal, query = "", requestedLimit = 50) {
  const limit = Math.min(Math.max(Number(requestedLimit) || 50, 1), 100);
  if (c.env.DB) {
    const querySql = query
      ? `SELECT * FROM sessions
         WHERE user_id = ? AND (title LIKE ? OR url LIKE ? OR pins_json LIKE ?)
         ORDER BY created_at DESC LIMIT ?`
      : "SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?";
    const statement = query
      ? c.env.DB.prepare(querySql).bind(
          principal.id,
          `%${query}%`,
          `%${query}%`,
          `%${query}%`,
          limit,
        )
      : c.env.DB.prepare(querySql).bind(principal.id, limit);
    const { results } = await statement.all();
    return results.map(sessionFromRow);
  }

  return Array.from(memoryStore.values())
    .filter((session) => session.userId === principal.id && sessionMatchesQuery(session, query))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, limit);
}

function formatSessionMarkdown(session, viewerUrl) {
  const parts = [];
  const page = session.page || {};
  parts.push(`Page: ${page.title || "(untitled)"}`);
  parts.push(`URL: ${page.url || "(unknown)"}`);
  if (viewerUrl) {
    parts.push(`Viewer: ${viewerUrl}`);
  }
  if (session.shotUrl) {
    parts.push(`Screenshot: ${session.shotUrl}`);
  }
  parts.push("");

  (session.pins || []).forEach((pin) => {
    parts.push(`Pin #${pin.number}:`);
    parts.push(`Comment: ${pin.comment}`);
    if (pin.domPath) parts.push(`DOM: ${pin.domPath}`);
    if (pin.selector) parts.push(`Selector: ${pin.selector}`);
    if (pin.innerText) parts.push(`Text: "${pin.innerText.replace(/\n+/g, " ").trim()}"`);
    parts.push("");
  });

  return parts.join("\n").trim();
}

function renderViewerHtml(session, origin) {
  const page = session.page || {};
  const title = page.title || "(untitled)";
  const url = page.url || "";
  const pins = session.pins || [];
  const shotUrl = session.shotUrl || `${origin}/shots/${session.shotId}.png`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Pinar — ${escapeHtml(title)}</title>
  <script>
    (function() {
      const saved = localStorage.getItem("pinar-theme");
      const isDark = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    })();
    function toggleTheme() {
      const isDark = document.documentElement.classList.contains("dark");
      const next = !isDark;
      document.documentElement.classList.toggle("dark", next);
      document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
      localStorage.setItem("pinar-theme", next ? "dark" : "light");
      updateThemeBtn();
    }
    function updateThemeBtn() {
      const btn = document.getElementById("btnThemeToggle");
      if (!btn) return;
      const isDark = document.documentElement.classList.contains("dark");
      btn.innerHTML = isDark
        ? '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.42"/></svg>'
        : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.99 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 20.99 12.79Z"/></svg>';
      btn.title = isDark ? "Switch to Light mode" : "Switch to Dark mode";
      btn.setAttribute("aria-label", btn.title);
    }
    window.addEventListener("DOMContentLoaded", updateThemeBtn);
  </script>
  <style>
    :root {
      --bg: #F8FAFC;
      --card-bg: #FFFFFF;
      --border: #E2E8F0;
      --text: #0F172A;
      --text-muted: #64748B;
      --mark: #2563EB;
      --primary: #2563EB;
      --shadow: 0 4px 12px rgba(0,0,0,0.06);
    }
    :root[data-theme="dark"], .dark {
      --bg: #0B0F17;
      --card-bg: #141B26;
      --border: #232E40;
      --text: #F1F5F9;
      --text-muted: #94A3B8;
      --mark: #6691F2;
      --primary: #5794FF;
      --shadow: 0 4px 12px rgba(0,0,0,0.4);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      z-index: 10;
    }
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .logo-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: rgba(102, 145, 242, 0.15);
      color: var(--mark);
      font-weight: 700;
      font-size: 14px;
    }
    .header-text {
      min-width: 0;
    }
    .page-title {
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .page-url {
      font-size: 12px;
      color: var(--text-muted);
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }
    .page-url:hover {
      color: var(--primary);
    }
    .header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text);
      text-decoration: none;
      transition: all 0.15s ease;
    }
    .btn:hover {
      border-color: var(--primary);
      background: rgba(87, 148, 255, 0.08);
    }
    .btn-icon {
      width: 34px;
      height: 34px;
      padding: 0;
      justify-content: center;
    }
    .btn-icon svg, #btnThemeToggle svg {
      width: 16px;
      height: 16px;
    }
    .btn-primary {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }
    .btn-primary:hover {
      background: #4080F0;
    }
    .main {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    .viewport {
      flex: 1;
      overflow: auto;
      padding: 32px;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      background: var(--bg);
    }
    .screenshot-card {
      position: relative;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: var(--shadow);
      overflow: hidden;
      max-width: 100%;
    }
    .screenshot-card img {
      display: block;
      max-width: 100%;
      height: auto;
    }
    .pin-overlay {
      position: absolute;
      transform: translate(-50%, -50%);
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--mark);
      color: #fff;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      cursor: pointer;
      border: 2px solid #fff;
      transition: transform 0.15s ease;
    }
    .pin-overlay:hover, .pin-overlay.active {
      transform: translate(-50%, -50%) scale(1.25);
      z-index: 20;
    }
    .sidebar {
      width: 340px;
      background: var(--card-bg);
      border-left: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .pins-list {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pin-card {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px 14px;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    .pin-card:hover, .pin-card.active {
      border-color: var(--primary);
      background: rgba(87, 148, 255, 0.04);
    }
    .pin-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .pin-num {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: rgba(102, 145, 242, 0.2);
      color: var(--mark);
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .pin-tag {
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .pin-comment {
      font-size: 13px;
      color: var(--text);
      line-height: 1.4;
    }
    .pin-code {
      margin-top: 8px;
      font-family: monospace;
      font-size: 11px;
      background: rgba(0,0,0,0.05);
      padding: 4px 8px;
      border-radius: 6px;
      color: var(--text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    @media (prefers-color-scheme: dark) {
      .pin-code { background: rgba(255,255,255,0.05); }
    }
    .badge-pro {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 700;
      background: rgba(87, 148, 255, 0.15);
      color: var(--primary);
    }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <a href="/history" class="btn btn-icon" title="Back to history" aria-label="Back to history">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
      </a>
      <div class="header-text">
        <div class="page-title">${escapeHtml(title)}</div>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="page-url">${escapeHtml(url)}</a>
      </div>
    </div>
    <div class="header-right">
      <a href="/v/${escapeHtml(session.id)}.md" target="_blank" class="btn">Markdown</a>
      <button id="btnThemeToggle" onclick="toggleTheme()" class="btn btn-icon" title="Toggle theme" aria-label="Toggle theme">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.99 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 20.99 12.79Z"/></svg>
      </button>
      <button class="btn btn-primary" onclick="copyPrompt()">Copy for AI</button>
    </div>
  </header>

  <div class="main">
    <div class="viewport">
      <div class="screenshot-card">
        <img src="${escapeHtml(shotUrl)}" alt="Annotation Screenshot"/>
        ${pins.map((p) => `
          <div class="pin-overlay" id="pin-overlay-${p.number}" style="left:${p.coords?.x || 0}px; top:${p.coords?.y || 0}px;" onclick="selectPin(${p.number})">
            ${p.number}
          </div>
        `).join("")}
      </div>
    </div>

    <div class="sidebar">
      <div class="sidebar-header">
        <span>Annotations (${pins.length})</span>
        <span class="badge-pro">${session.isPermanent ? "Permanent Pro" : "7-Day Free"}</span>
      </div>
      <div class="pins-list">
        ${pins.map((p) => `
          <div class="pin-card" id="pin-card-${p.number}" onclick="selectPin(${p.number})">
            <div class="pin-header">
              <div class="pin-num">${p.number}</div>
              <div class="pin-tag">${escapeHtml(p.type === "area" ? "Area" : (p.tag || "Element"))}</div>
            </div>
            <div class="pin-comment">${escapeHtml(p.comment)}</div>
            ${p.selector ? `<div class="pin-code">${escapeHtml(p.selector)}</div>` : ""}
          </div>
        `).join("")}
      </div>
    </div>
  </div>

  <script>
    function selectPin(num) {
      document.querySelectorAll(".pin-card").forEach(c => c.classList.remove("active"));
      document.querySelectorAll(".pin-overlay").forEach(o => o.classList.remove("active"));
      const card = document.getElementById("pin-card-" + num);
      const overlay = document.getElementById("pin-overlay-" + num);
      if (card) {
        card.classList.add("active");
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      if (overlay) overlay.classList.add("active");
    }

    async function copyPrompt() {
      const res = await fetch(window.location.pathname + ".md");
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      const btn = document.querySelector(".btn-primary");
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => btn.textContent = orig, 2000);
    }
  </script>
</body>
</html>`;
}

function renderPricingHtml(origin) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Pinar Pro — Permanent Visual Annotations & Cloud History</title>
  <script>
    (function() {
      const saved = localStorage.getItem("pinar-theme");
      const isDark = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    })();
    function toggleTheme() {
      const isDark = document.documentElement.classList.contains("dark");
      const next = !isDark;
      document.documentElement.classList.toggle("dark", next);
      document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
      localStorage.setItem("pinar-theme", next ? "dark" : "light");
      updateThemeBtn();
    }
    function updateThemeBtn() {
      const btn = document.getElementById("btnThemeToggle");
      if (!btn) return;
      const isDark = document.documentElement.classList.contains("dark");
      btn.innerHTML = isDark
        ? '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.42"/></svg>'
        : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.99 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 20.99 12.79Z"/></svg>';
      btn.title = isDark ? "Switch to Light mode" : "Switch to Dark mode";
      btn.setAttribute("aria-label", btn.title);
    }
    window.addEventListener("DOMContentLoaded", updateThemeBtn);
  </script>
  <style>
    :root {
      --bg: #F8FAFC;
      --card-bg: #FFFFFF;
      --card-border: #E2E8F0;
      --text: #0F172A;
      --text-muted: #64748B;
      --primary: #2563EB;
      --primary-hover: #1D4ED8;
      --accent: #16A34A;
      --pink: #DB2777;
      --yellow: #D97706;
      --radius: 16px;
    }
    :root[data-theme="dark"], .dark {
      --bg: #0B0F17;
      --card-bg: #111827;
      --card-border: #1F2937;
      --text: #F9FAFB;
      --text-muted: #9CA3AF;
      --primary: #3B82F6;
      --primary-hover: #2563EB;
      --accent: #22C55E;
      --pink: #EC4899;
      --yellow: #F59E0B;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 56px 20px 80px;
    }
    .container { max-width: 980px; margin: 0 auto; text-align: center; position: relative; }
    .top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 32px;
    }
    .btn-top {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      text-decoration: none;
      border: 1px solid var(--card-border);
      background: var(--card-bg);
      color: var(--text);
      cursor: pointer;
      transition: all 0.15s;
    }
    .btn-top:hover { border-color: var(--primary); }
    .btn-top > svg, .support-title > svg, .btn-coffee > svg { width: 16px; height: 16px; flex: none; }
    .btn-top-icon { width: 34px; height: 34px; padding: 0; justify-content: center; }
    h1 { font-size: 34px; font-weight: 800; margin-bottom: 12px; letter-spacing: -0.02em; }
    p.subtitle { font-size: 15px; color: var(--text-muted); max-width: 620px; margin: 0 auto 44px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; text-align: left; }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 32px 28px;
      display: flex;
      flex-direction: column;
      position: relative;
    }
    .card.featured {
      border-color: var(--primary);
      box-shadow: 0 10px 30px rgba(59,130,246,0.15);
    }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      background: rgba(59,130,246,0.15);
      color: var(--primary);
      margin-bottom: 16px;
      width: fit-content;
    }
    .price { font-size: 36px; font-weight: 800; margin: 16px 0 6px; }
    .price span { font-size: 14px; font-weight: 400; color: var(--text-muted); }
    ul { list-style: none; margin: 24px 0; display: flex; flex-direction: column; gap: 12px; font-size: 13.5px; }
    li { display: flex; align-items: center; justify-content: flex-start; gap: 8px; }
    li::before { content: "✓"; color: var(--accent); font-weight: bold; flex-shrink: 0; }
    .btn {
      width: 100%;
      padding: 12px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      text-align: center;
      text-decoration: none;
      border: 1px solid var(--card-border);
      background: transparent;
      color: var(--text);
      margin-top: auto;
      transition: all 0.15s;
    }
    .btn:hover { background: rgba(255,255,255,0.05); }
    .btn-featured {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }
    .btn-featured:hover { background: var(--primary-hover); }
    .btn-accent {
      background: var(--accent);
      border-color: var(--accent);
      color: #fff;
    }
    .btn-accent:hover { background: #16A34A; }
    .support-section {
      margin-top: 56px;
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: var(--radius);
      padding: 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 16px;
    }
    .support-title { font-size: 18px; font-weight: 700; display: inline-flex; align-items: center; gap: 8px; }
    .support-desc { font-size: 13.5px; color: var(--text-muted); max-width: 540px; }
    .support-btns {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      justify-content: center;
    }
    .btn-sponsor {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 13.5px;
      font-weight: 600;
      text-decoration: none;
      background: rgba(236,72,153,0.12);
      border: 1px solid rgba(236,72,153,0.3);
      color: var(--pink);
      transition: all 0.15s;
    }
    .btn-sponsor:hover { background: rgba(236,72,153,0.2); }
    .btn-coffee {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 13.5px;
      font-weight: 600;
      text-decoration: none;
      background: rgba(245,158,11,0.12);
      border: 1px solid rgba(245,158,11,0.3);
      color: var(--yellow);
      transition: all 0.15s;
    }
    .btn-coffee:hover { background: rgba(245,158,11,0.2); }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar">
      <a href="/history" class="btn-top">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
        Back to Dashboard
      </a>
      <button id="btnThemeToggle" onclick="toggleTheme()" class="btn-top btn-top-icon" title="Toggle theme" aria-label="Toggle theme">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.99 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 20.99 12.79Z"/></svg>
      </button>
    </div>
    <div class="badge">Pinar Pro & Sponsors</div>
    <h1>Never lose visual feedback context again</h1>
    <p class="subtitle">Permanent cloud history, unlimited web viewers for PRs, and 1-click AI markdown format.</p>

    <div class="grid">
      <div class="card">
        <div class="badge" style="background: rgba(156,163,175,0.15); color: var(--text-muted);">Free</div>
        <h3>Developer Free</h3>
        <div class="price">$0 <span>forever</span></div>
        <p style="font-size: 13px; color: var(--text-muted);">100% private local helper + 7-day cloud retention.</p>
        <ul>
          <li>Unlimited local annotations</li>
          <li>7-Day cloud retention</li>
          <li>Standard Web Viewer</li>
          <li>One-click clipboard prompts</li>
        </ul>
        <a href="https://github.com/djalmajr/pinar" class="btn">Use Free</a>
      </div>

      <div class="card featured">
        <div class="badge">Most Popular</div>
        <h3>Pro Yearly</h3>
        <div class="price">$19 <span>/ year (~$1.58/mo)</span></div>
        <p style="font-size: 13px; color: var(--text-muted);">Permanent retention & 5 GB cloud storage.</p>
        <ul>
          <li><strong>Permanent retention (Never deleted)</strong></li>
          <li><strong>5 GB Cloud storage</strong></li>
          <li>Permanent web viewer links for PRs</li>
          <li>1-Click License Key activation</li>
        </ul>
        <button onclick="checkout('year')" class="btn btn-featured">Upgrade to Pro ($19/yr)</button>
      </div>

      <div class="card">
        <div class="badge" style="background: rgba(34,197,94,0.15); color: var(--accent);">Lifetime Deal</div>
        <h3>Pro Lifetime</h3>
        <div class="price">$49 <span>one-time</span></div>
        <p style="font-size: 13px; color: var(--text-muted);">Pay once, keep permanent visual history forever.</p>
        <ul>
          <li><strong>Lifetime permanent retention</strong></li>
          <li><strong>5 GB Cloud storage</strong></li>
          <li>All future Pro features included</li>
          <li>Early supporter VIP badge</li>
        </ul>
        <button onclick="checkout('lifetime')" class="btn btn-accent">Get Lifetime ($49)</button>
      </div>
    </div>

    <div class="support-section">
      <div class="support-title">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
        Prefer Open Source Sponsorship?
      </div>
      <div class="support-desc">If you prefer directly supporting open-source development instead of a subscription, you can sponsor on GitHub or buy a coffee:</div>
      <div class="support-btns">
        <a href="https://github.com/sponsors/djalmajr" target="_blank" rel="noopener noreferrer" class="btn-sponsor">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
          Sponsor on GitHub
        </a>
        <a href="https://buymeacoffee.com/djalmajr" target="_blank" rel="noopener noreferrer" class="btn-coffee">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h12ZM6 2v2M17 10h2a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2"/></svg>
          Buy Me a Coffee
        </a>
      </div>
    </div>
  </div>

  <script>
    async function checkout(interval) {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval })
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    }
  </script>
</body>
</html>`;
}

function renderSuccessHtml(origin, user) {
  const licenseKey = user?.license_key || "pinar_pro_activated";
  const email = user?.email || "subscriber";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Welcome to Pinar Pro!</title>
  <style>
    :root {
      --bg: #0B0F17;
      --card-bg: #141B26;
      --border: #232E40;
      --text: #F1F5F9;
      --text-muted: #94A3B8;
      --primary: #5794FF;
      --radius: 16px;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 60px 20px;
      display: flex;
      justify-content: center;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      max-width: 520px;
      width: 100%;
      padding: 40px 32px;
      text-align: center;
    }
    h1 { font-size: 24px; font-weight: 800; margin-bottom: 12px; }
    .badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 700; background: rgba(87,148,255,0.15); color: var(--primary); margin-bottom: 16px; }
    .key-box { background: rgba(0,0,0,0.3); border: 1px dashed var(--border); border-radius: 10px; padding: 12px 16px; margin: 24px 0; display: flex; align-items: center; justify-content: space-between; }
    code { font-family: monospace; font-size: 13px; color: var(--primary); word-break: break-all; }
    button { padding: 8px 16px; border-radius: 8px; border: 1px solid var(--primary); background: var(--primary); color: #fff; font-weight: 600; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <div class="badge">Pro Activated</div>
    <h1>Welcome to Pinar Pro!</h1>
    <p style="color: var(--text-muted); font-size: 14px;">Thank you for subscribing, <strong>${escapeHtml(email)}</strong>. Your license key:</p>

    <div class="key-box">
      <code id="lic">${escapeHtml(licenseKey)}</code>
      <button onclick="copyKey()">Copy</button>
    </div>

    <p style="font-size: 12px; color: var(--text-muted); margin-top: 16px;">Paste this key in the Pinar Extension Settings to activate unlimited permanent retention.</p>
  </div>

  <script>
    async function copyKey() {
      await navigator.clipboard.writeText(document.getElementById("lic").textContent);
      document.querySelector("button").textContent = "Copied!";
      setTimeout(() => document.querySelector("button").textContent = "Copy", 2000);
    }
  </script>
</body>
</html>`;
}

function formatPageDisplayUrl(rawUrl) {
  if (!rawUrl) return "";
  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname.endsWith(".local")) {
      const port = parsed.port ? `:${parsed.port}` : "";
      const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
      return `localhost${port}${path}`;
    }
    const path = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
    return `${parsed.hostname}${path}`;
  } catch {
    return rawUrl.replace(/^https?:\/\//, "");
  }
}

function renderRemoteDashboardHtml(origin, sessions) {
  const sessionDataJson = JSON.stringify(sessions.map(s => ({
    id: s.id,
    title: s.page?.title || "(untitled)",
    url: s.page?.url || "",
    displayUrl: formatPageDisplayUrl(s.page?.url),
    pinCount: s.pinCount || s.pins?.length || 0,
    pins: (s.pins || []).slice(0, 3).map(p => ({ number: p.number, comment: p.comment })),
    createdAt: s.createdAt,
    isPermanent: Boolean(s.isPermanent),
    shotUrl: s.shotUrl || (s.shotId ? `/shots/${s.shotId}.png` : null)
  }))).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Pinar — Cloud History</title>
  <script>
    (function() {
      const saved = localStorage.getItem("pinar-theme");
      const isDark = saved === "dark" || (!saved && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    })();
    function toggleTheme() {
      const isDark = document.documentElement.classList.contains("dark");
      const next = !isDark;
      document.documentElement.classList.toggle("dark", next);
      document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
      localStorage.setItem("pinar-theme", next ? "dark" : "light");
      updateThemeBtn();
    }
    function updateThemeBtn() {
      const btn = document.getElementById("btnThemeToggle");
      if (!btn) return;
      const isDark = document.documentElement.classList.contains("dark");
      btn.innerHTML = isDark
        ? '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.42"/></svg>'
        : '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.99 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 20.99 12.79Z"/></svg>';
      btn.title = isDark ? "Switch to Light mode" : "Switch to Dark mode";
      btn.setAttribute("aria-label", btn.title);
    }
    window.addEventListener("DOMContentLoaded", updateThemeBtn);
  </script>
  <style>
    :root {
      --bg: #F8FAFC;
      --card-bg: #FFFFFF;
      --card-hover: #F1F5F9;
      --border: #E2E8F0;
      --border-hover: #CBD5E1;
      --text: #0F172A;
      --text-muted: #64748B;
      --primary: #2563EB;
      --primary-hover: #1D4ED8;
      --pro-bg: rgba(37, 99, 235, 0.1);
      --pro-text: #2563EB;
      --radius: 12px;
    }
    :root[data-theme="dark"], .dark {
      --bg: #0B0F17;
      --card-bg: #111827;
      --card-hover: #162032;
      --border: #1F2937;
      --border-hover: #374151;
      --text: #F9FAFB;
      --text-muted: #9CA3AF;
      --primary: #3B82F6;
      --primary-hover: #2563EB;
      --pro-bg: rgba(59, 130, 246, 0.12);
      --pro-text: #60A5FA;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .app-header {
      background: rgba(11, 15, 23, 0.85);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      z-index: 20;
    }
    .header-inner {
      max-width: 1200px;
      margin: 0 auto;
      padding: 14px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .logo-group {
      display: flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: inherit;
    }
    .logo-badge {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: var(--primary);
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 14px;
    }
    .logo-title {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.02em;
    }
    .header-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .btn-header {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 12.5px;
      font-weight: 600;
      text-decoration: none;
      transition: all 0.15s;
    }
    .btn-header > svg { width: 14px; height: 14px; flex: none; }
    .btn-header-icon { width: 34px; height: 34px; padding: 0; justify-content: center; cursor: pointer; }
    .btn-outline {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text);
    }
    .btn-outline:hover {
      background: var(--card-hover);
      border-color: var(--border-hover);
    }
    .btn-pro {
      background: var(--primary);
      border: 1px solid var(--primary);
      color: #fff;
    }
    .btn-pro:hover {
      background: var(--primary-hover);
    }
    .container {
      max-width: 1200px;
      width: 100%;
      margin: 0 auto;
      padding: 28px 24px 60px;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    .search-box {
      position: relative;
      flex: 1;
      max-width: 440px;
      min-width: 240px;
    }
    .search-input {
      width: 100%;
      height: 38px;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0 14px 0 36px;
      color: var(--text);
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
    }
    .search-input:focus {
      border-color: var(--primary);
    }
    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-muted);
      pointer-events: none;
      width: 14px;
      height: 14px;
    }
    .stats-badge {
      font-size: 12px;
      color: var(--text-muted);
      background: var(--card-bg);
      border: 1px solid var(--border);
      padding: 6px 12px;
      border-radius: 20px;
      font-weight: 500;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 18px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: border-color 0.15s, transform 0.15s;
      min-width: 0;
    }
    .card:hover {
      border-color: var(--border-hover);
      transform: translateY(-2px);
    }
    .card-thumb-wrap {
      width: 100%;
      height: 140px;
      background: #080C14;
      position: relative;
      overflow: hidden;
      border-bottom: 1px solid var(--border);
    }
    .card-thumb-img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
      display: block;
    }
    .card-thumb-placeholder {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: 12px;
      background: radial-gradient(circle at 50% 50%, #162032 0%, #0B0F17 100%);
    }
    .card-content {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 0;
    }
    .card-header-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-width: 0;
    }
    .badge-plan {
      font-size: 10.5px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 12px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      white-space: nowrap;
    }
    .badge-pro {
      background: var(--pro-bg);
      color: var(--pro-text);
      border: 1px solid rgba(59, 130, 246, 0.25);
    }
    .badge-free {
      background: rgba(156, 163, 175, 0.12);
      color: var(--text-muted);
      border: 1px solid rgba(156, 163, 175, 0.2);
    }
    .card-time {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
    }
    .card-title-group {
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .card-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      max-width: 100%;
    }
    .card-url {
      font-size: 11.5px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      max-width: 100%;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .pins-snippet {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-top: 4px;
    }
    .pin-row {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      background: rgba(255, 255, 255, 0.03);
      padding: 4px 8px;
      border-radius: 6px;
      min-width: 0;
    }
    .pin-dot {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--pro-bg);
      color: var(--pro-text);
      font-weight: 700;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .pin-text {
      color: var(--text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      min-width: 0;
      flex: 1;
    }
    .card-footer {
      padding: 12px 16px;
      background: rgba(0, 0, 0, 0.15);
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .card-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .btn-card {
      box-sizing: border-box;
      height: 32px;
      min-height: 32px;
      font-size: 11.5px;
      font-weight: 600;
      padding: 0 10px;
      border-radius: 6px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      line-height: 1;
      cursor: pointer;
      transition: all 0.15s;
    }
    .empty-state {
      padding: 80px 20px;
      text-align: center;
      color: var(--text-muted);
      border: 1px dashed var(--border);
      border-radius: var(--radius);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
  </style>
</head>
<body>
  <header class="app-header">
    <div class="header-inner">
      <a href="/history" class="logo-group">
        <div class="logo-badge">P</div>
        <div class="logo-title">Pinar Cloud History</div>
      </a>
      <div class="header-actions">
        <button id="btnThemeToggle" onclick="toggleTheme()" class="btn-header btn-outline btn-header-icon" title="Toggle theme" aria-label="Toggle theme">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.99 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 20.99 12.79Z"/></svg>
        </button>
        <a href="https://github.com/djalmajr/pinar" target="_blank" rel="noopener noreferrer" class="btn-header btn-outline btn-header-icon" title="GitHub" aria-label="GitHub">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z"/></svg>
        </a>
        <a href="https://buymeacoffee.com/djalmajr" target="_blank" rel="noopener noreferrer" class="btn-header btn-outline" style="color:#F59E0B;border-color:rgba(245,158,11,0.3);background:rgba(245,158,11,0.1);">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v2M14 2v2M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h12ZM6 2v2M17 10h2a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2"/></svg>
          Coffee
        </a>
        <a href="https://github.com/sponsors/djalmajr" target="_blank" rel="noopener noreferrer" class="btn-header btn-outline" style="color:#EC4899;border-color:rgba(236,72,153,0.3);background:rgba(236,72,153,0.1);">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
          Sponsor
        </a>
        <a href="/pricing" class="btn-header btn-pro">
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.272 1.272L3 12l5.813 1.912a2 2 0 0 1 1.272 1.272L12 21l1.912-5.813a2 2 0 0 1 1.272-1.272L21 12l-5.813-1.912a2 2 0 0 1-1.272-1.272L12 3Z"/><path d="M5 3v4M19 17v4M3 5h4M17 19h4"/></svg>
          Upgrade to Pro
        </a>
      </div>
    </div>
  </header>

  <main class="container">
    <div class="toolbar">
      <div class="search-box">
        <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input type="text" id="searchInput" class="search-input" placeholder="Search sessions by title, url, comments..."/>
      </div>
      <div class="stats-badge" id="statsBadge">${sessions.length} sessions</div>
    </div>

    <div class="grid" id="sessionsGrid"></div>
  </main>

  <script>
    const allSessions = ${sessionDataJson};

    function renderSessions(items) {
      const grid = document.getElementById("sessionsGrid");
      const badge = document.getElementById("statsBadge");
      badge.textContent = items.length + (items.length === 1 ? " session" : " sessions");

      if (items.length === 0) {
        grid.innerHTML = \`
          <div class="empty-state" style="grid-column: 1 / -1;">
            <div style="font-size: 15px; font-weight: 600; color: var(--text);">No sessions found</div>
            <div style="font-size: 12.5px;">Capture pins with the Pinar Chrome Extension to populate your history.</div>
          </div>
        \`;
        return;
      }

      grid.innerHTML = items.map(s => {
        const timeStr = new Date(s.createdAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        });

        const thumbHtml = s.shotUrl
          ? \`<img src="\${s.shotUrl}" alt="\${escapeHtml(s.title)}" class="card-thumb-img"/>\`
          : \`<div class="card-thumb-placeholder"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg> No Screenshot</div>\`;

        const retentionLabel = (() => {
          if (s.isPermanent) return "Permanent";
          const expiresAt = new Date(s.createdAt).getTime() + (7 * 24 * 60 * 60 * 1000);
          const remainingMs = expiresAt - Date.now();
          if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "Expired";
          const totalHours = Math.ceil(remainingMs / (60 * 60 * 1000));
          const days = Math.floor(totalHours / 24);
          const hours = totalHours % 24;
          if (days > 0 && hours > 0) return \`\${days}d \${hours}h left\`;
          if (days > 0) return \`\${days}d left\`;
          return \`\${hours}h left\`;
        })();

        const pinsList = (s.pins || []).map(p => \`
          <div class="pin-row">
            <span class="pin-dot">\${p.number}</span>
            <span class="pin-text">\${escapeHtml(p.comment)}</span>
          </div>
        \`).join("");

        return \`
          <div class="card">
            <div class="card-thumb-wrap">
              \${thumbHtml}
            </div>
            <div class="card-content">
              <div class="card-header-row">
                <span class="badge-plan \${s.isPermanent ? "badge-pro" : "badge-free"}">
                  \${retentionLabel}
                </span>
                <span class="card-time">\${timeStr}</span>
              </div>
              <div class="card-title-group">
                <div class="card-title" title="\${escapeHtml(s.title)}">\${escapeHtml(s.title)}</div>
                <div class="card-url" title="\${escapeHtml(s.url)}">\${escapeHtml(s.displayUrl || s.url)}</div>
              </div>
              \${pinsList ? \`<div class="pins-snippet">\${pinsList}</div>\` : ""}
            </div>
            <div class="card-footer">
              <div style="font-size: 11.5px; color: var(--text-muted); font-weight: 500;">
                \${s.pinCount} \${s.pinCount === 1 ? "pin" : "pins"}
              </div>
              <div class="card-actions">
                <a href="/v/\${s.id}.md" target="_blank" class="btn-card btn-outline">Markdown</a>
                <a href="/v/\${s.id}" class="btn-card btn-pro">View <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></a>
              </div>
            </div>
          </div>
        \`;
      }).join("");
    }

    function escapeHtml(str) {
      return String(str || "").replace(/[&<>"']/g, m => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      }[m] || m));
    }

    document.getElementById("searchInput").addEventListener("input", e => {
      const q = e.target.value.toLowerCase().trim();
      if (!q) {
        renderSessions(allSessions);
        return;
      }
      const filtered = allSessions.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.url.toLowerCase().includes(q) ||
        s.displayUrl.toLowerCase().includes(q) ||
        s.pins.some(p => p.comment.toLowerCase().includes(q))
      );
      renderSessions(filtered);
    });

    renderSessions(allSessions);
  </script>
</body>
</html>`;
}

function renderHistoryAuthenticationHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Pinar — Private History</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #f6f7f9; color: #18181b; padding: 24px; }
    .card { width: min(100%, 440px); padding: 28px; border: 1px solid #e4e4e7; border-radius: 14px; background: #fff; box-shadow: 0 12px 36px rgba(15,23,42,.08); }
    .mark { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; background: #2563eb; color: #fff; font-weight: 800; }
    h1 { margin: 20px 0 8px; font-size: 22px; letter-spacing: -.02em; }
    p { margin: 0; color: #64748b; font-size: 14px; line-height: 1.55; }
    .hint { margin-top: 20px; padding: 12px 14px; border-radius: 9px; background: #f4f4f5; color: #3f3f46; font-size: 13px; }
    @media (prefers-color-scheme: dark) {
      body { background: #0b0f17; color: #f8fafc; }
      .card { background: #141b26; border-color: #283142; }
      p { color: #94a3b8; }
      .hint { background: #1c2433; color: #cbd5e1; }
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="mark">P</div>
    <h1>Your history is private</h1>
    <p>Open Remote History from the Pinar extension. It will create a short-lived, one-time browser session for this installation.</p>
    <div class="hint">No email is required for the Free plan.</div>
  </main>
</body>
</html>`;
}

// In-memory fallback
const memoryStore = new Map();
const memoryInstallations = new Map();
const memoryBrowserTickets = new Map();
const memoryBrowserSessions = new Map();

function checkAdminAuth(c) {
  const secret = c.env.API_KEY || c.env.PINAR_API_KEY || c.env.AUTH_KEY;
  if (!secret) return false;
  const token = bearerToken(c);
  const apiKeyHeader = c.req.header("x-api-key") || "";
  return token === secret || apiKeyHeader === secret;
}

async function resolvePrincipal(c) {
  const now = new Date().toISOString();
  const browserToken = cookieValue(c, BROWSER_SESSION_COOKIE);
  if (BROWSER_SESSION_PATTERN.test(browserToken)) {
    const tokenHash = await hashCredential(browserToken);
    if (c.env.DB) {
      try {
        const session = await c.env.DB.prepare(`
          SELECT owner_id, plan, is_permanent
          FROM browser_sessions
          WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
        `).bind(tokenHash, now).first();
        if (session) {
          return {
            id: session.owner_id,
            isPermanent: Number(session.is_permanent) === 1,
            kind: "browser",
            plan: session.plan || "free",
          };
        }
      } catch {
        return null;
      }
    } else {
      const session = memoryBrowserSessions.get(tokenHash);
      if (session && !session.revokedAt && session.expiresAt > now) return session.principal;
    }
  }

  const token = bearerToken(c);
  const keyHeader = c.req.header("x-license-key") || c.req.header("x-api-key") || "";
  const candidateKey = token || keyHeader;

  if (candidateKey && c.env.DB) {
    try {
      const user = await c.env.DB.prepare(
        "SELECT * FROM users WHERE license_key = ? AND status = 'active'"
      ).bind(candidateKey).first();
      if (user && user.plan === "pro") {
        return { id: user.id, isPermanent: true, kind: "account", plan: "pro", user };
      }
    } catch {
      return null;
    }
  }

  const installationId = c.req.header("x-pinar-installation-id") || "";
  if (!INSTALLATION_ID_PATTERN.test(installationId) || !INSTALLATION_TOKEN_PATTERN.test(token)) return null;
  const tokenHash = await hashCredential(token);
  if (c.env.DB) {
    try {
      const installation = await c.env.DB.prepare(`
        SELECT id FROM installations WHERE id = ? AND token_hash = ? AND status = 'active'
      `).bind(installationId, tokenHash).first();
      if (!installation) return null;
      await c.env.DB.prepare("UPDATE installations SET last_seen_at = ?, updated_at = ? WHERE id = ?")
        .bind(now, now, installationId).run().catch(() => {});
      return { id: installation.id, isPermanent: false, kind: "installation", plan: "free" };
    } catch {
      return null;
    }
  }

  const installation = memoryInstallations.get(installationId);
  if (!installation || installation.status !== "active" || installation.tokenHash !== tokenHash) return null;
  return { id: installationId, isPermanent: false, kind: "installation", plan: "free" };
}

// Routes
app.get("/api/health", (c) => {
  return c.json({
    hasAuth: Boolean(c.env.API_KEY || c.env.PINAR_API_KEY || c.env.AUTH_KEY),
    hasBucket: Boolean(c.env.PINAR_BUCKET),
    hasDb: Boolean(c.env.DB),
    hasStripe: Boolean(c.env.STRIPE_SECRET_KEY),
    ok: true,
    service: "pinar",
  });
});

app.post("/api/installations", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const installationId = String(body.installationId || "");
  const installationToken = String(body.installationToken || "");
  if (!INSTALLATION_ID_PATTERN.test(installationId) || !INSTALLATION_TOKEN_PATTERN.test(installationToken)) {
    return c.json({ error: "Invalid installation identity" }, 400);
  }

  const tokenHash = await hashCredential(installationToken);
  const now = new Date().toISOString();
  if (c.env.DB) {
    try {
      const existing = await c.env.DB.prepare(
        "SELECT token_hash, status FROM installations WHERE id = ?",
      ).bind(installationId).first();
      if (existing) {
        if (existing.token_hash !== tokenHash || existing.status !== "active") {
          return c.json({ error: "Installation identity already exists" }, 409);
        }
        await c.env.DB.prepare("UPDATE installations SET last_seen_at = ?, updated_at = ? WHERE id = ?")
          .bind(now, now, installationId).run();
        return c.json({ installationId, ok: true });
      }
      await c.env.DB.prepare(`
        INSERT INTO installations (id, token_hash, status, created_at, updated_at, last_seen_at)
        VALUES (?, ?, 'active', ?, ?, ?)
      `).bind(installationId, tokenHash, now, now, now).run();
    } catch {
      return c.json({ error: "Installation registration unavailable" }, 503);
    }
  } else {
    const existing = memoryInstallations.get(installationId);
    if (existing && (existing.tokenHash !== tokenHash || existing.status !== "active")) {
      return c.json({ error: "Installation identity already exists" }, 409);
    }
    if (existing) return c.json({ installationId, ok: true });
    memoryInstallations.set(installationId, { status: "active", tokenHash });
  }

  return c.json({ installationId, ok: true }, 201);
});

app.post("/api/installations/rotate", async (c) => {
  const current = await resolvePrincipal(c);
  if (!current || current.kind !== "installation") return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const nextId = String(body.installationId || "");
  const nextToken = String(body.installationToken || "");
  if (
    nextId === current.id ||
    !INSTALLATION_ID_PATTERN.test(nextId) ||
    !INSTALLATION_TOKEN_PATTERN.test(nextToken)
  ) {
    return c.json({ error: "Invalid replacement identity" }, 400);
  }

  const nextTokenHash = await hashCredential(nextToken);
  const now = new Date().toISOString();
  if (c.env.DB) {
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(`
          INSERT INTO installations (id, token_hash, status, created_at, updated_at, last_seen_at)
          VALUES (?, ?, 'active', ?, ?, ?)
        `).bind(nextId, nextTokenHash, now, now, now),
        c.env.DB.prepare("UPDATE sessions SET user_id = ? WHERE user_id = ?").bind(nextId, current.id),
        c.env.DB.prepare("UPDATE installations SET status = 'revoked', updated_at = ? WHERE id = ?")
          .bind(now, current.id),
        c.env.DB.prepare("UPDATE browser_sessions SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL")
          .bind(now, current.id),
        c.env.DB.prepare("DELETE FROM browser_tickets WHERE owner_id = ?").bind(current.id),
      ]);
    } catch {
      return c.json({ error: "Installation rotation failed" }, 409);
    }
  } else {
    if (memoryInstallations.has(nextId)) return c.json({ error: "Installation identity already exists" }, 409);
    memoryInstallations.set(nextId, { status: "active", tokenHash: nextTokenHash });
    const previous = memoryInstallations.get(current.id);
    if (previous) previous.status = "revoked";
    for (const session of memoryStore.values()) {
      if (session.userId === current.id) session.userId = nextId;
    }
    for (const browserSession of memoryBrowserSessions.values()) {
      if (browserSession.principal.id === current.id) browserSession.revokedAt = now;
    }
    for (const [ticketHash, ticket] of memoryBrowserTickets) {
      if (ticket.principal.id === current.id) memoryBrowserTickets.delete(ticketHash);
    }
  }

  return c.json({ installationId: nextId, ok: true });
});

app.post("/api/auth/browser-ticket", async (c) => {
  const principal = await resolvePrincipal(c);
  if (!principal) return c.json({ error: "Unauthorized" }, 401);
  const ticket = randomCredential("pbt_");
  const tokenHash = await hashCredential(ticket);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60 * 1000).toISOString();
  const record = {
    principal: {
      id: principal.id,
      isPermanent: principal.isPermanent,
      kind: "browser",
      plan: principal.plan,
    },
    expiresAt,
    usedAt: null,
  };

  if (c.env.DB) {
    try {
      await c.env.DB.prepare(`
        INSERT INTO browser_tickets (token_hash, owner_id, plan, is_permanent, expires_at, used_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `).bind(
        tokenHash,
        principal.id,
        principal.plan,
        principal.isPermanent ? 1 : 0,
        expiresAt,
        now.toISOString(),
      ).run();
    } catch {
      return c.json({ error: "Browser ticket unavailable" }, 503);
    }
  } else {
    memoryBrowserTickets.set(tokenHash, record);
  }

  const origin = new URL(c.req.url).origin;
  return c.json({ expiresAt, ok: true, url: `${origin}/api/auth/device?ticket=${encodeURIComponent(ticket)}` });
});

app.get("/api/auth/device", async (c) => {
  const ticket = c.req.query("ticket") || "";
  if (!BROWSER_TICKET_PATTERN.test(ticket)) return c.html(renderHistoryAuthenticationHtml(), 401);
  const tokenHash = await hashCredential(ticket);
  const now = new Date();
  const nowIso = now.toISOString();
  let principal = null;

  if (c.env.DB) {
    try {
      const claimed = await c.env.DB.prepare(`
        UPDATE browser_tickets SET used_at = ?
        WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
        RETURNING owner_id, plan, is_permanent
      `).bind(nowIso, tokenHash, nowIso).first();
      if (claimed) {
        principal = {
          id: claimed.owner_id,
          isPermanent: Number(claimed.is_permanent) === 1,
          kind: "browser",
          plan: claimed.plan || "free",
        };
      }
    } catch {
      return c.html(renderHistoryAuthenticationHtml(), 503);
    }
  } else {
    const record = memoryBrowserTickets.get(tokenHash);
    if (record && !record.usedAt && record.expiresAt > nowIso) {
      record.usedAt = nowIso;
      principal = record.principal;
    }
  }

  if (!principal) return c.html(renderHistoryAuthenticationHtml(), 401);
  const browserToken = randomCredential("pbs_");
  const browserTokenHash = await hashCredential(browserToken);
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  if (c.env.DB) {
    try {
      await c.env.DB.prepare(`
        INSERT INTO browser_sessions (token_hash, owner_id, plan, is_permanent, expires_at, revoked_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?)
      `).bind(
        browserTokenHash,
        principal.id,
        principal.plan,
        principal.isPermanent ? 1 : 0,
        expiresAt,
        nowIso,
      ).run();
    } catch {
      return c.html(renderHistoryAuthenticationHtml(), 503);
    }
  } else {
    memoryBrowserSessions.set(browserTokenHash, { expiresAt, principal, revokedAt: null });
  }

  c.header(
    "Set-Cookie",
    `${BROWSER_SESSION_COOKIE}=${encodeURIComponent(browserToken)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
  );
  c.header("Cache-Control", "no-store");
  c.header("Referrer-Policy", "no-referrer");
  return c.redirect("/history", 302);
});

app.post("/api/auth/logout", async (c) => {
  const browserToken = cookieValue(c, BROWSER_SESSION_COOKIE);
  if (BROWSER_SESSION_PATTERN.test(browserToken)) {
    const tokenHash = await hashCredential(browserToken);
    const now = new Date().toISOString();
    if (c.env.DB) {
      await c.env.DB.prepare("UPDATE browser_sessions SET revoked_at = ? WHERE token_hash = ?")
        .bind(now, tokenHash).run().catch(() => {});
    } else {
      const session = memoryBrowserSessions.get(tokenHash);
      if (session) session.revokedAt = now;
    }
  }
  c.header("Set-Cookie", `${BROWSER_SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
  return c.json({ ok: true });
});

app.get("/install.sh", async (c) => {
  const script = await fetch("https://raw.githubusercontent.com/djalmajr/pinar/main/install.sh").then(r => r.text()).catch(() => "");
  return c.text(script, 200, { "Content-Type": "text/plain; charset=utf-8" });
});

app.get("/install.ps1", async (c) => {
  const script = await fetch("https://raw.githubusercontent.com/djalmajr/pinar/main/install.ps1").then(r => r.text()).catch(() => "");
  return c.text(script, 200, { "Content-Type": "text/plain; charset=utf-8" });
});

app.get("/pricing", (c) => {
  const appShell = serveAppShell(c);
  if (appShell) return appShell;
  const origin = new URL(c.req.url).origin;
  return c.html(renderPricingHtml(origin));
});

app.get("/success", async (c) => {
  const sessionId = c.req.query("session_id");
  const origin = new URL(c.req.url).origin;
  let user = null;

  if (sessionId && c.env.STRIPE_SECRET_KEY && c.env.DB) {
    try {
      const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}`, {
        headers: { "Authorization": `Bearer ${c.env.STRIPE_SECRET_KEY}` },
      });
      const session = await res.json();
      if (session?.customer) {
        user = await c.env.DB.prepare("SELECT * FROM users WHERE stripe_customer_id = ?").bind(session.customer).first();
        if (!user) {
          const email = session.customer_details?.email || session.customer_email || `user-${Date.now()}@pinar.dev`;
          const licenseKey = `pinar_${crypto.randomUUID().replace(/-/g, "")}`;
          const now = new Date().toISOString();
          const userId = `usr_${Date.now()}`;
          await c.env.DB.prepare(`
            INSERT INTO users (id, email, license_key, plan, stripe_customer_id, stripe_subscription_id, status, storage_limit_mb, created_at, updated_at)
            VALUES (?, ?, ?, 'pro', ?, ?, 'active', 5120, ?, ?)
            ON CONFLICT(email) DO UPDATE SET plan='pro', license_key=excluded.license_key, stripe_customer_id=excluded.stripe_customer_id, status='active', updated_at=excluded.updated_at
          `).bind(userId, email, licenseKey, session.customer, String(session.subscription || ""), now, now).run();
          user = { email, license_key: licenseKey, plan: "pro" };
        }
      }
    } catch {
      /* fallback */
    }
  }

  return c.html(renderSuccessHtml(origin, user));
});

app.get("/history", async (c) => {
  const principal = await resolvePrincipal(c);
  if (!principal) {
    c.header("Cache-Control", "no-store");
    return c.html(renderHistoryAuthenticationHtml(), 401);
  }

  const origin = new URL(c.req.url).origin;
  try {
    c.header("Cache-Control", "no-store");
    const appShell = serveAppShell(c);
    if (appShell) return appShell;
    const sessions = await listSessionsForPrincipal(c, principal);
    return c.html(renderRemoteDashboardHtml(origin, sessions));
  } catch {
    return c.json({ error: "History unavailable" }, 503);
  }
});

app.get("/", async (c) => {
  return c.redirect("/history");
});

app.get("/shots/:id", async (c) => {
  const rawId = c.req.param("id");
  const shotKey = rawId.endsWith(".png") ? rawId : `${rawId}.png`;

  if (c.env.PINAR_BUCKET) {
    const object = await c.env.PINAR_BUCKET.get(shotKey);
    if (object) {
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      headers.set("Cache-Control", "public, max-age=86400");
      headers.set("Content-Type", "image/png");
      return new Response(object.body, { headers });
    }
  }
  return c.json({ error: "shot not found" }, 404);
});

// Interactive Web Viewer or Raw Markdown
app.get("/v/:id", async (c) => {
  const rawParam = c.req.param("id");
  const isMarkdown = rawParam.endsWith(".md") || c.req.header("accept")?.includes("text/markdown");
  const id = rawParam.replace(/\.md$/, "");
  const origin = new URL(c.req.url).origin;
  let session = await findPublicSession(c, id);

  if (!session) {
    session = {
      createdAt: new Date().toISOString(),
      id,
      page: { title: "Pinar Annotation", url: "" },
      pins: [],
      shotId: id,
      shotUrl: `${origin}/shots/${id}.png`,
    };
  }

  const viewerUrl = `${origin}/v/${id}`;
  if (isMarkdown) {
    const md = formatSessionMarkdown(session, viewerUrl);
    return c.text(md, 200, {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=60",
    });
  }

  const appShell = serveAppShell(c);
  if (appShell) return appShell;
  return c.html(renderViewerHtml(session, origin));
});

// Stripe Checkout
app.post("/api/stripe/checkout", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const origin = new URL(c.req.url).origin;
  const interval = body.interval === "year" ? "year" : (body.interval === "lifetime" ? "lifetime" : "month");
  const email = body.email || "";

  const secretKey = c.env.STRIPE_SECRET_KEY;
  if (!secretKey) return c.json({ error: "STRIPE_SECRET_KEY not configured" }, 500);

  const isLifetime = interval === "lifetime";
  const isYearly = interval === "year";
  const priceId = isLifetime
    ? (c.env.STRIPE_PRICE_LIFETIME || c.env.STRIPE_PRICE_YEARLY)
    : (isYearly ? c.env.STRIPE_PRICE_YEARLY : c.env.STRIPE_PRICE_MONTHLY);

  const params = new URLSearchParams();
  params.append("mode", isLifetime ? "payment" : "subscription");
  params.append("payment_method_types[0]", "card");
  params.append("line_items[0][price]", priceId);
  params.append("line_items[0][quantity]", "1");
  params.append("success_url", `${origin}/success?session_id={CHECKOUT_SESSION_ID}`);
  params.append("cancel_url", `${origin}/pricing`);
  if (email) params.append("customer_email", email);
  params.append("allow_promotion_codes", "true");

  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) return c.json({ error: data.error?.message || "Checkout failed" }, 400);
  return c.json({ ok: true, url: data.url });
});

// Stripe Portal
app.post("/api/stripe/portal", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const licenseKey = body.licenseKey || c.req.header("x-license-key") || "";
  const origin = new URL(c.req.url).origin;
  let customerId = "";

  if (licenseKey && c.env.DB) {
    const user = await c.env.DB.prepare("SELECT stripe_customer_id FROM users WHERE license_key = ?").bind(licenseKey).first();
    if (user?.stripe_customer_id) customerId = user.stripe_customer_id;
  }

  if (!customerId) return c.json({ error: "No active Stripe customer found for this license" }, 404);

  const params = new URLSearchParams();
  params.append("customer", customerId);
  params.append("return_url", `${origin}/history`);

  const res = await fetch("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${c.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const data = await res.json();
  if (!res.ok) return c.json({ error: data.error?.message || "Portal session failed" }, 400);
  return c.json({ ok: true, url: data.url });
});

// Stripe Webhook
app.post("/api/stripe/webhook", async (c) => {
  const event = await c.req.json().catch(() => ({}));
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    if (session?.customer && c.env.DB) {
      const email = session.customer_details?.email || session.customer_email || `user-${Date.now()}@pinar.dev`;
      const licenseKey = `pinar_${crypto.randomUUID().replace(/-/g, "")}`;
      const now = new Date().toISOString();
      const userId = `usr_${Date.now()}`;
      await c.env.DB.prepare(`
        INSERT INTO users (id, email, license_key, plan, stripe_customer_id, stripe_subscription_id, status, storage_limit_mb, created_at, updated_at)
        VALUES (?, ?, ?, 'pro', ?, ?, 'active', 5120, ?, ?)
        ON CONFLICT(email) DO UPDATE SET plan='pro', license_key=excluded.license_key, stripe_customer_id=excluded.stripe_customer_id, stripe_subscription_id=excluded.stripe_subscription_id, status='active', updated_at=excluded.updated_at
      `).bind(userId, email, licenseKey, session.customer, String(session.subscription || ""), now, now).run();
    }
  } else if (event.type === "customer.subscription.deleted") {
    const sub = event.data?.object;
    if (sub?.customer && c.env.DB) {
      await c.env.DB.prepare("UPDATE users SET plan='free', status='canceled', updated_at=? WHERE stripe_customer_id=?")
        .bind(new Date().toISOString(), sub.customer).run();
    }
  }
  return c.json({ received: true });
});

// Verify License Key
app.all("/api/auth/verify", async (c) => {
  const authHeader = c.req.header("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
  const urlKey = c.req.query("key") || "";
  const candidateKey = token || urlKey;

  if (!candidateKey) return c.json({ error: "license key required", valid: false }, 400);

  if (c.env.DB) {
    const user = await c.env.DB.prepare(
      "SELECT id, email, plan, status, storage_limit_mb, storage_used_bytes FROM users WHERE license_key = ?"
    ).bind(candidateKey).first();

    if (user && user.status === "active") {
      return c.json({
        email: user.email,
        ok: true,
        plan: user.plan,
        storage: {
          limitMb: user.storage_limit_mb,
          usedBytes: user.storage_used_bytes,
        },
        valid: true,
      });
    }
  }

  return c.json({ error: "Invalid or inactive license key", valid: false }, 404);
});

// Shots upload
app.post("/api/shots", async (c) => {
  const principal = await resolvePrincipal(c);
  if (!principal) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  if (!SESSION_ID_PATTERN.test(String(body.id || "")) || !body.image) {
    return c.json({ error: "valid id and image required" }, 400);
  }

  const origin = new URL(c.req.url).origin;
  const shotId = String(body.id);
  const shotKey = `${shotId}.png`;
  const shotUrl = `${origin}/shots/${shotKey}`;
  let imageBytes;
  try {
    imageBytes = extractImageBytes(body.image);
  } catch {
    return c.json({ error: "invalid image" }, 400);
  }
  const byteSize = imageBytes.byteLength || 0;

  if (c.env.DB) {
    try {
      const existing = await c.env.DB.prepare("SELECT user_id FROM sessions WHERE id = ?")
        .bind(shotId).first();
      if (existing && existing.user_id !== principal.id) {
        return c.json({ error: "Session id is unavailable" }, 409);
      }
    } catch {
      return c.json({ error: "Session ownership unavailable" }, 503);
    }
  } else {
    const existing = memoryStore.get(shotId);
    if (existing && existing.userId !== principal.id) {
      return c.json({ error: "Session id is unavailable" }, 409);
    }
  }

  if (c.env.PINAR_BUCKET) {
    await c.env.PINAR_BUCKET.put(shotKey, imageBytes, {
      httpMetadata: { contentType: "image/png" },
    });
  }

  const session = {
    byteSize,
    createdAt: body.createdAt || new Date().toISOString(),
    id: shotId,
    isPermanent: principal.isPermanent ? 1 : 0,
    page: body.page || {},
    pins: body.pins || [],
    plan: principal.plan,
    shotId,
    shotUrl,
    userId: principal.id,
  };

  if (c.env.DB) {
    try {
      await c.env.DB.prepare(`
        INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          url=excluded.url, title=excluded.title, shot_id=excluded.shot_id,
          shot_url=excluded.shot_url, pin_count=excluded.pin_count,
          pins_json=excluded.pins_json, created_at=excluded.created_at,
          user_id=excluded.user_id, plan=excluded.plan, is_permanent=excluded.is_permanent, byte_size=excluded.byte_size
      `).bind(
        shotId,
        session.page.url || "",
        session.page.title || "",
        shotId,
        shotUrl,
        session.pins.length,
        JSON.stringify(session.pins),
        session.createdAt,
        session.userId,
        session.plan,
        session.isPermanent,
        session.byteSize,
      ).run();
    } catch {
      return c.json({ error: "Session persistence failed" }, 503);
    }
  } else {
    memoryStore.set(shotId, session);
  }

  return c.json({
    isPermanent: Boolean(session.isPermanent),
    markdownUrl: `${origin}/v/${shotId}.md`,
    ok: true,
    path: shotUrl,
    plan: session.plan,
    shotUrl,
    viewerUrl: `${origin}/v/${shotId}.md`,
  }, 201);
});

// Record History
app.post("/api/history", async (c) => {
  const principal = await resolvePrincipal(c);
  if (!principal) return c.json({ error: "Unauthorized" }, 401);
  const body = await c.req.json().catch(() => ({}));
  const origin = new URL(c.req.url).origin;
  const sid = String(body.id || generateNanoId(12));
  if (!SESSION_ID_PATTERN.test(sid)) return c.json({ error: "invalid session id" }, 400);

  if (c.env.DB) {
    try {
      const existing = await c.env.DB.prepare("SELECT user_id FROM sessions WHERE id = ?")
        .bind(sid).first();
      if (existing && existing.user_id !== principal.id) {
        return c.json({ error: "Session id is unavailable" }, 409);
      }
    } catch {
      return c.json({ error: "Session ownership unavailable" }, 503);
    }
  } else {
    const existing = memoryStore.get(sid);
    if (existing && existing.userId !== principal.id) {
      return c.json({ error: "Session id is unavailable" }, 409);
    }
  }

  const session = {
    byteSize: body.byteSize || 0,
    createdAt: body.createdAt || new Date().toISOString(),
    id: sid,
    isPermanent: principal.isPermanent ? 1 : 0,
    page: body.page || {},
    pins: body.pins || [],
    plan: principal.plan,
    shotId: body.shotId,
    shotUrl: body.shotUrl || (body.shotId ? `${origin}/shots/${body.shotId}.png` : null),
    userId: principal.id,
  };

  if (c.env.DB) {
    try {
      await c.env.DB.prepare(`
        INSERT INTO sessions (id, url, title, shot_id, shot_url, pin_count, pins_json, created_at, user_id, plan, is_permanent, byte_size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          url=excluded.url, title=excluded.title, shot_id=excluded.shot_id,
          shot_url=excluded.shot_url, pin_count=excluded.pin_count,
          pins_json=excluded.pins_json, created_at=excluded.created_at,
          user_id=excluded.user_id, plan=excluded.plan, is_permanent=excluded.is_permanent,
          byte_size=excluded.byte_size
      `).bind(
        sid,
        session.page.url || "",
        session.page.title || "",
        session.shotId || "",
        session.shotUrl || "",
        session.pins.length,
        JSON.stringify(session.pins),
        session.createdAt,
        session.userId,
        session.plan,
        session.isPermanent,
        session.byteSize,
      ).run();
    } catch {
      return c.json({ error: "Session persistence failed" }, 503);
    }
  } else {
    memoryStore.set(sid, session);
  }

  return c.json({ ok: true, session }, 201);
});

// Query History
app.get("/api/history", async (c) => {
  const principal = await resolvePrincipal(c);
  if (!principal) return c.json({ error: "Unauthorized" }, 401);
  const query = c.req.query("q") || "";
  try {
    const sessions = await listSessionsForPrincipal(c, principal, query, c.req.query("limit"));
    c.header("Cache-Control", "no-store");
    return c.json({ ok: true, sessions });
  } catch {
    return c.json({ error: "History unavailable" }, 503);
  }
});

app.get("/api/sessions/:id", async (c) => {
  const session = await findPublicSession(c, c.req.param("id"));
  if (!session) return c.json({ error: "Session not found" }, 404);
  c.header("Cache-Control", "public, max-age=60");
  return c.json({ ok: true, session });
});

app.delete("/api/history/:id", async (c) => {
  const principal = await resolvePrincipal(c);
  if (!principal) return c.json({ error: "Unauthorized" }, 401);
  const id = c.req.param("id");
  if (!SESSION_ID_PATTERN.test(id)) return c.json({ error: "Session not found" }, 404);

  let shotId = id;
  if (c.env.DB) {
    try {
      const existing = await c.env.DB.prepare(
        "SELECT shot_id FROM sessions WHERE id = ? AND user_id = ?",
      ).bind(id, principal.id).first();
      if (!existing) return c.json({ error: "Session not found" }, 404);
      shotId = existing.shot_id || id;
      await c.env.DB.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?")
        .bind(id, principal.id).run();
    } catch {
      return c.json({ error: "Session deletion failed" }, 503);
    }
  } else {
    const existing = memoryStore.get(id);
    if (!existing || existing.userId !== principal.id) {
      return c.json({ error: "Session not found" }, 404);
    }
    shotId = existing.shotId || id;
    memoryStore.delete(id);
  }

  if (c.env.PINAR_BUCKET) {
    await c.env.PINAR_BUCKET.delete(`${shotId}.png`).catch(() => {});
  }
  return c.json({ ok: true });
});

// Cleanup Cron and manual endpoint
async function cleanupOldRecords(env, days = 7) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  let deletedCount = 0;

  if (env.DB) {
    try {
      const { results } = await env.DB.prepare(
        "SELECT id, shot_id FROM sessions WHERE created_at < ? AND (plan = 'free' OR plan IS NULL OR is_permanent = 0)"
      ).bind(cutoff).all();

      if (results && results.length > 0) {
        if (env.PINAR_BUCKET) {
          const keysToDelete = results.map((r) => `${r.shot_id || r.id}.png`);
          await Promise.all(keysToDelete.map((key) => env.PINAR_BUCKET.delete(key).catch(() => {})));
        }
        await env.DB.prepare(
          "DELETE FROM sessions WHERE created_at < ? AND (plan = 'free' OR plan IS NULL OR is_permanent = 0)"
        ).bind(cutoff).run();
        deletedCount = results.length;
      }
    } catch (e) {
      console.error("Cleanup error:", e);
    }
  }

  return { cutoff, deletedCount };
}

app.post("/api/cleanup", async (c) => {
  if (!checkAdminAuth(c)) return c.json({ error: "Unauthorized" }, 401);
  const days = Number(c.req.query("days")) || 7;
  const result = await cleanupOldRecords(c.env, days);
  return c.json({ ok: true, ...result });
});

export function resetMemoryStateForTests() {
  memoryStore.clear();
  memoryInstallations.clear();
  memoryBrowserTickets.clear();
  memoryBrowserSessions.clear();
}

app.notFound((c) => {
  if (c.env.ASSETS) return c.env.ASSETS.fetch(c.req.raw);
  return c.json({ error: "Not found" }, 404);
});

export { app };

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupOldRecords(env, 7));
  },
};
