/**
 * @file harmony-panel.js
 * Panel "Armonías y tonos": aplica teoría del color al color principal.
 *  - Escala tonal (normal o con desplazamiento de tono estilo pixel art).
 *  - Armonías sobre un círculo cromático INTERACTIVO: el ángulo es el tono
 *    y la distancia al centro, la saturación. Arrastrar cualquier punto
 *    gira toda la armonía (las distancias entre colores se conservan).
 *  - Control de luminosidad, paleta aleatoria y exportación.
 * Al hacer clic en cualquier muestra, ese color pasa a ser el principal.
 */
import { t } from '../i18n/i18n.js';
import { HARMONY_ORDER, harmony, tonalScale, randomPalette } from '../core/color-theory.js';
import { rgbaToHex, rgbToHsl, hslToRgb, hexToRgba, contrastText, clamp } from '../utils/color.js';
import { copyText } from '../utils/clipboard.js';
import { downloadBlob, sanitizeFileName } from '../core/skin-io.js';
import { renderPaletteImage, describeColor, toGpl } from './palette-export.js';
import { bindMenu } from './menu.js';
import { readCssVar } from './theme.js';
import { toast } from './toast.js';

/** Distancia máxima (px) para "agarrar" un punto del círculo. */
const GRAB_RADIUS = 14;

export class HarmonyPanel {
  /**
   * @param {HTMLElement} root
   * @param {object} deps
   * @param {import('../editor/editor-state.js').EditorState} deps.state
   * @param {() => string} deps.getName Nombre base para los archivos exportados.
   */
  constructor(root, { state, getName }) {
    this.root = root;
    this.state = state;
    this.getName = getName;
    this.el = {
      strip: root.querySelector('#tone-strip'),
      select: root.querySelector('#harmony-select'),
      wheel: root.querySelector('#harmony-wheel'),
      readout: root.querySelector('#harmony-readout'),
      lightness: root.querySelector('#harmony-lightness'),
      swatches: root.querySelector('#harmony-swatches'),
      description: root.querySelector('#harmony-description'),
      random: root.querySelector('#btn-random-palette'),
      exportBtn: root.querySelector('#btn-export-colors'),
      exportMenu: root.querySelector('#menu-export'),
    };
    /** Punto que se está arrastrando (desplazamiento de tono respecto al base). */
    this.dragOffset = null;
    /** Tono recordado: en los grises (saturación 0) el tono no se puede deducir del RGB. */
    this.lastHue = 0;
    /** Caché del disco de colores (solo se redibuja si cambia tamaño o luminosidad). */
    this._disc = { key: '', canvas: null };

    this._buildSelect();
    this._bind();
    new ResizeObserver(() => this._drawWheel()).observe(this.el.wheel);
    this.render();
  }

  /* ----------------------------- Datos ----------------------------- */

  /** Color base en HSL (usa el último tono conocido si es gris). */
  get baseHsl() {
    const [r, g, b] = this.state.get('primary');
    const hsl = rgbToHsl(r, g, b);
    if (hsl.s < 0.5) hsl.h = this.lastHue;
    else this.lastHue = hsl.h;
    return hsl;
  }

  /** Colores actuales de la armonía y la escala. */
  get palette() {
    const base = this.state.get('primary');
    const type = this.state.get('harmonyType');
    return {
      base,
      type,
      harmony: harmony(base, type),
      scale: tonalScale(base, { mode: this.state.get('scaleMode') }),
    };
  }

  /* ---------------------------- Dibujo ----------------------------- */

  render() {
    const { harmony: colors, scale, type } = this.palette;
    const { h, s, l } = this.baseHsl;
    this.el.select.value = type;
    this.el.description.textContent = t(`theory.descriptions.${type}`);

    // Escala tonal: franja continua con un punto sobre el color actual.
    this.el.strip.replaceChildren(...scale.colors.map((rgba, i) => {
      const b = this._colorButton(rgbaToHex(rgba), 'tone');
      if (i === scale.baseIndex) {
        b.classList.add('is-base');
        b.style.setProperty('--dot', contrastText(rgba));
      }
      return b;
    }));

    // Muestras de la armonía con su código.
    this.el.swatches.replaceChildren(...colors.map(({ rgba, offset }) => {
      const hex = rgbaToHex(rgba).toUpperCase();
      const b = this._colorButton(hex, 'harmony-chip');
      b.style.color = contrastText(rgba);
      const code = document.createElement('span');
      code.textContent = hex;
      const deg = document.createElement('small');
      deg.textContent = offset === 0 ? t('theory.base') : `${offset > 0 ? '+' : ''}${offset}°`;
      b.append(code, deg);
      return b;
    }));

    // Lectura HSL y control de luminosidad.
    const text = t('theory.readout', { h: Math.round(h), s: Math.round(s), l: Math.round(l) });
    this.el.readout.textContent = text;
    this.el.wheel.setAttribute('aria-valuetext', text);
    if (document.activeElement !== this.el.lightness) this.el.lightness.value = String(Math.round(l));
    this.el.lightness.style.setProperty('--mid', `hsl(${h} ${s}% 50%)`);

    this._drawWheel(colors);
  }

  _colorButton(hex, className) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.dataset.color = hex;
    b.style.setProperty('--swatch', hex);
    const label = t('theory.use', { hex: hex.toUpperCase() });
    b.title = label;
    b.setAttribute('aria-label', label);
    return b;
  }

  /** Geometría del disco en píxeles CSS. */
  get _geometry() {
    const size = this.el.wheel.clientWidth || 140;
    return { size, c: size / 2, R: size / 2 - 8 };
  }

  /**
   * Disco HSL a la luminosidad actual: ángulo = tono (0° arriba, sentido
   * horario) y radio = saturación. Se genera píxel a píxel y se guarda en caché.
   */
  _discImage(sizePx, radiusPx, lightness) {
    const key = `${sizePx}|${radiusPx}|${Math.round(lightness)}`;
    if (this._disc.key === key) return this._disc.canvas;
    const canvas = document.createElement('canvas');
    canvas.width = sizePx;
    canvas.height = sizePx;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(sizePx, sizePx);
    const c = sizePx / 2;
    for (let y = 0; y < sizePx; y++) {
      for (let x = 0; x < sizePx; x++) {
        const dx = x + 0.5 - c, dy = y + 0.5 - c;
        const dist = Math.hypot(dx, dy);
        if (dist > radiusPx + 1) continue;
        const hue = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
        const [r, g, b] = hslToRgb(hue, Math.min(1, dist / radiusPx) * 100, lightness);
        const i = (y * sizePx + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
        img.data[i + 3] = Math.round(clamp(radiusPx + 1 - dist, 0, 1) * 255); // borde suave
      }
    }
    ctx.putImageData(img, 0, 0);
    this._disc = { key, canvas };
    return canvas;
  }

  /** Posición (px CSS) de un color de la armonía sobre el disco. */
  _pointFor(hue, saturation) {
    const { c, R } = this._geometry;
    const a = (hue * Math.PI) / 180;
    const r = (saturation / 100) * R;
    return [c + Math.sin(a) * r, c - Math.cos(a) * r];
  }

  _drawWheel(colors = this.palette.harmony) {
    const canvas = this.el.wheel;
    const { size, c, R } = this._geometry;
    if (!size) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    const { s, l } = this.baseHsl;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const discPx = Math.round(size * dpr);
    ctx.drawImage(this._discImage(discPx, R * dpr, l), 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Borde del disco y círculo guía de la saturación actual.
    const text = readCssVar('--text') || '#222';
    ctx.strokeStyle = readCssVar('--border-strong') || '#999';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = contrastText(hslToRgb(0, 0, l)) === '#fff' ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.35)';
    ctx.beginPath();
    ctx.arc(c, c, (s / 100) * R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    const points = colors.map(({ hue, offset, rgba }) => ({ offset, rgba, xy: this._pointFor(hue, s) }));
    // Líneas desde el centro y polígono que une los colores.
    ctx.strokeStyle = text;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.5;
    points.forEach(({ xy }) => { ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(...xy); ctx.stroke(); });
    if (points.length > 2) {
      ctx.beginPath();
      points.forEach(({ xy }, i) => (i ? ctx.lineTo(...xy) : ctx.moveTo(...xy)));
      ctx.closePath();
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Puntos (el base es más grande; el que se arrastra se resalta).
    points.forEach(({ xy: [x, y], offset, rgba }) => {
      const active = this.dragOffset === offset;
      ctx.beginPath();
      ctx.arc(x, y, offset === 0 ? 9 : 7, 0, Math.PI * 2);
      ctx.fillStyle = rgbaToHex(rgba);
      ctx.fill();
      ctx.lineWidth = active ? 4 : offset === 0 ? 3 : 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(0,0,0,.5)';
      ctx.stroke();
    });
  }

  /* ---------------------------- Eventos ---------------------------- */

  _buildSelect() {
    this.el.select.replaceChildren(...HARMONY_ORDER.map((id) => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = t(`theory.harmonies.${id}`);
      return o;
    }));
  }

  /** Aplica un nuevo tono/saturación/luminosidad al color base (conserva la opacidad). */
  _setBase(h, s, l) {
    this.lastHue = (h + 360) % 360;
    const rgb = hslToRgb(this.lastHue, clamp(s, 0, 100), clamp(l, 0, 100));
    this.state.set('primary', [...rgb, this.state.get('primary')[3]]);
  }

  /** Convierte la posición del puntero en tono (ángulo) y saturación (radio). */
  _polarFromEvent(e) {
    const rect = this.el.wheel.getBoundingClientRect();
    const { c, R } = this._geometry;
    const dx = e.clientX - rect.left - c;
    const dy = e.clientY - rect.top - c;
    return {
      hue: ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360,
      sat: Math.min(1, Math.hypot(dx, dy) / R) * 100,
    };
  }

  _bindWheel() {
    const wheel = this.el.wheel;

    const update = (e) => {
      const { hue, sat } = this._polarFromEvent(e);
      // Mover un punto secundario gira toda la armonía: base = tono − desplazamiento.
      this._setBase(hue - this.dragOffset, sat, this.baseHsl.l);
    };

    wheel.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const rect = wheel.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      const { s } = this.baseHsl;
      // ¿Se hizo clic sobre algún punto? Si no, el punto base salta al clic.
      const hit = this.palette.harmony
        .map(({ hue, offset }) => ({ offset, d: Math.hypot(...this._pointFor(hue, s).map((v, i) => v - [px, py][i])) }))
        .filter((p) => p.d <= GRAB_RADIUS)
        .sort((a, b) => a.d - b.d)[0];
      this.dragOffset = hit ? hit.offset : 0;
      wheel.setPointerCapture(e.pointerId);
      wheel.classList.add('is-dragging');
      update(e);
    });
    wheel.addEventListener('pointermove', (e) => {
      if (this.dragOffset !== null) { update(e); return; }
      // Cursor de "agarrar" al pasar sobre un punto.
      const rect = wheel.getBoundingClientRect();
      const { s } = this.baseHsl;
      const over = this.palette.harmony.some(({ hue }) => {
        const [x, y] = this._pointFor(hue, s);
        return Math.hypot(x - (e.clientX - rect.left), y - (e.clientY - rect.top)) <= GRAB_RADIUS;
      });
      wheel.classList.toggle('is-over-point', over);
    });
    const end = () => {
      if (this.dragOffset === null) return;
      this.dragOffset = null;
      wheel.classList.remove('is-dragging');
      this.state.addRecentColor(this.state.get('primary'));
      this._drawWheel();
    };
    wheel.addEventListener('pointerup', end);
    wheel.addEventListener('pointercancel', end);

    // Teclado: ←/→ tono, ↑/↓ saturación (Mayús = pasos grandes).
    wheel.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 15 : 5;
      const { h, s, l } = this.baseHsl;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      this._setBase(h + m[0], s + m[1], l);
    });

    this.el.lightness.addEventListener('input', () => {
      const { h, s } = this.baseHsl;
      this._setBase(h, s, Number(this.el.lightness.value));
    });
    this.el.lightness.addEventListener('change', () => this.state.addRecentColor(this.state.get('primary')));
  }

  _bind() {
    this.el.select.addEventListener('change', () => this.state.set('harmonyType', this.el.select.value));
    this._bindWheel();

    // Clic en una muestra → color principal (conserva la opacidad actual).
    this.root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-color]');
      if (!b) return;
      const rgba = hexToRgba(b.dataset.color);
      rgba[3] = this.state.get('primary')[3];
      this.state.set('primary', rgba);
      this.state.addRecentColor(rgba);
    });

    this.el.random.addEventListener('click', () => {
      const { base, type } = randomPalette();
      this.state.set('harmonyType', type);
      this.state.set('primary', base);
      toast(t('toasts.randomPalette', { name: t(`theory.harmonies.${type}`) }), 'info');
    });

    bindMenu(this.el.exportBtn, this.el.exportMenu, (kind) => this.exportAs(kind));
  }

  /* --------------------------- Exportar ---------------------------- */

  /**
   * Exporta la armonía y la escala tonal actuales.
   * @param {'copyHex'|'copyCss'|'png'|'gpl'|'json'} kind
   */
  async exportAs(kind) {
    const { harmony: colors, scale, type } = this.palette;
    const hexes = colors.map((c) => rgbaToHex(c.rgba).toUpperCase());
    const tones = scale.colors.map((c) => rgbaToHex(c).toUpperCase());
    const name = sanitizeFileName(this.getName());
    const harmonyName = t(`theory.harmonies.${type}`);

    if (kind === 'copyHex' || kind === 'copyCss') {
      const text = kind === 'copyHex'
        ? `${harmonyName}: ${hexes.join(', ')}\n${t('theory.scale')}: ${tones.join(', ')}`
        : [':root {',
          ...hexes.map((h, i) => `  --armonia-${i + 1}: ${h};`),
          ...tones.map((h, i) => `  --tono-${(i + 1) * 100 - 50}: ${h};`),
          '}'].join('\n');
      const ok = await copyText(text);
      toast(ok ? t('toasts.copied', { value: kind === 'copyHex' ? hexes.join(', ') : 'CSS' }) : t('toasts.copyFailed'), ok ? 'success' : 'error');
      return;
    }

    let blob;
    let file;
    if (kind === 'json') {
      const data = {
        armonia: { tipo: type, nombre: harmonyName, colores: colors.map((c) => ({ desplazamiento: c.offset, ...describeColor(c.rgba) })) },
        escalaTonal: { modo: this.state.get('scaleMode'), colores: scale.colors.map(describeColor) },
      };
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      file = `${name}-armonia.json`;
    } else if (kind === 'gpl') {
      blob = toGpl(`${name} · ${harmonyName}`, [
        ...colors.map((c, i) => ({ rgba: c.rgba, label: `${harmonyName} ${i + 1}` })),
        ...scale.colors.map((rgba, i) => ({ rgba, label: `${t('theory.scale')} ${i + 1}` })),
      ]);
      file = `${name}-armonia.gpl`;
    } else {
      blob = await renderPaletteImage([
        { label: harmonyName, colors: colors.map((c) => c.rgba) },
        { label: t('theory.scale'), colors: scale.colors },
      ]);
      file = `${name}-armonia.png`;
    }
    const result = await downloadBlob(blob, file);
    if (result === 'saved') toast(t('toasts.paletteExported', { file }), 'success');
    else if (result === 'failed') toast(t('errors.download'), 'error');
  }
}
