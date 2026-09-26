/**
 * @file gestures.js
 * Seguimiento de varios punteros para gestos táctiles de dos dedos
 * (pellizcar para zoom y arrastrar para desplazar).
 */
export class PinchTracker {
  constructor() {
    /** @type {Map<number, {x:number, y:number}>} */
    this.pointers = new Map();
    this._last = null;
  }

  /** Cantidad de punteros activos. */
  get count() {
    return this.pointers.size;
  }

  /** Registra un puntero nuevo. */
  down(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._last = this._measure();
  }

  /**
   * Actualiza un puntero. Si hay dos activos, devuelve el cambio del gesto.
   * @returns {{ scale:number, dx:number, dy:number, cx:number, cy:number } | null}
   *   scale > 1 significa que los dedos se separaron (acercar).
   */
  move(e) {
    if (!this.pointers.has(e.pointerId)) return null;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size !== 2) return null;
    const now = this._measure();
    const prev = this._last ?? now;
    this._last = now;
    return {
      scale: prev.dist > 0 ? now.dist / prev.dist : 1,
      dx: now.cx - prev.cx,
      dy: now.cy - prev.cy,
      cx: now.cx,
      cy: now.cy,
    };
  }

  /** Elimina un puntero. */
  up(e) {
    this.pointers.delete(e.pointerId);
    this._last = this._measure();
  }

  _measure() {
    if (this.pointers.size < 2) return null;
    const [a, b] = [...this.pointers.values()];
    return { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  }
}
