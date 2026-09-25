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
    clearSearch: "Clear search",
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
        "Select pages precisely, annotate them, mask sensitive areas, and inspect the result.",
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
    "capture-toolbar": {
      alt: "Pinar capture toolbar with controls to finish the session, review it with Tab, and hide the toolbar with Escape.",
      caption:
        "One continuous session follows navigation, preserves pin numbering, and keeps the toolbar hidden after Escape until you explicitly reopen Pinar.",
    },
    "capture-session-review": {
      alt: "Opaque Pinar session review card with an editable comment, selected target, DOM path, thumbnail, and removal control.",
      caption:
        "Tab replaces the capture toolbar with session review, where you can edit or remove pins before finishing or discarding the session.",
    },
    "capture-review": {
      alt: "A page with element pins ready to be reviewed with their captured structure and technical evidence.",
      caption: "Element pins preserve DOM structure, resilient locators, and observed technical evidence for the agent handoff.",
    },
    "capture-copy-failed": {
      alt: "Pinar reporting that the session could not be finished while keeping its pins available for review and retry.",
      caption:
        "A failed finish shows an actionable error and keeps the complete session available for review and retry.",
    },
    "capture-full-page": {
      alt: "Pinar overlay on a long document that continues below the first viewport, ready for a stitched full-page capture.",
      caption:
        "Full-page capture scrolls and stitches the document so the copied screenshot includes content that sits below the fold.",
    },
    "capture-viewer": {
      alt: "Pinar session viewer with every annotated screenshot in one pan-and-zoom canvas and all pin notes in the right panel.",
      caption:
        "A saved session opens as one record regardless of page count, with all screenshots on the canvas and all annotations in the right panel.",
    },
    "extension-options": {
      alt: "Pinar extension options on the Preferences tab, with local and remote storage choices plus language and theme controls.",
      caption:
        "The Preferences tab chooses the storage destination and sets the language and appearance used across the extension.",
    },
    "extension-preferences": {
      alt: "Pinar extension options on the Capture tab, showing compact or full agent copy detail and the include-screenshot switch.",
      caption:
        "Capture sets compact or full handoff and whether the next copy includes a screenshot; Save writes those choices before the next copy.",
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
      alt: "Pinar pricing page comparing Free, Pro yearly, storage add-ons, and AI credit options.",
      caption:
        "The pricing surface exposes plan limits, billing cadence, storage add-ons, and AI credit purchases before checkout.",
    },
    updates: {
      alt: "Pinar release detail showing the release date, version, changes, and previous and next release navigation.",
      caption:
        "Published release notes make installed behavior and operational changes traceable by version.",
    },
    "capture-shortcuts": {
      alt: "Pinar extension Shortcuts tab listing browser commands and overlay keys used during capture.",
      caption:
        "The Shortcuts tab shows Chrome command bindings next to the overlay keys for pin, selection, mask, copy, and cancel.",
    },
    "capture-types": {
      alt: "Pinar overlay with a numbered pin on a heading and a selected region around the order-total card.",
      caption:
        "Element pins and freeform regions can share one overlay so the copied screenshot keeps both the DOM target and the visual grouping.",
    },
    "capture-pins": {
      alt: "Pinar overlay with three numbered pin markers on a heading, a customer email, and a payment button.",
      caption:
        "Each pin keeps its own number and comment so one capture can point at several elements on the same page.",
    },
    "capture-selection": {
      alt: "Pinar overlay highlighting a heading with a blue selection outline before the pin is confirmed.",
      caption:
        "Smart selection outlines the element under the cursor so you can walk the DOM with the arrow keys before pinning.",
    },
    "capture-masks": {
      alt: "Pinar overlay with a privacy mask covering a customer email while a numbered pin remains on the heading.",
      caption:
        "A mask hides sensitive pixels in the copied screenshot without removing the pin comments that still describe the page.",
    },
    "capture-copied": {
      alt: "Pinar confirming that the complete capture session was copied successfully.",
      caption:
        "A successful finish confirms the result, closes the overlay, and leaves one correlated session bundle on the clipboard.",
    },
    "install-pinar": {
      alt: "Pinar extension Preferences tab with a Download Pinar button next to the Local Server option.",
      caption:
        "The Preferences tab offers the Pinar application download beside Local Server so the helper can start on this computer.",
    },
    "options-local": {
      alt: "Pinar extension Preferences tab with Local Server selected and captures staying on this computer.",
      caption:
        "Local Server keeps history and screenshots on this computer and does not require hosted-service legal acceptance.",
    },
    "workspace-nested": {
      alt: "Pinar workspace sidebar with a selected collection in the project tree and the matching session cards.",
      caption:
        "Selecting a collection filters the workspace to that branch so nested folders stay visible beside the sessions they hold.",
    },
    "workspace-review": {
      alt: "Pinar workspace table with the Review status filter open above session rows.",
      caption:
        "Table view combines search with Review status filters so you can scan open, accepted, and reopened pins across sessions.",
    },
    "workspace-security": {
      alt: "Pinar workspace project switcher open on the protected Personal project.",
      caption:
        "The local workspace recovers a protected Personal project and Inbox when history cannot open, instead of blocking the app.",
    },
    "legal-retention": {
      alt: "Pinar legal center open on the Data Retention document.",
      caption:
        "The Data Retention policy states how long hosted captures, billing records, and related account data are kept.",
    },
    "sharing-markdown": {
      alt: "Public Pinar project viewer with a Copy Markdown button above shared session cards.",
      caption:
        "An unlisted project or collection link lets anyone with the URL copy the combined Markdown without signing in.",
    },
    "preferences-privacy": {
      alt: "Pinar extension Capture tab showing optional loop metrics and extra URL keys to hide.",
      caption:
        "Privacy preferences add extra query keys to strip from captured URLs and keep loop metrics off until you opt in.",
    },
    "pricing-credits": {
      alt: "Pinar pricing add-on card for 500 AI credits with purchase and twelve-month validity.",
      caption:
        "AI credits are sold as an add-on with a twelve-month validity window, separate from plan storage and billing cadence.",
    },
  },
  articles: {
    "install-pinar": {
      title: "Install Pinar",
      summary: "Install the Chrome extension and open the Pinar application on your computer.",
      sections: [
        {
          heading: "Browser extension",
          paragraphs: [
            "Install Pinar from the [Chrome Web Store](https://chromewebstore.google.com/detail/pinardev/idpeaokdndjedekacfdfbilcolpholbo).",
          ],
          bullets: [
            "Pin the Pinar icon from Chrome’s extensions menu so it stays visible.",
            "Open the [Chrome Web Store listing](https://chromewebstore.google.com/detail/pinardev/idpeaokdndjedekacfdfbilcolpholbo) to add the official extension.",
          ],
        },
        {
          heading: "The Pinar application",
          paragraphs: [
            "On macOS, the Pinar application lives in the menu bar. On Windows, it lives in the notification area. Open the Pinar application to start capturing. On Linux, install with the command below.",
          ],
          bullets: [
            "Captures stay on this computer. Choose “Open Folder” to see them.",
            "On macOS and Windows, “Start at Login” keeps Pinar available after you sign in.",
            "If a capture has no image, open Pinar and try again.",
          ],
        },
        {
          heading: "Install and open",
          paragraphs: [
            "Download the Pinar application from the links below, install it, and open it.",
            "When Pinar is open, choose “Open Workspace”. If it shows “Local Server: Off”, choose “Start”. If pasted captures stop arriving, open Pinar again.",
          ],
          bullets: [
            "macOS: [download the Pinar application](https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg), open the disk image, and drag it into “Applications”.",
            "Windows: [download the Pinar application](https://github.com/djalmajr/pinar/releases/latest/download/win-x64-Pinar-Setup.zip), extract it, and run `Pinar-Setup.exe` next to the `.installer` folder. It appears in the notification area.",
            "Windows: the first run may show “Windows protected your PC”. Choose “More info”, then “Run anyway”.",
            "Linux: `curl -fsSL https://pinar.dev/install.sh | sh`",
          ],
        },
      ],
    },
    "first-capture": {
      title: "Make your first capture",
      summary:
        "Pin elements across one or more pages, review the continuous session, and finish one correlated bundle.",
      sections: [
        {
          heading: "Build one continuous session",
          paragraphs: [
            "Open Pinar, click an element or drag a freeform area, write the comment, and press `Enter`. The first pin starts a session. Each pin captures its own screenshot immediately, and you can navigate to other pages without finishing.",
          ],
          bullets: [
            "Pin numbering continues across every page in the same session.",
            "`Shift+Enter` adds a line break. `Escape` closes a draft, or hides the toolbar when no draft is open.",
            "After being hidden, the toolbar stays hidden across navigation until you invoke the extension action or shortcut again.",
          ],
        },
        {
          heading: "Review before finishing",
          paragraphs: [
            "Press `Tab` to replace the toolbar with session review. Edit comments, inspect the selected element or region, page title, DOM path, and thumbnail, or remove a pin with the X control. Press `Tab` again to return to capture mode.",
          ],
          bullets: [
            "Session review restores the normal page cursor and never receives focus just because you pressed `Tab`.",
            "Inside a comment editor, `Tab` keeps normal keyboard navigation.",
          ],
        },
        {
          heading: "Finish or cancel the session",
          paragraphs: [
            "Use `Command+Enter` on macOS or `Alt+Enter` on Windows and Linux to finish and copy the complete session. Pinar visibly confirms success. If finishing fails, it shows an actionable error and keeps the session available for review and retry. Discard session cancels it without copying.",
            "Treat the clipboard payload as one unit: readable instructions, an optional viewer URL, and one fenced pinar-visual-context block per page. Each block carries its own screenshot plus `captureId`, `pinId`, page URL, and locators (cssSelector, domPath, innerText). Numbered badges are annotation overlays, not page UI. Do not rewrite `captureId` or `pinId` when pasting to an agent.",
          ],
          bullets: [
            "A session with no saved pins cannot finish.",
            "Local and cloud storage use the same continuous-session behavior.",
            "Keep the local Pinar app running when using local storage so screenshots and the viewer remain available.",
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
            "Local mode keeps history and screenshots on this computer. The local workspace stays available without an account.",
          ],
        },
        {
          heading: "Cloud",
          paragraphs: [
            "When the signed-in account is eligible under the current offer, cloud mode provides remote workspace access, managed retention, billing, and unlisted share links. The local app and a self-hosted server stay free. Pinar Cloud voice transcription remains a Pro benefit and is not part of an evaluation. Local AI and BYOK remain available without using Pinar Cloud credits. You accept the current policies before anything is stored remotely.",
          ],
        },
        {
          heading: "How local and cloud sessions actually open",
          paragraphs: [
            "Local history starts with a protected “Personal” project and “Inbox” collection that you cannot nest or delete like ordinary folders. Captures stay on this computer, and you can open them from the local workspace.",
            "Cloud storage starts after you accept the current “Terms”, “Privacy”, and “Acceptable Use” and confirm an email code. “Free” and Pro accounts use the same sign-in flow. Share links stay readable by anyone who has the unlisted URL.",
          ],
          bullets: [
            "The local workspace stays on this computer and does not need a cloud account.",
            "If local history cannot open its usual store, Pinar recovers a usable catalog instead of crashing.",
            "Cloud share links do not require a workspace session: anyone with the unlisted URL can read the Markdown or image.",
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
            "`Enter` pins the hovered element; `Arrow Up` selects its parent and `Arrow Down` returns to a child.",
            "`M` toggles privacy-mask drawing. `Escape` cancels a draft or mask; with no draft it clears pins and hides the toolbar.",
            "`R` toggles the live overlay between numbered pins only and pins with their selected regions. The copied screenshot always includes both.",
            "`Command+Enter` / `Alt+Enter` copies the completed bundle.",
            "`Alt+Shift+P` shows or hides the toolbar without cancelling the session, and you can rebind it in `chrome://extensions/shortcuts`. Browser shortcuts stay inert on `chrome://` pages, on the Chrome Web Store, and before the overlay is injected.",
            "`G` starts recording the steps you take on the page. Reopen Pinar, pin the result, and copy with `Command+Enter` / `Alt+Enter` to attach the steps; pressing `G` again discards the recording.",
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
            "Capture shortcuts are owned only while the overlay is active. The extension icon toggles that overlay; it does not delete pins. Hovering the toolbar without an open draft makes it pass-through so you can still click or drag the page underneath. `Shift+Enter` inserts a line break in the composer, and host-page shortcuts typed there are stopped from leaving the comment field.",
            "`Arrow Up` walks to the parent element and remembers the child you left, so `Arrow Down` returns to that remembered node when it is still a child; otherwise it uses the first child. In mask mode, drag a region to hide it and click an existing mask to restore it. Keyboard scrolling still works on the document, but keys aimed at focused page controls are blocked so they cannot activate buttons or type into the host form.",
          ],
          bullets: [
            "`Command+Enter` / `Alt+Enter` saves an open draft, then copies; without a comment it shows “Write a comment first” instead of sending an empty pin.",
            "After `Escape` or copy, Pinar keeps owning that physical key through keyup so the host page does not treat the same keystroke as its own cancel or submit.",
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
            "Click a node, or press `Enter` on the current outline, to open an element pin. Drag a rectangle of at least six pixels to open an area pin instead. The first press on an iframe or frame element is ignored so the document inside that frame can take the selection.",
            "Element pins record a fingerprint, a selector, and a DOM path that joins ancestor frames with a frame-boundary delimiter. Area pins store the rectangle and a pixel-size label without a locator. The copied screenshot still tiles around the union of every pin, including pins placed in child frames.",
          ],
          bullets: [
            "The capture toolbar stays on the top frame; child frames show markers and the comment composer only.",
            "If a parent frame does not reply with its path, the pin keeps the inner document path only.",
            "Fixed or sticky elements are marked viewport-anchored so scrolling does not treat them as document-scrolled boxes.",
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
        {
          heading: "Structure and technical evidence",
          paragraphs: [
            "Each element pin also stores a snapshot of what it points at: the element’s HTML tree, the computed styles that differ from the browser defaults, the fonts and icons it uses, and its parent and siblings. The viewer shows this under “Structure”. Large elements are trimmed to stay within the capture limit, and the viewer says so.",
            "“Technical evidence” lists facts the extension observed on the page while you pinned: console errors, failed requests, and the environment (browser, viewport, language). Each item is graded “After interaction” when it happened after your last click or keystroke, or “Same page” when it only shares the page. Nothing is inferred and no AI credit is spent; remove an item before sharing if it is unrelated.",
          ],
          bullets: [
            "Area pins have no element structure; use an element pin when the agent needs DOM context and resilient locators.",
            "Structure and evidence travel inside the pinar-visual-context JSON block, so an agent receives them with the paste.",
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
        "Understand how a pin identifies an element while you annotate a changing page.",
      sections: [
        {
          heading: "Resilient fingerprints",
          paragraphs: [
            "An element pin combines a stable selector, DOM path, tag, id, name, test id, role, classes, text, label, and geometry instead of trusting one fragile path.",
          ],
        },
        {
          heading: "Live-page confidence",
          paragraphs: [
            "While the annotation overlay is open, Pinar reevaluates the selector and structure so markers follow elements that move as the page updates.",
          ],
          bullets: [
            "Generated-looking class names are dropped from the fingerprint.",
            "Unreadable cross-origin frames remain unresolved instead of being guessed.",
            "Unique ids and test ids take priority when they identify one element.",
            "A structural DOM path is stored when no stable attribute is unique.",
            "Area pins use their geometry and do not pretend to identify one DOM element.",
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
            "`Escape` leaves mask drawing without discarding the pins already placed on the page.",
          ],
        },
      ],
    },
    "copy-and-view": {
      title: "Copy and view a session",
      summary:
        "Review every screenshot and annotation from a saved session in one workspace record.",
      sections: [
        {
          heading: "Viewer controls",
          paragraphs: [
            "The capture viewer supports pointer pan, wheel zoom anchored to the cursor, double-click zoom, and controls from 50% to 800%. Selecting a pin opens rendered Preview and verbatim Raw Markdown tabs.",
          ],
          bullets: [
            "Download the screenshot or copy the session Markdown from the viewer.",
            "Use the original-page link when you need to inspect the current site separately.",
            "Select a pin to switch between Preview and Raw Markdown.",
            "A grouped session keeps every captured screenshot in the same viewer.",
            "The original-page link opens separately without changing the saved session.",
          ],
        },
        {
          heading: "Copy from the viewer",
          paragraphs: [
            "Copy prompt writes the correlated Markdown bundle for the complete grouped session. Open prompt *.md opens the public Markdown when sharing is available.",
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
            "The Chrome extension never types into the agent composer. After `Command+Enter` / `Alt+Enter`, paste the clipboard yourself into Cursor, Claude, Codex, or Grok. The text begins by saying the pin notes may ask for a change or an explanation, and to treat selector and DOM path as complementary locators, followed by a fenced pinar-visual-context JSON block. If a Viewer URL is included, fetch it only when those details are not enough.",
            "Treat `captureId` and `pinId` as identity, not labels to rewrite. Visual Context currently encodes schemaVersion 1; parseVisualCapture rejects a missing `captureId` and any schemaVersion other than 1 or the legacy 0. Follow only what the pins describe. If the person never pasted, ask them to copy again from Pinar instead of reconstructing pins from memory.",
          ],
          bullets: [
            "Paste the whole clipboard into the agent; do not retype comments or invent a new `captureId`.",
            "Confirm the pasted text still contains a closed pinar-visual-context fence before you start editing code.",
            "If nothing was pasted, ask for `Command+Enter` / `Alt+Enter` in Pinar and follow only the pin notes.",
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
    "ai-features": {
      title: "AI features and how to test them",
      summary: "Test voice transcription and turn a recorded browser flow into concise written reproduction steps.",
      sections: [
        {
          heading: "Choose a provider for reproduction",
          paragraphs: [
            "On the local server, open Settings → AI Assistant, choose Local AI or BYOK, enter the OpenAI-compatible endpoint and model, then use Test and save. Local AI and BYOK do not use Pinar credits. In Pinar Cloud, reproduction is available to eligible signed-in accounts without debiting AI credits.",
          ],
        },
        {
          heading: "Transcribe a voice comment",
          paragraphs: [
            "Connect the extension to a Pinar Cloud Pro account, start a pin comment, and choose the microphone. Record for up to 120 seconds, stop to place the transcription in the comment, or send it directly. The Voice transcription and Pinar Cloud AI credits guide explains the current charging tiers and refunds.",
          ],
        },
        {
          heading: "Generate written reproduction steps",
          paragraphs: [
            "Open the Pinar capture toolbar and press `G` to start recording. Use the page normally, reopen Pinar, add a pin, and finish with `Command+Enter` on macOS or `Alt+Enter` on Windows and Linux. The extension records navigation, clicks, typed values, keys, and relevant scrolling; sensitive values remain redacted.",
            "Open the saved session. Reproduction shows the raw timeline, which you can edit before choosing Generate written steps. AI turns that timeline and the pin comments into concise instructions saved with the session and included in the handoff to your local agent.",
          ],
          bullets: [
            "Edit or remove noisy timeline events before generation.",
            "Review the generated instructions before handing them to your local agent.",
            "Let the local agent create project-specific automated tests with the repository and its conventions in context.",
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
            "An agent reports work against the capture’s `captureId` and each `pinId`. Repeat a delivery with the same key only when the result is unchanged; a different summary, files, or status needs a new key. Unknown pins or captures are rejected without echoing private comments.",
            "A person accepts a correction or reopens an accepted pin from the review UI. Agents cannot accept their own work. After a human reopen, the intended retry is a second changed result. Leave anonymous loop metrics off unless you opt in.",
          ],
          bullets: [
            "Publish a changed result for the same `captureId` and `pinId`, then confirm the viewer shows the pin as ready to accept.",
            "Reuse a delivery key only when the result is identical; mint a new key when the files, summary, or status actually changed.",
            "If verification fails, reopen as a human, publish a second result, accept again, and keep the before and after capture ids.",
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
            "Copy requires a saved comment and at least one pin. The toolbar shows “Saving the session…”, hides overlays, captures the shot, then asks the offscreen document to write text/html and text/plain. Offscreen tries navigator.clipboard.write first and falls back to a copy event plus execCommand. If that write is not ok, the content script still attempts writePlainText on the returned plain payload: clipboard.writeText, then a hidden textarea selection.",
            "When every copy path fails, the page sends overlays:hidden with hidden false, flashes “Copy failed”, and leaves pins editable. A successful copy shows “Copied successfully!”, or “Copied successfully!” plus “no screenshot”, “helper unavailable”, or “no viewer”, then ends the session. Those suffixes map to `screenshot_missing`, `helper_unavailable`, and `viewer_unavailable`. screenshot_inline is not one of the degraded handoff warnings. A paste without a closed pinar-visual-context fence cannot be parsed as JSON.",
          ],
          bullets: [
            "If the toolbar says “Write a comment first” or “Add a pin first”, finish that pin and press `Command+Enter` / `Alt+Enter` again.",
            "If “Copy failed” appears, confirm the pins are still on the page, grant clipboard permission if prompted, and retry the copy.",
            "Read the “Copied successfully!” suffix: “no screenshot”, “helper unavailable”, and “no viewer” name the missing layer to retry without discarding comments.",
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
            "Drag sessions between collections to reorder them, or use bulk Move to for a selected set.",
          ],
        },
        {
          heading: "Confirm where a moved session lands",
          paragraphs: [
            "Open a collection to see and change its saved manual order by dragging a session onto a neighbor. When no collection is selected, the listing sorts by created date instead of that saved order.",
            "A drag starts from the card or table row, not from search, checkboxes, or the action menu (`data-no-dnd`). If the dragged session is already selected with others, every selected id travels with it; otherwise only that session moves. Move to asks for a project, then a collection in that project's flattened tree; changing project clears the collection field, and a project with no collections is disabled. The session is appended at the next position in the target. Deleting Personal is refused; deleting another project appends its sessions to Inbox in existing order and removes that project's collections.",
          ],
          bullets: [
            "To change order inside a collection, drag a session onto a neighbor.",
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
            "Grid select-all applies only to the current page of cards; table select-all uses the current table page. The grid or table choice is remembered in this browser. Bulk delete asks for confirmation, then removes each selected session. A public project or collection viewer copies combined Markdown from the share page. If that share is gone, the viewer shows a not-found state instead of a list.",
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
          heading: "Email code for Free and Pro",
          paragraphs: [
            "Provide your email in the extension or on pinar.dev. A six-digit code expires after ten minutes and locks after five invalid attempts. A new Free account is created only after the code is confirmed. Disposable email providers are blocked for new accounts; custom domains are accepted.",
          ],
        },
        {
          heading: "Sessions",
          paragraphs: [
            "Web sessions last 30 days and authenticated extension devices last 180 days. Codes expire for security.",
          ],
        },
        {
          heading: "Sign in from the extension Account tab",
          paragraphs: [
            "Open the Account tab, enter your email, and request a code. Use the code you receive to connect this extension to your account. Any captures from an older anonymous installation move to the account during verification.",
            "Email-code requests show the same result for unknown or blocked addresses, so the form does not reveal whether an account exists. Sign out ends the current extension device session.",
          ],
          bullets: [
            "If no email arrives, wait before retrying; codes expire, and too many attempts are delayed.",
            "Use a current code sent to your email address; extension pairing codes are no longer offered.",
            "Use Sign out on the Account tab when you need the current web or extension session ended immediately.",
          ],
        },
      ],
    },
    "plans-and-billing": {
      title: "Free, Pro, and billing",
      summary:
        "Compare product entitlements, manage a subscription, and treat the pricing page as the current price source.",
      sections: [
        {
          heading: "Plan shape",
          paragraphs: [
            "The local app and a self-hosted server stay free. Hosted Pinar Cloud follows the current offer and that account’s eligibility: a new account may receive a temporary evaluation, and an earlier account may keep legacy eligibility. There is no single deadline for every account. Pro is a paid annual plan, with 2 GB and a one-time allocation of 500 AI credits on the account’s first subscription. Voice transcription stays a Pro benefit. The Plans page and the account entitlements show the offer and quota that apply now. Captures already stored in the cloud remain subject to retention and export.",
          ],
        },
        {
          heading: "Billing and availability",
          paragraphs: [
            "Regional BRL or global USD prices and current offers belong to the Plans page. The Stripe customer portal handles plan changes, cancellation, payment methods, and invoices.",
          ],
        },
        {
          heading:
            "Start Checkout with current policies and the right currency",
          paragraphs: [
            "Paying on Plans accepts the current Terms, Privacy Policy, and Acceptable Use. Brazil uses BRL prices; other countries use USD.",
            "After a successful payment, the offer is granted on the signed-in account and you return to the workspace. The billing portal is available after a paid checkout. When a Pro subscription ends, those cloud sessions enter a recovery window.",
          ],
          bullets: [
            "Continuing a paid checkout on Plans accepts the current policy versions.",
            "Pro benefits require an active subscription; buying an add-on does not activate Pro.",
            "If Manage subscription is unavailable, finish a paid Checkout first, then open it from a signed-in account.",
          ],
        },
      ],
    },
    "ai-credits": {
      title: "Voice transcription and Pinar Cloud AI credits",
      summary: "Know how voice recordings reserve, spend, purchase, or refund Pinar Cloud credits.",
      sections: [
        {
          heading: "Voice transcription cost",
          paragraphs: [
            "Pinar Cloud voice transcription is the only Pinar feature that consumes AI credits. A recording up to 60 seconds reserves 1 credit; a recording from 61 to 120 seconds reserves 2. On success, the reservation is consumed. A failed transcription refunds it, and a reservation left unsettled for more than five minutes is refunded automatically.",
            "Recording a reproduction timeline and generating its written steps do not debit AI credits. Local AI and BYOK also never use the Pinar Cloud balance.",
          ],
        },
        {
          heading: "Balances",
          paragraphs: [
            "The account’s first Pro subscription grants 500 credits once. Renewing, canceling and reactivating, or changing plans does not grant them again. Purchased Pinar Cloud packs add 500 credits and last up to 12 months.",
          ],
        },
        {
          heading: "Retry voice transcription and read the ledger",
          paragraphs: [
            "In Pinar Cloud, if a transcription is already in progress, wait for it to finish instead of sending the recording again. Failed requests refund the reservation when possible. If the balance is too low, the extension keeps the typed comment and reports that more credits are required.",
            "The soonest-expiring balance is used first. The account menu shows the remaining credits; there is no monthly or annual refill.",
          ],
          bullets: [
            "If a transcription is already running, wait for it to finish instead of sending the same recording again.",
            "If a reservation expires or is refunded, record or send the voice comment again.",
            "If the workspace shows zero credits, check the remaining balance before buying another 500-credit pack.",
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
            "Hosted cloud quota is the storage the signed-in account currently includes, plus any still-active add-on. Pro includes 2 GB. Optional 1 GB and 5 GB storage add-ons last 12 months, with reminder emails before expiry. If an add-on expires above the remaining quota, uploads pause; overage gets 30 days of grace and remains recoverable until day 90 before becoming eligible for deletion. Whether an add-on can be bought is part of the current offer; check the Plans page and the account entitlements.",
          ],
        },
        {
          heading: "After entitlement expiry",
          paragraphs: [
            "Storage add-on expiry lowers the quota and can block new uploads, but it does not schedule automatic deletion. Subscription cancellation follows the separate paid-retention recovery policy described below.",
          ],
        },
        {
          heading:
            "Fit replacements under quota and use the 90-day recovery clock",
          paragraphs: [
            "Quota is your plan’s included storage plus any still-active add-on. Replacing a larger screenshot with a smaller one can succeed when a brand-new capture would not. Uploads pause once the account is at or above quota, including during grace and recovery.",
            "Cloud sessions already stored on a Free entitlement and not marked permanent become eligible for cleanup after 30 days. Pro content above the Free quota follows the 30-day grace and 90-day recovery window after paid eligibility ends. Local-only history on this computer is never deleted remotely. Eligibility is not a promise of immediate removal.",
          ],
          bullets: [
            "When new captures pause, free space by deleting sessions or replacing a heavy screenshot. Buy a 1 GB or 5 GB twelve-month add-on only when the Plans page and the account entitlements show that purchase.",
            "If the account is in grace or recovery, export anything you still need before day 90; eligibility only marks overage, it does not itself delete.",
            "Do not expect uninstalling the desktop app to purge cloud objects, and do not expect the cloud to erase local history on this computer.",
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
            "Each session, project, or collection has an unlisted page and a Markdown copy. Copy Markdown puts that text on the clipboard, and each session card opens its own viewer. A missing or invalid link shows a not-found page rather than owner email, plan, or other account fields.",
            "Session Markdown includes the handoff bundle plus agent results and pin reviews. Project and collection Markdown list every nested session with page URL, pin comments, `pinId`, and locators. Screenshot lines appear only when the owner allows screenshot delivery. Anyone who can open the link can copy what they see, so an unlisted URL is not authorization.",
          ],
          bullets: [
            "Before sending a project or collection link, open Copy Markdown once and check that every nested session, pin comment, and screenshot line is safe to publish.",
            "Turn off screenshot delivery on the owner account if the shared Markdown should keep image URLs out.",
            "If a shared path shows not found, treat the link as gone or invalid; that page does not add private account details.",
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
            "Local screenshots and history stay on this computer. Browser preferences such as view, language, theme, and delivery settings stay in this browser unless a signed-in feature explicitly syncs them.",
          ],
        },
        {
          heading: "Cloud boundary",
          paragraphs: [
            "Cloud account records, capture metadata, and images are stored in the hosted service. Stripe processes billing, and the email service sends login codes. The Subprocessors page is the current list of external service roles.",
          ],
        },
        {
          heading: "Confirm which store actually holds each capture",
          paragraphs: [
            "Local screenshots are stored as PNG files, and session history stays on this computer. Theme is a browser-only preference on the Interface tab. Language and Capture delivery switches live in the same settings dialog; a signed-in cloud account can keep those delivery choices in the hosted workspace.",
            "Hosted captures keep metadata and images in the cloud service. Unlisted viewers and Markdown copies are available without a workspace session. Email sign-in codes expire, and the form does not reveal whether an account exists. The Subprocessors page names the current hosted providers, and Pinar does not receive full card details. Current policy versions are published on the legal pages.",
          ],
          bullets: [
            "If local history cannot open, Pinar recovers a usable catalog on this computer instead of crashing.",
            "Open a hosted screenshot from its share page or Markdown viewer; a missing image shows not found rather than account details.",
            "In settings, confirm Interface theme locally, then distinguish Capture delivery switches from cloud-synced delivery choices when signed in.",
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
            "Pinar redacts password, payment, token, and one-time-code fields, then cleans the page URL. Known secret-looking query values are replaced with [redacted]. Extra names you add in settings are included. Matching substrings are also removed from title, description, URL, and pins.",
            "The copied visual-context block keeps `captureId` even if the rest of the payload cannot be parsed. Inline screenshot bytes are dropped from the text bundle so the copy keeps a file path or viewer URL instead. If some regions could not be inspected, the paste includes a privacy warning.",
          ],
          bullets: [
            "After a copy, read the privacy warnings in the paste; some regions may be marked as not inspected.",
            "Add extra query-key names as comma-, space-, or semicolon-separated tokens; matching is case-insensitive.",
            "If pasted handoff JSON still contains a data: screenshot URL, recapture so the text bundle keeps a path or viewer URL instead.",
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
            "The local workspace only accepts the Pinar application and the official extension. Rotation keeps the previous secret valid long enough for running processes to catch up; revocation forces a new authorization.",
            "If another Pinar instance is already running, that instance stays in place. Nested screenshot folders are migrated without overwriting name conflicts. If local history cannot open, Pinar recovers a usable Personal project and Inbox instead of crashing.",
          ],
          bullets: [
            "Keep using the official extension and the Pinar application; other sites cannot talk to the local workspace.",
            "After you revoke local access, restart Pinar so the workspace can authorize again.",
            "If local history cannot open, expect a recovered Personal project and Inbox rather than a crash.",
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
            "Loop metrics stay off unless you opt in. When enabled, only operational events are sent. Comments, titles, URLs, selectors, screenshots, and similar content are rejected.",
            "Checkout and remote Free registration record accepted policy versions. Terms, Privacy, Acceptable Use, Retention, Refunds, Fair Source, and Subprocessors are published at https://pinar.dev/legal/. Local-only use that never contacts the hosted service needs no hosted account. Questions go to contact@pinar.dev or contato@pinar.dev.",
          ],
          bullets: [
            "Leave loop metrics disabled unless you intend to opt in; a disabled setting does not transmit a batch.",
            "Before hosted persistence or checkout, open Terms, Privacy, and Acceptable Use from https://pinar.dev/legal/terms, /privacy, and /acceptable-use.",
            "Treat the published license as controlling for Fair Source limits; the hosted subprocessors currently named are Cloudflare and Stripe.",
          ],
        },
      ],
    },
  },
} satisfies HelpLocale;

export default locale;
