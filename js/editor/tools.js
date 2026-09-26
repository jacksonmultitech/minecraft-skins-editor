/**
 * @file tools.js
 * Herramientas de dibujo y controlador de trazos.
 *
 * Las herramientas trabajan en "espacio de textura" (coordenadas x, y de la
 * imagen de 64×64). Por eso funcionan igual en la vista 3D y en la 2D: cada
 * vista solo se encarga de traducir el cursor a un píxel.
 *
 * Para agregar una herramienta nueva:
 *  1. Añádela a TOOLS con un id, ícono, atajo y tipo ("brush", "click" o "picker").
 *  2. Si es de tipo "brush", define su transformación en BRUSH_OPS.
 *  3. Si es de tipo "click", implementa su acción en ToolController._click().
 *  4. Agrega sus textos en i18n/es-419.js (tools.<id> y tools.hints.<id>).
 */
import { getRegionMap, getMirrorMap } from '../core/skin-model.js';
import { SKIN_WIDTH, SKIN_HEIGHT } from '../config.js';
import { shade, noise, sameColor } from '../utils/color.js';

/**
 * Catálogo de herramientas.
 * - brush: se aplica mientras se arrastra.
 * - click: actúa una sola vez por clic.
 * - picker: toma colores.
 * - once: en un mismo trazo, cada píxel se modifica una sola vez.
 */
export const TOOLS = [
  { id: 'pencil', icon: 'pencil', key: 'p', kind: 'brush' },
  { id: 'eraser', icon: 'eraser', key: 'e', kind: 'brush' },
  { id: 'fill', icon: 'fill', key: 'f', kind: 'click' },
  { id: 'picker', icon: 'picker', key: 'i', kind: 'picker' },
  { id: 'lighten', icon: 'lighten', key: 'l', kind: 'brush', once: true },
  { id: 'darken', icon: 'darken', key: 'd', kind: 'brush', once: true },
  { id: 'noise', icon: 'noise', key: 'n', kind: 'brush', once: true },
  { id: 'replace', icon: 'replace', key: 'r', kind: 'click' },
];

export const TRANSPARENT = [0, 0, 0, 0];

/**
 * Transformaciones de color de cada pincel: (colorActual, estado) → colorNuevo.
 * @type {Record<string, (current:number[], s:{primary:number[], intensity:number}) => number[]>}
 */
const BRUSH_OPS = {
  pencil: (_c, s) => s.primary,
  eraser: () => TRANSPARENT,
  lighten: (c, s) => (c[3] === 0 ? c : shade(c, s.intensity * 0.45)),
  darken: (c, s) => (c[3] === 0 ? c : shade(c, -s.intensity * 0.45)),
  noise: (_c, s) => noise(s.primary, s.intensity),
};

/**
 * Genera los puntos de una línea entre dos píxeles (algoritmo de Bresenham).
 * @returns {Array<[number, number]>}
 */
export function linePoints(x0, y0, x1, y1) {
  const points = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    points.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return points;
}

export class ToolController {
  /**
   * @param {import('../core/skin-document.js').SkinDocument} doc
   * @param {import('./editor-state.js').EditorState} state
   * @param {{ notify?: (key:string, params?:object) => void }} [hooks]
   */
  constructor(doc, state, hooks = {}) {
    this.doc = doc;
    this.state = state;
    this.hooks = hooks;
    this.active = false;
    this.last = null;        // último píxel del trazo en curso
    this.lastEnd = null;     // último píxel del trazo anterior (para Mayús+clic)
    this.touched = new Set();
    this.toolId = null;
  }

  /** Herramienta seleccionada actualmente. */
  get tool() {
    return TOOLS.find((t) => t.id === this.state.get('tool')) ?? TOOLS[0];
  }

  /**
   * Inicia una acción sobre un píxel.
   * @param {{x:number, y:number, color?:number[]}} target Píxel (y color visible, si la vista lo sabe).
   * @param {{shift?:boolean, alt?:boolean}} [mods]
   */
  begin(target, mods = {}) {
    const tool = mods.alt ? TOOLS.find((t) => t.id === 'picker') : this.tool;
    this.toolId = tool.id;
    if (tool.kind === 'picker') {
      this._pick(target);
      this.active = true;
      return;
    }
    this.doc.beginStroke();
    this.touched.clear();
    this.active = true;
    if (tool.kind === 'click') {
      this._click(tool.id, target, mods);
      this._finish();
      return;
    }
    if (mods.shift && this.lastEnd && this._sameRegion(this.lastEnd, target)) {
      linePoints(this.lastEnd.x, this.lastEnd.y, target.x, target.y).forEach(([x, y]) => this._stamp(x, y));
    } else {
      this._stamp(target.x, target.y);
    }
    this.last = { x: target.x, y: target.y };
    this.doc.commitPreview();
  }

  /** Continúa el trazo al mover el cursor. */
  move(target) {
    if (!this.active) return;
    if (this.toolId === 'picker') { this._pick(target); return; }
    if (TOOLS.find((t) => t.id === this.toolId)?.kind !== 'brush') return;
    if (this.last && this.last.x === target.x && this.last.y === target.y) return;
    // Interpolar solo si ambos píxeles están en la misma cara (evita saltos entre zonas).
    if (this.last && this._sameRegion(this.last, target)) {
      linePoints(this.last.x, this.last.y, target.x, target.y).forEach(([x, y]) => this._stamp(x, y));
    } else {
      this._stamp(target.x, target.y);
    }
    this.last = { x: target.x, y: target.y };
    this.doc.commitPreview();
  }

  /** Termina el trazo. */
  end() {
    if (!this.active) return;
    this._finish();
  }

  _finish() {
    this.active = false;
    if (this.toolId !== 'picker') {
      this.doc.endStroke();
      if (['pencil', 'fill', 'replace', 'noise'].includes(this.toolId)) {
        this.state.addRecentColor(this.state.get('primary'));
      }
    }
    if (this.last) this.lastEnd = this.last;
    this.last = null;
  }

  /* ------------------------------ Internos ------------------------------ */

  _regionIndex(x, y) {
    return getRegionMap(this.doc.model).lookup[y * SKIN_WIDTH + x];
  }

  _sameRegion(a, b) {
    return this._regionIndex(a.x, a.y) === this._regionIndex(b.x, b.y);
  }

  /** Aplica el pincel (con su tamaño) centrado en un píxel. */
  _stamp(cx, cy) {
    const size = this.state.get('brushSize');
    const start = -Math.floor((size - 1) / 2);
    const region = this._regionIndex(cx, cy);
    for (let dy = start; dy < start + size; dy++) {
      for (let dx = start; dx < start + size; dx++) {
        const x = cx + dx, y = cy + dy;
        // El pincel no "se sale" de la cara donde empezó.
        if (!this.doc.inBounds(x, y) || this._regionIndex(x, y) !== region) continue;
        this._applyBrush(x, y);
      }
    }
  }

  /** Aplica la operación del pincel a un píxel y, en modo espejo, a su simétrico. */
  _applyBrush(x, y) {
    const targets = [y * SKIN_WIDTH + x];
    if (this.state.get('mirror')) {
      const m = getMirrorMap(this.doc.model)[targets[0]];
      if (m >= 0 && m !== targets[0]) targets.push(m);
    }
    const tool = TOOLS.find((t) => t.id === this.toolId);
    const op = BRUSH_OPS[this.toolId];
    const s = { primary: this.state.get('primary'), intensity: this.state.get('intensity') };
    for (const idx of targets) {
      if (tool.once && this.touched.has(idx)) continue;
      this.touched.add(idx);
      const px = idx % SKIN_WIDTH, py = Math.floor(idx / SKIN_WIDTH);
      this.doc.setPixel(px, py, op(this.doc.getPixel(px, py), s));
    }
  }

  /** Acciones de un solo clic: cubeta y reemplazo de color. */
  _click(toolId, { x, y }, mods) {
    const primary = this.state.get('primary');
    if (toolId === 'fill') {
      const starts = [y * SKIN_WIDTH + x];
      if (this.state.get('mirror')) {
        const m = getMirrorMap(this.doc.model)[starts[0]];
        if (m >= 0) starts.push(m);
      }
      starts.forEach((idx) => this._floodFill(idx % SKIN_WIDTH, Math.floor(idx / SKIN_WIDTH), primary, mods.shift));
    } else if (toolId === 'replace') {
      const count = this._replaceColor(x, y, primary);
      this.hooks.notify?.('toasts.replaced', { n: count });
    }
    this.last = { x, y };
  }

  /**
   * Relleno por inundación (4 vecinos) limitado a la cara del píxel inicial.
   * @param {boolean} wholeFace Si es true, rellena la cara completa sin mirar colores.
   */
  _floodFill(x, y, color, wholeFace = false) {
    const { lookup, regions } = getRegionMap(this.doc.model);
    const region = lookup[y * SKIN_WIDTH + x];
    if (wholeFace && region >= 0) {
      const r = regions[region].rect;
      for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) this.doc.setPixel(i, j, color);
      return;
    }
    const target = this.doc.getPixel(x, y);
    if (sameColor(target, color)) return;
    const stack = [[x, y]];
    const seen = new Uint8Array(SKIN_WIDTH * SKIN_HEIGHT);
    while (stack.length) {
      const [cx, cy] = stack.pop();
      if (!this.doc.inBounds(cx, cy)) continue;
      const idx = cy * SKIN_WIDTH + cx;
      if (seen[idx] || lookup[idx] !== region) continue;
      seen[idx] = 1;
      if (!sameColor(this.doc.getPixel(cx, cy), target)) continue;
      this.doc.setPixel(cx, cy, color);
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
  }

  /**
   * Reemplaza todos los píxeles del mismo color que (x, y) dentro de su capa.
   * @returns {number} Cantidad de píxeles cambiados.
   */
  _replaceColor(x, y, color) {
    const { lookup, regions } = getRegionMap(this.doc.model);
    const region = lookup[y * SKIN_WIDTH + x];
    if (region < 0) return 0;
    const layer = regions[region].layer;
    const target = this.doc.getPixel(x, y);
    let count = 0;
    for (let i = 0; i < lookup.length; i++) {
      if (lookup[i] < 0 || regions[lookup[i]].layer !== layer) continue;
      const px = i % SKIN_WIDTH, py = Math.floor(i / SKIN_WIDTH);
      if (sameColor(this.doc.getPixel(px, py), target) && this.doc.setPixel(px, py, color)) count++;
    }
    return count;
  }

  /** Cuentagotas: usa el color visible que informó la vista o el del píxel. */
  _pick({ x, y, color }) {
    const c = color ?? this.doc.getPixel(x, y);
    if (c[3] === 0) return; // no tomar píxeles vacíos
    this.state.set('primary', [...c]);
  }
}
