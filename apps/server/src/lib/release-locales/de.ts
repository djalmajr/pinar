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
      "Jeder Hinweis gehört zu einer veröffentlichten oder für die nächste Veröffentlichung vorbereiteten Version, ohne themenfremde Arbeit zu vermischen.",
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
    "v0.7.1": {
      title: "Ein stabileres Pinar-Infobereichssymbol unter Windows",
      summary:
        "Das Windows-Infobereichssymbol startet nach einem erzwungenen Beenden wieder, beendet sich schneller, arbeitet weniger im Hintergrund und ersetzt sich selbst, bevor das Speicherwachstum seiner Laufzeit den Rechner ausbremst.",
      changes: {
        "tray-reliability": {
          title: "Das Symbol startet immer und beendet sich schneller",
          description:
            "Nach dem Beenden über den Task-Manager konnte Pinar den Neustart verweigern, bis eine Sperrdatei von Hand gelöscht wurde; jetzt erkennt es, dass die alte Instanz nicht mehr läuft. Beenden über das Menü wartet nicht mehr auf Hintergrund-Timer, und das Symbol baut sein Menü nicht mehr alle zwei Sekunden neu auf und liest die Einstellung zum Start mit Windows nicht mehr ständig neu ein.",
        },
        "tray-memory-guard": {
          title: "Schutz vor dem Speicherwachstum des Symbols",
          description:
            "Die Desktop-Laufzeit unter dem Symbol reserviert auch im Leerlauf weiter Speicher. Bis das upstream behoben ist, prüft das Symbol alle fünf Minuten seinen eigenen Speicher und ersetzt sich oberhalb von 2 GB unauffällig durch eine neue Instanz. Der lokale Server läuft weiter, Aufnahmen und Agenten werden nicht unterbrochen.",
        },
      },
    },
    "v0.7.0": {
      title: "Lokale KI mit Sprache, ein Weg in die Pinar Cloud und ein klareres Aufnahmeziel",
      summary:
        "Pinar Local nutzt KI wieder über deinen eigenen OpenAI-kompatiblen Endpunkt, jetzt mit Sprachkommentaren. Du kannst deine lokale Arbeit in die Pinar Cloud mitnehmen, in einem einzigen Menü wählen, wo Aufnahmen landen, und sehen, warum ein Anmeldecode nicht angekommen ist.",
      changes: {
        "local-ai-voice": {
          title: "Lokale KI und BYOK mit Sprachkommentaren",
          description:
            "Einstellungen → KI in Pinar Local verbindet einen lokalen Server oder deinen eigenen OpenAI-kompatiblen Anbieter; der Schlüssel liegt im Tresor des Systems. Mit einem Transkriptionsmodell nimmt die Erweiterung im lokalen Modus Sprachkommentare auf, und der lokale Server transkribiert sie und macht daraus auf Wunsch einen Kommentar mit Akzeptanzkriterien. Es werden keine Pinar-Guthaben verbraucht.",
        },
        "local-to-cloud-import": {
          title: "Lokale Arbeit in die Pinar Cloud mitnehmen",
          description:
            "Einstellungen → Daten exportiert Projekte, Sammlungen, Stapel, Sitzungen und Screenshots aus Pinar Local in eine Datei. In der Pinar Cloud importiert derselbe Bereich sie Sitzung für Sitzung, mit Fortschritt und Abbrechen-Schaltfläche. Ein erneuter Import derselben Datei aktualisiert das bereits Importierte, statt es zu duplizieren.",
        },
        "capture-destination-picker": {
          title: "Das Aufnahmeziel in einem einzigen Menü wählen",
          description:
            "Die App und die Optionen der Erweiterung wählen mit einem einzigen Kaskadenmenü, wo neue Aufnahmen landen: zuerst das Projekt, dann die Sammlung, mit Suche, Symbolen und dem gewählten Pfad im Feld. Die Auswahl bleibt zwischen Erweiterung und Server synchron.",
        },
        "sign-in-delivery-errors": {
          title: "Klare Fehler, wenn ein Code nicht gesendet werden kann",
          description:
            "Wenn die Anmelde-E-Mail nicht zugestellt werden kann, sagt Pinar das jetzt in deiner Sprache, statt anzuzeigen, dass ein Code gesendet wurde. Die Antwort ist gleich, ob die Adresse ein Konto hat oder nicht.",
        },
        "windows-desktop": {
          title: "Stabileres Pinar unter Windows",
          description:
            "Die Windows-App startet den lokalen Server über das Infobereichssymbol, berücksichtigt den Start mit Windows, installiert die Sitzungs-Hooks der Agenten und öffnet beim Lesen des KI-Schlüssels kein PowerShell-Fenster mehr.",
        },
      },
    },
    "v0.6.0": {
      title: "MCP-Verwaltung, fokussierte Übergabe und klarerer Pin-Dialog",
      summary:
        "Agenten verwalten jetzt Projekte, Sammlungen, Chargen, Sitzungen, Pins und Kommentare über MCP — lokal ohne Konto, in der Cloud mit Schlüsselberechtigung. Standardmäßig enthält die kompakte Übergabe beim Beenden einer Sitzung nur die Pins, die noch Arbeit brauchen, und der Pin-Dialog im Viewer verzichtet auf die technischen Registerkarten.",
      changes: {
        "mcp-crud": {
          title: "Vollständige MCP-Verwaltung für Sitzungen und Organisation",
          description:
            "Agenten können Projekte, Sammlungen, Chargen, Sitzungen, Pins und Pin-Kommentare über MCP erstellen, lesen, ändern und löschen. Pinar Local bietet diese Operationen Agenten auf demselben Rechner ohne Konto und ohne Schlüssel an; Pinar Cloud wendet bei jeder Operation Berechtigung und Umfang des Schlüssels an.",
        },
        "focused-handoff": {
          title: "Fokussierte Übergabe, vollständiges Detail auf Abruf",
          description:
            "Standardmäßig enthält die kompakte Übergabe beim Beenden einer Sitzung nur die Pins, die noch Arbeit brauchen, mit dem Seitenkontext zum Arbeiten; das vollständige Sitzungsdetail bleibt über die Links der Übergabe erreichbar. Mit Prompt wird der Text kopiert, mit Link nur der Sitzungslink und mit Off wird nichts kopiert. Pin-Notizen und Gesprächskommentare bleiben editierbar, nach den gleichen Regeln wie im Viewer lokal und in der Cloud.",
        },
        "viewer-technical-tabs-removed": {
          title: "Klarerer Pin-Dialog ohne technische Registerkarten",
          description:
            "Der Pin-Dialog im Viewer bietet die technischen Registerkarten nicht mehr an. Der Pin-Kontext wird jetzt direkt in der Vorschau angezeigt, und die Gesprächsregisterkarte öffnet zuerst und hält Kommentare, Belege und Änderungen zusammen.",
        },
      },
    },
    "v0.5.1": {
      title: "Cloud-Zugriff für Agenten und klarere Pin-Prüfungen",
      summary:
        "Pro-Konten können Agenten bereichsgebundene Cloud-Schlüssel bereitstellen und manuell konfigurierte MCP-Operationen nutzen. Der Viewer bündelt Pin-Unterhaltungen und Prüfaktionen und bietet klarere Freigabesteuerung.",
      changes: {
        "cloud-agent-access": {
          title: "Bereichsgebundene Schlüssel für Agenten",
          description:
            "Konten von Pinar Cloud Pro können persönliche Agentenschlüssel mit Ressourcenbereich, Berechtigung und Ablaufdatum erstellen, deren Status und letzte Verwendung einsehen und sie widerrufen. Schlüssel, deren Berechtigung Lesezugriff umfasst, können private Markdown-Inhalte und Bilder innerhalb ihres Bereichs lesen. Pinar Local stellt diese Schlüssel nicht aus.",
        },
        "agent-mcp-operations": {
          title: "Pinar-Cloud-Operationen über MCP",
          description:
            "Ein kompatibler MCP-Client kann Cloud-Operationen nutzen, nachdem du seinen HTTP-Endpunkt und einen Authorization: Bearer-Header mit einem Agentenschlüssel manuell konfiguriert hast. Die verfügbaren Tools lesen Daten zu Projekten, Sammlungen, Sitzungen und Stapeln im erlaubten Bereich, organisieren Ressourcen und veröffentlichen oder widerrufen Freigabelinks ausdrücklich, wenn der Schlüssel die nötige kontoweite Berechtigung besitzt. OAuth, automatische Erkennung, Löschen und Abrechnungsfunktionen sind nicht enthalten.",
        },
        "viewer-sharing-followups": {
          title: "Pin-Unterhaltungen und klarere Freigabesteuerung",
          description:
            "Der Viewer führt ursprüngliche Pin-Notizen, spätere Kommentare und Agentenergebnisse in der Unterhaltung jedes Pins zusammen. Berechtigte Personen können kommentieren sowie eine Prüfung abschließen oder wieder öffnen. Vorschaubilder von Aufnahmen lassen sich in einer zoombaren Ansicht öffnen; Pin-Bezeichnungen sind klarer und ein Datenschutzhinweis erscheint, wenn Teile einer Aufnahme nicht geprüft wurden. Freigabelinks lassen sich veröffentlichen, kopieren und widerrufen. Beim gebündelten Widerruf werden nur direkte Sitzungslinks erfasst, nicht geerbte Links eines Projekts, einer Sammlung oder eines Stapels.",
        },
      },
    },
    "v0.5.0": {
      title: "Sammlungsprüfer und eine ruhigere Arbeitsfläche",
      summary: "Ein Pro-Konto kann Prüfer zu einer Sammlung einladen. Gehostetes Cloud folgt dem aktuellen Angebot jedes Kontos. Die Ansicht bereitet Prompt kopieren beim Öffnen einer Sitzung vor, und die Arbeitsliste aktualisiert sich mit weniger Hintergrundladen.",
      changes: {
        "cloud-offer-eligibility": {
          title: "Die Cloud-Berechtigung folgt dem aktuellen Angebot",
          description: "Die lokale App und ein selbst gehosteter Server bleiben kostenlos. Gehostetes Pinar Cloud folgt dem aktuellen Angebot und der Berechtigung dieses Kontos: Ein neues Konto kann eine zeitlich begrenzte Bewertung erhalten, und ein früheres Konto kann die Berechtigung behalten, die es schon hat. Es gibt keine einheitliche Frist für alle Konten. Wenn die Seite mit den Tarifen eine Bewertung anbietet, sind es 14 Tage Pinar Cloud, bis zu 250 MB, ohne Kreditkarte. Die Sprachtranskription bleibt ein Pro-Vorteil. Während einer Bewertung verlangen Speicher- und KI-Guthaben-Zusätze Pro.",
        },
        "collection-reviewers": {
          title: "Prüfer zu einer Sammlung einladen",
          description: "Ein Pro-Konto kann jemanden per E-Mail einladen, eine einzelne Sammlung anzusehen und zu prüfen. Der Gast meldet sich an und nimmt die Einladung in der App an. Der Eigentümer kann den Zugriff widerrufen. Endet das Pro des Eigentümers, bleibt die Sammlung in der Liste, aber die Prüfung pausiert, bis Pro wieder aktiv ist. Die Einladung gilt nicht für andere Sammlungen.",
        },
        "viewer-prompt-ready": {
          title: "Prompt kopieren ist bereit, wenn die Ansicht öffnet",
          description: "Das Öffnen einer gruppierten Sitzung bereitet Prompt kopieren im Hintergrund vor. Die Schaltfläche zeigt Prompt wird vorbereitet… während des Ladens und Prompt konnte nicht vorbereitet werden, wenn es fehlschlägt. Prompt kopieren bleibt die Hauptaktion. Prompt öffnen *.md bleibt im Sitzungsmenü.",
        },
        "quieter-workspace-refresh": {
          title: "Die Arbeitsliste aktualisiert sich seltener",
          description: "Die Sitzungsliste sucht etwa alle 30 Sekunden nach Änderungen von außen, statt alle paar Sekunden. Zurück zum Tab, oder Erstellen, Verschieben, Löschen oder Teilen, aktualisiert Stapel und Freigabelinks sofort. Bereits geteilte Sitzungen bleiben zwischen diesen Aktualisierungen markiert.",
        },
      },
    },
    "v0.4.7": {
      title: "Cloud-Anmeldung in den Erweiterungseinstellungen",
      summary: "Die Erweiterung meldet sich mit einem E-Mail-Code eines bereits auf der Website erstellten Kontos bei Pinar Cloud an. Die Einstellungen sind jetzt in Einstellungen und Erfassung gegliedert.",
      changes: {
        "extension-cloud-account-settings": {
          title: "E-Mail-Anmeldung und übersichtlichere Einstellungen",
          description: "Erstellen Sie zuerst ein Konto auf pinar.dev und fordern Sie dann in den Einstellungen für den Remote-Server der Erweiterung einen E-Mail-Code an. Die Zustimmung zu den Nutzungsbedingungen erfolgt auf der Website. Einstellungen bündelt Speicherort, Sprache und Design; Erfassung bündelt die Übergabe an den Agenten und den Datenschutz.",
        },
      },
    },
    "v0.4.6": {
      title: "Klarere E-Mail-Anmeldung und Pro-Zugang",
      summary: "Die E-Mail-Bestätigung zeigt einen einfacheren Rechtshinweis. Konten mit gewährtem Pro erhalten die regulären Tariflimits.",
      changes: {
        "sign-in-and-complimentary-pro": {
          title: "E-Mail-Bestätigung und Pro-Leistungen",
          description: "Die Anmeldung zeigt keine Versionsnummer der Rechtstexte mehr und stellt die Aktion zum E-Mail-Wechsel mit Umrandung dar. Kostenlose Pro-Konten erhalten den regulären Pro-Speicher und die üblichen KI-Guthaben.",
        },
      },
    },
    "v0.4.5": {
      title: "Übersichtlicher Fußbereich und Kontomenü",
      summary: "Der Fußbereich der Startseite folgt direkt auf den Inhalt. Das Kontomenü zeigt Plan- und Abrechnungsaktionen nur, wenn sie verfügbar sind.",
      changes: {
        "landing-footer-and-account-menu": {
          title: "Weniger Leerraum auf der Startseite",
          description: "Unterstützungskarte und Fußbereich stehen direkt nach dem Inhalt. Kostenlose Konten ohne Stripe-Kunden können die Pläne öffnen; Konten ohne Abrechnung sehen keinen nicht verfügbaren Abrechnungslink mehr.",
        },
      },
    },
    "v0.4.4": {
      title: "E-Mail-Konten und Jahresabo",
      summary: "Pinar Cloud Free beginnt jetzt mit der Anmeldung per E-Mail. Pro hat einen einzigen Jahrespreis mit klareren Angaben zu Aufbewahrung, Speicher und Zusatzpaketen.",
      changes: {
        "email-first-cloud": {
          title: "Cloud-Anmeldung per E-Mail",
          description: "Erstellen Sie ein Free-Konto oder melden Sie sich mit einem sechsstelligen Code aus einer E-Mail an. Temporäre E-Mail-Domains werden gesperrt, eigene Domains akzeptiert und die Erweiterung erzeugt keine temporären Anmeldecodes mehr.",
        },
        "annual-only-pricing": {
          title: "Ein einziges Pro-Jahresabo",
          description: "Neue Pro-Abos kosten in Brasilien R$ 99 pro Jahr und andernorts US$ 29 pro Jahr. Bestehende Abos behalten ihren Preis. Free-Daten bleiben in der Cloud 30 Tage erhalten; Pro enthält 2 GB und anfangs 500 KI-Credits. Monats- und Founder-Angebote entfallen, und die Rechtshinweise der Preisseite stehen im Footer.",
        },
      },
    },
    "v0.4.3": {
      title: "Version ohne Ortskennzeichnung",
      summary: "Die Einstellungen zeigen nur die Versionsnummer. Die Adresse sagt bereits, ob du in der Cloud oder auf diesem Computer bist.",
      changes: {
        "version-without-runtime-badge": {
          title: "Die Cloud-Kennzeichnung neben der Version entfällt",
          description: "Über wiederholt Cloud oder Lokal nicht mehr neben der Version. Die Adresse der Website zeigt bereits, welche von beiden genutzt wird.",
        },
      },
    },
    "v0.4.2": {
      title: "Die Erweiterung bleibt angemeldet",
      summary:
        "Die Erweiterung zeigt kein Unauthorized mehr, wenn der Browser auch eine Sitzung der Pinar-Website hat.",
      changes: {
        "extension-session-isolation": {
          title: "Die Anmeldung der Erweiterung steht für sich",
          description:
            "Der Remote-Speicher nutzt die eigene Anmeldung der Erweiterung. Die Website-Sitzung gilt nur, wenn die Erweiterung keine eigene gesendet hat, sodass eine ältere Website-Anmeldung die Erweiterung nicht blockiert.",
        },
      },
    },
    "v0.4.1": {
      title: "Nachhaltige KI-Guthaben und passender Speicher",
      summary:
        "Pro startet jetzt einmalig mit 500 Pinar-Cloud-KI-Guthaben und 2 GB Cloud-Speicher. Zusatzpakete sind kleiner und klarer und bleiben 12 Monate gültig, ohne monatliche Erneuerung der Guthaben.",
      changes: {
        "sustainable-ai-credits": {
          title: "500 anfängliche Pinar-Cloud-KI-Guthaben",
          description:
            "Das erste Pro-Abonnement gewährt einmalig 500 Pinar-Cloud-KI-Guthaben. Sprachtranskription kostet bis 60 Sekunden ein Guthaben und von 61 bis 120 Sekunden zwei; weitere Guthaben gibt es in Paketen zu 500 mit 12 Monaten Gültigkeit.",
        },
        "right-sized-storage": {
          title: "2 GB in Pro mit 1-GB- und 5-GB-Paketen",
          description:
            "Pro umfasst 2 GB Cloud-Speicher. Kaufbare Pakete enthalten nun 1 GB oder 5 GB, sind stapelbar und 12 Monate gültig; zuvor gekaufte 5-GB- und 20-GB-Zuteilungen bleiben erhalten.",
        },
        "storage-expiry-protection": {
          title: "Ein klarer Ablauf nach Speicherablauf",
          description:
            "Übersteigt die Nutzung das verbleibende Kontingent, werden neue Uploads beim Ablauf pausiert. Der Überschuss erhält 30 Tage Schonfrist und bleibt bis Tag 90 wiederherstellbar, bevor er für einen separat geprüften Bereinigungsprozess infrage kommt.",
        },
      },
    },
    "v0.4.0": {
      title: "Kontinuierliche Erfassung, gemeinsame Prüfung und KI an jedem Pin",
      summary:
        "Eine Erfassungssitzung begleitet Sie jetzt über mehrere Seiten und speichert jeden Screenshot und Pin als einen Eintrag. Die Prüfung ist im Viewer vereint, das Founder-Angebot wurde eingestellt und Pins erhalten Struktur, technische Belege und KI-Aktionen.",
      changes: {
        "continuous-capture-session": {
          title: "Eine fortlaufende Sitzung über mehrere Seiten",
          description:
            "Pinnen Sie auf einer Seite, navigieren Sie weiter und schließen Sie nur einmal ab. Pinar erfasst jeden Pin vor der Navigation, behält die Nummerierung seitenübergreifend bei und speichert den gesamten Ablauf als eine Sitzung ohne Batch-Slots.",
        },
        "unified-session-review": {
          title: "Alle Bildschirme und Pins gemeinsam prüfen",
          description:
            "Mehrseitige Sitzungen öffnen sich in einem Pan-und-Zoom-Viewer mit allen Anmerkungen im Seitenbereich. Tab prüft die aktive Erfassung, Esc blendet die Toolbar aus und gespeicherte Sitzungen bleiben im Viewer.",
        },
        "founder-retired": {
          title: "Founder-Angebot eingestellt",
          description:
            "Neue Käufe bieten nur noch Free und Pro. Da keine Founder-Abonnements bestehen, entfernt die Migration das Angebot und stoppt zur ausdrücklichen Behandlung, falls sie unerwartete Founder-Konten, Käufe, Zuweisungen, Captures oder aktive Reservierungen findet.",
        },
        "element-structure": {
          title: "Struktur an jedem Element-Pin",
          description:
            "Jeder Element-Pin speichert seinen HTML-Baum, berechnete Stile abseits der Standardwerte, Schriften, Symbole und umgebende Elemente. Der Viewer zeigt sie unter Struktur, und sie reisen im pinar-visual-context-Block mit.",
        },
        "technical-evidence": {
          title: "Technische Belege",
          description:
            "Konsolenfehler, fehlgeschlagene Anfragen und die während des Pinnens beobachtete Umgebung werden beim Pin aufgelistet, eingestuft als Nach Interaktion oder Gleiche Seite. Nichts wird abgeleitet und kein Pinar-Cloud-Credit verbraucht.",
        },
        "pin-diagnosis": {
          title: "Einen Pin in Pinar Cloud diagnostizieren (3 Credits)",
          description:
            "Die KI erklärt die wahrscheinliche Ursache des Pins anhand seiner Struktur und schlägt eine CSS-Korrektur mit Konfidenzstufe vor. Akzeptieren, bearbeiten oder verwerfen Sie sie; nur akzeptierte Diagnosen bleiben beim Pin.",
        },
        "save-as-component": {
          title: "Einen Pin in Pinar Cloud als Komponente speichern (10 Credits)",
          description:
            "Verwandeln Sie ein erfasstes Element in HTML + CSS, React + Tailwind oder Preact + htm, mit Dateien, Abhängigkeiten, Hinweisen zur Genauigkeit, Vorschau, ZIP-Download und StackBlitz.",
        },
        "step-recording": {
          title: "Reproduktionsschritte aufzeichnen und ordnen",
          description:
            "Drücken Sie G auf der Seite, um Klicks, Tippen, Scrollen und Navigation aufzuzeichnen. Öffnen Sie Pinar erneut, pinnen und kopieren Sie, um die Zeitleiste anzuhängen; ein erneutes G verwirft sie. Der Viewer macht daraus knappe, ausformulierte Schritte für Ihren lokalen Agenten.",
        },
        "collection-design-system": {
          title: "Design-System einer Collection in Pinar Cloud (15 Credits)",
          description:
            "Extrahieren Sie die gemeinsamen Farben, Typografie, Abstände, Radien und Schatten aus den Pins einer Collection. Exportieren Sie als CSS-Variablen, Tailwind-Theme, W3C-Tokens oder DESIGN.md.",
        },
        "windows-tray-icon": {
          title: "Scharfes Windows-Tray-Symbol",
          description:
            "Das Symbol im Infobereich wird in der Größe gerendert, die die Display-Skalierung anfordert, und ist bei 125 %, 150 % oder 200 % nicht mehr unscharf.",
        },
      },
    },
    "v0.3.6": {
      title: "Update-Prüfung in der Menüleiste ist sichtbar",
      summary:
        "Die Menüleisten-App zeigt Suche nach Updates, Aktuell oder Update-Prüfung fehlgeschlagen, jeweils mit einem 10-Sekunden-Countdown zurück zu Nach Updates suchen.",
      changes: {
        "tray-update-status": {
          title: "Update-Status im Tray",
          description:
            "Nach Updates suchen zeigt Suche nach Updates, während die Prüfung läuft. Wenn Sie aktuell sind, steht Aktuell (10s). Bei einem Fehler steht Update-Prüfung fehlgeschlagen (10s). Beides zählt herunter und kehrt zu Nach Updates suchen zurück. Ein Klick während des Countdowns prüft erneut.",
        },
      },
    },
    "v0.3.5": {
      title: "Konto-Tab, einmaliger Plan nur Founder, schnellere Capture-Kopie",
      summary:
        "Der Konto-Tab der Erweiterung ist eine einzeilige Codeleiste. Der Einmalplan ist nur Founder. Die Capture kopiert Kommentare, sobald sie bereit sind, und Alt+Enter wirkt wie Ctrl+Enter.",
      changes: {
        "account-tab-options": {
          title: "Codeleiste im Konto-Tab",
          description:
            "Free-Installationen erzeugen einen temporären Code in einer Icon-Zeile, mit Countdown unter dem Feld. Bezahlte Konten zeigen E-Mail und Plan; Abmelden ist Outline; Abonnement verwalten nur bei Pro.",
        },
        "lifetime-folded-into-founder": {
          title: "Lifetime ist Founder",
          description:
            "Der einmalige Plan ist nur Pinar Founder. Der Checkout akzeptiert weiterhin das alte lifetime_founder-Metadatum. Es gibt kein Lifetime-Label, keine Env und keinen Stripe-Price-Alias.",
        },
        "capture-copy-sooner": {
          title: "Kopieren, bevor der Screenshot gespeichert ist",
          description:
            "Ctrl+Enter, Command+Enter oder Alt+Enter kopiert zuerst Kommentare und Locator, während der Helfer den Screenshot noch speichert. Der Fortschritt bleibt nicht mehr bei 80 %, wenn das Einfügen schon bereit ist.",
        },
      },
    },
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
