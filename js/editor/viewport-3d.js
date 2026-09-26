/**
 * @file viewport-3d.js
 * Vista principal de edición en 3D.
 *
 * Controles:
 *  - Clic izquierdo sobre el modelo: usa la herramienta activa.
 *  - Clic izquierdo en el fondo o clic derecho + arrastrar: girar la cámara.
 *  - Clic central, Mayús+clic derecho o Espacio + arrastrar: desplazar (paneo).
 *  - Rueda del mouse: zoom (Ctrl+rueda queda para el zoom del navegador).
 *  - Dos dedos en pantallas táctiles: zoom y desplazamiento.
 */
import { SkinRenderer } from '../render/renderer.js';
import { OrbitCamera } from '../render/camera.js';
import { pick } from '../render/picking.js';
import { getBoxes, getMirrorMap } from '../core/skin-model.js';
import { LAYER, SKIN_WIDTH, OVERLAY_ALPHA_CUTOFF } from '../config.js';
import { PinchTracker } from '../utils/gestures.js';
import { isHeld } from '../utils/keyboard.js';
import { readCssColor } from '../ui/theme.js';

const ROTATE_SPEED = 0.008;
/** Sensibilidad del zoom con la rueda del mouse. */
const WHEEL_SPEED = 0.0015;

export class Viewport3D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} deps
   * @param {import('../core/skin-document.js').SkinDocument} deps.doc
   * @param {import('./editor-state.js').EditorState} deps.state
   * @param {import('./tools.js').ToolController} deps.tools
   * @param {(info: object|null) => void} [deps.onHover] Informa el píxel bajo el cursor.
   */
  constructor(canvas, { doc, state, tools, onHover }) {
    this.canvas = canvas;
    this.doc = doc;
    this.state = state;
    this.tools = tools;
    this.onHover = onHover ?? (() => {});
    this.renderer = new SkinRenderer(canvas);
    this.camera = new OrbitCamera();
    this.mode = null; // 'paint' | 'rotate' | 'pan' | 'pinch'
    this.lastPointer = null;
    this.pinch = new PinchTracker();
    this._frame = 0;
    this.enabled = true;

    this.renderer.setModel(doc.model);
    this.renderer.updateTexture(doc.pixels);
    this.syncState();
    this.refreshTheme();
    this._bindEvents();
    new ResizeObserver(() => this.requestRender()).observe(canvas);
  }

  /* ------------------------------ Sincronía ------------------------------ */

  /** Copia al renderizador las opciones del estado del editor. */
  syncState() {
    const s = this.state;
    const o = this.renderer.options;
    o.grid = s.get('grid');
    o.emptyGrid = true;
    o.activeLayer = s.get('activeLayer');
    o.inactiveLayerOpacity = s.get('dimInactive') ? 0.35 : 1;
    this.renderer.visibility = structuredClone(s.get('visibility'));
    this.requestRender();
  }

  /** Relee los colores del tema (fondo y cuadrícula). */
  refreshTheme() {
    this.renderer.options.clearColor = readCssColor('--viewport-bg');
    this.renderer.options.gridColor = [...readCssColor('--grid-3d'), 0.45];
    this.requestRender();
  }

  /** Llamar cuando cambian los píxeles. */
  onTextureChange() {
    this.renderer.updateTexture(this.doc.pixels);
    this.requestRender();
  }

  /** Llamar cuando cambia el modelo de brazos. */
  onModelChange() {
    this.renderer.setModel(this.doc.model);
    this.requestRender();
  }

  /** Programa un redibujado en el próximo cuadro (evita dibujar de más). */
  requestRender() {
    if (this._frame || !this.enabled) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      this.renderer.render(this.camera);
    });
  }

  /* ------------------------------- Cámara -------------------------------- */

  resetCamera() { this.camera.reset(); this.requestRender(); }
  setView(view) { this.camera.setView(view); this.requestRender(); }
  zoomBy(factor) { this.camera.zoom(factor); this.requestRender(); }
  rotateBy(dYaw, dPitch) { this.camera.rotate(dYaw, dPitch); this.requestRender(); }

  /* ------------------------------ Picking -------------------------------- */

  /** Rayo desde la posición del puntero. */
  _ray(e) {
    const rect = this.canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    return this.camera.rayFromNDC(ndcX, ndcY, rect.width / rect.height);
  }

  /** Cajas visibles de la capa que se está editando. */
  _editableBoxes() {
    const layer = this.state.get('activeLayer');
    const vis = this.state.get('visibility');
    return getBoxes(this.doc.model).filter((b) => b.layer === layer && vis[b.part][layer]);
  }

  /** Primer píxel VISIBLE bajo el cursor (para el cuentagotas). */
  _pickVisible(e) {
    const vis = this.state.get('visibility');
    const boxes = getBoxes(this.doc.model).filter((b) => vis[b.part][b.layer]);
    const cutoff = OVERLAY_ALPHA_CUTOFF * 255;
    const hit = pick(this._ray(e), boxes, (h) => h.box.layer === LAYER.BASE || this.doc.getPixel(h.x, h.y)[3] >= cutoff);
    return hit ? { ...hit, color: this.doc.getPixel(hit.x, hit.y) } : null;
  }

  _pickEditable(e) {
    return pick(this._ray(e), this._editableBoxes());
  }

  _updateHover(e) {
    const hit = e ? this._pickEditable(e) : null;
    const r = this.renderer;
    const prev = r.hover;
    r.hover = hit ? { x: hit.x, y: hit.y } : null;
    r.hoverMirror = null;
    if (hit && this.state.get('mirror')) {
      const m = getMirrorMap(this.doc.model)[hit.y * SKIN_WIDTH + hit.x];
      if (m >= 0) r.hoverMirror = { x: m % SKIN_WIDTH, y: Math.floor(m / SKIN_WIDTH) };
    }
    if (prev?.x !== r.hover?.x || prev?.y !== r.hover?.y) this.requestRender();
    this.onHover(hit ? { x: hit.x, y: hit.y, part: hit.box.part, layer: hit.box.layer, face: hit.face.name } : null);
  }

  /* ------------------------------- Eventos ------------------------------- */

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    c.addEventListener('pointerup', (e) => this._onUp(e));
    c.addEventListener('pointercancel', (e) => this._onUp(e));
    c.addEventListener('pointerleave', () => { if (!this.mode) this._updateHover(null); });
    // passive: false para que la rueda no desplace la página mientras se hace zoom.
    c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
  }

  _onDown(e) {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.mode = this._resolveMode(e);
    this.canvas.classList.toggle('is-grabbing', this.mode === 'rotate' || this.mode === 'pan');
  }

  /**
   * Decide qué hace un clic según el botón, las teclas y lo que hay debajo.
   * Si el clic cae sobre el modelo con el botón izquierdo, inicia el trazo.
   * @returns {'paint'|'rotate'|'pan'|'pinch'|null}
   */
  _resolveMode(e) {
    if (e.pointerType === 'touch') {
      this.pinch.down(e);
      if (this.pinch.count === 2) {
        // Segundo dedo: cancelar el trazo y pasar a zoom/paneo.
        if (this.mode === 'paint') this.tools.end();
        return 'pinch';
      }
    }
    const wantsPan = e.button === 1 || (e.button === 2 && e.shiftKey) || (e.button === 0 && isHeld('Space'));
    if (wantsPan) return 'pan';
    if (e.button === 2) return 'rotate';
    if (e.button !== 0) return null;

    const isPicker = e.altKey || this.state.get('tool') === 'picker';
    const hit = isPicker ? this._pickVisible(e) : this._pickEditable(e);
    if (!hit) return 'rotate';
    this.tools.begin({ x: hit.x, y: hit.y, color: hit.color }, { shift: e.shiftKey, alt: e.altKey });
    return 'paint';
  }

  _onMove(e) {
    if (e.pointerType === 'touch' && this.mode === 'pinch') {
      const g = this.pinch.move(e);
      if (g) {
        this.camera.zoom(1 / g.scale);
        this.camera.pan(g.dx, g.dy, this.canvas.clientHeight);
        this.requestRender();
      }
      return;
    }
    const dx = e.clientX - (this.lastPointer?.x ?? e.clientX);
    const dy = e.clientY - (this.lastPointer?.y ?? e.clientY);
    this.lastPointer = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'touch') this.pinch.move(e);

    switch (this.mode) {
      case 'rotate':
        this.camera.rotate(dx * ROTATE_SPEED, dy * ROTATE_SPEED);
        this.requestRender();
        break;
      case 'pan':
        this.camera.pan(dx, dy, this.canvas.clientHeight);
        this.requestRender();
        break;
      case 'paint': {
        const isPicker = this.tools.toolId === 'picker';
        const hit = isPicker ? this._pickVisible(e) : this._pickEditable(e);
        if (hit) this.tools.move({ x: hit.x, y: hit.y, color: hit.color });
        this._updateHover(e);
        break;
      }
      default:
        this._updateHover(e);
    }
  }

  _onUp(e) {
    if (e.pointerType === 'touch') this.pinch.up(e);
    if (this.mode === 'paint') this.tools.end();
    if (this.mode === 'pinch' && this.pinch.count > 0) return; // esperar a que se levanten ambos dedos
    this.mode = null;
    this.canvas.classList.remove('is-grabbing');
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  }

  _onWheel(e) {
    // Solo la rueda sola hace zoom. Con Ctrl se deja pasar el evento para
    // que el navegador aplique su zoom de página habitual.
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // líneas → píxeles
    this.camera.zoom(Math.exp(delta * WHEEL_SPEED));
    this.requestRender();
  }
}
