import type { ReleaseLocale } from "../release-content";

const locale = {
  ui: {
    allReleases: "All releases",
    backToReleases: "Back to releases",
    firstRelease: "This is the first release",
    historyDescription: "Open the history to see every published tag.",
    latestRelease: "You’re on the latest",
    metaDescription: "Official notes for every tagged Pinar release.",
    next: "Next",
    pageDescription:
      "Every note maps to a published repository tag, without mixing in unreleased work.",
    pageTitle: "What’s new in Pinar",
    previous: "Previous",
    releaseNavigation: "Release navigation",
    releaseNotFound: "Release not found",
    releaseNotFoundDescription: "This release is not in the published history.",
    viewDetails: "View details",
    whatChanged: "What changed",
  },
  releases: {
    "v0.3.3": {
      title: "Local account menu and Free without AI",
      summary:
        "The local workspace uses the same account popover as Free. Homepage lives in that menu, and Free no longer includes AI credits or summaries.",
      changes: {
        "local-account-menu": {
          title: "Local account menu",
          description:
            "The local workspace footer now opens the same account popover as Free. Homepage is inside the menu. Sign out is hidden on local, because there is no cloud session to leave.",
        },
        "free-without-ai": {
          title: "Free has no AI",
          description:
            "Free no longer grants AI credits or shows AI summary. Summaries stay on Pro, Founder, and Lifetime. Plans and help copy match that limit.",
        },
      },
    },
    "v0.3.2": {
      title: "Complete Windows installer",
      summary:
        "The Windows download is now the full Setup zip. Extract it and run Pinar-Setup.exe next to the .installer folder.",
      changes: {
        "windows-setup-zip": {
          title: "Complete Windows Setup zip",
          description:
            "GitHub Releases now publish win-x64-Pinar-Setup.zip, with Pinar-Setup.exe and the .installer payload together. The 1.2 MB stub exe is no longer listed, because it cannot install on its own.",
        },
        "windows-help-links": {
          title: "Windows install links",
          description:
            "Help and Options download the zip. After extracting, keep the .installer folder beside Pinar-Setup.exe, then continue past SmartScreen if Windows shows it.",
        },
      },
    },
    "v0.3.1": {
      title: "Windows app and unique help covers",
      summary:
        "Run Pinar from the Windows notification area, download the Setup installer, and open help articles that each have their own cover.",
      changes: {
        "windows-desktop-app": {
          title: "Windows desktop app",
          description:
            "Pinar now ships a Windows tray application. Download win-x64-Pinar-Setup.exe, run the installer, and start the local helper from the notification area — the same local capture flow as on macOS.",
        },
        "unique-help-covers": {
          title: "Unique help covers",
          description:
            "Each of the 27 help articles now has its own cover image, so guides such as install, first capture, shortcuts, and billing no longer share a screenshot.",
        },
        "windows-first-run-help": {
          title: "Windows first-run help",
          description:
            "The install guide now tells Windows users how to continue past the first-run SmartScreen block: open “More info”, then choose “Run anyway”.",
        },
      },
    },
    "v0.3.0": {
      title: "A clearer workspace and capture flow",
      summary:
        "Organize growing collections, tune Pinar from one settings area, and review every capture with clearer visual feedback and help.",
      changes: {
        "workspace-organization": {
          title: "Workspace organization",
          description:
            "Nested collections now scale to larger libraries with clearer hierarchy, resizable navigation, compact controls, and collection context in the all-items view.",
        },
        "global-settings": {
          title: "Global settings",
          description:
            "A dedicated settings area brings general, capture, privacy, interface, theme, and copy-detail preferences together in a consistent experience.",
        },
        "capture-feedback": {
          title: "Clearer capture feedback",
          description:
            "Selection dimensions, focused pin comments, image previews, hidden-region handling, and save progress now provide a smoother and more predictable capture flow.",
        },
        "help-center": {
          title: "Improved help center",
          description:
            "Installation and first-capture guides are shorter and clearer, screenshots open in a zoomable preview, and long articles highlight the section currently in view.",
        },
      },
    },
    "v0.2.0": {
      title: "Capture batches and synced preferences",
      summary:
        "Group captures across pages into one prompt, keep every preference on the server, and use Pinar in seven languages end to end.",
      changes: {
        "capture-batches": {
          title: "Capture batches",
          description:
            "Press Alt+Shift+B to group the next captures; press again to finish and copy them as one prompt. Batches live in a folder in the sidebar, and Alt+Shift+X or the icon menu closes one without copying.",
        },
        "server-preferences": {
          title: "Preferences on the server",
          description:
            "Capture destination, batch copy, handoff shape, hidden URL keys and language live on the server and stay in sync with the extension. Settings gained Capture, Handoff and Privacy sections.",
        },
        "localized-everywhere": {
          title: "Seven languages everywhere",
          description:
            "The toolbar, the icon menu and the prompt handed to the agent follow the language you chose, alongside the workspace and Options.",
        },
        "progress-toolbar": {
          title: "Progress in the toolbar",
          description:
            "Cmd+Enter turns the toolbar into a progress bar - saving, done, or the error - and the screenshot shutter is now two frames. Finishing a batch reports its outcome as a notification.",
        },
        "about-and-versioning": {
          title: "About and one version",
          description:
            "Settings > About shows what Pinar is, its version and release notes. One product version drives the app, the site and the tags, and production builds come only from a release tag.",
        },
      },
    },
    "v0.1.5": {
      title: "Reliable launch at login",
      summary:
        "Pinar.app now preserves the existing macOS login configuration without needlessly reloading the agent.",
      changes: {
        "idempotent-login-setup": {
          title: "Idempotent login setup",
          description:
            "The tray checks whether its LaunchAgent already exists before configuring it, avoiding a second RunAtLoad launch.",
        },
        "preference-preserved": {
          title: "Preference preserved",
          description:
            "The saved Start at Login preference remains intact without unload/reload churn during normal startup.",
        },
      },
    },
    "v0.1.4": {
      title: "Serialized macOS tray startup",
      summary:
        "Concurrent agent hooks can no longer create duplicate Pinar.app instances or ghost Dock tiles.",
      changes: {
        "single-app-instance": {
          title: "Single app instance",
          description:
            "An atomic PID lock lets the running tray keep ownership while a duplicate launch exits cleanly.",
        },
        "coordinated-hooks": {
          title: "Coordinated hooks",
          description:
            "Session hooks and the installer now serialize tray startup and wait for readiness instead of racing one another.",
        },
      },
    },
    "v0.1.3": {
      title: "Sharper account and iframe capture flows",
      summary:
        "Account management, iframe targeting, upload deduplication, public navigation, and tray launch protection were polished together.",
      changes: {
        "nested-iframe-locators": {
          title: "Nested iframe locators",
          description:
            "Captured DOM paths now preserve each frame boundary, allowing pins inside nested iframes to be located more precisely.",
        },
        "single-flight-uploads": {
          title: "Single-flight uploads",
          description:
            "Repeated capture requests share one in-flight upload, preventing duplicate sessions and upload races.",
        },
        "account-clarity": {
          title: "Account clarity",
          description:
            "The extension account screen now makes plan, storage, billing, and legal-consent state easier to understand and manage.",
        },
        "duplicate-launch-guard": {
          title: "Duplicate launch guard",
          description:
            "Agent session hooks detect an already-running macOS tray before attempting to open another instance.",
        },
      },
    },
    "v0.1.2": {
      title: "Pinar.app for macOS",
      summary:
        "The local Pinar experience moved into a native menu-bar app with an embedded helper, login control, and GitHub-based updates.",
      changes: {
        "native-menu-bar-app": {
          title: "Native menu-bar app",
          description:
            "Open the workspace, start or stop the local server, inspect its active port, and control Start at Login from Pinar.app.",
        },
        "bundled-local-helper": {
          title: "Bundled local helper",
          description:
            "The app creates the local Pinar directory, runs the helper, and registers supported AI-agent hooks without a separate daemon install.",
        },
        "automatic-updates": {
          title: "Automatic updates",
          description:
            "The app checks signed artifacts published through GitHub Releases and refuses accidental downgrades.",
        },
        "unified-macos-installer": {
          title: "Unified macOS installer",
          description:
            "The public installer now downloads, installs, and launches Pinar.app as the supported local product on macOS.",
        },
      },
    },
    "v0.1.1": {
      title: "Visual capture, cloud workspace, and Founder",
      summary:
        "The first tagged product release connected browser annotations to local and cloud workspaces, AI-agent handoffs, sharing, plans, and privacy controls.",
      changes: {
        "element-and-area-capture": {
          title: "Element and area capture",
          description:
            "Pin one or many DOM elements or freeform areas, write comments, capture screenshots, and copy a structured bundle from Chrome.",
        },
        "local-helper-and-agent-hooks": {
          title: "Local helper and agent hooks",
          description:
            "A loopback helper stores screenshots and history, while installed session hooks keep supported coding agents ready to receive Pinar context.",
        },
        "cloud-workspace-and-sharing": {
          title: "Cloud workspace and sharing",
          description:
            "Passwordless accounts, projects, nested collections, capture viewers, and unlisted session, project, and collection links arrived together.",
        },
        "plans-ai-and-storage": {
          title: "Plans, AI, and storage",
          description:
            "Free, Pro, and limited Founder access introduced cloud retention, storage quotas, AI summaries, subscriptions, and optional credit or storage packs.",
        },
        "privacy-and-legal-controls": {
          title: "Privacy and legal controls",
          description:
            "Sensitive-field redaction, manual masks, versioned consent, and published service policies established the cloud safety boundary.",
        },
      },
    },
  },
} satisfies ReleaseLocale;

export default locale;
