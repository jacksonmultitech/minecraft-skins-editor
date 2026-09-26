# Editor de Skins de Minecraft

Editor de skins en 3D y 2D hecho **solo con tecnologías web nativas**: HTML, CSS, JavaScript (módulos ES) y WebGL2. No usa frameworks, librerías ni paso de compilación.

Genera archivos **PNG RGBA de 64×64 px**, el formato que aceptan Minecraft: Java Edition (1.8+) y Bedrock Edition.

> 🤖 **Todo este proyecto fue creado con Claude AI "Opus 5.5"** (Anthropic): el código, el diseño de la interfaz, la documentación y las pruebas.

## Características

- Edición directa sobre el modelo 3D o sobre la textura 2D, con guías de cada parte y cara.
- Cámara libre: girar, desplazar y hacer zoom con la rueda del mouse (también con gestos táctiles).
- 8 herramientas: lápiz, borrador, cubeta, cuentagotas, aclarar, oscurecer, pincel de ruido y reemplazar color.
- Teoría del color: valores HEX, RGB, HSL y OKLCH copiables, entrada en cualquier formato, cuentagotas de pantalla, escala tonal (normal o estilo pixel art), 7 armonías con círculo cromático, paleta aleatoria y exportación (texto, CSS, PNG, JSON).
- Círculo cromático interactivo: arrastra los puntos para cambiar tono (ángulo) y saturación (radio); la armonía gira completa.
- "Colores de tu skin" agrupa los tonos casi iguales, los clasifica por familia y los ordena de claro a oscuro; se puede descargar como PNG, paleta GIMP/Aseprite (.gpl), JSON o texto.
- Panel lateral redimensionable (280–640 px) arrastrando su borde; diseñado con 1920×1080 como medida base.
- Modo espejo, tamaño de pincel, líneas con `Mayús` + clic y cuentagotas con `Alt` + clic.
- Capa base y capa externa con visibilidad por parte del cuerpo y botones para ocultar o mostrar cada capa completa.
- Modelo clásico (4 px) y delgado (3 px), con detección automática y adaptación de brazos.
- Vista previa animada (reposo, caminar, correr, saludar) que se puede rotar, y captura en PNG.
- Fondos para la vista previa: escenas al estilo de Minecraft dibujadas por código (pradera, atardecer, noche, cueva, Nether, El End), pantalla verde o una imagen propia.
- Abre PNG de 64×64, convierte skins antiguas de 64×32 y reduce las HD. También acepta arrastrar y soltar y pegar.
- Codificador y decodificador PNG propios (sin pérdida en la semitransparencia).
- Verificación de compatibilidad con Java y Bedrock antes de descargar.
- Tema claro y oscuro, guardado automático, historial de 100 pasos e interfaz en español latinoamericano.
- **Agente IA**: mediante un servidor MCP, cualquier agente de IA compatible (Claude, ChatGPT, Copilot, Cursor, Gemini…) puede crear y editar tu skin en vivo (ver abajo).

## Cómo ejecutarlo

Los módulos de JavaScript no funcionan con `file://`, así que necesitas un servidor local:

```bash
cd minecraft-skins-editor
python3 -m http.server 8080
# o bien: npx serve .
```

Abre `http://localhost:8080`. Las pruebas están en `http://localhost:8080/tests/` y la documentación completa en `http://localhost:8080/docs/`.

## Publicación (GitHub Pages)

El sitio se publica tal cual desde la rama `main` (carpeta raíz): **Settings → Pages → Deploy from a branch → `main` / `(root)`**. El archivo `.nojekyll` evita que GitHub procese los archivos con Jekyll.

Dirección: <https://jacksonmultitech.github.io/minecraft-skins-editor/>

## Conectar con un agente de IA (MCP)

El botón **Agente IA** del encabezado conecta el editor con el servidor MCP del repositorio [mcp-minecraft-skins-editor](https://github.com/jacksonmultitech/mcp-minecraft-skins-editor), desplegado en Vercel. Funciona con cualquier agente que admita servidores MCP por HTTP ("streamable HTTP"), sin clave ni inicio de sesión.

1. Agrega el servidor `https://editor-skins-mcp.vercel.app/mcp` a tu agente (solo la primera vez).
2. Pulsa **Agente IA → Conectar**; aparece un código como `K7QM-X2PD-9RTA`.
3. Dile a tu agente: *“Usa el editor de skins con el código K7QM-X2PD-9RTA y hazme un caballero con armadura azul”*.

Cómo agregar el servidor en algunos agentes (los menús pueden cambiar entre versiones):

| Agente | Dónde |
|---|---|
| Claude (web / escritorio) | Configuración → Conectores → Agregar conector personalizado → pega la URL. |
| Claude Code | `claude mcp add --transport http skins https://editor-skins-mcp.vercel.app/mcp` |
| ChatGPT | Con el modo desarrollador activo: Configuración → Conectores → Crear → pega la URL. |
| VS Code (Copilot, modo agente) | En `.vscode/mcp.json`: `{ "servers": { "skins": { "type": "http", "url": "https://editor-skins-mcp.vercel.app/mcp" } } }` |
| Cursor | En `~/.cursor/mcp.json`: `{ "mcpServers": { "skins": { "url": "https://editor-skins-mcp.vercel.app/mcp" } } }` |
| Gemini CLI | En `~/.gemini/settings.json`: `{ "mcpServers": { "skins": { "httpUrl": "https://editor-skins-mcp.vercel.app/mcp" } } }` |

El servidor solo retransmite órdenes; el editor las ejecuta con su propio motor, todo queda en el historial (`Ctrl`+`Z`) y la sesión se cierra sola tras 30 minutos sin actividad. La URL del servidor está en `js/config.js` (`REMOTE.DEFAULT_BRIDGE_URL`) y se puede cambiar en *Opciones avanzadas* o con `?bridge=https://…` en la dirección.

## Estructura

```
index.html        Interfaz
css/              tokens (temas) · base · layout · components
js/main.js        Punto de entrada que conecta los módulos
js/core/          Mapa UV, documento de skin, historial, E/S PNG, transformaciones
js/render/        WebGL2: matemáticas, cámara orbital, renderizador y picking
js/editor/        Estado, herramientas, vistas 3D/2D, vista previa y atajos
js/ui/            Barra de herramientas, paneles, diálogos, notificaciones, tema, íconos
js/remote/        Puente con el agente de IA (sesión, consulta de órdenes y comandos)
js/i18n/          Textos (es-419)
js/utils/         Utilidades (eventos, color, almacenamiento, teclado, gestos)
docs/             Documentación en español
tests/            Pruebas del núcleo (se ejecutan en el navegador)
```

## Navegadores compatibles

Chrome / Edge 111+, Firefox 121+ y Safari 16.4+. Sin WebGL2, el editor 2D sigue funcionando.

## Referencias

- [Minecraft Wiki — Skin](https://minecraft.wiki/w/Skin)
- [skinview-utils](https://github.com/bs-community/skinview-utils) (conversión 64×32 y detección del modelo delgado)
- [Especificación PNG (W3C)](https://www.w3.org/TR/png-3/)

## Créditos

Creado íntegramente con **Claude AI "Opus 5.5"** de [Anthropic](https://www.anthropic.com).

---

Proyecto independiente, sin afiliación con Mojang Studios ni Microsoft. Licencia MIT.
