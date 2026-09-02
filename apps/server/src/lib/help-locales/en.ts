import type { HelpLocale } from "../help-content";

const locale = {
  ui: {
    articlesFound:
      "{count, plural, one {# article found} other {# articles found}}",
    articleGuide: "In this guide",
    articleNotFound: "Article not found",
    articleNotFoundDescription: "This article does not exist.",
    backToHelp: "Back to Help Center",
    breadcrumb: "Breadcrumb",
    categories: "Categories",
    categoryArticles: "articles",
    categoryNotFound: "Category not found",
    categoryNotFoundDescription: "This category does not exist.",
    explore: "Explore",
    help: "Help",
    helpCategories: "Help categories",
    helpNavigation: "Help navigation",
    homeDescription:
      "Guidance grounded in project documentation, delivery history, and behavior that is actually implemented.",
    homeHeading: "How can we help?",
    homeMetaDescription:
      "Learn to capture, organize, share, and review visual feedback with Pinar.",
    homeMetaTitle: "Pinar Help Center",
    minutes: "min",
    noArticlesFound: "No articles found.",
    notFoundDescription: "Use the Help Center to find published guidance.",
    onThisPage: "On this page",
    openScreenshot: "Open screenshot at full size",
    pageTitleSuffix: "Pinar Help",
    popularArticles: "Popular articles",
    popularDescription: "The most-used paths to start and close a review.",
    searchLabel: "Search the Help Center",
    searchPlaceholder: "Search captures, agents, plans…",
    searchResults: "Search results",
    seeAllCategory: "See all in category",
    stillNeedContext: "Still need context?",
    visualExample: "Visual example:",
  },
  categories: {
    "getting-started": {
      title: "Get started",
      description:
        "Install Pinar, make a first capture, and choose where your work lives.",
    },
    captures: {
      title: "Captures and pins",
      description:
        "Select pages precisely, annotate them, mask sensitive areas, and reopen the result.",
    },
    agents: {
      title: "AI agents",
      description:
        "Send visual context to coding agents and close the review loop safely.",
    },
    workspace: {
      title: "Projects and collections",
      description:
        "Organize, search, move, share, and review capture sessions.",
    },
    cloud: {
      title: "Cloud and plans",
      description:
        "Understand accounts, plans, credits, storage, retention, and public sharing.",
    },
    privacy: {
      title: "Privacy and data",
      description:
        "Know what Pinar stores, what it removes, and which controls stay in your hands.",
    },
  },
  screenshots: {
    "sign-in-extension": {
      alt: "Pinar sign-in screen with the browser-extension pairing-code flow selected.",
      caption:
        "The extension flow accepts the temporary pairing code shown by Pinar and connects that browser without a password.",
    },
    "capture-workspace": {
      alt: "Pinar workspace with annotated session cards, pin counts, projects, collections, search, and account controls.",
      caption:
        "The workspace keeps captured pages, pin counts, projects, collections, search, and account state in one operational view.",
    },
    "getting-started": {
      alt: "Pinar public landing page with the local-first workflow, workspace entry point, and plan navigation.",
      caption:
        "Start from the public Pinar entry point to open the local workspace, understand the capture workflow, or compare cloud plans.",
    },
    "help-navigation": {
      alt: "Pinar help article with category navigation, related article links, structured sections, and on-page navigation.",
      caption:
        "Help pages keep the category, neighboring procedures, article sections, and recovery paths visible together.",
    },
    privacy: {
      alt: "Pinar legal center with Terms, Privacy, Acceptable Use, Data Retention, Refund, Fair Source, and subprocessor documents.",
      caption:
        "The legal center keeps the data, retention, acceptable-use, refund, licensing, and subprocessor rules in one auditable place.",
    },
    "workspace-table": {
      alt: "Pinar workspace table with search, filters, pin counts, creation dates, pagination, and row actions.",
      caption:
        "Table view puts search, filters, pin counts, dates, pagination, and session actions into a scan-friendly workflow.",
    },
    "sign-in-email": {
      alt: "Pinar account sign-in screen with the email-code flow selected.",
      caption:
        "Registered accounts request a short-lived code by email and complete verification in the same sign-in surface.",
    },
    pricing: {
      alt: "Pinar pricing page comparing Free, Pro yearly, Founder, storage add-ons, and AI credit options.",
      caption:
        "The pricing surface exposes plan limits, billing cadence, storage add-ons, and AI credit purchases before checkout.",
    },
    updates: {
      alt: "Pinar release detail showing the release date, version, changes, and previous and next release navigation.",
      caption:
        "Published release notes make installed behavior and operational changes traceable by version.",
    },
  },
  articles: {
    "install-pinar": {
      title: "Install Pinar",
      summary:
        "Add the official Chrome extension and connect the supported local product for your platform.",
      sections: [
        {
          heading: "Browser extension",
          paragraphs: [
            "Install Pinar from the Chrome Web Store. This is the official browser install path; a GitHub checkout or unpacked extension folder is not required for normal use.",
          ],
          bullets: [
            "Pin the Pinar icon from Chrome’s extensions menu so it stays visible.",
            "The extension supports the published pinar.dev origin and local Pinar servers.",
          ],
        },
        {
          heading: "Local product",
          paragraphs: [
            "On macOS, Pinar.app lives in the menu bar, runs the embedded helper, registers supported agent hooks, and checks GitHub Releases for updates. Windows and Linux currently use the standalone helper installer rather than a desktop app.",
          ],
          bullets: [
            "Screenshots normally live in `~/.pinar/shots` and history in `~/.pinar/history.db`. The tray’s Open Folder action opens this directory; PINAR_HOME can override it.",
            "The helper scans 127.0.0.1 ports 17373 through 17382 and recognizes Pinar through GET `/api/health`. PINAR_PORT pins discovery to one port.",
            "Start at Login uses a user LaunchAgent on macOS. Pinar falls back to the legacy launchctl path on older systems and keeps logs under the Pinar home directory.",
            "If the local helper is unavailable, image crops fall back to Downloads/pinar.",
          ],
        },
        {
          heading: "Confirm the helper and open the workspace",
          paragraphs: [
            "After the extension is pinned, install the matching local product from the documented one-shot path: drag the macOS disk image into ~/Applications, run the PowerShell installer on Windows, or the curl installer on Linux. Those scripts place the helper in ~/.pinar/bin (or %USERPROFILE%\\.pinar\\bin), add that directory to PATH, and run pinar install-hooks so coding agents can receive pasted captures.",
            "On macOS, Pinar.app hides the Dock icon, keeps a single tray instance via ~/.pinar/tray.pid, and starts the helper with pinar ensure if GET `/api/health` does not yet return ok true and service pinar. Use the menu-bar Start or Restart control when the status is Off, then Open Workspace to load http://127.0.0.1:<port>/app. Re-run pinar install-hooks from the helper if an agent no longer sees the paste instructions.",
          ],
          bullets: [
            "Windows install: irm https://pinar.dev/install.ps1 | iex. Linux install: curl -fsSL https://pinar.dev/install.sh | sh. The script needs curl or wget to download the binary.",
            "A healthy helper answers GET `/api/health` with ok true and service pinar. On macOS, Open Workspace uses that discovered port at the /app workspace path.",
            "The Chrome extension cannot write `~/.pinar/shots` by itself. If crops miss that folder, start the local product first, then recapture.",
          ],
        },
      ],
    },
    "first-capture": {
      title: "Make your first capture",
      summary:
        "Pin a visible element or area, write feedback, and copy one correlated bundle.",
      sections: [
        {
          heading: "Pin the page",
          paragraphs: [
            "Open the page, select the Pinar extension, then click an element or drag a freeform area. Write the comment and press Enter to add the pin.",
          ],
          bullets: [
            "Repeat the selection to place multiple numbered pins in one capture.",
            "Shift+Enter adds a line break; Escape closes the draft without deleting the other pins.",
          ],
        },
        {
          heading: "Copy the bundle",
          paragraphs: [
            "Press Command+Enter on macOS or Ctrl+Enter elsewhere. Pinar copies human-readable Markdown, HTML, and a pinar-visual-context JSON block that refer to the same screenshot and pin identities.",
          ],
        },
        {
          heading: "Finish the copy and keep identities",
          paragraphs: [
            "Command/Ctrl+Enter copies only after at least one pin has a comment. The overlay shows Copying…, hides pin chrome for the screenshot, then Copied, and the toolbar closes. Clicking the extension icon later only shows or hides the overlay; it does not delete pins you already placed. If every clipboard path fails, the overlay is restored so you can retry.",
            "Treat the clipboard payload as one unit: readable instructions, an optional viewer URL, and a fenced pinar-visual-context JSON block with `captureId`, `pinId`, page URL, locators (cssSelector, domPath, innerText), and a screenshot URL when the helper stored a file. Numbered badges on the image are annotation overlays, not page UI. Do not rewrite `captureId` or `pinId` when pasting to an agent. A Screenshot: /path/to/file.png line, when present, is the single crop that contains every pin.",
          ],
          bullets: [
            "An empty composer or a capture with no pins aborts the copy and flashes Write a comment first or Add a pin first.",
            "Degraded copies still paste comments and locators, but the toolbar may add no screenshot, helper unavailable, or no viewer after Copied.",
            "Prefer a running helper so PNG crops land in `~/.pinar/shots` and the bundle can include a /v/<id>.md viewer link for full context.",
          ],
        },
      ],
    },
    "local-or-cloud": {
      title: "Choose local or cloud storage",
      summary:
        "Use the local workspace offline or connect an account for managed cloud storage and sharing.",
      sections: [
        {
          heading: "Local",
          paragraphs: [
            "Local mode keeps history in SQLite and screenshots on your machine. The loopback API accepts only trusted local or extension origins and uses a filesystem-protected capability token.",
          ],
        },
        {
          heading: "Cloud",
          paragraphs: [
            "Cloud mode stores account data in D1 and screenshots in R2. It enables remote workspace access, managed retention, AI summaries, billing, and unlisted share links. Legal consent is required before remote persistence.",
          ],
        },
        {
          heading: "How local and cloud sessions actually open",
          paragraphs: [
            "Local history always belongs to owner local. On first use the database creates a protected Personal project and a protected Inbox collection that cannot be nested or deleted like user-created ones. Saved captures are marked isPermanent true with plan free, PNG files are written under the Pinar home shots directory, and the loopback API presents them at /shots/<id>.png and /v/<id>.md. Mutating that API requires the capability secret from ~/.pinar/local-capability.json, sent as x-pinar-capability or an Authorization Bearer token. The file is written mode 0600; rotation keeps the previous secret valid for 24 hours unless PINAR_CAPABILITY_GRACE_MS says otherwise.",
            "Cloud persistence is blocked until the current Terms, Privacy, and Acceptable Use versions are accepted; the API returns HTTP 428 with code legal_acceptance_required. Remote Free then registers an installation and can mint a five-minute, single-use pairing code to open /app. Paid or previously paid accounts can also verify a six-digit email code. Browser cookies last 30 days; authenticated extension devices last 180 days. Unlisted Markdown stays public at /v/, /p/, and /c/, and screenshots at /shots/.",
          ],
          bullets: [
            "Local GET /api/local/capability returns the current token; rotate and revoke are POST endpoints on the same /api/local/capability prefix.",
            "SQLite lives at `history.db` in the Pinar home directory; if SQLite cannot open, history falls back to `history.json` in that same home.",
            "Cloud share links do not require a workspace session: anyone with the unlisted URL can read the Markdown or PNG at /v/, /p/, /c/, or /shots/.",
          ],
        },
      ],
    },
    "shortcuts-and-navigation": {
      title: "Keyboard shortcuts",
      summary:
        "Capture, move through the DOM, mask content, and copy without leaving the keyboard.",
      sections: [
        {
          heading: "During capture",
          paragraphs: [
            "Pinar intercepts only its active capture shortcuts so the host page does not receive the same keystroke.",
          ],
          bullets: [
            "Enter pins the hovered element; Arrow Up selects its parent and Arrow Down returns to a child.",
            "M toggles privacy-mask drawing. Escape cancels a draft or mask; with no draft it clears pins and hides the toolbar.",
            "Command/Ctrl+Enter copies the completed bundle.",
            "Alt+Shift+P shows or hides the toolbar without cancelling the session, and you can rebind it in `chrome://extensions/shortcuts`. Browser shortcuts stay inert on `chrome://` pages, on the Chrome Web Store, and before the overlay is injected.",
          ],
        },
        {
          heading: "Focus-heavy pages",
          paragraphs: [
            "On sites with aggressive focus traps, Pinar retries focusing the comment composer a limited number of times, then stops rather than freezing the tab. Click the composer directly if the page keeps stealing focus.",
          ],
        },
        {
          heading: "Overlay, icon, and DOM walk details",
          paragraphs: [
            "Capture shortcuts are owned only while the overlay is active. The extension icon toggles that overlay; it does not delete pins. Hovering the toolbar without an open draft makes it pass-through so you can still click or drag the page underneath. Shift+Enter inserts a line break in the composer, and host-page shortcuts typed there are stopped from leaving the comment field.",
            "Arrow Up walks to the parent element and remembers the child you left, so Arrow Down returns to that remembered node when it is still a child; otherwise it uses the first child. In mask mode, drag a region to hide it and click an existing mask to restore it. Keyboard scrolling still works on the document, but keys aimed at focused page controls are blocked so they cannot activate buttons or type into the host form.",
          ],
          bullets: [
            "Command/Ctrl+Enter saves an open draft, then copies; without a comment it shows Write a comment first instead of sending an empty pin.",
            "After Escape or copy, Pinar keeps owning that physical key through keyup so the host page does not treat the same keystroke as its own cancel or submit.",
            "An area pin starts only after the pointer moves about six pixels; a shorter click still pins the hovered element instead of opening a freeform rectangle.",
          ],
        },
      ],
    },
    "capture-types": {
      title: "Element, area, full-page, and iframe captures",
      summary:
        "Pick the smallest capture mode that still preserves the context your reviewer needs.",
      sections: [
        {
          heading: "Selection modes",
          paragraphs: [
            "Element capture records a resilient DOM fingerprint and exact box. Area capture covers a freeform rectangle when no single element represents the feedback. Full-page capture scrolls and stitches the document. Iframe capture preserves frame boundaries and offsets.",
          ],
          bullets: [
            "Prefer an element when the agent must identify code ownership precisely.",
            "Prefer an area for visual relationships across several elements.",
          ],
        },
        {
          heading: "Click, drag, and frame targeting",
          paragraphs: [
            "Click a node, or press Enter on the current outline, to open an element pin. Drag a rectangle of at least six pixels to open an area pin instead. The first press on an iframe or frame element is ignored so the document inside that frame can take the selection.",
            "Element pins record a fingerprint, a selector, and a DOM path that joins ancestor frames with a frame-boundary delimiter. Area pins store the rectangle and a pixel-size label without a locator. The copied screenshot still tiles around the union of every pin, including pins placed in child frames.",
          ],
          bullets: [
            "The capture toolbar stays on the top frame; child frames show markers and the comment composer only.",
            "If a parent frame does not reply with its path, the pin keeps the inner document path only.",
            "Fixed or sticky elements are marked viewport-anchored so reopen does not treat them as document-scrolled boxes.",
          ],
        },
      ],
    },
    "pins-and-comments": {
      title: "Pins, comments, and colors",
      summary:
        "Use numbered pins as stable references between the screenshot, prose, and structured context.",
      sections: [
        {
          heading: "One shared capture",
          paragraphs: [
            "Every numbered badge on the screenshot maps to one comment and one pin record. The rotating color palette separates nearby markers without changing their identity.",
          ],
        },
        {
          heading: "Keep the correlation",
          paragraphs: [
            "Do not rewrite `captureId` or `pinId` when handing the bundle to another tool. Those fields let the workspace, viewer, agent result, and review history refer to the same capture.",
          ],
        },
        {
          heading: "How numbers and identities are assigned",
          paragraphs: [
            "A pin is saved only after the comment is trimmed and non-empty. New pins receive a UUID, a 1-based number from their order in the capture, and a color from the eleven-swatch palette at that number. Nearby badges therefore differ visually without changing which identity they keep.",
            "Structured context keeps `pinId` from the existing `pinId` or id. When those fields are absent, the parser synthesizes `captureId`:pN from the capture identity and the pin number. Downstream tools can then point at the same screenshot, comment, and review row.",
          ],
          bullets: [
            "An empty composer cannot be copied; focus stays on the field until a comment exists.",
            "Hovering a marker previews its number, comment, and current locator confidence on the live page.",
            "Editing an existing pin updates only its comment; the stored id is left unchanged.",
          ],
        },
      ],
    },
    "full-page-capture": {
      title: "Capture a full page",
      summary:
        "Create one long screenshot while Pinar controls scroll, scale, and repeated fixed content.",
      sections: [
        {
          heading: "How stitching works",
          paragraphs: [
            "Pinar plans viewport frames, scrolls through the document, temporarily suppresses repeated sticky or fixed elements, renders at the device pixel ratio, and restores the page afterward.",
          ],
        },
        {
          heading: "When the result differs",
          paragraphs: [
            "Lazy-loaded content, animated layouts, cross-origin frames, and pages that change while scrolling can produce gaps or unresolved regions. Let the page settle, retry, or capture the affected area separately.",
          ],
        },
        {
          heading: "Viewport tiles and layout restore",
          paragraphs: [
            "Pinar plans scroll positions from the union of pin bounds plus padding, then captures each viewport-tall PNG tile through the tab screenshot API. Later tiles wait briefly so the page can paint, and the composed canvas uses the device pixel ratio inferred from the first tile width versus the CSS viewport.",
            "Before the first tile, sticky and fixed nodes are rewritten so they are not repeated on every frame. Original inline styles and scroll position are restored even if composition fails. Pin and mask coordinates are shifted to the capture origin before the image is cropped.",
          ],
          bullets: [
            "Fixed nodes become absolutely positioned at the measured box, with transforms cleared so the screenshot does not offset them twice.",
            "Sticky nodes become relatively positioned for the duration of the capture pass.",
            "Tile scrolling uses instant scroll-behavior so the document does not animate between frames.",
          ],
        },
      ],
    },
    "smart-selection": {
      title: "Smart locators and DOM selection",
      summary:
        "Understand how a pin follows an element after the page changes and why Pinar may ask for manual placement.",
      sections: [
        {
          heading: "Resilient fingerprints",
          paragraphs: [
            "An element pin combines a stable selector, DOM path, tag, id, name, test id, role, classes, text, label, and geometry. During reopen, Pinar evaluates selector, structure, semantics, and geometry rather than trusting one fragile path.",
          ],
        },
        {
          heading: "Confidence and ambiguity",
          paragraphs: [
            "A match can be exact, probable, ambiguous, or unresolved. When two candidates are too similar, Pinar keeps alternatives instead of snapping the pin to the wrong element. Cross-origin iframe targets can remain unresolved.",
          ],
        },
        {
          heading: "Selector fallback and competing matches",
          paragraphs: [
            "At capture time Pinar prefers a selector that uniquely matches the node by id, data-testid or data-test, or tag plus name. If none of those is unique, it stores a structural CSS path instead. Class names that look generated are dropped from the fingerprint so hashed CSS modules do not become the only signal.",
            "On reopen, candidates from stable-selector, structure, semantic, and geometry strategies are merged and ranked. Exact confidence requires a high-scoring stable selector or structure hit; semantic and geometry matches stay probable. When the top two viable scores differ by less than a narrow margin, the result is ambiguous and no element is chosen.",
          ],
          bullets: [
            "A positional :nth-of-type selector is scored lower when other nodes share the same tag, text, and classes.",
            "Area pins are rejected as element targets and remain unresolved during locator scoring.",
            "When an iframe contentDocument is unreadable, relocation stops with a cross-origin-frame warning instead of guessing.",
          ],
        },
      ],
    },
    "privacy-masks": {
      title: "Mask sensitive areas",
      summary:
        "Black out visual regions before the screenshot is serialized or uploaded.",
      sections: [
        {
          heading: "Draw a mask",
          paragraphs: [
            "Press M while capture mode is active, then drag over the sensitive region. User masks are applied to the captured image before storage; remove a mistaken mask before copying.",
          ],
        },
        {
          heading: "Masks complement redaction",
          paragraphs: [
            "Automatic sanitization handles known sensitive DOM fields and URL parts. Manual masks cover visual content that software cannot classify reliably, such as charts, avatars, or canvas-rendered data.",
          ],
        },
        {
          heading: "How masks reach the stored image",
          paragraphs: [
            "Mask drawing is unavailable while a comment draft is open. A qualifying drag stores a user mask in document coordinates so it follows page scroll, and clicking that overlay removes it. Automatic field boxes from the privacy scan are combined with those user rectangles before copy.",
            "The combined regions travel with the capture message so they are painted onto the screenshot before clipboard or storage. Separate sanitization still redacts known secrets from URLs, field values, and pin text; masks cover pixels that those string rules cannot classify.",
          ],
          bullets: [
            "User masks use a unique id and a manual category so they can be deleted independently of automatic boxes.",
            "Automatic field masks are dismissed rather than deleted, so later scans can still report the underlying field.",
            "Escape leaves mask drawing without discarding the pins already placed on the page.",
          ],
        },
      ],
    },
    "copy-and-reopen": {
      title: "Copy, view, and reopen a capture",
      summary:
        "Move from the live page to the workspace and back without losing the original anchors.",
      sections: [
        {
          heading: "Viewer controls",
          paragraphs: [
            "The capture viewer supports pointer pan, wheel zoom anchored to the cursor, double-click zoom, and controls from 50% to 800%. Selecting a pin opens rendered Preview and verbatim Raw Markdown tabs.",
          ],
          bullets: [
            "Download the screenshot or copy the session Markdown from the viewer.",
            "Open the public Markdown in ChatGPT or Claude from the viewer action menu when sharing is available.",
          ],
        },
        {
          heading: "Review on the original page",
          paragraphs: [
            "Review on page opens the captured origin and rehydrates the pins. Pinar rejects an origin mismatch, preserves each historical anchor and box, records relocation history, and lets you manually reposition an unresolved pin.",
          ],
        },
        {
          heading: "Clipboard from the viewer and reopen gating",
          paragraphs: [
            "Copy page in the viewer writes the same correlated Markdown bundle used on the live page, using compact or full handoff from saved preferences and `captureId` falling back to the session id. The action menu opens the public Markdown at /v/{id}.md, or starts ChatGPT or Claude with a prompt that points at that URL.",
            "Review on page dispatches a reopen event with the session id. The helper hydrates only from a trusted Pinar app URL when that id matches the session id or `captureId` and the tab origin still equals the captured page origin. Navigating the tab off that origin drops the binding instead of injecting pins into the wrong site.",
          ],
          bullets: [
            "If no reopen result arrives, the viewer shows a missing-helper hint instead of waiting indefinitely.",
            "Public or older viewers that cannot read preferences still copy using compact handoff.",
            "A tab that is still about:blank keeps the hydration binding; only a different origin drops it.",
          ],
        },
      ],
    },
    "send-to-agent": {
      title: "Send visual context to an agent",
      summary:
        "Paste the complete Pinar bundle so the agent sees the comment, target, geometry, and shared image together.",
      sections: [
        {
          heading: "What to paste",
          paragraphs: [
            "Pinar writes plain Markdown and HTML to the clipboard. The text includes readable annotations plus a fenced pinar-visual-context JSON block. Paste both as one unit; the structured block is the machine-readable source of truth.",
          ],
        },
        {
          heading: "Screenshot and warnings",
          paragraphs: [
            "If the bundle lists an absolute Screenshot path, the local agent should open that single image; numbered badges are overlays. Warnings such as `screenshot_missing`, `helper_unavailable`, or `viewer_unavailable` describe degraded delivery but do not invalidate the comments and DOM context.",
          ],
        },
        {
          heading: "How to deliver the copied bundle to an agent",
          paragraphs: [
            "The Chrome extension never types into the agent composer. After Command/Ctrl+Enter, paste the clipboard yourself into Cursor, Claude, Codex, or Grok. The text begins with instructions to implement the pin comments and to treat selector and DOM path as complementary locators, followed by a fenced pinar-visual-context JSON block. If a Viewer URL is included, fetch it only when those details are not enough.",
            "Treat `captureId` and `pinId` as identity, not labels to rewrite. Visual Context currently encodes schemaVersion 1; parseVisualCapture rejects a missing `captureId` and any schemaVersion other than 1 or the legacy 0. Change only what the pins describe. If the person never pasted, ask them to copy again from Pinar instead of reconstructing pins from memory.",
          ],
          bullets: [
            "Paste the whole clipboard into the agent; do not retype comments or invent a new `captureId`.",
            "Confirm the pasted text still contains a closed pinar-visual-context fence before you start editing code.",
            "If nothing was pasted, ask for Command/Ctrl+Enter in Pinar and implement only the pin comments.",
          ],
        },
      ],
    },
    "handoff-formats": {
      title: "Handoff formats and destinations",
      summary:
        "Choose compact or full context and an agent-specific presentation without changing capture identity.",
      sections: [
        {
          heading: "Compact and full",
          paragraphs: [
            "Compact mode removes redundant locator and geometry noise while retaining correlation. Full mode keeps the unabridged payload. A separate preference includes or omits screenshots; disabling them preserves metadata, pins, locators, review, and handoff while avoiding image storage. Inline image data is stripped from text payloads to prevent oversized prompts. The workspace Settings dialog synchronizes these delivery preferences with the active backend.",
          ],
        },
        {
          heading: "Agent adapters",
          paragraphs: [
            "Pinar can adapt the preamble and Markdown shape for Claude, Codex, Grok, and other supported coding-agent destinations. The underlying `captureId`, `pinId`, and visual-context contract stay the same.",
          ],
        },
        {
          heading: "Choose delivery mode in extension options before you copy",
          paragraphs: [
            "In the extension options, a switch sets handoffMode to full when checked and compact when unchecked. Compact is the stored default and keeps each useful fact once: `pinId`, comment, cssSelector, domPath, and innerText, plus box or coords only for area pins or pins that have no locator. Full keeps the unabridged capture. Both projections still drop data: screenshot URLs from the JSON; an inline image is stored as a null URL and a screenshot_inline warning so the prompt stays bounded.",
            "Click Save so preferences:set writes handoffMode and `includeScreenshot` to the active backend and chrome.storage.sync. Unknown handoffMode values fall back to compact; `includeScreenshot` defaults to true. Adapter destinations are cursor, claude, codex, and grok: each prepends its own preamble, but `captureId`, pinIds, and comments stay identical. The copy-viewer-content switch is disabled whenever includeViewer is off.",
          ],
          bullets: [
            "Set the compact/full switch and the `includeScreenshot` switch, then click Save before the next copy.",
            "Leave `includeScreenshot` on unless you intentionally want metadata, pins, locators, and handoff without image storage.",
            "After saving, copy once and confirm every adapter paste still shares the same `captureId` and pinIds.",
          ],
        },
      ],
    },
    "closed-loop-review": {
      title: "Close the agent review loop",
      summary:
        "Track what an agent changed, verify it as a human, and reopen only when another correction is needed.",
      sections: [
        {
          heading: "Agent return",
          paragraphs: [
            "An agent can report each pin as changed, blocked, not applicable, or not located, with a summary, reason, changed files, commit, and pull request. Repeated delivery with the same idempotency key is safe; conflicting content under that key is rejected.",
          ],
        },
        {
          heading: "Human verification",
          paragraphs: [
            "A changed result moves an open or reopened pin to correction ready. Only a human can accept a correction or reopen an accepted pin. Agents cannot accept their own work, and invalid state transitions are rejected.",
          ],
          bullets: [
            "Normal flow: open → correction ready → accepted.",
            "If verification fails: accepted → reopened → correction ready.",
          ],
        },
        {
          heading: "Record an execution and accept it as a human",
          paragraphs: [
            "POST /api/agent-executions with agent set to claude, codex, cursor, or grok, the capture’s `captureId`, an idempotencyKey of 8 to 128 characters matching [A-Za-z0-9_-], and a non-empty results array. Each result needs a `pinId` that already exists on that capture, a status, and a summary of at most 2000 characters; optional files are capped at 50 paths, and pullRequest must be an http(s) URL. A conflicting fingerprint under the same key is idempotency_conflict (409). An unknown `pinId` is pin_not_found (400) without echoing capture comments; an unknown `captureId` is capture_not_found (404).",
            "Human review is a separate POST to /api/sessions/{id}/pins/{`pinId`}/review with action accept or reopen. humanActionsForStatus offers accept only in correction_ready and reopen only in accepted; open and reopened expose no human actions, and any other transition is invalid_transition (409). After a human reopen, a second changed execution is the intended retry. Leave Share anonymous loop metrics off unless you opt in: comments, URLs, selectors, and screenshots are rejected as forbidden_fields even when optIn is true.",
          ],
          bullets: [
            "Publish a changed result for the same `captureId` and `pinId`, then confirm the viewer shows correction_ready before you accept.",
            "Reuse an idempotencyKey only with the same fingerprint; mint a new key when the files, summary, or status actually changed.",
            "If verification fails, reopen as a human, publish a second result, accept again, and keep the before and after capture ids.",
          ],
        },
      ],
    },
    "reopen-and-relocate": {
      title: "Reopen and relocate pins",
      summary:
        "Review the implementation on the live page even after its DOM has changed.",
      sections: [
        {
          heading: "Safe rehydration",
          paragraphs: [
            "Pinar opens the saved page and hydrates only when the active tab origin exactly matches the capture. Trusted app origins can request a reopen, but an unrelated site cannot inject a session into the extension.",
          ],
        },
        {
          heading: "Manual correction",
          paragraphs: [
            "If a target is ambiguous or unresolved, reposition the pin manually. The original anchor and box remain frozen in history, and each automated or manual relocation is recorded for later review.",
          ],
        },
        {
          heading: "Open the original URL and place pending pins",
          paragraphs: [
            "session:reopen is accepted only from a trusted Pinar app origin: https on pinar.dev or a *.pinar.dev host, or http on loopback ports 17373 through 17382. The helper fetches /api/sessions/{id} and opens a new tab at the saved page URL. Any other site receives untrusted_app. A requested id that matches neither session.id nor `captureId` is session_mismatch; a capture without page.url is missing_page. After load, hydration injects into every frame and keeps only pins whose DOM path belongs to that frame.",
            "Hydration continues only while the tab origin still matches the capture. Navigating away drops the binding and shows This page is not the original capture URL; about:blank is treated as transient and does not drop it. Ambiguous or unresolved locator matches leave the live box unchanged instead of snapping to a lookalike. Click a pending pin, then the correct element: selector, path, and fingerprint stay frozen, location becomes exact with evidence manual-reposition, and locationHistory appends a manual exact entry.",
          ],
          bullets: [
            "Start Review on page from the Pinar app so only that session hydrates on the captured origin.",
            "If the overlay says This page is not the original capture URL, return to the captured origin instead of placing pins.",
            "For an unresolved pin, click the marker, click the live element, then confirm locationHistory gained a manual exact entry.",
          ],
        },
      ],
    },
    "handoff-troubleshooting": {
      title: "Troubleshoot copy and handoff warnings",
      summary:
        "Recover from clipboard, helper, screenshot, or viewer failures without losing the annotations.",
      sections: [
        {
          heading: "Clipboard recovery",
          paragraphs: [
            "Pinar first uses the browser clipboard API through an offscreen document and falls back to a hidden text selection when permission or focus blocks it. If every copy mechanism fails, the overlay is restored so your pins and comments remain editable.",
          ],
        },
        {
          heading: "Degraded does not mean uncorrelated",
          paragraphs: [
            "`screenshot_missing` means the image could not be persisted. `helper_unavailable` means the local service was not reached. `viewer_unavailable` means no viewer URL was produced. Continue from the comment, DOM path, selector, pin coordinates, `captureId`, and `pinId`, then retry only the missing layer.",
          ],
        },
        {
          heading: "Walk the copy path when the toolbar reports failure",
          paragraphs: [
            "Copy requires a saved comment and at least one pin. The toolbar shows Copying…, hides overlays, captures the shot, then asks the offscreen document to write text/html and text/plain. Offscreen tries navigator.clipboard.write first and falls back to a copy event plus execCommand. If that write is not ok, the content script still attempts writePlainText on the returned plain payload: clipboard.writeText, then a hidden textarea selection.",
            "When every copy path fails, the page sends overlays:hidden with hidden false, flashes Copy failed, and leaves pins editable. A successful copy shows Copied, or Copied plus no screenshot, helper unavailable, or no viewer, then ends the session. Those suffixes map to `screenshot_missing`, `helper_unavailable`, and `viewer_unavailable`. screenshot_inline is not one of the degraded handoff warnings. A paste without a closed pinar-visual-context fence cannot be parsed as JSON.",
          ],
          bullets: [
            "If the toolbar says Write a comment first or Add a pin first, finish that pin and press Command/Ctrl+Enter again.",
            "If Copy failed appears, confirm the pins are still on the page, grant clipboard permission if prompted, and retry the copy.",
            "Read the Copied suffix: no screenshot, helper unavailable, and no viewer name the missing layer to retry without discarding comments.",
          ],
        },
      ],
    },
    "organize-projects": {
      title: "Organize projects and sessions",
      summary:
        "Move captures without losing them and keep Personal as the protected fallback.",
      sections: [
        {
          heading: "Projects and fallback",
          paragraphs: [
            "Projects group collections and sessions. Personal is the protected default project and Inbox is its protected collection. Deleting another project promotes its sessions to the fallback instead of destroying them.",
          ],
        },
        {
          heading: "Move and order",
          paragraphs: [
            "Drag sessions between collections, reorder them, or use bulk Move to for a selected set. In a collection, Move Earlier and Move Later adjust the saved manual order.",
          ],
        },
        {
          heading: "Confirm where a moved session lands",
          paragraphs: [
            "Open one collection before using Move Earlier or Move Later. Those items appear only in a collection view, swap the session with its neighbor in the saved position list, and do nothing at the first or last row. The dashboard then POSTs that full id list to `/api/collections/{id}/sessions/reorder`. When no collection is selected, the listing sorts by created date instead of that saved order.",
            "A drag starts from the card or table row, not from search, checkboxes, or the action menu (`data-no-dnd`). If the dragged session is already selected with others, every selected id travels with it; otherwise only that session moves. Move to asks for a project, then a collection in that project's flattened tree; changing project clears the collection field, and a project with no collections is disabled. The session is appended at the next position in the target. Deleting Personal is refused; deleting another project appends its sessions to Inbox in existing order and removes that project's collections.",
          ],
          bullets: [
            "Select one collection, then use Move Earlier or Move Later only when a neighbor exists; the first row cannot move earlier and the last cannot move later.",
            "To move several sessions, select them first, then drag any selected card or open Move to; dragging an unselected card moves only that session.",
            "After deleting a non-Personal project, open Personal / Inbox and scan the end of the list for the appended sessions before filing them again.",
          ],
        },
      ],
    },
    "nested-collections": {
      title: "Use nested collections",
      summary:
        "Build a hierarchy inside each project and reorganize it without flattening child relationships.",
      sections: [
        {
          heading: "Collection tree",
          paragraphs: [
            "Collections can have parent and child collections. Dragging a branch preserves depth and descendant relationships while moving it within the same project tree. Cycles, unknown parents, and nesting under a protected container are rejected. Deleting a parent promotes its child collections to the parent level in their existing order.",
          ],
        },
        {
          heading: "Destinations from capture",
          paragraphs: [
            "The extension can target a project or collection before saving to the cloud. If a selected destination is no longer available, the protected Personal/Inbox fallback keeps the session reachable.",
          ],
        },
        {
          heading: "Indent a branch, then verify the parent",
          paragraphs: [
            "While dragging a collection, horizontal offset is measured in 18-pixel indent steps. Projected depth is clamped so it cannot go deeper than one level under the previous sibling or shallower than the next sibling. Dropping a branch onto one of its descendants is ignored and the tree stays put. Protected collections stay at depth 0, and the sortable list treats children of a protected collection as roots so they cannot remain nested under that protected container.",
            "In the extension destination picker, `destination:get` returns a CaptureDestination (`projectId` and `collectionId`) plus the project tree, with nested collections indented 16 pixels per depth. Changing project immediately saves that project's protected collection if one exists, otherwise its first collection. If `destination:set` fails, the options page shows the destination-unavailable error and reloads `destination:get` so a missing collection does not stay selected. An empty tree shows a disabled Inbox placeholder.",
          ],
          bullets: [
            "Drag a collection right to nest under the previous sibling, or left toward the root; if the drop is rejected, the parentId list is unchanged.",
            "Collapse a parent only when you need a shorter sidebar; hidden descendants stay in the tree and still move with the dragged branch.",
            "After a destination save error, reopen extension options and confirm project and collection match a live tree entry before the next cloud capture.",
          ],
        },
      ],
    },
    "find-manage-share": {
      title: "Find, manage, and share sessions",
      summary:
        "Search every useful field, filter review work, act in bulk, and publish only what you intend.",
      sections: [
        {
          heading: "Search and views",
          paragraphs: [
            "Search matches page title, URL, description, pin comments, and CSS selectors. Pin-count and review-status filters can be combined. Switch between card grid and table; the table offers 15, 30, 60, or 100 rows per page and remembers the view locally.",
          ],
        },
        {
          heading: "Bulk and sharing actions",
          paragraphs: [
            "Select sessions in either view to move or delete them together. Deleting a session is permanent: it removes the screenshot plus agent executions, pin results, reviews, and review events. Public viewers for sessions, projects, and collections are unlisted rather than access-controlled; anyone with a live link can open one. Aggregate viewers can copy combined Markdown for every included session.",
          ],
        },
        {
          heading: "Combine filters, then copy public Markdown",
          paragraphs: [
            "Search trims whitespace and matches as a case-insensitive substring. A whitespace-only query leaves every session eligible until pin-count or review-status filters exclude them. Pin-count checkboxes are buckets of 1, 2–5, and 6 or more; a session must match at least one selected bucket. Review-status filters run against stored reviewCounts; if those counts are missing, every pin is treated as open. Changing search, either filter, collection, or project resets pagination to the first page.",
            "Grid select-all applies only to the current page of cards; table select-all uses the current table page. The grid or table choice is stored in localStorage as `pinar-history-view`. Bulk delete opens a confirmation dialog, then DELETE `/api/history/{id}` for each selected id. A public project or collection viewer loads `/api/public/projects/{id}` or `/api/public/collections/{id}` and copies combined Markdown from `/p/{id}.md` or `/c/{id}.md`. If that public fetch is not ok, the viewer shows a not-found state instead of a list.",
          ],
          bullets: [
            "After applying search or filters, confirm pagination jumped to page 1 so you are not reading a stale page of an older result set.",
            "Use the bulk toolbar Move to or Delete only after the checkboxes match the sessions you intend; Clear selection empties the set without changing storage.",
            "On an aggregate viewer, Copy Markdown should paste a heading, a `/p/` or `/c/` viewer URL, then each session as a `/v/{id}` heading with Page, Markdown, optional Screenshot, and numbered pin comments; if copy fails with Unable to load Markdown, open the same `.md` URL in the browser.",
          ],
        },
      ],
    },
    "account-and-sign-in": {
      title: "Account and passwordless sign-in",
      summary:
        "Connect the extension, open the web workspace, and understand code and session expiry.",
      sections: [
        {
          heading: "Two code flows",
          paragraphs: [
            "Remote Free installations can open the web app with a five-minute, single-use extension code. Creating a new eight-character code invalidates the previous active one; generation allows 10 requests per five minutes per IP and account, and exchange allows 20 attempts per five minutes per IP. Paid and previously paid accounts can also request a six-digit email code; it expires after ten minutes and locks after five invalid attempts.",
          ],
        },
        {
          heading: "Sessions",
          paragraphs: [
            "Web sessions last 30 days and authenticated extension devices last 180 days. The server stores hashes of codes and session tokens rather than the original secret values.",
          ],
        },
        {
          heading: "Finish pairing from the extension Account tab",
          paragraphs: [
            "On a remote Free installation, open the extension options Account tab and generate the temporary code there, then copy it. Open the hosted sign-in page from that same tab; the link targets /sign-in with returnTo=/app so a successful exchange lands in the web workspace. Regenerating asks for confirmation first because the server deletes every unused code for that owner before inserting the new eight-character value. Paste the code on pinar.dev rather than on loopback: the local helper redirects /sign-in to the hosted origin and does not issue cloud sessions itself.",
            "Requesting an email code always reports accepted with a ten-minute hint, including for unknown addresses, unpaid accounts, or when the mail service is missing, so the form is not an account oracle. A real six-digit message is sent only to an ever-paid account; if delivery throws, that challenge row is deleted. Email requests allow 10 tries per IP and 5 per address per 15 minutes; verification allows 20 per IP and 10 per address per 15 minutes. Submitting the code together with the installation identity migrates that remote Free workspace onto the paid account and issues a 180-day device token. Sign-out revokes the pinar_session cookie and any device bearer presented on the same request.",
          ],
          bullets: [
            "If no email arrives, wait out the 15-minute request window before retrying; a 429 means the IP or address limit was hit, while a silent accepted response can mean the address is unpaid or unknown.",
            "Confirm the regenerate dialog before invalidating a code you still intend to type on the hosted sign-in page.",
            "Use Sign out on the Account tab, or POST /api/auth/logout, when you need the current web cookie or extension device session revoked immediately.",
          ],
        },
      ],
    },
    "plans-and-billing": {
      title: "Free, Pro, Founder, and billing",
      summary:
        "Compare product entitlements, manage a subscription, and treat the pricing page as the current price source.",
      sections: [
        {
          heading: "Plan shape",
          paragraphs: [
            "Free includes permanent local use, 250 MB of cloud quota, seven-day cloud retention, and five initial AI credits. Pro is monthly or annual with 5 GB and 200 non-rollover AI credits refilled monthly. Founder is a limited one-time cohort with 5 GB and 500 initial credits; it does not include a monthly credit refill.",
          ],
        },
        {
          heading: "Billing and availability",
          paragraphs: [
            "Regional BRL or global USD prices, Founder availability, and current offers belong to the Plans page. Stripe Checkout reserves a Founder slot for 15 minutes and releases it when checkout is abandoned. The Stripe customer portal handles plan changes, cancellation, payment methods, and invoices.",
          ],
        },
        {
          heading:
            "Start Checkout with current policies and the right currency",
          paragraphs: [
            "POST /api/stripe/checkout refuses the offer until the current Terms, Privacy Policy, and Acceptable Use versions are accepted. A Cloudflare country of BR selects the BRL catalog and Brazil Stripe Price IDs; any other country uses USD. Founder checkout first inserts a capacity reservation keyed by checkout request id and claim hash, then attaches the Stripe session id; creating the Stripe session without an attachable reservation releases the slot. FOUNDER_SALES_ENABLED must be true with a positive FOUNDER_CAPACITY_LIMIT or the handler returns 503; a full cohort or a claim mismatch on a reused request id returns 409.",
            "The success URL carries session_id and claim; activation hashes that claim against Stripe metadata and only then grants the offer. GET /api/pricing exposes founderState as closed, sold_out, or available so the Plans page can hide a cohort that checkout would reject. The billing portal requires an authenticated account that already has a stripeCustomerId and returns to /app. When Pro billing stops being active, sessions on that plan receive a retention_expires_at 90 days after paid eligibility ended; Founder and legacy lifetime accounts keep sessions marked permanent instead of entering that expiry path.",
          ],
          bullets: [
            "Accept the current policy versions on the hosted Plans flow before paying; a missing acceptance returns legal_acceptance_required instead of a Stripe URL.",
            "If Founder checkout returns 409, reload /api/pricing: closed or sold_out means wait for a released reservation or choose Pro rather than retrying the same claim with a new request id.",
            "If the portal returns 401 or 404 No Stripe customer found, finish a paid Checkout first so a customer id exists, then reopen Manage subscription from an account session.",
          ],
        },
      ],
    },
    "ai-credits": {
      title: "AI summaries and credits",
      summary: "Know when credits are reserved, spent, refilled, or refunded.",
      sections: [
        {
          heading: "Summary cost",
          paragraphs: [
            "A session summary reserves 100 AI credits before model inference. On success, the reservation is consumed. A failed or aborted inference refunds it immediately; a reservation left unsettled for more than five minutes is refunded automatically. Summaries allow 10 requests per minute per account and 30 per minute per IP; a duplicate request for the same session waits for the active request to finish.",
          ],
        },
        {
          heading: "Balances",
          paragraphs: [
            "Purchased packs add 1,000 credits. Pro’s monthly 200-credit allowance does not roll over. Founder’s 500 credits are an activation balance, not a monthly allowance. The account menu shows the active balance and the next applicable refill date.",
          ],
        },
        {
          heading:
            "Retry summaries with a fresh request id and read the ledger",
          paragraphs: [
            "POST /api/ai/session-summary requires a unique requestId plus a session you own. Reusing the same requestId on that session returns the stored success payload or 409 ai_request_in_progress while inference is still reserved. After the five-minute reservation timeout the usage is refunded as reservation_timeout and the next call must use a new requestId; a timed-out retry that cannot refund yet returns 503 ai_refund_pending. A failed or aborted inference refunds immediately when possible. Too little balance returns 402 insufficient_ai_credits with the live balance. Missing Workers AI returns 503 ai_unavailable.",
            "The grant picker spends non-purchase balances first, then the soonest-expiring grant, so monthly included credits that expire at the next UTC month are used before a purchased pack. A purchased 1,000-credit pack is stored with a 12-month expires_at and drops out of the balance query once that timestamp passes. GET /api/account/entitlements returns the summed remaining credits, nextExpiryAt, and nextRefillAt for Founder accounts and for Pro accounts whose billing_status is active. Requested summary language must be de, en, es, fr, ja, pt, or zh; any other value is written as English.",
          ],
          bullets: [
            "On 409 ai_request_in_progress, wait for the in-flight requestId to finish instead of opening a second summary on the same session.",
            "On ai_request_refunded or reservation_timeout, submit a new requestId; replaying the expired id will not start another inference.",
            "If the workspace shows zero credits, call /api/account/entitlements and compare nextExpiryAt against purchased packs before buying another 1,000-credit offer.",
          ],
        },
      ],
    },
    "storage-and-retention": {
      title: "Storage, retention, and recovery",
      summary:
        "Understand quotas, expiring add-ons, blocked uploads, and the recovery window.",
      sections: [
        {
          heading: "Quota and add-ons",
          paragraphs: [
            "Free has 250 MB of base cloud storage; Pro and Founder have 5 GB. Optional 5 GB and 20 GB storage add-ons last 12 months, with reminder emails seven days and one day before expiry. Screenshot uploads must be valid PNG files and pass an atomic quota check before storage. Uploads pause when the resulting bytes exceed the current quota.",
          ],
        },
        {
          heading: "After entitlement expiry",
          paragraphs: [
            "If an expiring entitlement leaves the account over quota, Pinar grants a 30-day grace period followed by recovery access through day 90. After that, excess data becomes eligible for cleanup. Automatic deletion is not currently enabled, so eligibility is not a promise of immediate deletion.",
          ],
        },
        {
          heading:
            "Fit replacements under quota and use the 90-day recovery clock",
          paragraphs: [
            "Quota is `baseBytes` plus still-active add-on bytes. `canStoreBytes` treats an overwrite as `usedBytes` minus the bytes already stored for that session plus the incoming size, so replacing a larger PNG with a smaller one can succeed when a brand-new capture would exceed quota. `uploadAllowed` is false whenever `usedBytes` is already at or above quota. Over-quota without a `latestExpiredAt` timestamp is the over_quota state with no grace clock. When `latestExpiredAt` is set from an expired add-on or from `paidEligibilityEndedAt`, the account is in grace for 30 days, recoverable through day 90, then cleanup_eligible; uploads stay disallowed in all three states.",
            "Free non-permanent cloud sessions become deletion-eligible after seven days. Pro content above the Free quota follows the 30-day grace and 90-day recovery window after paid eligibility ends. Founder and legacy lifetime content is not made deletion-eligible merely because there is no recurring subscription; it remains limited by purchased quota, user deletion, abuse and legal holds, account closure, and service discontinuation. Local-only history under the device is never remotely deleted. Deletion eligibility is not a promise of immediate removal, and hosted automatic deletion is intentionally not enabled.",
          ],
          bullets: [
            "When new captures pause, reduce `usedBytes` below the remaining quota by deleting sessions or replacing a heavy screenshot, or purchase a 5 GB or 20 GB twelve-month add-on.",
            "If the entitlement state is grace or recoverable, export anything you still need before day 90 after `latestExpiredAt`; cleanup_eligible only marks overage, it does not itself delete.",
            "Do not expect uninstalling the desktop app to purge cloud objects, and do not expect the cloud to erase ~/.pinar local history.",
          ],
        },
      ],
    },
    "sharing-links": {
      title: "Share sessions, projects, and collections",
      summary:
        "Use unlisted viewers and Markdown projections with the correct privacy expectations.",
      sections: [
        {
          heading: "Unlisted public links",
          paragraphs: [
            "Cloud viewers exist for one session, a project, or a collection. They are public to anyone who has the link and are not indexed as normal navigation. Do not treat an unlisted URL as authentication for sensitive content.",
          ],
        },
        {
          heading: "Markdown for agents",
          paragraphs: [
            "The .md projection for a session includes metadata, screenshot references, locators, agent results, and review history. Project and collection projections combine their sessions. Expired or unavailable shared data returns a not-found response rather than private account details.",
          ],
        },
        {
          heading:
            "Copy the public Markdown projection and know what it exposes",
          paragraphs: [
            "Unlisted HTML lives at /v/{id} for a session, /p/{id} for a project, and /c/{id} for a collection. The Markdown projection is the same path with a .md suffix. The aggregate viewer loads /api/public/projects/{id} or /api/public/collections/{id} without an auth cookie; Copy Markdown then GETs /p/{id}.md or /c/{id}.md and writes the text to the clipboard, and each session card opens /v/{id}. A missing or malformed id returns Session not found, Project not found, or Collection not found rather than owner email, plan, or other account fields.",
            "Session Markdown is built from the handoff bundle plus agent-result and pin-review sections. Project and collection Markdown list every nested session with page URL, /v/{id}.md, optional screenshot URL, pin comments, `pinId`, DOM path, selector, and inner text. Screenshot lines appear only when the owner's `includeScreenshot` delivery preference allows them. Markdown and public JSON are cached as public max-age=60; shot PNGs are cached for 86400 seconds. Anyone who can open the link can copy what they see, so an unlisted URL is not authorization or data minimization.",
          ],
          bullets: [
            "Before sending /p/{id} or /c/{id}, open Copy Markdown once and check that every nested session, pin comment, and screenshot line is safe to publish.",
            "Turn off screenshot delivery on the owner account if the projection should keep image URLs out; wait at least 60 seconds for the public Markdown cache to expire.",
            "If a shared path shows not found, treat the id as gone or invalid; the public handlers never add private account diagnostics to that response.",
          ],
        },
      ],
    },
    "where-data-lives": {
      title: "Where your data lives",
      summary:
        "Separate local files, cloud persistence, browser preferences, and public projections.",
      sections: [
        {
          heading: "Local boundary",
          paragraphs: [
            "Local screenshots are files under `~/.pinar/shots` and local history is SQLite under `~/.pinar/history.db`, with a JSON fallback when SQLite is unavailable. Browser preferences such as view, language, theme, and delivery settings stay in local browser storage unless a feature explicitly syncs them.",
          ],
        },
        {
          heading: "Cloud boundary",
          paragraphs: [
            "Cloud account records and capture metadata use Cloudflare D1; images use R2. Stripe processes billing, the configured email service sends login codes, and Workers AI handles requested summaries. The Subprocessors page is the current list of external service roles.",
          ],
        },
        {
          heading: "Confirm which store actually holds each capture",
          paragraphs: [
            "Start in the helper home directory and check which file is live. Screenshots are written as PNG files into the shots folder; session history prefers SQLite at `history.db`, and `history.json` is opened only after `SqliteHistoryDb` cannot be constructed. A successful SQLite open also rewrites nested shots/shots path prefixes onto the canonical shots directory. Theme remains a browser-only preference: the Interface tab stores dark or light under the localStorage key pinar-theme and deletes that key for system. Language plus the Capture tab switches for handoff mode (full versus compact) and include-screenshot are edited in the same settings dialog, but a signed-in cloud account can persist handoff_mode and include_screenshot in D1 owner_preferences through GET and PATCH /api/preferences.",
            "Hosted captures keep metadata in D1 and PNG bytes in R2. Unauthenticated public projections are GET /shots/{id}.png (Cache-Control max-age 86400), GET /v/{id}.md, and the /p/ and /c/ project and collection routes. POST /api/auth/email-codes stores only a hash in email_challenges, expires the challenge after ten minutes, and returns 202 with { accepted: true, expiresInSeconds: 600 } even when EMAIL is missing or the account is not everPaid, so the response does not reveal whether mail was sent (429 is the rate-limit exception). Requested summaries call Workers AI model @cf/meta/llama-3.1-8b-instruct-fp8 at POST /api/ai/session-summary. The Subprocessors page names Cloudflare for D1, R2, Workers AI, and transactional email, and Stripe for Checkout, noting that Pinar does not receive full card details. GET /api/legal/current reports policy version 2026-08-25.",
          ],
          bullets: [
            "If `history.db` is missing or SQLite failed to open, treat ~/.pinar/history.json as the live local catalog and expect a console warning about the JSON fallback.",
            'Open a hosted screenshot at /shots/{id}.png and its markdown projection at /v/{id}.md; a missing R2 object returns JSON { error: "shot not found" } with status 404.',
            "In settings, confirm Interface theme via pinar-theme, then distinguish Capture delivery switches from cloud-synced handoff_mode and include_screenshot in D1 when signed in.",
          ],
        },
      ],
    },
    "automatic-sanitization": {
      title: "Automatic sanitization",
      summary:
        "See which URL, DOM, credential, and inline-image data Pinar removes before handoff or storage.",
      sections: [
        {
          heading: "Sensitive fields and URLs",
          paragraphs: [
            "Pinar redacts password, payment, token, and OTP fields; removes URL fragments; and strips known sensitive query keys such as access_token, api_key, auth, password, secret, token, and jwt. You can add more query-key names in extension settings.",
          ],
        },
        {
          heading: "Structured handoff",
          paragraphs: [
            "The visual-context parser accepts supported schema versions and redacts internal parse errors rather than exposing raw secrets. Inline screenshot data is removed from text handoffs; the bundle uses a bounded path or URL reference instead.",
          ],
        },
        {
          heading: "Watch the redaction report and dropped inline images",
          paragraphs: [
            "sanitizeCapture classifies password, otp, payment, and token fields from input type, autocomplete, and the name/id/ariaLabel/role haystack, then sanitizes the page URL. Query keys in the sensitive set, or values that lookLikeSecret (length at least 12 matching a JWT or prefixes such as sk_live_, ghp_, github_pat_, and AIza), are replaced with [redacted] and tagged secret-query or token; hash parameters use secret-hash. Extra names in extraQueryKeys and extraHashKeys are lowercased, split on spaces, commas, or semicolons, and unioned with DEFAULT_SENSITIVE_QUERY_KEYS, which also includes authorization, refresh_token, session, session_id, client_secret, bearer, and related names beyond the short overview list. Collected secrets then replace matching substrings in title, description, URL, and pins. Values shorter than four characters are not used as replacement secrets even when the field was categorized, and a URL that fails to parse is returned unchanged.",
            "parseVisualCapture accepts schemaVersion 1 or legacy 0 and throws VisualContextError with the stable message invalid visual context and codes unsupported_schema, invalid_payload, invalid_pin, or missing_capture_id instead of echoing the raw body. decodeVisualCaptureJson recovers from JSON or schema failure by returning that `captureId` with empty pins. screenshotFrom and captureForHandoffJson set screenshot.url to null for data: URLs; the handoff path adds warning screenshot_inline when it stripped inline bytes, so the text bundle keeps a filesystem path or http(s) reference rather than the image payload. Setting input.unevaluated to true records unevaluated on the privacy report and adds warning privacy_unevaluated.",
          ],
          bullets: [
            "After sanitizeCapture, read privacy.redacted plus warnings privacy_redacted or privacy_unevaluated; unevaluated true means some regions were not inspected.",
            "Add extra query-key names as comma-, space-, or semicolon-separated tokens; matching is case-insensitive against the built-in set including authorization, session, and refresh_token.",
            "If pasted handoff JSON still contains a data: screenshot URL, the capture skipped captureForHandoffJson; the supported path nulls url and may add screenshot_inline.",
          ],
        },
      ],
    },
    "local-security-and-recovery": {
      title: "Local security and recovery",
      summary:
        "Understand capability tokens, trusted origins, local migrations, and safe startup recovery.",
      sections: [
        {
          heading: "Local API trust",
          paragraphs: [
            "The local API accepts loopback and the published extension origin, then verifies a capability secret stored with restrictive file permissions. Token rotation keeps the previous secret valid for 24 hours so active processes can adopt the new value; revocation removes the file and forces reauthorization.",
          ],
        },
        {
          heading: "Safe recovery",
          paragraphs: [
            "A stale tray PID lock is replaced while a live instance remains untouched. Stop and restart first use the helper’s graceful path; on macOS a stuck listener is terminated only after it remains responsive past the wait. Corrupt fallback history JSON resets to a blank schema with protected Personal and Inbox. Legacy screenshots under a nested shots/shots path are migrated without overwriting name conflicts.",
          ],
        },
        {
          heading:
            "Present the capability secret and recover a broken local store",
          paragraphs: [
            'The helper persists a version-1 store at local-capability.json using a 0o600 temp file and rename. Send the current secret in the x-pinar-capability header or as an Authorization Bearer token. GET /api/local/capability may omit the secret when Origin is empty, loopback HTTP on 127.0.0.1, localhost, or ::1, or chrome-extension:// with an alphanumeric id; any other Origin is hostile and receives 401 { error: "unauthorized" } with Cache-Control no-store. HTTPS loopback is not treated as loopback. POST /api/local/capability/rotate and /revoke require a matching secret. Rotation writes a new current secret and keeps previous.secret until expiresAt (default 24 hours, overridable with PINAR_CAPABILITY_GRACE_MS; zero drops previous). Revoke deletes the file; the next readOrCreateLocalCapability mints a new store. Ordinary loopback requests skip the secret; chrome-extension requests need a match. Entries classified public-min or local-public-projection skip this gate.',
            "claimInstanceLock leaves a live foreign PID in place and calls onDuplicate; a missing or unreadable lock is treated as stale and overwritten with this process id. migrateNestedShots moves files from shots/shots into shots and skips names that already exist at the destination; it removes the nested directory only when the conflicts list is empty. Shot ids are reduced to A–Z, a–z, 0–9, underscore, and hyphen with a maximum of 80 characters, otherwise the file is pin.png. If `SqliteHistoryDb` throws, openHistoryDb warns and opens `history.json`. A corrupt JSON file parses to empty arrays, then _ensureDefaults recreates the protected Personal project and Inbox collection for owner local. A failed JSON write logs a warning and does not abort startup. When `history.db` is absent, migrateLegacyHistoryDb may rename a leftover history.sqlite from bin/ or shots/ into `history.db`.",
          ],
          bullets: [
            "Send x-pinar-capability or Bearer on chrome-extension calls; GET /api/local/capability bootstraps from loopback HTTP or chrome-extension, and other Origins receive 401 unauthorized.",
            "After revoke, local-capability.json is gone; the next helper start mints a new secret, and clients must re-read it before rotate or revoke will succeed again.",
            "If `history.db` cannot open, expect `history.json`; a corrupt JSON file becomes an empty catalog, then Personal and Inbox for owner local, without crashing the helper.",
          ],
        },
      ],
    },
    "telemetry-and-policies": {
      title: "Telemetry, consent, and policies",
      summary:
        "Know what is opt-in, which policies gate cloud use, and what Fair Source means here.",
      sections: [
        {
          heading: "Closed-loop metrics",
          paragraphs: [
            "Loop metrics are off unless you opt in. When disabled, submissions are discarded. When enabled, the sanitizer allows operational events, duration, agent, and relocation confidence but rejects comments, titles, URLs, DOM paths, selectors, screenshots, markup, and raw content.",
          ],
        },
        {
          heading: "Consent and license",
          paragraphs: [
            "Remote persistence and checkout record acceptance of the current Terms, Privacy Policy, and Acceptable Use Policy. Retention, refunds, Fair Source, and subprocessors have separate published documents. Pinar is Fair Source/source-available under the repository license, not OSI-approved Open Source in current versions.",
          ],
        },
        {
          heading: "Verify opt-in payloads and the published policy set",
          paragraphs: [
            "Loop metrics default off because DEFAULT_LOOP_METRICS_OPT_IN is false. planLoopMetricRequest returns send false with reason opt_in_off unless optIn is strictly true, and loopMetricHttpStatus maps that code to HTTP 200. When enabled, each event object may contain only agent, degraded, durationMs, event, and locationConfidence. Unknown keys, forbidden keys such as url, title, comment, screenshot, selector, path, `captureId`, sessionId, html, markdown, content, pin, and page, or string values that look like http(s) URLs, data: URIs, or contain { or <, become forbidden_fields (HTTP 400). event must be accepted, correction_ready, handoff, relocation_failed, or reopened; agent must be claude, codex, cursor, or grok; locationConfidence must be exact, probable, ambiguous, or unresolved; durationMs must be a non-negative integer at most 86,400,000. An empty or non-array events value is invalid_payload and is not sent.",
            "README states that checkout and remote Free registration record accepted policy versions and publishes Terms, Privacy, Acceptable Use, Retention, Refunds, Fair Source, and Subprocessors at https://pinar.dev/legal/. legal-documents pins CURRENT_LEGAL_VERSION to 2026-08-25 for all seven document ids. Terms say local-only use that never contacts the hosted service needs no hosted account; Privacy says local-only data that never leaves the device is outside the hosted policy. LICENSE is Functional Source License, Version 1.1, MIT Conversion: two years after first publication the Change License is MIT, and until the Change Date you may not offer a competing commercial hosted visual annotation, screenshot preview, or cloud persistence service. The Fair Source notice defers to LICENSE and is not OSI-approved Open Source. Questions go to contact@pinar.dev or contato@pinar.dev.",
          ],
          bullets: [
            "Leave loop metrics disabled unless you intend optIn true; a disabled plan returns send false with opt_in_off and does not transmit the batch.",
            "Before hosted persistence or checkout, open Terms, Privacy, and Acceptable Use at version 2026-08-25 from https://pinar.dev/legal/terms, /privacy, and /acceptable-use.",
            "Treat LICENSE as controlling for FSL-1.1-MIT competition limits and the Change Date; the hosted subprocessors currently named are Cloudflare and Stripe.",
          ],
        },
      ],
    },
  },
} satisfies HelpLocale;

export default locale;
