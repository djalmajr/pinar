import type { ReleaseLocale } from "../release-content";

const locale = {
  ui: {
    allReleases: "Todas las novedades",
    backToReleases: "Volver a las novedades",
    firstRelease: "Esta es la primera versión",
    historyDescription: "Abre el historial para ver todas las tags publicadas.",
    latestRelease: "Estás en la más reciente",
    metaDescription: "Notas oficiales de cada versión etiquetada de Pinar.",
    next: "Siguiente",
    pageDescription:
      "Cada nota corresponde a una tag publicada en el repositorio, sin mezclar trabajo aún no lanzado.",
    pageTitle: "Novedades de Pinar",
    previous: "Anterior",
    releaseNavigation: "Navegación de versiones",
    releaseNotFound: "Versión no encontrada",
    releaseNotFoundDescription:
      "Esta versión no está en el historial publicado.",
    viewDetails: "Ver detalles",
    whatChanged: "Qué cambió",
  },
  releases: {
    "v0.3.5": {
      title: "Pestaña Cuenta, plan único solo Founder, captura copia antes",
      summary:
        "La pestaña Cuenta de la extensión es una franja de código en una línea. El plan único es solo Founder. La captura copia los comentarios en cuanto están listos, y Alt+Enter funciona como Ctrl+Enter.",
      changes: {
        "account-tab-options": {
          title: "Franja de código en Cuenta",
          description:
            "Las instalaciones Free generan un código temporal en una fila de iconos, con la cuenta atrás bajo el campo. Las cuentas de pago muestran correo y plan; Salir es outline; Gestionar suscripción solo en Pro.",
        },
        "lifetime-folded-into-founder": {
          title: "Lifetime es Founder",
          description:
            "El plan de pago único es solo Pinar Founder. El checkout sigue aceptando el metadata antiguo lifetime_founder. No hay etiqueta, env ni alias de Price Lifetime.",
        },
        "capture-copy-sooner": {
          title: "Copiar antes de guardar la captura",
          description:
            "Ctrl+Enter, Command+Enter o Alt+Enter copia comentarios y localizadores primero, mientras el auxiliar aún guarda la captura. El progreso ya no se queda en 80% cuando el pegado ya está listo.",
        },
      },
    },
    "v0.3.4": {
      title: "Políticas aceptadas al continuar",
      summary:
        "Pagar en Planes o verificar el código de la cuenta acepta los Términos, la Política de privacidad y el Uso aceptable vigentes. No hay un diálogo extra.",
      changes: {
        "checkout-policy-acceptance": {
          title: "Pagar es aceptar",
          description:
            "Iniciar un checkout de pago en Planes registra los Términos, la Política de privacidad y el Uso aceptable vigentes. El diálogo extra desaparece.",
        },
        "sign-in-policy-acceptance": {
          title: "Entrar es aceptar",
          description:
            "Verificar el código de la cuenta por correo registra las mismas políticas vigentes. El paso extra de aceptar desaparece. Free remoto sigue aceptando en las opciones de la extensión.",
        },
      },
    },
    "v0.3.3": {
      title: "Menú de cuenta local y Free sin IA",
      summary:
        "El workspace local usa el mismo popover de cuenta que Free. Inicio vive en ese menú, y Free ya no incluye créditos ni resúmenes de IA.",
      changes: {
        "local-account-menu": {
          title: "Menú de cuenta local",
          description:
            "El pie del workspace local ahora abre el mismo popover de cuenta que Free. Inicio está dentro del menú. Cerrar sesión desaparece en local, porque no hay sesión en la nube que abandonar.",
        },
        "free-without-ai": {
          title: "Free sin IA",
          description:
            "Free deja de conceder créditos de IA y de mostrar el resumen con IA. Los resúmenes quedan en Pro, Founder y Lifetime. Planes y ayuda reflejan ese límite.",
        },
      },
    },
    "v0.3.2": {
      title: "Instalador de Windows completo",
      summary:
        "La descarga de Windows ahora es el ZIP completo del Setup. Extrae y ejecuta Pinar-Setup.exe junto a la carpeta .installer.",
      changes: {
        "windows-setup-zip": {
          title: "ZIP completo del Setup en Windows",
          description:
            "GitHub Releases ahora publica win-x64-Pinar-Setup.zip, con Pinar-Setup.exe y el payload .installer juntos. El exe de 1,2 MB ya no se lista, porque por sí solo no instala.",
        },
        "windows-help-links": {
          title: "Enlaces de instalación en Windows",
          description:
            "Ayuda y Opciones descargan el ZIP. Tras extraerlo, mantén la carpeta .installer junto a Pinar-Setup.exe y, si Windows muestra SmartScreen, continúa con Más información y Ejecutar de todas formas.",
        },
      },
    },
    "v0.3.1": {
      title: "Aplicación para Windows y portadas únicas de ayuda",
      summary:
        "Ejecuta Pinar desde el área de notificación de Windows, descarga el instalador Setup y abre artículos de ayuda con portada propia.",
      changes: {
        "windows-desktop-app": {
          title: "Aplicación de escritorio para Windows",
          description:
            "Pinar ahora incluye una aplicación de bandeja en Windows. Descarga win-x64-Pinar-Setup.exe, ejecuta el instalador e inicia el auxiliar local desde el área de notificación — el mismo flujo de captura local que en macOS.",
        },
        "unique-help-covers": {
          title: "Portadas únicas de ayuda",
          description:
            "Cada uno de los 27 artículos de ayuda tiene ahora su propia imagen de portada, para que las guías de instalación, primera captura, atajos y facturación ya no compartan captura.",
        },
        "windows-first-run-help": {
          title: "Ayuda en el primer arranque en Windows",
          description:
            "La guía de instalación ahora indica cómo continuar tras el bloqueo inicial de SmartScreen: abre “Más información” y elige “Ejecutar de todas formas”.",
        },
      },
    },
    "v0.3.0": {
      title: "Un espacio de trabajo y una captura más claros",
      summary:
        "Organiza colecciones en crecimiento, ajusta Pinar desde una sola área y revisa cada captura con información visual y ayuda más claras.",
      changes: {
        "workspace-organization": { title: "Organización del espacio de trabajo", description: "Las colecciones anidadas admiten bibliotecas mayores con una jerarquía más clara, navegación redimensionable, controles compactos y contexto de colección en la vista de todos los elementos." },
        "global-settings": { title: "Ajustes globales", description: "Un área dedicada reúne las preferencias generales, de captura, privacidad, interfaz, tema y detalle de copia en una experiencia coherente." },
        "capture-feedback": { title: "Información de captura más clara", description: "Las dimensiones de selección, el foco del comentario, las vistas previas, las regiones ocultas y el progreso al guardar hacen que la captura sea más fluida y predecible." },
        "help-center": { title: "Centro de ayuda mejorado", description: "Las guías de instalación y primera captura son más breves y claras, las imágenes se abren con zoom y los artículos largos resaltan la sección visible." },
      },
    },
    "v0.2.0": {
      title: "Lotes de captura y preferencias sincronizadas",
      summary:
        "Agrupa capturas de varias páginas en un solo prompt, guarda todas las preferencias en el servidor y usa Pinar en siete idiomas de principio a fin.",
      changes: {
        "capture-batches": {
          title: "Lotes de captura",
          description:
            "Pulsa Alt+Shift+B para agrupar las próximas capturas; pulsa de nuevo para finalizar y copiarlas como un solo prompt. Los lotes viven en una carpeta de la barra lateral, y Alt+Shift+X o el menú del icono cierra uno sin copiar.",
        },
        "server-preferences": {
          title: "Preferencias en el servidor",
          description:
            "Destino de captura, copia del lote, formato del handoff, claves de URL ocultas e idioma viven en el servidor y se sincronizan con la extensión. Ajustes suma secciones de Captura, Handoff y Privacidad.",
        },
        "localized-everywhere": {
          title: "Siete idiomas en todo",
          description:
            "La barra, el menú del icono y el prompt entregado al agente siguen el idioma elegido, junto con el espacio de trabajo y las Opciones.",
        },
        "progress-toolbar": {
          title: "Progreso en la barra",
          description:
            "Cmd+Enter convierte la barra en una barra de progreso - guardando, listo o error - y el obturador de la captura ahora dura dos fotogramas. Cerrar un lote informa el resultado con una notificación.",
        },
        "about-and-versioning": {
          title: "Acerca de y una sola versión",
          description:
            "Ajustes > Acerca de muestra qué es Pinar, su versión y las notas de la versión. Una sola versión del producto rige la app, el sitio y las etiquetas, y las compilaciones de producción salen solo de una etiqueta de release.",
        },
      },
    },
    "v0.1.5": {
      title: "Inicio fiable al iniciar sesión",
      summary:
        "Pinar.app ahora conserva la configuración de inicio de macOS sin recargar el agente innecesariamente.",
      changes: {
        "idempotent-login-setup": {
          title: "Configuración de inicio idempotente",
          description:
            "La bandeja comprueba si su LaunchAgent ya existe antes de configurarlo, y así evita un segundo arranque por RunAtLoad.",
        },
        "preference-preserved": {
          title: "Preferencia conservada",
          description:
            "La preferencia guardada de Iniciar al iniciar sesión permanece intacta, sin ciclos de unload/reload en un arranque normal.",
        },
      },
    },
    "v0.1.4": {
      title: "Arranque serializado de la bandeja en macOS",
      summary:
        "Los hooks de agente concurrentes ya no pueden crear instancias duplicadas de Pinar.app ni iconos fantasma en el Dock.",
      changes: {
        "single-app-instance": {
          title: "Una sola instancia de la app",
          description:
            "Un bloqueo atómico por PID deja la bandeja en ejecución como propietaria mientras un arranque duplicado termina de forma limpia.",
        },
        "coordinated-hooks": {
          title: "Hooks coordinados",
          description:
            "Los hooks de sesión y el instalador ahora serializan el arranque de la bandeja y esperan a que esté lista, en lugar de competir entre sí.",
        },
      },
    },
    "v0.1.3": {
      title: "Flujos más precisos de cuenta y captura en iframe",
      summary:
        "La gestión de cuenta, el apuntado a iframes, la deduplicación de subidas, la navegación pública y la protección contra arranques duplicados se pulieron juntos.",
      changes: {
        "nested-iframe-locators": {
          title: "Localizadores en iframes anidados",
          description:
            "Los caminos DOM capturados ahora conservan cada límite de frame, de modo que los pins dentro de iframes anidados se localizan con más precisión.",
        },
        "single-flight-uploads": {
          title: "Subidas en un solo vuelo",
          description:
            "Las peticiones de captura repetidas comparten una sola subida en curso, y así evitan sesiones duplicadas y condiciones de carrera.",
        },
        "account-clarity": {
          title: "Cuenta más clara",
          description:
            "La pantalla de cuenta de la extensión ahora deja el plan, el almacenamiento, la facturación y el consentimiento legal más fáciles de entender y gestionar.",
        },
        "duplicate-launch-guard": {
          title: "Protección contra arranques duplicados",
          description:
            "Los hooks de sesión del agente detectan una bandeja de macOS ya en ejecución antes de intentar abrir otra instancia.",
        },
      },
    },
    "v0.1.2": {
      title: "Pinar.app para macOS",
      summary:
        "La experiencia local de Pinar pasó a una app nativa en la barra de menús, con un helper integrado, control de inicio de sesión y actualizaciones desde GitHub.",
      changes: {
        "native-menu-bar-app": {
          title: "App nativa en la barra de menús",
          description:
            "Abre el espacio de trabajo, inicia o detén el servidor local, consulta su puerto activo y controla Iniciar al iniciar sesión desde Pinar.app.",
        },
        "bundled-local-helper": {
          title: "Helper local incluido",
          description:
            "La app crea el directorio local de Pinar, ejecuta el helper y registra los hooks de los agentes de IA compatibles sin instalar un daemon aparte.",
        },
        "automatic-updates": {
          title: "Actualizaciones automáticas",
          description:
            "La app comprueba artefactos firmados publicados en GitHub Releases y rechaza downgrades accidentales.",
        },
        "unified-macos-installer": {
          title: "Instalador unificado de macOS",
          description:
            "El instalador público ahora descarga, instala y abre Pinar.app como el producto local compatible en macOS.",
        },
      },
    },
    "v0.1.1": {
      title: "Captura visual, espacio de trabajo en la nube y Founder",
      summary:
        "La primera versión etiquetada del producto conectó las anotaciones del navegador con espacios de trabajo locales y en la nube, handoffs a agentes de IA, compartir, planes y controles de privacidad.",
      changes: {
        "element-and-area-capture": {
          title: "Captura de elementos y áreas",
          description:
            "Fija uno o varios elementos DOM o áreas libres, escribe comentarios, captura screenshots y copia un paquete estructurado desde Chrome.",
        },
        "local-helper-and-agent-hooks": {
          title: "Helper local y hooks de agentes",
          description:
            "Un helper en loopback guarda screenshots e historial, mientras que los hooks de sesión instalados dejan listos a los agentes de código compatibles para recibir el contexto de Pinar.",
        },
        "cloud-workspace-and-sharing": {
          title: "Espacio de trabajo en la nube y compartir",
          description:
            "Llegaron juntos las cuentas sin contraseña, los proyectos, las colecciones anidadas, los visores de captura y los enlaces no listados de sesión, proyecto y colección.",
        },
        "plans-ai-and-storage": {
          title: "Planes, IA y almacenamiento",
          description:
            "Free, Pro y el acceso limitado Founder introdujeron retención en la nube, cuotas de almacenamiento, resúmenes de IA, suscripciones y paquetes opcionales de créditos o almacenamiento.",
        },
        "privacy-and-legal-controls": {
          title: "Controles de privacidad y legales",
          description:
            "La redacción de campos sensibles, las máscaras manuales, el consentimiento versionado y las políticas de servicio publicadas establecieron el límite de seguridad de la nube.",
        },
      },
    },
  },
} satisfies ReleaseLocale;

export default locale;
