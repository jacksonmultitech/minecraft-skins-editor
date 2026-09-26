/**
 * @file skin-io.js
 * Entrada/salida de skins: lectura de imágenes, conversión de formatos
 * antiguos, codificación PNG exacta y análisis de compatibilidad.
 *
 * Formato que acepta el juego (https://minecraft.wiki/w/Skin):
 *  - PNG de 64×64 px con canal alfa (Java 1.8+ y Bedrock).
 *  - PNG de 64×32 px (formato antiguo, sin capa externa en cuerpo ni
 *    extremidades izquierdas propias). Aquí se convierte a 64×64.
 *  - Bedrock admite además 128×128 ("HD"); este editor trabaja a 64×64
 *    y reduce esas imágenes al abrirlas.
 */
import { SKIN_WIDTH, SKIN_HEIGHT, LEGACY_SKIN_HEIGHT, MODEL, OVERLAY_ALPHA_CUTOFF } from '../config.js';
import { getRegionMap, detectSlim } from './skin-model.js';
import { decodePNG } from './png-decoder.js';

/** Error con código para mostrar mensajes traducidos al usuario. */
export class SkinFormatError extends Error {
  /** @param {string} code Clave del mensaje (ver i18n). @param {object} [data] */
  constructor(code, data = {}) {
    super(code);
    this.code = code;
    this.data = data;
  }
}

/* ------------------------------------------------------------------------ */
/* Lectura                                                                   */
/* ------------------------------------------------------------------------ */

/**
 * Decodifica un archivo o blob de imagen a píxeles RGBA sin reescalar.
 * @param {Blob} blob
 * @returns {Promise<{width:number, height:number, data:Uint8ClampedArray}>}
 */
export async function decodeImage(blob) {
  if (blob.type && !blob.type.startsWith('image/')) throw new SkinFormatError('errors.notImage');
  // 1) Intentar el decodificador PNG exacto (conserva la semitransparencia sin pérdidas).
  const exact = await decodePNG(await blob.arrayBuffer()).catch(() => null);
  if (exact) return exact;

  // 2) Respaldo: decodificar con el navegador (JPG, GIF, WebP, PNG de 16 bits…).
  let bitmap;
  try {
    // premultiplyAlpha 'none' y sin conversión de color → valores lo más fieles posible.
    bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  } catch {
    throw new SkinFormatError('errors.decode');
  }
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { width: canvas.width, height: canvas.height, data };
}

/**
 * Convierte una imagen decodificada en una skin 64×64 válida.
 * @param {{width:number, height:number, data:Uint8ClampedArray}} image
 * @returns {{ pixels: Uint8ClampedArray, model: string, notes: string[] }}
 *   `notes` contiene claves i18n con avisos para el usuario.
 */
export function imageToSkin({ width, height, data }) {
  const notes = [];
  const validWidth = width >= SKIN_WIDTH && width % SKIN_WIDTH === 0;
  const isSquare = height === width;
  const isLegacy = height === width / 2;
  if (!validWidth || !(isSquare || isLegacy)) {
    throw new SkinFormatError('errors.size', { width, height });
  }

  // 1) Reducir imágenes HD (128×128, 256×256…) muestreando por vecino más cercano.
  const factor = width / SKIN_WIDTH;
  let src = data;
  let srcH = height / factor;
  if (factor > 1) {
    src = new Uint8ClampedArray(SKIN_WIDTH * srcH * 4);
    for (let y = 0; y < srcH; y++) {
      for (let x = 0; x < SKIN_WIDTH; x++) {
        const from = ((y * factor) * width + x * factor) * 4;
        src.set(data.subarray(from, from + 4), (y * SKIN_WIDTH + x) * 4);
      }
    }
    notes.push('notes.downscaled');
  }

  // 2) Copiar a un lienzo de 64×64.
  const pixels = new Uint8ClampedArray(SKIN_WIDTH * SKIN_HEIGHT * 4);
  pixels.set(src.subarray(0, SKIN_WIDTH * srcH * 4));

  // 3) Convertir el formato antiguo 64×32.
  if (srcH === LEGACY_SKIN_HEIGHT) {
    convertLegacySkin(pixels);
    notes.push('notes.legacy');
    return { pixels, model: MODEL.CLASSIC, notes };
  }
  return { pixels, model: detectSlim(pixels) ? MODEL.SLIM : MODEL.CLASSIC, notes };
}

/**
 * Convierte (en el mismo arreglo) una skin 64×32 al formato 64×64.
 *
 * Replica lo que hace el juego: las extremidades izquierdas no existían y
 * se generan copiando las derechas reflejadas horizontalmente.
 * @param {Uint8ClampedArray} pixels Arreglo de 64×64 cuya mitad superior contiene la skin.
 */
export function convertLegacySkin(pixels) {
  /** Copia un rectángulo reflejándolo horizontalmente. */
  const copyFlipped = (sx, sy, w, h, dx, dy) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const from = ((sy + y) * SKIN_WIDTH + sx + x) * 4;
        const to = ((dy + y) * SKIN_WIDTH + dx + (w - 1 - x)) * 4;
        pixels.set(pixels.subarray(from, from + 4), to);
      }
    }
  };
  // Pierna derecha → pierna izquierda
  copyFlipped(4, 16, 4, 4, 20, 48);   // arriba
  copyFlipped(8, 16, 4, 4, 24, 48);   // abajo
  copyFlipped(0, 20, 4, 12, 24, 52);  // exterior
  copyFlipped(4, 20, 4, 12, 20, 52);  // frente
  copyFlipped(8, 20, 4, 12, 16, 52);  // interior
  copyFlipped(12, 20, 4, 12, 28, 52); // atrás
  // Brazo derecho → brazo izquierdo
  copyFlipped(44, 16, 4, 4, 36, 48);
  copyFlipped(48, 16, 4, 4, 40, 48);
  copyFlipped(40, 20, 4, 12, 40, 52);
  copyFlipped(44, 20, 4, 12, 36, 52);
  copyFlipped(48, 20, 4, 12, 32, 52);
  copyFlipped(52, 20, 4, 12, 44, 52);

  // "Truco de transparencia" histórico: si la zona del sombrero es totalmente
  // opaca (fondo sólido en skins antiguas), se vuelve transparente.
  let hatOpaque = true;
  for (let y = 0; y < 16 && hatOpaque; y++) {
    for (let x = 32; x < 64; x++) {
      if (pixels[(y * SKIN_WIDTH + x) * 4 + 3] < 128) { hatOpaque = false; break; }
    }
  }
  if (hatOpaque) {
    for (let y = 0; y < 16; y++) for (let x = 32; x < 64; x++) pixels[(y * SKIN_WIDTH + x) * 4 + 3] = 0;
  }
}

/* ------------------------------------------------------------------------ */
/* Escritura: codificador PNG nativo                                         */
/* ------------------------------------------------------------------------ */

/** Tabla CRC-32 (necesaria para los bloques PNG). */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Crea un bloque ("chunk") PNG: longitud + tipo + datos + CRC. */
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Codifica píxeles RGBA en un PNG de 32 bits (RGBA, 8 bits por canal).
 *
 * Se usa un codificador propio con CompressionStream (API nativa) en lugar
 * de canvas.toBlob(): el lienzo guarda los colores "premultiplicados" y puede
 * alterar los píxeles semitransparentes. Así el archivo contiene exactamente
 * lo que se ve en el editor. Si el navegador no tiene CompressionStream,
 * se usa canvas.toBlob() como respaldo.
 *
 * @param {Uint8ClampedArray} pixels
 * @param {number} [width=64]
 * @param {number} [height=64]
 * @returns {Promise<Blob>}
 */
export async function encodePNG(pixels, width = SKIN_WIDTH, height = SKIN_HEIGHT) {
  if (typeof CompressionStream === 'undefined') return encodeWithCanvas(pixels, width, height);

  // Cada fila empieza con un byte de filtro (0 = sin filtro).
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    raw.set(pixels.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  // "deflate" en CompressionStream produce el formato zlib que exige PNG.
  const compressed = new Uint8Array(
    await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer(),
  );

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;  // bits por canal
  ihdr[9] = 6;  // tipo de color: RGBA
  ihdr[10] = 0; // compresión
  ihdr[11] = 0; // filtro
  ihdr[12] = 0; // sin entrelazado

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob(
    [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array(0))],
    { type: 'image/png' },
  );
}

/** Respaldo: codifica con un <canvas>. */
function encodeWithCanvas(pixels, width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Si la página se publica como Artifact en claude.ai, las descargas directas
 * están bloqueadas y se usa la capacidad "downloads" del visor. En cualquier
 * otro sitio `window.claude` no existe y esta promesa resuelve null.
 */
const hostDownloads = typeof window !== 'undefined' && window.claude?.use
  ? window.claude.use('downloads').catch(() => null)
  : Promise.resolve(null);

/**
 * ¿Las descargas pasan por el visor de claude.ai? (limita las extensiones permitidas)
 * @returns {Promise<boolean>}
 */
export async function hasHostDownloads() {
  return Boolean(await hostDownloads);
}

/**
 * Descarga un Blob con el nombre indicado.
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<'saved'|'declined'|'failed'>} Resultado de la descarga.
 */
export async function downloadBlob(blob, filename) {
  const downloads = await hostDownloads;
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      return 'saved';
    } catch (err) {
      return err?.code === 'declined' ? 'declined' : 'failed';
    }
  }
  // Navegador normal: enlace temporal con el atributo download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}

/** Limpia un nombre para usarlo como archivo ("Mi Skin!" → "mi-skin"). */
export function sanitizeFileName(name) {
  const clean = String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\.png$/i, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return clean || 'mi-skin';
}

/* ------------------------------------------------------------------------ */
/* Análisis de compatibilidad                                                */
/* ------------------------------------------------------------------------ */

/**
 * Revisa la skin y devuelve estadísticas útiles antes de exportar.
 * @param {Uint8ClampedArray} pixels
 * @param {string} model
 * @returns {{ baseTransparent:number, overlaySemi:number, overlayHidden:number, overlayVisible:number, unusedPainted:number }}
 *  - baseTransparent: píxeles de la capa base no opacos (Java los mostrará opacos).
 *  - overlaySemi: píxeles de la capa externa semitransparentes.
 *  - overlayHidden: píxeles externos con opacidad tan baja que Bedrock no los muestra.
 *  - overlayVisible: píxeles visibles de la capa externa.
 *  - unusedPainted: píxeles pintados fuera del mapa UV (el juego los ignora).
 */
export function analyzeSkin(pixels, model) {
  const { lookup, regions } = getRegionMap(model);
  const cutoff = Math.round(OVERLAY_ALPHA_CUTOFF * 255);
  const stats = { baseTransparent: 0, overlaySemi: 0, overlayHidden: 0, overlayVisible: 0, unusedPainted: 0 };
  for (let i = 0; i < lookup.length; i++) {
    const a = pixels[i * 4 + 3];
    const idx = lookup[i];
    if (idx < 0) {
      if (a > 0) stats.unusedPainted++;
      continue;
    }
    if (regions[idx].layer === 'base') {
      if (a < 255) stats.baseTransparent++;
    } else if (a > 0) {
      if (a < cutoff) stats.overlayHidden++;
      else stats.overlayVisible++;
      if (a < 255) stats.overlaySemi++;
    }
  }
  return stats;
}
