/**
 * @file dialogs.js
 * Ventanas modales basadas en el elemento nativo <dialog>
 * (gestiona el foco, la tecla Esc y el fondo automáticamente).
 */
import { t } from '../i18n/i18n.js';

/**
 * Pide confirmación al usuario.
 * @param {object} options
 * @param {string} options.title
 * @param {string} options.body
 * @param {string} [options.confirmText]
 * @param {boolean} [options.danger] Estilo de acción destructiva.
 * @returns {Promise<boolean>}
 */
export function confirmDialog({ title, body, confirmText = t('dialogs.accept'), danger = false }) {
  const dialog = document.getElementById('dialog-confirm');
  dialog.querySelector('[data-slot="title"]').textContent = title;
  dialog.querySelector('[data-slot="body"]').textContent = body;
  const ok = dialog.querySelector('[data-action="confirm"]');
  ok.textContent = confirmText;
  ok.classList.toggle('btn--danger', danger);
  ok.classList.toggle('btn--primary', !danger);
  dialog.returnValue = '';
  dialog.showModal();
  ok.focus();
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true });
  });
}

/**
 * Muestra un diálogo informativo con una lista de elementos.
 * @param {string} id Id del <dialog>.
 * @param {string} title
 * @param {Array<{text:string, type?:string}>} items
 */
export function infoDialog(id, title, items) {
  const dialog = document.getElementById(id);
  dialog.querySelector('[data-slot="title"]').textContent = title;
  const list = dialog.querySelector('[data-slot="list"]');
  list.replaceChildren(...items.map(({ text, type = 'info' }) => {
    const li = document.createElement('li');
    li.className = `report__item report__item--${type}`;
    li.textContent = text;
    return li;
  }));
  dialog.showModal();
}

/**
 * Construye el contenido del diálogo de atajos a partir de i18n.
 * @param {HTMLElement} container
 */
export function renderShortcuts(container) {
  const sections = t('help.sections');
  const items = t('help.items');
  container.replaceChildren(...Object.entries(sections).map(([key, title]) => {
    const section = document.createElement('section');
    section.className = 'shortcuts__section';
    const h = document.createElement('h3');
    h.textContent = title;
    const dl = document.createElement('dl');
    dl.className = 'shortcuts__list';
    items.filter(([group]) => group === key).forEach(([, keys, desc]) => {
      const dt = document.createElement('dt');
      keys.split(' · ').forEach((k) => {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        dt.append(kbd);
      });
      const dd = document.createElement('dd');
      dd.textContent = desc;
      dl.append(dt, dd);
    });
    section.append(h, dl);
    return section;
  }));
}

/** Cierra un diálogo al hacer clic en su fondo. */
export function enableBackdropClose(dialog) {
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
