/**
 * @file palette-export.js
 * Utilidades compartidas para exportar paletas de colores:
 *  - imagen PNG con muestras y códigos (filas con título),
 *  - archivo .gpl (formato de paleta de GIMP, también lo abren Aseprite,
 *    Krita e Inkscape),
 *  - descripción de un color en todos los formatos (para JSON).
 */
import { rgbaToHex, formatColor, contrastText } from '../utils/color.js';

/**
 * Dibuja filas de muestras de color como imagen PNG.
 * Las filas largas se parten en varias líneas.
 * @param {Array<{ label:string, colors:number[][] }>} rows
 * @param {{ cell?: number, columns?: number }} [options]
 * @returns {Promise<Blob>}
 */
export function renderPaletteImage(rows, { cell = 80, columns = 11 } = {}) {
  const pad = 16, labelH = 24, gap = 14;
  const lines = rows.map((r) => Math.max(1, Math.ceil(r.colors.length / columns)));
  const cols = Math.min(columns, Math.max(...rows.map((r) => r.colors.length), 1));
  const width = pad * 2 + cols * cell;
  const height = pad * 2 + rows.reduce((h, _, i) => h + labelH + lines[i] * cell, 0) + gap * (rows.length - 1);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  let y = pad;
  rows.forEach(({ label, colors }, r) => {
    ctx.fillStyle = '#222';
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(label, pad, y + 16);
    colors.forEach((rgba, i) => {
      const x = pad + (i % columns) * cell;
      const cy = y + labelH + Math.floor(i / columns) * cell;
      ctx.fillStyle = rgbaToHex(rgba);
      ctx.fillRect(x, cy, cell, cell);
      ctx.fillStyle = contrastText(rgba);
      ctx.font = '600 11px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(rgbaToHex(rgba).toUpperCase(), x + cell / 2, cy + cell - 10);
    });
    y += labelH + lines[r] * cell + gap;
  });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Genera un archivo de paleta GIMP (.gpl).
 * @param {string} name Nombre de la paleta.
 * @param {Array<{ rgba:number[], label?:string }>} colors
 * @returns {Blob}
 */
export function toGpl(name, colors) {
  const pad = (n) => String(n).padStart(3, ' ');
  const lines = [
    'GIMP Palette',
    `Name: ${name}`,
    'Columns: 8',
    '#',
    ...colors.map(({ rgba: [r, g, b], label }) => `${pad(r)} ${pad(g)} ${pad(b)}\t${label ?? rgbaToHex([r, g, b]).toUpperCase()}`),
  ];
  return new Blob([`${lines.join('\n')}\n`], { type: 'text/plain' });
}

/** Describe un color en los cuatro formatos (para exportar en JSON). */
export function describeColor(rgba) {
  return {
    hex: formatColor(rgba, 'hex'),
    rgb: formatColor(rgba, 'rgb'),
    hsl: formatColor(rgba, 'hsl'),
    oklch: formatColor(rgba, 'oklch'),
  };
}
