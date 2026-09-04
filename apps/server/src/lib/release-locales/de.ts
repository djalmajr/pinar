import type { ReleaseLocale } from "../release-content";

const locale = {
  ui: {
    allReleases: "Alle Versionen",
    backToReleases: "Zurück zu den Versionen",
    firstRelease: "Dies ist die erste Version",
    historyDescription:
      "Öffnen Sie den Verlauf, um jedes veröffentlichte Tag zu sehen.",
    latestRelease: "Sie sind auf dem neuesten Stand",
    metaDescription: "Offizielle Hinweise zu jeder getaggten Pinar-Version.",
    next: "Weiter",
    pageDescription:
      "Jeder Hinweis entspricht einem veröffentlichten Repository-Tag, ohne unveröffentlichte Arbeit zu vermischen.",
    pageTitle: "Neuigkeiten in Pinar",
    previous: "Zurück",
    releaseNavigation: "Versionsnavigation",
    releaseNotFound: "Version nicht gefunden",
    releaseNotFoundDescription:
      "Diese Version steht nicht im veröffentlichten Verlauf.",
    viewDetails: "Details anzeigen",
    whatChanged: "Was sich geändert hat",
  },
  releases: {
    "v0.3.4": {
      title: "Richtlinien gelten mit dem Fortfahren",
      summary:
        "Zahlen auf Plans oder das Bestätigen eines Konto-Codes akzeptiert die aktuellen Nutzungsbedingungen, die Datenschutzerklärung und die zulässige Nutzung. Es gibt keinen Extra-Dialog.",
      changes: {
        "checkout-policy-acceptance": {
          title: "Zahlen bedeutet zustimmen",
          description:
            "Ein bezahlter Checkout auf Plans speichert die aktuellen Nutzungsbedingungen, die Datenschutzerklärung und die zulässige Nutzung. Der Extra-Dialog entfällt.",
        },
        "sign-in-policy-acceptance": {
          title: "Anmelden bedeutet zustimmen",
          description:
            "Die Bestätigung des Konto-E-Mail-Codes speichert dieselben aktuellen Richtlinien. Der Extra-Annahme-Schritt entfällt. Remote-Free akzeptiert weiterhin in den Erweiterungsoptionen.",
        },
      },
    },
    "v0.3.3": {
      title: "Lokales Kontomenü und Free ohne KI",
      summary:
        "Der lokale Workspace nutzt dasselbe Konto-Popover wie Free. Die Startseite liegt in diesem Menü, und Free enthält keine KI-Guthaben und keine Zusammenfassungen mehr.",
      changes: {
        "local-account-menu": {
          title: "Lokales Kontomenü",
          description:
            "Die Fußzeile des lokalen Workspace öffnet jetzt dasselbe Konto-Popover wie Free. Die Startseite liegt im Menü. Abmelden entfällt lokal, weil es keine Cloud-Sitzung zum Beenden gibt.",
        },
        "free-without-ai": {
          title: "Free ohne KI",
          description:
            "Free vergibt keine KI-Guthaben mehr und zeigt keine KI-Zusammenfassung. Zusammenfassungen bleiben bei Pro, Founder und Lifetime. Pläne und Hilfe spiegeln diese Grenze.",
        },
      },
    },
    "v0.3.2": {
      title: "Vollständiger Windows-Installer",
      summary:
        "Der Windows-Download ist jetzt das vollständige Setup-ZIP. Entpacken und Pinar-Setup.exe neben dem Ordner .installer ausführen.",
      changes: {
        "windows-setup-zip": {
          title: "Vollständiges Windows-Setup-ZIP",
          description:
            "GitHub Releases veröffentlicht jetzt win-x64-Pinar-Setup.zip mit Pinar-Setup.exe und dem .installer-Payload. Die 1,2-MB-Stub-EXE wird nicht mehr gelistet, weil sie allein nicht installiert.",
        },
        "windows-help-links": {
          title: "Windows-Installationslinks",
          description:
            "Hilfe und Optionen laden das ZIP. Nach dem Entpacken den Ordner .installer neben Pinar-Setup.exe belassen und SmartScreen mit Weitere Informationen und Trotzdem ausführen umgehen, falls Windows ihn zeigt.",
        },
      },
    },
    "v0.3.1": {
      title: "Windows-App und eigene Hilfe-Titelbilder",
      summary:
        "Starte Pinar über den Infobereich unter Windows, lade den Setup-Installer herunter und öffne Hilfeartikel mit jeweils eigenem Titelbild.",
      changes: {
        "windows-desktop-app": {
          title: "Windows-Desktop-App",
          description:
            "Pinar liefert jetzt eine Infobereich-App für Windows. Laden Sie win-x64-Pinar-Setup.exe herunter, führen Sie den Installer aus und starten Sie den lokalen Helfer über den Infobereich — denselben lokalen Aufnahmeablauf wie unter macOS.",
        },
        "unique-help-covers": {
          title: "Eigene Hilfe-Titelbilder",
          description:
            "Jeder der 27 Hilfeartikel hat jetzt ein eigenes Titelbild, sodass Installations-, Erste-Aufnahme-, Tastaturkürzel- und Abrechnungsanleitungen nicht mehr dasselbe Screenshot teilen.",
        },
        "windows-first-run-help": {
          title: "Hilfe beim ersten Start unter Windows",
          description:
            "Die Installationsanleitung erklärt jetzt, wie Sie den SmartScreen-Hinweis beim ersten Start umgehen: „Weitere Informationen“ öffnen und „Trotzdem ausführen“ wählen.",
        },
      },
    },
    "v0.3.0": {
      title: "Übersichtlicher Arbeitsbereich und Aufnahmeablauf",
      summary: "Organisiere wachsende Sammlungen, passe Pinar zentral an und prüfe jede Aufnahme mit klarerem visuellem Feedback und besserer Hilfe.",
      changes: {
        "workspace-organization": { title: "Organisation des Arbeitsbereichs", description: "Verschachtelte Sammlungen unterstützen größere Bibliotheken mit klarerer Hierarchie, anpassbarer Navigation, kompakten Bedienelementen und Sammlungskontext in der Gesamtansicht." },
        "global-settings": { title: "Globale Einstellungen", description: "Ein eigener Bereich bündelt allgemeine Einstellungen sowie Aufnahme, Datenschutz, Oberfläche, Design und Kopierdetails in einer einheitlichen Bedienung." },
        "capture-feedback": { title: "Klareres Aufnahmefeedback", description: "Auswahlmaße, fokussierte Pin-Kommentare, Bildvorschauen, ausgeblendete Bereiche und Speicherfortschritt machen den Aufnahmeablauf flüssiger und vorhersehbarer." },
        "help-center": { title: "Verbesserte Hilfe", description: "Installations- und Erste-Schritte-Anleitungen sind kürzer und klarer, Bilder öffnen sich mit Zoom und lange Artikel markieren den sichtbaren Abschnitt." },
      },
    },
    "v0.2.0": {
      title: "Aufnahme-Stapel und synchronisierte Einstellungen",
      summary:
        "Fasse Aufnahmen mehrerer Seiten zu einem Prompt zusammen, halte alle Einstellungen auf dem Server und nutze Pinar durchgehend in sieben Sprachen.",
      changes: {
        "capture-batches": {
          title: "Aufnahme-Stapel",
          description:
            "Alt+Umschalt+B fasst die nächsten Aufnahmen zusammen; erneut drücken schließt ab und kopiert sie als einen Prompt. Stapel liegen in einem Ordner der Seitenleiste; Alt+Umschalt+X oder das Symbolmenü schließt einen ohne Kopieren.",
        },
        "server-preferences": {
          title: "Einstellungen auf dem Server",
          description:
            "Aufnahmeziel, Stapelkopie, Handoff-Form, verborgene URL-Schlüssel und Sprache liegen auf dem Server und bleiben mit der Erweiterung synchron. Die Einstellungen erhalten Abschnitte für Aufnahme, Handoff und Datenschutz.",
        },
        "localized-everywhere": {
          title: "Sieben Sprachen überall",
          description:
            "Toolbar, Symbolmenü und der an den Agenten übergebene Prompt folgen der gewählten Sprache, zusammen mit Arbeitsbereich und Optionen.",
        },
        "progress-toolbar": {
          title: "Fortschritt in der Toolbar",
          description:
            "Cmd+Enter macht die Toolbar zur Fortschrittsanzeige - speichern, fertig oder Fehler - und der Screenshot-Verschluss dauert nur noch zwei Frames. Das Abschließen eines Stapels meldet sein Ergebnis als Benachrichtigung.",
        },
        "about-and-versioning": {
          title: "Über und eine Version",
          description:
            "Einstellungen > Über zeigt, was Pinar ist, seine Version und die Versionshinweise. Eine Produktversion bestimmt App, Website und Tags; Produktions-Builds entstehen nur aus einem Release-Tag.",
        },
      },
    },
    "v0.1.5": {
      title: "Zuverlässiger Start bei der Anmeldung",
      summary:
        "Pinar.app bewahrt die bestehende macOS-Login-Konfiguration, ohne den Agenten unnötig neu zu laden.",
      changes: {
        "idempotent-login-setup": {
          title: "Idempotente Login-Einrichtung",
          description:
            "Die Tray-App prüft, ob der LaunchAgent bereits existiert, bevor sie ihn konfiguriert, und vermeidet so einen zweiten Start durch RunAtLoad.",
        },
        "preference-preserved": {
          title: "Einstellung bleibt erhalten",
          description:
            "Die gespeicherte Einstellung Start at Login bleibt unverändert, ohne Unload-/Reload-Zyklen beim normalen Start.",
        },
      },
    },
    "v0.1.4": {
      title: "Serialisierter macOS-Tray-Start",
      summary:
        "Gleichzeitig laufende Agent-Hooks können keine doppelten Pinar.app-Instanzen oder Geister-Kacheln im Dock mehr erzeugen.",
      changes: {
        "single-app-instance": {
          title: "Eine App-Instanz",
          description:
            "Eine atomare PID-Sperre lässt die laufende Tray-App die Kontrolle behalten, während ein doppelter Start sauber beendet wird.",
        },
        "coordinated-hooks": {
          title: "Koordinierte Hooks",
          description:
            "Sitzungs-Hooks und der Installer serialisieren jetzt den Tray-Start und warten auf Bereitschaft, statt sich gegenseitig zu überholen.",
        },
      },
    },
    "v0.1.3": {
      title: "Präzisere Konto- und iframe-Aufnahmeabläufe",
      summary:
        "Kontoverwaltung, iframe-Zielauswahl, Upload-Deduplizierung, öffentliche Navigation und Schutz vor doppeltem Tray-Start wurden gemeinsam verfeinert.",
      changes: {
        "nested-iframe-locators": {
          title: "Locator in verschachtelten iframes",
          description:
            "Erfasste DOM-Pfade bewahren jetzt jede Frame-Grenze, sodass Pins in verschachtelten iframes genauer gefunden werden.",
        },
        "single-flight-uploads": {
          title: "Single-Flight-Uploads",
          description:
            "Wiederholte Aufnahme-Anfragen teilen sich einen laufenden Upload und verhindern so doppelte Sitzungen und Upload-Wettläufe.",
        },
        "account-clarity": {
          title: "Klarere Kontoansicht",
          description:
            "Der Kontobildschirm der Erweiterung macht Plan, Speicher, Abrechnung und den Status der rechtlichen Zustimmung leichter verständlich und steuerbar.",
        },
        "duplicate-launch-guard": {
          title: "Schutz vor doppeltem Start",
          description:
            "Agent-Sitzungs-Hooks erkennen eine bereits laufende macOS-Tray-App, bevor sie eine weitere Instanz öffnen.",
        },
      },
    },
    "v0.1.2": {
      title: "Pinar.app für macOS",
      summary:
        "Die lokale Pinar-Erfahrung liegt jetzt in einer nativen Menüleisten-App mit eingebettetem Helper, Login-Steuerung und Updates über GitHub.",
      changes: {
        "native-menu-bar-app": {
          title: "Native Menüleisten-App",
          description:
            "Öffnen Sie den Workspace, starten oder stoppen Sie den lokalen Server, prüfen Sie den aktiven Port und steuern Sie Start at Login direkt aus Pinar.app.",
        },
        "bundled-local-helper": {
          title: "Mitgelieferter lokaler Helper",
          description:
            "Die App legt das lokale Pinar-Verzeichnis an, startet den Helper und registriert unterstützte KI-Agent-Hooks, ohne einen separaten Daemon zu installieren.",
        },
        "automatic-updates": {
          title: "Automatische Updates",
          description:
            "Die App prüft signierte Artefakte aus GitHub Releases und lehnt versehentliche Downgrades ab.",
        },
        "unified-macos-installer": {
          title: "Einheitlicher macOS-Installer",
          description:
            "Der öffentliche Installer lädt Pinar.app jetzt herunter, installiert und startet sie als unterstütztes lokales Produkt unter macOS.",
        },
      },
    },
    "v0.1.1": {
      title: "Visuelle Aufnahme, Cloud-Workspace und Founder",
      summary:
        "Die erste getaggte Produktversion verband Browser-Annotationen mit lokalen und Cloud-Workspaces, KI-Agent-Handoffs, Teilen, Plänen und Datenschutzsteuerungen.",
      changes: {
        "element-and-area-capture": {
          title: "Element- und Bereichsaufnahme",
          description:
            "Pinnen Sie ein oder mehrere DOM-Elemente oder freie Bereiche, schreiben Sie Kommentare, erfassen Sie Screenshots und kopieren Sie ein strukturiertes Paket aus Chrome.",
        },
        "local-helper-and-agent-hooks": {
          title: "Lokaler Helper und Agent-Hooks",
          description:
            "Ein Loopback-Helper speichert Screenshots und Verlauf, während installierte Sitzungs-Hooks unterstützte Coding-Agenten bereithalten, Pinar-Kontext zu empfangen.",
        },
        "cloud-workspace-and-sharing": {
          title: "Cloud-Workspace und Teilen",
          description:
            "Passwortlose Konten, Projekte, verschachtelte Sammlungen, Aufnahme-Viewer sowie nicht gelistete Links für Sitzung, Projekt und Sammlung kamen gemeinsam.",
        },
        "plans-ai-and-storage": {
          title: "Pläne, KI und Speicher",
          description:
            "Free, Pro und begrenzter Founder-Zugang führten Cloud-Aufbewahrung, Speicherkontingente, KI-Zusammenfassungen, Abonnements und optionale Credit- oder Speicherpakete ein.",
        },
        "privacy-and-legal-controls": {
          title: "Datenschutz und rechtliche Steuerungen",
          description:
            "Schwärzung sensibler Felder, manuelle Masken, versionierte Zustimmung und veröffentlichte Dienstrichtlinien zogen die Sicherheitsgrenze der Cloud.",
        },
      },
    },
  },
} satisfies ReleaseLocale;

export default locale;
