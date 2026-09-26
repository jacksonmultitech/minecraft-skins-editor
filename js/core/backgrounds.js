/**
 * @file backgrounds.js
 * Fondos para la vista previa, dibujados por código como pixel art al estilo
 * de Minecraft (bloques de 8×8 con textura de ruido). No usa texturas del
 * juego: todo se genera con colores y un generador aleatorio con semilla, así
 * que cada fondo sale siempre igual.
 *
 * Cada escena mide 128×128 "texeles" (16×16 bloques) y se dibuja ampliada y
 * sin suavizado detrás del personaje.
 */

/** Fondos disponibles, en el orden del selector. */
export const BACKGROUND_IDS = Object.freeze(['default', 'plains', 'sunset', 'night', 'cave', 'nether', 'end', 'chroma', 'custom']);

/** Fondos generados por código (sin "default" ni "custom"). */
export const GENERATED_BACKGROUNDS = Object.freeze(['plains', 'sunset', 'night', 'cave', 'nether', 'end', 'chroma']);

/** Verde estándar para croma (pantalla verde). */
export const CHROMA_GREEN = '#00B140';

const SIZE = 128;
const BLOCK = 8;
/** Fila donde empieza el suelo en las escenas con cielo. */
const GROUND_Y = 96;

/* ------------------------------------------------------------------------ */
/* Utilidades de dibujo                                                      */
/* ------------------------------------------------------------------------ */

/** Generador pseudoaleatorio con semilla (mulberry32): mismo resultado en cada llamada. */
function createRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** "#RRGGBB" → [r, g, b]. */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Multiplica el brillo de un color. */
function shade([r, g, b], f) {
  return [r * f, g * f, b * f];
}

/** Mezcla lineal de dos colores (t = 0 → a, t = 1 → b). */
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Lienzo RGBA mínimo sobre un Uint8ClampedArray. */
class PixelCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  set(x, y, [r, g, b]) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    this.pixels[i] = r;
    this.pixels[i + 1] = g;
    this.pixels[i + 2] = b;
    this.pixels[i + 3] = 255;
  }

  get(x, y) {
    const i = (y * this.width + x) * 4;
    return [this.pixels[i], this.pixels[i + 1], this.pixels[i + 2]];
  }

  rect(x, y, w, h, color) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, color);
  }

  /** Multiplica el brillo de cada píxel según una función (x, y) → factor. */
  light(fn) {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) this.set(x, y, shade(this.get(x, y), fn(x, y)));
    }
  }
}

/**
 * Rellena un bloque de 8×8 con un color y variaciones por texel, como las
 * texturas del juego. `specks` agrega motas de otros colores.
 * @param {PixelCanvas} c
 * @param {number} bx Columna del bloque.
 * @param {number} by Fila del bloque.
 * @param {number[]} base Color base.
 * @param {() => number} rand
 * @param {{ amount?: number, specks?: Array<[number[], number]> }} [opts] specks: [color, probabilidad].
 */
function block(c, bx, by, base, rand, { amount = 0.16, specks = [] } = {}) {
  for (let y = 0; y < BLOCK; y++) {
    for (let x = 0; x < BLOCK; x++) {
      let color = shade(base, 1 + (rand() - 0.5) * amount * 2);
      for (const [speck, chance] of specks) {
        if (rand() < chance) { color = shade(speck, 1 + (rand() - 0.5) * amount); break; }
      }
      c.set(bx * BLOCK + x, by * BLOCK + y, color);
    }
  }
}

/** Cielo en franjas de 4 filas (degradado "pixelado") entre varios colores. */
function sky(c, stops, height = GROUND_Y) {
  const band = 4;
  for (let y = 0; y < height; y += band) {
    const t = (y / Math.max(1, height - band)) * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(t));
    c.rect(0, y, c.width, band, mix(stops[i], stops[i + 1], t - i));
  }
}

/** Nube blocky: unión de rectángulos con la base un poco más oscura. */
function cloud(c, x, y, w, color) {
  const under = shade(color, 0.9);
  c.rect(x, y + 4, w, 4, color);
  c.rect(x + 4, y, w - 12, 4, color);
  c.rect(x, y + 8, w, 2, under);
}

/** Bloques de pasto (fila superior) y tierra hasta el borde inferior. */
function grassGround(c, rand, { dark = 1, tint = [1, 1, 1] } = {}) {
  const t = (color) => shade([color[0] * tint[0], color[1] * tint[1], color[2] * tint[2]], dark);
  const grass = t(rgb('#6DB33F'));
  const dirt = t(rgb('#866043'));
  const cols = SIZE / BLOCK;
  const firstRow = GROUND_Y / BLOCK;
  for (let bx = 0; bx < cols; bx++) {
    for (let by = firstRow; by < SIZE / BLOCK; by++) {
      block(c, bx, by, dirt, rand, { amount: 0.14, specks: [[t(rgb('#5E4430')), 0.12], [t(rgb('#A07A55')), 0.08]] });
    }
    // Capa de pasto: 3 texeles arriba con "gotas" irregulares hacia la tierra.
    for (let x = 0; x < BLOCK; x++) {
      const depth = 2 + (rand() < 0.45 ? 1 : 0) + (rand() < 0.2 ? 1 : 0);
      for (let y = 0; y < depth; y++) c.set(bx * BLOCK + x, GROUND_Y + y, shade(grass, 1 + (rand() - 0.5) * 0.3));
    }
  }
}

/** Árbol de roble blocky apoyado en el suelo (x en texeles, alineado a bloques). */
function oakTree(c, x, rand, { dark = 1 } = {}) {
  const log = shade(rgb('#6B5033'), dark);
  const leaves = shade(rgb('#3F7F2A'), dark);
  const top = GROUND_Y - BLOCK * 5;
  // Hojas: 3 bloques de ancho y 2 de alto, más uno encima.
  for (let bx = -1; bx <= 1; bx++) {
    for (let by = 0; by < 2; by++) block(c, x / BLOCK + bx, top / BLOCK + 1 + by, leaves, rand, { amount: 0.22, specks: [[shade(leaves, 0.7), 0.18]] });
  }
  block(c, x / BLOCK, top / BLOCK, leaves, rand, { amount: 0.22, specks: [[shade(leaves, 0.7), 0.18]] });
  // Tronco: 2 bloques bajo las hojas.
  for (let by = 3; by < 5; by++) block(c, x / BLOCK, top / BLOCK + by, log, rand, { amount: 0.18, specks: [[shade(log, 0.75), 0.2]] });
}

/** Colinas lejanas: columnas de 8 px con alturas de 0 a 2 bloques. */
function hills(c, rand, color, maxBlocks = 2) {
  for (let bx = 0; bx < SIZE / BLOCK; bx++) {
    const h = Math.floor(rand() * (maxBlocks + 1)) * BLOCK + (rand() < 0.5 ? 4 : 0);
    c.rect(bx * BLOCK, GROUND_Y - h, BLOCK, h, shade(color, 0.95 + rand() * 0.1));
  }
}

/** Oscurece los bordes (sensación de cueva o de profundidad). */
function vignette(c, strength = 0.55) {
  const cx = c.width / 2, cy = c.height / 2, max = Math.hypot(cx, cy);
  c.light((x, y) => 1 - strength * (Math.hypot(x - cx, y - cy) / max) ** 1.6);
}

/* ------------------------------------------------------------------------ */
/* Escenas                                                                   */
/* ------------------------------------------------------------------------ */

const SCENES = {
  /** Pradera de día: cielo azul, sol cuadrado, nubes, árboles y pasto. */
  plains(c, rand) {
    sky(c, [rgb('#6E9CFF'), rgb('#8FB4FF'), rgb('#BCD6FF')]);
    c.rect(92, 12, 18, 18, rgb('#FFE680'));
    c.rect(96, 16, 10, 10, rgb('#FFF7C2'));
    cloud(c, 8, 22, 36, rgb('#FFFFFF'));
    cloud(c, 58, 40, 28, rgb('#FFFFFF'));
    cloud(c, 104, 50, 30, rgb('#F4F7FF'));
    hills(c, rand, rgb('#5E9D34'));
    oakTree(c, 16, rand);
    oakTree(c, 104, rand);
    grassGround(c, rand);
  },

  /** Atardecer: cielo naranja y violeta, sol grande tras las colinas. */
  sunset(c, rand) {
    sky(c, [rgb('#2E1A4A'), rgb('#6B2D6B'), rgb('#C2456B'), rgb('#F07A4A'), rgb('#FFB257')]);
    c.rect(48, 58, 32, 32, rgb('#FF9A3C'));
    c.rect(54, 64, 20, 20, rgb('#FFD27A'));
    cloud(c, 4, 30, 34, rgb('#E88A7A'));
    cloud(c, 88, 20, 32, rgb('#C9677D'));
    hills(c, rand, rgb('#4A2240'));
    oakTree(c, 104, rand, { dark: 0.28 });
    grassGround(c, rand, { dark: 0.42, tint: [1.15, 0.8, 1.05] });
  },

  /** Noche: estrellas, luna cuadrada con cráteres y el campo en penumbra. */
  night(c, rand) {
    sky(c, [rgb('#070B24'), rgb('#0E1638'), rgb('#1A2A58')]);
    for (let y = 0; y < GROUND_Y - 8; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (rand() < 0.012) c.set(x, y, [rgb('#FFFFFF'), rgb('#CFE0FF'), rgb('#FFF3C4')][Math.floor(rand() * 3)]);
      }
    }
    for (const [x, y] of [[40, 18], [74, 34], [112, 12]]) {
      c.set(x, y, rgb('#FFFFFF'));
      c.set(x - 1, y, rgb('#9FB4E8')); c.set(x + 1, y, rgb('#9FB4E8'));
      c.set(x, y - 1, rgb('#9FB4E8')); c.set(x, y + 1, rgb('#9FB4E8'));
    }
    c.rect(16, 14, 18, 18, rgb('#E9E7D8'));
    for (const [x, y, s] of [[19, 18, 3], [27, 22, 4], [21, 27, 2], [29, 16, 2]]) c.rect(x, y, s, s, rgb('#C9C6B4'));
    hills(c, rand, rgb('#14243A'));
    oakTree(c, 88, rand, { dark: 0.3 });
    grassGround(c, rand, { dark: 0.36, tint: [0.75, 0.9, 1.3] });
  },

  /** Cueva: piedra, pizarra profunda y minerales, con los bordes en sombra. */
  cave(c, rand) {
    const stone = rgb('#7D7D7D');
    const deepslate = rgb('#4F4F55');
    const ores = [
      rgb('#2B2B2B'), rgb('#D8AF93'), rgb('#FCEE4B'), rgb('#5DECF5'),
      rgb('#FF1E1E'), rgb('#2A56C9'), rgb('#17DD62'), rgb('#E07A4A'),
    ];
    for (let by = 0; by < SIZE / BLOCK; by++) {
      for (let bx = 0; bx < SIZE / BLOCK; bx++) {
        const deep = by >= 12 || (by === 11 && rand() < 0.5);
        const base = deep ? deepslate : stone;
        block(c, bx, by, base, rand, { amount: 0.2, specks: [[shade(base, 0.82), 0.14], [shade(base, 1.15), 0.08]] });
        if (rand() < 0.1) {
          const ore = ores[Math.floor(rand() * ores.length)];
          for (let k = 0; k < 5; k++) {
            const x = bx * BLOCK + 1 + Math.floor(rand() * 5), y = by * BLOCK + 1 + Math.floor(rand() * 5);
            c.rect(x, y, 2, 1 + (rand() < 0.5 ? 1 : 0), shade(ore, 0.9 + rand() * 0.2));
          }
        }
      }
    }
    vignette(c, 0.6);
  },

  /** Nether: netherrack, piedra luminosa arriba y un lago de lava abajo. */
  nether(c, rand) {
    const rack = rgb('#6F2A2A');
    const glow = rgb('#F3C766');
    const lava = rgb('#FF7A00');
    for (let by = 0; by < SIZE / BLOCK; by++) {
      for (let bx = 0; bx < SIZE / BLOCK; bx++) {
        if (by >= 14) {
          block(c, bx, by, lava, rand, { amount: 0.12, specks: [[rgb('#FFD34D'), 0.12], [rgb('#D84A0A'), 0.14]] });
        } else if (by <= 1 && rand() < 0.35) {
          block(c, bx, by, glow, rand, { amount: 0.14, specks: [[rgb('#FFE9A8'), 0.2], [rgb('#B98A36'), 0.15]] });
        } else {
          block(c, bx, by, rack, rand, { amount: 0.24, specks: [[rgb('#843434'), 0.16], [rgb('#5A1F1F'), 0.16]] });
        }
      }
    }
    // Resplandor de la lava sobre la roca cercana.
    c.light((x, y) => (y < 112 ? 0.78 + 0.5 * Math.max(0, (y - 64) / 48) ** 2 : 1));
  },

  /** El End: cielo negro violáceo, pilares de obsidiana y piedra del End. */
  end(c, rand) {
    c.rect(0, 0, SIZE, SIZE, rgb('#120A1C'));
    for (let y = 0; y < 104; y++) {
      for (let x = 0; x < SIZE; x++) {
        const r = rand();
        if (r < 0.03) c.set(x, y, rgb('#2A1B3B'));
        else if (r < 0.036) c.set(x, y, rgb('#D9C3FF'));
      }
    }
    const obsidian = rgb('#2A2140');
    for (const [bx, height] of [[1, 7], [6, 9], [12, 6]]) {
      for (let by = 13 - height; by < 13; by++) {
        for (let dx = 0; dx < 2; dx++) block(c, bx + dx, by, obsidian, rand, { amount: 0.25, specks: [[rgb('#553C80'), 0.16], [rgb('#15101F'), 0.2]] });
      }
    }
    const endStone = rgb('#DCDC9F');
    for (let by = 13; by < SIZE / BLOCK; by++) {
      for (let bx = 0; bx < SIZE / BLOCK; bx++) {
        block(c, bx, by, endStone, rand, { amount: 0.1, specks: [[rgb('#C5C488'), 0.16], [rgb('#EDEDB6'), 0.1]] });
      }
    }
  },

  /** Pantalla verde para recortar el personaje en un editor de video. */
  chroma(c) {
    c.rect(0, 0, SIZE, SIZE, rgb(CHROMA_GREEN));
  },
};

/**
 * Genera la imagen de un fondo.
 * @param {string} id Uno de GENERATED_BACKGROUNDS.
 * @param {{ seed?: number }} [options]
 * @returns {{ width: number, height: number, pixels: Uint8ClampedArray } | null}
 *   `null` para "default" (color del tema), "custom" o un id desconocido.
 */
export function generateBackground(id, { seed = 20260926 } = {}) {
  const draw = Object.hasOwn(SCENES, id) ? SCENES[id] : null;
  if (!draw) return null;
  const canvas = new PixelCanvas(SIZE, SIZE);
  draw(canvas, createRandom(seed + id.length * 7919));
  return { width: canvas.width, height: canvas.height, pixels: canvas.pixels };
}
