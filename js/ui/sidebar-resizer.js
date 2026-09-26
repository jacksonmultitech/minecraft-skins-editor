/**
 * @file sidebar-resizer.js
 * Borde arrastrable para cambiar el ancho del panel lateral derecho.
 *
 * - Mouse/táctil: arrastrar el borde izquierdo del panel.
 * - Teclado (con el borde enfocado): ← ensancha, → angosta, Inicio/Fin =
 *   mínimo/máximo, Enter = ancho por defecto. Doble clic también restablece.
 * - El ancho se limita entre SIDEBAR_LIMITS.MIN y el máximo (que además
 *   nunca supera un porcentaje de la ventana, para no tapar el lienzo).
 * - El ancho elegido se recuerda en el navegador.
 *
 * Funciona cambiando la variable CSS --sidebar-w del contenedor .app.
 */
import { SIDEBAR_LIMITS, STORAGE_KEYS } from '../config.js';
import { loadJSON, saveJSON, removeKey } from '../utils/storage.js';
import { clamp } from '../utils/color.js';

export class SidebarResizer {
  /**
   * @param {HTMLElement} handle Elemento separador (role="separator").
   * @param {HTMLElement} app Contenedor con la cuadrícula principal.
   */
  constructor(handle, app) {
    this.handle = handle;
    this.app = app;
    this.sidebar = app.querySelector('.sidebar');
    this.width = null; // null = ancho por defecto definido en CSS

    const saved = loadJSON(STORAGE_KEYS.SIDEBAR_WIDTH, null);
    if (typeof saved === 'number') this.apply(saved, { save: false });
    this._bind();
    this._updateAria();
  }

  /** Ancho máximo permitido con el tamaño de ventana actual. */
  get maxWidth() {
    return Math.max(SIDEBAR_LIMITS.MIN, Math.min(SIDEBAR_LIMITS.MAX, window.innerWidth * SIDEBAR_LIMITS.MAX_VIEWPORT_RATIO));
  }

  /** Ancho real en pantalla. */
  get currentWidth() {
    return this.sidebar.getBoundingClientRect().width;
  }

  /**
   * Aplica un ancho (limitado a los márgenes permitidos).
   * @param {number} width En píxeles CSS.
   * @param {{ save?: boolean }} [options]
   */
  apply(width, { save = true } = {}) {
    this.width = Math.round(clamp(width, SIDEBAR_LIMITS.MIN, this.maxWidth));
    this.app.style.setProperty('--sidebar-w', `${this.width}px`);
    if (save) saveJSON(STORAGE_KEYS.SIDEBAR_WIDTH, this.width);
    this._updateAria();
  }

  /** Vuelve al ancho por defecto (definido en tokens.css). */
  reset() {
    this.width = null;
    this.app.style.removeProperty('--sidebar-w');
    removeKey(STORAGE_KEYS.SIDEBAR_WIDTH);
    this._updateAria();
  }

  _updateAria() {
    const h = this.handle;
    h.setAttribute('aria-valuemin', String(SIDEBAR_LIMITS.MIN));
    h.setAttribute('aria-valuemax', String(Math.round(this.maxWidth)));
    // Se lee en el siguiente cuadro para obtener el ancho ya aplicado.
    requestAnimationFrame(() => h.setAttribute('aria-valuenow', String(Math.round(this.currentWidth))));
  }

  _bind() {
    const h = this.handle;
    let start = null;

    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      start = { x: e.clientX, width: this.currentWidth };
      document.body.classList.add('is-resizing-sidebar');
    });
    h.addEventListener('pointermove', (e) => {
      if (!start) return;
      // El panel está a la derecha: mover el borde a la izquierda lo ensancha.
      this.apply(start.width - (e.clientX - start.x), { save: false });
    });
    const end = () => {
      if (!start) return;
      start = null;
      document.body.classList.remove('is-resizing-sidebar');
      if (this.width !== null) saveJSON(STORAGE_KEYS.SIDEBAR_WIDTH, this.width);
    };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
    h.addEventListener('dblclick', () => this.reset());

    h.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? SIDEBAR_LIMITS.STEP * 4 : SIDEBAR_LIMITS.STEP;
      const actions = {
        ArrowLeft: () => this.apply(this.currentWidth + step),
        ArrowRight: () => this.apply(this.currentWidth - step),
        Home: () => this.apply(SIDEBAR_LIMITS.MIN),
        End: () => this.apply(this.maxWidth),
        Enter: () => this.reset(),
      };
      if (!actions[e.key]) return;
      e.preventDefault();
      e.stopPropagation();
      actions[e.key]();
    });

    // Si la ventana se achica, el ancho guardado se vuelve a limitar.
    window.addEventListener('resize', () => {
      if (this.width !== null) this.apply(this.width, { save: false });
      else this._updateAria();
    });
  }
}
