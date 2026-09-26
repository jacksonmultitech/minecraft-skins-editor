/**
 * @file emitter.js
 * Emisor de eventos mínimo (patrón observador).
 *
 * Permite que los módulos se comuniquen sin depender directamente unos de
 * otros: por ejemplo, el documento de la skin avisa "change" y tanto la
 * vista 3D como la 2D se redibujan.
 */
export class Emitter {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Suscribe una función a un evento.
   * @param {string} event Nombre del evento.
   * @param {Function} fn Función a ejecutar.
   * @returns {() => void} Función para cancelar la suscripción.
   */
  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  /** Cancela una suscripción. */
  off(event, fn) {
    this._listeners.get(event)?.delete(fn);
  }

  /**
   * Emite un evento con datos opcionales.
   * @param {string} event
   * @param {*} [payload]
   */
  emit(event, payload) {
    this._listeners.get(event)?.forEach((fn) => fn(payload));
  }
}
