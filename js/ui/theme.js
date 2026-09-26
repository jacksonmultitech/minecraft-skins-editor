/**
 * @file theme.js
 * Tema claro/oscuro.
 *
 * - Por defecto sigue la preferencia del sistema (prefers-color-scheme).
 * - Si el usuario elige uno manualmente, se guarda y se aplica con
 *   el atributo <html data-theme="light|dark">.
 * - Los colores se definen como variables CSS en css/tokens.css.
 */
import { STORAGE_KEYS } from '../config.js';
import { loadJSON, saveJSON } from '../utils/storage.js';
import { Emitter } from '../utils/emitter.js';
import { hexToRgba } from '../utils/color.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');

export const themeEvents = new Emitter();

/** Tema efectivo actual: "light" o "dark". */
export function currentTheme() {
  return document.documentElement.dataset.theme || (media.matches ? 'dark' : 'light');
}

/** Aplica un tema y lo recuerda. */
export function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  saveJSON(STORAGE_KEYS.THEME, theme);
  themeEvents.emit('change', theme);
}

/** Alterna entre claro y oscuro. */
export function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

/** Restaura el tema guardado y escucha cambios del sistema. */
export function initTheme() {
  const saved = loadJSON(STORAGE_KEYS.THEME, null);
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
  media.addEventListener('change', () => {
    if (!loadJSON(STORAGE_KEYS.THEME, null)) themeEvents.emit('change', currentTheme());
  });
}

/**
 * Lee una variable CSS de color y la devuelve como [r, g, b] entre 0 y 1
 * (formato que necesita WebGL).
 * @param {string} name Nombre de la variable, p. ej. "--viewport-bg".
 */
export function readCssColor(name) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const rgba = hexToRgba(value) ?? [128, 128, 128, 255];
  return rgba.slice(0, 3).map((v) => v / 255);
}

/** Igual que readCssColor pero devuelve el texto CSS original. */
export function readCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
