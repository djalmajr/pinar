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
    "capture-toolbar": {
      alt: "Pinar-Aufnahme-Overlay mit oberer Symbolleiste, nummerierten Pins, einem ausgewählten Bereich und einer Privacy-Maske auf der Seite.",
      caption:
        "Die Overlay-Symbolleiste bleibt auf der Seite mit den Kurzbefehlen für Pin, Auswahl, Kopieren, Maske, Region und Abbrechen während der Annotation.",
    },
    "capture-review": {
      alt: "Pinar-Overlay prüft eine gespeicherte Sitzung, mit einem ausstehenden Pin, der auf der Live-Seite manuell platziert werden muss.",
      caption:
        "Auf der Seite prüfen setzt Pins auf der Original-URL. Ungelöste Pins bleiben ausstehend, bis du den Marker und danach das richtige Element anklickst.",
    },
    "capture-copy-failed": {
      alt: "Pinar-Overlay-Leiste mit Kopieren fehlgeschlagen, während nummerierte Pins auf der Seite editierbar bleiben.",
      caption:
        "Wenn alle Zwischenablagewege scheitern, zeigt die Leiste Kopieren fehlgeschlagen und stellt die Pins wieder her, damit du ohne Kommentarverlust erneut versuchst.",
    },
    "capture-full-page": {
      alt: "Pinar-Overlay auf einem langen Dokument, das unter dem ersten Viewport weitergeht, bereit für eine zusammengesetzte Ganzseitenaufnahme.",
      caption:
        "Die Ganzseitenaufnahme scrollt und fügt das Dokument zusammen, damit der kopierte Screenshot Inhalte unterhalb des Falzes enthält.",
    },
    "capture-viewer": {
      alt: "Pinar-Aufnahme-Viewer mit annotiertem Screenshot, nummerierten Pins, Zoom-Steuerung und Sitzungsaktionen.",
      caption:
        "Der Viewer hält den gemeinsamen Screenshot, die Pin-Kommentare und die Aktionen zum Kopieren oder erneuten Öffnen nach der Aufnahme zusammen.",
    },
    "extension-options": {
      alt: "Pinar-Erweiterungsoptionen auf dem Tab Speicher, mit Lokaler Server, Remote-Server und der rechtlichen Zustimmung zum gehosteten Dienst.",
      caption:
        "Der Tab Speicher wählt einen lokalen oder Remote-Server und verlangt die Annahme von Bedingungen, Datenschutz und Zulässiger Nutzung vor Cloud-Captures.",
    },
    "extension-preferences": {
      alt: "Pinar-Erweiterungsoptionen auf dem Tab Einstellungen, mit kompaktem oder vollständigem KI-Kopierdetail und dem Schalter zum Einbeziehen des Screenshots.",
      caption:
        "Einstellungen legt kompakte oder vollständige Übergabe fest und ob die nächste Kopie einen Screenshot enthält; Speichern schreibt diese Wahl vor der nächsten Kopie.",
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
    "capture-shortcuts": {
      alt: "Tab Kurzbefehle der Pinar-Erweiterungsoptionen mit Browserbefehlen und Overlay-Tasten während der Aufnahme.",
      caption:
        "Der Tab Kurzbefehle zeigt Chrome-Tastenkürzel neben den Overlay-Tasten für Pin, Auswahl, Maske, Kopieren und Abbrechen.",
    },
    "capture-types": {
      alt: "Pinar-Overlay mit einem nummerierten Pin auf einer Überschrift und einem ausgewählten Bereich um die Bestellsummenkarte.",
      caption:
        "Element-Pins und freie Regionen können dasselbe Overlay teilen, damit der kopierte Screenshot das DOM-Ziel und die visuelle Gruppierung behält.",
    },
    "capture-pins": {
      alt: "Pinar-Overlay mit drei nummerierten Markern auf einer Überschrift, einer Kunden-E-Mail und einer Zahlungsschaltfläche.",
      caption:
        "Jeder Pin behält eigene Nummer und Kommentar, damit eine Aufnahme mehrere Elemente derselben Seite zeigen kann.",
    },
    "capture-selection": {
      alt: "Pinar-Overlay, das eine Überschrift mit blauem Auswahlrahmen hervorhebt, bevor der Pin bestätigt wird.",
      caption:
        "Die intelligente Auswahl umrandet das Element unter dem Cursor, damit du das DOM mit den Pfeiltasten durchläufst, bevor du pinnst.",
    },
    "capture-masks": {
      alt: "Pinar-Overlay mit einer Privacy-Maske über einer Kunden-E-Mail und einem nummerierten Pin auf der Überschrift.",
      caption:
        "Eine Maske verbirgt sensible Pixel im kopierten Screenshot, ohne die Pin-Kommentare zu entfernen, die die Seite weiter beschreiben.",
    },
    "capture-copied": {
      alt: "Pinar-Overlay-Leiste mit Erfolgreich kopiert, nachdem das annotierte Paket in der Zwischenablage angekommen ist.",
      caption:
        "Ein erfolgreiches Kopieren zeigt Erfolgreich kopiert und schließt das Overlay, damit du dasselbe Paket in einen Agenten einfügst.",
    },
    "install-pinar": {
      alt: "Tab Speicher der Pinar-Erweiterung mit der Schaltfläche Pinar herunterladen neben der Option Lokaler Server.",
      caption:
        "Der Tab Speicher bietet den Download der Pinar-Anwendung neben Lokaler Server, damit der Helfer auf diesem Computer startet.",
    },
    "options-local": {
      alt: "Tab Speicher der Pinar-Erweiterung mit ausgewähltem Lokaler Server und Captures, die auf diesem Computer bleiben.",
      caption:
        "Lokaler Server hält Verlauf und Screenshots auf diesem Computer und verlangt keine rechtliche Zustimmung zum gehosteten Dienst.",
    },
    "workspace-nested": {
      alt: "Pinar-Arbeitsbereich-Seitenleiste mit einer ausgewählten Sammlung im Projektbaum und den passenden Sitzungskarten.",
      caption:
        "Das Auswählen einer Sammlung filtert den Arbeitsbereich auf diesen Zweig, damit verschachtelte Ordner neben den Sitzungen sichtbar bleiben.",
    },
    "workspace-review": {
      alt: "Pinar-Arbeitsbereichstabelle mit geöffnetem Filter für den Prüfungsstatus über den Sitzungszeilen.",
      caption:
        "Die Tabellenansicht kombiniert Suche mit Prüfungsstatusfiltern, um offene, akzeptierte und wiedereröffnete Pins über Sitzungen zu scannen.",
    },
    "workspace-security": {
      alt: "Projektumschalter des Pinar-Arbeitsbereichs, geöffnet auf dem geschützten Projekt Personal.",
      caption:
        "Der lokale Arbeitsbereich stellt ein geschütztes Projekt Personal und Inbox wieder her, wenn der Verlauf nicht öffnet, statt die App zu blockieren.",
    },
    "legal-retention": {
      alt: "Pinar-Rechtscenter, geöffnet auf dem Dokument zur Datenaufbewahrung.",
      caption:
        "Die Datenaufbewahrungsrichtlinie nennt, wie lange gehostete Captures, Abrechnungsdaten und zugehörige Kontodaten gespeichert werden.",
    },
    "sharing-markdown": {
      alt: "Öffentlicher Pinar-Projektviewer mit der Schaltfläche Markdown kopieren über geteilten Sitzungskarten.",
      caption:
        "Ein nicht gelisteter Projekt- oder Sammlungs-Link lässt jede Person mit der URL das kombinierte Markdown ohne Anmeldung kopieren.",
    },
    "preferences-privacy": {
      alt: "Tab Einstellungen der Pinar-Erweiterung mit optionalen Loop-Metriken und zusätzlichen URL-Schlüsseln zum Ausblenden.",
      caption:
        "Datenschutz-Einstellungen fügen extra Query-Schlüssel hinzu, die aus erfassten URLs entfernt werden, und lassen Loop-Metriken aus, bis du zustimmst.",
    },
    "pricing-credits": {
      alt: "Pinar-Preis-Add-on-Karte für 1.000 KI-Guthaben mit Kauf und zwölfmonatiger Gültigkeit.",
      caption:
        "KI-Guthaben werden als Add-on mit zwölfmonatiger Gültigkeit verkauft, getrennt vom Planspeicher und dem Abrechnungsrhythmus.",
    },
  },
  articles: {
    "install-pinar": {
      title: "Pinar installieren",
      summary: "Installiere die Chrome-Erweiterung und öffne die Pinar-Anwendung auf deinem Computer.",
      sections: [
        {
          heading: "Browsererweiterung",
          paragraphs: [
            "Installiere Pinar aus dem [Chrome Web Store](https://chromewebstore.google.com/detail/pinardev/idpeaokdndjedekacfdfbilcolpholbo).",
          ],
          bullets: [
            "Hefte das Pinar-Symbol im Chrome-Menü für Erweiterungen an, damit es sichtbar bleibt.",
            "Öffne den [Chrome-Web-Store-Eintrag](https://chromewebstore.google.com/detail/pinardev/idpeaokdndjedekacfdfbilcolpholbo), um die offizielle Erweiterung hinzuzufügen.",
          ],
        },
        {
          heading: "Die Pinar-Anwendung",
          paragraphs: [
            "Unter macOS sitzt die Pinar-Anwendung in der Menüleiste. Unter Windows sitzt sie im Infobereich. Öffne die Pinar-Anwendung, um zu erfassen. Unter Linux installierst du mit dem Befehl unten.",
          ],
          bullets: [
            "Aufnahmen bleiben auf diesem Computer. Wähle „Ordner öffnen“, um sie zu sehen.",
            "Unter macOS und Windows hält „Bei Anmeldung starten“ Pinar bereit, nachdem du dich angemeldet hast.",
            "Hat eine Aufnahme kein Bild, öffne Pinar und versuche es erneut.",
          ],
        },
        {
          heading: "Installieren und öffnen",
          paragraphs: [
            "Lade die Pinar-Anwendung über die Links unten herunter, installiere sie und öffne sie.",
            "Wenn Pinar offen ist, wähle „Workspace öffnen“. Zeigt sie „Lokaler Server: Aus“, wähle „Starten“. Kommen eingefügte Aufnahmen nicht mehr an, öffne Pinar erneut.",
          ],
          bullets: [
            "macOS: [lade die Pinar-Anwendung herunter](https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg), öffne das Disk-Image und ziehe sie nach „Programme“.",
            "Windows: [lade die Pinar-Anwendung herunter](https://github.com/djalmajr/pinar/releases/latest/download/win-x64-Pinar-Setup.exe) und führe den Installer aus. Das Symbol erscheint im Infobereich.",
            "Windows: der erste Start kann „Windows hat Ihren PC geschützt“ zeigen. Wähle „Weitere Informationen“ und dann „Trotzdem ausführen“.",
            "Linux: `curl -fsSL https://pinar.dev/install.sh | sh`",
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
            "Öffne die Seite, wähle die Pinar-Erweiterung, klicke dann auf ein Element oder ziehe einen Freiform-Bereich. Schreibe den Kommentar und drücke `Enter`, um den Pin hinzuzufügen.",
          ],
          bullets: [
            "Wiederhole die Auswahl, um mehrere nummerierte Pins in einem Capture zu setzen.",
            "`Shift+Enter` fügt einen Zeilenumbruch ein; `Escape` schließt den Entwurf, ohne die anderen Pins zu löschen.",
          ],
        },
        {
          heading: "Das Bundle kopieren",
          paragraphs: [
            "Drücke unter macOS `Command+Enter`, sonst `Ctrl+Enter`. Pinar kopiert menschenlesbares Markdown, HTML und einen pinar-visual-context-JSON-Block, die auf denselben Screenshot und dieselben Pin-Identitäten verweisen.",
          ],
        },
        {
          heading: "Kopieren abschließen und Identitäten behalten",
          paragraphs: [
            "`Command/Ctrl+Enter` kopiert erst, wenn mindestens ein Pin einen Kommentar hat. Das Overlay zeigt „Anmerkungen werden gespeichert…“, blendet die Pins für den Screenshot aus, danach „Erfolgreich kopiert!“, und die Symbolleiste schließt sich. Ein späterer Klick auf das Erweiterungssymbol blendet nur das Overlay ein oder aus; bereits gesetzte Pins werden nicht gelöscht. Scheitern alle Zwischenablagewege, wird das Overlay wiederhergestellt, damit du es erneut versuchen kannst.",
            "Behandle die Zwischenablage-Nutzlast als eine Einheit: lesbare Anweisungen, eine optionale Viewer-URL und einen abgegrenzten pinar-visual-context-JSON-Block mit `captureId`, `pinId`, Seiten-URL, Locators (cssSelector, domPath, innerText) und einer Screenshot-URL, wenn der Helper eine Datei gespeichert hat. Nummerierte Badges auf dem Bild sind Annotations-Overlays, keine Seiten-UI. Schreibe `captureId` oder `pinId` beim Einfügen in einen Agent nicht um. Eine Zeile Screenshot: /path/to/file.png ist, sofern vorhanden, der einzige Ausschnitt, der alle Pins enthält.",
          ],
          bullets: [
            "Ein leerer Composer oder ein Capture ohne Pins bricht das Kopieren ab und blendet „Zuerst einen Kommentar schreiben“ oder „Zuerst einen Pin setzen“ ein.",
            "Eingeschränkte Kopien fügen weiterhin Kommentare und Locators ein, aber die Symbolleiste kann nach „Erfolgreich kopiert!“ „kein Screenshot“, „Helfer nicht verfügbar“ oder „kein Viewer“ ergänzen.",
            "Bevorzuge ein laufendes lokales Pinar, damit die Kopie einen Screenshot und einen Viewer-Link für den vollen Kontext enthalten kann.",
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
            "Der lokale Modus behält Verlauf und Screenshots auf diesem Computer. Der lokale Workspace bleibt ohne Konto verfügbar.",
          ],
        },
        {
          heading: "Cloud",
          paragraphs: [
            "Der Cloud-Modus ermöglicht Remote-Zugriff auf den Workspace, verwaltete Aufbewahrung, KI-Zusammenfassungen, Abrechnung und unlisted Freigabelinks. Du akzeptierst die aktuellen Richtlinien, bevor etwas remote gespeichert wird.",
          ],
        },
        {
          heading: "Wie lokale und Cloud-Sitzungen wirklich geöffnet werden",
          paragraphs: [
            "Der lokale Verlauf beginnt mit einem geschützten Projekt „Personal“ und einer geschützten Collection „Inbox“, die du nicht wie gewöhnliche Ordner verschachteln oder löschen kannst. Aufnahmen bleiben auf diesem Computer, und du kannst sie im lokalen Workspace öffnen.",
            "Cloud-Speicher wartet, bis du die aktuellen „Bedingungen“, den „Datenschutz“ und die „Zulässige Nutzung“ akzeptiert hast. Danach können „Free“-Konten die Erweiterung mit einem kurzlebigen Code koppeln, und bezahlte Konten können zusätzlich einen sechsstelligen E-Mail-Code bestätigen. Freigabelinks bleiben für alle lesbar, die die unlisted URL haben.",
          ],
          bullets: [
            "Der lokale Workspace bleibt auf diesem Computer und braucht kein Cloud-Konto.",
            "Wenn der lokale Verlauf seinen üblichen Speicher nicht öffnen kann, stellt Pinar einen nutzbaren Katalog wieder her, statt abzustürzen.",
            "Cloud-Freigabelinks brauchen keine Workspace-Sitzung: Jede Person mit der unlisted URL kann das Markdown oder das Bild lesen.",
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
            "`Enter` setzt einen Pin auf das Element unter dem Zeiger; `Arrow Up` wählt das Elternelement, `Arrow Down` kehrt zu einem Kind zurück.",
            "`M` schaltet das Zeichnen der Privacy-Maske um. `Escape` bricht einen Entwurf oder eine Maske ab; ohne Entwurf werden Pins gelöscht und die Symbolleiste ausgeblendet.",
            "`R` schaltet das Live-Overlay zwischen nur nummerierten Pins und Pins mit ihren Regionen um. Der kopierte Screenshot enthält immer beides.",
            "`Command/Ctrl+Enter` kopiert das fertige Bundle.",
            "`Alt+Shift+P` blendet die Toolbar ein oder aus, ohne die Sitzung abzubrechen, und lässt sich unter `chrome://extensions/shortcuts` neu belegen. Browser-Kurzbefehle bleiben auf `chrome://`-Seiten, im Chrome Web Store und vor der Injektion des Overlays wirkungslos.",
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
            "Capture-Tastenkürzel gelten nur, solange das Overlay aktiv ist. Das Erweiterungssymbol schaltet dieses Overlay um; Pins werden nicht gelöscht. Zeigst du ohne offenen Entwurf auf die Symbolleiste, wird sie pass-through, sodass du die Seite darunter weiter anklicken oder ziehen kannst. `Shift+Enter` fügt im Composer einen Zeilenumbruch ein, und Tastenkürzel der Host-Seite, die dort getippt werden, verlassen das Kommentarfeld nicht.",
            "`Arrow Up` geht zum Elternelement und merkt sich das verlassene Kind, sodass `Arrow Down` zu diesem gemerkten Knoten zurückkehrt, wenn er noch ein Kind ist; sonst wird das erste Kind verwendet. Im Maskenmodus ziehst du einen Bereich, um ihn auszublenden, und klickst auf eine vorhandene Maske, um sie wiederherzustellen. Tastatur-Scrolling funktioniert weiterhin im Dokument, aber auf fokussierte Seitensteuerungen gerichtete Tasten werden blockiert, damit sie keine Schaltflächen auslösen oder in das Host-Formular schreiben.",
          ],
          bullets: [
            "`Command/Ctrl+Enter` speichert einen offenen Entwurf und kopiert anschließend; ohne Kommentar erscheint „Zuerst einen Kommentar schreiben“, statt einen leeren Pin zu senden.",
            "Nach `Escape` oder dem Kopieren behält Pinar diese physische Taste bis keyup, damit die Host-Seite denselben Tastendruck nicht als eigenes Abbrechen oder Absenden wertet.",
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
            "Klicke auf einen Knoten oder drücke `Enter` auf der aktuellen Umrandung, um einen Element-Pin zu öffnen. Ziehe ein Rechteck von mindestens sechs Pixeln, um stattdessen einen Bereichs-Pin zu öffnen. Der erste Druck auf ein iframe- oder frame-Element wird ignoriert, damit das Dokument in diesem Frame die Auswahl übernehmen kann.",
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
        "Verstehe, wie ein Pin einem Element folgt, nachdem sich die Seite ändert, und warum Pinar eine manuelle Platzierung anfordern kann.",
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
            "Drücke M, während der Capture-Modus aktiv ist, und ziehe dann über den sensiblen Bereich. Benutzermasken werden vor dem Speichern auf das aufgenommene Bild angewendet; entferne eine irrtümliche Maske vor dem Kopieren.",
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
            "Benutzermasken verwenden eine eindeutige id und eine manuelle Kategorie, damit sie unabhängig von automatischen Boxen gelöscht werden können.",
            "Automatische Feldmasken werden verworfen statt gelöscht, damit spätere Scans das zugrunde liegende Feld weiterhin melden können.",
            "`Escape` beendet das Maskenzeichnen, ohne die bereits auf der Seite platzierten Pins zu verwerfen.",
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
            "Lade den Screenshot herunter oder kopiere das Sitzungs-Markdown aus dem Viewer.",
            "Öffne das öffentliche Markdown in ChatGPT oder Claude über das Viewer-Aktionsmenü, wenn das Teilen verfügbar ist.",
          ],
        },
        {
          heading: "Auf der Originalseite prüfen",
          paragraphs: [
            "„Auf der Seite prüfen“ öffnet den erfassten Origin und rehydriert die Pins. Pinar lehnt eine Origin-Abweichung ab, bewahrt jeden historischen Anker und jede Box, zeichnet die Relokationshistorie auf und lässt dich einen unresolved Pin manuell neu positionieren.",
          ],
        },
        {
          heading:
            "Zwischenablage aus dem Viewer und Gating beim erneuten Öffnen",
          paragraphs: [
            "Copy page im Viewer schreibt dasselbe korrelierte Markdown-Bundle wie auf der Live-Seite, mit compact- oder full-Handoff aus gespeicherten Präferenzen und `captureId` mit Fallback auf die Session-ID. Das Aktionsmenü öffnet das öffentliche Markdown unter /v/{id}.md oder startet ChatGPT oder Claude mit einem Prompt, der auf diese URL zeigt.",
            "„Auf der Seite prüfen“ sendet ein reopen-Ereignis mit der Session-ID. Der Helper hydriert nur von einer vertrauenswürdigen Pinar-Anwendung-URL, wenn diese ID mit der Session-ID oder `captureId` übereinstimmt und der Tab-Origin weiterhin dem Origin der erfassten Seite entspricht. Das Navigieren des Tabs von diesem Origin weg löst die Bindung, statt Pins in die falsche Site zu injizieren.",
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
        "Füge das vollständige Pinar-Bundle ein, damit der Agent Kommentar, Ziel, Geometrie und das geteilte Bild zusammen sieht.",
      sections: [
        {
          heading: "Was einzufügen ist",
          paragraphs: [
            "Pinar schreibt reines Markdown und HTML in die Zwischenablage. Der Text enthält lesbare Annotationen plus einen abgegrenzten pinar-visual-context-JSON-Block. Füge beides als eine Einheit ein; der strukturierte Block ist die maschinenlesbare Quelle der Wahrheit.",
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
            "Die Chrome-Erweiterung tippt niemals in den Agent-Composer. Nach `Command/Ctrl+Enter` füge die Zwischenablage selbst in Cursor, Claude, Codex oder Grok ein. Der Text beginnt damit, dass die Pin-Notizen eine Änderung oder eine Erklärung erbitten können, und Selektor und DOM-Pfad als ergänzende Locator zu behandeln, gefolgt von einem abgegrenzten pinar-visual-context-JSON-Block. Wenn eine Viewer-URL enthalten ist, rufe sie nur ab, wenn diese Details nicht ausreichen.",
            "Behandle `captureId` und `pinId` als Identität, nicht als Labels zum Umschreiben. Visual Context kodiert derzeit schemaVersion 1; parseVisualCapture lehnt eine fehlende `captureId` und jede schemaVersion außer 1 oder dem Legacy-Wert 0 ab. Folge nur dem, was die Pins beschreiben. Wenn die Person nichts eingefügt hat, bitte sie, erneut aus Pinar zu kopieren, statt Pins aus dem Gedächtnis zu rekonstruieren.",
          ],
          bullets: [
            "Füge die gesamte Zwischenablage in den Agenten ein; tippe Kommentare nicht ab und erfinde keine neue `captureId`.",
            "Bestätige, dass der eingefügte Text noch einen geschlossenen pinar-visual-context-Fence enthält, bevor du Code bearbeitest.",
            "Wenn nichts eingefügt wurde, bitte um `Command/Ctrl+Enter` in Pinar und folge nur den Pin-Notizen.",
          ],
        },
      ],
    },
    "handoff-formats": {
      title: "Handoff-Formate und Ziele",
      summary:
        "Wähle compact- oder full-Kontext und eine agentenspezifische Darstellung, ohne die Capture-Identität zu ändern.",
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
            "Zustellmodus in den Erweiterungsoptionen wählen, bevor du kopierst",
          paragraphs: [
            "In den Erweiterungsoptionen setzt ein Schalter handoffMode auf full, wenn aktiviert, und auf compact, wenn deaktiviert. compact ist der gespeicherte Standard und behält jede nützliche Tatsache einmal: `pinId`, comment, cssSelector, domPath und innerText, plus box oder coords nur für Flächen-Pins oder Pins ohne Locator. full behält die ungekürzte Capture. Beide Projektionen entfernen weiterhin data:-Screenshot-URLs aus dem JSON; ein Inline-Bild wird als null-URL und screenshot_inline-Warnung gespeichert, damit der Prompt begrenzt bleibt.",
            "Klicke auf Save, damit preferences:set handoffMode und `includeScreenshot` in das aktive Backend und chrome.storage.sync schreibt. Unbekannte handoffMode-Werte fallen auf compact zurück; `includeScreenshot` ist standardmäßig true. Adapter-Ziele sind cursor, claude, codex und grok: jedes stellt die eigene Präambel voran, aber `captureId`, pinIds und comments bleiben identisch. Der copy-viewer-content-Schalter ist deaktiviert, sobald includeViewer aus ist.",
          ],
          bullets: [
            "Setze den compact/full-Schalter und den `includeScreenshot`-Schalter und klicke vor dem nächsten Kopieren auf Save.",
            "Lass `includeScreenshot` an, es sei denn, du willst bewusst Metadaten, Pins, Locator und Handoff ohne Bildspeicherung.",
            "Kopiere nach dem Speichern einmal und bestätige, dass jedes Einfügen über einen Adapter weiterhin dieselbe `captureId` und dieselben pinIds teilt.",
          ],
        },
      ],
    },
    "closed-loop-review": {
      title: "Die Agent-Review-Schleife schließen",
      summary:
        "Verfolge, was ein Agent geändert hat, prüfe es als Mensch und öffne nur erneut, wenn eine weitere Korrektur nötig ist.",
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
            "Ein Agent meldet Arbeit zur `captureId` der Capture und zu jeder `pinId`. Wiederhole eine Zustellung mit demselben Schlüssel nur, wenn das Ergebnis unverändert ist; eine andere Zusammenfassung, andere Dateien oder ein anderer Status brauchen einen neuen Schlüssel. Unbekannte Pins oder Captures werden abgelehnt, ohne private Kommentare zu wiederholen.",
            "Eine Person akzeptiert eine Korrektur oder öffnet einen accepted-Pin in der Review-Oberfläche erneut. Agenten können ihre eigene Arbeit nicht akzeptieren. Nach einem menschlichen erneuten Öffnen ist der vorgesehene Retry ein zweites changed-Ergebnis. Lass anonyme Loop-Metriken aus, sofern du nicht opt-in aktivierst.",
          ],
          bullets: [
            "Veröffentliche ein changed-Ergebnis für dieselbe `captureId` und `pinId` und bestätige, dass der Viewer den Pin als bereit zur Annahme zeigt.",
            "Verwende einen Zustellschlüssel nur erneut, wenn das Ergebnis identisch ist; erzeuge einen neuen Schlüssel, wenn sich Dateien, Zusammenfassung oder Status tatsächlich geändert haben.",
            "Wenn die Prüfung fehlschlägt, öffne als Mensch erneut, veröffentliche ein zweites Ergebnis, akzeptiere erneut und behalte die Capture-IDs vorher und nachher.",
          ],
        },
      ],
    },
    "reopen-and-relocate": {
      title: "Pins erneut öffnen und neu verorten",
      summary:
        "Prüfe die Umsetzung auf der Live-Seite, auch nachdem sich das DOM geändert hat.",
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
            "Wenn ein Ziel ambiguous oder unresolved ist, positioniere den Pin manuell neu. Der ursprüngliche Anker und die Box bleiben in der Historie eingefroren, und jede automatische oder manuelle Relokation wird für die spätere Prüfung aufgezeichnet.",
          ],
        },
        {
          heading:
            "Die ursprüngliche URL öffnen und ausstehende Pins platzieren",
          paragraphs: [
            "„Auf der Seite prüfen“ öffnet nur aus der Pinar-Anwendung, auf der ursprünglichen Capture-URL. Eine andere Site kann keine gespeicherte Sitzung in die Erweiterung injizieren. Nach dem Laden zeigt jeder Frame nur die Pins, die dorthin gehören.",
            "Das Overlay bleibt nur gebunden, solange der Tab noch die erfasste Site ist. Wegnavigieren zeigt „Diese Seite ist nicht die ursprüngliche Capture-URL“. Mehrdeutige Treffer behalten die ursprüngliche Box, statt auf ein ähnliches Element zu springen. Klicke auf einen ausstehenden Pin, dann auf das korrekte Element, um ihn zu platzieren.",
          ],
          bullets: [
            "Starte „Auf der Seite prüfen“ aus der Pinar-Anwendung, damit nur diese Sitzung auf dem erfassten Origin hydriert.",
            "Wenn das Overlay „Diese Seite ist nicht die ursprüngliche Capture-URL“ sagt, kehre zum erfassten Origin zurück, statt Pins zu platzieren.",
            "Bei einem unresolved Pin klicke auf die Markierung und dann auf das Live-Element, um ihn zu platzieren.",
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
            "Pinar verwendet zuerst die Clipboard-API des Browsers über ein Offscreen-Dokument und fällt auf eine versteckte Textauswahl zurück, wenn Berechtigung oder Fokus sie blockieren. Wenn jeder Kopiermechanismus fehlschlägt, wird das Overlay wiederhergestellt, sodass deine Pins und Kommentare bearbeitbar bleiben.",
          ],
        },
        {
          heading: "Eingeschränkt bedeutet nicht unkorreliert",
          paragraphs: [
            "`screenshot_missing` bedeutet, dass das Bild nicht gespeichert werden konnte. `helper_unavailable` bedeutet, dass der lokale Dienst nicht erreicht wurde. `viewer_unavailable` bedeutet, dass keine Viewer-URL erzeugt wurde. Fahre mit Kommentar, DOM-Pfad, Selektor, Pin-Koordinaten, `captureId` und `pinId` fort und wiederhole nur die fehlende Ebene.",
          ],
        },
        {
          heading:
            "Den Kopierpfad nachvollziehen, wenn die Symbolleiste einen Fehler meldet",
          paragraphs: [
            "Zum Kopieren sind ein gespeicherter Kommentar und mindestens ein Pin erforderlich. Die Symbolleiste zeigt „Anmerkungen werden gespeichert…“, blendet Overlays aus, erfasst den Screenshot und fordert das Offscreen-Dokument auf, text/html und text/plain zu schreiben. Offscreen versucht zuerst navigator.clipboard.write und fällt auf ein copy-Ereignis plus execCommand zurück. Wenn dieses Schreiben nicht ok ist, versucht das Content-Skript weiterhin writePlainText auf der zurückgegebenen Plain-Payload: clipboard.writeText, dann eine versteckte Textarea-Auswahl.",
            "Wenn jeder Kopierpfad fehlschlägt, sendet die Seite overlays:hidden mit hidden false, zeigt kurz „Kopieren fehlgeschlagen“ und lässt Pins bearbeitbar. Ein erfolgreiches Kopieren zeigt „Erfolgreich kopiert!“ oder „Erfolgreich kopiert!“ plus „kein Screenshot“, „Helfer nicht verfügbar“ oder „kein Viewer“ und beendet dann die Sitzung. Diese Suffixe entsprechen `screenshot_missing`, `helper_unavailable` und `viewer_unavailable`. screenshot_inline gehört nicht zu den eingeschränkten Übergabewarnungen. Ein Einfügen ohne geschlossene pinar-visual-context-Fence kann nicht als JSON geparst werden.",
          ],
          bullets: [
            "Wenn die Symbolleiste „Zuerst einen Kommentar schreiben“ oder „Zuerst einen Pin setzen“ anzeigt, schließe diesen Pin ab und drücke erneut `Command/Ctrl+Enter`.",
            "Wenn „Kopieren fehlgeschlagen“ erscheint, bestätige, dass die Pins noch auf der Seite sind, erteile bei Aufforderung die Zwischenablageberechtigung und wiederhole das Kopieren.",
            "Lies das Suffix von „Erfolgreich kopiert!“: „kein Screenshot“, „Helfer nicht verfügbar“ und „kein Viewer“ benennen die fehlende Ebene, die du ohne Verwerfen der Kommentare erneut versuchen kannst.",
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
            "Ziehe Sitzungen zwischen Collections, um sie neu zu ordnen, oder nutze Move to in der Sammelaktion für eine Auswahl.",
          ],
        },
        {
          heading: "Prüfen, wo eine verschobene Sitzung landet",
          paragraphs: [
            "Öffne eine Collection, um die gespeicherte manuelle Reihenfolge zu sehen und zu ändern, indem du eine Sitzung auf ihren Nachbarn ziehst. Wenn keine Collection ausgewählt ist, sortiert die Liste nach Erstellungsdatum statt nach dieser gespeicherten Reihenfolge.",
            "Ein Ziehen beginnt an der Karte oder Tabellenzeile, nicht über Suche, Kontrollkästchen oder das Aktionsmenü (`data-no-dnd`). Wenn die gezogene Sitzung bereits mit anderen ausgewählt ist, wandern alle ausgewählten ids mit; andernfalls wird nur diese Sitzung verschoben. Move to fragt nach einem Projekt, dann nach einer Collection im abgeflachten Baum dieses Projekts; ein Projektwechsel leert das Collection-Feld, und ein Projekt ohne Collections ist deaktiviert. Die Sitzung wird an der nächsten Position im Ziel angehängt. Das Löschen von Personal wird abgelehnt; das Löschen eines anderen Projekts hängt dessen Sitzungen in bestehender Reihenfolge an Inbox an und entfernt die Collections dieses Projekts.",
          ],
          bullets: [
            "Um die Reihenfolge in einer Collection zu ändern, ziehe eine Sitzung auf ihren Nachbarn.",
            "Um mehrere Sitzungen zu verschieben, wähle sie zuerst aus und ziehe dann eine ausgewählte Karte oder öffne Move to; das Ziehen einer nicht ausgewählten Karte verschiebt nur diese Sitzung.",
            "Nach dem Löschen eines Nicht-Personal-Projekts öffne Personal / Inbox und prüfe das Ende der Liste auf die angehängten Sitzungen, bevor du sie erneut einsortierst.",
          ],
        },
      ],
    },
    "nested-collections": {
      title: "Verschachtelte Collections verwenden",
      summary:
        "Baue in jedem Projekt eine Hierarchie auf und ordne sie neu, ohne Kindbeziehungen abzuflachen.",
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
            "Ziehe eine Collection nach rechts, um sie unter dem vorherigen Geschwisterelement zu verschachteln, oder nach links zur Wurzel; wenn das Ablegen abgelehnt wird, bleibt die parentId-Liste unverändert.",
            "Klappe ein Elternelement nur ein, wenn du eine kürzere Seitenleiste brauchst; ausgeblendete Nachfahren bleiben im Baum und bewegen sich weiterhin mit dem gezogenen Zweig.",
            "Nach einem Fehler beim Speichern des Ziels öffne die Erweiterungsoptionen erneut und bestätige, dass Projekt und Collection einem aktuellen Baumeintrag entsprechen, bevor der nächste Cloud-Capture erfolgt.",
          ],
        },
      ],
    },
    "find-manage-share": {
      title: "Sitzungen finden, verwalten und teilen",
      summary:
        "Durchsuche jedes nützliche Feld, filtere Review-Arbeit, führe Sammelaktionen aus und veröffentliche nur, was du beabsichtigst.",
      sections: [
        {
          heading: "Suche und Ansichten",
          paragraphs: [
            "Die Suche findet Treffer in Seitentitel, URL, Beschreibung, Pin-Kommentaren und CSS-Selektoren. Filter für Pin-Anzahl und Review-Status können kombiniert werden. Wechsle zwischen Kartenraster und Tabelle; die Tabelle bietet 15, 30, 60 oder 100 Zeilen pro Seite und merkt sich die Ansicht lokal.",
          ],
        },
        {
          heading: "Sammel- und Freigabeaktionen",
          paragraphs: [
            "Wähle Sitzungen in jeder der beiden Ansichten aus, um sie gemeinsam zu verschieben oder zu löschen. Das Löschen einer Sitzung ist dauerhaft: Es entfernt den Screenshot sowie Agent-Ausführungen, Pin-Ergebnisse, Reviews und Review-Ereignisse. Öffentliche Viewer für Sitzungen, Projekte und Collections sind unlisted statt zugriffskontrolliert; jede Person mit einem gültigen Link kann einen öffnen. Aggregierte Viewer können kombiniertes Markdown für jede enthaltene Sitzung kopieren.",
          ],
        },
        {
          heading: "Filter kombinieren und dann öffentliches Markdown kopieren",
          paragraphs: [
            "Die Suche entfernt umgebende Leerzeichen und sucht als groß-/kleinschreibungsunabhängige Teilzeichenkette. Eine nur aus Leerzeichen bestehende Abfrage lässt jede Sitzung zu, bis Filter für Pin-Anzahl oder Review-Status sie ausschließen. Die Kontrollkästchen für die Pin-Anzahl sind Buckets von 1, 2–5 und 6 oder mehr; eine Sitzung muss mindestens einem ausgewählten Bucket entsprechen. Review-Status-Filter laufen gegen gespeicherte reviewCounts; fehlen diese Zählungen, wird jeder Pin als open behandelt. Das Ändern von Suche, einem der Filter, Collection oder Projekt setzt die Paginierung auf die erste Seite zurück.",
            "Alles auswählen im Raster gilt nur für die aktuelle Kartenseite; Alles auswählen in der Tabelle gilt für die aktuelle Tabellenseite. Dieser Browser merkt sich die Wahl zwischen Raster und Tabelle. Sammellöschen fragt nach Bestätigung und entfernt dann jede ausgewählte Sitzung. Ein öffentlicher Projekt- oder Collection-Viewer kopiert kombiniertes Markdown von der Freigabeseite. Wenn diese Freigabe weg ist, zeigt der Viewer einen not-found-Zustand statt einer Liste.",
          ],
          bullets: [
            "Bestätige nach dem Anwenden von Suche oder Filtern, dass die Paginierung auf Seite 1 gesprungen ist, damit du keine veraltete Seite eines älteren Ergebnissatzes liest.",
            "Nutze Move to oder Delete in der Sammel-Symbolleiste erst, wenn die Kontrollkästchen den gewünschten Sitzungen entsprechen; Clear selection leert die Menge, ohne den Speicher zu ändern.",
            "In einem aggregierten Viewer sollte Copy Markdown eine Überschrift, eine `/p/`- oder `/c/`-Viewer-URL und dann jede Sitzung als `/v/{id}`-Überschrift mit Page, Markdown, optionalem Screenshot und nummerierten Pin-Kommentaren einfügen; wenn das Kopieren mit Unable to load Markdown fehlschlägt, öffne dieselbe `.md`-URL im Browser.",
          ],
        },
      ],
    },
    "account-and-sign-in": {
      title: "Konto und passwortlose Anmeldung",
      summary:
        "Verbinde die Erweiterung, öffne den Web-Workspace und verstehe den Ablauf von Codes und Sitzungen.",
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
            "Web-Sitzungen gelten 30 Tage und authentifizierte Erweiterungsgeräte 180 Tage. Codes laufen aus Sicherheitsgründen ab.",
          ],
        },
        {
          heading: "Kopplung im Account-Tab der Erweiterung abschließen",
          paragraphs: [
            "Öffne bei einer Remote-Free-Installation den Account-Tab der Erweiterungsoptionen, erzeuge dort den temporären Code und kopiere ihn. Öffne die gehostete Anmeldeseite über denselben Tab, damit ein erfolgreicher Austausch im Web-Workspace landet. Das erneute Erzeugen fragt zuerst nach Bestätigung, weil ungenutzte Codes dieses Kontos ersetzt werden. Füge den Code auf pinar.dev ein, nicht auf einer lokalen Workspace-Seite.",
            "Das Anfordern eines E-Mail-Codes sieht immer gleich aus, auch bei unbekannten Adressen, sodass das Formular nicht verrät, ob ein Konto existiert. Eine echte sechsstellige Nachricht wird nur an ein berechtigtes bezahltes Konto gesendet. Sign-out im Account-Tab beendet die aktuelle Web- und Erweiterungssitzung.",
          ],
          bullets: [
            "Wenn keine E-Mail ankommt, warte vor einem erneuten Versuch; Codes laufen ab, und zu viele Versuche werden verzögert.",
            "Bestätige den Regenerieren-Dialog, bevor du einen Code ungültig machst, den du noch auf der gehosteten Anmeldeseite eingeben willst.",
            "Nutze Sign out im Account-Tab, wenn die aktuelle Web- oder Erweiterungssitzung sofort beendet werden soll.",
          ],
        },
      ],
    },
    "plans-and-billing": {
      title: "Free, Pro, Founder und Abrechnung",
      summary:
        "Vergleiche Produktberechtigungen, verwalte ein Abonnement und behandle die Preisseite als aktuelle Preisquelle.",
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
            "Checkout startet erst, nachdem du die aktuellen Nutzungsbedingungen, die Datenschutzerklärung und die zulässige Nutzung akzeptiert hast. Brasilien verwendet BRL-Preise; andere Länder verwenden USD. Der Founder-Checkout reserviert einen begrenzten Platz und gibt ihn frei, wenn du ohne Zahlung gehst. Ist die Kohorte voll oder der Verkauf pausiert, blendet die Plans-Seite dieses Angebot aus.",
            "Nach einer erfolgreichen Zahlung wird das Angebot dem angemeldeten Konto gewährt und du kehrst in den Workspace zurück. Das Abrechnungsportal ist nach einem bezahlten Checkout verfügbar. Endet ein Pro-Abonnement, treten diese Cloud-Sitzungen in ein Wiederherstellungsfenster ein; Founder- und Legacy-Lifetime-Konten bleiben stattdessen dauerhaft.",
          ],
          bullets: [
            "Akzeptiere die aktuellen Richtlinienversionen im gehosteten Plans-Ablauf vor der Zahlung.",
            "Wenn der Founder-Checkout nicht verfügbar ist, warte auf einen Platz oder wähle Pro, statt denselben Checkout erneut zu versuchen.",
            "Wenn Manage subscription nicht verfügbar ist, schließe zuerst einen bezahlten Checkout ab und öffne es dann aus einem angemeldeten Konto.",
          ],
        },
      ],
    },
    "ai-credits": {
      title: "AI-Zusammenfassungen und Credits",
      summary:
        "Erfahre, wann Credits reserviert, verbraucht, aufgefüllt oder erstattet werden.",
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
            "Eine Zusammenfassung läuft nur auf einer Sitzung, die dir gehört. Läuft bereits eine, warte, bis sie fertig ist, statt eine weitere zu starten. Fehlgeschlagene oder abgebrochene Zusammenfassungen erstatten die Reservierung, wenn möglich. Ist das Guthaben zu niedrig, zeigt der Workspace die aktuell verbleibenden Credits.",
            "Enthaltene monatliche Credits werden vor gekauften Paketen verwendet, und das zuerst ablaufende Guthaben kommt zuerst. Ein gekauftes 1.000-Credit-Paket gilt bis zu 12 Monate. Das Kontomenü zeigt verbleibende Credits und das nächste Auffülldatum für aktive Pro- und Founder-Konten. Zusammenfassungen nutzen die Workspace-Sprache, wenn sie eine der sieben unterstützten Sprachen ist.",
          ],
          bullets: [
            "Läuft auf dieser Sitzung bereits eine Zusammenfassung, warte, bis sie fertig ist, statt eine zweite zu starten.",
            "Läuft eine Reservierung ab oder wird sie erstattet, starte eine neue Zusammenfassung, statt dieselbe Anfrage zu wiederholen.",
            "Zeigt der Workspace null Credits, prüfe verbleibende Pakete und das nächste Auffülldatum, bevor du ein weiteres 1.000-Credit-Angebot kaufst.",
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
            "Das Kontingent ist der im Plan enthaltene Speicher plus jedes noch aktive Add-on. Das Ersetzen eines größeren Screenshots durch einen kleineren kann gelingen, wenn eine brandneue Capture das nicht täte. Uploads pausieren, sobald das Konto am oder über dem Kontingent liegt, auch während Nachfrist und Wiederherstellung.",
            "Free-Cloud-Sitzungen, die nicht als dauerhaft markiert sind, werden nach sieben Tagen bereinigungsberechtigt. Pro-Inhalte oberhalb des Free-Kontingents folgen nach Ende der bezahlten Berechtigung der 30-tägigen Nachfrist und dem 90-tägigen Wiederherstellungsfenster. Founder- und Legacy-Lifetime-Inhalte werden nicht allein deshalb berechtigt, weil kein wiederkehrendes Abonnement besteht. Ausschließlich lokaler Verlauf auf diesem Computer wird niemals remote gelöscht. Berechtigung ist kein Versprechen einer sofortigen Entfernung.",
          ],
          bullets: [
            "Wenn neue Captures pausieren, schaffe Platz, indem du Sitzungen löschst oder einen umfangreichen Screenshot ersetzt, oder erwirb ein zwölfmonatiges 5-GB- oder 20-GB-Add-on.",
            "Ist das Konto in der Nachfrist oder Wiederherstellung, exportiere alles noch Benötigte vor Tag 90; Berechtigung kennzeichnet nur den Überschuss und löscht selbst nicht.",
            "Erwarte nicht, dass das Deinstallieren der Desktop-App Cloud-Objekte bereinigt, und erwarte nicht, dass die Cloud den lokalen Verlauf auf diesem Computer löscht.",
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
            "Cloud-Viewer gibt es für eine Sitzung, ein Projekt oder eine Sammlung. Sie sind für alle öffentlich, die den Link haben, und werden nicht wie die normale Navigation indexiert. Behandle eine unlisted URL nicht als Authentifizierung für sensible Inhalte.",
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
            "Jede Sitzung, jedes Projekt und jede Collection hat eine unlisted Seite und eine Markdown-Kopie. Copy Markdown legt diesen Text in die Zwischenablage, und jede Sitzungskarte öffnet den eigenen Viewer. Ein fehlender oder ungültiger Link zeigt eine not-found-Seite statt Inhaber-E-Mail, Plan oder anderen Kontofeldern.",
            "Sitzungs-Markdown enthält das Handoff-Bundle plus Agent-Ergebnisse und Pin-Reviews. Projekt- und Collection-Markdown listen jede verschachtelte Sitzung mit Seiten-URL, Pin-Kommentaren, `pinId` und Locators. Screenshot-Zeilen erscheinen nur, wenn der Inhaber die Screenshot-Zustellung zulässt. Jede Person, die den Link öffnen kann, kann kopieren, was sie sieht; eine unlisted URL ist daher keine Autorisierung.",
          ],
          bullets: [
            "Bevor du einen Projekt- oder Collection-Link versendest, öffne Copy Markdown einmal und prüfe, dass jede verschachtelte Sitzung, jeder Pin-Kommentar und jede Screenshot-Zeile zur Veröffentlichung geeignet ist.",
            "Deaktiviere die Screenshot-Zustellung im Inhaberkonto, wenn das geteilte Markdown Bild-URLs auslassen soll.",
            "Wenn ein geteilter Pfad not found anzeigt, behandle den Link als nicht mehr vorhanden oder ungültig; diese Seite fügt keine privaten Kontodetails hinzu.",
          ],
        },
      ],
    },
    "where-data-lives": {
      title: "Wo deine Daten liegen",
      summary:
        "Lokale Dateien, Cloud-Persistenz, Browser-Einstellungen und öffentliche Projektionen voneinander trennen.",
      sections: [
        {
          heading: "Lokale Grenze",
          paragraphs: [
            "Lokale Screenshots und der Verlauf bleiben auf diesem Computer. Browser-Einstellungen wie Ansicht, Sprache, Theme und Zustelloptionen bleiben in diesem Browser, sofern eine angemeldete Funktion sie nicht ausdrücklich synchronisiert.",
          ],
        },
        {
          heading: "Cloud-Grenze",
          paragraphs: [
            "Cloud-Kontodatensätze, Capture-Metadaten und Bilder werden im gehosteten Dienst gespeichert. Stripe verarbeitet die Abrechnung, und der E-Mail-Dienst sendet Anmeldecodes. Die Seite Subprocessors ist die aktuelle Liste der externen Dienstrollen.",
          ],
        },
        {
          heading: "Prüfen, welcher Speicher jede Capture tatsächlich hält",
          paragraphs: [
            "Lokale Screenshots werden als PNG-Dateien gespeichert, und der Sitzungsverlauf bleibt auf diesem Computer. Theme ist eine reine Browser-Einstellung im Tab Interface. Sprache und die Schalter für Capture-Zustellung leben im selben Einstellungsdialog; ein angemeldetes Cloud-Konto kann diese Zustelloptionen im gehosteten Workspace behalten.",
            "Gehostete Captures halten Metadaten und Bilder im Cloud-Dienst. Unlisted Viewer und Markdown-Kopien sind ohne Workspace-Sitzung verfügbar. E-Mail-Anmeldecodes laufen ab, und das Formular verrät nicht, ob ein Konto existiert. Die Seite Subprocessors nennt die aktuellen gehosteten Anbieter, und Pinar erhält keine vollständigen Kartendaten. Aktuelle Richtlinienversionen sind auf den Rechtsseiten veröffentlicht.",
          ],
          bullets: [
            "Wenn der lokale Verlauf nicht geöffnet werden kann, stellt Pinar auf diesem Computer einen nutzbaren Katalog wieder her, statt abzustürzen.",
            "Öffne einen gehosteten Screenshot von seiner Freigabeseite oder dem Markdown-Viewer; ein fehlendes Bild zeigt not found statt Kontodetails.",
            "Bestätige in den Einstellungen das Interface-Theme lokal und unterscheide dann die Capture-Zustellschalter von den cloud-synchronisierten Zustelloptionen, wenn du angemeldet bist.",
          ],
        },
      ],
    },
    "automatic-sanitization": {
      title: "Automatische Bereinigung",
      summary:
        "Sieh, welche URL-, DOM-, Zugangsdaten- und Inline-Bilddaten Pinar vor der Übergabe oder Speicherung entfernt.",
      sections: [
        {
          heading: "Sensible Felder und URLs",
          paragraphs: [
            "Pinar schwärzt Passwort-, Zahlungs-, Token- und OTP-Felder, entfernt URL-Fragmente und streicht bekannte sensible Query-Keys wie access_token, api_key, auth, password, secret, token und jwt. Weitere Query-Key-Namen kannst du in den Erweiterungseinstellungen hinzufügen.",
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
            "Pinar schwärzt Passwort-, Zahlungs-, Token- und Einmalcode-Felder und bereinigt anschließend die Seiten-URL. Bekannte geheimnisartig wirkende Query-Werte werden durch [redacted] ersetzt. Zusätzliche Namen, die du in den Einstellungen hinzufügst, werden einbezogen. Übereinstimmende Teilzeichenfolgen werden auch aus Titel, Beschreibung, URL und Pins entfernt.",
            "Der kopierte Visual-Context-Block behält `captureId`, auch wenn der Rest der Nutzlast nicht geparst werden kann. Inline-Screenshot-Bytes werden aus dem Text-Bundle entfernt, sodass die Kopie stattdessen einen Dateipfad oder eine Viewer-URL behält. Konnten einige Bereiche nicht geprüft werden, enthält das Einfügen eine Privacy-Warnung.",
          ],
          bullets: [
            "Lies nach einem Kopieren die Privacy-Warnungen im Einfügen; einige Bereiche können als nicht geprüft markiert sein.",
            "Füge zusätzliche Query-Key-Namen als kommagetrennte, leerzeichengetrennte oder semikolongetrennte Tokens hinzu; der Abgleich erfolgt unabhängig von der Groß-/Kleinschreibung.",
            "Wenn eingefügtes Übergabe-JSON weiterhin eine data:-Screenshot-URL enthält, erfasse erneut, damit das Text-Bundle stattdessen einen Pfad oder eine Viewer-URL behält.",
          ],
        },
      ],
    },
    "local-security-and-recovery": {
      title: "Lokale Sicherheit und Wiederherstellung",
      summary:
        "Verstehe Capability-Token, vertrauenswürdige Origins, lokale Migrationen und die sichere Startwiederherstellung.",
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
            "Der lokale Workspace akzeptiert nur die Pinar-Anwendung und die offizielle Erweiterung. Die Rotation hält das vorherige Geheimnis lange genug gültig, damit laufende Prozesse nachziehen können; der Widerruf erzwingt eine neue Autorisierung.",
            "Läuft bereits eine andere Pinar-Instanz, bleibt diese Instanz an Ort und Stelle. Verschachtelte Screenshot-Ordner werden migriert, ohne Namenskonflikte zu überschreiben. Wenn der lokale Verlauf nicht geöffnet werden kann, stellt Pinar ein nutzbares Projekt Personal und Inbox wieder her, statt abzustürzen.",
          ],
          bullets: [
            "Nutze weiter die offizielle Erweiterung und die Pinar-Anwendung; andere Sites können nicht mit dem lokalen Workspace sprechen.",
            "Nachdem du den lokalen Zugriff widerrufen hast, starte Pinar neu, damit der Workspace sich erneut autorisieren kann.",
            "Wenn der lokale Verlauf nicht geöffnet werden kann, erwarte ein wiederhergestelltes Projekt Personal und Inbox statt eines Absturzes.",
          ],
        },
      ],
    },
    "telemetry-and-policies": {
      title: "Telemetrie, Einwilligung und Richtlinien",
      summary:
        "Erfahre, was opt-in ist, welche Richtlinien die Cloud-Nutzung steuern und was Fair Source hier bedeutet.",
      sections: [
        {
          heading: "Closed-Loop-Metriken",
          paragraphs: [
            "Loop-Metriken sind aus, sofern du nicht opt-in aktivierst. Wenn deaktiviert, werden Übermittlungen verworfen. Wenn aktiviert, lässt der Sanitizer operative Events, duration, agent und Relocation-Confidence zu, lehnt jedoch Kommentare, Titel, URLs, DOM-Pfade, Selektoren, Screenshots, Markup und Rohinhalte ab.",
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
            "Loop-Metriken bleiben aus, sofern du nicht opt-in aktivierst. Wenn aktiviert, werden nur operative Events gesendet. Kommentare, Titel, URLs, Selektoren, Screenshots und ähnliche Inhalte werden abgelehnt.",
            "Checkout und die Remote-Registrierung für Free erfassen angenommene Richtlinienversionen. Terms, Privacy, Acceptable Use, Retention, Refunds, Fair Source und Subprocessors sind unter https://pinar.dev/legal/ veröffentlicht. Rein lokale Nutzung, die den gehosteten Dienst nie kontaktiert, braucht kein gehostetes Konto. Fragen gehen an contact@pinar.dev oder contato@pinar.dev.",
          ],
          bullets: [
            "Lass Loop-Metriken deaktiviert, sofern du nicht opt-in willst; eine deaktivierte Einstellung überträgt keinen Batch.",
            "Öffne vor gehosteter Persistenz oder Checkout Terms, Privacy und Acceptable Use unter https://pinar.dev/legal/terms, /privacy und /acceptable-use.",
            "Behandle die veröffentlichte Lizenz als maßgeblich für die Fair-Source-Grenzen; die derzeit genannten gehosteten Subprocessors sind Cloudflare und Stripe.",
          ],
        },
      ],
    },
  },
} satisfies HelpLocale;

export default locale;
