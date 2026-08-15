import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import http from "node:http";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { openHistoryDb } from "./history.mjs";
import { pinarHome, shotsDir } from "./paths.mjs";
import { writeShot } from "./shots.mjs";

function setCors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
}

function sendJson(res, data, status = 200) {
  setCors(res);
  const body = JSON.stringify(data);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body);
}

function sendHtml(res, html, status = 200) {
  setCors(res);
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

const WEB_CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const checkoutWebRoot = fileURLToPath(new URL("../apps/web/dist", import.meta.url));
let bundledWebAssetsPromise;

function getBundledWebAssets() {
  bundledWebAssetsPromise ??= import("./web-assets.generated.mjs")
    .then((module) => module.webAssets)
    .catch(() => null);
  return bundledWebAssetsPromise;
}

async function serveWebAsset(res, requestPath, webRoot) {
  const safePath = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  const bundledAssets = webRoot ? null : await getBundledWebAssets();
  const bundledAsset = bundledAssets?.[safePath];
  if (bundledAsset) {
    setCors(res);
    res.writeHead(200, {
      "cache-control": safePath === "/index.html" ? "no-cache" : "public, max-age=31536000, immutable",
      "content-type": bundledAsset.contentType,
    });
    res.end(Buffer.from(bundledAsset.data, "base64"));
    return true;
  }

  const root = resolve(webRoot || checkoutWebRoot);
  const candidate = resolve(root, safePath.slice(1));
  if (relative(root, candidate).startsWith(`..${sep}`) || !existsSync(candidate)) return false;
  const content = await readFile(candidate);
  setCors(res);
  res.writeHead(200, {
    "cache-control": safePath === "/index.html" ? "no-cache" : "public, max-age=31536000, immutable",
    "content-type": WEB_CONTENT_TYPES[extname(candidate)] || "application/octet-stream",
  });
  res.end(content);
  return true;
}

function presentSession(session, port) {
  if (!session) return null;
  const shotId = session.shotId || session.id;
  return {
    ...session,
    isPermanent: true,
    plan: "free",
    shotUrl: shotId ? `http://127.0.0.1:${port}/shots/${shotId}.png` : null,
    viewerUrl: `http://127.0.0.1:${port}/v/${session.id}.md`,
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function renderDashboardHtml(port) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Pinar — Annotation History</title>
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
      --bg: oklch(0.975 0.003 247.8);
      --card-bg: oklch(1 0 0);
      --border: oklch(0.91 0.007 247.8);
      --text: oklch(0.153 0.006 107.1);
      --text-muted: oklch(0.55 0.02 247.8);
      --primary: oklch(0.55 0.22 255);
      --primary-hover: #1D4ED8;
      --mark: #2563EB;
      --danger: #EF4444;
      --radius: .75rem;
    }
    :root[data-theme="dark"], .dark {
      --bg: oklch(0.12 0.006 250);
      --card-bg: oklch(0.18 0.008 250);
      --border: oklch(1 0 0 / 10%);
      --text: oklch(0.988 0.003 106.5);
      --text-muted: oklch(0.70 0.02 250);
      --mark: #6691F2;
      --primary: #5794FF;
      --primary-hover: #3B82F6;
      --danger: #EF4444;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
      padding: 0;
    }
    .container { max-width: 1180px; margin: 0 auto; padding: 28px 20px; }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 0;
      padding: 10px 20px;
      border-bottom: 1px solid #3b404a;
      background: #30343d;
      flex-wrap: wrap;
      gap: 16px;
    }
    header .logo-area { max-width: 1180px; width: 100%; margin: 0 auto; }
    header .logo-text h1 { color: #f8fafc; }
    header .logo-text p { display: none; }
    header .header-actions { margin-left: auto; }
    header .header-btn { background: transparent; color: #f8fafc; border-color: #626975; }
    .logo-area { display: flex; align-items: center; gap: 12px; }
    .logo-badge {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: var(--primary);
      color: #fff;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .logo-badge svg { width: 18px; height: 18px; fill: currentColor; }
    .logo-text h1 { font-size: 16px; font-weight: 700; display: flex; align-items: center; gap: 6px; }
    .logo-text p { font-size: 12px; color: var(--text-muted); }
    .tag {
      font-size: 10px;
      background: rgba(87,148,255,0.1);
      color: var(--primary);
      border: 1px solid rgba(87,148,255,0.3);
      padding: 2px 6px;
      border-radius: 6px;
      font-family: monospace;
      font-weight: 600;
    }
    .header-actions { display: flex; align-items: center; gap: 8px; }
    .header-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text);
      text-decoration: none;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }
    .header-btn > svg { width: 14px; height: 14px; }
    .header-btn:hover { background: rgba(87,148,255,0.06); border-color: var(--primary); }
    .header-btn-amber {
      background: rgba(245,158,11,0.1);
      border-color: rgba(245,158,11,0.3);
      color: #d97706;
    }
    .header-btn-amber:hover { background: rgba(245,158,11,0.2); }
    .header-btn-pink {
      background: rgba(236,72,153,0.1);
      border-color: rgba(236,72,153,0.3);
      color: #db2777;
    }
    .header-btn-pink:hover { background: rgba(236,72,153,0.2); }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 20px;
    }
    .search-bar {
      display: flex;
      align-items: center;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 12px;
      flex: 1;
      max-width: 480px;
    }
    .search-bar svg { width: 15px; height: 15px; color: var(--text-muted); flex-shrink: 0; }
    .search-bar input {
      border: none;
      outline: none;
      background: transparent;
      color: var(--text);
      font-size: 13px;
      width: 100%;
      margin-left: 8px;
    }
    .session-count {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-muted);
      border: 1px solid var(--border);
      background: var(--card-bg);
      padding: 6px 12px;
      border-radius: 8px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
      gap: 16px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      transition: border-color 0.15s ease;
    }
    .card:hover { border-color: rgba(87,148,255,0.5); }
    .shot-preview {
      aspect-ratio: 16 / 9;
      background: rgba(0,0,0,0.05);
      border-bottom: 1px solid var(--border);
      overflow: hidden;
      display: block;
      position: relative;
    }
    .shot-preview img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: top;
      display: block;
    }
    .card-body { padding: 14px; flex: 1; }
    .card-meta-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 6px;
    }
    .card-title {
      font-size: 14px;
      font-weight: 600;
      color: var(--text);
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
    }
    .card-title:hover { color: var(--primary); }
    .card-url {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: block;
      margin-top: 2px;
    }
    .pins-list {
      margin-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .pin-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 12px;
      background: rgba(0,0,0,0.02);
      border: 1px solid var(--border);
      padding: 6px 8px;
      border-radius: 6px;
    }
    .pin-badge {
      background: rgba(87,148,255,0.15);
      color: var(--primary);
      font-weight: 700;
      font-size: 10px;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: grid;
      place-items: center;
      flex-shrink: 0;
    }
    .pin-comment { font-weight: 500; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .card-footer {
      padding: 10px 14px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      background: rgba(0,0,0,0.01);
    }
    .empty-state {
      grid-column: 1 / -1;
      text-align: center;
      padding: 60px 20px;
      border: 1px dashed var(--border);
      border-radius: var(--radius);
      color: var(--text-muted);
      font-size: 13px;
    }
    /* Shadcn-inspired composition, using the same semantic tokens as @pinar/ui. */
    body { min-height: 100vh; }
    .app-header {
      position: sticky;
      top: 0;
      z-index: 20;
      width: 100%;
      padding: 0;
      border-bottom: 1px solid var(--border);
      background: color-mix(in oklab, var(--card-bg) 92%, transparent);
      backdrop-filter: blur(16px);
    }
    .header-inner {
      width: min(100%, 1440px);
      min-height: 64px;
      margin: 0 auto;
      padding: 0 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
    }
    .app-header .logo-area { width: auto; margin: 0; }
    .app-header .logo-text h1 { color: var(--text); font-size: 15px; letter-spacing: -0.01em; }
    .app-header .header-actions { margin-left: 0; }
    .app-header .header-btn {
      min-height: 32px;
      padding: 0 11px;
      border-color: var(--border);
      background: var(--card-bg);
      color: var(--text);
      font-weight: 600;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
    }
    .app-header .header-btn:hover { background: color-mix(in oklab, var(--text) 5%, var(--card-bg)); }
    .app-header .header-btn-primary { border-color: var(--primary); background: var(--primary); color: #fff; }
    .app-header .header-btn-primary:hover { background: var(--primary-hover); }
    .container { width: min(100%, 1440px); max-width: none; padding: 32px; }
    .content-heading {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 24px;
    }
    .content-heading h2 { font-size: 24px; line-height: 1.2; letter-spacing: -0.025em; }
    .content-heading p { margin-top: 6px; color: var(--text-muted); font-size: 13px; }
    .toolbar { margin-bottom: 24px; }
    .search-bar {
      max-width: 560px;
      min-height: 40px;
      padding: 0 12px;
      border-radius: 9px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.03);
    }
    .search-bar:focus-within { border-color: var(--primary); box-shadow: 0 0 0 3px color-mix(in oklab, var(--primary) 16%, transparent); }
    .session-count { min-height: 32px; display: inline-flex; align-items: center; border-radius: 999px; padding: 0 12px; }
    .grid { grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 20px; }
    .card {
      min-width: 0;
      border-color: color-mix(in oklab, var(--text) 10%, transparent);
      border-radius: 12px;
      box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.035);
      transition: border-color .18s ease, box-shadow .18s ease, transform .18s ease;
    }
    .card:hover { border-color: color-mix(in oklab, var(--primary) 35%, var(--border)); box-shadow: 0 12px 32px rgba(15, 23, 42, 0.09); transform: translateY(-2px); }
    .shot-preview { aspect-ratio: 16 / 9; background: color-mix(in oklab, var(--text) 4%, var(--card-bg)); }
    .shot-preview::after { content: ""; position: absolute; inset: 0; box-shadow: inset 0 -1px var(--border); pointer-events: none; }
    .card-body { min-height: 148px; padding: 18px; }
    .card-meta-top { margin-bottom: 12px; }
    .tag { height: 22px; display: inline-flex; align-items: center; padding: 0 8px; border-radius: 999px; font-family: inherit; font-size: 10px; letter-spacing: .02em; text-transform: uppercase; }
    .card-title { font-size: 15px; letter-spacing: -0.01em; }
    .card-url { margin-top: 3px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 11px; }
    .pins-list { margin-top: 14px; }
    .pin-item { align-items: center; min-height: 34px; padding: 7px 9px; border: 0; background: color-mix(in oklab, var(--text) 4%, var(--card-bg)); }
    .card-footer { min-height: 54px; padding: 10px 18px; background: color-mix(in oklab, var(--text) 2.5%, var(--card-bg)); }
    .card-actions { display: flex; align-items: center; gap: 8px; }
    .card-button { box-sizing: border-box; height: 32px; min-height: 32px; padding: 0 11px; border: 1px solid var(--border); border-radius: 8px; background: var(--card-bg); color: var(--text); display: inline-flex; align-items: center; justify-content: center; gap: 6px; line-height: 1; text-decoration: none; font-size: 12px; font-weight: 600; }
    .card-button:hover { background: color-mix(in oklab, var(--text) 5%, var(--card-bg)); }
    .card-button-primary { border-color: var(--primary); background: var(--primary); color: #fff; }
    .card-button-primary:hover { background: var(--primary-hover); }
    @media (max-width: 760px) {
      .header-inner, .container { padding-left: 18px; padding-right: 18px; }
      .header-actions .support-label { display: none; }
      .content-heading { align-items: flex-start; flex-direction: column; }
      .toolbar { align-items: stretch; }
      .search-bar { max-width: none; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
    <header class="app-header">
      <div class="header-inner">
      <div class="logo-area">
        <div class="logo-badge">
          <svg viewBox="1.8 1.8 20.4 20.4">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M2 12C2 6.477 6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10a10 10 0 0 1-4.262-.951l-4.537.93a1 1 0 0 1-1.18-1.18l.93-4.537A10 10 0 0 1 2 12m10-4a1 1 0 0 1 1 1v2h2a1 1 0 1 1 0 2h-2v2a1 1 0 1 1-2 0v-2H9a1 1 0 1 1 0-2h2V9a1 1 0 0 1 1-1"/>
          </svg>
        </div>
        <div class="logo-text">
              <h1>Pinar Cloud History</h1>
        </div>
      </div>
      <div class="header-actions">
        <button id="btnThemeToggle" onclick="toggleTheme()" class="header-btn" title="Toggle theme"></button>
        <a href="https://github.com/djalmajr/pinar" target="_blank" rel="noopener noreferrer" class="header-btn" title="GitHub" aria-label="GitHub">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z"/></svg>
        </a>
        <a href="https://buymeacoffee.com/djalmajr" target="_blank" rel="noopener noreferrer" class="header-btn header-btn-amber">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h12Z"/><path d="M6 2v2"/><path d="M17 10h2a2 2 0 0 1 2 2v1a2 2 0 0 1-2 2h-2"/></svg>
          <span class="support-label">Coffee</span>
        </a>
        <a href="https://github.com/sponsors/djalmajr" target="_blank" rel="noopener noreferrer" class="header-btn header-btn-pink">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
          <span class="support-label">Sponsor</span>
        </a>
        <a href="https://pinar.dev/pricing" class="header-btn header-btn-primary">Upgrade to Pro</a>
      </div>
      </div>
    </header>
  <main class="container">
    <div class="content-heading">
      <div>
        <h2>Annotation history</h2>
        <p>Browse, review, and share every visual feedback session.</p>
      </div>
    </div>
    <div class="toolbar">
      <div class="search-bar">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
        <input type="text" id="searchInput" placeholder="Search by title, url, comments, or selectors…" />
      </div>
      <div class="session-count" id="stats">0 sessions</div>
    </div>

    <div class="grid" id="grid"></div>
  </main>

  <script>
    const grid = document.getElementById("grid");
    const stats = document.getElementById("stats");
    const searchInput = document.getElementById("searchInput");

    async function loadHistory(query = "") {
      try {
        const url = query ? \`/api/history?q=\${encodeURIComponent(query)}\` : "/api/history";
        const res = await fetch(url);
        const data = await res.json();
        renderSessions(data.sessions || []);
      } catch (err) {
        grid.innerHTML = '<div class="empty-state">Failed to load history.</div>';
      }
    }

    function renderSessions(sessions) {
      stats.textContent = \`\${sessions.length} session\${sessions.length === 1 ? "" : "s"}\`;
      if (!sessions.length) {
        grid.innerHTML = '<div class="empty-state">No annotation sessions found.<br/><small style="opacity:0.7">Use Pinar extension to annotate pages.</small></div>';
        return;
      }

      grid.innerHTML = sessions.map(session => {
        const date = new Date(session.createdAt).toLocaleDateString(undefined, {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
        });
        const pins = session.pins || [];
        const shotId = session.shotId || session.id;
        const shotImg = \`<a href="/v/\${session.id}" class="shot-preview"><img src="/shots/\${shotId}.png" alt="Screenshot" loading="lazy" onerror="this.onerror=null;this.src='/shots/\${shotId}'"/></a>\`;

        return \`
          <article class="card" id="session-\${session.id}">
            \${shotImg}
            <div class="card-body">
              <div class="card-meta-top">
                <span class="tag">No expiry</span>
                <span style="font-size:11px;color:var(--text-muted);">\${date}</span>
              </div>
              <a href="/v/\${session.id}" class="card-title" title="\${escapeHtml(session.page?.title || '(untitled)')}">\${escapeHtml(session.page?.title || '(untitled)')}</a>
              <span class="card-url" title="\${escapeHtml(session.page?.url || '')}">\${escapeHtml(session.page?.url || '')}</span>

              <div class="pins-list">
                \${pins.slice(0, 3).map((pin, i) => \`
                  <div class="pin-item">
                    <span class="pin-badge">\${pin.number || i + 1}</span>
                    <span class="pin-comment">\${escapeHtml(pin.comment || '(no comment)')}</span>
                  </div>
                \`).join('')}
                \${pins.length > 3 ? \`<span style="font-size:11px;color:var(--text-muted);font-weight:500;">+\${pins.length - 3} more pins</span>\` : ''}
              </div>
            </div>

            <div class="card-footer">
              <div style="font-size:12px;color:var(--text-muted);font-weight:500;">\${pins.length} \${pins.length === 1 ? "pin" : "pins"}</div>
              <div class="card-actions">
                <a href="/v/\${session.id}.md" target="_blank" class="card-button">Markdown</a>
                <a href="/v/\${session.id}" class="card-button card-button-primary">View <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></a>
              </div>
            </div>
          </article>
        \`;
      }).join('');
    }

    function escapeHtml(str) {
      return String(str || "").replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
    }

    let searchTimer;
    searchInput.addEventListener("input", (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => loadHistory(e.target.value.trim()), 250);
    });

    loadHistory();
  </script>
</body>
</html>`;
}

function formatSessionMarkdown(session, viewerUrl) {
  const parts = [];
  const page = session.page || {};
  parts.push(`Page: ${page.title || "(untitled)"}`);
  parts.push(`URL: ${page.url || "(unknown)"}`);
  if (viewerUrl) {
    parts.push(`Viewer: ${viewerUrl}`);
  }
  if (session.shotPath || session.shotUrl) {
    parts.push(`Screenshot: ${session.shotPath || session.shotUrl}`);
  }
  parts.push("");

  (session.pins || []).forEach((pin) => {
    parts.push(`Pin #${pin.number}:`);
    parts.push(`Comment: ${pin.comment}`);
    if (pin.domPath) parts.push(`DOM: ${pin.domPath}`);
    if (pin.selector) parts.push(`Selector: ${pin.selector}`);
    if (pin.innerText) parts.push(`Text: "${pin.innerText.replace(/\\n+/g, " ").trim()}"`);
    parts.push("");
  });

  return parts.join("\n").trim();
}

function renderViewerHtml(session, port) {
  const page = session.page || {};
  const title = page.title || "(untitled)";
  const url = page.url || "";
  const pins = session.pins || [];
  const shotId = session.shotId || session.id;
  const shotUrl = session.shotUrl || `http://127.0.0.1:${port}/shots/${shotId}.png`;

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
      --primary: #2563EB;
    }
    :root[data-theme="dark"], .dark {
      --bg: #0B0F17;
      --card-bg: #141B26;
      --border: #232E40;
      --text: #F1F5F9;
      --text-muted: #94A3B8;
      --primary: #5794FF;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      height: 100vh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    header {
      background: var(--card-bg);
      border-bottom: 1px solid var(--border);
      padding: 12px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .header-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .header-text h1 { font-size: 14px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .header-text p { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .main-view { flex: 1; display: flex; overflow: hidden; }
    .shot-view { flex: 1; overflow: auto; padding: 24px; display: flex; justify-content: center; align-items: flex-start; }
    .shot-container { position: relative; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
    .shot-container img { display: block; max-width: 100%; height: auto; }
    .sidebar {
      width: 340px;
      background: var(--card-bg);
      border-left: 1px solid var(--border);
      overflow-y: auto;
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .pin-card {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px;
      font-size: 13px;
    }
    .pin-card.active { border-color: var(--primary); background: rgba(87,148,255,0.05); }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--card-bg);
      color: var(--text);
      text-decoration: none;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
    }
    .btn:hover { background: rgba(87,148,255,0.08); border-color: var(--primary); }
    .btn-icon { width: 32px; height: 32px; padding: 0; justify-content: center; }
    .btn-icon svg, #btnThemeToggle svg { width: 16px; height: 16px; }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <a href="/history" class="btn btn-icon" title="Back to history" aria-label="Back to history">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>
      </a>
      <div class="header-text">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(url)}</p>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;">
      <a href="/v/${escapeHtml(session.id)}.md" target="_blank" class="btn">Markdown</a>
      <button id="btnThemeToggle" onclick="toggleTheme()" class="btn btn-icon" title="Toggle theme" aria-label="Toggle theme">
        <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.99 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 20.99 12.79Z"/></svg>
      </button>
    </div>
  </header>
  <div class="main-view">
    <div class="shot-view">
      <div class="shot-container">
        <img src="${escapeHtml(shotUrl)}" alt="Screenshot" onerror="this.onerror=null;this.src='/shots/${escapeHtml(shotId)}'"/>
      </div>
    </div>
    <div class="sidebar">
      <h2 style="font-size: 13px; font-weight: 700; text-transform: uppercase; color: var(--text-muted);">${pins.length} Pin${pins.length === 1 ? "" : "s"}</h2>
      ${pins.map((p, i) => `
        <div class="pin-card">
          <div style="display:flex; align-items:center; gap: 8px; margin-bottom: 6px;">
            <span style="width: 18px; height: 18px; border-radius: 50%; background: var(--primary); color: #fff; font-size: 10px; font-weight: 700; display: grid; place-items: center;">${p.number || i + 1}</span>
            <strong>${escapeHtml(p.label || "Pin #" + (p.number || i + 1))}</strong>
          </div>
          <p style="font-size: 13px; font-weight: 500;">${escapeHtml(p.comment || "(no comment)")}</p>
          ${p.selector ? `<code style="display:block; font-size: 10px; color: var(--text-muted); margin-top: 6px; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(p.selector)}</code>` : ""}
        </div>
      `).join("")}
    </div>
  </div>
</body>
</html>`;
}

export function startShotServer(options) {
  const hostname = options.hostname ?? "127.0.0.1";
  const state = { port: options.port };
  const historyDb = openHistoryDb(options.root ?? pinarHome());

  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      setCors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? "/", `http://${hostname}`);
    const path = parsedUrl.pathname;

    try {
      if (req.method === "GET" && path === "/api/health") {
        sendJson(res, { history: true, ok: true, port: state.port, service: "pinar" });
        return;
      }

      if (req.method === "GET" && path.startsWith("/assets/")) {
        if (await serveWebAsset(res, path, options.webRoot)) return;
        sendJson(res, { error: "asset not found" }, 404);
        return;
      }

      if (req.method === "GET" && (path === "/history" || path === "/" || path === "/pricing")) {
        if (await serveWebAsset(res, "/index.html", options.webRoot)) return;
        sendHtml(res, renderDashboardHtml(state.port));
        return;
      }

      // Serve Web Viewer & Raw Markdown: GET /v/:id or GET /v/:id.md
      if (req.method === "GET" && path.startsWith("/v/")) {
        const rawParam = path.slice("/v/".length);
        const isMarkdown = rawParam.endsWith(".md") || req.headers.accept?.includes("text/markdown");
        const id = rawParam.replace(/\.md$/, "");
        const session = historyDb.getSession(id);

        if (!session) {
          if (isMarkdown) {
            setCors(res);
            res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
            res.end("Session not found");
            return;
          }
          sendJson(res, { error: "session not found" }, 404);
          return;
        }

        const viewerUrl = `http://127.0.0.1:${state.port}/v/${id}.md`;
        if (isMarkdown) {
          const md = formatSessionMarkdown(session, viewerUrl);
          setCors(res);
          res.writeHead(200, {
            "cache-control": "public, max-age=60",
            "content-type": "text/markdown; charset=utf-8",
          });
          res.end(md);
          return;
        }

        if (await serveWebAsset(res, "/index.html", options.webRoot)) return;
        sendHtml(res, renderViewerHtml(session, state.port));
        return;
      }

      if (req.method === "GET" && path.startsWith("/shots/")) {
        const rawId = basename(path);
        const stem = rawId.replace(/\.png$/, "");
        const fileCandidates = [
          join(shotsDir(options.root), `${stem}.png`),
          join(shotsDir(options.root), rawId),
          join(options.root ?? pinarHome(), `${stem}.png`),
          join(options.root ?? pinarHome(), rawId),
          join(pinarHome(), "shots", `${stem}.png`),
          join(pinarHome(), "shots", rawId),
          join(pinarHome(), `${stem}.png`),
          join(pinarHome(), rawId),
        ];

        for (const candidate of fileCandidates) {
          if (existsSync(candidate)) {
            const content = await readFile(candidate);
            setCors(res);
            res.writeHead(200, {
              "cache-control": "public, max-age=3600",
              "content-type": "image/png",
            });
            res.end(content);
            return;
          }
        }
        sendJson(res, { error: "shot not found" }, 404);
        return;
      }

      if (req.method === "POST" && path === "/api/shots") {
        const body = JSON.parse(String(await readBody(req)) || "{}");
        if (!body.id || !body.image) {
          sendJson(res, { error: "id and image required" }, 400);
          return;
        }
        const saved = await writeShot(body.id, body.image, options.root ?? pinarHome());
        if (body.page || body.pins) {
          historyDb.saveSession({
            createdAt: body.createdAt,
            id: body.id,
            page: body.page,
            pins: body.pins,
            shotId: body.id,
            shotPath: saved,
          });
        }
        sendJson(res, {
          markdownUrl: `http://127.0.0.1:${state.port}/v/${body.id}.md`,
          ok: true,
          path: saved,
          shotUrl: `http://127.0.0.1:${state.port}/shots/${body.id}.png`,
          viewerUrl: `http://127.0.0.1:${state.port}/v/${body.id}.md`,
        }, 201);
        return;
      }

      if (req.method === "POST" && path === "/api/history") {
        const body = JSON.parse(String(await readBody(req)) || "{}");
        const session = historyDb.saveSession({
          createdAt: body.createdAt,
          id: body.id,
          page: body.page,
          pins: body.pins,
          shotId: body.shotId,
          shotPath: body.shotPath,
        });
        sendJson(res, { ok: true, session }, 201);
        return;
      }

      if (req.method === "GET" && path === "/api/history") {
        const query = parsedUrl.searchParams.get("q") || "";
        const limit = Number(parsedUrl.searchParams.get("limit")) || 50;
        const offset = Number(parsedUrl.searchParams.get("offset")) || 0;
        const sessions = historyDb.listSessions({ limit, offset, query }).map((session) => presentSession(session, state.port));
        sendJson(res, { ok: true, sessions });
        return;
      }

      if (req.method === "GET" && path.startsWith("/api/sessions/")) {
        const id = path.slice("/api/sessions/".length);
        const session = presentSession(historyDb.getSession(id), state.port);
        if (!session) {
          sendJson(res, { error: "not found" }, 404);
          return;
        }
        sendJson(res, { ok: true, session });
        return;
      }

      if (req.method === "GET" && path.startsWith("/api/history/")) {
        const id = path.slice("/api/history/".length);
        const session = historyDb.getSession(id);
        if (!session) {
          sendJson(res, { error: "not found" }, 404);
          return;
        }
        sendJson(res, { ok: true, session: presentSession(session, state.port) });
        return;
      }

      if (req.method === "DELETE" && path.startsWith("/api/history/")) {
        const id = path.slice("/api/history/".length);
        const existing = historyDb.getSession(id);
        if (existing?.shotPath && existsSync(existing.shotPath)) {
          await rm(existing.shotPath, { force: true });
        }
        const deleted = historyDb.deleteSession(id);
        sendJson(res, { deleted, ok: true });
        return;
      }

      sendJson(res, { error: "not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, { error: message }, 500);
    }
  });

  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(options.port, hostname, () => {
      server.removeListener("error", onError);
      const address = server.address();
      state.port = typeof address === "object" && address ? address.port : options.port;
      resolve({ historyDb, port: state.port, server });
    });
  });
}
