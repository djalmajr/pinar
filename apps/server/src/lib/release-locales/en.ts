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
