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
    "capture-toolbar": {
      alt: "Superposición de captura de Pinar con la barra superior, pins numerados, una región seleccionada y una máscara de privacidad en la página.",
      caption:
        "La barra de la superposición permanece en la página con los atajos de pin, selección, copiar, máscara, región y cancelar mientras anotas.",
    },
    "capture-review": {
      alt: "Superposición de Pinar revisando una sesión guardada, con un pin pendiente que necesita colocación manual en la página activa.",
      caption:
        "Revisar en la página recoloca los pins en la URL original. Los pins no resueltos quedan pendientes hasta que haces clic en el marcador y luego en el elemento correcto.",
    },
    "capture-copy-failed": {
      alt: "Barra de la superposición de Pinar mostrando Error al copiar, con los pins numerados aún editables en la página.",
      caption:
        "Cuando fallan todos los caminos del portapapeles, la barra muestra Error al copiar y restaura los pins para reintentar sin perder comentarios.",
    },
    "capture-full-page": {
      alt: "Superposición de Pinar en un documento largo que continúa bajo la primera ventana, lista para una captura de página completa cosida.",
      caption:
        "La captura de página completa desplaza y cose el documento para que la captura copiada incluya el contenido bajo el pliegue.",
    },
    "capture-viewer": {
      alt: "Visor de captura de Pinar con el screenshot anotado, pins numerados, controles de zoom y acciones de la sesión.",
      caption:
        "El visor reúne el screenshot compartido, los comentarios de los pins y las acciones de copiar o reabrir después de la captura.",
    },
    "extension-options": {
      alt: "Opciones de la extensión Pinar en la pestaña Almacenamiento, con Servidor Local, Servidor Remoto y la aceptación legal del servicio alojado.",
      caption:
        "La pestaña Almacenamiento elige un servidor local o remoto y exige aceptar Términos, Privacidad y Uso Aceptable antes de capturar en la nube.",
    },
    "extension-preferences": {
      alt: "Opciones de la extensión Pinar en la pestaña Preferencias, con el detalle compacto o completo de la copia para IA y el interruptor de incluir captura.",
      caption:
        "Preferencias define la entrega compacta o completa y si la siguiente copia incluye captura; Guardar escribe esas opciones antes de la próxima copia.",
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
    "capture-shortcuts": {
      alt: "Pestaña Atajos de las opciones de la extensión Pinar, con comandos del navegador y teclas de la superposición durante la captura.",
      caption:
        "La pestaña Atajos muestra los atajos de Chrome junto a las teclas de la superposición para pin, selección, máscara, copiar y cancelar.",
    },
    "capture-types": {
      alt: "Superposición de Pinar con un pin numerado en un encabezado y una región seleccionada alrededor de la tarjeta del total del pedido.",
      caption:
        "Los pins de elemento y las regiones libres pueden compartir la misma superposición para que la captura copiada conserve el destino del DOM y el agrupamiento visual.",
    },
    "capture-pins": {
      alt: "Superposición de Pinar con tres marcadores numerados en un encabezado, el correo del cliente y el botón de pago.",
      caption:
        "Cada pin conserva su número y comentario para que una captura apunte a varios elementos de la misma página.",
    },
    "capture-selection": {
      alt: "Superposición de Pinar destacando un encabezado con el contorno azul de selección antes de confirmar el pin.",
      caption:
        "La selección inteligente recuadra el elemento bajo el cursor para recorrer el DOM con las flechas antes de fijar el pin.",
    },
    "capture-masks": {
      alt: "Superposición de Pinar con una máscara de privacidad cubriendo el correo del cliente y un pin numerado en el encabezado.",
      caption:
        "La máscara oculta píxeles sensibles en la captura copiada sin quitar los comentarios de los pins que aún describen la página.",
    },
    "capture-copied": {
      alt: "Barra de la superposición de Pinar mostrando Copiado con éxito después de que el paquete anotado llegó al portapapeles.",
      caption:
        "Una copia correcta muestra Copiado con éxito y cierra la superposición para pegar el mismo paquete en un agente.",
    },
    "install-pinar": {
      alt: "Pestaña Almacenamiento de la extensión Pinar con el botón Descargar Pinar junto a la opción Servidor Local.",
      caption:
        "La pestaña Almacenamiento ofrece la descarga de la aplicación Pinar junto a Servidor Local para que el auxiliar arranque en este equipo.",
    },
    "options-local": {
      alt: "Pestaña Almacenamiento de la extensión Pinar con Servidor Local seleccionado y las capturas quedando en este equipo.",
      caption:
        "Servidor Local guarda el historial y las capturas en este equipo y no exige la aceptación legal del servicio alojado.",
    },
    "workspace-nested": {
      alt: "Barra lateral del espacio de trabajo de Pinar con una colección seleccionada en el árbol del proyecto y las tarjetas de sesión coincidentes.",
      caption:
        "Seleccionar una colección filtra el espacio de trabajo a esa rama para que las carpetas anidadas queden visibles junto a las sesiones que contienen.",
    },
    "workspace-review": {
      alt: "Tabla del espacio de trabajo de Pinar con el filtro de estado de Revisión abierto sobre las filas de sesión.",
      caption:
        "La vista de tabla combina la búsqueda con filtros de estado de Revisión para recorrer pins abiertos, aceptados y reabiertos entre sesiones.",
    },
    "workspace-security": {
      alt: "Selector de proyecto del espacio de trabajo de Pinar abierto en el proyecto protegido Personal.",
      caption:
        "El espacio de trabajo local recupera un proyecto Personal y una Inbox protegidos cuando el historial no abre, en lugar de bloquear la aplicación.",
    },
    "legal-retention": {
      alt: "Centro legal de Pinar abierto en el documento de Retención de datos.",
      caption:
        "La política de Retención de datos indica cuánto tiempo se conservan las capturas alojadas, los registros de facturación y los datos de cuenta relacionados.",
    },
    "sharing-markdown": {
      alt: "Visor público de proyecto de Pinar con el botón Copiar Markdown sobre las tarjetas de sesión compartidas.",
      caption:
        "Un enlace no listado de proyecto o colección permite a cualquiera con la URL copiar el Markdown combinado sin iniciar sesión.",
    },
    "preferences-privacy": {
      alt: "Pestaña Preferencias de la extensión Pinar mostrando métricas opcionales del ciclo y claves extra de URL para ocultar.",
      caption:
        "Las preferencias de privacidad añaden claves extra de consulta que se eliminan de las URL capturadas y mantienen las métricas del ciclo apagadas hasta que optas.",
    },
    "pricing-credits": {
      alt: "Tarjeta de complemento de la página de precios de Pinar para 1.000 créditos de IA, con compra y validez de doce meses.",
      caption:
        "Los créditos de IA se venden como complemento con validez de doce meses, separados del almacenamiento del plan y de la cadencia de facturación.",
    },
  },
  articles: {
    "install-pinar": {
      title: "Instalar Pinar",
      summary: "Instala la extensión de Chrome y abre la aplicación Pinar en tu equipo.",
      sections: [
        {
          heading: "Extensión del navegador",
          paragraphs: [
            "Instala Pinar desde la [Chrome Web Store](https://chromewebstore.google.com/detail/pinardev/idpeaokdndjedekacfdfbilcolpholbo).",
          ],
          bullets: [
            "Fija el icono de Pinar en el menú de extensiones de Chrome para que permanezca visible.",
            "Abre la [ficha de Chrome Web Store](https://chromewebstore.google.com/detail/pinardev/idpeaokdndjedekacfdfbilcolpholbo) para añadir la extensión oficial.",
          ],
        },
        {
          heading: "La aplicación Pinar",
          paragraphs: [
            "En macOS, la aplicación Pinar está en la barra de menús. En Windows, está en el área de notificación. Abre la aplicación Pinar para empezar a capturar. En Linux, instálala con el comando de abajo.",
          ],
          bullets: [
            "Las capturas permanecen en este equipo. Usa “Abrir carpeta” para verlas.",
            "En macOS y Windows, “Iniciar al iniciar sesión” mantiene Pinar disponible después de iniciar sesión.",
            "Si una captura no tiene imagen, abre Pinar e inténtalo de nuevo.",
          ],
        },
        {
          heading: "Instalar y abrir",
          paragraphs: [
            "Descarga la aplicación Pinar con los enlaces de abajo, instálala y ábrela.",
            "Con Pinar abierto, elige “Abrir el espacio de trabajo”. Si muestra “Servidor local: desactivado”, elige “Iniciar”. Si las capturas pegadas dejan de llegar, abre Pinar otra vez.",
          ],
          bullets: [
            "macOS: [descarga la aplicación Pinar](https://github.com/djalmajr/pinar/releases/latest/download/macos-arm64-Pinar.dmg), abre la imagen de disco y arrástrala a “Aplicaciones”.",
            "Windows: [descarga la aplicación Pinar](https://github.com/djalmajr/pinar/releases/latest/download/win-x64-Pinar-Setup.exe) y ejecuta el instalador. El icono aparece en el área de notificación.",
            "Windows: la primera ejecución puede mostrar “Windows protegió tu PC”. Elige “Más información” y luego “Ejecutar de todas formas”.",
            "Linux: `curl -fsSL https://pinar.dev/install.sh | sh`",
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
            "Abre la página, selecciona la extensión Pinar y haz clic en un elemento o arrastra un área libre. Escribe el comentario y pulsa `Enter` para añadir el pin.",
          ],
          bullets: [
            "Repite la selección para colocar varios pins numerados en una misma captura.",
            "`Shift+Enter` añade un salto de línea; `Escape` cierra el borrador sin borrar los demás pins.",
          ],
        },
        {
          heading: "Copiar el paquete",
          paragraphs: [
            "Pulsa `Command+Enter` en macOS o `Ctrl+Enter` en el resto. Pinar copia Markdown legible, HTML y un bloque JSON pinar-visual-context que apuntan al mismo screenshot y a las mismas identidades de pin.",
          ],
        },
        {
          heading: "Terminar la copia y conservar las identidades",
          paragraphs: [
            "`Command/Ctrl+Enter` copia solo cuando al menos un pin tiene comentario. La superposición muestra “Guardando las anotaciones…”, oculta los pins para el screenshot, luego “¡Copiado con éxito!”, y la barra se cierra. Hacer clic después en el icono de la extensión solo muestra u oculta la superposición; no borra los pins que ya colocaste. Si fallan todos los caminos del portapapeles, se restaura la superposición para que puedas reintentar.",
            "Trata el contenido del portapapeles como una unidad: instrucciones legibles, una URL opcional del visor y un bloque JSON pinar-visual-context delimitado con `captureId`, `pinId`, URL de la página, localizadores (cssSelector, domPath, innerText) y una URL de screenshot cuando el helper guardó un archivo. Las insignias numeradas de la imagen son superposiciones de anotación, no UI de la página. No reescribas `captureId` ni `pinId` al pegar en un agente. Una línea Screenshot: /path/to/file.png, cuando existe, es el único recorte que contiene todos los pins.",
          ],
          bullets: [
            "Un compositor vacío o una captura sin pins aborta la copia y muestra “Escribe un comentario” o “Añade un pin”.",
            "Las copias degradadas siguen pegando comentarios y localizadores, pero la barra puede añadir “sin captura”, “ayudante no disponible” o “sin visor” después de “¡Copiado con éxito!”.",
            "Prefiere un Pinar local en ejecución para que la copia pueda incluir un screenshot y un enlace de visor con el contexto completo.",
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
            "El modo local guarda el historial y los screenshots en este equipo. El espacio de trabajo local permanece disponible sin una cuenta.",
          ],
        },
        {
          heading: "Nube",
          paragraphs: [
            "El modo nube habilita el acceso remoto al espacio de trabajo, la retención gestionada, los resúmenes de IA, la facturación y los enlaces de uso compartido no listados. Aceptas las políticas vigentes antes de que se almacene nada de forma remota.",
          ],
        },
        {
          heading: "Cómo se abren de verdad las sesiones locales y en la nube",
          paragraphs: [
            "El historial local empieza con un proyecto “Personal” protegido y una colección “Inbox” protegida que no puedes anidar ni eliminar como las carpetas normales. Las capturas permanecen en este equipo y puedes abrirlas desde el espacio de trabajo local.",
            "El almacenamiento en la nube espera a que aceptes los “Términos”, la “Privacidad” y el “Uso Aceptable” vigentes. Después, las cuentas “Free” pueden emparejar la extensión con un código de corta duración, y las cuentas de pago también pueden confirmar un código de seis dígitos por correo. Los enlaces de uso compartido siguen siendo legibles para cualquiera que tenga la URL no listada.",
          ],
          bullets: [
            "El espacio de trabajo local permanece en este equipo y no necesita una cuenta en la nube.",
            "Si el historial local no puede abrir su almacén habitual, Pinar recupera un catálogo usable en lugar de cerrarse de golpe.",
            "Los enlaces de uso compartido en la nube no exigen una sesión del espacio de trabajo: cualquiera con la URL no listada puede leer el Markdown o la imagen.",
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
            "`Enter` fija el elemento bajo el puntero; `Arrow Up` selecciona su padre y `Arrow Down` vuelve a un hijo.",
            "`M` activa o desactiva el dibujo de máscaras de privacidad. `Escape` cancela un borrador o una máscara; sin borrador, limpia los pins y oculta la barra.",
            "`R` alterna la superposición en vivo entre solo los pins numerados y los pins con sus regiones seleccionadas. La captura copiada siempre incluye ambos.",
            "`Command/Ctrl+Enter` copia el paquete completado.",
            "`Alt+Shift+P` muestra u oculta la barra sin cancelar la sesión, y puedes reasignarlo en `chrome://extensions/shortcuts`. Los atajos del navegador quedan inertes en páginas `chrome://`, en la Chrome Web Store y antes de que se inyecte el overlay.",
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
            "Los atajos de captura solo se poseen mientras la superposición está activa. El icono de la extensión alterna esa superposición; no borra pins. Pasar el puntero por la barra sin un borrador abierto la deja en pass-through para que aún puedas hacer clic o arrastrar la página de debajo. `Shift+Enter` inserta un salto de línea en el compositor, y los atajos de la página anfitriona escritos ahí se detienen para que no salgan del campo de comentario.",
            "`Arrow Up` sube al elemento padre y recuerda el hijo que dejaste, de modo que `Arrow Down` vuelve a ese nodo recordado cuando sigue siendo un hijo; si no, usa el primer hijo. En modo máscara, arrastra una región para ocultarla y haz clic en una máscara existente para restaurarla. El desplazamiento con teclado sigue funcionando en el documento, pero las teclas dirigidas a controles de página enfocados se bloquean para que no activen botones ni escriban en el formulario anfitrión.",
          ],
          bullets: [
            "`Command/Ctrl+Enter` guarda un borrador abierto y luego copia; sin comentario muestra “Escribe un comentario” en lugar de enviar un pin vacío.",
            "Después de `Escape` o de copiar, Pinar sigue poseyendo esa tecla física hasta keyup para que la página anfitriona no trate la misma pulsación como su propio cancel o submit.",
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
            "Haz clic en un nodo, o pulsa `Enter` sobre el contorno actual, para abrir un pin de elemento. Arrastra un rectángulo de al menos seis píxeles para abrir un pin de área. La primera pulsación sobre un iframe o un elemento frame se ignora para que el documento interior de ese frame pueda tomar la selección.",
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
            "`Escape` sale del dibujo de máscaras sin descartar los pins ya colocados en la página.",
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
            "“Revisar en la página” abre el origen capturado y rehidrata los pins. Pinar rechaza un desajuste de origen, conserva cada ancla y caja históricas, registra el historial de reubicación y permite reposicionar a mano un pin unresolved.",
          ],
        },
        {
          heading: "Portapapeles desde el visor y control de la reapertura",
          paragraphs: [
            "Copiar página en el visor escribe el mismo paquete Markdown correlacionado de la página activa, usando el handoff compact o full de las preferencias guardadas y `captureId` cayendo al id de la sesión. El menú de acciones abre el Markdown público en /v/{id}.md, o inicia ChatGPT o Claude con un prompt que apunta a esa URL.",
            "“Revisar en la página” despacha un evento de reapertura con el id de la sesión. El helper hidrata solo desde una URL de la aplicación Pinar de confianza cuando ese id coincide con el id de la sesión o `captureId` y el origen de la pestaña sigue siendo el origen de la página capturada. Navegar la pestaña fuera de ese origen suelta el vínculo en lugar de inyectar pins en el sitio equivocado.",
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
            "La extensión de Chrome nunca escribe en el compositor del agente. Después de `Command/Ctrl+Enter`, pega tú mismo el portapapeles en Cursor, Claude, Codex o Grok. El texto empieza diciendo que las notas de los pins pueden pedir un cambio o una explicación, y tratar el selector y el camino DOM como localizadores complementarios, seguidas de un bloque JSON pinar-visual-context delimitado. Si se incluye una URL de Viewer, recupérala solo cuando esos detalles no basten.",
            "Trata `captureId` y `pinId` como identidad, no como etiquetas a reescribir. Visual Context actualmente codifica schemaVersion 1; parseVisualCapture rechaza un `captureId` ausente y cualquier schemaVersion distinto de 1 o el legado 0. Sigue solo lo que describen los pins. Si la persona nunca pegó, pídele que copie de nuevo desde Pinar en lugar de reconstruir pins de memoria.",
          ],
          bullets: [
            "Pega el portapapeles entero en el agente; no reescribas comentarios ni inventes un `captureId` nuevo.",
            "Confirma que el texto pegado aún contiene un cierre de cerca pinar-visual-context antes de empezar a editar código.",
            "Si no se pegó nada, pide `Command/Ctrl+Enter` en Pinar y sigue solo las notas de los pins.",
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
            "Un agente informa el trabajo contra el `captureId` de la captura y cada `pinId`. Repite una entrega con la misma clave solo cuando el resultado no ha cambiado; un resumen, archivos o estado distintos necesitan una clave nueva. Los pins o capturas desconocidos se rechazan sin devolver comentarios privados.",
            "Una persona acepta una corrección o reabre un pin aceptado desde la interfaz de revisión. Los agentes no pueden aceptar su propio trabajo. Tras una reapertura humana, el reintento previsto es un segundo resultado changed. Deja las métricas anónimas de ciclo desactivadas salvo que te unas.",
          ],
          bullets: [
            "Publica un resultado changed para el mismo `captureId` y `pinId`, y confirma que el visor muestra el pin como listo para aceptar.",
            "Reutiliza una clave de entrega solo cuando el resultado es idéntico; genera una clave nueva cuando los archivos, el resumen o el estado hayan cambiado de verdad.",
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
            "“Revisar en la página” se abre solo desde la aplicación Pinar, en la URL original de la captura. Otro sitio no puede inyectar una sesión guardada en la extensión. Tras la carga, cada frame muestra solo los pins que le pertenecen.",
            "La superposición permanece vinculada solo mientras la pestaña sigue siendo el sitio capturado. Si navegas a otro sitio, muestra “Esta página no es la URL original de la captura”. Las coincidencias ambiguas conservan la caja original en lugar de encajar en un sosias. Haz clic en un pin pendiente y luego en el elemento correcto para colocarlo.",
          ],
          bullets: [
            "Inicia “Revisar en la página” desde la aplicación Pinar para que solo esa sesión se hidrate en el origen capturado.",
            "Si la superposición dice “Esta página no es la URL original de la captura”, vuelve al origen capturado en lugar de colocar pins.",
            "En un pin unresolved, haz clic en el marcador y luego en el elemento activo para colocarlo.",
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
            "La copia exige un comentario guardado y al menos un pin. La barra muestra “Guardando las anotaciones…”, oculta las superposiciones, captura el shot y pide al documento offscreen que escriba text/html y text/plain. El offscreen intenta primero navigator.clipboard.write y cae a un evento copy más execCommand. Si esa escritura no es ok, el content script aún intenta writePlainText sobre el payload plain devuelto: clipboard.writeText y luego una selección oculta en un textarea.",
            "Cuando fallan todos los caminos de copia, la página envía overlays:hidden con hidden false, muestra “Error al copiar” y deja los pins editables. Una copia correcta muestra “¡Copiado con éxito!”, o “¡Copiado con éxito!” más “sin captura”, “ayudante no disponible” o “sin visor”, y luego termina la sesión. Esos sufijos corresponden a `screenshot_missing`, `helper_unavailable` y `viewer_unavailable`. screenshot_inline no es uno de los avisos de handoff degradado. Un pegado sin una cerca pinar-visual-context cerrada no se puede analizar como JSON.",
          ],
          bullets: [
            "Si la barra dice “Escribe un comentario” o “Añade un pin”, termina ese pin y pulsa `Command/Ctrl+Enter` otra vez.",
            "Si aparece “Error al copiar”, confirma que los pins siguen en la página, concede el permiso de portapapeles si se pide y reintenta la copia.",
            "Lee el sufijo de “¡Copiado con éxito!”: “sin captura”, “ayudante no disponible” y “sin visor” nombran la capa que falta para reintentar sin descartar comentarios.",
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
            "Arrastra sesiones entre colecciones para reordenarlas, o usa Mover a masivo para un conjunto seleccionado.",
          ],
        },
        {
          heading: "Confirmar dónde aterriza una sesión movida",
          paragraphs: [
            "Abre una colección para ver y cambiar el orden manual guardado arrastrando una sesión sobre su vecina. Cuando no hay ninguna colección seleccionada, el listado ordena por fecha de creación en lugar de ese orden guardado.",
            "Un arrastre empieza en la tarjeta o la fila de tabla, no desde la búsqueda, las casillas ni el menú de acciones (`data-no-dnd`). Si la sesión arrastrada ya está seleccionada junto con otras, viajan con ella todos los ids seleccionados; si no, solo se mueve esa sesión. Mover a pide un proyecto y luego una colección en el árbol aplanado de ese proyecto; cambiar de proyecto limpia el campo de colección, y un proyecto sin colecciones queda desactivado. La sesión se añade en la siguiente posición del destino. Eliminar Personal se rechaza; eliminar otro proyecto añade sus sesiones a Inbox en el orden existente y quita las colecciones de ese proyecto.",
          ],
          bullets: [
            "Para cambiar el orden dentro de una colección, arrastra una sesión sobre su vecina.",
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
            "Seleccionar todo en la cuadrícula se aplica solo a la página actual de tarjetas; seleccionar todo en la tabla usa la página actual de la tabla. La elección de cuadrícula o tabla se recuerda en este navegador. La eliminación masiva pide confirmación y luego quita cada sesión seleccionada. Un visor público de proyecto o colección copia Markdown combinado desde la página de uso compartido. Si ese uso compartido ya no existe, el visor muestra un estado de no encontrado en lugar de una lista.",
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
            "Las sesiones web duran 30 días y los dispositivos de extensión autenticados, 180 días. Los códigos caducan por seguridad.",
          ],
        },
        {
          heading:
            "Terminar el emparejado desde la pestaña Account de la extensión",
          paragraphs: [
            "En una instalación Remote Free, abre la pestaña Account de las opciones de la extensión, genera ahí el código temporal y cópialo. Abre la página de acceso alojada desde esa misma pestaña para que un intercambio correcto aterrice en el espacio de trabajo web. Regenerar pide confirmación primero porque se reemplazan los códigos no usados de esa cuenta. Pega el código en pinar.dev y no en una página del espacio de trabajo local.",
            "Solicitar un código por correo siempre se ve igual, también para direcciones desconocidas, de modo que el formulario no revela si existe una cuenta. Un mensaje real de seis dígitos se envía solo a una cuenta de pago elegible. Cerrar sesión en la pestaña Account termina las sesiones web y de extensión actuales.",
          ],
          bullets: [
            "Si no llega ningún correo, espera antes de reintentar; los códigos caducan y demasiados intentos se retrasan.",
            "Confirma el diálogo de regeneración antes de invalidar un código que aún pretendes escribir en la página de acceso alojada.",
            "Usa Sign out en la pestaña Account cuando necesites terminar de inmediato la sesión web o de extensión actual.",
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
            "Checkout empieza solo después de que aceptes los Términos, la Política de privacidad y el Uso aceptable vigentes. Brasil usa precios en BRL; otros países usan USD. El checkout de Founder reserva un cupo limitado y lo libera si sales sin pagar. Cuando la cohorte está llena o las ventas están en pausa, la página Planes oculta esa oferta.",
            "Tras un pago correcto, la oferta se concede en la cuenta con sesión iniciada y vuelves al espacio de trabajo. El portal de facturación está disponible después de un checkout de pago. Cuando termina una suscripción Pro, esas sesiones en la nube entran en una ventana de recuperación; las cuentas Founder y las de lifetime heredadas permanecen permanentes.",
          ],
          bullets: [
            "Acepta las versiones vigentes de las políticas en el flujo alojado de Planes antes de pagar.",
            "Si el checkout de Founder no está disponible, espera un cupo o elige Pro en lugar de reintentar el mismo checkout.",
            "Si Manage subscription no está disponible, termina primero un Checkout de pago y luego ábrelo desde una cuenta con sesión iniciada.",
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
            "Un resumen se ejecuta solo en una sesión de tu propiedad. Si ya hay uno en curso, espera a que termine en lugar de iniciar otro. Los resúmenes fallidos o abortados reembolsan la reserva cuando es posible. Si el saldo es demasiado bajo, el espacio de trabajo muestra los créditos restantes en vivo.",
            "Los créditos mensuales incluidos se usan antes que los paquetes comprados, y se usa primero el saldo que caduca antes. Un paquete comprado de 1.000 créditos dura hasta 12 meses. El menú de cuenta muestra los créditos restantes y la próxima fecha de recarga para las cuentas Pro y Founder activas. Los resúmenes usan el idioma del espacio de trabajo cuando es uno de los siete idiomas compatibles.",
          ],
          bullets: [
            "Si ya hay un resumen en curso en esa sesión, espera a que termine en lugar de iniciar un segundo.",
            "Si una reserva caduca o se reembolsa, inicia un resumen nuevo en lugar de reintentar la misma petición.",
            "Si el espacio de trabajo muestra cero créditos, comprueba los paquetes restantes y la próxima fecha de recarga antes de comprar otra oferta de 1.000 créditos.",
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
            "La cuota es el almacenamiento incluido de tu plan más cualquier complemento aún activo. Reemplazar un screenshot más grande por uno más pequeño puede tener éxito cuando una captura nueva no lo tendría. Las subidas se pausan cuando la cuenta está en o por encima de la cuota, también durante la gracia y la recuperación.",
            "Las sesiones en la nube de Free que no están marcadas como permanentes pasan a ser elegibles para limpieza a los siete días. El contenido de Pro por encima de la cuota de Free sigue la gracia de 30 días y la ventana de recuperación de 90 días tras terminar la elegibilidad de pago. El contenido Founder y el de lifetime heredado no se vuelve elegible solo porque no haya una suscripción recurrente. El historial solo local de este equipo nunca se elimina de forma remota. La elegibilidad no es una promesa de retirada inmediata.",
          ],
          bullets: [
            "Cuando se pausen las capturas nuevas, libera espacio eliminando sesiones o reemplazando un screenshot pesado, o compra un complemento de doce meses de 5 GB o 20 GB.",
            "Si la cuenta está en gracia o recuperación, exporta lo que aún necesites antes del día 90; la elegibilidad solo marca el excedente, no elimina por sí misma.",
            "No esperes que desinstalar la app de escritorio borre objetos en la nube, ni que la nube borre el historial local de este equipo.",
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
            "Cada sesión, proyecto o colección tiene una página no listada y una copia Markdown. Copiar Markdown pone ese texto en el portapapeles, y cada tarjeta de sesión abre su propio visor. Un enlace ausente o no válido muestra una página de no encontrado en lugar del correo del propietario, el plan u otros campos de cuenta.",
            "El Markdown de sesión incluye el paquete de handoff más los resultados del agente y las revisiones de pins. El Markdown de proyecto y colección lista cada sesión anidada con URL de página, comentarios de pins, `pinId` y localizadores. Las líneas de screenshot aparecen solo cuando el propietario permite la entrega de screenshots. Cualquiera que pueda abrir el enlace puede copiar lo que ve, así que una URL no listada no es autorización.",
          ],
          bullets: [
            "Antes de enviar un enlace de proyecto o colección, abre Copiar Markdown una vez y comprueba que cada sesión anidada, comentario de pin y línea de screenshot es seguro de publicar.",
            "Desactiva la entrega de screenshots en la cuenta del propietario si el Markdown compartido debe dejar fuera las URLs de imagen.",
            "Si una ruta compartida muestra no encontrado, trata el enlace como desaparecido o no válido; esa página no añade detalles privados de cuenta.",
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
            "Los screenshots y el historial locales permanecen en este equipo. Las preferencias del navegador como vista, idioma, tema y ajustes de entrega permanecen en este navegador salvo que una función con sesión iniciada las sincronice de forma explícita.",
          ],
        },
        {
          heading: "Límite en la nube",
          paragraphs: [
            "Los registros de cuenta en la nube, los metadatos de captura y las imágenes se almacenan en el servicio alojado. Stripe procesa la facturación y el servicio de correo envía códigos de acceso. La página Subprocesadores es la lista actual de roles de servicios externos.",
          ],
        },
        {
          heading: "Confirmar qué almacén guarda realmente cada captura",
          paragraphs: [
            "Los screenshots locales se almacenan como archivos PNG y el historial de sesiones permanece en este equipo. El tema es una preferencia solo del navegador en la pestaña Interface. El idioma y los interruptores de entrega de Capture viven en el mismo diálogo de ajustes; una cuenta en la nube con sesión iniciada puede conservar esas opciones de entrega en el espacio de trabajo alojado.",
            "Las capturas alojadas guardan metadatos e imágenes en el servicio en la nube. Los visores no listados y las copias Markdown están disponibles sin una sesión del espacio de trabajo. Los códigos de acceso por correo caducan y el formulario no revela si existe una cuenta. La página Subprocesadores nombra a los proveedores alojados actuales, y Pinar no recibe los datos completos de la tarjeta. Las versiones vigentes de las políticas se publican en las páginas legales.",
          ],
          bullets: [
            "Si el historial local no puede abrirse, Pinar recupera un catálogo usable en este equipo en lugar de cerrarse de golpe.",
            "Abre un screenshot alojado desde su página de uso compartido o el visor Markdown; una imagen ausente muestra no encontrado en lugar de detalles de cuenta.",
            "En ajustes, confirma el tema de Interface en local y luego distingue los interruptores de entrega de Capture de las opciones de entrega sincronizadas en la nube cuando hay sesión iniciada.",
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
            "Pinar redacta campos de contraseña, pago, token y código de un solo uso, y luego limpia la URL de la página. Los valores de consulta que parecen secretos conocidos se sustituyen por [redacted]. Se incluyen los nombres extra que añades en ajustes. Las subcadenas coincidentes también se eliminan del título, la descripción, la URL y los pins.",
            "El bloque visual-context copiado conserva `captureId` aunque el resto del payload no se pueda analizar. Los bytes de screenshot inline se descartan del paquete de texto para que la copia conserve una ruta de archivo o una URL de visor. Si algunas regiones no se pudieron inspeccionar, el pegado incluye un aviso de privacidad.",
          ],
          bullets: [
            "Tras una copia, lee los avisos de privacidad en el pegado; algunas regiones pueden marcarse como no inspeccionadas.",
            "Añade nombres extra de clave de consulta como tokens separados por coma, espacio o punto y coma; la coincidencia no distingue mayúsculas.",
            "Si el JSON de handoff pegado aún contiene una URL de screenshot data:, vuelve a capturar para que el paquete de texto conserve una ruta o una URL de visor.",
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
            "El espacio de trabajo local solo acepta la aplicación Pinar y la extensión oficial. La rotación mantiene válido el secreto anterior el tiempo suficiente para que los procesos en ejecución se pongan al día; la revocación obliga a una nueva autorización.",
            "Si ya hay otra instancia de Pinar en ejecución, esa instancia permanece en su sitio. Las carpetas de screenshots anidadas se migran sin sobrescribir conflictos de nombre. Si el historial local no puede abrirse, Pinar recupera un proyecto Personal y una Inbox usables en lugar de cerrarse de golpe.",
          ],
          bullets: [
            "Sigue usando la extensión oficial y la aplicación Pinar; otros sitios no pueden hablar con el espacio de trabajo local.",
            "Después de revocar el acceso local, reinicia Pinar para que el espacio de trabajo pueda autorizarse de nuevo.",
            "Si el historial local no puede abrirse, espera un proyecto Personal y una Inbox recuperados en lugar de un cierre inesperado.",
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
            "Las métricas de ciclo permanecen desactivadas salvo que te unas. Cuando están activadas, solo se envían eventos operativos. Se rechazan comentarios, títulos, URLs, selectores, screenshots y contenido similar.",
            "El checkout y el registro Remote Free registran las versiones de política aceptadas. Términos, Privacidad, Uso aceptable, Retención, Reembolsos, Fair Source y Subprocesadores se publican en https://pinar.dev/legal/. El uso solo local que nunca contacta el servicio alojado no necesita cuenta alojada. Las preguntas van a contact@pinar.dev o contato@pinar.dev.",
          ],
          bullets: [
            "Deja las métricas de ciclo desactivadas salvo que pretendas unirte; un ajuste desactivado no transmite un lote.",
            "Antes de la persistencia alojada o el checkout, abre Términos, Privacidad y Uso aceptable desde https://pinar.dev/legal/terms, /privacy y /acceptable-use.",
            "Trata la licencia publicada como documento rector para los límites de Fair Source; los subprocesadores alojados nombrados actualmente son Cloudflare y Stripe.",
          ],
        },
      ],
    },
  },
} satisfies HelpLocale;

export default locale;
