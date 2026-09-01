import type { HelpLocale } from "../help-content";

const locale = {
  ui: {
    articlesFound:
      "{count, plural, one {# Artikel gefunden} other {# Artikel gefunden}}",
    articleGuide: "In dieser Anleitung",
    articleNotFound: "Artikel nicht gefunden",
    articleNotFoundDescription: "Dieser Artikel existiert nicht.",
    backToHelp: "Zurück zum Hilfe-Center",
    breadcrumb: "Brotkrumennavigation",
    categories: "Kategorien",
    categoryArticles: "Artikel",
    categoryNotFound: "Kategorie nicht gefunden",
    categoryNotFoundDescription: "Diese Kategorie existiert nicht.",
    explore: "Entdecken",
    help: "Hilfe",
    helpCategories: "Hilfe-Kategorien",
    helpNavigation: "Hilfe-Navigation",
    homeDescription:
      "Anleitungen auf Basis von Projektdokumentation, Lieferhistorie und tatsächlich implementiertem Verhalten.",
    homeHeading: "Wie können wir helfen?",
    homeMetaDescription:
      "Lerne, visuelles Feedback mit Pinar zu erfassen, zu organisieren, zu teilen und zu prüfen.",
    homeMetaTitle: "Pinar Hilfe-Center",
    minutes: "Min.",
    noArticlesFound: "Keine Artikel gefunden.",
    notFoundDescription:
      "Nutze das Hilfe-Center, um veröffentlichte Anleitungen zu finden.",
    onThisPage: "Auf dieser Seite",
    openScreenshot: "Screenshot in voller Größe öffnen",
    pageTitleSuffix: "Pinar Hilfe",
    popularArticles: "Beliebte Artikel",
    popularDescription:
      "Die meistgenutzten Wege, um ein Review zu starten und abzuschließen.",
    searchLabel: "Hilfe-Center durchsuchen",
    searchPlaceholder: "Aufnahmen, Agenten, Pläne durchsuchen…",
    searchResults: "Suchergebnisse",
    seeAllCategory: "Alle in der Kategorie anzeigen",
    stillNeedContext: "Noch Kontext nötig?",
    visualExample: "Visuelles Beispiel:",
  },
  categories: {
    "getting-started": {
      title: "Erste Schritte",
      description:
        "Pinar installieren, eine erste Aufnahme erstellen und festlegen, wo die Arbeit liegt.",
    },
    captures: {
      title: "Aufnahmen und Pins",
      description:
        "Seiten präzise auswählen, annotieren, sensible Bereiche maskieren und das Ergebnis erneut öffnen.",
    },
    agents: {
      title: "KI-Agenten",
      description:
        "Visuellen Kontext an Coding-Agenten senden und den Review-Kreislauf sicher schließen.",
    },
    workspace: {
      title: "Projekte und Sammlungen",
      description:
        "Aufnahme-Sitzungen organisieren, durchsuchen, verschieben, teilen und prüfen.",
    },
    cloud: {
      title: "Cloud und Pläne",
      description:
        "Konten, Pläne, Credits, Speicher, Aufbewahrung und öffentliches Teilen verstehen.",
    },
    privacy: {
      title: "Datenschutz und Daten",
      description:
        "Erfahren, was Pinar speichert, was es entfernt und welche Kontrolle in deiner Hand bleibt.",
    },
  },
  screenshots: {
    "sign-in-extension": {
      alt: "Pinar-Anmeldebildschirm mit ausgewähltem Kopplungscode-Ablauf der Browser-Erweiterung.",
      caption:
        "Der Erweiterungsablauf übernimmt den von Pinar angezeigten temporären Kopplungscode und verbindet diesen Browser ohne Passwort.",
    },
    "capture-workspace": {
      alt: "Pinar-Arbeitsbereich mit annotierten Sitzungskarten, Pin-Anzahlen, Projekten, Sammlungen, Suche und Kontosteuerung.",
      caption:
        "Der Arbeitsbereich hält erfasste Seiten, Pin-Anzahlen, Projekte, Sammlungen, Suche und Kontostatus in einer operativen Ansicht zusammen.",
    },
    "getting-started": {
      alt: "Öffentliche Pinar-Startseite mit dem Local-First-Workflow, dem Einstieg in den Arbeitsbereich und der Plan-Navigation.",
      caption:
        "Starte über den öffentlichen Pinar-Einstieg, um den lokalen Arbeitsbereich zu öffnen, den Aufnahme-Workflow zu verstehen oder Cloud-Pläne zu vergleichen.",
    },
    "help-navigation": {
      alt: "Pinar-Hilfeartikel mit Kategorienavigation, Links zu verwandten Artikeln, strukturierten Abschnitten und Seitennavigation.",
      caption:
        "Hilfeseiten halten Kategorie, benachbarte Abläufe, Artikelabschnitte und Wiederherstellungspfade gemeinsam sichtbar.",
    },
    privacy: {
      alt: "Pinar-Rechtscenter mit Dokumenten zu Nutzungsbedingungen, Datenschutz, zulässiger Nutzung, Datenaufbewahrung, Rückerstattung, Fair Source und Unterauftragsverarbeitern.",
      caption:
        "Das Rechtscenter bündelt die Regeln zu Daten, Aufbewahrung, zulässiger Nutzung, Rückerstattung, Lizenzierung und Unterauftragsverarbeitern an einem auditierbaren Ort.",
    },
    "workspace-table": {
      alt: "Pinar-Arbeitsbereichstabelle mit Suche, Filtern, Pin-Anzahlen, Erstellungsdaten, Paginierung und Zeilenaktionen.",
      caption:
        "Die Tabellenansicht bringt Suche, Filter, Pin-Anzahlen, Daten, Paginierung und Sitzungsaktionen in einen schnell erfassbaren Ablauf.",
    },
    "sign-in-email": {
      alt: "Pinar-Konto-Anmeldebildschirm mit ausgewähltem E-Mail-Code-Ablauf.",
      caption:
        "Registrierte Konten fordern einen kurzlebigen Code per E-Mail an und schließen die Verifizierung in derselben Anmeldeoberfläche ab.",
    },
    pricing: {
      alt: "Pinar-Preisseite mit Vergleich von Free, Pro jährlich, Founder, Speicher-Add-ons und KI-Credit-Optionen.",
      caption:
        "Die Preisseite zeigt Planlimits, Abrechnungsrhythmus, Speicher-Add-ons und KI-Credit-Käufe vor dem Checkout.",
    },
    updates: {
      alt: "Pinar-Release-Detail mit Veröffentlichungsdatum, Version, Änderungen und Navigation zum vorherigen und nächsten Release.",
      caption:
        "Veröffentlichte Release Notes machen installiertes Verhalten und operative Änderungen versionsbezogen nachvollziehbar.",
    },
  },
  articles: {
    "install-pinar": {
      title: "Pinar installieren",
      summary:
        "Füge die offizielle Chrome-Erweiterung hinzu und verbinde das unterstützte lokale Produkt für deine Plattform.",
      sections: [
        {
          heading: "Browsererweiterung",
          paragraphs: [
            "Installiere Pinar aus dem Chrome Web Store. Das ist der offizielle Browser-Installationsweg; ein GitHub-Checkout oder ein entpackter Erweiterungsordner ist für den normalen Gebrauch nicht erforderlich.",
          ],
          bullets: [
            "Hefte das Pinar-Symbol im Chrome-Menü für Erweiterungen an, damit es sichtbar bleibt.",
            "Die Erweiterung unterstützt die veröffentlichte Origin pinar.dev und lokale Pinar-Server.",
          ],
        },
        {
          heading: "Lokales Produkt",
          paragraphs: [
            "Unter macOS sitzt Pinar.app in der Menüleiste, führt den eingebetteten Helper aus, registriert unterstützte Agent-Hooks und prüft GitHub Releases auf Updates. Windows und Linux nutzen derzeit den eigenständigen Helper-Installer statt einer Desktop-App.",
          ],
          bullets: [
            "Screenshots liegen normalerweise in `~/.pinar/shots` und der Verlauf in `~/.pinar/history.db`. Die Tray-Aktion Open Folder öffnet dieses Verzeichnis; PINAR_HOME kann es überschreiben.",
            "Der Helper prüft auf 127.0.0.1 die Ports 17373 bis 17382 und erkennt Pinar über GET `/api/health`. PINAR_PORT legt die Discovery auf einen Port fest.",
            "Start at Login verwendet unter macOS einen Benutzer-LaunchAgent. Pinar fällt auf älteren Systemen auf den älteren launchctl-Pfad zurück und speichert Logs im Pinar-Home-Verzeichnis.",
            "Ist der lokale Helper nicht verfügbar, fallen Bildausschnitte auf Downloads/pinar zurück.",
          ],
        },
        {
          heading: "Helper bestätigen und Workspace öffnen",
          paragraphs: [
            "Nachdem die Erweiterung angeheftet ist, installiere das passende lokale Produkt über den dokumentierten One-Shot-Pfad: ziehe das macOS-Disk-Image nach ~/Applications, führe unter Windows den PowerShell-Installer aus oder unter Linux den curl-Installer. Diese Skripte legen den Helper in ~/.pinar/bin (oder %USERPROFILE%\\.pinar\\bin) ab, fügen dieses Verzeichnis zu PATH hinzu und führen pinar install-hooks aus, damit Coding-Agents eingefügte Captures empfangen können.",
            "Unter macOS blendet Pinar.app das Dock-Symbol aus, hält über ~/.pinar/tray.pid eine einzige Tray-Instanz und startet den Helper mit pinar ensure, wenn GET `/api/health` noch nicht ok true und service pinar zurückgibt. Nutze in der Menüleiste Start oder Restart, wenn der Status Off ist, und anschließend Open Workspace, um http://127.0.0.1:<port>/app zu laden. Führe pinar install-hooks erneut über den Helper aus, wenn ein Agent die Einfügeanweisungen nicht mehr sieht.",
          ],
          bullets: [
            "Windows-Installation: irm https://pinar.dev/install.ps1 | iex. Linux-Installation: curl -fsSL https://pinar.dev/install.sh | sh. Das Skript benötigt curl oder wget, um die Binary herunterzuladen.",
            "Ein gesunder Helper beantwortet GET `/api/health` mit ok true und service pinar. Unter macOS nutzt Open Workspace den gefundenen Port am Workspace-Pfad /app.",
            "Die Chrome-Erweiterung kann `~/.pinar/shots` nicht selbst beschreiben. Fehlen Ausschnitte in diesem Ordner, starte zuerst das lokale Produkt und erfasse dann erneut.",
          ],
        },
      ],
    },
    "first-capture": {
      title: "Dein erstes Capture erstellen",
      summary:
        "Setze einen Pin auf ein sichtbares Element oder einen Bereich, schreibe Feedback und kopiere ein zusammenhängendes Bundle.",
      sections: [
        {
          heading: "Die Seite pinnen",
          paragraphs: [
            "Öffne die Seite, wähle die Pinar-Erweiterung, klicke dann auf ein Element oder ziehe einen Freiform-Bereich. Schreibe den Kommentar und drücke Enter, um den Pin hinzuzufügen.",
          ],
          bullets: [
            "Wiederhole die Auswahl, um mehrere nummerierte Pins in einem Capture zu setzen.",
            "Shift+Enter fügt einen Zeilenumbruch ein; Escape schließt den Entwurf, ohne die anderen Pins zu löschen.",
          ],
        },
        {
          heading: "Das Bundle kopieren",
          paragraphs: [
            "Drücke unter macOS Command+Enter, sonst Ctrl+Enter. Pinar kopiert menschenlesbares Markdown, HTML und einen pinar-visual-context-JSON-Block, die auf denselben Screenshot und dieselben Pin-Identitäten verweisen.",
          ],
        },
        {
          heading: "Kopieren abschließen und Identitäten behalten",
          paragraphs: [
            "Command/Ctrl+Enter kopiert erst, wenn mindestens ein Pin einen Kommentar hat. Das Overlay zeigt Copying…, blendet die Pin-Chrome für den Screenshot aus, danach Copied, und die Symbolleiste schließt sich. Ein späterer Klick auf das Erweiterungssymbol blendet nur das Overlay ein oder aus; bereits gesetzte Pins werden nicht gelöscht. Scheitern alle Zwischenablagewege, wird das Overlay wiederhergestellt, damit du es erneut versuchen kannst.",
            "Behandle die Zwischenablage-Nutzlast als eine Einheit: lesbare Anweisungen, eine optionale Viewer-URL und einen fenced pinar-visual-context-JSON-Block mit `captureId`, `pinId`, Seiten-URL, Locators (cssSelector, domPath, innerText) und einer Screenshot-URL, wenn der Helper eine Datei gespeichert hat. Nummerierte Badges auf dem Bild sind Annotations-Overlays, keine Seiten-UI. Schreibe `captureId` oder `pinId` beim Einfügen in einen Agent nicht um. Eine Zeile Screenshot: /path/to/file.png ist, sofern vorhanden, der einzige Ausschnitt, der alle Pins enthält.",
          ],
          bullets: [
            "Ein leerer Composer oder ein Capture ohne Pins bricht das Kopieren ab und blendet Write a comment first oder Add a pin first ein.",
            "Eingeschränkte Kopien fügen weiterhin Kommentare und Locators ein, aber die Symbolleiste kann nach Copied no screenshot, helper unavailable oder no viewer ergänzen.",
            "Bevorzuge einen laufenden Helper, damit PNG-Ausschnitte in `~/.pinar/shots` landen und das Bundle einen Viewer-Link /v/<id>.md für den vollen Kontext enthalten kann.",
          ],
        },
      ],
    },
    "local-or-cloud": {
      title: "Lokalen oder Cloud-Speicher wählen",
      summary:
        "Nutze den lokalen Workspace offline oder verbinde ein Konto für verwalteten Cloud-Speicher und Freigaben.",
      sections: [
        {
          heading: "Lokal",
          paragraphs: [
            "Der lokale Modus speichert den Verlauf in SQLite und Screenshots auf deinem Rechner. Die Loopback-API akzeptiert nur vertrauenswürdige lokale Origins oder Erweiterungs-Origins und verwendet ein dateisystemgeschütztes Capability-Token.",
          ],
        },
        {
          heading: "Cloud",
          paragraphs: [
            "Der Cloud-Modus speichert Kontodaten in D1 und Screenshots in R2. Er ermöglicht Remote-Zugriff auf den Workspace, verwaltete Aufbewahrung, KI-Zusammenfassungen, Abrechnung und unlisted Freigabelinks. Vor der Remote-Persistenz ist eine rechtliche Einwilligung erforderlich.",
          ],
        },
        {
          heading: "Wie lokale und Cloud-Sitzungen wirklich geöffnet werden",
          paragraphs: [
            "Lokaler Verlauf gehört immer zu owner local. Beim ersten Gebrauch legt die Datenbank ein geschütztes Projekt Personal und eine geschützte Collection Inbox an, die sich nicht wie benutzererstellte verschachteln oder löschen lassen. Gespeicherte Captures sind mit isPermanent true und plan free markiert, PNG-Dateien werden im Shots-Verzeichnis des Pinar-Home geschrieben, und die Loopback-API stellt sie unter /shots/<id>.png und /v/<id>.md bereit. Änderungen an dieser API erfordern das Capability-Geheimnis aus ~/.pinar/local-capability.json, gesendet als x-pinar-capability oder als Authorization-Bearer-Token. Die Datei wird mit mode 0600 geschrieben; die Rotation hält das vorherige Geheimnis 24 Stunden gültig, sofern PINAR_CAPABILITY_GRACE_MS nichts anderes festlegt.",
            "Cloud-Persistenz ist gesperrt, bis die aktuellen Versionen von Nutzungsbedingungen, Datenschutz und zulässiger Nutzung akzeptiert sind; die API antwortet mit HTTP 428 und code legal_acceptance_required. Remote Free registriert danach eine Installation und kann einen fünfminütigen, einmaligen Pairing-Code erzeugen, um /app zu öffnen. Paid-Konten oder zuvor bezahlte Konten können zusätzlich einen sechsstelligen E-Mail-Code bestätigen. Browser-Cookies gelten 30 Tage; authentifizierte Erweiterungsgeräte 180 Tage. Unlisted Markdown bleibt unter /v/, /p/ und /c/ öffentlich, Screenshots unter /shots/.",
          ],
          bullets: [
            "Lokales GET /api/local/capability gibt das aktuelle Token zurück; rotate und revoke sind POST-Endpunkte unter demselben Präfix /api/local/capability.",
            "SQLite liegt als `history.db` im Pinar-Home-Verzeichnis; kann SQLite nicht geöffnet werden, fällt der Verlauf auf `history.json` im selben Home zurück.",
            "Cloud-Freigabelinks benötigen keine Workspace-Sitzung: Jeder mit der unlisted URL kann das Markdown oder PNG unter /v/, /p/, /c/ oder /shots/ lesen.",
          ],
        },
      ],
    },
    "shortcuts-and-navigation": {
      title: "Tastenkürzel",
      summary:
        "Erfassen, durch das DOM bewegen, Inhalte maskieren und kopieren, ohne die Tastatur zu verlassen.",
      sections: [
        {
          heading: "Während des Captures",
          paragraphs: [
            "Pinar fängt nur die aktiven Capture-Tastenkürzel ab, damit die Host-Seite denselben Tastendruck nicht erhält.",
          ],
          bullets: [
            "Enter setzt einen Pin auf das Element unter dem Zeiger; Arrow Up wählt das Elternelement, Arrow Down kehrt zu einem Kind zurück.",
            "M schaltet das Zeichnen der Privacy-Maske um. Escape bricht einen Entwurf oder eine Maske ab; ohne Entwurf werden Pins gelöscht und die Symbolleiste ausgeblendet.",
            "Command/Ctrl+Enter kopiert das fertige Bundle.",
            "Alt+Shift+P blendet die Toolbar ein oder aus, ohne die Sitzung abzubrechen, und lässt sich unter `chrome://extensions/shortcuts` neu belegen. Browser-Kurzbefehle bleiben auf `chrome://`-Seiten, im Chrome Web Store und vor der Injektion des Overlays wirkungslos.",
          ],
        },
        {
          heading: "Fokuslastige Seiten",
          paragraphs: [
            "Auf Seiten mit aggressiven Focus-Traps versucht Pinar begrenzt oft, den Kommentar-Composer zu fokussieren, und hört dann auf, statt den Tab einzufrieren. Klicke direkt in den Composer, wenn die Seite den Fokus weiter stiehlt.",
          ],
        },
        {
          heading: "Details zu Overlay, Symbol und DOM-Durchlauf",
          paragraphs: [
            "Capture-Tastenkürzel gelten nur, solange das Overlay aktiv ist. Das Erweiterungssymbol schaltet dieses Overlay um; Pins werden nicht gelöscht. Zeigst du ohne offenen Entwurf auf die Symbolleiste, wird sie pass-through, sodass du die Seite darunter weiter anklicken oder ziehen kannst. Shift+Enter fügt im Composer einen Zeilenumbruch ein, und Tastenkürzel der Host-Seite, die dort getippt werden, verlassen das Kommentarfeld nicht.",
            "Arrow Up geht zum Elternelement und merkt sich das verlassene Kind, sodass Arrow Down zu diesem gemerkten Knoten zurückkehrt, wenn er noch ein Kind ist; sonst wird das erste Kind verwendet. Im Maskenmodus ziehst du einen Bereich, um ihn auszublenden, und klickst auf eine vorhandene Maske, um sie wiederherzustellen. Tastatur-Scrolling funktioniert weiterhin im Dokument, aber auf fokussierte Seitensteuerungen gerichtete Tasten werden blockiert, damit sie keine Schaltflächen auslösen oder in das Host-Formular schreiben.",
          ],
          bullets: [
            "Command/Ctrl+Enter speichert einen offenen Entwurf und kopiert anschließend; ohne Kommentar erscheint Write a comment first, statt einen leeren Pin zu senden.",
            "Nach Escape oder dem Kopieren behält Pinar diese physische Taste bis keyup, damit die Host-Seite denselben Tastendruck nicht als eigenes Abbrechen oder Absenden wertet.",
            "Ein Bereichs-Pin startet erst, wenn sich der Zeiger etwa sechs Pixel bewegt; ein kürzerer Klick setzt weiterhin einen Pin auf das Element unter dem Zeiger, statt ein Freiform-Rechteck zu öffnen.",
          ],
        },
      ],
    },
    "capture-types": {
      title: "Element-, Bereichs-, Ganzseiten- und iframe-Captures",
      summary:
        "Wähle den kleinsten Capture-Modus, der den Kontext für die prüfende Person noch erhält.",
      sections: [
        {
          heading: "Auswahlmodi",
          paragraphs: [
            "Ein Element-Capture speichert einen robusten DOM-Fingerprint und die genaue Box. Ein Bereichs-Capture erfasst ein Freiform-Rechteck, wenn kein einzelnes Element das Feedback darstellt. Ein Ganzseiten-Capture scrollt und fügt das Dokument zusammen. Ein iframe-Capture erhält Frame-Grenzen und Offsets.",
          ],
          bullets: [
            "Bevorzuge ein Element, wenn der Agent die Code-Zuordnung präzise erkennen muss.",
            "Bevorzuge einen Bereich für visuelle Beziehungen über mehrere Elemente.",
          ],
        },
        {
          heading: "Klicken, Ziehen und Frame-Zielwahl",
          paragraphs: [
            "Klicke auf einen Knoten oder drücke Enter auf der aktuellen Umrandung, um einen Element-Pin zu öffnen. Ziehe ein Rechteck von mindestens sechs Pixeln, um stattdessen einen Bereichs-Pin zu öffnen. Der erste Druck auf ein iframe- oder frame-Element wird ignoriert, damit das Dokument in diesem Frame die Auswahl übernehmen kann.",
            "Element-Pins speichern einen Fingerprint, einen Selektor und einen DOM-Pfad, der Vorfahren-Frames mit einem Frame-Grenz-Trennzeichen verbindet. Bereichs-Pins speichern das Rechteck und eine Pixelgrößen-Beschriftung ohne Locator. Der kopierte Screenshot kachelt weiterhin um die Vereinigung aller Pins, einschließlich Pins in Kind-Frames.",
          ],
          bullets: [
            "Die Capture-Symbolleiste bleibt im Top-Frame; Kind-Frames zeigen nur Markierungen und den Kommentar-Composer.",
            "Antwortet ein Eltern-Frame nicht mit seinem Pfad, behält der Pin nur den inneren Dokumentpfad.",
            "fixed- oder sticky-Elemente werden als viewport-anchored markiert, damit das erneute Öffnen sie nicht als mit dem Dokument gescrollte Boxen behandelt.",
          ],
        },
      ],
    },
    "pins-and-comments": {
      title: "Pins, Kommentare und Farben",
      summary:
        "Nutze nummerierte Pins als stabile Verweise zwischen Screenshot, Text und strukturiertem Kontext.",
      sections: [
        {
          heading: "Ein gemeinsames Capture",
          paragraphs: [
            "Jedes nummerierte Badge auf dem Screenshot gehört zu einem Kommentar und einem Pin-Datensatz. Die rotierende Farbpalette trennt nahe Markierungen, ohne ihre Identität zu ändern.",
          ],
        },
        {
          heading: "Die Zuordnung beibehalten",
          paragraphs: [
            "Schreibe `captureId` oder `pinId` nicht um, wenn du das Bundle an ein anderes Tool übergibst. Diese Felder lassen Workspace, Viewer, Agent-Ergebnis und Review-Verlauf auf dasselbe Capture verweisen.",
          ],
        },
        {
          heading: "Wie Nummern und Identitäten vergeben werden",
          paragraphs: [
            "Ein Pin wird nur gespeichert, wenn der Kommentar getrimmt und nicht leer ist. Neue Pins erhalten eine UUID, eine 1-basierte Nummer aus ihrer Reihenfolge im Capture und eine Farbe aus der Elf-Felder-Palette an dieser Nummer. Nahe Badges unterscheiden sich daher optisch, ohne die behaltene Identität zu ändern.",
            "Der strukturierte Kontext übernimmt `pinId` aus dem vorhandenen `pinId` oder id. Fehlen diese Felder, erzeugt der Parser `captureId`:pN aus der Capture-Identität und der Pin-Nummer. Nachgelagerte Tools können dann auf denselben Screenshot, Kommentar und dieselbe Review-Zeile zeigen.",
          ],
          bullets: [
            "Ein leerer Composer lässt sich nicht kopieren; der Fokus bleibt auf dem Feld, bis ein Kommentar existiert.",
            "Beim Zeigen auf eine Markierung siehst du Nummer, Kommentar und aktuelle Locator-Konfidenz auf der Live-Seite.",
            "Das Bearbeiten eines vorhandenen Pins aktualisiert nur den Kommentar; die gespeicherte id bleibt unverändert.",
          ],
        },
      ],
    },
    "full-page-capture": {
      title: "Eine ganze Seite erfassen",
      summary:
        "Erzeuge einen langen Screenshot, während Pinar Scrollen, Skalierung und wiederholte fixed Inhalte steuert.",
      sections: [
        {
          heading: "So funktioniert das Zusammensetzen",
          paragraphs: [
            "Pinar plant Viewport-Frames, scrollt durch das Dokument, unterdrückt vorübergehend wiederholte sticky- oder fixed-Elemente, rendert mit dem device pixel ratio und stellt die Seite danach wieder her.",
          ],
        },
        {
          heading: "Wenn das Ergebnis abweicht",
          paragraphs: [
            "Lazy-loaded Inhalte, animierte Layouts, Cross-Origin-Frames und Seiten, die sich beim Scrollen ändern, können Lücken oder unaufgelöste Bereiche erzeugen. Lass die Seite zur Ruhe kommen, versuche es erneut oder erfasse den betroffenen Bereich separat.",
          ],
        },
        {
          heading: "Viewport-Kacheln und Layout-Wiederherstellung",
          paragraphs: [
            "Pinar plant Scrollpositionen aus der Vereinigung der Pin-Grenzen plus padding, erfasst dann jede viewport-hohe PNG-Kachel über die Tab-Screenshot-API. Spätere Kacheln warten kurz, damit die Seite zeichnen kann, und die zusammengesetzte Canvas nutzt das device pixel ratio, ermittelt aus der ersten Kachelbreite im Verhältnis zum CSS-Viewport.",
            "Vor der ersten Kachel werden sticky- und fixed-Knoten umgeschrieben, damit sie nicht auf jedem Frame wiederholt werden. Originale Inline-Styles und die Scrollposition werden auch bei fehlgeschlagener Zusammensetzung wiederhergestellt. Pin- und Masken-Koordinaten werden vor dem Zuschneiden des Bildes zum Capture-Ursprung verschoben.",
          ],
          bullets: [
            "fixed-Knoten werden am gemessenen Kasten absolut positioniert, transforms werden gelöscht, damit der Screenshot sie nicht doppelt versetzt.",
            "sticky-Knoten werden für die Dauer des Capture-Durchlaufs relativ positioniert.",
            "Das Kachel-Scrolling nutzt instant scroll-behavior, damit das Dokument zwischen Frames nicht animiert.",
          ],
        },
      ],
    },
    "smart-selection": {
      title: "Intelligente Locator und DOM-Auswahl",
      summary:
        "Verstehen Sie, wie ein Pin einem Element folgt, nachdem sich die Seite ändert, und warum Pinar eine manuelle Platzierung anfordern kann.",
      sections: [
        {
          heading: "Robuste Fingerprints",
          paragraphs: [
            "Ein Element-Pin kombiniert einen stabilen Selektor, DOM-Pfad, Tag, id, name, test id, role, Klassen, Text, Label und Geometrie. Beim erneuten Öffnen bewertet Pinar Selektor, Struktur, Semantik und Geometrie, statt einem einzelnen fragilen Pfad zu vertrauen.",
          ],
        },
        {
          heading: "Konfidenz und Mehrdeutigkeit",
          paragraphs: [
            "Ein Treffer kann exact, probable, ambiguous oder unresolved sein. Wenn zwei Kandidaten zu ähnlich sind, behält Pinar Alternativen, statt den Pin auf das falsche Element zu setzen. Cross-Origin-iframe-Ziele können unresolved bleiben.",
          ],
        },
        {
          heading: "Selektor-Fallback und konkurrierende Treffer",
          paragraphs: [
            "Zum Capture-Zeitpunkt bevorzugt Pinar einen Selektor, der den Knoten eindeutig über id, data-testid oder data-test oder über Tag plus name trifft. Ist keiner davon eindeutig, speichert Pinar stattdessen einen strukturellen CSS-Pfad. Klassennamen, die generiert wirken, werden aus dem Fingerprint entfernt, damit gehashte CSS-Modules nicht zum einzigen Signal werden.",
            "Beim erneuten Öffnen werden Kandidaten der Strategien stable-selector, structure, semantic und geometry zusammengeführt und bewertet. Exact-Konfidenz erfordert einen hoch bewerteten stable-selector- oder structure-Treffer; semantic- und geometry-Treffer bleiben probable. Unterscheiden sich die beiden besten gültigen Scores um weniger als eine schmale Marge, ist das Ergebnis ambiguous und es wird kein Element gewählt.",
          ],
          bullets: [
            "Ein positionaler :nth-of-type-Selektor wird niedriger bewertet, wenn andere Knoten denselben Tag, Text und dieselben Klassen teilen.",
            "Flächen-Pins werden als Elementziele abgelehnt und bleiben während der Locator-Bewertung unresolved.",
            "Wenn ein iframe-contentDocument unlesbar ist, stoppt die Relokation mit einer cross-origin-frame-Warnung, statt zu raten.",
          ],
        },
      ],
    },
    "privacy-masks": {
      title: "Sensible Bereiche maskieren",
      summary:
        "Visuelle Bereiche schwärzen, bevor der Screenshot serialisiert oder hochgeladen wird.",
      sections: [
        {
          heading: "Eine Maske zeichnen",
          paragraphs: [
            "Drücken Sie M, während der Capture-Modus aktiv ist, und ziehen Sie dann über den sensiblen Bereich. Benutzermasken werden vor dem Speichern auf das aufgenommene Bild angewendet; entfernen Sie eine irrtümliche Maske vor dem Kopieren.",
          ],
        },
        {
          heading: "Masken ergänzen die Schwärzung",
          paragraphs: [
            "Die automatische Bereinigung behandelt bekannte sensible DOM-Felder und URL-Teile. Manuelle Masken decken visuelle Inhalte ab, die Software nicht zuverlässig klassifizieren kann, etwa Diagramme, Avatare oder canvas-gerenderte Daten.",
          ],
        },
        {
          heading: "Wie Masken ins gespeicherte Bild gelangen",
          paragraphs: [
            "Das Zeichnen von Masken ist nicht verfügbar, solange ein Kommentarentwurf offen ist. Ein gültiges Ziehen speichert eine Benutzermaske in Dokumentkoordinaten, sodass sie dem Seiten-Scroll folgt, und ein Klick auf dieses Overlay entfernt sie. Automatische Feldboxen aus dem Privacy-Scan werden vor dem Kopieren mit diesen Benutzerrechtecken kombiniert.",
            "Die kombinierten Regionen reisen mit der Capture-Nachricht, damit sie vor Zwischenablage oder Speicherung auf den Screenshot gezeichnet werden. Eine separate Bereinigung schwärzt weiterhin bekannte Geheimnisse in URLs, Feldwerten und Pin-Text; Masken decken Pixel ab, die diese Zeichenkettenregeln nicht klassifizieren können.",
          ],
          bullets: [
            "Benutzermasken verwenden eine eindeutige id und die Kategorie manual, damit sie unabhängig von automatischen Boxen gelöscht werden können.",
            "Automatische Feldmasken werden verworfen statt gelöscht, damit spätere Scans das zugrunde liegende Feld weiterhin melden können.",
            "Escape beendet das Maskenzeichnen, ohne die bereits auf der Seite platzierten Pins zu verwerfen.",
          ],
        },
      ],
    },
    "copy-and-reopen": {
      title: "Eine Capture kopieren, anzeigen und erneut öffnen",
      summary:
        "Von der Live-Seite in den Workspace und zurück wechseln, ohne die ursprünglichen Anker zu verlieren.",
      sections: [
        {
          heading: "Viewer-Steuerung",
          paragraphs: [
            "Der Capture-Viewer unterstützt Zeiger-Schwenken, Mausrad-Zoom am Cursor, Doppelklick-Zoom und Steuerung von 50 % bis 800 %. Das Auswählen eines Pins öffnet die gerenderten Preview- und die wortgetreuen Raw-Markdown-Tabs.",
          ],
          bullets: [
            "Laden Sie den Screenshot herunter oder kopieren Sie das Session-Markdown aus dem Viewer.",
            "Öffnen Sie das öffentliche Markdown in ChatGPT oder Claude über das Viewer-Aktionsmenü, wenn das Teilen verfügbar ist.",
          ],
        },
        {
          heading: "Auf der Originalseite prüfen",
          paragraphs: [
            "Review on page öffnet den erfassten Origin und rehydriert die Pins. Pinar lehnt eine Origin-Abweichung ab, bewahrt jeden historischen Anker und jede Box, zeichnet die Relokationshistorie auf und lässt Sie einen unresolved Pin manuell neu positionieren.",
          ],
        },
        {
          heading:
            "Zwischenablage aus dem Viewer und Gating beim erneuten Öffnen",
          paragraphs: [
            "Copy page im Viewer schreibt dasselbe korrelierte Markdown-Bundle wie auf der Live-Seite, mit compact- oder full-Handoff aus gespeicherten Präferenzen und `captureId` mit Fallback auf die Session-ID. Das Aktionsmenü öffnet das öffentliche Markdown unter /v/{id}.md oder startet ChatGPT oder Claude mit einem Prompt, der auf diese URL zeigt.",
            "Review on page sendet ein reopen-Ereignis mit der Session-ID. Der Helper hydriert nur von einer vertrauenswürdigen Pinar-App-URL, wenn diese ID mit der Session-ID oder `captureId` übereinstimmt und der Tab-Origin weiterhin dem Origin der erfassten Seite entspricht. Das Navigieren des Tabs von diesem Origin weg löst die Bindung, statt Pins in die falsche Site zu injizieren.",
          ],
          bullets: [
            "Wenn kein reopen-Ergebnis eintrifft, zeigt der Viewer einen missing-helper-Hinweis, statt unbegrenzt zu warten.",
            "Öffentliche oder ältere Viewer, die Präferenzen nicht lesen können, kopieren weiterhin mit compact-Handoff.",
            "Ein Tab, der noch about:blank ist, behält die Hydrierungsbindung; nur ein anderer Origin löst sie.",
          ],
        },
      ],
    },
    "send-to-agent": {
      title: "Visuellen Kontext an einen Agenten senden",
      summary:
        "Fügen Sie das vollständige Pinar-Bundle ein, damit der Agent Kommentar, Ziel, Geometrie und das geteilte Bild zusammen sieht.",
      sections: [
        {
          heading: "Was einzufügen ist",
          paragraphs: [
            "Pinar schreibt reines Markdown und HTML in die Zwischenablage. Der Text enthält lesbare Annotationen plus einen fenced pinar-visual-context-JSON-Block. Fügen Sie beides als eine Einheit ein; der strukturierte Block ist die maschinenlesbare Quelle der Wahrheit.",
          ],
        },
        {
          heading: "Screenshot und Warnungen",
          paragraphs: [
            "Wenn das Bundle einen absoluten Screenshot-Pfad auflistet, sollte der lokale Agent dieses einzelne Bild öffnen; nummerierte Badges sind Overlays. Warnungen wie `screenshot_missing`, `helper_unavailable` oder `viewer_unavailable` beschreiben eine eingeschränkte Zustellung, machen die Kommentare und den DOM-Kontext jedoch nicht ungültig.",
          ],
        },
        {
          heading: "Wie das kopierte Bundle an einen Agenten geliefert wird",
          paragraphs: [
            "Die Chrome-Erweiterung tippt niemals in den Agent-Composer. Nach Command/Ctrl+Enter fügen Sie die Zwischenablage selbst in Cursor, Claude, Codex oder Grok ein. Der Text beginnt mit Anweisungen, die Pin-Kommentare umzusetzen und Selektor und DOM-Pfad als ergänzende Locator zu behandeln, gefolgt von einem fenced pinar-visual-context-JSON-Block. Wenn eine Viewer-URL enthalten ist, rufen Sie sie nur ab, wenn diese Details nicht ausreichen.",
            "Behandeln Sie `captureId` und `pinId` als Identität, nicht als Labels zum Umschreiben. Visual Context kodiert derzeit schemaVersion 1; parseVisualCapture lehnt eine fehlende `captureId` und jede schemaVersion außer 1 oder dem Legacy-Wert 0 ab. Ändern Sie nur, was die Pins beschreiben. Wenn die Person nichts eingefügt hat, bitten Sie sie, erneut aus Pinar zu kopieren, statt Pins aus dem Gedächtnis zu rekonstruieren.",
          ],
          bullets: [
            "Fügen Sie die gesamte Zwischenablage in den Agenten ein; tippen Sie Kommentare nicht ab und erfinden Sie keine neue `captureId`.",
            "Bestätigen Sie, dass der eingefügte Text noch einen geschlossenen pinar-visual-context-Fence enthält, bevor Sie Code bearbeiten.",
            "Wenn nichts eingefügt wurde, bitten Sie um Command/Ctrl+Enter in Pinar und setzen Sie nur die Pin-Kommentare um.",
          ],
        },
      ],
    },
    "handoff-formats": {
      title: "Handoff-Formate und Ziele",
      summary:
        "Wählen Sie compact- oder full-Kontext und eine agentenspezifische Darstellung, ohne die Capture-Identität zu ändern.",
      sections: [
        {
          heading: "Compact und full",
          paragraphs: [
            "Der compact-Modus entfernt redundantes Locator- und Geometrie-Rauschen und behält die Korrelation. Der full-Modus behält die ungekürzte Payload. Eine separate Präferenz schließt Screenshots ein oder aus; das Deaktivieren bewahrt Metadaten, Pins, Locator, Review und Handoff und vermeidet Bildspeicherung. Inline-Bilddaten werden aus Text-Payloads entfernt, um überlange Prompts zu verhindern. Der Settings-Dialog im Workspace synchronisiert diese Zustellpräferenzen mit dem aktiven Backend.",
          ],
        },
        {
          heading: "Agent-Adapter",
          paragraphs: [
            "Pinar kann Präambel und Markdown-Form für Claude, Codex, Grok und andere unterstützte Coding-Agent-Ziele anpassen. Der zugrunde liegende `captureId`-, `pinId`- und visual-context-Vertrag bleibt gleich.",
          ],
        },
        {
          heading:
            "Zustellmodus in den Erweiterungsoptionen wählen, bevor Sie kopieren",
          paragraphs: [
            "In den Erweiterungsoptionen setzt ein Schalter handoffMode auf full, wenn aktiviert, und auf compact, wenn deaktiviert. compact ist der gespeicherte Standard und behält jede nützliche Tatsache einmal: `pinId`, comment, cssSelector, domPath und innerText, plus box oder coords nur für Flächen-Pins oder Pins ohne Locator. full behält die ungekürzte Capture. Beide Projektionen entfernen weiterhin data:-Screenshot-URLs aus dem JSON; ein Inline-Bild wird als null-URL und screenshot_inline-Warnung gespeichert, damit der Prompt begrenzt bleibt.",
            "Klicken Sie auf Save, damit preferences:set handoffMode und `includeScreenshot` in das aktive Backend und chrome.storage.sync schreibt. Unbekannte handoffMode-Werte fallen auf compact zurück; `includeScreenshot` ist standardmäßig true. Adapter-Ziele sind cursor, claude, codex und grok: jedes stellt die eigene Präambel voran, aber `captureId`, pinIds und comments bleiben identisch. Der copy-viewer-content-Schalter ist deaktiviert, sobald includeViewer aus ist.",
          ],
          bullets: [
            "Setzen Sie den compact/full-Schalter und den `includeScreenshot`-Schalter und klicken Sie vor dem nächsten Kopieren auf Save.",
            "Lassen Sie `includeScreenshot` an, es sei denn, Sie wollen bewusst Metadaten, Pins, Locator und Handoff ohne Bildspeicherung.",
            "Kopieren Sie nach dem Speichern einmal und bestätigen Sie, dass jeder Adapter-Paste weiterhin dieselbe `captureId` und dieselben pinIds teilt.",
          ],
        },
      ],
    },
    "closed-loop-review": {
      title: "Die Agent-Review-Schleife schließen",
      summary:
        "Verfolgen Sie, was ein Agent geändert hat, prüfen Sie es als Mensch und öffnen Sie nur erneut, wenn eine weitere Korrektur nötig ist.",
      sections: [
        {
          heading: "Agent-Rückmeldung",
          paragraphs: [
            "Ein Agent kann jeden Pin als changed, blocked, not applicable oder not located melden, mit summary, reason, geänderten Dateien, commit und pull request. Wiederholte Zustellung mit demselben Idempotenzschlüssel ist sicher; widersprüchlicher Inhalt unter diesem Schlüssel wird abgelehnt.",
          ],
        },
        {
          heading: "Menschliche Prüfung",
          paragraphs: [
            "Ein changed-Ergebnis setzt einen open- oder reopened-Pin auf correction ready. Nur ein Mensch kann eine Korrektur akzeptieren oder einen accepted-Pin erneut öffnen. Agenten können ihre eigene Arbeit nicht akzeptieren, und ungültige Zustandsübergänge werden abgelehnt.",
          ],
          bullets: [
            "Normaler Ablauf: open → correction ready → accepted.",
            "Wenn die Prüfung fehlschlägt: accepted → reopened → correction ready.",
          ],
        },
        {
          heading: "Eine Ausführung erfassen und als Mensch akzeptieren",
          paragraphs: [
            "POST /api/agent-executions mit agent gesetzt auf claude, codex, cursor oder grok, der `captureId` der Capture, einem idempotencyKey von 8 bis 128 Zeichen passend zu [A-Za-z0-9_-] und einem nicht leeren results-Array. Jedes Ergebnis braucht eine `pinId`, die auf dieser Capture bereits existiert, einen status und eine summary von höchstens 2000 Zeichen; optionale files sind auf 50 Pfade begrenzt, und pullRequest muss eine http(s)-URL sein. Ein widersprüchlicher Fingerprint unter demselben Schlüssel ist idempotency_conflict (409). Eine unbekannte `pinId` ist pin_not_found (400) ohne Echo der Capture-Kommentare; eine unbekannte `captureId` ist capture_not_found (404).",
            "Die menschliche Prüfung ist ein separates POST an /api/sessions/{id}/pins/{`pinId`}/review mit action accept oder reopen. humanActionsForStatus bietet accept nur in correction_ready und reopen nur in accepted; open und reopened zeigen keine menschlichen Aktionen, und jeder andere Übergang ist invalid_transition (409). Nach einem menschlichen reopen ist eine zweite changed-Ausführung der vorgesehene Retry. Lassen Sie Share anonymous loop metrics aus, sofern Sie nicht opt-in: comments, URLs, selectors und screenshots werden als forbidden_fields abgelehnt, selbst wenn optIn true ist.",
          ],
          bullets: [
            "Veröffentlichen Sie ein changed-Ergebnis für dieselbe `captureId` und `pinId` und bestätigen Sie, dass der Viewer correction_ready zeigt, bevor Sie akzeptieren.",
            "Verwenden Sie einen idempotencyKey nur mit demselben Fingerprint erneut; erzeugen Sie einen neuen Schlüssel, wenn sich files, summary oder status tatsächlich geändert haben.",
            "Wenn die Prüfung fehlschlägt, öffnen Sie als Mensch erneut, veröffentlichen Sie ein zweites Ergebnis, akzeptieren Sie erneut und behalten Sie die Capture-IDs vorher und nachher.",
          ],
        },
      ],
    },
    "reopen-and-relocate": {
      title: "Pins erneut öffnen und neu verorten",
      summary:
        "Prüfen Sie die Umsetzung auf der Live-Seite, auch nachdem sich das DOM geändert hat.",
      sections: [
        {
          heading: "Sichere Rehydrierung",
          paragraphs: [
            "Pinar öffnet die gespeicherte Seite und hydriert nur, wenn der Origin des aktiven Tabs exakt zur Capture passt. Vertrauenswürdige App-Origins können ein reopen anfordern, aber eine fremde Site kann keine Session in die Erweiterung injizieren.",
          ],
        },
        {
          heading: "Manuelle Korrektur",
          paragraphs: [
            "Wenn ein Ziel ambiguous oder unresolved ist, positionieren Sie den Pin manuell neu. Der ursprüngliche Anker und die Box bleiben in der Historie eingefroren, und jede automatische oder manuelle Relokation wird für die spätere Prüfung aufgezeichnet.",
          ],
        },
        {
          heading:
            "Die ursprüngliche URL öffnen und ausstehende Pins platzieren",
          paragraphs: [
            "session:reopen wird nur von einem vertrauenswürdigen Pinar-App-Origin akzeptiert: https auf pinar.dev oder einem *.pinar.dev-Host oder http auf Loopback-Ports 17373 bis 17382. Der Helper ruft /api/sessions/{id} ab und öffnet einen neuen Tab unter der gespeicherten Seiten-URL. Jede andere Site erhält untrusted_app. Eine angeforderte id, die weder session.id noch `captureId` entspricht, ist session_mismatch; eine Capture ohne page.url ist missing_page. Nach dem Laden injiziert die Hydrierung in jeden Frame und behält nur Pins, deren DOM-Pfad zu diesem Frame gehört.",
            "Die Hydrierung läuft nur weiter, solange der Tab-Origin noch zur Capture passt. Wegnavigieren löst die Bindung und zeigt This page is not the original capture URL; about:blank gilt als transient und löst sie nicht. Ambiguous- oder unresolved-Locator-Treffer lassen die Live-Box unverändert, statt auf ein ähnliches Element zu springen. Klicken Sie auf einen ausstehenden Pin, dann auf das korrekte Element: Selektor, Pfad und Fingerprint bleiben eingefroren, location wird exact mit evidence manual-reposition, und locationHistory hängt einen Eintrag manual exact an.",
          ],
          bullets: [
            "Starten Sie Review on page aus der Pinar-App, damit nur diese Session auf dem erfassten Origin hydriert.",
            "Wenn das Overlay This page is not the original capture URL sagt, kehren Sie zum erfassten Origin zurück, statt Pins zu platzieren.",
            "Bei einem unresolved Pin klicken Sie auf die Markierung, dann auf das Live-Element, und bestätigen Sie, dass locationHistory einen Eintrag manual exact erhalten hat.",
          ],
        },
      ],
    },
    "handoff-troubleshooting": {
      title: "Kopier- und Übergabewarnungen beheben",
      summary:
        "Zwischenablage-, Helper-, Screenshot- oder Viewer-Fehler beheben, ohne die Annotationen zu verlieren.",
      sections: [
        {
          heading: "Wiederherstellung der Zwischenablage",
          paragraphs: [
            "Pinar verwendet zuerst die Clipboard-API des Browsers über ein Offscreen-Dokument und fällt auf eine versteckte Textauswahl zurück, wenn Berechtigung oder Fokus sie blockieren. Wenn jeder Kopiermechanismus fehlschlägt, wird das Overlay wiederhergestellt, sodass Ihre Pins und Kommentare bearbeitbar bleiben.",
          ],
        },
        {
          heading: "Eingeschränkt bedeutet nicht unkorreliert",
          paragraphs: [
            "`screenshot_missing` bedeutet, dass das Bild nicht gespeichert werden konnte. `helper_unavailable` bedeutet, dass der lokale Dienst nicht erreicht wurde. `viewer_unavailable` bedeutet, dass keine Viewer-URL erzeugt wurde. Machen Sie mit Kommentar, DOM-Pfad, Selektor, Pin-Koordinaten, `captureId` und `pinId` weiter und wiederholen Sie nur die fehlende Ebene.",
          ],
        },
        {
          heading:
            "Den Kopierpfad nachvollziehen, wenn die Symbolleiste einen Fehler meldet",
          paragraphs: [
            "Zum Kopieren sind ein gespeicherter Kommentar und mindestens ein Pin erforderlich. Die Symbolleiste zeigt Copying…, blendet Overlays aus, erfasst den Screenshot und fordert das Offscreen-Dokument auf, text/html und text/plain zu schreiben. Offscreen versucht zuerst navigator.clipboard.write und fällt auf ein copy-Ereignis plus execCommand zurück. Wenn dieses Schreiben nicht ok ist, versucht das Content-Skript weiterhin writePlainText auf der zurückgegebenen Plain-Payload: clipboard.writeText, dann eine versteckte Textarea-Auswahl.",
            "Wenn jeder Kopierpfad fehlschlägt, sendet die Seite overlays:hidden mit hidden false, zeigt kurz Copy failed und lässt Pins bearbeitbar. Ein erfolgreiches Kopieren zeigt Copied oder Copied plus no screenshot, helper unavailable oder no viewer und beendet dann die Sitzung. Diese Suffixe entsprechen `screenshot_missing`, `helper_unavailable` und `viewer_unavailable`. screenshot_inline gehört nicht zu den eingeschränkten Übergabewarnungen. Ein Einfügen ohne geschlossene pinar-visual-context-Fence kann nicht als JSON geparst werden.",
          ],
          bullets: [
            "Wenn die Symbolleiste Write a comment first oder Add a pin first anzeigt, schließen Sie diesen Pin ab und drücken Sie erneut Command/Ctrl+Enter.",
            "Wenn Copy failed erscheint, bestätigen Sie, dass die Pins noch auf der Seite sind, erteilen Sie bei Aufforderung die Zwischenablageberechtigung und wiederholen Sie das Kopieren.",
            "Lesen Sie das Copied-Suffix: no screenshot, helper unavailable und no viewer benennen die fehlende Ebene, die Sie ohne Verwerfen der Kommentare erneut versuchen können.",
          ],
        },
      ],
    },
    "organize-projects": {
      title: "Projekte und Sitzungen organisieren",
      summary:
        "Captures verschieben, ohne sie zu verlieren, und Personal als geschützten Fallback behalten.",
      sections: [
        {
          heading: "Projekte und Fallback",
          paragraphs: [
            "Projekte gruppieren Collections und Sitzungen. Personal ist das geschützte Standardprojekt und Inbox ist seine geschützte Collection. Das Löschen eines anderen Projekts überführt dessen Sitzungen in den Fallback, anstatt sie zu zerstören.",
          ],
        },
        {
          heading: "Verschieben und sortieren",
          paragraphs: [
            "Ziehen Sie Sitzungen zwischen Collections, ordnen Sie sie neu oder nutzen Sie Move to in der Sammelaktion für eine Auswahl. In einer Collection passen Move Earlier und Move Later die gespeicherte manuelle Reihenfolge an.",
          ],
        },
        {
          heading: "Prüfen, wo eine verschobene Sitzung landet",
          paragraphs: [
            "Öffnen Sie eine Collection, bevor Sie Move Earlier oder Move Later verwenden. Diese Einträge erscheinen nur in einer Collection-Ansicht, tauschen die Sitzung mit ihrem Nachbarn in der gespeicherten Positionsliste und tun in der ersten oder letzten Zeile nichts. Das Dashboard sendet diese vollständige id-Liste anschließend per POST an `/api/collections/{id}/sessions/reorder`. Wenn keine Collection ausgewählt ist, sortiert die Liste nach Erstellungsdatum statt nach dieser gespeicherten Reihenfolge.",
            "Ein Ziehen beginnt an der Karte oder Tabellenzeile, nicht über Suche, Kontrollkästchen oder das Aktionsmenü (`data-no-dnd`). Wenn die gezogene Sitzung bereits mit anderen ausgewählt ist, wandern alle ausgewählten ids mit; andernfalls wird nur diese Sitzung verschoben. Move to fragt nach einem Projekt, dann nach einer Collection im abgeflachten Baum dieses Projekts; ein Projektwechsel leert das Collection-Feld, und ein Projekt ohne Collections ist deaktiviert. Die Sitzung wird an der nächsten Position im Ziel angehängt. Das Löschen von Personal wird abgelehnt; das Löschen eines anderen Projekts hängt dessen Sitzungen in bestehender Reihenfolge an Inbox an und entfernt die Collections dieses Projekts.",
          ],
          bullets: [
            "Wählen Sie eine Collection aus und nutzen Sie Move Earlier oder Move Later nur, wenn ein Nachbar existiert; die erste Zeile kann nicht früher und die letzte nicht später verschoben werden.",
            "Um mehrere Sitzungen zu verschieben, wählen Sie sie zuerst aus und ziehen Sie dann eine ausgewählte Karte oder öffnen Sie Move to; das Ziehen einer nicht ausgewählten Karte verschiebt nur diese Sitzung.",
            "Nach dem Löschen eines Nicht-Personal-Projekts öffnen Sie Personal / Inbox und prüfen Sie das Ende der Liste auf die angehängten Sitzungen, bevor Sie sie erneut einsortieren.",
          ],
        },
      ],
    },
    "nested-collections": {
      title: "Verschachtelte Collections verwenden",
      summary:
        "Bauen Sie in jedem Projekt eine Hierarchie auf und ordnen Sie sie neu, ohne Kindbeziehungen abzuflachen.",
      sections: [
        {
          heading: "Collection-Baum",
          paragraphs: [
            "Collections können über- und untergeordnete Collections haben. Das Ziehen eines Zweigs erhält Tiefe und Nachfahrenbeziehungen, während er innerhalb desselben Projektbaums verschoben wird. Zyklen, unbekannte Eltern und Verschachtelung unter einem geschützten Container werden abgelehnt. Das Löschen eines Elternelements stuft seine Kind-Collections in bestehender Reihenfolge auf die Elternebene hoch.",
          ],
        },
        {
          heading: "Ziele beim Capture",
          paragraphs: [
            "Die Erweiterung kann vor dem Speichern in die Cloud ein Projekt oder eine Collection als Ziel wählen. Wenn ein ausgewähltes Ziel nicht mehr verfügbar ist, hält der geschützte Personal/Inbox-Fallback die Sitzung erreichbar.",
          ],
        },
        {
          heading: "Einen Zweig einrücken und dann das Elternelement prüfen",
          paragraphs: [
            "Beim Ziehen einer Collection wird der horizontale Versatz in 18-Pixel-Einrückungsschritten gemessen. Die projizierte Tiefe wird so begrenzt, dass sie nicht tiefer als eine Ebene unter dem vorherigen Geschwisterelement und nicht flacher als das nächste Geschwisterelement werden kann. Das Ablegen eines Zweigs auf einem seiner Nachfahren wird ignoriert, und der Baum bleibt unverändert. Geschützte Collections bleiben auf Tiefe 0, und die sortierbare Liste behandelt Kinder einer geschützten Collection als Wurzeln, sodass sie nicht unter diesem geschützten Container verschachtelt bleiben können.",
            "Im Zielauswähler der Erweiterung gibt `destination:get` ein CaptureDestination (`projectId` und `collectionId`) plus den Projektbaum zurück, wobei verschachtelte Collections um 16 Pixel pro Tiefe eingerückt sind. Ein Projektwechsel speichert sofort die geschützte Collection dieses Projekts, falls eine existiert, andernfalls die erste Collection. Wenn `destination:set` fehlschlägt, zeigt die Optionsseite den destination-unavailable-Fehler und lädt `destination:get` neu, damit eine fehlende Collection nicht ausgewählt bleibt. Ein leerer Baum zeigt einen deaktivierten Inbox-Platzhalter.",
          ],
          bullets: [
            "Ziehen Sie eine Collection nach rechts, um sie unter dem vorherigen Geschwisterelement zu verschachteln, oder nach links zur Wurzel; wenn das Ablegen abgelehnt wird, bleibt die parentId-Liste unverändert.",
            "Klappen Sie ein Elternelement nur ein, wenn Sie eine kürzere Seitenleiste brauchen; ausgeblendete Nachfahren bleiben im Baum und bewegen sich weiterhin mit dem gezogenen Zweig.",
            "Nach einem Fehler beim Speichern des Ziels öffnen Sie die Erweiterungsoptionen erneut und bestätigen Sie, dass Projekt und Collection einem aktuellen Baumeintrag entsprechen, bevor der nächste Cloud-Capture erfolgt.",
          ],
        },
      ],
    },
    "find-manage-share": {
      title: "Sitzungen finden, verwalten und teilen",
      summary:
        "Durchsuchen Sie jedes nützliche Feld, filtern Sie Review-Arbeit, führen Sie Sammelaktionen aus und veröffentlichen Sie nur, was Sie beabsichtigen.",
      sections: [
        {
          heading: "Suche und Ansichten",
          paragraphs: [
            "Die Suche findet Treffer in Seitentitel, URL, Beschreibung, Pin-Kommentaren und CSS-Selektoren. Filter für Pin-Anzahl und Review-Status können kombiniert werden. Wechseln Sie zwischen Kartenraster und Tabelle; die Tabelle bietet 15, 30, 60 oder 100 Zeilen pro Seite und merkt sich die Ansicht lokal.",
          ],
        },
        {
          heading: "Sammel- und Freigabeaktionen",
          paragraphs: [
            "Wählen Sie Sitzungen in jeder der beiden Ansichten aus, um sie gemeinsam zu verschieben oder zu löschen. Das Löschen einer Sitzung ist dauerhaft: Es entfernt den Screenshot sowie Agent-Ausführungen, Pin-Ergebnisse, Reviews und Review-Ereignisse. Öffentliche Viewer für Sitzungen, Projekte und Collections sind unlisted statt zugriffskontrolliert; jede Person mit einem gültigen Link kann einen öffnen. Aggregierte Viewer können kombiniertes Markdown für jede enthaltene Sitzung kopieren.",
          ],
        },
        {
          heading: "Filter kombinieren und dann öffentliches Markdown kopieren",
          paragraphs: [
            "Die Suche entfernt umgebende Leerzeichen und sucht als groß-/kleinschreibungsunabhängige Teilzeichenkette. Eine nur aus Leerzeichen bestehende Abfrage lässt jede Sitzung zu, bis Filter für Pin-Anzahl oder Review-Status sie ausschließen. Die Kontrollkästchen für die Pin-Anzahl sind Buckets von 1, 2–5 und 6 oder mehr; eine Sitzung muss mindestens einem ausgewählten Bucket entsprechen. Review-Status-Filter laufen gegen gespeicherte reviewCounts; fehlen diese Zählungen, wird jeder Pin als open behandelt. Das Ändern von Suche, einem der Filter, Collection oder Projekt setzt die Paginierung auf die erste Seite zurück.",
            "Grid-select-all gilt nur für die aktuelle Kartenseite; Tabellen-select-all nutzt die aktuelle Tabellenseite. Die Wahl zwischen Raster und Tabelle wird in localStorage als `pinar-history-view` gespeichert. Sammellöschen öffnet einen Bestätigungsdialog und sendet dann DELETE `/api/history/{id}` für jede ausgewählte id. Ein öffentlicher Projekt- oder Collection-Viewer lädt `/api/public/projects/{id}` oder `/api/public/collections/{id}` und kopiert kombiniertes Markdown von `/p/{id}.md` oder `/c/{id}.md`. Wenn dieser öffentliche Abruf nicht ok ist, zeigt der Viewer einen not-found-Zustand statt einer Liste.",
          ],
          bullets: [
            "Bestätigen Sie nach dem Anwenden von Suche oder Filtern, dass die Paginierung auf Seite 1 gesprungen ist, damit Sie keine veraltete Seite eines älteren Ergebnissatzes lesen.",
            "Nutzen Sie Move to oder Delete in der Sammel-Symbolleiste erst, wenn die Kontrollkästchen den gewünschten Sitzungen entsprechen; Clear selection leert die Menge, ohne den Speicher zu ändern.",
            "In einem aggregierten Viewer sollte Copy Markdown eine Überschrift, eine `/p/`- oder `/c/`-Viewer-URL und dann jede Sitzung als `/v/{id}`-Überschrift mit Page, Markdown, optionalem Screenshot und nummerierten Pin-Kommentaren einfügen; wenn das Kopieren mit Unable to load Markdown fehlschlägt, öffnen Sie dieselbe `.md`-URL im Browser.",
          ],
        },
      ],
    },
    "account-and-sign-in": {
      title: "Konto und passwortlose Anmeldung",
      summary:
        "Verbinden Sie die Erweiterung, öffnen Sie den Web-Workspace und verstehen Sie den Ablauf von Codes und Sitzungen.",
      sections: [
        {
          heading: "Zwei Code-Abläufe",
          paragraphs: [
            "Remote-Free-Installationen können die Web-App mit einem fünf Minuten gültigen, einmaligen Erweiterungscode öffnen. Das Erstellen eines neuen achtstelligen Codes macht den zuvor aktiven ungültig; die Erzeugung erlaubt 10 Anfragen pro fünf Minuten pro IP und Konto, der Austausch erlaubt 20 Versuche pro fünf Minuten pro IP. Bezahlte und zuvor bezahlte Konten können außerdem einen sechsstelligen E-Mail-Code anfordern; er läuft nach zehn Minuten ab und sperrt nach fünf ungültigen Versuchen.",
          ],
        },
        {
          heading: "Sitzungen",
          paragraphs: [
            "Web-Sitzungen gelten 30 Tage und authentifizierte Erweiterungsgeräte 180 Tage. Der Server speichert Hashes von Codes und Sitzungstoken statt der ursprünglichen Geheimwerte.",
          ],
        },
        {
          heading: "Kopplung im Account-Tab der Erweiterung abschließen",
          paragraphs: [
            "Öffnen Sie bei einer Remote-Free-Installation den Account-Tab der Erweiterungsoptionen, erzeugen Sie dort den temporären Code und kopieren Sie ihn. Öffnen Sie die gehostete Anmeldeseite über denselben Tab; der Link zielt auf /sign-in mit returnTo=/app, sodass ein erfolgreicher Austausch im Web-Workspace landet. Das erneute Erzeugen fragt zuerst nach Bestätigung, weil der Server jeden ungenutzten Code dieses Inhabers löscht, bevor der neue achtstellige Wert eingefügt wird. Fügen Sie den Code auf pinar.dev ein, nicht auf loopback: Der lokale Helper leitet /sign-in zur gehosteten Origin um und stellt selbst keine Cloud-Sitzungen aus.",
            "Das Anfordern eines E-Mail-Codes meldet immer accepted mit einem Zehn-Minuten-Hinweis, auch bei unbekannten Adressen, unbezahlten Konten oder fehlendem Mail-Dienst, sodass das Formular kein Konto-Orakel ist. Eine echte sechsstellige Nachricht wird nur an ein jemals bezahltes Konto gesendet; wenn die Zustellung einen Fehler wirft, wird diese Challenge-Zeile gelöscht. E-Mail-Anfragen erlauben 10 Versuche pro IP und 5 pro Adresse pro 15 Minuten; die Verifizierung erlaubt 20 pro IP und 10 pro Adresse pro 15 Minuten. Das Absenden des Codes zusammen mit der Installationsidentität migriert diesen Remote-Free-Workspace auf das bezahlte Konto und stellt ein 180-Tage-Gerätetoken aus. Sign-out widerruft das pinar_session-Cookie und jeden in derselben Anfrage übermittelten Device-Bearer.",
          ],
          bullets: [
            "Wenn keine E-Mail ankommt, warten Sie das 15-Minuten-Anfragefenster ab, bevor Sie es erneut versuchen; 429 bedeutet, dass das IP- oder Adresslimit erreicht wurde, während eine stille accepted-Antwort bedeuten kann, dass die Adresse unbezahlt oder unbekannt ist.",
            "Bestätigen Sie den Regenerieren-Dialog, bevor Sie einen Code ungültig machen, den Sie noch auf der gehosteten Anmeldeseite eingeben wollen.",
            "Nutzen Sie Sign out im Account-Tab oder POST /api/auth/logout, wenn das aktuelle Web-Cookie oder die Geräte-Sitzung der Erweiterung sofort widerrufen werden soll.",
          ],
        },
      ],
    },
    "plans-and-billing": {
      title: "Free, Pro, Founder und Abrechnung",
      summary:
        "Vergleichen Sie Produktberechtigungen, verwalten Sie ein Abonnement und behandeln Sie die Preisseite als aktuelle Preisquelle.",
      sections: [
        {
          heading: "Planstruktur",
          paragraphs: [
            "Free umfasst dauerhafte lokale Nutzung, 250 MB Cloud-Kontingent, siebentägige Cloud-Aufbewahrung und fünf initiale AI-Credits. Pro ist monatlich oder jährlich mit 5 GB und 200 nicht übertragbaren AI-Credits, die monatlich aufgefüllt werden. Founder ist eine begrenzte einmalige Kohorte mit 5 GB und 500 initialen Credits; eine monatliche Credit-Auffüllung ist nicht enthalten.",
          ],
        },
        {
          heading: "Abrechnung und Verfügbarkeit",
          paragraphs: [
            "Regionale BRL- oder globale USD-Preise, Founder-Verfügbarkeit und aktuelle Angebote gehören zur Plans-Seite. Stripe Checkout reserviert einen Founder-Platz für 15 Minuten und gibt ihn frei, wenn der Checkout abgebrochen wird. Das Stripe-Kundenportal übernimmt Planänderungen, Kündigung, Zahlungsmethoden und Rechnungen.",
          ],
        },
        {
          heading:
            "Checkout mit aktuellen Richtlinien und der richtigen Währung starten",
          paragraphs: [
            "POST /api/stripe/checkout lehnt das Angebot ab, bis die aktuellen Versionen von Terms, Privacy Policy und Acceptable Use akzeptiert sind. Ein Cloudflare-Land BR wählt den BRL-Katalog und die Stripe-Price-IDs für Brasilien; jedes andere Land verwendet USD. Der Founder-Checkout fügt zuerst eine Kapazitätsreservierung ein, Schlüssel sind checkout request id und claim-Hash, und hängt dann die Stripe-session-id an; das Erstellen der Stripe-Sitzung ohne anhängbare Reservierung gibt den Platz frei. FOUNDER_SALES_ENABLED muss true sein und FOUNDER_CAPACITY_LIMIT positiv, sonst gibt der Handler 503 zurück; eine volle Kohorte oder eine claim-Abweichung bei wiederverwendeter request id gibt 409 zurück.",
            "Die Erfolgs-URL trägt session_id und claim; die Aktivierung hasht diesen claim gegen Stripe-Metadaten und gewährt erst dann das Angebot. GET /api/pricing stellt founderState als closed, sold_out oder available bereit, damit die Plans-Seite eine Kohorte ausblenden kann, die der Checkout ablehnen würde. Das Abrechnungsportal erfordert ein authentifiziertes Konto, das bereits eine stripeCustomerId hat, und kehrt zu /app zurück. Wenn die Pro-Abrechnung nicht mehr active ist, erhalten Sitzungen dieses Plans ein retention_expires_at 90 Tage nach Ende der bezahlten Berechtigung; Founder- und Legacy-Lifetime-Konten behalten Sitzungen als permanent markiert, statt diesen Ablaufpfad zu betreten.",
          ],
          bullets: [
            "Akzeptieren Sie die aktuellen Richtlinienversionen im gehosteten Plans-Ablauf vor der Zahlung; eine fehlende Annahme gibt legal_acceptance_required statt einer Stripe-URL zurück.",
            "Wenn der Founder-Checkout 409 zurückgibt, laden Sie /api/pricing neu: closed oder sold_out bedeutet, auf eine freigegebene Reservierung zu warten oder Pro zu wählen, statt denselben claim mit einer neuen request id erneut zu versuchen.",
            "Wenn das Portal 401 oder 404 No Stripe customer found zurückgibt, schließen Sie zuerst einen bezahlten Checkout ab, damit eine customer id existiert, und öffnen Sie dann Manage subscription aus einer Kontositzung.",
          ],
        },
      ],
    },
    "ai-credits": {
      title: "AI-Zusammenfassungen und Credits",
      summary:
        "Erfahren Sie, wann Credits reserviert, verbraucht, aufgefüllt oder erstattet werden.",
      sections: [
        {
          heading: "Kosten der Zusammenfassung",
          paragraphs: [
            "Eine Sitzungszusammenfassung reserviert 100 AI-Credits vor der Modellinferenz. Bei Erfolg wird die Reservierung verbraucht. Eine fehlgeschlagene oder abgebrochene Inferenz erstattet sie sofort; eine länger als fünf Minuten unerledigte Reservierung wird automatisch erstattet. Zusammenfassungen erlauben 10 Anfragen pro Minute pro Konto und 30 pro Minute pro IP; eine doppelte Anfrage für dieselbe Sitzung wartet, bis die aktive Anfrage fertig ist.",
          ],
        },
        {
          heading: "Guthaben",
          paragraphs: [
            "Gekaufte Pakete fügen 1.000 Credits hinzu. Die monatliche 200-Credit-Zuteilung von Pro wird nicht übertragen. Die 500 Credits von Founder sind ein Aktivierungsguthaben, keine monatliche Zuteilung. Das Kontomenü zeigt das aktive Guthaben und das nächste zutreffende Auffülldatum.",
          ],
        },
        {
          heading:
            "Zusammenfassungen mit einer neuen request id wiederholen und das Ledger lesen",
          paragraphs: [
            "POST /api/ai/session-summary erfordert eine eindeutige requestId plus eine Sitzung, die Ihnen gehört. Die Wiederverwendung derselben requestId für diese Sitzung gibt die gespeicherte Erfolgs-Payload oder 409 ai_request_in_progress zurück, solange die Inferenz noch reserviert ist. Nach dem fünfminütigen Reservierungs-Timeout wird die Nutzung als reservation_timeout erstattet, und der nächste Aufruf muss eine neue requestId verwenden; ein zeitlich abgelaufener Retry, der noch nicht erstatten kann, gibt 503 ai_refund_pending zurück. Eine fehlgeschlagene oder abgebrochene Inferenz erstattet sofort, wenn möglich. Zu geringes Guthaben gibt 402 insufficient_ai_credits mit dem aktuellen Guthaben zurück. Fehlendes Workers AI gibt 503 ai_unavailable zurück.",
            "Der Grant-Picker verbraucht zuerst Nicht-Kauf-Guthaben, dann den zuerst ablaufenden Grant, sodass monatlich enthaltene Credits, die zum nächsten UTC-Monat ablaufen, vor einem gekauften Paket verwendet werden. Ein gekauftes 1.000-Credit-Paket wird mit einem 12-Monats-expires_at gespeichert und fällt aus der Guthabenabfrage, sobald dieser Zeitstempel überschritten ist. GET /api/account/entitlements gibt die summierten Rest-Credits, nextExpiryAt und nextRefillAt für Founder-Konten und für Pro-Konten mit billing_status active zurück. Die angeforderte Sprache der Zusammenfassung muss de, en, es, fr, ja, pt oder zh sein; jeder andere Wert wird als English geschrieben.",
          ],
          bullets: [
            "Bei 409 ai_request_in_progress warten Sie, bis die laufende requestId fertig ist, statt eine zweite Zusammenfassung derselben Sitzung zu öffnen.",
            "Bei ai_request_refunded oder reservation_timeout senden Sie eine neue requestId; das Wiederholen der abgelaufenen id startet keine weitere Inferenz.",
            "Wenn der Workspace null Credits anzeigt, rufen Sie /api/account/entitlements auf und vergleichen Sie nextExpiryAt mit gekauften Paketen, bevor Sie ein weiteres 1.000-Credit-Angebot kaufen.",
          ],
        },
      ],
    },
    "storage-and-retention": {
      title: "Speicher, Aufbewahrung und Wiederherstellung",
      summary:
        "Kontingente, auslaufende Add-ons, blockierte Uploads und das Wiederherstellungsfenster verstehen.",
      sections: [
        {
          heading: "Kontingent und Add-ons",
          paragraphs: [
            "Free hat 250 MB Basis-Cloud-Speicher; Pro und Founder haben 5 GB. Optionale 5-GB- und 20-GB-Speicher-Add-ons gelten 12 Monate, mit Erinnerungs-E-Mails sieben Tage und einen Tag vor Ablauf. Screenshot-Uploads müssen gültige PNG-Dateien sein und eine atomare Kontingentprüfung vor der Speicherung bestehen. Uploads werden pausiert, wenn die resultierenden Bytes das aktuelle Kontingent überschreiten.",
          ],
        },
        {
          heading: "Nach Ablauf der Berechtigung",
          paragraphs: [
            "Wenn eine auslaufende Berechtigung das Konto über dem Kontingent hinterlässt, gewährt Pinar eine 30-tägige Nachfrist, gefolgt von Wiederherstellungszugriff bis Tag 90. Danach werden überschüssige Daten bereinigungsberechtigt. Die automatische Löschung ist derzeit nicht aktiviert, daher ist die Berechtigung kein Versprechen einer sofortigen Löschung.",
          ],
        },
        {
          heading:
            "Ersetzungen unter das Kontingent bringen und die 90-Tage-Wiederherstellungsuhr nutzen",
          paragraphs: [
            "Das Kontingent ist `baseBytes` plus noch aktive Add-on-Bytes. `canStoreBytes` behandelt ein Überschreiben als `usedBytes` minus die bereits für diese Sitzung gespeicherten Bytes plus die eingehende Größe, sodass das Ersetzen einer größeren PNG durch eine kleinere gelingen kann, wenn eine brandneue Capture das Kontingent überschreiten würde. `uploadAllowed` ist false, sobald `usedBytes` bereits am oder über dem Kontingent liegt. Überkontingent ohne `latestExpiredAt`-Zeitstempel ist der Zustand over_quota ohne Nachfrist-Uhr. Wenn `latestExpiredAt` von einem abgelaufenen Add-on oder von `paidEligibilityEndedAt` gesetzt ist, befindet sich das Konto 30 Tage in grace, ist bis Tag 90 recoverable und danach cleanup_eligible; Uploads bleiben in allen drei Zuständen unzulässig.",
            "Nicht permanente Free-Cloud-Sitzungen werden nach sieben Tagen löschberechtigt. Pro-Inhalte oberhalb des Free-Kontingents folgen nach Ende der bezahlten Berechtigung der 30-tägigen Nachfrist und dem 90-tägigen Wiederherstellungsfenster. Founder- und Legacy-Lifetime-Inhalte werden nicht allein deshalb löschberechtigt, weil kein wiederkehrendes Abonnement besteht; sie bleiben durch gekauftes Kontingent, Benutzerlöschung, Missbrauchs- und Rechtssperren, Kontoschließung und Dienstbeendigung begrenzt. Ausschließlich lokaler Verlauf auf dem Gerät wird niemals remote gelöscht. Löschberechtigung ist kein Versprechen einer sofortigen Entfernung, und die gehostete automatische Löschung ist bewusst nicht aktiviert.",
          ],
          bullets: [
            "Wenn neue Captures pausieren, senken Sie `usedBytes` unter das verbleibende Kontingent, indem Sie Sitzungen löschen oder einen umfangreichen Screenshot ersetzen, oder erwerben Sie ein zwölfmonatiges 5-GB- oder 20-GB-Add-on.",
            "Wenn der Berechtigungszustand grace oder recoverable ist, exportieren Sie alles noch Benötigte vor Tag 90 nach `latestExpiredAt`; cleanup_eligible kennzeichnet nur den Überschuss und löscht selbst nicht.",
            "Erwarten Sie nicht, dass das Deinstallieren der Desktop-App Cloud-Objekte bereinigt, und erwarten Sie nicht, dass die Cloud den lokalen Verlauf unter ~/.pinar löscht.",
          ],
        },
      ],
    },
    "sharing-links": {
      title: "Sitzungen, Projekte und Sammlungen teilen",
      summary:
        "Unlisted Viewer und Markdown-Projektionen mit den richtigen Datenschutzerwartungen nutzen.",
      sections: [
        {
          heading: "Unlisted öffentliche Links",
          paragraphs: [
            "Cloud-Viewer gibt es für eine Sitzung, ein Projekt oder eine Sammlung. Sie sind für alle öffentlich, die den Link haben, und werden nicht wie die normale Navigation indexiert. Behandeln Sie eine unlisted URL nicht als Authentifizierung für sensible Inhalte.",
          ],
        },
        {
          heading: "Markdown für Agenten",
          paragraphs: [
            "Die .md-Projektion einer Sitzung enthält Metadaten, Screenshot-Referenzen, Locators, Agent-Ergebnisse und den Review-Verlauf. Projekt- und Sammlungsprojektionen fassen ihre Sitzungen zusammen. Abgelaufene oder nicht verfügbare geteilte Daten liefern eine not-found-Antwort statt privater Kontodetails.",
          ],
        },
        {
          heading:
            "Die öffentliche Markdown-Projektion kopieren und wissen, was sie preisgibt",
          paragraphs: [
            "Unlisted HTML liegt unter /v/{id} für eine Sitzung, /p/{id} für ein Projekt und /c/{id} für eine Sammlung. Die Markdown-Projektion ist derselbe Pfad mit einem .md-Suffix. Der Aggregat-Viewer lädt /api/public/projects/{id} oder /api/public/collections/{id} ohne Auth-Cookie; Copy Markdown führt dann GET auf /p/{id}.md oder /c/{id}.md aus und schreibt den Text in die Zwischenablage, und jede Sitzungskarte öffnet /v/{id}. Eine fehlende oder fehlerhafte id gibt Session not found, Project not found oder Collection not found zurück, nicht die E-Mail des Inhabers, den Plan oder andere Kontofelder.",
            "Sitzungs-Markdown wird aus dem Handoff-Bundle plus den Abschnitten agent-result und pin-review aufgebaut. Projekt- und Sammlungs-Markdown listen jede verschachtelte Sitzung mit Seiten-URL, /v/{id}.md, optionaler Screenshot-URL, Pin-Kommentaren, `pinId`, DOM-Pfad, selector und inner text. Screenshot-Zeilen erscheinen nur, wenn die `includeScreenshot`-Delivery-Präferenz des Inhabers sie zulässt. Markdown und öffentliches JSON werden als public max-age=60 zwischengespeichert; Shot-PNGs werden 86400 Sekunden zwischengespeichert. Jeder, der den Link öffnen kann, kann kopieren, was er sieht; eine unlisted URL ist daher keine Autorisierung und keine Datenminimierung.",
          ],
          bullets: [
            "Bevor Sie /p/{id} oder /c/{id} versenden, öffnen Sie Copy Markdown einmal und prüfen Sie, dass jede verschachtelte Sitzung, jeder Pin-Kommentar und jede Screenshot-Zeile zur Veröffentlichung geeignet ist.",
            "Deaktivieren Sie die Screenshot-Delivery im Inhaberkonto, wenn die Projektion Bild-URLs auslassen soll; warten Sie mindestens 60 Sekunden, bis der öffentliche Markdown-Cache abläuft.",
            "Wenn ein geteilter Pfad not found anzeigt, behandeln Sie die id als nicht mehr vorhanden oder ungültig; die öffentlichen Handler fügen dieser Antwort niemals private Konto-Diagnosen hinzu.",
          ],
        },
      ],
    },
    "where-data-lives": {
      title: "Wo Ihre Daten liegen",
      summary:
        "Lokale Dateien, Cloud-Persistenz, Browser-Einstellungen und öffentliche Projektionen voneinander trennen.",
      sections: [
        {
          heading: "Lokale Grenze",
          paragraphs: [
            "Lokale Screenshots sind Dateien unter `~/.pinar/shots`, und der lokale Verlauf ist SQLite unter `~/.pinar/history.db`, mit einem JSON-Fallback, wenn SQLite nicht verfügbar ist. Browser-Einstellungen wie Ansicht, Sprache, Theme und Delivery-Einstellungen bleiben im lokalen Browserspeicher, sofern eine Funktion sie nicht ausdrücklich synchronisiert.",
          ],
        },
        {
          heading: "Cloud-Grenze",
          paragraphs: [
            "Cloud-Kontodatensätze und Capture-Metadaten nutzen Cloudflare D1; Bilder nutzen R2. Stripe verarbeitet die Abrechnung, der konfigurierte E-Mail-Dienst sendet Anmeldecodes, und Workers AI erstellt angeforderte Zusammenfassungen. Die Seite Subprocessors ist die aktuelle Liste der externen Dienstrollen.",
          ],
        },
        {
          heading: "Prüfen, welcher Speicher jede Capture tatsächlich hält",
          paragraphs: [
            "Beginnen Sie im Home-Verzeichnis des Helpers und prüfen Sie, welche Datei aktiv ist. Screenshots werden als PNG-Dateien in den Ordner shots geschrieben; der Sitzungsverlauf bevorzugt SQLite unter `history.db`, und `history.json` wird nur geöffnet, nachdem `SqliteHistoryDb` nicht konstruiert werden kann. Ein erfolgreiches Öffnen von SQLite schreibt außerdem verschachtelte shots/shots-Pfadpräfixe auf das kanonische shots-Verzeichnis um. Theme bleibt eine reine Browser-Einstellung: Der Tab Interface speichert dark oder light unter dem localStorage-Schlüssel pinar-theme und löscht diesen Schlüssel für system. Sprache sowie die Schalter im Tab Capture für den Handoff-Modus (full versus compact) und include-screenshot werden im selben Einstellungsdialog bearbeitet, ein angemeldetes Cloud-Konto kann handoff_mode und include_screenshot jedoch in D1 owner_preferences über GET und PATCH /api/preferences persistieren.",
            "Gehostete Captures halten Metadaten in D1 und PNG-Bytes in R2. Nicht authentifizierte öffentliche Projektionen sind GET /shots/{id}.png (Cache-Control max-age 86400), GET /v/{id}.md sowie die Projekt- und Sammlungsrouten /p/ und /c/. POST /api/auth/email-codes speichert nur einen Hash in email_challenges, lässt die Challenge nach zehn Minuten ablaufen und gibt 202 mit { accepted: true, expiresInSeconds: 600 } zurück, selbst wenn EMAIL fehlt oder das Konto nicht everPaid ist, sodass die Antwort nicht preisgibt, ob E-Mail gesendet wurde (429 ist die Rate-Limit-Ausnahme). Angeforderte Zusammenfassungen rufen das Workers-AI-Modell @cf/meta/llama-3.1-8b-instruct-fp8 unter POST /api/ai/session-summary auf. Die Seite Subprocessors nennt Cloudflare für D1, R2, Workers AI und transaktionale E-Mail sowie Stripe für Checkout und weist darauf hin, dass Pinar keine vollständigen Kartendaten erhält. GET /api/legal/current meldet die Richtlinienversion 2026-08-25.",
          ],
          bullets: [
            "Wenn `history.db` fehlt oder SQLite nicht geöffnet werden konnte, behandeln Sie ~/.pinar/history.json als den aktiven lokalen Katalog und rechnen Sie mit einer Konsolenwarnung zum JSON-Fallback.",
            'Öffnen Sie einen gehosteten Screenshot unter /shots/{id}.png und seine Markdown-Projektion unter /v/{id}.md; ein fehlendes R2-Objekt gibt JSON { error: "shot not found" } mit Status 404 zurück.',
            "Bestätigen Sie in den Einstellungen das Interface-Theme über pinar-theme und unterscheiden Sie dann die Capture-Delivery-Schalter von den cloud-synchronisierten Werten handoff_mode und include_screenshot in D1, wenn Sie angemeldet sind.",
          ],
        },
      ],
    },
    "automatic-sanitization": {
      title: "Automatische Bereinigung",
      summary:
        "Sehen Sie, welche URL-, DOM-, Zugangsdaten- und Inline-Bilddaten Pinar vor der Übergabe oder Speicherung entfernt.",
      sections: [
        {
          heading: "Sensible Felder und URLs",
          paragraphs: [
            "Pinar schwärzt Passwort-, Zahlungs-, Token- und OTP-Felder, entfernt URL-Fragmente und streicht bekannte sensible Query-Keys wie access_token, api_key, auth, password, secret, token und jwt. Weitere Query-Key-Namen können Sie in den Erweiterungseinstellungen hinzufügen.",
          ],
        },
        {
          heading: "Strukturierte Übergabe",
          paragraphs: [
            "Der Visual-Context-Parser akzeptiert unterstützte Schemaversionen und schwärzt interne Parse-Fehler, statt Rohgeheimnisse offenzulegen. Inline-Screenshot-Daten werden aus Textübergaben entfernt; das Bundle verwendet stattdessen einen begrenzten Pfad oder eine URL-Referenz.",
          ],
        },
        {
          heading: "Schwärzungsbericht und verworfene Inline-Bilder beobachten",
          paragraphs: [
            "sanitizeCapture klassifiziert die Felder password, otp, payment und token anhand von input type, autocomplete und dem name/id/ariaLabel/role-Haystack und bereinigt anschließend die Seiten-URL. Query-Keys im sensiblen Satz oder Werte, die lookLikeSecret erfüllen (Länge mindestens 12, passend zu einem JWT oder Präfixe wie sk_live_, ghp_, github_pat_ und AIza), werden durch [redacted] ersetzt und als secret-query oder token markiert; Hash-Parameter verwenden secret-hash. Zusätzliche Namen in extraQueryKeys und extraHashKeys werden kleingeschrieben, an Leerzeichen, Kommas oder Semikolons getrennt und mit DEFAULT_SENSITIVE_QUERY_KEYS vereinigt, das außerdem authorization, refresh_token, session, session_id, client_secret, bearer und verwandte Namen über die kurze Übersichtsliste hinaus enthält. Gesammelte Geheimnisse ersetzen anschließend übereinstimmende Teilzeichenfolgen in title, description, URL und Pins. Werte kürzer als vier Zeichen werden selbst bei kategorisiertem Feld nicht als Ersatzgeheimnisse verwendet, und eine URL, die sich nicht parsen lässt, wird unverändert zurückgegeben.",
            "parseVisualCapture akzeptiert schemaVersion 1 oder Legacy 0 und wirft VisualContextError mit der stabilen Meldung invalid visual context und den Codes unsupported_schema, invalid_payload, invalid_pin oder missing_capture_id, statt den Roh-Body zu wiederholen. decodeVisualCaptureJson stellt sich nach JSON- oder Schemafehler wieder her, indem diese `captureId` mit leeren Pins zurückgegeben wird. screenshotFrom und captureForHandoffJson setzen screenshot.url für data:-URLs auf null; der Übergabepfad fügt die Warnung screenshot_inline hinzu, wenn Inline-Bytes entfernt wurden, sodass das Text-Bundle einen Dateisystempfad oder eine http(s)-Referenz statt der Bildnutzlast behält. Das Setzen von input.unevaluated auf true trägt unevaluated im Privacy-Report ein und fügt die Warnung privacy_unevaluated hinzu.",
          ],
          bullets: [
            "Lesen Sie nach sanitizeCapture privacy.redacted sowie die Warnungen privacy_redacted oder privacy_unevaluated; unevaluated true bedeutet, dass einige Bereiche nicht geprüft wurden.",
            "Fügen Sie zusätzliche Query-Key-Namen als kommagetrennte, leerzeichengetrennte oder semikolongetrennte Tokens hinzu; der Abgleich erfolgt unabhängig von der Groß-/Kleinschreibung gegen den integrierten Satz einschließlich authorization, session und refresh_token.",
            "Wenn eingefügtes Übergabe-JSON weiterhin eine data:-Screenshot-URL enthält, hat der Capture captureForHandoffJson übersprungen; der unterstützte Pfad setzt url auf null und kann screenshot_inline hinzufügen.",
          ],
        },
      ],
    },
    "local-security-and-recovery": {
      title: "Lokale Sicherheit und Wiederherstellung",
      summary:
        "Verstehen Sie Capability-Token, vertrauenswürdige Origins, lokale Migrationen und die sichere Startwiederherstellung.",
      sections: [
        {
          heading: "Lokales API-Vertrauen",
          paragraphs: [
            "Die lokale API akzeptiert Loopback und den veröffentlichten Erweiterungs-Origin und prüft anschließend ein Capability-Geheimnis, das mit restriktiven Dateiberechtigungen gespeichert ist. Die Token-Rotation hält das vorherige Geheimnis 24 Stunden gültig, damit aktive Prozesse den neuen Wert übernehmen können; der Widerruf entfernt die Datei und erzwingt eine erneute Autorisierung.",
          ],
        },
        {
          heading: "Sichere Wiederherstellung",
          paragraphs: [
            "Ein veraltetes Tray-PID-Lock wird ersetzt, eine laufende Instanz bleibt unberührt. Stopp und Neustart nutzen zuerst den graceful Pfad des Helpers; unter macOS wird ein festhängender Listener erst beendet, nachdem er über die Wartezeit hinaus responsive bleibt. Beschädigtes Fallback-History-JSON wird auf ein leeres Schema mit geschütztem Personal und Inbox zurückgesetzt. Legacy-Screenshots unter einem verschachtelten shots/shots-Pfad werden migriert, ohne Namenskonflikte zu überschreiben.",
          ],
        },
        {
          heading:
            "Das Capability-Geheimnis vorlegen und einen beschädigten lokalen Store wiederherstellen",
          paragraphs: [
            'Der Helper speichert einen Store der Version 1 unter local-capability.json mithilfe einer temporären 0o600-Datei und Umbenennung. Senden Sie das aktuelle Geheimnis im Header x-pinar-capability oder als Authorization-Bearer-Token. GET /api/local/capability darf das Geheimnis weglassen, wenn Origin leer ist, Loopback-HTTP auf 127.0.0.1, localhost oder ::1, oder chrome-extension:// mit alphanumerischer ID; jeder andere Origin gilt als feindlich und erhält 401 { error: "unauthorized" } mit Cache-Control no-store. HTTPS-Loopback wird nicht als Loopback behandelt. POST /api/local/capability/rotate und /revoke erfordern ein passendes Geheimnis. Die Rotation schreibt ein neues aktuelles Geheimnis und behält previous.secret bis expiresAt (Standard 24 Stunden, überschreibbar mit PINAR_CAPABILITY_GRACE_MS; 0 verwirft previous). Revoke löscht die Datei; der nächste readOrCreateLocalCapability erzeugt einen neuen Store. Gewöhnliche Loopback-Anfragen überspringen das Geheimnis; chrome-extension-Anfragen benötigen eine Übereinstimmung. Als public-min oder local-public-projection klassifizierte Einträge überspringen dieses Gate.',
            "claimInstanceLock belässt eine laufende fremde PID und ruft onDuplicate auf; ein fehlendes oder unlesbares Lock gilt als veraltet und wird mit dieser Prozess-ID überschrieben. migrateNestedShots verschiebt Dateien von shots/shots nach shots und überspringt Namen, die am Ziel bereits existieren; das verschachtelte Verzeichnis wird nur entfernt, wenn die conflicts-Liste leer ist. Shot-IDs werden auf A–Z, a–z, 0–9, Unterstrich und Bindestrich mit höchstens 80 Zeichen reduziert, andernfalls ist die Datei pin.png. Wenn `SqliteHistoryDb` wirft, warnt openHistoryDb und öffnet `history.json`. Eine beschädigte JSON-Datei wird zu leeren Arrays geparst, anschließend erstellt _ensureDefaults das geschützte Projekt Personal und die Collection Inbox für den Owner local neu. Ein fehlgeschlagener JSON-Write protokolliert eine Warnung und bricht den Start nicht ab. Fehlt `history.db`, kann migrateLegacyHistoryDb eine übrig gebliebene history.sqlite aus bin/ oder shots/ in `history.db` umbenennen.",
          ],
          bullets: [
            "Senden Sie x-pinar-capability oder Bearer bei chrome-extension-Aufrufen; GET /api/local/capability bootstrapped über Loopback-HTTP oder chrome-extension, andere Origins erhalten 401 unauthorized.",
            "Nach revoke ist local-capability.json verschwunden; der nächste Helper-Start erzeugt ein neues Geheimnis, und Clients müssen es erneut lesen, bevor rotate oder revoke wieder erfolgreich sind.",
            "Wenn `history.db` nicht geöffnet werden kann, erwarten Sie `history.json`; eine beschädigte JSON-Datei wird zu einem leeren Katalog, anschließend Personal und Inbox für den Owner local, ohne dass der Helper abstürzt.",
          ],
        },
      ],
    },
    "telemetry-and-policies": {
      title: "Telemetrie, Einwilligung und Richtlinien",
      summary:
        "Erfahren Sie, was opt-in ist, welche Richtlinien die Cloud-Nutzung steuern und was Fair Source hier bedeutet.",
      sections: [
        {
          heading: "Closed-Loop-Metriken",
          paragraphs: [
            "Loop-Metriken sind aus, sofern Sie nicht opt-in aktivieren. Wenn deaktiviert, werden Übermittlungen verworfen. Wenn aktiviert, lässt der Sanitizer operative Events, duration, agent und Relocation-Confidence zu, lehnt jedoch Kommentare, Titel, URLs, DOM-Pfade, Selektoren, Screenshots, Markup und Rohinhalte ab.",
          ],
        },
        {
          heading: "Einwilligung und Lizenz",
          paragraphs: [
            "Remote-Persistenz und Checkout erfassen die Annahme der aktuellen Terms, Privacy Policy und Acceptable Use Policy. Retention, Refunds, Fair Source und Subprocessors haben gesonderte veröffentlichte Dokumente. Pinar ist Fair Source/source-available unter der Repository-Lizenz, in den aktuellen Versionen kein OSI-approved Open Source.",
          ],
        },
        {
          heading:
            "Opt-in-Payloads und den veröffentlichten Richtliniensatz prüfen",
          paragraphs: [
            "Loop-Metriken sind standardmäßig aus, weil DEFAULT_LOOP_METRICS_OPT_IN false ist. planLoopMetricRequest gibt send false mit dem Grund opt_in_off zurück, sofern optIn nicht strikt true ist, und loopMetricHttpStatus mappt diesen Code auf HTTP 200. Wenn aktiviert, darf jedes Event-Objekt nur agent, degraded, durationMs, event und locationConfidence enthalten. Unbekannte Keys, verbotene Keys wie url, title, comment, screenshot, selector, path, `captureId`, sessionId, html, markdown, content, pin und page oder String-Werte, die wie http(s)-URLs oder data:-URIs aussehen oder { oder < enthalten, werden zu forbidden_fields (HTTP 400). event muss accepted, correction_ready, handoff, relocation_failed oder reopened sein; agent muss claude, codex, cursor oder grok sein; locationConfidence muss exact, probable, ambiguous oder unresolved sein; durationMs muss eine nicht negative Ganzzahl von höchstens 86.400.000 sein. Ein leerer oder nicht als Array vorliegender events-Wert ist invalid_payload und wird nicht gesendet.",
            "README stellt fest, dass Checkout und die Remote-Registrierung für Free angenommene Richtlinienversionen erfassen, und veröffentlicht Terms, Privacy, Acceptable Use, Retention, Refunds, Fair Source und Subprocessors unter https://pinar.dev/legal/. legal-documents setzt CURRENT_LEGAL_VERSION für alle sieben Dokument-IDs auf 2026-08-25. Terms besagen, dass rein lokale Nutzung, die den gehosteten Dienst nie kontaktiert, kein gehostetes Konto braucht; Privacy besagt, dass rein lokale Daten, die das Gerät nie verlassen, außerhalb der gehosteten Richtlinie liegen. LICENSE ist Functional Source License, Version 1.1, MIT Conversion: zwei Jahre nach der Erstveröffentlichung ist die Change License MIT, und bis zum Change Date dürfen Sie keinen konkurrierenden kommerziellen gehosteten Visual-Annotation-, Screenshot-Preview- oder Cloud-Persistenzdienst anbieten. Der Fair-Source-Hinweis verweist auf LICENSE und ist kein OSI-approved Open Source. Fragen gehen an contact@pinar.dev oder contato@pinar.dev.",
          ],
          bullets: [
            "Lassen Sie Loop-Metriken deaktiviert, sofern Sie nicht optIn true beabsichtigen; ein deaktivierter Plan gibt send false mit opt_in_off zurück und überträgt den Batch nicht.",
            "Öffnen Sie vor gehosteter Persistenz oder Checkout Terms, Privacy und Acceptable Use in der Version 2026-08-25 unter https://pinar.dev/legal/terms, /privacy und /acceptable-use.",
            "Behandeln Sie LICENSE als maßgeblich für die FSL-1.1-MIT-Wettbewerbsgrenzen und das Change Date; die derzeit genannten gehosteten Subprocessors sind Cloudflare und Stripe.",
          ],
        },
      ],
    },
  },
} satisfies HelpLocale;

export default locale;
