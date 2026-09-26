/**
 * @file clipboard.js
 * Copiar texto al portapapeles de forma robusta.
 *
 * Usa la API moderna (navigator.clipboard) y, si el navegador o el marco
 * donde corre la página la rechaza, recurre a un <textarea> temporal con
 * document.execCommand('copy'). Debe llamarse dentro de un clic del usuario.
 */

/**
 * @param {string} text
 * @returns {Promise<boolean>} true si se copió.
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}
