/**
 * @file transforms.js
 * Operaciones que modifican zonas completas de la skin: limpiar capas,
 * reflejar un lado sobre el otro y adaptar los brazos entre modelos.
 *
 * Todas trabajan directamente sobre el arreglo de píxeles; quien las llama
 * debe envolverlas en `doc.transaction()` para que se puedan deshacer.
 */
import { SKIN_WIDTH } from '../config.js';
import { getBoxes, getRegionMap, getMirrorMap, getSideMap, ARM_PARTS } from './skin-model.js';

/**
 * Borra (vuelve transparentes) todos los píxeles de una capa.
 * Si se indica `parts`, solo borra esas partes.
 * @param {Uint8ClampedArray} pixels
 * @param {string} model
 * @param {string} layer
 * @param {string[]} [parts]
 */
export function clearLayer(pixels, model, layer, parts) {
  const { lookup, regions } = getRegionMap(model);
  for (let i = 0; i < lookup.length; i++) {
    const r = regions[lookup[i]];
    if (r && r.layer === layer && (!parts || parts.includes(r.part))) pixels.fill(0, i * 4, i * 4 + 4);
  }
}

/**
 * Copia un lado del personaje sobre el otro de forma simétrica.
 * @param {Uint8ClampedArray} pixels
 * @param {string} model
 * @param {'rightToLeft'|'leftToRight'} direction
 * @param {string|null} [layer] Si se indica, solo afecta a esa capa.
 */
export function mirrorSide(pixels, model, direction, layer = null) {
  const mirror = getMirrorMap(model);
  const sides = getSideMap(model);
  const { lookup, regions } = getRegionMap(model);
  const sourceSide = direction === 'rightToLeft' ? -1 : 1;
  const copy = new Uint8ClampedArray(pixels);
  for (let i = 0; i < mirror.length; i++) {
    if (sides[i] !== sourceSide || mirror[i] < 0) continue;
    if (layer && regions[lookup[i]].layer !== layer) continue;
    pixels.set(copy.subarray(i * 4, i * 4 + 4), mirror[i] * 4);
  }
}

/**
 * Adapta la textura de los brazos al cambiar entre modelo clásico (4 px) y
 * delgado (3 px), para que el diseño no quede desplazado.
 *
 * Cada cara del modelo destino se rellena muestreando la cara equivalente
 * del modelo origen (reduciendo o duplicando columnas).
 * @param {Uint8ClampedArray} pixels
 * @param {string} from Modelo actual.
 * @param {string} to Modelo nuevo.
 */
export function convertArms(pixels, from, to) {
  const src = new Uint8ClampedArray(pixels);
  const srcBoxes = getBoxes(from).filter((b) => ARM_PARTS.includes(b.part));
  const dstBoxes = getBoxes(to).filter((b) => ARM_PARTS.includes(b.part));

  // 1) Borrar la zona que ocupaban los brazos en el modelo de origen.
  for (const box of srcBoxes) {
    for (const { rect } of box.faces) {
      for (let y = rect.y; y < rect.y + rect.h; y++) pixels.fill(0, (y * SKIN_WIDTH + rect.x) * 4, (y * SKIN_WIDTH + rect.x + rect.w) * 4);
    }
  }

  // 2) Rellenar cada cara destino a partir de la cara equivalente.
  const mapIndex = (i, dstLen, srcLen) => (dstLen <= 1 ? 0 : Math.round((i * (srcLen - 1)) / (dstLen - 1)));
  for (const dstBox of dstBoxes) {
    const srcBox = srcBoxes.find((b) => b.key === dstBox.key);
    for (const dstFace of dstBox.faces) {
      const s = srcBox.faces.find((f) => f.name === dstFace.name).rect;
      const d = dstFace.rect;
      for (let j = 0; j < d.h; j++) {
        for (let i = 0; i < d.w; i++) {
          const si = mapIndex(i, d.w, s.w);
          const sj = mapIndex(j, d.h, s.h);
          const from4 = ((s.y + sj) * SKIN_WIDTH + s.x + si) * 4;
          pixels.set(src.subarray(from4, from4 + 4), ((d.y + j) * SKIN_WIDTH + d.x + i) * 4);
        }
      }
    }
  }
}
