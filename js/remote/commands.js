/**
 * @file commands.js
 * Órdenes que un agente de IA puede ejecutar en el editor a través del MCP.
 *
 * Cada orden recibe argumentos ya validados por el servidor, pero aquí se
 * vuelven a validar: el editor nunca confía ciegamente en datos externos.
 * Todas las que modifican la skin se ejecutan como UNA transacción del
 * historial, así el usuario puede deshacer cada acción del agente con Ctrl+Z.
 */
import { SKIN_WIDTH, MODEL, LAYER } from '../config.js';
import { getBoxes, getRegionMap, PART_ORDER, FACE_ORDER } from '../core/skin-model.js';
import { analyzeSkin } from '../core/skin-io.js';
import { createTemplateSkin, createBlankSkin } from '../core/templates.js';
import { clearLayer, mirrorSide, convertArms } from '../core/transforms.js';
import { groupSkinColors } from '../core/color-theory.js';
import { parseColor, shade } from '../utils/color.js';

/** Error de validación con mensaje para el agente (en español). */
class CommandError extends Error {}

const assert = (condition, message) => { if (!condition) throw new CommandError(message); };

/** Convierte "#rrggbbaa" (u otro formato) en RGBA; "transparent" → alfa 0. */
function toRgba(color) {
  if (String(color).toLowerCase() === 'transparent') return [0, 0, 0, 0];
  const rgba = parseColor(color);
  assert(rgba, `Color no válido: ${color}`);
  return rgba;
}

const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

/** Blob → Base64 (sin el prefijo data:). */
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Dibuja una imagen escalada en un lienzo y la devuelve como PNG en Base64. */
async function canvasToPayload(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return { base64: await blobToBase64(blob), width: canvas.width, height: canvas.height };
}

/**
 * Crea el mapa de órdenes disponibles.
 * @param {import('../main.js').App} app
 * @returns {Record<string, (args: object) => Promise<object>>}
 */
export function createCommandHandlers(app) {
  const { doc } = app;

  /** Busca la caja de una parte y capa en el modelo actual. */
  const boxOf = (part, layer) => {
    assert(PART_ORDER.includes(part), `Parte desconocida: ${part}. Usa: ${PART_ORDER.join(', ')}.`);
    assert(layer === LAYER.BASE || layer === LAYER.OVERLAY, `Capa desconocida: ${layer}. Usa base u overlay.`);
    return getBoxes(doc.model).find((b) => b.part === part && b.layer === layer);
  };

  /** Rectángulo UV de una cara. */
  const faceRect = (part, layer, face) => {
    assert(FACE_ORDER.includes(face), `Cara desconocida: ${face}. Usa: ${FACE_ORDER.join(', ')}.`);
    return boxOf(part, layer).faces.find((f) => f.name === face).rect;
  };

  /** Ejecuta una modificación como un solo paso del historial y cuenta los cambios. */
  const mutate = (fn) => {
    const before = new Uint8ClampedArray(doc.pixels);
    doc.transaction((d) => fn(d));
    let changed = 0;
    for (let i = 0; i < before.length; i += 4) {
      if (before[i] !== doc.pixels[i] || before[i + 1] !== doc.pixels[i + 1]
        || before[i + 2] !== doc.pixels[i + 2] || before[i + 3] !== doc.pixels[i + 3]) changed++;
    }
    return changed;
  };

  return {
    /* ------------------------------ Lectura ------------------------------ */

    async state() {
      const { lookup } = getRegionMap(doc.model);
      const families = groupSkinColors(doc.pixels, lookup, { tolerance: 0.04, limit: 24 });
      return {
        name: doc.name,
        model: doc.model,
        modelInfo: doc.model === MODEL.SLIM ? 'Delgado: brazos de 3 px' : 'Clásico: brazos de 4 px',
        activeLayer: app.state.get('activeLayer'),
        canUndo: doc.history.canUndo,
        canRedo: doc.history.canRedo,
        compatibility: analyzeSkin(doc.pixels, doc.model),
        mainColors: families.flatMap((f) => f.groups.map((g) => ({ family: f.family, hex: g.hex, pixels: g.pixels }))),
      };
    },

    async image({ view = 'preview', angle = 'front' } = {}) {
      if (view === 'preview' && app.preview) {
        // Vista previa 3D con encuadre fijo, reducida a 512 px como máximo.
        const blob = await app.preview.captureStandard(angle);
        const bitmap = await createImageBitmap(blob);
        const k = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * k);
        canvas.height = Math.round(bitmap.height * k);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        bitmap.close?.();
        return canvasToPayload(canvas);
      }
      // Textura plana ampliada ×8, con ajedrez gris donde hay transparencia.
      const scale = 8;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SKIN_WIDTH * scale;
      const ctx = canvas.getContext('2d');
      for (let y = 0; y < SKIN_WIDTH * 2; y++) {
        for (let x = 0; x < SKIN_WIDTH * 2; x++) {
          ctx.fillStyle = (x + y) % 2 ? '#c8c8c8' : '#e8e8e8';
          ctx.fillRect(x * scale / 2, y * scale / 2, scale / 2, scale / 2);
        }
      }
      const tex = document.createElement('canvas');
      tex.width = tex.height = SKIN_WIDTH;
      tex.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(doc.pixels), SKIN_WIDTH, SKIN_WIDTH), 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tex, 0, 0, canvas.width, canvas.height);
      return canvasToPayload(canvas);
    },

    /* ---------------------------- Modificación ---------------------------- */

    async new({ kind = 'blank', model } = {}) {
      const target = model === MODEL.SLIM || model === MODEL.CLASSIC ? model : doc.model;
      const { pixels } = kind === 'template' ? createTemplateSkin(target) : createBlankSkin();
      doc.load(pixels, target, { keepHistory: true });
      return { kind, model: target };
    },

    async model({ model, adaptArms = true } = {}) {
      assert(model === MODEL.CLASSIC || model === MODEL.SLIM, 'Modelo no válido: usa classic o slim.');
      const from = doc.model;
      doc.setModel(model, adaptArms ? convertArms : undefined);
      return { from, to: doc.model, adaptedArms: Boolean(adaptArms) && from !== model };
    },

    async pixels({ pixels } = {}) {
      assert(Array.isArray(pixels) && pixels.length > 0 && pixels.length <= 4096, 'Envía entre 1 y 4096 píxeles.');
      const list = pixels.map((p) => {
        assert(isInt(p.x, 0, 63) && isInt(p.y, 0, 63), `Coordenada fuera de la textura: (${p.x}, ${p.y}).`);
        return { x: p.x, y: p.y, rgba: toRgba(p.color) };
      });
      const changed = mutate((d) => list.forEach((p) => d.setPixel(p.x, p.y, p.rgba)));
      return { painted: list.length, changed };
    },

    async fill({ part, layer = LAYER.BASE, faces = FACE_ORDER, color } = {}) {
      const rgba = toRgba(color);
      const rects = faces.map((f) => ({ face: f, rect: faceRect(part, layer, f) }));
      const changed = mutate((d) => rects.forEach(({ rect }) => {
        for (let y = rect.y; y < rect.y + rect.h; y++) for (let x = rect.x; x < rect.x + rect.w; x++) d.setPixel(x, y, rgba);
      }));
      return { part, layer, faces: rects.map((r) => `${r.face} (${r.rect.w}×${r.rect.h})`), changed };
    },

    async pattern({ part, face, layer = LAYER.BASE, rows, legend } = {}) {
      const rect = faceRect(part, layer, face);
      const expected = `La cara ${part}.${layer}.${face} mide ${rect.w}×${rect.h} en el modelo ${doc.model === MODEL.SLIM ? 'delgado' : 'clásico'}: envía ${rect.h} filas de ${rect.w} caracteres.`;
      assert(Array.isArray(rows) && rows.length === rect.h, `Cantidad de filas incorrecta (${rows?.length ?? 0}). ${expected}`);
      rows.forEach((row, j) => assert(typeof row === 'string' && [...row].length === rect.w, `La fila ${j + 1} tiene ${[...String(row)].length} caracteres. ${expected}`));
      assert(legend && typeof legend === 'object', 'Falta la leyenda (legend) de colores.');
      const colors = Object.fromEntries(Object.entries(legend).map(([k, v]) => [k, toRgba(v)]));
      const changed = mutate((d) => rows.forEach((row, j) => [...row].forEach((ch, i) => {
        if (colors[ch]) d.setPixel(rect.x + i, rect.y + j, colors[ch]);
      })));
      return { part, face, layer, size: `${rect.w}×${rect.h}`, changed };
    },

    async noise({ layer = LAYER.BASE, parts, intensity = 0.12 } = {}) {
      assert(typeof intensity === 'number' && intensity > 0 && intensity <= 0.5, 'La intensidad debe estar entre 0.02 y 0.4.');
      const { lookup, regions } = getRegionMap(doc.model);
      const targets = parts?.length ? parts : PART_ORDER;
      const changed = mutate((d) => {
        for (let i = 0; i < lookup.length; i++) {
          const r = regions[lookup[i]];
          if (!r || r.layer !== layer || !targets.includes(r.part)) continue;
          const x = i % SKIN_WIDTH, y = Math.floor(i / SKIN_WIDTH);
          const c = d.getPixel(x, y);
          if (c[3] === 0) continue;
          d.setPixel(x, y, shade(c, (Math.random() * 2 - 1) * intensity));
        }
      });
      return { layer, parts: targets, intensity, changed };
    },

    async mirror({ direction, layer } = {}) {
      assert(direction === 'right_to_left' || direction === 'left_to_right', 'Dirección no válida.');
      const changed = mutate((d) => mirrorSide(d.pixels, d.model, direction === 'right_to_left' ? 'rightToLeft' : 'leftToRight', layer ?? null));
      return { direction, layer: layer ?? 'ambas', changed };
    },

    async clear({ layer, parts } = {}) {
      assert(layer === LAYER.BASE || layer === LAYER.OVERLAY, 'Capa no válida.');
      const changed = mutate((d) => clearLayer(d.pixels, d.model, layer, parts?.length ? parts : undefined));
      return { layer, parts: parts ?? 'todas', changed };
    },

    async undo({ steps = 1 } = {}) {
      let done = 0;
      while (done < Math.min(steps, 20) && doc.undo()) done++;
      return { undone: done, canUndo: doc.history.canUndo };
    },

    async redo({ steps = 1 } = {}) {
      let done = 0;
      while (done < Math.min(steps, 20) && doc.redo()) done++;
      return { redone: done, canRedo: doc.history.canRedo };
    },

    async download({ fileName } = {}) {
      if (fileName) app.setFileName(fileName);
      await app.download();
      return { file: `${doc.name}.png`, note: 'El navegador del usuario inició la descarga.' };
    },
  };
}

/** Resumen corto en español de una orden (para el registro de actividad). */
export function describeCommand(op, args = {}, data = {}) {
  const n = data?.changed;
  const px = typeof n === 'number' ? ` (${n} px)` : '';
  switch (op) {
    case 'state': return 'Consultó el estado del editor';
    case 'image': return args.view === 'texture' ? 'Miró la textura' : `Miró la vista previa 3D (${args.angle ?? 'front'})`;
    case 'new': return args.kind === 'template' ? 'Creó una skin desde la plantilla' : 'Creó una skin en blanco';
    case 'model': return `Cambió el modelo a ${args.model === 'slim' ? 'delgado' : 'clásico'}`;
    case 'pixels': return `Pintó píxeles${px}`;
    case 'fill': return `Rellenó ${args.part} · ${args.layer}${px}`;
    case 'pattern': return `Dibujó en ${args.part} · ${args.face}${px}`;
    case 'noise': return `Agregó textura${px}`;
    case 'mirror': return `Reflejó un lado${px}`;
    case 'clear': return `Limpió la capa ${args.layer}${px}`;
    case 'undo': return 'Deshizo cambios';
    case 'redo': return 'Rehizo cambios';
    case 'download': return 'Descargó la skin';
    default: return op;
  }
}

