/**
 * @file toolbar.js
 * Barra de herramientas lateral y barra de opciones superior.
 * Genera los botones a partir del catálogo TOOLS, así que agregar una
 * herramienta no requiere tocar el HTML.
 */
import { t } from '../i18n/i18n.js';
import { icon } from './icons.js';
import { TOOLS } from '../editor/tools.js';

export class Toolbar {
  /**
   * @param {object} deps
   * @param {import('../editor/editor-state.js').EditorState} deps.state
   * @param {import('../core/skin-document.js').SkinDocument} deps.doc
   */
  constructor({ state, doc }) {
    this.state = state;
    this.doc = doc;
    this.toolGroup = document.getElementById('tool-buttons');
    this._buildTools();
    this._bindOptions();
    this.sync();
  }

  _buildTools() {
    this.toolGroup.replaceChildren(...TOOLS.map((tool) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool-btn';
      b.dataset.tool = tool.id;
      b.setAttribute('role', 'radio');
      const name = t(`tools.${tool.id}`);
      const label = `${name} (${tool.key.toUpperCase()})`;
      b.setAttribute('aria-label', label);
      b.title = `${label}\n${t(`tools.hints.${tool.id}`)}`;
      b.innerHTML = `${icon(tool.icon, 22)}<span class="tool-btn__key" aria-hidden="true">${tool.key.toUpperCase()}</span>`;
      return b;
    }));
    this.toolGroup.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tool]');
      if (b) this.state.set('tool', b.dataset.tool);
    });
    // Navegación con flechas dentro del grupo (patrón "radiogroup" accesible).
    this.toolGroup.addEventListener('keydown', (e) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const ids = TOOLS.map((x) => x.id);
      const i = ids.indexOf(this.state.get('tool'));
      const next = ids[(i + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1) + ids.length) % ids.length];
      this.state.set('tool', next);
      this.toolGroup.querySelector(`[data-tool="${next}"]`).focus();
    });
  }

  _bindOptions() {
    const on = (id, event, fn) => document.getElementById(id).addEventListener(event, fn);
    on('btn-undo', 'click', () => this.doc.undo());
    on('btn-redo', 'click', () => this.doc.redo());
    on('btn-mirror', 'click', () => this.state.toggle('mirror'));
    on('btn-grid', 'click', () => this.state.toggle('grid'));
    on('opt-dim', 'change', (e) => this.state.set('dimInactive', e.target.checked));
    on('opt-intensity', 'input', (e) => this.state.set('intensity', Number(e.target.value) / 100));

    // Controles segmentados: [data-value] dentro de un contenedor [data-key].
    document.querySelectorAll('.segmented[data-key]').forEach((group) => {
      group.addEventListener('click', (e) => {
        const b = e.target.closest('[data-value]');
        if (!b) return;
        const raw = b.dataset.value;
        const value = /^\d+$/.test(raw) ? Number(raw) : raw;
        this.state.set(group.dataset.key, value);
      });
    });
  }

  /** Actualiza todos los controles según el estado. */
  sync() {
    const s = this.state;
    this.toolGroup.querySelectorAll('[data-tool]').forEach((b) => {
      const active = b.dataset.tool === s.get('tool');
      b.setAttribute('aria-checked', String(active));
      b.tabIndex = active ? 0 : -1;
    });
    document.getElementById('btn-mirror').setAttribute('aria-pressed', String(s.get('mirror')));
    document.getElementById('btn-grid').setAttribute('aria-pressed', String(s.get('grid')));
    document.getElementById('opt-dim').checked = s.get('dimInactive');
    const intensity = document.getElementById('opt-intensity');
    intensity.value = String(Math.round(s.get('intensity') * 100));
    document.getElementById('opt-intensity-value').textContent = `${intensity.value}%`;
    // La intensidad solo aplica a aclarar, oscurecer y ruido.
    document.getElementById('opt-intensity-wrap').classList.toggle('is-disabled',
      !['lighten', 'darken', 'noise'].includes(s.get('tool')));

    document.querySelectorAll('.segmented[data-key]').forEach((group) => {
      const current = String(s.get(group.dataset.key));
      group.querySelectorAll('[data-value]').forEach((b) => {
        b.setAttribute('aria-pressed', String(b.dataset.value === current));
      });
    });
  }

  /** Habilita o deshabilita deshacer/rehacer. */
  setHistory({ canUndo, canRedo }) {
    document.getElementById('btn-undo').disabled = !canUndo;
    document.getElementById('btn-redo').disabled = !canRedo;
  }
}
