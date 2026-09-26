/**
 * @file png-decoder.js
 * Decodificador PNG nativo (usa DecompressionStream del navegador).
 *
 * ¿Por qué no usar solo <canvas>? Porque el lienzo guarda los colores
 * "premultiplicados" por la opacidad y, al leerlos de vuelta, los píxeles
 * semitransparentes pierden precisión (por ejemplo, 200 se vuelve 199).
 * Este decodificador lee los valores exactos del archivo.
 *
 * Admite PNG de 8 bits por canal, sin entrelazado, en los tipos de color
 * más comunes: escala de grises (0), RGB (2), paleta (3), grises+alfa (4) y
 * RGBA (6). Para cualquier otro caso devuelve null y se usa el lienzo.
 */

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Predictor de Paeth definido por la especificación PNG. */
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Descomprime datos zlib con la API nativa. */
async function inflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Intenta decodificar un PNG.
 * @param {ArrayBuffer} buffer
 * @returns {Promise<{width:number, height:number, data:Uint8ClampedArray} | null>}
 */
export async function decodePNG(buffer) {
  if (typeof DecompressionStream === 'undefined') return null;
  const bytes = new Uint8Array(buffer);
  if (!SIGNATURE.every((v, i) => bytes[i] === v)) return null;
  const view = new DataView(buffer);

  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null, transparency = null;
  const idat = [];

  // Recorrer los bloques: longitud (4) + tipo (4) + datos + CRC (4).
  for (let pos = 8; pos + 8 <= bytes.length;) {
    const length = view.getUint32(pos);
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const data = bytes.subarray(pos + 8, pos + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(pos + 8);
      height = view.getUint32(pos + 12);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') transparency = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + length;
  }
  if (bitDepth !== 8 || interlace !== 0 || !(colorType in CHANNELS) || !width || !height) return null;
  if (colorType === 3 && !palette) return null;

  const total = idat.reduce((n, d) => n + d.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  idat.forEach((d) => { joined.set(d, offset); offset += d.length; });

  let raw;
  try {
    raw = await inflate(joined);
  } catch {
    return null;
  }

  // Deshacer los filtros de cada fila.
  const bpp = CHANNELS[colorType];
  const stride = width * bpp;
  if (raw.length < height * (stride + 1)) return null;
  const pixels = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? pixels[dst + x - bpp] : 0;
      const b = y > 0 ? pixels[dst - stride + x] : 0;
      const c = x >= bpp && y > 0 ? pixels[dst - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      pixels[dst + x] = v & 0xff;
    }
  }

  // Convertir a RGBA.
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * bpp, d = i * 4;
    switch (colorType) {
      case 6: out.set(pixels.subarray(s, s + 4), d); break;
      case 2: out[d] = pixels[s]; out[d + 1] = pixels[s + 1]; out[d + 2] = pixels[s + 2]; out[d + 3] = 255; break;
      case 0: out[d] = out[d + 1] = out[d + 2] = pixels[s]; out[d + 3] = 255; break;
      case 4: out[d] = out[d + 1] = out[d + 2] = pixels[s]; out[d + 3] = pixels[s + 1]; break;
      case 3: {
        const idx = pixels[s];
        out[d] = palette[idx * 3]; out[d + 1] = palette[idx * 3 + 1]; out[d + 2] = palette[idx * 3 + 2];
        out[d + 3] = transparency && idx < transparency.length ? transparency[idx] : 255;
        break;
      }
      default: return null;
    }
  }
  return { width, height, data: out };
}
