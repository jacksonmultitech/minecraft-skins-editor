/**
 * @file picking.js
 * Selección por rayo ("ray casting"): determina qué píxel de la textura se
 * encuentra bajo el cursor en la vista 3D.
 *
 * Se hace en la CPU porque el modelo tiene solo 12 cajas: calcular la
 * intersección rayo–caja es instantáneo y evita leer píxeles de la GPU.
 */
import { invert, transformVec } from './math.js';
import { pointToTexel } from '../core/skin-model.js';

/** Cara que se atraviesa al entrar en la caja por cada eje y sentido. */
const ENTRY_FACE = {
  x: { pos: 'right', neg: 'left' },   // rayo hacia +X entra por la cara −X (derecha del personaje)
  y: { pos: 'bottom', neg: 'top' },
  z: { pos: 'back', neg: 'front' },
};

/**
 * Intersección de un rayo con una caja alineada a los ejes (método "slab").
 * @returns {{t:number, axis:'x'|'y'|'z', sign:'pos'|'neg'} | null}
 */
function intersectAABB(origin, dir, min, max) {
  let tMin = -Infinity;
  let tMax = Infinity;
  let axis = null;
  let sign = null;
  const names = ['x', 'y', 'z'];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (origin[i] < min[i] || origin[i] > max[i]) return null;
      continue;
    }
    let t1 = (min[i] - origin[i]) / dir[i];
    let t2 = (max[i] - origin[i]) / dir[i];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) {
      tMin = t1;
      axis = names[i];
      sign = dir[i] > 0 ? 'pos' : 'neg';
    }
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  // tMin < 0 significa que la cámara está dentro de la caja: se ignora.
  if (tMin < 0 || axis === null) return null;
  return { t: tMin, axis, sign };
}

/**
 * @typedef {Object} PickResult
 * @property {import('../core/skin-model.js').BoxInfo} box
 * @property {import('../core/skin-model.js').FaceInfo} face
 * @property {number} x Columna del píxel en la textura.
 * @property {number} y Fila del píxel en la textura.
 * @property {number} t Distancia a lo largo del rayo.
 */

/**
 * Devuelve todas las intersecciones del rayo, ordenadas de la más cercana a la más lejana.
 * @param {{origin:number[], dir:number[]}} ray Rayo en coordenadas del mundo.
 * @param {import('../core/skin-model.js').BoxInfo[]} boxes
 * @param {(box) => Float32Array} [matrixOf] Matriz de modelo de cada caja (pose).
 * @returns {PickResult[]}
 */
export function pickAll(ray, boxes, matrixOf) {
  const hits = [];
  for (const box of boxes) {
    let { origin, dir } = ray;
    const m = matrixOf?.(box);
    if (m) {
      // Llevar el rayo al espacio local de la caja (sin pose).
      const inv = invert(m);
      origin = transformVec(inv, origin, 1);
      dir = transformVec(inv, dir, 0);
    }
    const hit = intersectAABB(origin, dir, box.min, box.max);
    if (!hit) continue;
    const faceName = ENTRY_FACE[hit.axis][hit.sign];
    const face = box.faces.find((f) => f.name === faceName);
    const point = [0, 1, 2].map((k) => origin[k] + dir[k] * hit.t);
    const { x, y } = pointToTexel(face, point);
    hits.push({ box, face, x, y, t: hit.t });
  }
  return hits.sort((a, b) => a.t - b.t);
}

/**
 * Devuelve la primera intersección que cumpla la condición.
 * @param {{origin:number[], dir:number[]}} ray
 * @param {import('../core/skin-model.js').BoxInfo[]} boxes
 * @param {(hit: PickResult) => boolean} [accept]
 * @param {(box) => Float32Array} [matrixOf]
 * @returns {PickResult | null}
 */
export function pick(ray, boxes, accept = () => true, matrixOf) {
  return pickAll(ray, boxes, matrixOf).find(accept) ?? null;
}
