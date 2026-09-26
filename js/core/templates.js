/**
 * @file templates.js
 * Skins iniciales generadas por código (no se incluye ninguna imagen con
 * derechos de autor). Sirven como punto de partida para editar.
 */
import { SKIN_WIDTH, SKIN_HEIGHT, MODEL, LAYER } from '../config.js';
import { getBoxes, PART } from './skin-model.js';
import { hexToRgba, shade } from '../utils/color.js';

/** Generador pseudoaleatorio con semilla (resultados reproducibles). */
function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Skin vacía: todos los píxeles transparentes. */
export function createBlankSkin() {
  return { pixels: new Uint8ClampedArray(SKIN_WIDTH * SKIN_HEIGHT * 4), model: MODEL.CLASSIC };
}

/**
 * Personaje original de ejemplo: cabello castaño, sudadera turquesa oscuro
 * con cierre, jeans y zapatillas. Incluye una ligera textura de "ruido".
 * @param {string} [model=MODEL.CLASSIC]
 */
export function createTemplateSkin(model = MODEL.CLASSIC) {
  const pixels = new Uint8ClampedArray(SKIN_WIDTH * SKIN_HEIGHT * 4);
  const rand = seededRandom(20260924);
  const C = {
    skin: hexToRgba('#d9a27a'),
    hair: hexToRgba('#4a2f1f'),
    hoodie: hexToRgba('#2f7f7a'),
    zipper: hexToRgba('#d8d8d8'),
    jeans: hexToRgba('#35507a'),
    shoe: hexToRgba('#3a3a3a'),
    sole: hexToRgba('#e9e4dc'),
    eyeWhite: hexToRgba('#f4f4f4'),
    iris: hexToRgba('#3c6ea8'),
    mouth: hexToRgba('#9a5a4a'),
  };
  /** Pinta con una variación sutil de brillo para simular textura. */
  const put = (x, y, color, grain = 0.06) => {
    const c = shade(color, (rand() * 2 - 1) * grain);
    pixels.set(c, (y * SKIN_WIDTH + x) * 4);
  };

  const boxes = getBoxes(model).filter((b) => b.layer === LAYER.BASE);
  const box = (part) => boxes.find((b) => b.part === part);
  /** Recorre todos los píxeles de una cara llamando a fn(i, j, w, h). */
  const eachTexel = (part, faceName, fn) => {
    const { rect } = box(part).faces.find((f) => f.name === faceName);
    for (let j = 0; j < rect.h; j++) for (let i = 0; i < rect.w; i++) fn(rect.x + i, rect.y + j, i, j, rect.w, rect.h);
  };
  const allFaces = ['top', 'bottom', 'right', 'front', 'left', 'back'];

  // --- Cabeza ---
  for (const f of allFaces) {
    eachTexel(PART.HEAD, f, (x, y, i, j) => {
      let color = C.skin;
      if (f === 'top') color = C.hair;
      else if (f === 'back') color = j < 7 ? C.hair : C.skin;
      else if (f === 'right' || f === 'left') {
        // Patilla: el cabello baja más cerca de la parte trasera.
        const nearBack = f === 'right' ? i < 4 : i > 3;
        color = j < 2 || (nearBack && j < 5) ? C.hair : C.skin;
      } else if (f === 'front') color = j < 2 || (j === 2 && (i === 0 || i === 7)) ? C.hair : C.skin;
      put(x, y, color, f === 'top' || color === C.hair ? 0.1 : 0.04);
    });
  }
  // Rostro (cara frontal de la cabeza: x 8–15, y 8–15)
  const face = (i, j, c) => put(8 + i, 8 + j, c, 0);
  face(1, 4, C.eyeWhite); face(2, 4, C.iris);
  face(5, 4, C.iris); face(6, 4, C.eyeWhite);
  face(1, 3, shade(C.hair, 0.1)); face(2, 3, shade(C.hair, 0.1));
  face(5, 3, shade(C.hair, 0.1)); face(6, 3, shade(C.hair, 0.1));
  face(3, 5, shade(C.skin, -0.12)); face(4, 5, shade(C.skin, -0.12));
  face(3, 6, C.mouth); face(4, 6, C.mouth);

  // --- Torso: sudadera con cierre ---
  for (const f of allFaces) {
    eachTexel(PART.BODY, f, (x, y, i, j, w, h) => {
      let color = C.hoodie;
      if (f === 'front' && (i === 3 || i === 4) && j > 0) color = i === 3 ? C.zipper : shade(C.hoodie, -0.15);
      if ((f !== 'top' && f !== 'bottom') && j === h - 1) color = shade(C.hoodie, -0.2); // cintura
      put(x, y, color);
    });
  }

  // --- Brazos: mangas y manos ---
  for (const part of [PART.RIGHT_ARM, PART.LEFT_ARM]) {
    for (const f of allFaces) {
      eachTexel(part, f, (x, y, i, j, w, h) => {
        let color = C.hoodie;
        if (f === 'bottom') color = C.skin;
        else if (f !== 'top') {
          if (j >= h - 3) color = C.skin;
          else if (j === h - 4) color = shade(C.hoodie, -0.2); // puño
        }
        put(x, y, color);
      });
    }
  }

  // --- Piernas: jeans y zapatillas ---
  for (const part of [PART.RIGHT_LEG, PART.LEFT_LEG]) {
    for (const f of allFaces) {
      eachTexel(part, f, (x, y, i, j, w, h) => {
        let color = C.jeans;
        if (f === 'bottom') color = C.sole;
        else if (f !== 'top') {
          if (j === h - 1) color = C.sole;
          else if (j >= h - 3) color = C.shoe;
        }
        put(x, y, color, color === C.jeans ? 0.08 : 0.03);
      });
    }
  }

  // --- Capa externa: capucha caída sobre la espalda (ejemplo de overlay) ---
  const hood = getBoxes(model).find((b) => b.part === PART.BODY && b.layer === LAYER.OVERLAY);
  const back = hood.faces.find((f) => f.name === 'back').rect;
  for (let j = 0; j < 3; j++) {
    for (let i = 1; i < back.w - 1; i++) put(back.x + i, back.y + j, shade(C.hoodie, 0.08));
  }

  return { pixels, model };
}
