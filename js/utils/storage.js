/**
 * @file storage.js
 * Acceso seguro a localStorage.
 *
 * En modo incógnito, con cookies bloqueadas o dentro de algunos iframes,
 * localStorage puede no existir o lanzar excepciones. Estas funciones
 * nunca lanzan errores: si algo falla, simplemente devuelven el valor
 * por defecto y la aplicación sigue funcionando.
 */

/**
 * Lee y decodifica un valor JSON.
 * @template T
 * @param {string} key
 * @param {T} fallback Valor devuelto si no existe o hay error.
 * @returns {T}
 */
export function loadJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Guarda un valor como JSON.
 * @param {string} key
 * @param {*} value
 * @returns {boolean} `true` si se pudo guardar.
 */
export function saveJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Elimina una clave. */
export function removeKey(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* Sin almacenamiento disponible: no hay nada que borrar. */
  }
}
