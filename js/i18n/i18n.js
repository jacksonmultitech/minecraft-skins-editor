/**
 * @file i18n.js
 * Sistema de internacionalización mínimo.
 *
 *  - t('menu.open')                → "Abrir"
 *  - t('toasts.loaded', {name})    → "Skin cargada: steve.png"
 *  - applyTranslations(document)   → rellena los elementos con atributos:
 *      data-i18n="clave"           (texto)
 *      data-i18n-title="clave"     (atributos title y aria-label)
 *      data-i18n-placeholder="clave"
 */
import esLA from './es-419.js';

const LOCALES = { 'es-419': esLA };
let current = LOCALES['es-419'];

/** Cambia el idioma activo (por ahora solo existe es-419). */
export function setLocale(code) {
  current = LOCALES[code] ?? current;
  document.documentElement.lang = code;
}

/**
 * Obtiene un texto traducido.
 * @param {string} key Ruta con puntos, p. ej. "tools.pencil".
 * @param {Record<string, string|number>} [params] Valores para reemplazar {llaves}.
 * @returns {*} El texto (o el valor original si es un objeto/arreglo).
 */
export function t(key, params) {
  const value = key.split('.').reduce((obj, k) => (obj == null ? undefined : obj[k]), current);
  if (value === undefined) {
    console.warn(`[i18n] Falta la clave: ${key}`);
    return key;
  }
  if (typeof value !== 'string' || !params) return value;
  return value.replace(/\{(\w+)\}/g, (_, name) => (name in params ? String(params[name]) : `{${name}}`));
}

/**
 * Traduce todos los elementos marcados dentro de `root`.
 * @param {ParentNode} root
 */
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const text = t(el.dataset.i18nTitle);
    el.title = text;
    // Los botones que solo tienen ícono necesitan un nombre accesible.
    if (!el.textContent.trim()) el.setAttribute('aria-label', text);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
}
