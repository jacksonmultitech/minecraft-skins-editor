/**
 * @file viewport-2d.js
 * Vista de edición 2D: muestra la textura plana de 64×64 con guías de cada
 * zona (parte, cara y capa), cuadrícula y zoom/desplazamiento libres.
 *
 * Controles:
 *  - Clic izquierdo: herramienta activa.
 *  - Clic derecho, clic central o Espacio + arrastrar: desplazar.
 *  - Rueda del mouse: zoom centrado en el cursor.
 */
import { SKIN_WIDTH, SKIN_HEIGHT, CANVAS2D_LIMITS, LAYER } from '../config.js';
import { getRegionMap, getMirrorMap } from '../core/skin-model.js';
import { PinchTracker } from '../utils/gestures.js';
import { isHeld } from '../utils/keyboard.js';
import { clamp } from '../utils/color.js';
import { readCssVar } from '../ui/theme.js';

export class Viewport2D {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} deps Mismas dependencias que Viewport3D.
   */
  constructor(canvas, { doc, state, tools, onHover, onZoom }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.doc = doc;
    this.state = state;
    this.tools = tools;
    this.onHover = onHover ?? (() => {});
    this.onZoom = onZoom ?? (() => {});
    this.scale = 8;      // píxeles de pantalla por píxel de la skin
    this.offset = { x: 0, y: 0 };
    this.hover = null;
    this.mode = null;
    this.pinch = new PinchTracker();
    this.enabled = false;
    this._frame = 0;
    this._fitted = false;

    // Lienzo auxiliar con la textura a tamaño real (64×64).
    this.texCanvas = document.createElement('canvas');
    this.texCanvas.width = SKIN_WIDTH;
    this.texCanvas.height = SKIN_HEIGHT;
    this.texCtx = this.texCanvas.getContext('2d');

    this._bindEvents();
    new ResizeObserver(() => { if (!this._fitted) this.fit(); this.requestRender(); }).observe(canvas);
    this.refreshTheme();
    this.onTextureChange();
  }

  /* ------------------------------ Sincronía ------------------------------ */

  syncState() { this.requestRender(); }
  onModelChange() { this.requestRender(); }

  onTextureChange() {
    this.texCtx.putImageData(new ImageData(new Uint8ClampedArray(this.doc.pixels), SKIN_WIDTH, SKIN_HEIGHT), 0, 0);
    this.requestRender();
  }

  /** Lee los colores del tema. */
  refreshTheme() {
    this.colors = {
      bg: readCssVar('--viewport-bg'),
      checkA: readCssVar('--checker-a'),
      checkB: readCssVar('--checker-b'),
      unused: readCssVar('--unused-area'),
      base: readCssVar('--layer-base'),
      overlay: readCssVar('--layer-overlay'),
      grid: readCssVar('--grid-2d'),
      hover: readCssVar('--hover-outline'),
    };
    this.requestRender();
  }

  requestRender() {
    if (this._frame || !this.enabled) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      this.render();
    });
  }

  /* -------------------------------- Vista -------------------------------- */

  /** Ajusta el zoom para que la textura completa quepa en pantalla. */
  fit() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.scale = clamp(Math.floor((Math.min(w, h) * 0.92) / SKIN_WIDTH), CANVAS2D_LIMITS.MIN_SCALE, CANVAS2D_LIMITS.MAX_SCALE);
    this.offset = { x: (w - SKIN_WIDTH * this.scale) / 2, y: (h - SKIN_HEIGHT * this.scale) / 2 };
    this._fitted = true;
    this.onZoom(this.scale);
    this.requestRender();
  }

  /**
   * Cambia el zoom manteniendo fijo el punto (px, py) de la pantalla.
   * @param {number} factor
   * @param {number} [px] Coordenada X en el lienzo (por defecto, el centro).
   * @param {number} [py]
   */
  zoomBy(factor, px = this.canvas.clientWidth / 2, py = this.canvas.clientHeight / 2) {
    const next = clamp(this.scale * factor, CANVAS2D_LIMITS.MIN_SCALE, CANVAS2D_LIMITS.MAX_SCALE);
    const k = next / this.scale;
    this.offset.x = px - (px - this.offset.x) * k;
    this.offset.y = py - (py - this.offset.y) * k;
    this.scale = next;
    this.onZoom(this.scale);
    this.requestRender();
  }

  /** Convierte coordenadas del puntero en un píxel de la skin (o null). */
  _texelAt(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left - this.offset.x) / this.scale);
    const y = Math.floor((e.clientY - rect.top - this.offset.y) / this.scale);
    return this.doc.inBounds(x, y) ? { x, y } : null;
  }

  /* ------------------------------- Dibujo -------------------------------- */

  render() {
    const { canvas, ctx, scale, offset, colors } = this;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    const size = SKIN_WIDTH * scale;
    const { lookup, regions } = getRegionMap(this.doc.model);

    // 1) Fondo de ajedrez (indica transparencia) solo en zonas usadas.
    const half = scale / 2;
    for (let y = 0; y < SKIN_HEIGHT; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        const px = offset.x + x * scale, py = offset.y + y * scale;
        if (lookup[y * SKIN_WIDTH + x] < 0) {
          ctx.fillStyle = colors.unused;
          ctx.fillRect(px, py, scale, scale);
          continue;
        }
        ctx.fillStyle = colors.checkA;
        ctx.fillRect(px, py, scale, scale);
        if (scale >= 4) {
          ctx.fillStyle = colors.checkB;
          ctx.fillRect(px, py, half, half);
          ctx.fillRect(px + half, py + half, half, half);
        }
      }
    }

    // 2) Textura.
    ctx.drawImage(this.texCanvas, offset.x, offset.y, size, size);

    // 3) Cuadrícula de píxeles (solo si hay suficiente zoom).
    if (this.state.get('grid') && scale >= 6) {
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= SKIN_WIDTH; i++) {
        const p = Math.round(offset.x + i * scale) + 0.5;
        ctx.moveTo(p, offset.y); ctx.lineTo(p, offset.y + size);
        const q = Math.round(offset.y + i * scale) + 0.5;
        ctx.moveTo(offset.x, q); ctx.lineTo(offset.x + size, q);
      }
      ctx.stroke();
    }

    // 4) Contorno de cada cara, con color según la capa (la activa se resalta).
    const active = this.state.get('activeLayer');
    for (const r of regions) {
      const isActive = r.layer === active;
      ctx.strokeStyle = r.layer === LAYER.BASE ? colors.base : colors.overlay;
      ctx.globalAlpha = isActive ? 0.95 : 0.4;
      ctx.lineWidth = isActive ? 2 : 1;
      ctx.strokeRect(offset.x + r.rect.x * scale, offset.y + r.rect.y * scale, r.rect.w * scale, r.rect.h * scale);
    }
    ctx.globalAlpha = 1;

    // 5) Resaltado del píxel bajo el cursor (y su simétrico).
    if (this.hover) {
      const marks = [this.hover];
      if (this.state.get('mirror')) {
        const m = getMirrorMap(this.doc.model)[this.hover.y * SKIN_WIDTH + this.hover.x];
        if (m >= 0) marks.push({ x: m % SKIN_WIDTH, y: Math.floor(m / SKIN_WIDTH), mirror: true });
      }
      const brush = this.state.get('brushSize');
      const start = -Math.floor((brush - 1) / 2);
      for (const mark of marks) {
        ctx.strokeStyle = colors.hover;
        ctx.setLineDash(mark.mirror ? [4, 3] : []);
        ctx.lineWidth = 2;
        ctx.strokeRect(offset.x + (mark.x + start) * scale, offset.y + (mark.y + start) * scale, brush * scale, brush * scale);
      }
      ctx.setLineDash([]);
    }
  }

  /* ------------------------------- Eventos ------------------------------- */

  _bindEvents() {
    const c = this.canvas;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => this._onDown(e));
    c.addEventListener('pointermove', (e) => this._onMove(e));
    c.addEventListener('pointerup', (e) => this._onUp(e));
    c.addEventListener('pointercancel', (e) => this._onUp(e));
    c.addEventListener('pointerleave', () => { if (!this.mode) this._setHover(null); });
    c.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
  }

  _setHover(texel) {
    const prev = this.hover;
    this.hover = texel;
    if (prev?.x !== texel?.x || prev?.y !== texel?.y) this.requestRender();
    if (!texel) { this.onHover(null); return; }
    const { lookup, regions } = getRegionMap(this.doc.model);
    const r = regions[lookup[texel.y * SKIN_WIDTH + texel.x]];
    this.onHover({ x: texel.x, y: texel.y, part: r?.part, layer: r?.layer, face: r?.face, unused: !r });
  }

  _onDown(e) {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    this.last = { x: e.clientX, y: e.clientY };
    if (e.pointerType === 'touch') {
      this.pinch.down(e);
      if (this.pinch.count === 2) {
        if (this.mode === 'paint') this.tools.end();
        this.mode = 'pinch';
        return;
      }
    }
    if (e.button === 1 || e.button === 2 || (e.button === 0 && isHeld('Space'))) {
      this.mode = 'pan';
      this.canvas.classList.add('is-grabbing');
      return;
    }
    if (e.button !== 0) return;
    const texel = this._texelAt(e);
    // No se pinta fuera del mapa UV: el juego ignora esas zonas.
    if (!texel || getRegionMap(this.doc.model).lookup[texel.y * SKIN_WIDTH + texel.x] < 0) {
      this.mode = 'pan';
      this.canvas.classList.add('is-grabbing');
      return;
    }
    this.mode = 'paint';
    this.tools.begin(texel, { shift: e.shiftKey, alt: e.altKey });
  }

  _onMove(e) {
    if (this.mode === 'pinch') {
      const g = this.pinch.move(e);
      if (g) {
        const rect = this.canvas.getBoundingClientRect();
        this.offset.x += g.dx; this.offset.y += g.dy;
        this.zoomBy(g.scale, g.cx - rect.left, g.cy - rect.top);
      }
      return;
    }
    if (e.pointerType === 'touch') this.pinch.move(e);
    const dx = e.clientX - (this.last?.x ?? e.clientX);
    const dy = e.clientY - (this.last?.y ?? e.clientY);
    this.last = { x: e.clientX, y: e.clientY };
    if (this.mode === 'pan') {
      this.offset.x += dx; this.offset.y += dy;
      this.requestRender();
      return;
    }
    const texel = this._texelAt(e);
    this._setHover(texel);
    if (this.mode === 'paint' && texel) this.tools.move(texel);
  }

  _onUp(e) {
    if (e.pointerType === 'touch') this.pinch.up(e);
    if (this.mode === 'paint') this.tools.end();
    if (this.mode === 'pinch' && this.pinch.count > 0) return;
    this.mode = null;
    this.canvas.classList.remove('is-grabbing');
    if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
  }

  _onWheel(e) {
    // Solo la rueda sola hace zoom (Ctrl+rueda queda para el navegador).
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomBy(Math.exp(-delta * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  }
}
