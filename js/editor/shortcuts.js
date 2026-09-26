/**
 * @file shortcuts.js
 * Atajos de teclado globales. La lista visible para el usuario está en
 * i18n (help.items); si agregas un atajo aquí, documéntalo también allá.
 */
import { TOOLS } from './tools.js';
import { isTyping } from '../utils/keyboard.js';
import { LAYER } from '../config.js';

/**
 * Registra los atajos.
 * @param {import('../main.js').App} app
 */
export function registerShortcuts(app) {
  const { state } = app;
  const toolByKey = Object.fromEntries(TOOLS.map((tool) => [tool.key, tool.id]));
  const views = { 1: 'front', 2: 'back', 3: 'right', 4: 'left', 5: 'top', 6: 'bottom' };

  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target) || document.querySelector('dialog[open]')) return;
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;

    // --- Combinaciones con Ctrl/Cmd ---
    if (mod) {
      if (key === 'z' && !e.shiftKey) { e.preventDefault(); app.undo(); }
      else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); app.redo(); }
      else if (key === 's') { e.preventDefault(); app.download(); }
      else if (key === 'o') { e.preventDefault(); app.openFileDialog(); }
      return;
    }
    if (e.altKey) return;

    // --- Teclas simples ---
    if (toolByKey[key]) { state.set('tool', toolByKey[key]); return; }
    if (views[key] && state.get('viewMode') === '3d') { app.viewport3d?.setView(views[key]); return; }
    switch (key) {
      case '0': app.resetView(); break;
      case 'x': state.swapColors(); break;
      case 'm': state.toggle('mirror'); break;
      case 'g': state.toggle('grid'); break;
      case 'v': state.set('viewMode', state.get('viewMode') === '3d' ? '2d' : '3d'); break;
      case 'o': state.setLayerVisibility(LAYER.OVERLAY, !state.isLayerVisible(LAYER.OVERLAY)); break;
      case '[': state.set('brushSize', Math.max(1, state.get('brushSize') - 1)); break;
      case ']': state.set('brushSize', Math.min(3, state.get('brushSize') + 1)); break;
      case '+': case '=': app.zoom(0.85); break;
      case '-': app.zoom(1 / 0.85); break;
      case 'c':
        state.set('activeLayer', state.get('activeLayer') === LAYER.BASE ? LAYER.OVERLAY : LAYER.BASE);
        break;
      case 'arrowleft': case 'arrowright': case 'arrowup': case 'arrowdown': {
        // Las flechas giran la cámara solo si el foco está en la vista 3D o en el cuerpo de la página.
        if (state.get('viewMode') !== '3d') return;
        const el = document.activeElement;
        if (el && el !== document.body && el.id !== 'canvas-3d') return;
        e.preventDefault();
        const step = 0.15;
        const d = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, step], arrowdown: [0, -step] }[key];
        app.viewport3d?.rotateBy(d[0], d[1]);
        break;
      }
      default:
        break;
    }
  });
}
