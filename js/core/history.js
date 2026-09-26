/**
 * @file history.js
 * Historial de deshacer/rehacer basado en instantáneas.
 *
 * Una skin ocupa solo 64 × 64 × 4 = 16 KB, así que guardar una copia completa
 * por cada trazo es simple, robusto y barato (100 pasos ≈ 1,6 MB).
 */
import { HISTORY_LIMIT } from '../config.js';

/**
 * @typedef {Object} Snapshot
 * @property {Uint8ClampedArray} pixels Copia de los píxeles RGBA.
 * @property {string} model Modelo de brazos en ese momento.
 */

export class History {
  /** @param {number} [limit] Máximo de pasos que se conservan. */
  constructor(limit = HISTORY_LIMIT) {
    this.limit = limit;
    /** @type {Snapshot[]} */ this.undoStack = [];
    /** @type {Snapshot[]} */ this.redoStack = [];
  }

  /**
   * Registra el estado ANTERIOR a un cambio. Borra la pila de rehacer,
   * porque una edición nueva crea una "rama" distinta de la historia.
   * @param {Snapshot} snapshot
   */
  push(snapshot) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /**
   * Deshace: recibe el estado actual y devuelve el estado a restaurar.
   * @param {Snapshot} current
   * @returns {Snapshot | null}
   */
  undo(current) {
    const prev = this.undoStack.pop();
    if (!prev) return null;
    this.redoStack.push(current);
    return prev;
  }

  /**
   * Rehace: recibe el estado actual y devuelve el estado a restaurar.
   * @param {Snapshot} current
   * @returns {Snapshot | null}
   */
  redo(current) {
    const next = this.redoStack.pop();
    if (!next) return null;
    this.undoStack.push(current);
    return next;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  /** Vacía todo el historial (por ejemplo, al abrir otra skin). */
  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}
