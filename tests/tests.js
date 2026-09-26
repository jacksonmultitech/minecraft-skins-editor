/**
 * @file tests.js
 * Pruebas automáticas del núcleo del editor, sin dependencias.
 * Ábrelas en el navegador: http://localhost:8080/tests/
 */
import { getBoxes, getRegionMap, getMirrorMap, detectSlim } from '../js/core/skin-model.js';
import { convertLegacySkin, encodePNG, decodeImage, imageToSkin, analyzeSkin, sanitizeFileName } from '../js/core/skin-io.js';
import { mirrorSide, convertArms, clearLayer } from '../js/core/transforms.js';
import { SkinDocument } from '../js/core/skin-document.js';
import { createTemplateSkin } from '../js/core/templates.js';
import { OrbitCamera } from '../js/render/camera.js';
import { pick } from '../js/render/picking.js';
import { transformVec } from '../js/render/math.js';
import { hexToRgba, rgbaToHex, rgbToHsv, hsvToRgb, rgbToHsl, hslToRgb, rgbToOklch, oklchToRgb, parseColor, formatColor } from '../js/utils/color.js';
import { harmony, tonalScale, groupSkinColors, colorFamily, randomPalette } from '../js/core/color-theory.js';
import { toGpl } from '../js/ui/palette-export.js';
import { generateBackground, GENERATED_BACKGROUNDS, BACKGROUND_IDS, CHROMA_GREEN } from '../js/core/backgrounds.js';
import { coverTransform } from '../js/render/renderer.js';

const results = [];

/** Registra una prueba. */
async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
  }
}

function assert(condition, message = 'La condición no se cumplió') {
  if (!condition) throw new Error(message);
}

/** Skin donde cada píxel tiene un color único (para detectar desplazamientos). */
function uniqueSkin() {
  const p = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < 4096; i++) { p[i * 4] = i % 64; p[i * 4 + 1] = Math.floor(i / 64); p[i * 4 + 2] = 90; p[i * 4 + 3] = 255; }
  return p;
}

/* ------------------------------------------------------------------------ */

await test('El mapa UV clásico usa 1632 píxeles por capa (dato de la wiki)', () => {
  const { lookup, regions } = getRegionMap('classic');
  const base = [...lookup].filter((i) => i >= 0 && regions[i].layer === 'base').length;
  assert(base === 1632, `Se obtuvieron ${base}`);
});

await test('El mapa UV delgado usa 1568 píxeles por capa (dato de la wiki)', () => {
  const { lookup, regions } = getRegionMap('slim');
  const base = [...lookup].filter((i) => i >= 0 && regions[i].layer === 'base').length;
  assert(base === 1568, `Se obtuvieron ${base}`);
});

await test('Ninguna cara se superpone con otra', () => {
  for (const model of ['classic', 'slim']) {
    const used = new Uint8Array(4096);
    for (const box of getBoxes(model)) {
      for (const { rect } of box.faces) {
        for (let y = rect.y; y < rect.y + rect.h; y++) {
          for (let x = rect.x; x < rect.x + rect.w; x++) {
            assert(!used[y * 64 + x], `Superposición en (${x}, ${y}) · ${model}`);
            used[y * 64 + x] = 1;
          }
        }
      }
    }
  }
});

await test('Espejo geométrico = conversión 64×32 del juego (orientación UV correcta)', () => {
  const src = uniqueSkin();
  const a = new Uint8ClampedArray(src);
  convertLegacySkin(a);
  const b = new Uint8ClampedArray(src);
  mirrorSide(b, 'classic', 'rightToLeft', 'base');
  const { lookup, regions } = getRegionMap('classic');
  for (let i = 0; i < 4096; i++) {
    const r = regions[lookup[i]];
    if (!r || r.layer !== 'base' || !['leftArm', 'leftLeg'].includes(r.part)) continue;
    assert(a[i * 4] === b[i * 4] && a[i * 4 + 1] === b[i * 4 + 1], `Diferencia en ${r.part}:${r.face}`);
  }
});

await test('La tabla de espejo es involutiva (aplicarla dos veces vuelve al inicio)', () => {
  for (const model of ['classic', 'slim']) {
    const m = getMirrorMap(model);
    for (let i = 0; i < m.length; i++) if (m[i] >= 0) assert(m[m[i]] === i, `Falla en ${i} (${model})`);
  }
});

await test('PNG: codificar y decodificar conserva los píxeles exactos (incluida semitransparencia)', async () => {
  const p = uniqueSkin();
  p.set([200, 100, 50, 128], 0);
  p.set([1, 2, 3, 7], 4);
  const img = await decodeImage(await encodePNG(p));
  assert(img.width === 64 && img.height === 64, 'Tamaño incorrecto');
  for (let i = 0; i < p.length; i++) assert(img.data[i] === p[i], `Diferencia en el byte ${i}`);
});

await test('Rechaza tamaños inválidos y reduce imágenes HD', () => {
  let failed = false;
  try { imageToSkin({ width: 50, height: 50, data: new Uint8ClampedArray(50 * 50 * 4) }); } catch { failed = true; }
  assert(failed, 'Debió rechazar 50×50');
  const hd = imageToSkin({ width: 128, height: 128, data: new Uint8ClampedArray(128 * 128 * 4).fill(255) });
  assert(hd.pixels.length === 64 * 64 * 4 && hd.notes.includes('notes.downscaled'));
});

await test('Detecta modelo delgado y clásico', () => {
  const { pixels } = createTemplateSkin('classic');
  assert(!detectSlim(pixels), 'La plantilla clásica se detectó como delgada');
  const slim = createTemplateSkin('slim').pixels;
  assert(detectSlim(slim), 'La plantilla delgada no se detectó');
});

await test('Convertir brazos clásico → delgado deja libres las zonas del modelo delgado', () => {
  const { pixels } = createTemplateSkin('classic');
  convertArms(pixels, 'classic', 'slim');
  assert(detectSlim(pixels), 'Tras convertir, la skin debería detectarse como delgada');
});

await test('Historial: deshacer y rehacer', () => {
  const doc = new SkinDocument();
  doc.beginStroke(); doc.setPixel(1, 1, [255, 0, 0, 255]); doc.endStroke();
  assert(doc.getPixel(1, 1)[0] === 255);
  doc.undo();
  assert(doc.getPixel(1, 1)[3] === 0, 'Deshacer no restauró el píxel');
  doc.redo();
  assert(doc.getPixel(1, 1)[0] === 255, 'Rehacer no aplicó el cambio');
});

await test('Las transacciones que escriben directo en los píxeles se pueden deshacer', () => {
  const doc = new SkinDocument();
  const { pixels, model } = createTemplateSkin();
  doc.load(pixels, model, { keepHistory: false });
  doc.transaction((d) => clearLayer(d.pixels, d.model, 'base'));
  assert(analyzeSkin(doc.pixels, doc.model).baseTransparent === 1632);
  doc.undo();
  assert(analyzeSkin(doc.pixels, doc.model).baseTransparent === 0);
});

await test('Picking: un rayo al centro de la cara frontal de la cabeza cae en ella', () => {
  const cam = new OrbitCamera();
  cam.setView('front');
  const aspect = 1;
  const target = [0.5, 28.5, 4]; // centro aproximado del texel (12, 11)
  const ndc = transformVec(cam.viewProjection(aspect), target);
  const hit = pick(cam.rayFromNDC(ndc[0], ndc[1], aspect), getBoxes('classic').filter((b) => b.layer === 'base'));
  assert(hit && hit.box.part === 'head' && hit.face.name === 'front', 'No se detectó la cara frontal');
  assert(hit.x === 12 && hit.y === 11, `Píxel (${hit.x}, ${hit.y}) en vez de (12, 11)`);
});

await test('Conversión de colores HEX ⇄ RGBA ⇄ HSV', () => {
  assert(rgbaToHex(hexToRgba('#1f7a62')) === '#1f7a62');
  assert(hexToRgba('#abc').join() === '170,187,204,255');
  const { h, s, v } = rgbToHsv(31, 122, 98);
  assert(hsvToRgb(h, s, v).join() === '31,122,98');
});

await test('Nombres de archivo seguros', () => {
  assert(sanitizeFileName('Mi Skin Épica!.png') === 'mi-skin-epica');
  assert(sanitizeFileName('') === 'mi-skin');
});

await test('HSL y OKLCH: ida y vuelta sin pérdida visible', () => {
  for (const hex of ['#f54927', '#2f7f7a', '#000000', '#ffffff', '#3c6ea8', '#c9a227']) {
    const [r, g, b] = hexToRgba(hex);
    const { h, s, l } = rgbToHsl(r, g, b);
    assert(rgbaToHex(hslToRgb(h, s, l)) === hex, `HSL falla con ${hex}`);
    const o = rgbToOklch(r, g, b);
    const back = oklchToRgb(o.l, o.c, o.h);
    assert(back.every((v, i) => Math.abs(v - [r, g, b][i]) <= 1), `OKLCH falla con ${hex}`);
  }
});

await test('#F54927 coincide con los valores de referencia (RGB, HSL, OKLCH)', () => {
  const c = hexToRgba('#F54927');
  assert(formatColor(c, 'rgb', { compact: true }) === '245, 73, 39');
  assert(formatColor(c, 'hsl', { compact: true }) === '10, 91, 56');
  assert(formatColor(c, 'oklch', { compact: true }) === '0.65, 0.21, 33');
});

await test('parseColor entiende HEX, rgb(), hsl(), oklch() y nombres CSS', () => {
  assert(parseColor('#F54927').join() === '245,73,39,255');
  assert(parseColor('rgb(245, 73, 39)').join() === '245,73,39,255');
  assert(parseColor('rgb(245 73 39 / 50%)')[3] === 128);
  assert(rgbaToHex(parseColor('hsl(10 91% 56%)')) === rgbaToHex(hslToRgb(10, 91, 56)));
  const ok = parseColor('oklch(65% 0.21 33)');
  assert(ok && Math.abs(ok[0] - 245) <= 3, 'oklch mal interpretado');
  assert(parseColor('tomato').join() === '255,99,71,255');
  assert(parseColor('esto no es un color') === null);
});

await test('Los colores fuera de sRGB se ajustan reduciendo el croma', () => {
  const rgb = oklchToRgb(0.7, 0.4, 150); // croma imposible en sRGB
  assert(rgb.every((v) => v >= 0 && v <= 255));
  const back = rgbToOklch(...rgb);
  assert(Math.abs(back.l - 0.7) < 0.02 && Math.abs(back.h - 150) < 4, 'Cambió la luminosidad o el tono');
});

await test('Armonías: tonos correctos (complementario y triádico)', () => {
  const base = hexToRgba('#ff0000');
  const comp = harmony(base, 'complementary');
  assert(comp.length === 2 && rgbaToHex(comp[1].rgba) === '#00ffff');
  const tri = harmony(base, 'triadic').map((c) => rgbaToHex(c.rgba));
  assert(tri.join() === '#ff0000,#00ff00,#0000ff', tri.join());
  assert(harmony(base, 'doubleSplitComplementary').length === 5);
});

await test('Escala tonal: 11 pasos de claro a oscuro que incluyen el color exacto', () => {
  const base = hexToRgba('#2f7f7a');
  for (const mode of ['linear', 'pixelart']) {
    const { colors, baseIndex } = tonalScale(base, { mode });
    assert(colors.length === 11);
    assert(colors[baseIndex].join() === base.join(), 'Falta el color base');
    const ls = colors.map((c) => rgbToOklch(c[0], c[1], c[2]).l);
    for (let i = 1; i < ls.length; i++) assert(ls[i] < ls[i - 1], `No baja la luminosidad en el paso ${i} (${mode})`);
  }
});

await test('Pixel art: las sombras giran hacia el azul y las luces hacia el amarillo', () => {
  const base = hexToRgba('#c94730'); // rojo anaranjado (tono OKLCH ≈ 33°)
  const { colors, baseIndex } = tonalScale(base, { mode: 'pixelart' });
  const hue = (c) => rgbToOklch(c[0], c[1], c[2]).h;
  const dark = hue(colors[colors.length - 2]);
  const light = hue(colors[1]);
  assert(dark < hue(base) || dark > 200, `Sombra sin desplazar: ${dark.toFixed(1)}`);
  assert(light > hue(base) && light < 120, `Luz sin desplazar: ${light.toFixed(1)}`);
  assert(baseIndex > 0);
});

await test('Agrupar colores: une variantes de ruido y ordena por familia y luminosidad', () => {
  const { pixels, model } = createTemplateSkin();
  const { lookup } = getRegionMap(model);
  const exact = groupSkinColors(pixels, lookup, { tolerance: 0, limit: 999 }).flatMap((f) => f.groups).length;
  const families = groupSkinColors(pixels, lookup, { tolerance: 0.04, limit: 999 });
  const similar = families.flatMap((f) => f.groups).length;
  assert(similar < exact / 3, `Agrupó poco: ${exact} → ${similar}`);
  for (const f of families) {
    f.groups.forEach((g) => assert(colorFamily(g.rgba) === f.family, `${g.hex} no es ${f.family}`));
    for (let i = 1; i < f.groups.length; i++) assert(f.groups[i].lightness <= f.groups[i - 1].lightness, 'Orden de luminosidad incorrecto');
  }
  assert(families[families.length - 1].family === 'neutral', 'Los neutros deben ir al final');
});

await test('Paleta aleatoria: color válido y armonía conocida', () => {
  let seed = 1;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 20; i++) {
    const { base, type } = randomPalette(rand);
    assert(base.length === 4 && base.every((v) => v >= 0 && v <= 255));
    assert(harmony(base, type).length >= 2);
  }
});

await test('Paleta GIMP (.gpl): cabecera y una línea "R G B nombre" por color', async () => {
  const text = await toGpl('Prueba', [{ rgba: [245, 73, 39, 255], label: 'Rojo' }, { rgba: [0, 0, 0, 255] }]).text();
  const lines = text.trim().split('\n');
  assert(lines[0] === 'GIMP Palette' && lines[1] === 'Name: Prueba', 'Cabecera incorrecta');
  assert(lines[4] === '245  73  39\tRojo', `Línea incorrecta: ${lines[4]}`);
  assert(lines[5] === '  0   0   0\t#000000', `Línea incorrecta: ${lines[5]}`);
});

await test('Fondos de la vista previa: 128×128, opacos y siempre iguales', () => {
  for (const id of GENERATED_BACKGROUNDS) {
    const a = generateBackground(id);
    const b = generateBackground(id);
    assert(a.width === 128 && a.height === 128 && a.pixels.length === 128 * 128 * 4, `${id}: tamaño incorrecto`);
    for (let i = 3; i < a.pixels.length; i += 4) assert(a.pixels[i] === 255, `${id}: hay píxeles transparentes`);
    assert(a.pixels.every((v, i) => v === b.pixels[i]), `${id}: el resultado cambia entre llamadas`);
  }
  assert(generateBackground('default') === null && generateBackground('custom') === null, '"default" y "custom" no se generan');
  assert(BACKGROUND_IDS.includes('default') && BACKGROUND_IDS.includes('custom'), 'Faltan opciones del selector');
  const chroma = generateBackground('chroma').pixels;
  const [r, g, b] = hexToRgba(CHROMA_GREEN);
  for (let i = 0; i < chroma.length; i += 4) assert(chroma[i] === r && chroma[i + 1] === g && chroma[i + 2] === b, 'La pantalla verde debe ser un color liso');
});

await test('Fondo "cover": llena el lienzo sin deformar la imagen', () => {
  const near = (x, y) => Math.abs(x - y) < 1e-9;
  // Lienzo más ancho que la imagen: se recorta arriba y abajo, centrado.
  let [sx, sy, ox, oy] = coverTransform(2, 1);
  assert(near(sx, 1) && near(sy, 0.5) && near(ox, 0) && near(oy, 0.25), `2:1 sobre 1:1 → ${[sx, sy, ox, oy]}`);
  // Lienzo más angosto: se recortan los costados.
  [sx, sy, ox, oy] = coverTransform(1, 16 / 9);
  assert(near(sy, 1) && near(sx, 9 / 16) && near(ox, (1 - 9 / 16) / 2) && near(oy, 0), 'Recorte lateral incorrecto');
  // La porción visible conserva la proporción del lienzo.
  const canvas = 0.95, image = 16 / 9;
  [sx, sy] = coverTransform(canvas, image);
  assert(near((sx * image) / sy, canvas), 'La proporción visible no coincide con el lienzo');
});

/* ------------------------------------------------------------------------ */

const list = document.getElementById('results');
const passed = results.filter((r) => r.ok).length;
document.getElementById('summary').textContent = `${passed} de ${results.length} pruebas superadas`;
document.getElementById('summary').className = passed === results.length ? 'ok' : 'fail';
list.replaceChildren(...results.map((r) => {
  const li = document.createElement('li');
  li.className = r.ok ? 'ok' : 'fail';
  li.textContent = `${r.ok ? '✔' : '✘'} ${r.name}${r.error ? ` — ${r.error}` : ''}`;
  return li;
}));
window.testResults = results;
