/**
 * @file main.js
 * Punto de entrada: crea los módulos y los conecta entre sí.
 *
 * Arquitectura (resumen):
 *
 *   SkinDocument (píxeles + historial) ──"change"──▶ Viewport3D / Viewport2D / Preview / ColorPanel
 *   EditorState  (herramienta, colores…) ─"change"─▶ Toolbar / Viewports / Paneles
 *   ToolController traduce clics sobre píxeles en cambios del SkinDocument.
 *
 * Ningún módulo de interfaz modifica los píxeles directamente: todo pasa por
 * SkinDocument, lo que mantiene coherentes las vistas y el historial.
 */
import { STORAGE_KEYS, LAYER, MODEL } from './config.js';
import { setLocale, applyTranslations, t } from './i18n/i18n.js';
import { SkinDocument } from './core/skin-document.js';
import { decodeImage, imageToSkin, encodePNG, downloadBlob, sanitizeFileName, analyzeSkin, SkinFormatError, hasHostDownloads } from './core/skin-io.js';
import { createTemplateSkin, createBlankSkin } from './core/templates.js';
import { clearLayer, mirrorSide, convertArms } from './core/transforms.js';
import { EditorState } from './editor/editor-state.js';
import { ToolController } from './editor/tools.js';
import { Viewport3D } from './editor/viewport-3d.js';
import { Viewport2D } from './editor/viewport-2d.js';
import { Preview } from './editor/preview.js';
import { registerShortcuts } from './editor/shortcuts.js';
import { Toolbar } from './ui/toolbar.js';
import { ColorPanel } from './ui/color-panel.js';
import { LayersPanel } from './ui/layers-panel.js';
import { HarmonyPanel } from './ui/harmony-panel.js';
import { bindMenu } from './ui/menu.js';
import { SidebarResizer } from './ui/sidebar-resizer.js';
import { ClaudePanel } from './ui/claude-panel.js';
import { ClaudeBridge } from './remote/claude-bridge.js';
import { createCommandHandlers } from './remote/commands.js';
import { hydrateIcons, icon } from './ui/icons.js';
import { initTheme, toggleTheme, currentTheme, themeEvents } from './ui/theme.js';
import { initToasts, toast } from './ui/toast.js';
import { confirmDialog, infoDialog, renderShortcuts, enableBackdropClose } from './ui/dialogs.js';
import { loadJSON, saveJSON } from './utils/storage.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------------------ */
/* Autoguardado: la skin se guarda en localStorage como Base64               */
/* ------------------------------------------------------------------------ */

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(text) {
  const bin = atob(text);
  const out = new Uint8ClampedArray(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class App {
  constructor() {
    setLocale('es-419');
    initTheme();
    applyTranslations(document);
    hydrateIcons(document);
    initToasts($('toasts'));

    this.doc = new SkinDocument();
    this.state = new EditorState();
    this._autosaveTimer = 0;
    this._restoreInitialSkin();

    this.tools = new ToolController(this.doc, this.state, {
      notify: (key, params) => toast(t(key, params), 'info'),
    });
    this.toolbar = new Toolbar({ state: this.state, doc: this.doc });

    const deps = {
      doc: this.doc,
      state: this.state,
      tools: this.tools,
      onHover: (info) => this._showHover(info),
    };
    // La vista 3D requiere WebGL2; si no existe, el editor sigue funcionando en 2D.
    try {
      this.viewport3d = new Viewport3D($('canvas-3d'), deps);
    } catch (err) {
      console.error(err);
      this.viewport3d = null;
      toast(t('errors.webgl'), 'error', 6000);
      this.state.set('viewMode', '2d');
      document.querySelector('[data-key="viewMode"] [data-value="3d"]').disabled = true;
    }
    this.viewport2d = new Viewport2D($('canvas-2d'), { ...deps, onZoom: (s) => this._showZoom(s) });
    try {
      this.preview = new Preview($('canvas-preview'), { doc: this.doc, state: this.state });
    } catch (err) {
      console.error(err);
      this.preview = null;
      $('panel-preview').hidden = true;
    }

    this.colorPanel = new ColorPanel($('panel-color'), { state: this.state, doc: this.doc });
    this.layersPanel = new LayersPanel($('panel-layers'), { state: this.state });
    this.harmonyPanel = new HarmonyPanel($('panel-theory'), { state: this.state, getName: () => this.doc.name });
    this.sidebarResizer = new SidebarResizer($('sidebar-resizer'), document.querySelector('.app'));

    // Conexión con Claude (MCP). Si había una sesión activa, se retoma.
    this.claudeBridge = new ClaudeBridge({ handlers: createCommandHandlers(this) });
    this.claudePanel = new ClaudePanel(this.claudeBridge);
    this.claudeBridge.resume();
    // Dentro de claude.ai solo se permiten ciertas extensiones: .gpl no está entre ellas.
    hasHostDownloads().then((hosted) => {
      if (hosted) document.querySelectorAll('.menu__list [data-value="gpl"]').forEach((el) => { el.hidden = true; });
    });

    this._bindDocument();
    this._bindState();
    this._bindHeader();
    this._bindPanels();
    this._bindFileDrop();
    this._bindTheme();
    registerShortcuts(this);

    this._applyViewMode();
    this._syncModelRadios();
    this._showTool();
    this.toolbar.setHistory({ canUndo: false, canRedo: false });
    renderShortcuts($('shortcuts-content'));
    document.querySelectorAll('dialog').forEach(enableBackdropClose);
    document.body.classList.add('is-ready');
  }

  /* ----------------------------- Inicio ----------------------------- */

  _restoreInitialSkin() {
    const saved = loadJSON(STORAGE_KEYS.AUTOSAVE, null);
    if (saved?.pixels) {
      try {
        const pixels = fromBase64(saved.pixels);
        if (pixels.length === this.doc.pixels.length) {
          this.doc.load(pixels, saved.model === MODEL.SLIM ? MODEL.SLIM : MODEL.CLASSIC, { keepHistory: false });
          this.doc.name = saved.name || this.doc.name;
          $('file-name').value = this.doc.name;
          setTimeout(() => toast(t('toasts.restored'), 'info'), 400);
          return;
        }
      } catch {
        /* Datos dañados: se ignora y se usa la plantilla. */
      }
    }
    const { pixels, model } = createTemplateSkin();
    this.doc.load(pixels, model, { keepHistory: false });
    $('file-name').value = this.doc.name;
  }

  _scheduleAutosave() {
    clearTimeout(this._autosaveTimer);
    this._autosaveTimer = setTimeout(() => {
      const ok = saveJSON(STORAGE_KEYS.AUTOSAVE, {
        pixels: toBase64(this.doc.pixels), model: this.doc.model, name: this.doc.name,
      });
      $('status-save').textContent = ok ? t('status.saved') : t('status.notSaved');
      $('status-save').classList.toggle('is-off', !ok);
    }, 600);
  }

  /* ------------------------- Conexiones --------------------------- */

  /** Cambios en la skin → vistas, paletas y autoguardado. */
  _bindDocument() {
    this.doc.on('change', () => {
      this.viewport3d?.onTextureChange();
      this.viewport2d.onTextureChange();
      this.preview?.onTextureChange();
      this.colorPanel.refreshSkinColors();
      this._scheduleAutosave();
    });
    this.doc.on('model', () => {
      this.viewport3d?.onModelChange();
      this.viewport2d.onModelChange();
      this.preview?.onModelChange();
      this._syncModelRadios();
    });
    this.doc.on('history', (h) => this.toolbar.setHistory(h));
  }

  /** Cambios en el estado del editor → controles y vistas. */
  _bindState() {
    this.state.on('change', ({ key }) => {
      this.toolbar.sync();
      switch (key) {
        case 'primary':
          this.colorPanel.syncFromState();
          this.harmonyPanel.render();
          break;
        case 'secondary':
        case 'colorFormat':
          this.colorPanel.syncFromState();
          break;
        case 'colorGrouping':
          this.colorPanel.refreshSkinColors();
          break;
        case 'harmonyType':
        case 'scaleMode':
          this.harmonyPanel.render();
          break;
        case 'recentColors':
          this.colorPanel.renderRecent();
          break;
        case 'visibility':
        case 'activeLayer':
          this.layersPanel.sync();
          this.viewport3d?.syncState();
          this.viewport2d.syncState();
          break;
        case 'viewMode':
          this._applyViewMode();
          break;
        case 'tool':
          this._showTool();
          break;
        case 'autoRotate':
        case 'animation':
        case 'previewOverlay':
          this.preview?.syncState();
          break;
        default:
          this.viewport3d?.syncState();
          this.viewport2d.syncState();
      }
    });
  }

  _bindHeader() {
    // Menú "Nuevo".
    bindMenu($('btn-new'), $('menu-new'), (kind) => this.newSkin(kind));

    $('btn-open').addEventListener('click', () => this.openFileDialog());
    $('file-input').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.loadFile(file);
      e.target.value = ''; // permite volver a abrir el mismo archivo
    });
    $('file-name').addEventListener('change', (e) => {
      this.doc.name = sanitizeFileName(e.target.value);
      e.target.value = this.doc.name;
      this._scheduleAutosave();
    });
    $('btn-download').addEventListener('click', () => this.download());
    $('btn-check').addEventListener('click', () => this.showCompatibility());
    $('btn-help').addEventListener('click', () => $('dialog-help').showModal());
    $('btn-theme').addEventListener('click', () => toggleTheme());
  }

  _bindPanels() {
    // Modelo de brazos.
    document.querySelectorAll('input[name="model"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        const transform = this.state.get('adaptArms') ? convertArms : undefined;
        this.doc.setModel(radio.value, transform);
        toast(t('toasts.modelChanged', { model: t(`model.${radio.value}`) }), 'success');
      });
    });
    const adapt = $('opt-adapt-arms');
    adapt.checked = this.state.get('adaptArms');
    adapt.addEventListener('change', () => this.state.set('adaptArms', adapt.checked));

    // Acciones sobre zonas completas.
    const onlyActive = () => ($('opt-only-active').checked ? this.state.get('activeLayer') : null);
    $('btn-mirror-rl').addEventListener('click', () => {
      this.doc.transaction((d) => mirrorSide(d.pixels, d.model, 'rightToLeft', onlyActive()));
      toast(t('toasts.mirrored'), 'success');
    });
    $('btn-mirror-lr').addEventListener('click', () => {
      this.doc.transaction((d) => mirrorSide(d.pixels, d.model, 'leftToRight', onlyActive()));
      toast(t('toasts.mirrored'), 'success');
    });
    $('btn-clear-overlay').addEventListener('click', () => this.clearLayerWithConfirm(LAYER.OVERLAY));
    $('btn-clear-base').addEventListener('click', () => this.clearLayerWithConfirm(LAYER.BASE));

    // Vista previa.
    const autoRotate = $('opt-autorotate');
    const animation = $('opt-animation');
    const overlay = $('opt-preview-overlay');
    autoRotate.checked = this.state.get('autoRotate');
    animation.value = this.state.get('animation');
    overlay.checked = this.state.get('previewOverlay');
    autoRotate.addEventListener('change', () => this.state.set('autoRotate', autoRotate.checked));
    animation.addEventListener('change', () => this.state.set('animation', animation.value));
    overlay.addEventListener('change', () => this.state.set('previewOverlay', overlay.checked));
    $('btn-screenshot').addEventListener('click', async () => {
      const blob = await this.preview?.capture();
      if (!blob) return;
      const result = await downloadBlob(blob, `${this.doc.name}-vista-previa.png`);
      if (result === 'saved') toast(t('toasts.screenshot'), 'success');
      else if (result === 'failed') toast(t('errors.download'), 'error');
    });

    // Controles de cámara/zoom superpuestos a la vista.
    document.querySelectorAll('[data-camera-view]').forEach((b) => {
      b.addEventListener('click', () => this.viewport3d?.setView(b.dataset.cameraView));
    });
    $('btn-zoom-in').addEventListener('click', () => this.zoom(0.85));
    $('btn-zoom-out').addEventListener('click', () => this.zoom(1 / 0.85));
    $('btn-view-reset').addEventListener('click', () => this.resetView());
  }

  /** Arrastrar y soltar archivos, y pegar desde el portapapeles. */
  _bindFileDrop() {
    const zone = $('dropzone');
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      depth++;
      zone.hidden = false;
    });
    window.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) zone.hidden = true;
    });
    window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      zone.hidden = true;
      const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
      if (file) this.loadFile(file);
    });
    window.addEventListener('paste', (e) => {
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
      if (!item) return;
      e.preventDefault();
      this.loadFile(item.getAsFile(), 'portapapeles');
    });
  }

  _bindTheme() {
    const update = () => {
      const dark = currentTheme() === 'dark';
      const btn = $('btn-theme');
      btn.innerHTML = icon(dark ? 'sun' : 'moon');
      const label = dark ? t('menu.themeLight') : t('menu.themeDark');
      btn.title = label;
      btn.setAttribute('aria-label', label);
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1b1d22' : '#f3f4f6');
    };
    themeEvents.on('change', () => {
      update();
      this.viewport3d?.refreshTheme();
      this.viewport2d.refreshTheme();
      this.preview?.refreshTheme();
      this.harmonyPanel?.render(); // el círculo cromático usa colores del tema
    });
    update();
  }

  /* ------------------------- Acciones públicas ------------------------- */

  undo() {
    if (!this.doc.undo()) toast(t('toasts.nothingToUndo'));
  }

  redo() {
    if (!this.doc.redo()) toast(t('toasts.nothingToRedo'));
  }

  zoom(factor) {
    if (this.state.get('viewMode') === '3d') this.viewport3d?.zoomBy(factor);
    else this.viewport2d.zoomBy(1 / factor);
  }

  resetView() {
    if (this.state.get('viewMode') === '3d') this.viewport3d?.resetCamera();
    else this.viewport2d.fit();
  }

  openFileDialog() {
    $('file-input').click();
  }

  /**
   * Abre una imagen como skin.
   * @param {File|Blob} file
   * @param {string} [label] Nombre a mostrar si el archivo no tiene uno.
   */
  async loadFile(file, label) {
    try {
      const image = await decodeImage(file);
      const { pixels, model, notes } = imageToSkin(image);
      this.doc.load(pixels, model, { keepHistory: true });
      if (file.name) {
        this.doc.name = sanitizeFileName(file.name);
        $('file-name').value = this.doc.name;
      }
      toast(t('toasts.loaded', { name: file.name || label || 'PNG' }), 'success');
      notes.forEach((n) => toast(t(n), 'warning', 6000));
    } catch (err) {
      if (err instanceof SkinFormatError) toast(t(err.code, err.data), 'error', 6000);
      else { console.error(err); toast(t('errors.generic'), 'error'); }
    }
  }

  /** Cambia el nombre del archivo de la skin (sin extensión). */
  setFileName(name) {
    this.doc.name = sanitizeFileName(name);
    $('file-name').value = this.doc.name;
    this._scheduleAutosave();
  }

  /** Descarga la skin como PNG de 64×64. */
  async download() {
    const blob = await encodePNG(this.doc.pixels);
    const file = `${sanitizeFileName(this.doc.name)}.png`;
    const result = await downloadBlob(blob, file);
    if (result === 'declined') return;
    if (result === 'failed') { toast(t('errors.download'), 'error'); return; }
    toast(t('toasts.downloaded', { file }), 'success');
    const s = analyzeSkin(this.doc.pixels, this.doc.model);
    if (s.baseTransparent || s.overlayHidden || s.unusedPainted) toast(t('toasts.exportWarning'), 'warning', 5000);
  }

  /** Crea una skin nueva (plantilla o en blanco) tras confirmar. */
  async newSkin(kind) {
    const ok = await confirmDialog({ title: t('dialogs.newTitle'), body: t('dialogs.newBody'), confirmText: t('dialogs.create') });
    if (!ok) return;
    const { pixels, model } = kind === 'blank' ? createBlankSkin() : createTemplateSkin(this.doc.model);
    this.doc.load(pixels, kind === 'blank' ? this.doc.model : model, { keepHistory: true });
  }

  async clearLayerWithConfirm(layer) {
    const ok = await confirmDialog({
      title: t('dialogs.clearTitle'),
      body: `${t(`layerNames.${layer}`)}: ${t('dialogs.clearBody')}`,
      confirmText: t('dialogs.clear'),
      danger: true,
    });
    if (!ok) return;
    this.doc.transaction((d) => clearLayer(d.pixels, d.model, layer));
    toast(t('toasts.cleared'), 'success');
  }

  /** Muestra el informe de compatibilidad con el juego. */
  showCompatibility() {
    const s = analyzeSkin(this.doc.pixels, this.doc.model);
    const items = [
      { text: t('check.format'), type: 'ok' },
      { text: t('check.model', { model: t(`model.${this.doc.model}`) }), type: 'info' },
      { text: t('check.overlayCount', { n: s.overlayVisible }), type: 'info' },
    ];
    if (s.baseTransparent) items.push({ text: t('check.baseTransparent', { n: s.baseTransparent }), type: 'warning' });
    if (s.overlaySemi) items.push({ text: t('check.overlaySemi', { n: s.overlaySemi }), type: 'warning' });
    if (s.overlayHidden) items.push({ text: t('check.overlayHidden', { n: s.overlayHidden }), type: 'warning' });
    if (s.unusedPainted) items.push({ text: t('check.unusedPainted', { n: s.unusedPainted }), type: 'warning' });
    if (items.length === 3) items.push({ text: t('check.allGood'), type: 'ok' });
    infoDialog('dialog-check', t('dialogs.checkTitle'), items);
  }

  /* ----------------------------- Interfaz ----------------------------- */

  _applyViewMode() {
    const mode = this.viewport3d ? this.state.get('viewMode') : '2d';
    const is3d = mode === '3d';
    $('canvas-3d').hidden = !is3d;
    $('canvas-2d').hidden = is3d;
    if (this.viewport3d) {
      this.viewport3d.enabled = is3d;
      if (is3d) this.viewport3d.requestRender();
    }
    this.viewport2d.enabled = !is3d;
    if (!is3d) {
      if (!this.viewport2d._fitted) this.viewport2d.fit();
      this.viewport2d.requestRender();
    }
    $('camera-views').hidden = !is3d;
    $('viewport-hint').textContent = is3d ? t('views.cameraHint') : t('views.canvasHint');
    $('btn-view-reset').title = is3d ? t('views.reset') : t('views.fit');
    $('status-zoom').hidden = is3d;
  }

  _syncModelRadios() {
    document.querySelectorAll('input[name="model"]').forEach((r) => { r.checked = r.value === this.doc.model; });
    $('status-model').textContent = t(`model.${this.doc.model}`);
  }

  _showTool() {
    $('status-tool').textContent = t(`tools.${this.state.get('tool')}`);
    document.querySelector('.workspace').dataset.tool = this.state.get('tool');
  }

  _showZoom(scale) {
    $('status-zoom').textContent = `${t('status.zoom')}: ${Math.round(scale * 100) / 100}×`;
  }

  _showHover(info) {
    const el = $('status-hover');
    if (!info) { el.textContent = t('status.outside'); return; }
    const pos = `(${info.x}, ${info.y})`;
    el.textContent = info.unused
      ? `${t('status.unused')} · ${pos}`
      : `${t(`parts.${info.part}`)} · ${t(`faces.${info.face}`)} · ${t(`layerNames.${info.layer}`)} · ${pos}`;
  }
}

// Iniciar cuando el DOM esté listo (los módulos ya se cargan diferidos).
window.app = new App();
