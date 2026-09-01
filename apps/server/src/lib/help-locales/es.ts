import type { HelpLocale } from "../help-content";

const locale = {
  ui: {
    articlesFound:
      "{count, plural, one {# artículo encontrado} other {# artículos encontrados}}",
    articleGuide: "En esta guía",
    articleNotFound: "Artículo no encontrado",
    articleNotFoundDescription: "Este artículo no existe.",
    backToHelp: "Volver al Centro de ayuda",
    breadcrumb: "Ruta de navegación",
    categories: "Categorías",
    categoryArticles: "artículos",
    categoryNotFound: "Categoría no encontrada",
    categoryNotFoundDescription: "Esta categoría no existe.",
    explore: "Explorar",
    help: "Ayuda",
    helpCategories: "Categorías de ayuda",
    helpNavigation: "Navegación de ayuda",
    homeDescription:
      "Orientación basada en la documentación del proyecto, el historial de entregas y el comportamiento realmente implementado.",
    homeHeading: "¿Cómo podemos ayudarte?",
    homeMetaDescription:
      "Aprende a capturar, organizar, compartir y revisar comentarios visuales con Pinar.",
    homeMetaTitle: "Centro de ayuda de Pinar",
    minutes: "min",
    noArticlesFound: "No se encontraron artículos.",
    notFoundDescription:
      "Usa el Centro de ayuda para encontrar la guía publicada.",
    onThisPage: "En esta página",
    openScreenshot: "Abrir el screenshot a tamaño completo",
    pageTitleSuffix: "Ayuda de Pinar",
    popularArticles: "Artículos populares",
    popularDescription:
      "Los caminos más usados para iniciar y cerrar una revisión.",
    searchLabel: "Buscar en el Centro de ayuda",
    searchPlaceholder: "Busca capturas, agentes, planes…",
    searchResults: "Resultados de búsqueda",
    seeAllCategory: "Ver todo de la categoría",
    stillNeedContext: "¿Aún necesitas contexto?",
    visualExample: "Ejemplo visual:",
  },
  categories: {
    "getting-started": {
      title: "Primeros pasos",
      description:
        "Instala Pinar, haz una primera captura y elige dónde vive tu trabajo.",
    },
    captures: {
      title: "Capturas y pins",
      description:
        "Selecciona páginas con precisión, anótalas, enmascara áreas sensibles y vuelve a abrir el resultado.",
    },
    agents: {
      title: "Agentes de IA",
      description:
        "Envía contexto visual a agentes de código y cierra el ciclo de revisión con seguridad.",
    },
    workspace: {
      title: "Proyectos y colecciones",
      description:
        "Organiza, busca, mueve, comparte y revisa sesiones de captura.",
    },
    cloud: {
      title: "Nube y planes",
      description:
        "Entiende cuentas, planes, créditos, almacenamiento, retención y el uso de enlaces públicos.",
    },
    privacy: {
      title: "Privacidad y datos",
      description:
        "Conoce qué almacena Pinar, qué elimina y qué controles permanecen en tus manos.",
    },
  },
  screenshots: {
    "sign-in-extension": {
      alt: "Pantalla de acceso de Pinar con el flujo de código de emparejado de la extensión del navegador seleccionado.",
      caption:
        "El flujo de la extensión acepta el código de emparejado temporal que muestra Pinar y conecta ese navegador sin contraseña.",
    },
    "capture-workspace": {
      alt: "Espacio de trabajo de Pinar con tarjetas de sesión anotadas, recuentos de pins, proyectos, colecciones, búsqueda y controles de cuenta.",
      caption:
        "El espacio de trabajo reúne páginas capturadas, recuentos de pins, proyectos, colecciones, búsqueda y el estado de la cuenta en una sola vista operativa.",
    },
    "getting-started": {
      alt: "Página de inicio pública de Pinar con el flujo local-first, el acceso al espacio de trabajo y la navegación de planes.",
      caption:
        "Empieza por la entrada pública de Pinar para abrir el espacio de trabajo local, entender el flujo de captura o comparar los planes en la nube.",
    },
    "help-navigation": {
      alt: "Artículo de ayuda de Pinar con navegación por categorías, enlaces a artículos relacionados, secciones estructuradas y navegación en la página.",
      caption:
        "Las páginas de ayuda mantienen juntos la categoría, los procedimientos vecinos, las secciones del artículo y los caminos de recuperación.",
    },
    privacy: {
      alt: "Centro legal de Pinar con los documentos de Términos, Privacidad, Uso aceptable, Retención de datos, Reembolso, Fair Source y subprocesadores.",
      caption:
        "El centro legal reúne las reglas de datos, retención, uso aceptable, reembolso, licencias y subprocesadores en un único lugar auditable.",
    },
    "workspace-table": {
      alt: "Tabla del espacio de trabajo de Pinar con búsqueda, filtros, recuentos de pins, fechas de creación, paginación y acciones por fila.",
      caption:
        "La vista de tabla organiza búsqueda, filtros, recuentos de pins, fechas, paginación y acciones de sesión en un flujo fácil de recorrer.",
    },
    "sign-in-email": {
      alt: "Pantalla de acceso a la cuenta de Pinar con el flujo de código por correo electrónico seleccionado.",
      caption:
        "Las cuentas registradas solicitan un código de corta duración por correo y completan la verificación en la misma superficie de acceso.",
    },
    pricing: {
      alt: "Página de precios de Pinar que compara Free, Pro anual, Founder, complementos de almacenamiento y opciones de créditos de IA.",
      caption:
        "La superficie de precios muestra los límites del plan, la cadencia de facturación, los complementos de almacenamiento y las compras de créditos de IA antes del checkout.",
    },
    updates: {
      alt: "Detalle de versión de Pinar con la fecha de publicación, la versión, los cambios y la navegación a las versiones anterior y siguiente.",
      caption:
        "Las notas de versión publicadas hacen que el comportamiento instalado y los cambios operativos se puedan rastrear por versión.",
    },
  },
  articles: {
    "install-pinar": {
      title: "Instalar Pinar",
      summary:
        "Añade la extensión oficial de Chrome y conecta el producto local compatible con tu plataforma.",
      sections: [
        {
          heading: "Extensión del navegador",
          paragraphs: [
            "Instala Pinar desde Chrome Web Store. Este es el camino oficial de instalación del navegador; no hace falta un checkout de GitHub ni una carpeta de extensión unpacked para el uso normal.",
          ],
          bullets: [
            "Fija el icono de Pinar en el menú de extensiones de Chrome para que permanezca visible.",
            "La extensión admite el origen publicado pinar.dev y los servidores locales de Pinar.",
          ],
        },
        {
          heading: "Producto local",
          paragraphs: [
            "En macOS, Pinar.app vive en la barra de menús, ejecuta el helper integrado, registra los hooks de agente compatibles y consulta GitHub Releases en busca de actualizaciones. Windows y Linux usan por ahora el instalador independiente del helper en lugar de una app de escritorio.",
          ],
          bullets: [
            "Los screenshots suelen vivir en `~/.pinar/shots` y el historial en `~/.pinar/history.db`. La acción Open Folder de la bandeja abre este directorio; PINAR_HOME puede anularlo.",
            "El helper recorre los puertos 17373 a 17382 de 127.0.0.1 y reconoce Pinar con GET `/api/health`. PINAR_PORT fija el descubrimiento a un solo puerto.",
            "Iniciar al iniciar sesión usa un LaunchAgent de usuario en macOS. Pinar recurre a la ruta heredada de launchctl en sistemas antiguos y guarda los registros en el directorio de inicio de Pinar.",
            "Si el helper local no está disponible, los recortes de imagen caen a Downloads/pinar.",
          ],
        },
        {
          heading: "Confirmar el helper y abrir el espacio de trabajo",
          paragraphs: [
            "Cuando la extensión esté fijada, instala el producto local correspondiente por el camino de un solo paso documentado: arrastra la imagen de disco de macOS a ~/Applications, ejecuta el instalador de PowerShell en Windows o el instalador de curl en Linux. Esos scripts colocan el helper en ~/.pinar/bin (o %USERPROFILE%\\.pinar\\bin), añaden ese directorio a PATH y ejecutan pinar install-hooks para que los agentes de código puedan recibir las capturas pegadas.",
            "En macOS, Pinar.app oculta el icono del Dock, mantiene una sola instancia de bandeja mediante ~/.pinar/tray.pid y arranca el helper con pinar ensure si GET `/api/health` aún no devuelve ok true y service pinar. Usa el control Start o Restart de la barra de menús cuando el estado sea Off y luego Open Workspace para cargar http://127.0.0.1:<port>/app. Vuelve a ejecutar pinar install-hooks desde el helper si un agente ya no ve las instrucciones de pegado.",
          ],
          bullets: [
            "Instalación en Windows: irm https://pinar.dev/install.ps1 | iex. Instalación en Linux: curl -fsSL https://pinar.dev/install.sh | sh. El script necesita curl o wget para descargar el binario.",
            "Un helper sano responde a GET `/api/health` con ok true y service pinar. En macOS, Open Workspace usa ese puerto descubierto en la ruta de espacio de trabajo /app.",
            "La extensión de Chrome no puede escribir `~/.pinar/shots` por sí sola. Si los recortes no llegan a esa carpeta, arranca primero el producto local y vuelve a capturar.",
          ],
        },
      ],
    },
    "first-capture": {
      title: "Hacer tu primera captura",
      summary:
        "Fija un elemento o un área visible, escribe el comentario y copia un único paquete correlacionado.",
      sections: [
        {
          heading: "Fijar la página",
          paragraphs: [
            "Abre la página, selecciona la extensión Pinar y haz clic en un elemento o arrastra un área libre. Escribe el comentario y pulsa Enter para añadir el pin.",
          ],
          bullets: [
            "Repite la selección para colocar varios pins numerados en una misma captura.",
            "Shift+Enter añade un salto de línea; Escape cierra el borrador sin borrar los demás pins.",
          ],
        },
        {
          heading: "Copiar el paquete",
          paragraphs: [
            "Pulsa Command+Enter en macOS o Ctrl+Enter en el resto. Pinar copia Markdown legible, HTML y un bloque JSON pinar-visual-context que apuntan al mismo screenshot y a las mismas identidades de pin.",
          ],
        },
        {
          heading: "Terminar la copia y conservar las identidades",
          paragraphs: [
            "Command/Ctrl+Enter copia solo cuando al menos un pin tiene comentario. La superposición muestra Copying…, oculta el cromo de los pins para el screenshot, luego Copied, y la barra se cierra. Hacer clic después en el icono de la extensión solo muestra u oculta la superposición; no borra los pins que ya colocaste. Si fallan todos los caminos del portapapeles, se restaura la superposición para que puedas reintentar.",
            "Trata el payload del portapapeles como una unidad: instrucciones legibles, una URL opcional del visor y un bloque JSON pinar-visual-context delimitado con `captureId`, `pinId`, URL de la página, localizadores (cssSelector, domPath, innerText) y una URL de screenshot cuando el helper guardó un archivo. Las insignias numeradas de la imagen son superposiciones de anotación, no UI de la página. No reescribas `captureId` ni `pinId` al pegar en un agente. Una línea Screenshot: /path/to/file.png, cuando existe, es el único recorte que contiene todos los pins.",
          ],
          bullets: [
            "Un compositor vacío o una captura sin pins aborta la copia y muestra Write a comment first o Add a pin first.",
            "Las copias degradadas siguen pegando comentarios y localizadores, pero la barra puede añadir no screenshot, helper unavailable o no viewer después de Copied.",
            "Prefiere un helper en ejecución para que los recortes PNG lleguen a `~/.pinar/shots` y el paquete pueda incluir un enlace de visor /v/<id>.md para el contexto completo.",
          ],
        },
      ],
    },
    "local-or-cloud": {
      title: "Elegir almacenamiento local o en la nube",
      summary:
        "Usa el espacio de trabajo local sin conexión o conecta una cuenta para almacenamiento gestionado en la nube y para compartir.",
      sections: [
        {
          heading: "Local",
          paragraphs: [
            "El modo local guarda el historial en SQLite y los screenshots en tu máquina. La API de loopback acepta solo orígenes locales o de extensión de confianza y usa un token de capacidad protegido en el sistema de archivos.",
          ],
        },
        {
          heading: "Nube",
          paragraphs: [
            "El modo nube almacena los datos de cuenta en D1 y los screenshots en R2. Permite el acceso remoto al espacio de trabajo, retención gestionada, resúmenes de IA, facturación y enlaces de uso compartido no listados. Hace falta consentimiento legal antes de la persistencia remota.",
          ],
        },
        {
          heading: "Cómo se abren de verdad las sesiones locales y en la nube",
          paragraphs: [
            "El historial local siempre pertenece a owner local. En el primer uso la base de datos crea un proyecto protegido Personal y una colección protegida Inbox que no se pueden anidar ni eliminar como las creadas por el usuario. Las capturas guardadas se marcan isPermanent true con plan free, los archivos PNG se escriben en el directorio shots del inicio de Pinar y la API de loopback los presenta en /shots/<id>.png y /v/<id>.md. Mutar esa API exige el secreto de capacidad de ~/.pinar/local-capability.json, enviado como x-pinar-capability o como token Authorization Bearer. El archivo se escribe con mode 0600; la rotación mantiene válido el secreto anterior durante 24 horas salvo que PINAR_CAPABILITY_GRACE_MS indique otra cosa.",
            "La persistencia en la nube queda bloqueada hasta aceptar las versiones vigentes de Términos, Privacidad y Uso aceptable; la API devuelve HTTP 428 con code legal_acceptance_required. Remote Free entonces registra una instalación y puede emitir un código de emparejado de un solo uso, válido cinco minutos, para abrir /app. Las cuentas de pago o que ya pagaron también pueden verificar un código de seis dígitos por correo. Las cookies del navegador duran 30 días; los dispositivos de extensión autenticados, 180 días. El Markdown no listado permanece público en /v/, /p/ y /c/, y los screenshots en /shots/.",
          ],
          bullets: [
            "El GET local /api/local/capability devuelve el token actual; rotate y revoke son endpoints POST en el mismo prefijo /api/local/capability.",
            "SQLite vive en `history.db`, en el directorio de inicio de Pinar; si SQLite no puede abrirse, el historial cae a `history.json` en ese mismo inicio.",
            "Los enlaces de uso compartido en la nube no exigen una sesión del espacio de trabajo: cualquiera con la URL no listada puede leer el Markdown o el PNG en /v/, /p/, /c/ o /shots/.",
          ],
        },
      ],
    },
    "shortcuts-and-navigation": {
      title: "Atajos de teclado",
      summary:
        "Captura, recorre el DOM, enmascara contenido y copia sin dejar el teclado.",
      sections: [
        {
          heading: "Durante la captura",
          paragraphs: [
            "Pinar intercepta solo sus atajos de captura activos para que la página anfitriona no reciba la misma pulsación.",
          ],
          bullets: [
            "Enter fija el elemento bajo el puntero; Arrow Up selecciona su padre y Arrow Down vuelve a un hijo.",
            "M activa o desactiva el dibujo de máscaras de privacidad. Escape cancela un borrador o una máscara; sin borrador, limpia los pins y oculta la barra.",
            "Command/Ctrl+Enter copia el paquete completado.",
            "Alt+Shift+P muestra u oculta la barra sin cancelar la sesión, y puedes reasignarlo en `chrome://extensions/shortcuts`. Los atajos del navegador quedan inertes en páginas `chrome://`, en la Chrome Web Store y antes de que se inyecte el overlay.",
          ],
        },
        {
          heading: "Páginas con mucho foco",
          paragraphs: [
            "En sitios con trampas de foco agresivas, Pinar reintenta enfocar el compositor de comentarios un número limitado de veces y luego se detiene en lugar de congelar la pestaña. Haz clic directamente en el compositor si la página sigue robando el foco.",
          ],
        },
        {
          heading:
            "Detalles de la superposición, el icono y el recorrido del DOM",
          paragraphs: [
            "Los atajos de captura solo se poseen mientras la superposición está activa. El icono de la extensión alterna esa superposición; no borra pins. Pasar el puntero por la barra sin un borrador abierto la deja en pass-through para que aún puedas hacer clic o arrastrar la página de debajo. Shift+Enter inserta un salto de línea en el compositor, y los atajos de la página anfitriona escritos ahí se detienen para que no salgan del campo de comentario.",
            "Arrow Up sube al elemento padre y recuerda el hijo que dejaste, de modo que Arrow Down vuelve a ese nodo recordado cuando sigue siendo un hijo; si no, usa el primer hijo. En modo máscara, arrastra una región para ocultarla y haz clic en una máscara existente para restaurarla. El desplazamiento con teclado sigue funcionando en el documento, pero las teclas dirigidas a controles de página enfocados se bloquean para que no activen botones ni escriban en el formulario anfitrión.",
          ],
          bullets: [
            "Command/Ctrl+Enter guarda un borrador abierto y luego copia; sin comentario muestra Write a comment first en lugar de enviar un pin vacío.",
            "Después de Escape o de copiar, Pinar sigue poseyendo esa tecla física hasta keyup para que la página anfitriona no trate la misma pulsación como su propio cancel o submit.",
            "Un pin de área empieza solo después de que el puntero se mueva unos seis píxeles; un clic más corto sigue fijando el elemento bajo el puntero en lugar de abrir un rectángulo libre.",
          ],
        },
      ],
    },
    "capture-types": {
      title: "Capturas de elemento, área, página completa e iframe",
      summary:
        "Elige el modo de captura más pequeño que aún conserve el contexto que necesita quien revisa.",
      sections: [
        {
          heading: "Modos de selección",
          paragraphs: [
            "La captura de elemento registra una huella DOM resistente y la caja exacta. La captura de área cubre un rectángulo libre cuando ningún elemento por sí solo representa el comentario. La captura de página completa desplaza y une el documento. La captura de iframe conserva los límites de frame y los desplazamientos.",
          ],
          bullets: [
            "Prefiere un elemento cuando el agente deba identificar con precisión la propiedad del código.",
            "Prefiere un área para relaciones visuales entre varios elementos.",
          ],
        },
        {
          heading: "Clic, arrastre y apuntado a frames",
          paragraphs: [
            "Haz clic en un nodo, o pulsa Enter sobre el contorno actual, para abrir un pin de elemento. Arrastra un rectángulo de al menos seis píxeles para abrir un pin de área. La primera pulsación sobre un iframe o un elemento frame se ignora para que el documento interior de ese frame pueda tomar la selección.",
            "Los pins de elemento registran una huella, un selector y un camino DOM que une los frames antecesores con un delimitador de límite de frame. Los pins de área guardan el rectángulo y una etiqueta de tamaño en píxeles, sin localizador. El screenshot copiado sigue teselando alrededor de la unión de todos los pins, incluidos los colocados en frames hijos.",
          ],
          bullets: [
            "La barra de captura permanece en el frame superior; los frames hijos muestran solo marcadores y el compositor de comentarios.",
            "Si un frame padre no responde con su camino, el pin conserva solo el camino del documento interior.",
            "Los elementos fixed o sticky se marcan como anclados al viewport para que la reapertura no los trate como cajas desplazadas con el documento.",
          ],
        },
      ],
    },
    "pins-and-comments": {
      title: "Pins, comentarios y colores",
      summary:
        "Usa pins numerados como referencias estables entre el screenshot, el texto y el contexto estructurado.",
      sections: [
        {
          heading: "Una sola captura compartida",
          paragraphs: [
            "Cada insignia numerada del screenshot corresponde a un comentario y a un registro de pin. La paleta de color rotativa separa los marcadores cercanos sin cambiar su identidad.",
          ],
        },
        {
          heading: "Conservar la correlación",
          paragraphs: [
            "No reescribas `captureId` ni `pinId` al entregar el paquete a otra herramienta. Esos campos permiten que el espacio de trabajo, el visor, el resultado del agente y el historial de revisión se refieran a la misma captura.",
          ],
        },
        {
          heading: "Cómo se asignan números e identidades",
          paragraphs: [
            "Un pin se guarda solo cuando el comentario está recortado y no vacío. Los pins nuevos reciben un UUID, un número con base 1 según su orden en la captura y un color de la paleta de once muestras en ese número. Las insignias cercanas, por tanto, se distinguen a la vista sin cambiar la identidad que conservan.",
            "El contexto estructurado conserva `pinId` a partir del `pinId` o id existente. Cuando esos campos faltan, el analizador sintetiza `captureId`:pN a partir de la identidad de la captura y el número del pin. Las herramientas posteriores pueden entonces apuntar al mismo screenshot, comentario y fila de revisión.",
          ],
          bullets: [
            "Un compositor vacío no se puede copiar; el foco permanece en el campo hasta que exista un comentario.",
            "Al pasar el puntero por un marcador se previsualizan su número, comentario y la confianza actual del localizador en la página activa.",
            "Editar un pin existente actualiza solo su comentario; el id almacenado no cambia.",
          ],
        },
      ],
    },
    "full-page-capture": {
      title: "Capturar una página completa",
      summary:
        "Crea un screenshot largo mientras Pinar controla el desplazamiento, la escala y el contenido fijo repetido.",
      sections: [
        {
          heading: "Cómo funciona el ensamblado",
          paragraphs: [
            "Pinar planifica los fotogramas del viewport, recorre el documento, suprime temporalmente los elementos sticky o fixed repetidos, renderiza con el device pixel ratio y restaura la página después.",
          ],
        },
        {
          heading: "Cuando el resultado difiere",
          paragraphs: [
            "El contenido de carga diferida, los diseños animados, los frames de origen cruzado y las páginas que cambian al desplazarse pueden producir huecos o regiones no resueltas. Deja que la página se estabilice, reintenta o captura por separado el área afectada.",
          ],
        },
        {
          heading: "Teselas del viewport y restauración del diseño",
          paragraphs: [
            "Pinar planifica las posiciones de desplazamiento a partir de la unión de los límites de los pins más el relleno, y luego captura cada tesela PNG de la altura del viewport con la API de screenshot de la pestaña. Las teselas posteriores esperan un instante para que la página pueda pintar, y el lienzo compuesto usa el device pixel ratio inferido del ancho de la primera tesela frente al viewport CSS.",
            "Antes de la primera tesela, los nodos sticky y fixed se reescriben para que no se repitan en cada fotograma. Los estilos inline originales y la posición de desplazamiento se restauran aunque falle la composición. Las coordenadas de pins y máscaras se desplazan al origen de la captura antes de recortar la imagen.",
          ],
          bullets: [
            "Los nodos fixed pasan a posicionarse de forma absoluta en la caja medida, con las transforms limpiadas para que el screenshot no los desplace dos veces.",
            "Los nodos sticky pasan a posicionarse de forma relativa durante el pase de captura.",
            "El desplazamiento de teselas usa scroll-behavior instantáneo para que el documento no se anime entre fotogramas.",
          ],
        },
      ],
    },
    "smart-selection": {
      title: "Localizadores inteligentes y selección del DOM",
      summary:
        "Entiende cómo un pin sigue a un elemento después de que la página cambia y por qué Pinar puede pedir una colocación manual.",
      sections: [
        {
          heading: "Huellas resistentes",
          paragraphs: [
            "Un pin de elemento combina un selector estable, camino DOM, tag, id, name, test id, role, clases, texto, etiqueta y geometría. Al reabrir, Pinar evalúa selector, estructura, semántica y geometría en lugar de confiar en un camino frágil.",
          ],
        },
        {
          heading: "Confianza y ambigüedad",
          paragraphs: [
            "Una coincidencia puede ser exact, probable, ambiguous o unresolved. Cuando dos candidatos son demasiado similares, Pinar conserva alternativas en lugar de encajar el pin en el elemento equivocado. Los destinos de iframe de origen cruzado pueden permanecer unresolved.",
          ],
        },
        {
          heading: "Reserva de selector y coincidencias en competencia",
          paragraphs: [
            "En el momento de la captura, Pinar prefiere un selector que coincida de forma única con el nodo por id, data-testid o data-test, o tag más name. Si ninguno de esos es único, guarda un camino CSS estructural. Los nombres de clase que parecen generados se omiten de la huella para que los módulos CSS con hash no se conviertan en la única señal.",
            "Al reabrir, se fusionan y ordenan los candidatos de las estrategias stable-selector, structure, semantic y geometry. La confianza exact exige un acierto de selector estable o de estructura con puntuación alta; las coincidencias semánticas y geométricas se quedan en probable. Cuando las dos puntuaciones viables más altas difieren en un margen estrecho, el resultado es ambiguous y no se elige ningún elemento.",
          ],
          bullets: [
            "Un selector posicional :nth-of-type puntúa más bajo cuando otros nodos comparten el mismo tag, texto y clases.",
            "Los pins de área se rechazan como destinos de elemento y permanecen unresolved durante la puntuación del localizador.",
            "Cuando el contentDocument de un iframe no se puede leer, la reubicación se detiene con un aviso cross-origin-frame en lugar de adivinar.",
          ],
        },
      ],
    },
    "privacy-masks": {
      title: "Enmascarar áreas sensibles",
      summary:
        "Oscurece regiones visuales antes de que el screenshot se serialice o se suba.",
      sections: [
        {
          heading: "Dibujar una máscara",
          paragraphs: [
            "Pulsa M mientras el modo de captura está activo y arrastra sobre la región sensible. Las máscaras de usuario se aplican a la imagen capturada antes del almacenamiento; elimina una máscara equivocada antes de copiar.",
          ],
        },
        {
          heading: "Las máscaras complementan la redacción",
          paragraphs: [
            "La sanitización automática cubre campos DOM sensibles conocidos y partes de URL. Las máscaras manuales cubren contenido visual que el software no puede clasificar con fiabilidad, como gráficos, avatares o datos renderizados en canvas.",
          ],
        },
        {
          heading: "Cómo llegan las máscaras a la imagen almacenada",
          paragraphs: [
            "El dibujo de máscaras no está disponible mientras hay un borrador de comentario abierto. Un arrastre válido guarda una máscara de usuario en coordenadas del documento para que siga el desplazamiento de la página, y hacer clic en esa superposición la elimina. Las cajas de campo automáticas del análisis de privacidad se combinan con esos rectángulos de usuario antes de copiar.",
            "Las regiones combinadas viajan con el mensaje de captura para pintarse sobre el screenshot antes del portapapeles o el almacenamiento. Una sanitización aparte sigue redactando secretos conocidos en URLs, valores de campo y texto de pins; las máscaras cubren píxeles que esas reglas de cadena no pueden clasificar.",
          ],
          bullets: [
            "Las máscaras de usuario usan un id único y una categoría manual para poder eliminarse con independencia de las cajas automáticas.",
            "Las máscaras de campo automáticas se descartan en lugar de eliminarse, de modo que análisis posteriores aún pueden informar del campo subyacente.",
            "Escape sale del dibujo de máscaras sin descartar los pins ya colocados en la página.",
          ],
        },
      ],
    },
    "copy-and-reopen": {
      title: "Copiar, ver y reabrir una captura",
      summary:
        "Pasa de la página activa al espacio de trabajo y de vuelta sin perder las anclas originales.",
      sections: [
        {
          heading: "Controles del visor",
          paragraphs: [
            "El visor de captura admite paneo con el puntero, zoom con la rueda anclado al cursor, zoom con doble clic y controles del 50% al 800%. Al seleccionar un pin se abren las pestañas Preview renderizado y Markdown Raw literal.",
          ],
          bullets: [
            "Descarga el screenshot o copia el Markdown de la sesión desde el visor.",
            "Abre el Markdown público en ChatGPT o Claude desde el menú de acciones del visor cuando el uso compartido esté disponible.",
          ],
        },
        {
          heading: "Revisar en la página original",
          paragraphs: [
            "Revisar en la página abre el origen capturado y rehidrata los pins. Pinar rechaza un desajuste de origen, conserva cada ancla y caja históricas, registra el historial de reubicación y permite reposicionar a mano un pin unresolved.",
          ],
        },
        {
          heading: "Portapapeles desde el visor y control de la reapertura",
          paragraphs: [
            "Copiar página en el visor escribe el mismo paquete Markdown correlacionado de la página activa, usando el handoff compact o full de las preferencias guardadas y `captureId` cayendo al id de la sesión. El menú de acciones abre el Markdown público en /v/{id}.md, o inicia ChatGPT o Claude con un prompt que apunta a esa URL.",
            "Revisar en la página despacha un evento de reapertura con el id de la sesión. El helper hidrata solo desde una URL de app Pinar de confianza cuando ese id coincide con el id de la sesión o `captureId` y el origen de la pestaña sigue siendo el origen de la página capturada. Navegar la pestaña fuera de ese origen suelta el vínculo en lugar de inyectar pins en el sitio equivocado.",
          ],
          bullets: [
            "Si no llega ningún resultado de reapertura, el visor muestra un aviso de helper ausente en lugar de esperar indefinidamente.",
            "Los visores públicos o antiguos que no pueden leer preferencias siguen copiando con handoff compact.",
            "Una pestaña que aún está en about:blank mantiene el vínculo de hidratación; solo un origen distinto lo suelta.",
          ],
        },
      ],
    },
    "send-to-agent": {
      title: "Enviar contexto visual a un agente",
      summary:
        "Pega el paquete completo de Pinar para que el agente vea juntos el comentario, el destino, la geometría y la imagen compartida.",
      sections: [
        {
          heading: "Qué pegar",
          paragraphs: [
            "Pinar escribe Markdown plano y HTML en el portapapeles. El texto incluye anotaciones legibles más un bloque JSON pinar-visual-context delimitado. Pega ambos como una unidad; el bloque estructurado es la fuente de verdad legible por máquina.",
          ],
        },
        {
          heading: "Screenshot y avisos",
          paragraphs: [
            "Si el paquete lista una ruta absoluta de Screenshot, el agente local debe abrir esa única imagen; las insignias numeradas son superposiciones. Avisos como `screenshot_missing`, `helper_unavailable` o `viewer_unavailable` describen una entrega degradada, pero no invalidan los comentarios ni el contexto DOM.",
          ],
        },
        {
          heading: "Cómo entregar el paquete copiado a un agente",
          paragraphs: [
            "La extensión de Chrome nunca escribe en el compositor del agente. Después de Command/Ctrl+Enter, pega tú mismo el portapapeles en Cursor, Claude, Codex o Grok. El texto empieza con instrucciones para implementar los comentarios de los pins y tratar el selector y el camino DOM como localizadores complementarios, seguidas de un bloque JSON pinar-visual-context delimitado. Si se incluye una URL de Viewer, recupérala solo cuando esos detalles no basten.",
            "Trata `captureId` y `pinId` como identidad, no como etiquetas a reescribir. Visual Context actualmente codifica schemaVersion 1; parseVisualCapture rechaza un `captureId` ausente y cualquier schemaVersion distinto de 1 o el legado 0. Cambia solo lo que describen los pins. Si la persona nunca pegó, pídele que copie de nuevo desde Pinar en lugar de reconstruir pins de memoria.",
          ],
          bullets: [
            "Pega el portapapeles entero en el agente; no reescribas comentarios ni inventes un `captureId` nuevo.",
            "Confirma que el texto pegado aún contiene un cierre de cerca pinar-visual-context antes de empezar a editar código.",
            "Si no se pegó nada, pide Command/Ctrl+Enter en Pinar e implementa solo los comentarios de los pins.",
          ],
        },
      ],
    },
    "handoff-formats": {
      title: "Formatos y destinos de handoff",
      summary:
        "Elige contexto compacto o completo y una presentación específica por agente sin cambiar la identidad de la captura.",
      sections: [
        {
          heading: "Compacto y completo",
          paragraphs: [
            "El modo compact elimina ruido redundante de localizadores y geometría y conserva la correlación. El modo full conserva el payload íntegro. Una preferencia aparte incluye u omite screenshots; desactivarlos preserva metadatos, pins, localizadores, revisión y handoff, y evita almacenar la imagen. Los datos de imagen inline se eliminan de los payloads de texto para evitar prompts demasiado grandes. El diálogo Settings del espacio de trabajo sincroniza estas preferencias de entrega con el backend activo.",
          ],
        },
        {
          heading: "Adaptadores de agentes",
          paragraphs: [
            "Pinar puede adaptar el preámbulo y la forma del Markdown para Claude, Codex, Grok y otros destinos de agente de código compatibles. El contrato subyacente de `captureId`, `pinId` y visual-context permanece igual.",
          ],
        },
        {
          heading:
            "Elegir el modo de entrega en las opciones de la extensión antes de copiar",
          paragraphs: [
            "En las opciones de la extensión, un interruptor define handoffMode como full cuando está marcado y compact cuando no. compact es el valor predeterminado almacenado y conserva cada hecho útil una vez: `pinId`, comment, cssSelector, domPath e innerText, más box o coords solo en pins de área o pins sin localizador. full conserva la captura íntegra. Ambas proyecciones siguen eliminando URLs de screenshot data: del JSON; una imagen inline se guarda como URL nula y un aviso screenshot_inline para que el prompt se mantenga acotado.",
            "Haz clic en Save para que preferences:set escriba handoffMode e `includeScreenshot` en el backend activo y en chrome.storage.sync. Los valores desconocidos de handoffMode caen a compact; `includeScreenshot` por defecto es true. Los destinos de adaptador son cursor, claude, codex y grok: cada uno antepone su propio preámbulo, pero `captureId`, pinIds y comentarios permanecen idénticos. El interruptor copy-viewer-content se desactiva siempre que includeViewer está off.",
          ],
          bullets: [
            "Ajusta el interruptor compact/full y el de `includeScreenshot`, y haz clic en Save antes de la siguiente copia.",
            "Deja `includeScreenshot` activado salvo que quieras a propósito metadatos, pins, localizadores y handoff sin almacenamiento de imagen.",
            "Después de guardar, copia una vez y confirma que cada pegado de adaptador sigue compartiendo el mismo `captureId` y los mismos pinIds.",
          ],
        },
      ],
    },
    "closed-loop-review": {
      title: "Cerrar el ciclo de revisión del agente",
      summary:
        "Sigue lo que cambió un agente, verifícalo como humano y reabre solo cuando haga falta otra corrección.",
      sections: [
        {
          heading: "Retorno del agente",
          paragraphs: [
            "Un agente puede informar cada pin como changed, blocked, not applicable o not located, con un resumen, un motivo, archivos cambiados, commit y pull request. Una entrega repetida con la misma clave de idempotencia es segura; el contenido conflictivo bajo esa clave se rechaza.",
          ],
        },
        {
          heading: "Verificación humana",
          paragraphs: [
            "Un resultado changed pasa un pin open o reopened a listo para corrección. Solo un humano puede aceptar una corrección o reabrir un pin aceptado. Los agentes no pueden aceptar su propio trabajo, y las transiciones de estado no válidas se rechazan.",
          ],
          bullets: [
            "Flujo normal: abierto → listo para corrección → aceptado.",
            "Si la verificación falla: aceptado → reabierto → listo para corrección.",
          ],
        },
        {
          heading: "Registrar una ejecución y aceptarla como humano",
          paragraphs: [
            "POST /api/agent-executions con agent igual a claude, codex, cursor o grok, el `captureId` de la captura, un idempotencyKey de 8 a 128 caracteres que coincida con [A-Za-z0-9_-] y un array results no vacío. Cada resultado necesita un `pinId` que ya exista en esa captura, un status y un summary de como máximo 2000 caracteres; los files opcionales se limitan a 50 rutas, y pullRequest debe ser una URL http(s). Una huella conflictiva bajo la misma clave es idempotency_conflict (409). Un `pinId` desconocido es pin_not_found (400) sin devolver los comentarios de la captura; un `captureId` desconocido es capture_not_found (404).",
            "La revisión humana es un POST aparte a /api/sessions/{id}/pins/{`pinId`}/review con action accept o reopen. humanActionsForStatus ofrece accept solo en correction_ready y reopen solo en accepted; open y reopened no exponen acciones humanas, y cualquier otra transición es invalid_transition (409). Tras un reopen humano, una segunda ejecución changed es el reintento previsto. Deja Share anonymous loop metrics desactivado salvo que te unas: comentarios, URLs, selectores y screenshots se rechazan como forbidden_fields incluso cuando optIn es true.",
          ],
          bullets: [
            "Publica un resultado changed para el mismo `captureId` y `pinId`, y confirma que el visor muestra correction_ready antes de aceptar.",
            "Reutiliza un idempotencyKey solo con la misma huella; genera una clave nueva cuando los archivos, el resumen o el status hayan cambiado de verdad.",
            "Si la verificación falla, reabre como humano, publica un segundo resultado, acepta de nuevo y conserva los capture ids anterior y posterior.",
          ],
        },
      ],
    },
    "reopen-and-relocate": {
      title: "Reabrir y reubicar pins",
      summary:
        "Revisa la implementación en la página activa incluso después de que su DOM haya cambiado.",
      sections: [
        {
          heading: "Rehidratación segura",
          paragraphs: [
            "Pinar abre la página guardada e hidrata solo cuando el origen de la pestaña activa coincide exactamente con la captura. Los orígenes de app de confianza pueden pedir una reapertura, pero un sitio no relacionado no puede inyectar una sesión en la extensión.",
          ],
        },
        {
          heading: "Corrección manual",
          paragraphs: [
            "Si un destino es ambiguous o unresolved, reposiciona el pin a mano. El ancla y la caja originales permanecen congeladas en el historial, y cada reubicación automática o manual se registra para una revisión posterior.",
          ],
        },
        {
          heading: "Abrir la URL original y colocar pins pendientes",
          paragraphs: [
            "session:reopen se acepta solo desde un origen de app Pinar de confianza: https en pinar.dev o un host *.pinar.dev, o http en puertos de loopback 17373 a 17382. El helper obtiene /api/sessions/{id} y abre una pestaña nueva en la URL de página guardada. Cualquier otro sitio recibe untrusted_app. Un id solicitado que no coincida con session.id ni `captureId` es session_mismatch; una captura sin page.url es missing_page. Tras la carga, la hidratación se inyecta en todos los frames y conserva solo los pins cuyo camino DOM pertenece a ese frame.",
            "La hidratación continúa solo mientras el origen de la pestaña sigue coincidiendo con la captura. Navegar a otro sitio suelta el vínculo y muestra This page is not the original capture URL; about:blank se trata como transitorio y no lo suelta. Las coincidencias de localizador ambiguous o unresolved dejan la caja activa sin cambios en lugar de encajarla en un sosias. Haz clic en un pin pendiente y luego en el elemento correcto: selector, camino y huella permanecen congelados, location pasa a exact con evidencia manual-reposition y locationHistory añade una entrada manual exact.",
          ],
          bullets: [
            "Inicia Revisar en la página desde la app Pinar para que solo esa sesión se hidrate en el origen capturado.",
            "Si la superposición dice This page is not the original capture URL, vuelve al origen capturado en lugar de colocar pins.",
            "En un pin unresolved, haz clic en el marcador, haz clic en el elemento activo y confirma que locationHistory ganó una entrada manual exact.",
          ],
        },
      ],
    },
    "handoff-troubleshooting": {
      title: "Resolver avisos de copia y handoff",
      summary:
        "Recupérate de fallos del portapapeles, el helper, el screenshot o el visor sin perder las anotaciones.",
      sections: [
        {
          heading: "Recuperación del portapapeles",
          paragraphs: [
            "Pinar usa primero la API de portapapeles del navegador a través de un documento offscreen y cae a una selección de texto oculta cuando el permiso o el foco lo impiden. Si fallan todos los mecanismos de copia, se restaura la superposición para que pins y comentarios sigan siendo editables.",
          ],
        },
        {
          heading: "Degradado no significa sin correlación",
          paragraphs: [
            "`screenshot_missing` significa que la imagen no se pudo persistir. `helper_unavailable` significa que no se alcanzó el servicio local. `viewer_unavailable` significa que no se produjo una URL de visor. Continúa a partir del comentario, el camino DOM, el selector, las coordenadas del pin, `captureId` y `pinId`, y reintenta solo la capa que falta.",
          ],
        },
        {
          heading:
            "Recorrer el camino de copia cuando la barra informa de un fallo",
          paragraphs: [
            "La copia exige un comentario guardado y al menos un pin. La barra muestra Copying…, oculta las superposiciones, captura el shot y pide al documento offscreen que escriba text/html y text/plain. El offscreen intenta primero navigator.clipboard.write y cae a un evento copy más execCommand. Si esa escritura no es ok, el content script aún intenta writePlainText sobre el payload plain devuelto: clipboard.writeText y luego una selección oculta en un textarea.",
            "Cuando fallan todos los caminos de copia, la página envía overlays:hidden con hidden false, muestra Copy failed y deja los pins editables. Una copia correcta muestra Copied, o Copied más no screenshot, helper unavailable o no viewer, y luego termina la sesión. Esos sufijos corresponden a `screenshot_missing`, `helper_unavailable` y `viewer_unavailable`. screenshot_inline no es uno de los avisos de handoff degradado. Un pegado sin una cerca pinar-visual-context cerrada no se puede analizar como JSON.",
          ],
          bullets: [
            "Si la barra dice Write a comment first o Add a pin first, termina ese pin y pulsa Command/Ctrl+Enter otra vez.",
            "Si aparece Copy failed, confirma que los pins siguen en la página, concede el permiso de portapapeles si se pide y reintenta la copia.",
            "Lee el sufijo de Copied: no screenshot, helper unavailable y no viewer nombran la capa que falta para reintentar sin descartar comentarios.",
          ],
        },
      ],
    },
    "organize-projects": {
      title: "Organizar proyectos y sesiones",
      summary:
        "Mueve capturas sin perderlas y conserva Personal como reserva protegida.",
      sections: [
        {
          heading: "Proyectos y reserva",
          paragraphs: [
            "Los proyectos agrupan colecciones y sesiones. Personal es el proyecto predeterminado protegido e Inbox es su colección protegida. Eliminar otro proyecto asciende sus sesiones a la reserva en lugar de destruirlas.",
          ],
        },
        {
          heading: "Mover y ordenar",
          paragraphs: [
            "Arrastra sesiones entre colecciones, reordénalas o usa Mover a masivo para un conjunto seleccionado. En una colección, Mover antes y Mover después ajustan el orden manual guardado.",
          ],
        },
        {
          heading: "Confirmar dónde aterriza una sesión movida",
          paragraphs: [
            "Abre una colección antes de usar Mover antes o Mover después. Esos elementos aparecen solo en una vista de colección, intercambian la sesión con su vecina en la lista de posiciones guardada y no hacen nada en la primera o la última fila. El panel entonces hace POST de esa lista completa de ids a `/api/collections/{id}/sessions/reorder`. Cuando no hay ninguna colección seleccionada, el listado ordena por fecha de creación en lugar de ese orden guardado.",
            "Un arrastre empieza en la tarjeta o la fila de tabla, no desde la búsqueda, las casillas ni el menú de acciones (`data-no-dnd`). Si la sesión arrastrada ya está seleccionada junto con otras, viajan con ella todos los ids seleccionados; si no, solo se mueve esa sesión. Mover a pide un proyecto y luego una colección en el árbol aplanado de ese proyecto; cambiar de proyecto limpia el campo de colección, y un proyecto sin colecciones queda desactivado. La sesión se añade en la siguiente posición del destino. Eliminar Personal se rechaza; eliminar otro proyecto añade sus sesiones a Inbox en el orden existente y quita las colecciones de ese proyecto.",
          ],
          bullets: [
            "Selecciona una colección y usa Mover antes o Mover después solo cuando exista un vecino; la primera fila no puede moverse antes y la última no puede moverse después.",
            "Para mover varias sesiones, selecciónalas primero y luego arrastra cualquier tarjeta seleccionada o abre Mover a; arrastrar una tarjeta no seleccionada mueve solo esa sesión.",
            "Tras eliminar un proyecto que no sea Personal, abre Personal / Inbox y recorre el final de la lista en busca de las sesiones añadidas antes de volver a archivarlas.",
          ],
        },
      ],
    },
    "nested-collections": {
      title: "Usar colecciones anidadas",
      summary:
        "Construye una jerarquía dentro de cada proyecto y reorganízala sin aplanar las relaciones hijas.",
      sections: [
        {
          heading: "Árbol de colecciones",
          paragraphs: [
            "Las colecciones pueden tener colecciones padre e hijas. Arrastrar una rama conserva la profundidad y las relaciones descendientes al moverla dentro del mismo árbol de proyecto. Se rechazan los ciclos, los padres desconocidos y el anidado bajo un contenedor protegido. Eliminar un padre asciende sus colecciones hijas al nivel del padre en su orden existente.",
          ],
        },
        {
          heading: "Destinos desde la captura",
          paragraphs: [
            "La extensión puede apuntar a un proyecto o una colección antes de guardar en la nube. Si un destino seleccionado ya no está disponible, la reserva protegida Personal/Inbox mantiene la sesión accesible.",
          ],
        },
        {
          heading: "Indentar una rama y luego verificar el padre",
          paragraphs: [
            "Al arrastrar una colección, el desplazamiento horizontal se mide en pasos de sangría de 18 píxeles. La profundidad proyectada se limita para que no pueda ir más hondo que un nivel bajo el hermano anterior ni más superficial que el hermano siguiente. Soltar una rama sobre uno de sus descendientes se ignora y el árbol no se mueve. Las colecciones protegidas permanecen en profundidad 0, y la lista ordenable trata a los hijos de una colección protegida como raíces para que no puedan seguir anidados bajo ese contenedor protegido.",
            "En el selector de destino de la extensión, `destination:get` devuelve un CaptureDestination (`projectId` y `collectionId`) más el árbol del proyecto, con las colecciones anidadas sangradas 16 píxeles por profundidad. Cambiar de proyecto guarda de inmediato la colección protegida de ese proyecto si existe, o si no su primera colección. Si `destination:set` falla, la página de opciones muestra el error de destino no disponible y recarga `destination:get` para que una colección ausente no siga seleccionada. Un árbol vacío muestra un marcador Inbox desactivado.",
          ],
          bullets: [
            "Arrastra una colección a la derecha para anidarla bajo el hermano anterior, o a la izquierda hacia la raíz; si el soltado se rechaza, la lista parentId no cambia.",
            "Contrae un padre solo cuando necesites una barra lateral más corta; los descendientes ocultos permanecen en el árbol y siguen moviéndose con la rama arrastrada.",
            "Tras un error al guardar el destino, vuelve a abrir las opciones de la extensión y confirma que el proyecto y la colección coinciden con una entrada viva del árbol antes de la siguiente captura en la nube.",
          ],
        },
      ],
    },
    "find-manage-share": {
      title: "Buscar, gestionar y compartir sesiones",
      summary:
        "Busca en todos los campos útiles, filtra el trabajo de revisión, actúa en lote y publica solo lo que pretendes.",
      sections: [
        {
          heading: "Búsqueda y vistas",
          paragraphs: [
            "La búsqueda coincide con el título de la página, la URL, la descripción, los comentarios de pins y los selectores CSS. Los filtros de recuento de pins y de estado de revisión se pueden combinar. Cambia entre cuadrícula de tarjetas y tabla; la tabla ofrece 15, 30, 60 o 100 filas por página y recuerda la vista en local.",
          ],
        },
        {
          heading: "Acciones masivas y de uso compartido",
          paragraphs: [
            "Selecciona sesiones en cualquiera de las vistas para moverlas o eliminarlas juntas. Eliminar una sesión es permanente: quita el screenshot más las ejecuciones del agente, los resultados de pins, las revisiones y los eventos de revisión. Los visores públicos de sesiones, proyectos y colecciones son no listados, no controlados por acceso; cualquiera con un enlace vivo puede abrir uno. Los visores agregados pueden copiar Markdown combinado de todas las sesiones incluidas.",
          ],
        },
        {
          heading: "Combinar filtros y luego copiar el Markdown público",
          paragraphs: [
            "La búsqueda recorta espacios y coincide como subcadena sin distinguir mayúsculas. Una consulta de solo espacios deja elegibles todas las sesiones hasta que los filtros de recuento de pins o de estado de revisión las excluyan. Las casillas de recuento de pins son cubos de 1, 2–5 y 6 o más; una sesión debe coincidir con al menos un cubo seleccionado. Los filtros de estado de revisión se aplican contra reviewCounts almacenados; si esos recuentos faltan, cada pin se trata como open. Cambiar la búsqueda, cualquiera de los filtros, la colección o el proyecto restablece la paginación a la primera página.",
            "Seleccionar todo en la cuadrícula se aplica solo a la página actual de tarjetas; seleccionar todo en la tabla usa la página actual de la tabla. La elección de cuadrícula o tabla se guarda en localStorage como `pinar-history-view`. La eliminación masiva abre un diálogo de confirmación y luego DELETE `/api/history/{id}` por cada id seleccionado. Un visor público de proyecto o colección carga `/api/public/projects/{id}` o `/api/public/collections/{id}` y copia Markdown combinado de `/p/{id}.md` o `/c/{id}.md`. Si esa obtención pública no es ok, el visor muestra un estado de no encontrado en lugar de una lista.",
          ],
          bullets: [
            "Tras aplicar la búsqueda o los filtros, confirma que la paginación saltó a la página 1 para no leer una página obsoleta de un resultado anterior.",
            "Usa Mover a o Eliminar de la barra masiva solo cuando las casillas coincidan con las sesiones que pretendes; Borrar selección vacía el conjunto sin cambiar el almacenamiento.",
            "En un visor agregado, Copiar Markdown debe pegar un encabezado, una URL de visor `/p/` o `/c/` y luego cada sesión como un encabezado `/v/{id}` con Page, Markdown, Screenshot opcional y comentarios de pins numerados; si la copia falla con Unable to load Markdown, abre la misma URL `.md` en el navegador.",
          ],
        },
      ],
    },
    "account-and-sign-in": {
      title: "Cuenta y acceso sin contraseña",
      summary:
        "Conecta la extensión, abre el espacio de trabajo web y entiende la caducidad de códigos y sesiones.",
      sections: [
        {
          heading: "Dos flujos de código",
          paragraphs: [
            "Las instalaciones Remote Free pueden abrir la app web con un código de extensión de un solo uso, válido cinco minutos. Crear un código nuevo de ocho caracteres invalida el anterior activo; la generación permite 10 peticiones por cinco minutos por IP y cuenta, y el intercambio permite 20 intentos por cinco minutos por IP. Las cuentas de pago y las que ya pagaron también pueden solicitar un código de seis dígitos por correo; caduca a los diez minutos y se bloquea tras cinco intentos no válidos.",
          ],
        },
        {
          heading: "Sesiones",
          paragraphs: [
            "Las sesiones web duran 30 días y los dispositivos de extensión autenticados, 180 días. El servidor almacena hashes de códigos y tokens de sesión en lugar de los valores secretos originales.",
          ],
        },
        {
          heading:
            "Terminar el emparejado desde la pestaña Account de la extensión",
          paragraphs: [
            "En una instalación Remote Free, abre la pestaña Account de las opciones de la extensión, genera ahí el código temporal y cópialo. Abre la página de acceso alojada desde esa misma pestaña; el enlace apunta a /sign-in con returnTo=/app para que un intercambio correcto aterrice en el espacio de trabajo web. Regenerar pide confirmación primero porque el servidor elimina todos los códigos no usados de ese propietario antes de insertar el valor nuevo de ocho caracteres. Pega el código en pinar.dev y no en loopback: el helper local redirige /sign-in al origen alojado y no emite sesiones en la nube por sí mismo.",
            "Solicitar un código por correo siempre informa accepted con una pista de diez minutos, también para direcciones desconocidas, cuentas no pagadas o cuando falta el servicio de correo, de modo que el formulario no sea un oráculo de cuentas. Un mensaje real de seis dígitos se envía solo a una cuenta ever-paid; si el envío lanza, esa fila de desafío se elimina. Las peticiones de correo permiten 10 intentos por IP y 5 por dirección cada 15 minutos; la verificación permite 20 por IP y 10 por dirección cada 15 minutos. Enviar el código junto con la identidad de la instalación migra ese espacio de trabajo Remote Free a la cuenta de pago y emite un token de dispositivo de 180 días. Cerrar sesión revoca la cookie pinar_session y cualquier bearer de dispositivo presentado en la misma petición.",
          ],
          bullets: [
            "Si no llega ningún correo, espera a que pase la ventana de petición de 15 minutos antes de reintentar; un 429 significa que se alcanzó el límite de IP o de dirección, mientras que una respuesta accepted silenciosa puede significar que la dirección no está pagada o es desconocida.",
            "Confirma el diálogo de regeneración antes de invalidar un código que aún pretendes escribir en la página de acceso alojada.",
            "Usa Sign out en la pestaña Account, o POST /api/auth/logout, cuando necesites revocar de inmediato la cookie web actual o la sesión de dispositivo de la extensión.",
          ],
        },
      ],
    },
    "plans-and-billing": {
      title: "Free, Pro, Founder y facturación",
      summary:
        "Compara los derechos del producto, gestiona una suscripción y trata la página de precios como la fuente actual de precios.",
      sections: [
        {
          heading: "Forma del plan",
          paragraphs: [
            "Free incluye uso local permanente, 250 MB de cuota en la nube, retención en la nube de siete días y cinco créditos de IA iniciales. Pro es mensual o anual, con 5 GB y 200 créditos de IA sin acumulación recargados cada mes. Founder es una cohorte limitada de una sola vez, con 5 GB y 500 créditos iniciales; no incluye recarga mensual de créditos.",
          ],
        },
        {
          heading: "Facturación y disponibilidad",
          paragraphs: [
            "Los precios regionales en BRL o globales en USD, la disponibilidad de Founder y las ofertas actuales pertenecen a la página Planes. Stripe Checkout reserva un cupo Founder durante 15 minutos y lo libera cuando se abandona el checkout. El portal de clientes de Stripe gestiona cambios de plan, cancelación, métodos de pago y facturas.",
          ],
        },
        {
          heading:
            "Iniciar Checkout con las políticas vigentes y la moneda correcta",
          paragraphs: [
            "POST /api/stripe/checkout rechaza la oferta hasta que se acepten las versiones vigentes de Términos, Política de privacidad y Uso aceptable. Un país Cloudflare BR selecciona el catálogo BRL y los Price IDs de Stripe de Brasil; cualquier otro país usa USD. El checkout de Founder primero inserta una reserva de capacidad claveada por el id de petición de checkout y el hash de claim, y luego adjunta el id de sesión de Stripe; crear la sesión de Stripe sin una reserva adjuntable libera el cupo. FOUNDER_SALES_ENABLED debe ser true con un FOUNDER_CAPACITY_LIMIT positivo o el manejador devuelve 503; una cohorte llena o un desajuste de claim en un id de petición reutilizado devuelve 409.",
            "La URL de éxito lleva session_id y claim; la activación compara ese claim con los metadatos de Stripe y solo entonces concede la oferta. GET /api/pricing expone founderState como closed, sold_out o available para que la página Planes pueda ocultar una cohorte que el checkout rechazaría. El portal de facturación exige una cuenta autenticada que ya tenga un stripeCustomerId y vuelve a /app. Cuando la facturación de Pro deja de estar activa, las sesiones de ese plan reciben un retention_expires_at 90 días después de que terminó la elegibilidad de pago; las cuentas Founder y las de lifetime heredadas conservan las sesiones marcadas como permanentes en lugar de entrar en esa ruta de caducidad.",
          ],
          bullets: [
            "Acepta las versiones vigentes de las políticas en el flujo alojado de Planes antes de pagar; una aceptación ausente devuelve legal_acceptance_required en lugar de una URL de Stripe.",
            "Si el checkout de Founder devuelve 409, recarga /api/pricing: closed o sold_out significa esperar a una reserva liberada o elegir Pro en lugar de reintentar el mismo claim con un id de petición nuevo.",
            "Si el portal devuelve 401 o 404 No Stripe customer found, completa primero un Checkout de pago para que exista un id de cliente y luego vuelve a abrir Manage subscription desde una sesión de cuenta.",
          ],
        },
      ],
    },
    "ai-credits": {
      title: "Resúmenes de IA y créditos",
      summary:
        "Sabe cuándo se reservan, gastan, recargan o reembolsan los créditos.",
      sections: [
        {
          heading: "Coste del resumen",
          paragraphs: [
            "Un resumen de sesión reserva 100 créditos de IA antes de la inferencia del modelo. Si tiene éxito, la reserva se consume. Una inferencia fallida o abortada la reembolsa de inmediato; una reserva sin liquidar durante más de cinco minutos se reembolsa automáticamente. Los resúmenes permiten 10 peticiones por minuto por cuenta y 30 por minuto por IP; una petición duplicada de la misma sesión espera a que termine la petición activa.",
          ],
        },
        {
          heading: "Saldos",
          paragraphs: [
            "Los paquetes comprados añaden 1.000 créditos. La asignación mensual de 200 créditos de Pro no se acumula. Los 500 créditos de Founder son un saldo de activación, no una asignación mensual. El menú de cuenta muestra el saldo activo y la próxima fecha de recarga aplicable.",
          ],
        },
        {
          heading:
            "Reintentar resúmenes con un request id nuevo y leer el libro mayor",
          paragraphs: [
            "POST /api/ai/session-summary exige un requestId único más una sesión de tu propiedad. Reutilizar el mismo requestId en esa sesión devuelve el payload de éxito almacenado o 409 ai_request_in_progress mientras la inferencia sigue reservada. Tras el tiempo de espera de reserva de cinco minutos, el uso se reembolsa como reservation_timeout y la siguiente llamada debe usar un requestId nuevo; un reintento caducado que aún no puede reembolsar devuelve 503 ai_refund_pending. Una inferencia fallida o abortada reembolsa de inmediato cuando es posible. Un saldo insuficiente devuelve 402 insufficient_ai_credits con el saldo en vivo. Si falta Workers AI, se devuelve 503 ai_unavailable.",
            "El selector de concesiones gasta primero los saldos que no son de compra y luego la concesión que caduca antes, de modo que los créditos mensuales incluidos que caducan en el siguiente mes UTC se usan antes de un paquete comprado. Un paquete comprado de 1.000 créditos se guarda con un expires_at de 12 meses y sale de la consulta de saldo cuando pasa esa marca de tiempo. GET /api/account/entitlements devuelve los créditos restantes sumados, nextExpiryAt y nextRefillAt para cuentas Founder y para cuentas Pro cuyo billing_status es active. El idioma solicitado del resumen debe ser de, en, es, fr, ja, pt o zh; cualquier otro valor se escribe como inglés.",
          ],
          bullets: [
            "Ante 409 ai_request_in_progress, espera a que termine el requestId en vuelo en lugar de abrir un segundo resumen en la misma sesión.",
            "Ante ai_request_refunded o reservation_timeout, envía un requestId nuevo; repetir el id caducado no arrancará otra inferencia.",
            "Si el espacio de trabajo muestra cero créditos, llama a /api/account/entitlements y compara nextExpiryAt con los paquetes comprados antes de comprar otra oferta de 1.000 créditos.",
          ],
        },
      ],
    },
    "storage-and-retention": {
      title: "Almacenamiento, retención y recuperación",
      summary:
        "Entiende las cuotas, los complementos que caducan, las subidas bloqueadas y la ventana de recuperación.",
      sections: [
        {
          heading: "Cuota y complementos",
          paragraphs: [
            "Free tiene 250 MB de almacenamiento base en la nube; Pro y Founder tienen 5 GB. Los complementos opcionales de 5 GB y 20 GB duran 12 meses, con correos de recordatorio siete días y un día antes de caducar. Las subidas de screenshot deben ser archivos PNG válidos y pasar una comprobación atómica de cuota antes del almacenamiento. Las subidas se pausan cuando los bytes resultantes superan la cuota actual.",
          ],
        },
        {
          heading: "Tras la caducidad del derecho",
          paragraphs: [
            "Si un derecho que caduca deja la cuenta por encima de la cuota, Pinar concede un periodo de gracia de 30 días seguido de acceso de recuperación hasta el día 90. Después, el exceso de datos pasa a ser elegible para limpieza. La eliminación automática no está habilitada ahora, así que la elegibilidad no es una promesa de eliminación inmediata.",
          ],
        },
        {
          heading:
            "Ajustar reemplazos a la cuota y usar el reloj de recuperación de 90 días",
          paragraphs: [
            "La cuota es `baseBytes` más los bytes de complementos aún activos. `canStoreBytes` trata una sobrescritura como `usedBytes` menos los bytes ya almacenados de esa sesión más el tamaño entrante, de modo que reemplazar un PNG más grande por uno más pequeño puede tener éxito cuando una captura nueva superaría la cuota. `uploadAllowed` es false siempre que `usedBytes` ya esté en o por encima de la cuota. Superar la cuota sin un timestamp `latestExpiredAt` es el estado over_quota, sin reloj de gracia. Cuando `latestExpiredAt` se establece a partir de un complemento caducado o de `paidEligibilityEndedAt`, la cuenta está en gracia 30 días, recuperable hasta el día 90 y luego cleanup_eligible; las subidas siguen prohibidas en los tres estados.",
            "Las sesiones en la nube de Free no permanentes pasan a ser elegibles para eliminación a los siete días. El contenido de Pro por encima de la cuota de Free sigue la gracia de 30 días y la ventana de recuperación de 90 días tras terminar la elegibilidad de pago. El contenido Founder y el de lifetime heredado no se vuelve elegible para eliminación solo porque no haya una suscripción recurrente; sigue limitado por la cuota comprada, la eliminación del usuario, las retenciones por abuso y legales, el cierre de cuenta y la discontinuación del servicio. El historial solo local del dispositivo nunca se elimina de forma remota. La elegibilidad para eliminación no es una promesa de retirada inmediata, y la eliminación automática alojada está desactivada de forma intencionada.",
          ],
          bullets: [
            "Cuando se pausen las capturas nuevas, reduce `usedBytes` por debajo de la cuota restante eliminando sesiones o reemplazando un screenshot pesado, o compra un complemento de doce meses de 5 GB o 20 GB.",
            "Si el estado del derecho es grace o recoverable, exporta lo que aún necesites antes del día 90 después de `latestExpiredAt`; cleanup_eligible solo marca el excedente, no elimina por sí mismo.",
            "No esperes que desinstalar la app de escritorio borre objetos en la nube, ni que la nube borre el historial local de ~/.pinar.",
          ],
        },
      ],
    },
    "sharing-links": {
      title: "Compartir sesiones, proyectos y colecciones",
      summary:
        "Usa visores no listados y proyecciones Markdown con las expectativas de privacidad correctas.",
      sections: [
        {
          heading: "Enlaces públicos no listados",
          paragraphs: [
            "Existen visores en la nube para una sesión, un proyecto o una colección. Son públicos para cualquiera que tenga el enlace y no se indexan como navegación normal. No trates una URL no listada como autenticación para contenido sensible.",
          ],
        },
        {
          heading: "Markdown para agentes",
          paragraphs: [
            "La proyección .md de una sesión incluye metadatos, referencias de screenshot, localizadores, resultados del agente e historial de revisión. Las proyecciones de proyecto y colección combinan sus sesiones. Los datos compartidos caducados o no disponibles devuelven una respuesta de no encontrado en lugar de detalles privados de la cuenta.",
          ],
        },
        {
          heading: "Copiar la proyección Markdown pública y saber qué expone",
          paragraphs: [
            "El HTML no listado vive en /v/{id} para una sesión, /p/{id} para un proyecto y /c/{id} para una colección. La proyección Markdown es la misma ruta con un sufijo .md. El visor agregado carga /api/public/projects/{id} o /api/public/collections/{id} sin cookie de autenticación; Copiar Markdown entonces hace GET de /p/{id}.md o /c/{id}.md y escribe el texto en el portapapeles, y cada tarjeta de sesión abre /v/{id}. Un id ausente o mal formado devuelve Session not found, Project not found o Collection not found en lugar del correo del propietario, el plan u otros campos de cuenta.",
            "El Markdown de sesión se construye a partir del paquete de handoff más las secciones de resultado del agente y revisión de pins. El Markdown de proyecto y colección lista cada sesión anidada con URL de página, /v/{id}.md, URL opcional de screenshot, comentarios de pins, `pinId`, camino DOM, selector y texto interior. Las líneas de screenshot aparecen solo cuando la preferencia de entrega `includeScreenshot` del propietario las permite. El Markdown y el JSON público se almacenan en caché como public max-age=60; los PNG de shot se almacenan en caché 86400 segundos. Cualquiera que pueda abrir el enlace puede copiar lo que ve, así que una URL no listada no es autorización ni minimización de datos.",
          ],
          bullets: [
            "Antes de enviar /p/{id} o /c/{id}, abre Copiar Markdown una vez y comprueba que cada sesión anidada, comentario de pin y línea de screenshot es seguro de publicar.",
            "Desactiva la entrega de screenshots en la cuenta del propietario si la proyección debe dejar fuera las URLs de imagen; espera al menos 60 segundos a que caduque la caché pública de Markdown.",
            "Si una ruta compartida muestra no encontrado, trata el id como desaparecido o no válido; los manejadores públicos nunca añaden diagnósticos privados de cuenta a esa respuesta.",
          ],
        },
      ],
    },
    "where-data-lives": {
      title: "Dónde viven tus datos",
      summary:
        "Separa archivos locales, persistencia en la nube, preferencias del navegador y proyecciones públicas.",
      sections: [
        {
          heading: "Límite local",
          paragraphs: [
            "Los screenshots locales son archivos en `~/.pinar/shots` y el historial local es SQLite en `~/.pinar/history.db`, con un respaldo JSON cuando SQLite no está disponible. Preferencias del navegador como vista, idioma, tema y ajustes de entrega permanecen en el almacenamiento local del navegador salvo que una función las sincronice de forma explícita.",
          ],
        },
        {
          heading: "Límite en la nube",
          paragraphs: [
            "Los registros de cuenta en la nube y los metadatos de captura usan Cloudflare D1; las imágenes usan R2. Stripe procesa la facturación, el servicio de correo configurado envía códigos de acceso y Workers AI gestiona los resúmenes solicitados. La página Subprocesadores es la lista actual de roles de servicios externos.",
          ],
        },
        {
          heading: "Confirmar qué almacén guarda realmente cada captura",
          paragraphs: [
            "Empieza en el directorio de inicio del helper y comprueba qué archivo está activo. Los screenshots se escriben como PNG en la carpeta shots; el historial de sesiones prefiere SQLite en `history.db`, y `history.json` se abre solo después de que `SqliteHistoryDb` no se pueda construir. Una apertura correcta de SQLite también reescribe los prefijos de ruta anidados shots/shots sobre el directorio canónico shots. El tema sigue siendo una preferencia solo del navegador: la pestaña Interface guarda dark o light bajo la clave de localStorage pinar-theme y elimina esa clave para system. El idioma más los interruptores de la pestaña Capture para el modo de handoff (full frente a compact) e include-screenshot se editan en el mismo diálogo de ajustes, pero una cuenta en la nube con sesión iniciada puede persistir handoff_mode e include_screenshot en D1 owner_preferences mediante GET y PATCH /api/preferences.",
            "Las capturas alojadas guardan metadatos en D1 y bytes PNG en R2. Las proyecciones públicas no autenticadas son GET /shots/{id}.png (Cache-Control max-age 86400), GET /v/{id}.md y las rutas de proyecto y colección /p/ y /c/. POST /api/auth/email-codes almacena solo un hash en email_challenges, caduca el desafío a los diez minutos y devuelve 202 con { accepted: true, expiresInSeconds: 600 } incluso cuando falta EMAIL o la cuenta no es everPaid, de modo que la respuesta no revela si se envió correo (429 es la excepción de límite de tasa). Los resúmenes solicitados llaman al modelo de Workers AI @cf/meta/llama-3.1-8b-instruct-fp8 en POST /api/ai/session-summary. La página Subprocesadores nombra a Cloudflare para D1, R2, Workers AI y correo transaccional, y a Stripe para Checkout, y señala que Pinar no recibe los datos completos de la tarjeta. GET /api/legal/current informa la versión de política 2026-08-25.",
          ],
          bullets: [
            "Si falta `history.db` o SQLite no pudo abrirse, trata ~/.pinar/history.json como el catálogo local activo y espera un aviso de consola sobre el respaldo JSON.",
            'Abre un screenshot alojado en /shots/{id}.png y su proyección markdown en /v/{id}.md; un objeto R2 ausente devuelve JSON { error: "shot not found" } con estado 404.',
            "En ajustes, confirma el tema de Interface mediante pinar-theme y luego distingue los interruptores de entrega de Capture de handoff_mode e include_screenshot sincronizados en la nube en D1 cuando hay sesión iniciada.",
          ],
        },
      ],
    },
    "automatic-sanitization": {
      title: "Sanitización automática",
      summary:
        "Consulta qué datos de URL, DOM, credenciales e imagen inline elimina Pinar antes del handoff o el almacenamiento.",
      sections: [
        {
          heading: "Campos y URLs sensibles",
          paragraphs: [
            "Pinar redacta campos de contraseña, pago, token y OTP; elimina fragmentos de URL; y quita claves de consulta sensibles conocidas como access_token, api_key, auth, password, secret, token y jwt. Puedes añadir más nombres de clave de consulta en los ajustes de la extensión.",
          ],
        },
        {
          heading: "Handoff estructurado",
          paragraphs: [
            "El analizador de visual-context acepta las versiones de esquema compatibles y redacta errores internos de análisis en lugar de exponer secretos en bruto. Los datos de screenshot inline se eliminan de los handoffs de texto; el paquete usa una ruta acotada o una referencia URL en su lugar.",
          ],
        },
        {
          heading:
            "Observar el informe de redacción y las imágenes inline descartadas",
          paragraphs: [
            "sanitizeCapture clasifica campos password, otp, payment y token a partir del tipo de input, autocomplete y el haystack name/id/ariaLabel/role, y luego sanitiza la URL de la página. Las claves de consulta del conjunto sensible, o los valores que lookLikeSecret (longitud de al menos 12 que coinciden con un JWT o prefijos como sk_live_, ghp_, github_pat_ y AIza), se sustituyen por [redacted] y se etiquetan secret-query o token; los parámetros de hash usan secret-hash. Los nombres extra en extraQueryKeys y extraHashKeys se pasan a minúsculas, se parten por espacios, comas o punto y coma, y se unen con DEFAULT_SENSITIVE_QUERY_KEYS, que también incluye authorization, refresh_token, session, session_id, client_secret, bearer y nombres relacionados más allá de la lista breve del resumen. Los secretos recopilados sustituyen entonces subcadenas coincidentes en title, description, URL y pins. Los valores de menos de cuatro caracteres no se usan como secretos de reemplazo aunque el campo se haya categorizado, y una URL que no se puede analizar se devuelve sin cambios.",
            "parseVisualCapture acepta schemaVersion 1 o el legado 0 y lanza VisualContextError con el mensaje estable invalid visual context y los códigos unsupported_schema, invalid_payload, invalid_pin o missing_capture_id en lugar de devolver el cuerpo en bruto. decodeVisualCaptureJson se recupera de un fallo de JSON o de esquema devolviendo ese `captureId` con pins vacíos. screenshotFrom y captureForHandoffJson ponen screenshot.url en null para URLs data:; el camino de handoff añade el aviso screenshot_inline cuando eliminó bytes inline, de modo que el paquete de texto conserva una ruta de sistema de archivos o una referencia http(s) en lugar del payload de la imagen. Poner input.unevaluated en true registra unevaluated en el informe de privacidad y añade el aviso privacy_unevaluated.",
          ],
          bullets: [
            "Tras sanitizeCapture, lee privacy.redacted más los avisos privacy_redacted o privacy_unevaluated; unevaluated true significa que algunas regiones no se inspeccionaron.",
            "Añade nombres extra de clave de consulta como tokens separados por coma, espacio o punto y coma; la coincidencia no distingue mayúsculas frente al conjunto integrado, que incluye authorization, session y refresh_token.",
            "Si el JSON de handoff pegado aún contiene una URL de screenshot data:, la captura omitió captureForHandoffJson; el camino compatible anula url y puede añadir screenshot_inline.",
          ],
        },
      ],
    },
    "local-security-and-recovery": {
      title: "Seguridad local y recuperación",
      summary:
        "Entiende tokens de capacidad, orígenes de confianza, migraciones locales y una recuperación de arranque segura.",
      sections: [
        {
          heading: "Confianza de la API local",
          paragraphs: [
            "La API local acepta loopback y el origen de extensión publicado, y luego verifica un secreto de capacidad almacenado con permisos de archivo restrictivos. La rotación del token mantiene válido el secreto anterior durante 24 horas para que los procesos activos puedan adoptar el valor nuevo; la revocación elimina el archivo y obliga a una nueva autorización.",
          ],
        },
        {
          heading: "Recuperación segura",
          paragraphs: [
            "Un bloqueo PID de bandeja obsoleto se reemplaza mientras una instancia viva permanece intacta. Detener y reiniciar usan primero el camino ordenado del helper; en macOS, un listener atascado se termina solo después de que siga respondiendo más allá de la espera. Un JSON de historial de respaldo corrupto se restablece a un esquema en blanco con Personal e Inbox protegidos. Los screenshots heredados bajo una ruta anidada shots/shots se migran sin sobrescribir conflictos de nombre.",
          ],
        },
        {
          heading:
            "Presentar el secreto de capacidad y recuperar un almacén local roto",
          paragraphs: [
            'El helper persiste un almacén de versión 1 en local-capability.json usando un archivo temporal 0o600 y un rename. Envía el secreto actual en la cabecera x-pinar-capability o como token Authorization Bearer. GET /api/local/capability puede omitir el secreto cuando Origin está vacío, es HTTP de loopback en 127.0.0.1, localhost o ::1, o chrome-extension:// con un id alfanumérico; cualquier otro Origin es hostil y recibe 401 { error: "unauthorized" } con Cache-Control no-store. El loopback HTTPS no se trata como loopback. POST /api/local/capability/rotate y /revoke exigen un secreto coincidente. La rotación escribe un secreto current nuevo y conserva previous.secret hasta expiresAt (24 horas por defecto, anulable con PINAR_CAPABILITY_GRACE_MS; cero descarta previous). Revocar elimina el archivo; la siguiente readOrCreateLocalCapability emite un almacén nuevo. Las peticiones ordinarias de loopback omiten el secreto; las peticiones chrome-extension necesitan una coincidencia. Las entradas clasificadas public-min o local-public-projection omiten esta puerta.',
            "claimInstanceLock deja en su sitio un PID ajeno vivo y llama onDuplicate; un bloqueo ausente o ilegible se trata como obsoleto y se sobrescribe con el id de este proceso. migrateNestedShots mueve archivos de shots/shots a shots y omite nombres que ya existen en el destino; elimina el directorio anidado solo cuando la lista de conflictos está vacía. Los ids de shot se reducen a A–Z, a–z, 0–9, guion bajo y guion, con un máximo de 80 caracteres; si no, el archivo es pin.png. Si `SqliteHistoryDb` lanza, openHistoryDb avisa y abre `history.json`. Un archivo JSON corrupto se analiza a arrays vacíos y luego _ensureDefaults recrea el proyecto protegido Personal y la colección Inbox para owner local. Una escritura JSON fallida registra un aviso y no aborta el arranque. Cuando falta `history.db`, migrateLegacyHistoryDb puede renombrar un history.sqlite residual de bin/ o shots/ a `history.db`.",
          ],
          bullets: [
            "Envía x-pinar-capability o Bearer en las llamadas chrome-extension; GET /api/local/capability arranca desde HTTP de loopback o chrome-extension, y otros Origins reciben 401 unauthorized.",
            "Tras revoke, local-capability.json ya no está; el siguiente arranque del helper emite un secreto nuevo, y los clientes deben volver a leerlo antes de que rotate o revoke vuelvan a tener éxito.",
            "Si `history.db` no se puede abrir, espera `history.json`; un JSON corrupto se convierte en un catálogo vacío y luego Personal e Inbox para owner local, sin tumbar el helper.",
          ],
        },
      ],
    },
    "telemetry-and-policies": {
      title: "Telemetría, consentimiento y políticas",
      summary:
        "Sabe qué es de adhesión, qué políticas condicionan el uso de la nube y qué significa Fair Source aquí.",
      sections: [
        {
          heading: "Métricas de ciclo cerrado",
          paragraphs: [
            "Las métricas de ciclo están desactivadas salvo que te unas. Cuando están desactivadas, los envíos se descartan. Cuando están activadas, el sanitizador permite eventos operativos, duración, agente y confianza de reubicación, pero rechaza comentarios, títulos, URLs, caminos DOM, selectores, screenshots, marcado y contenido en bruto.",
          ],
        },
        {
          heading: "Consentimiento y licencia",
          paragraphs: [
            "La persistencia remota y el checkout registran la aceptación de los Términos, la Política de privacidad y la Política de uso aceptable vigentes. Retención, reembolsos, Fair Source y subprocesadores tienen documentos publicados aparte. Pinar es Fair Source/source-available bajo la licencia del repositorio, no Open Source aprobado por OSI en las versiones actuales.",
          ],
        },
        {
          heading:
            "Verificar payloads de adhesión y el conjunto de políticas publicado",
          paragraphs: [
            "Las métricas de ciclo están desactivadas por defecto porque DEFAULT_LOOP_METRICS_OPT_IN es false. planLoopMetricRequest devuelve send false con reason opt_in_off salvo que optIn sea estrictamente true, y loopMetricHttpStatus asigna ese código a HTTP 200. Cuando están activadas, cada objeto de evento puede contener solo agent, degraded, durationMs, event y locationConfidence. Las claves desconocidas, las claves prohibidas como url, title, comment, screenshot, selector, path, `captureId`, sessionId, html, markdown, content, pin y page, o los valores de cadena que parecen URLs http(s), URIs data: o contienen { o <, se convierten en forbidden_fields (HTTP 400). event debe ser accepted, correction_ready, handoff, relocation_failed o reopened; agent debe ser claude, codex, cursor o grok; locationConfidence debe ser exact, probable, ambiguous o unresolved; durationMs debe ser un entero no negativo de como máximo 86.400.000. Un valor events vacío o que no sea un array es invalid_payload y no se envía.",
            "README indica que el checkout y el registro Remote Free registran las versiones de política aceptadas y publica Términos, Privacidad, Uso aceptable, Retención, Reembolsos, Fair Source y Subprocesadores en https://pinar.dev/legal/. legal-documents fija CURRENT_LEGAL_VERSION en 2026-08-25 para los siete ids de documento. Los Términos dicen que el uso solo local que nunca contacta el servicio alojado no necesita cuenta alojada; Privacidad dice que los datos solo locales que nunca salen del dispositivo quedan fuera de la política alojada. LICENSE es Functional Source License, Version 1.1, MIT Conversion: dos años después de la primera publicación, la Change License es MIT, y hasta la Change Date no puedes ofrecer un servicio comercial alojado competidor de anotación visual, vista previa de screenshot o persistencia en la nube. El aviso Fair Source remite a LICENSE y no es Open Source aprobado por OSI. Las preguntas van a contact@pinar.dev o contato@pinar.dev.",
          ],
          bullets: [
            "Deja las métricas de ciclo desactivadas salvo que pretendas optIn true; un plan desactivado devuelve send false con opt_in_off y no transmite el lote.",
            "Antes de la persistencia alojada o el checkout, abre Términos, Privacidad y Uso aceptable en la versión 2026-08-25 desde https://pinar.dev/legal/terms, /privacy y /acceptable-use.",
            "Trata LICENSE como documento rector para los límites de competencia de FSL-1.1-MIT y la Change Date; los subprocesadores alojados nombrados actualmente son Cloudflare y Stripe.",
          ],
        },
      ],
    },
  },
} satisfies HelpLocale;

export default locale;
