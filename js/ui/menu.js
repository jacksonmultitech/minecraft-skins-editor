/**
 * @file menu.js
 * Menú desplegable accesible reutilizable: un botón que abre/cierra una
 * lista de opciones. Se cierra al hacer clic fuera o con Esc.
 */

/**
 * @param {HTMLButtonElement} button Botón que abre el menú (aria-controls → lista).
 * @param {HTMLElement} list Contenedor [role=menu] con botones [data-value].
 * @param {(value: string) => void} onSelect Se llama con el data-value elegido.
 */
export function bindMenu(button, list, onSelect) {
  const close = () => {
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = list.hidden;
    // Cerrar cualquier otro menú abierto antes de abrir este.
    document.querySelectorAll('.menu__list:not([hidden])').forEach((m) => { if (m !== list) m.hidden = true; });
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) list.querySelector('button:not([hidden])')?.focus();
  });
  document.addEventListener('click', close);
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      close();
      button.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      // Navegación con flechas entre las opciones visibles.
      e.preventDefault();
      const items = [...list.querySelectorAll('button:not([hidden])')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    }
  });
  list.addEventListener('click', (e) => {
    const item = e.target.closest('[data-value]');
    if (item) onSelect(item.dataset.value);
  });
  return { close };
}
