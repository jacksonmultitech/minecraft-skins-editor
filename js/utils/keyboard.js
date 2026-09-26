/**
 * @file keyboard.js
 * Seguimiento de teclas mantenidas (por ejemplo, Espacio para desplazar la
 * vista) y utilidades relacionadas con el foco.
 */
const held = new Set();

/** ¿El foco está en un campo de texto? (en ese caso no se usan atajos). */
export function isTyping(target = document.activeElement) {
  if (!target) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT'
    || (tag === 'INPUT' && !['checkbox', 'radio', 'range', 'button'].includes(target.type));
}

window.addEventListener('keydown', (e) => {
  if (!isTyping(e.target)) held.add(e.code);
});
window.addEventListener('keyup', (e) => held.delete(e.code));
window.addEventListener('blur', () => held.clear());

/** ¿Está presionada la tecla (código físico, p. ej. "Space")? */
export const isHeld = (code) => held.has(code);
