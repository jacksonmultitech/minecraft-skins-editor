/**
 * @file layers-panel.js
 * Panel de visibilidad: dos "muñequitos" (capa base y capa externa) donde
 * cada parte del cuerpo es un botón que la muestra u oculta.
 *
 * Nota: el muñeco se ve de frente, así que el brazo DERECHO del personaje
 * aparece a la IZQUIERDA de la pantalla (igual que en el juego).
 */
import { t } from '../i18n/i18n.js';
import { LAYER } from '../config.js';
import { PART } from '../core/skin-model.js';
import { icon } from './icons.js';

/** Posición de cada parte en la cuadrícula CSS del muñeco. */
const FIGURE = [
  { part: PART.HEAD, area: 'head' },
  { part: PART.RIGHT_ARM, area: 'rarm' },
  { part: PART.BODY, area: 'body' },
  { part: PART.LEFT_ARM, area: 'larm' },
  { part: PART.RIGHT_LEG, area: 'rleg' },
  { part: PART.LEFT_LEG, area: 'lleg' },
];

export class LayersPanel {
  /**
   * @param {HTMLElement} root
   * @param {{ state: import('../editor/editor-state.js').EditorState }} deps
   */
  constructor(root, { state }) {
    this.root = root;
    this.state = state;
    this.figures = root.querySelector('#layer-figures');
    this._build();
    root.querySelector('#btn-show-all').addEventListener('click', () => {
      this.state.setLayerVisibility(LAYER.BASE, true);
      this.state.setLayerVisibility(LAYER.OVERLAY, true);
    });
    this.sync();
  }

  _build() {
    this.figures.replaceChildren(...[LAYER.BASE, LAYER.OVERLAY].map((layer) => {
      const wrap = document.createElement('div');
      wrap.className = 'figure';
      wrap.dataset.layer = layer;

      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'figure__title';
      title.dataset.layerToggle = layer;
      title.textContent = t(`layers.${layer}`);
      title.title = t(`layers.${layer}Long`);

      const body = document.createElement('div');
      body.className = 'figure__body';
      body.setAttribute('role', 'group');
      body.setAttribute('aria-label', t(`layers.${layer}Long`));
      for (const { part, area } of FIGURE) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'figure__part';
        b.style.gridArea = area;
        b.dataset.part = part;
        b.dataset.layer = layer;
        const label = `${t(`parts.${part}`)} · ${t(`layers.${layer}`)}`;
        b.title = label;
        b.setAttribute('aria-label', label);
        body.append(b);
      }
      // Botón para ocultar o mostrar la capa completa de una vez.
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'btn btn--small figure__toggle';
      toggle.dataset.layerToggle = layer;

      wrap.append(title, body, toggle);
      return wrap;
    }));

    this.figures.addEventListener('click', (e) => {
      const partBtn = e.target.closest('[data-part]');
      if (partBtn) {
        this.state.setVisibility(partBtn.dataset.part, partBtn.dataset.layer);
        return;
      }
      const layerBtn = e.target.closest('[data-layer-toggle]');
      if (layerBtn) {
        const layer = layerBtn.dataset.layerToggle;
        this.state.setLayerVisibility(layer, !this.state.isLayerVisible(layer));
      }
    });
  }

  /** Refleja en los botones el estado de visibilidad y la capa activa. */
  sync() {
    const vis = this.state.get('visibility');
    const active = this.state.get('activeLayer');
    this.figures.querySelectorAll('[data-part]').forEach((b) => {
      const on = vis[b.dataset.part][b.dataset.layer];
      b.setAttribute('aria-pressed', String(on));
    });
    this.figures.querySelectorAll('.figure').forEach((f) => {
      const layer = f.dataset.layer;
      f.classList.toggle('is-active', layer === active);
      // El botón muestra la acción disponible: ocultar si algo se ve, mostrar si todo está oculto.
      const visible = this.state.isLayerVisible(layer);
      f.classList.toggle('is-hidden', !visible);
      const toggle = f.querySelector('.figure__toggle');
      const layerName = t(`layerNames.${layer}`).toLowerCase();
      toggle.innerHTML = `${icon(visible ? 'eyeOff' : 'eye', 16)}<span>${t(visible ? 'layers.hideLayer' : 'layers.showLayer')}</span>`;
      toggle.title = t(visible ? 'layers.hideLayerTitle' : 'layers.showLayerTitle', { layer: layerName });
    });
  }
}
