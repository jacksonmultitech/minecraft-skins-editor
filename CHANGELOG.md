# Registro de cambios

Todas las versiones siguen el [versionado semántico](https://semver.org/lang/es/) de tres dígitos (MAYOR.MENOR.PARCHE). Cada versión se publica como *Release* (con el `.zip` del sitio) y como paquete en GitHub Packages.

## [1.1.0] - 2026-10-02

### Agregado
- Selector **Fondo** en la vista previa: escenas al estilo de Minecraft dibujadas por código (pradera de día, atardecer, noche estrellada, cueva con minerales, Nether, El End), pantalla verde para croma o una imagen propia, que se guarda en el navegador. La captura PNG incluye el fondo; las imágenes para el agente usan siempre el fondo liso.
- Botón visible **Paleta de la skin** junto al cuentagotas para descargar o copiar los colores de la skin (PNG, .gpl, JSON, TXT).
- La documentación se publica también en la **Wiki** del repositorio (`scripts/docs_to_wiki.py` + workflow `wiki.yml`).
- Favicon compartido (`favicon.svg`) en el editor, la documentación y las pruebas.
- Pruebas de los fondos y del ajuste "cover" (26 en total).

### Cambiado
- El botón **Claude** pasa a ser **Agente IA**: el editor funciona con cualquier agente compatible con MCP (Claude, ChatGPT, Copilot, Cursor, Gemini…). Módulos `agent-bridge.js` y `agent-panel.js`.
- "Exportar colores" se llama ahora **Exportar armonía y escala**, porque solo exporta los colores de ese panel.
- La ayuda de la vista previa ("Arrastra para girar…") va a la izquierda del botón de captura.

### Corregido
- Desbordes del panel lateral en su ancho mínimo (280 px).

## [1.0.0] - 2026-09-26

Primera versión publicada.

- Editor 3D y 2D con cámara orbital, 8 herramientas, espejo, capas base y externa, modelo clásico y delgado.
- Vista previa animada (reposo, caminar, correr, saludar) con captura en PNG.
- Teoría del color: valores HEX/RGB/HSL/OKLCH, escala tonal, 7 armonías con círculo cromático, paleta aleatoria y exportación.
- "Colores de tu skin" agrupados por familia y descargables (PNG, .gpl, JSON, TXT).
- Botón "Claude" para conectar el editor con el servidor MCP ([mcp-minecraft-skins-editor](https://github.com/jacksonmultitech/mcp-minecraft-skins-editor)).
- Codificador y decodificador PNG propios, verificación de compatibilidad con Java y Bedrock.
