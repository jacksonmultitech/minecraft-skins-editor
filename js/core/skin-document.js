/**
 * @file skin-document.js
 * Modelo de datos de la skin que se está editando.
 *
 * Guarda los píxeles RGBA (64×64), el modelo de brazos y el historial.
 * Todas las modificaciones pasan por aquí, lo que garantiza que:
 *  - las vistas se actualicen (evento "change"),
 *  - cada trazo quede registrado para deshacer/rehacer,
 *  - el autoguardado sepa cuándo hay cambios.
 *
 * Eventos emitidos:
 *  - "change"  → { reason: string }   los píxeles cambiaron
 *  - "model"   → { model: string }    cambió el modelo de brazos
 *  - "history" → { canUndo, canRedo } cambió el estado del historial
 */
import { SKIN_WIDTH, SKIN_HEIGHT, MODEL } from '../config.js';
import { Emitter } from '../utils/emitter.js';
import { History } from './history.js';

export class SkinDocument extends Emitter {
  constructor() {
    super();
    /** Píxeles RGBA; índice = (y * 64 + x) * 4. */
    this.pixels = new Uint8ClampedArray(SKIN_WIDTH * SKIN_HEIGHT * 4);
    /** Modelo de brazos actual. */
    this.model = MODEL.CLASSIC;
    /** Nombre sugerido para el archivo al descargar. */
    this.name = 'mi-skin';
    this.history = new History();
    /** Copia tomada al iniciar un trazo (null si no hay trazo en curso). */
    this._strokeSnapshot = null;
    this._strokeChanged = false;
  }

  /* ---------------------------- Lectura ---------------------------- */

  /** @returns {boolean} true si (x, y) está dentro de la textura. */
  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < SKIN_WIDTH && y < SKIN_HEIGHT;
  }

  /** Devuelve el color RGBA de un píxel como arreglo [r,g,b,a]. */
  getPixel(x, y) {
    const i = (y * SKIN_WIDTH + x) * 4;
    const p = this.pixels;
    return [p[i], p[i + 1], p[i + 2], p[i + 3]];
  }

  /* ------------------------- Escritura ----------------------------- */

  /**
   * Cambia un píxel. Debe llamarse entre beginStroke() y endStroke() para
   * que el cambio quede en el historial.
   * @returns {boolean} true si el píxel realmente cambió.
   */
  setPixel(x, y, [r, g, b, a]) {
    if (!this.inBounds(x, y)) return false;
    const i = (y * SKIN_WIDTH + x) * 4;
    const p = this.pixels;
    if (p[i] === r && p[i + 1] === g && p[i + 2] === b && p[i + 3] === a) return false;
    p[i] = r; p[i + 1] = g; p[i + 2] = b; p[i + 3] = a;
    this._strokeChanged = true;
    return true;
  }

  /** Inicia un trazo: guarda una instantánea para poder deshacerlo. */
  beginStroke() {
    if (this._strokeSnapshot) return; // ya hay uno en curso
    this._strokeSnapshot = this.snapshot();
    this._strokeChanged = false;
  }

  /**
   * Notifica que hubo cambios durante un trazo (redibujado en vivo).
   * @param {string} [reason]
   */
  commitPreview(reason = 'stroke') {
    this.emit('change', { reason });
  }

  /** Finaliza el trazo y, si hubo cambios, lo agrega al historial. */
  endStroke() {
    if (!this._strokeSnapshot) return;
    if (this._strokeChanged) {
      this.history.push(this._strokeSnapshot);
      this.emit('change', { reason: 'stroke-end' });
      this._emitHistory();
    }
    this._strokeSnapshot = null;
    this._strokeChanged = false;
  }

  /**
   * Ejecuta una operación completa (p. ej. "limpiar capa") como un solo paso
   * del historial.
   * @param {(doc: SkinDocument) => void} fn
   */
  transaction(fn) {
    this.beginStroke();
    fn(this);
    // La operación pudo escribir directamente en `pixels` (sin setPixel):
    // se compara con la instantánea para saber si hubo cambios reales.
    const before = this._strokeSnapshot.pixels;
    if (!this._strokeChanged && before.some((v, i) => v !== this.pixels[i])) this._strokeChanged = true;
    this.endStroke(); // emite "change" solo si algo cambió
  }

  /* ---------------------- Estado completo -------------------------- */

  /** @returns {{pixels: Uint8ClampedArray, model: string}} copia del estado. */
  snapshot() {
    return { pixels: new Uint8ClampedArray(this.pixels), model: this.model };
  }

  /** Restaura una instantánea sin tocar el historial. */
  _restore(snap) {
    this.pixels.set(snap.pixels);
    const modelChanged = snap.model !== this.model;
    this.model = snap.model;
    if (modelChanged) this.emit('model', { model: this.model });
    this.emit('change', { reason: 'restore' });
  }

  /**
   * Reemplaza la skin completa (al abrir un archivo o crear una nueva).
   * @param {Uint8ClampedArray} pixels
   * @param {string} model
   * @param {{ keepHistory?: boolean }} [options] Si keepHistory es true, el
   *   cambio se puede deshacer; si no, se reinicia el historial.
   */
  load(pixels, model, { keepHistory = true } = {}) {
    if (keepHistory) this.history.push(this.snapshot());
    else this.history.clear();
    this._restore({ pixels, model });
    this._emitHistory();
  }

  /**
   * Cambia el modelo de brazos, opcionalmente transformando la textura.
   * @param {string} model
   * @param {(pixels: Uint8ClampedArray, from: string, to: string) => void} [transform]
   */
  setModel(model, transform) {
    if (model === this.model) return;
    this.history.push(this.snapshot());
    const from = this.model;
    if (transform) transform(this.pixels, from, model);
    this.model = model;
    this.emit('model', { model });
    this.emit('change', { reason: 'model' });
    this._emitHistory();
  }

  /* --------------------------- Historial --------------------------- */

  undo() {
    const snap = this.history.undo(this.snapshot());
    if (snap) this._restore(snap);
    this._emitHistory();
    return Boolean(snap);
  }

  redo() {
    const snap = this.history.redo(this.snapshot());
    if (snap) this._restore(snap);
    this._emitHistory();
    return Boolean(snap);
  }

  _emitHistory() {
    this.emit('history', { canUndo: this.history.canUndo, canRedo: this.history.canRedo });
  }
}
