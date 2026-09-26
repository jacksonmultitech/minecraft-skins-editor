/**
 * @file toast.js
 * Notificaciones breves ("toasts") en la esquina de la pantalla.
 * El contenedor usa aria-live para que los lectores de pantalla las anuncien.
 */
let container = null;

/** @param {HTMLElement} element Contenedor de las notificaciones. */
export function initToasts(element) {
  container = element;
}

/**
 * Muestra una notificación.
 * @param {string} message Texto ya traducido.
 * @param {'info'|'success'|'warning'|'error'} [type='info']
 * @param {number} [duration=2800] Milisegundos visibles.
 */
export function toast(message, type = 'info', duration = 2800) {
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message;
  container.appendChild(el);
  // Forzar el reflujo para que la transición de entrada se active.
  requestAnimationFrame(() => el.classList.add('is-visible'));
  setTimeout(() => {
    el.classList.remove('is-visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 500); // respaldo si no hay transición
  }, duration);
}
