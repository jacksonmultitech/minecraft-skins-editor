/**
 * @file color-panel.js
 * Panel de color: selector HSV (cuadro de saturación/brillo + tono),
 * opacidad, entrada en varios formatos (HEX, RGB, HSL, OKLCH), valores
 * copiables, cuentagotas de pantalla, colores principal/secundario y paletas
 * (recientes, colores de la skin agrupados y paletas predefinidas).
 */
import { t } from '../i18n/i18n.js';
import { hexToRgba, rgbaToHex, rgbToHsv, hsvToRgb, clamp, parseColor, formatColor, COLOR_FORMATS } from '../utils/color.js';
import { copyText } from '../utils/clipboard.js';
import { getRegionMap } from '../core/skin-model.js';
import { groupSkinColors } from '../core/color-theory.js';
import { toast } from './toast.js';
import { bindMenu } from './menu.js';
import { renderPaletteImage, toGpl, describeColor } from './palette-export.js';
import { downloadBlob, sanitizeFileName } from '../core/skin-io.js';

/** Paletas predefinidas pensadas para skins. */
const PRESETS = {
  skin: ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#6b3e26', '#4a2912', '#f6d5c3'],
  hair: ['#1c1c1c', '#3b2417', '#6a4e42', '#a0522d', '#d2a15a', '#f3d48a', '#b7b7b7', '#c43c3c'],
  clothes: ['#2f7f7a', '#35507a', '#1f3b73', '#6a4c9c', '#8e2f3c', '#3f6b2c', '#c9a227', '#e07b39'],
  basic: ['#000000', '#3f3f3f', '#7f7f7f', '#bfbfbf', '#ffffff', '#ff0000', '#00ff00', '#0000ff'],
};

/** Tolerancia (distancia OKLab) de cada nivel de agrupación. */
const GROUPING_TOLERANCE = { exact: 0, similar: 0.04, wide: 0.085 };

export class ColorPanel {
  /**
   * @param {HTMLElement} root Elemento del panel.
   * @param {object} deps
   * @param {import('../editor/editor-state.js').EditorState} deps.state
   * @param {import('../core/skin-document.js').SkinDocument} deps.doc
   */
  constructor(root, { state, doc }) {
    this.root = root;
    this.state = state;
    this.doc = doc;
    this.$ = (sel) => root.querySelector(sel);
    this.hsv = { h: 0, s: 0, v: 0 };
    this.alpha = 255;
    this._skinColorsTimer = 0;

    this.el = {
      primary: this.$('#color-primary'),
      secondary: this.$('#color-secondary'),
      swap: this.$('#btn-swap-colors'),
      eyedropper: this.$('#btn-eyedropper'),
      sv: this.$('#sv-area'),
      svHandle: this.$('#sv-handle'),
      hue: this.$('#hue-range'),
      alpha: this.$('#alpha-range'),
      alphaValue: this.$('#alpha-value'),
      input: this.$('#color-input'),
      format: this.$('#color-format'),
      copy: this.$('#btn-copy-color'),
      values: this.$('#color-values'),
      presets: this.$('#palette-presets'),
      skinColors: this.$('#palette-skin'),
      recent: this.$('#palette-recent'),
      paletteBtn: this.$('#btn-skin-palette'),
      paletteMenu: this.$('#menu-skin-palette'),
    };

    this._buildFormats();
    this._renderPresets();
    this._bind();
    this.syncFromState();
    this.refreshSkinColors();
    this.renderRecent();
  }

  /* ---------------------- Estado → interfaz ---------------------- */

  /** Actualiza el selector con el color principal actual. */
  syncFromState() {
    const [r, g, b, a] = this.state.get('primary');
    const hsv = rgbToHsv(r, g, b);
    // Conservar el tono si el color es gris (en HSV el tono queda indefinido).
    if (hsv.s === 0 || hsv.v === 0) hsv.h = this.hsv.h;
    this.hsv = hsv;
    this.alpha = a;
    this._paint();
  }

  _paint() {
    const { h, s, v } = this.hsv;
    const primary = this.state.get('primary');
    const secondary = this.state.get('secondary');
    const format = this.state.get('colorFormat');
    this.el.sv.style.setProperty('--hue', `hsl(${h} 100% 50%)`);
    this.el.svHandle.style.left = `${s * 100}%`;
    this.el.svHandle.style.top = `${(1 - v) * 100}%`;
    this.el.hue.value = String(Math.round(h));
    this.el.alpha.value = String(this.alpha);
    this.el.alpha.style.setProperty('--alpha-color', rgbaToHex(primary));
    this.el.alphaValue.textContent = `${Math.round((this.alpha / 255) * 100)}%`;
    this.el.format.value = format;
    if (document.activeElement !== this.el.input) this.el.input.value = formatColor(primary, format);
    this.el.primary.style.setProperty('--swatch', this._css(primary));
    this.el.secondary.style.setProperty('--swatch', this._css(secondary));
    this.el.sv.setAttribute('aria-valuetext', `${Math.round(s * 100)}%, ${Math.round(v * 100)}%`);

    // Valores en los 4 formatos (clic para copiar).
    this.el.values.querySelectorAll('[data-format]').forEach((b) => {
      const value = formatColor(primary, b.dataset.format, { compact: true });
      b.querySelector('.color-values__value').textContent = value;
      b.dataset.copy = formatColor(primary, b.dataset.format);
      b.title = t('color.copyValue', { value: b.dataset.copy });
    });
  }

  _css([r, g, b, a]) {
    return `rgb(${r} ${g} ${b} / ${(a / 255).toFixed(3)})`;
  }

  /* ---------------------- Interfaz → estado ---------------------- */

  /** Aplica el HSV + alfa actuales como color principal. */
  _commit() {
    const [r, g, b] = hsvToRgb(this.hsv.h, this.hsv.s, this.hsv.v);
    this.state.set('primary', [r, g, b, this.alpha]);
  }

  async _copy(text) {
    const ok = await copyText(text);
    toast(ok ? t('toasts.copied', { value: text }) : t('toasts.copyFailed'), ok ? 'success' : 'error');
  }

  _buildFormats() {
    this.el.format.replaceChildren(...COLOR_FORMATS.map((f) => {
      const o = document.createElement('option');
      o.value = f;
      o.textContent = f.toUpperCase();
      return o;
    }));
    this.el.values.replaceChildren(...COLOR_FORMATS.map((f) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'color-values__item';
      b.dataset.format = f;
      const label = document.createElement('span');
      label.className = 'color-values__label';
      label.textContent = f.toUpperCase();
      const value = document.createElement('span');
      value.className = 'color-values__value';
      b.append(label, value);
      return b;
    }));
  }

  _bind() {
    // Cuadro de saturación/brillo: arrastre con puntero.
    const updateSV = (e) => {
      const rect = this.el.sv.getBoundingClientRect();
      this.hsv.s = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      this.hsv.v = clamp(1 - (e.clientY - rect.top) / rect.height, 0, 1);
      this._commit();
    };
    this.el.sv.addEventListener('pointerdown', (e) => {
      this.el.sv.setPointerCapture(e.pointerId);
      updateSV(e);
      this.el.sv.addEventListener('pointermove', updateSV);
    });
    const stop = () => {
      this.el.sv.removeEventListener('pointermove', updateSV);
      this.state.addRecentColor(this.state.get('primary'));
    };
    this.el.sv.addEventListener('pointerup', stop);
    this.el.sv.addEventListener('pointercancel', stop);
    // Accesible con teclado: flechas ajustan saturación (←→) y brillo (↑↓).
    this.el.sv.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.02;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      const m = moves[e.key];
      if (!m) return;
      e.preventDefault();
      e.stopPropagation();
      this.hsv.s = clamp(this.hsv.s + m[0], 0, 1);
      this.hsv.v = clamp(this.hsv.v + m[1], 0, 1);
      this._commit();
    });

    this.el.hue.addEventListener('input', () => {
      this.hsv.h = Number(this.el.hue.value);
      this._commit();
    });
    this.el.alpha.addEventListener('input', () => {
      this.alpha = Number(this.el.alpha.value);
      this._commit();
    });

    // Entrada de texto: acepta cualquier formato, no solo el elegido.
    this.el.input.addEventListener('change', () => {
      const rgba = parseColor(this.el.input.value);
      if (rgba) {
        this.state.set('primary', rgba);
        this.state.addRecentColor(rgba);
      } else {
        toast(t('color.invalid'), 'error', 5000);
        this._paint(); // valor inválido: restaurar
      }
    });
    this.el.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.el.input.blur(); });
    this.el.format.addEventListener('change', () => this.state.set('colorFormat', this.el.format.value));
    this.el.copy.addEventListener('click', () => this._copy(formatColor(this.state.get('primary'), this.state.get('colorFormat'))));
    this.el.values.addEventListener('click', (e) => {
      const item = e.target.closest('[data-copy]');
      if (item) this._copy(item.dataset.copy);
    });

    this.el.swap.addEventListener('click', () => this.state.swapColors());
    this.el.secondary.addEventListener('click', () => this.state.swapColors());

    // Descargar la paleta de colores de la skin.
    bindMenu(this.el.paletteBtn, this.el.paletteMenu, (kind) => this.exportSkinPalette(kind));

    // Cuentagotas de pantalla (API nativa EyeDropper, disponible en Chrome/Edge).
    if ('EyeDropper' in window) {
      this.el.eyedropper.hidden = false;
      this.el.eyedropper.addEventListener('click', async () => {
        try {
          const { sRGBHex } = await new window.EyeDropper().open();
          const rgba = parseColor(sRGBHex);
          if (rgba) { this.state.set('primary', rgba); this.state.addRecentColor(rgba); }
        } catch {
          /* El usuario canceló con Esc o el navegador lo bloqueó. */
        }
      });
    }

    // Clic en cualquier muestra de paleta → color principal.
    this.root.addEventListener('click', (e) => {
      const swatch = e.target.closest('[data-color]');
      if (!swatch) return;
      const rgba = hexToRgba(swatch.dataset.color);
      if (rgba) this.state.set('primary', rgba);
    });
  }

  /* --------------------------- Paletas --------------------------- */

  _swatch(hex, title = hex.toUpperCase()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.color = hex;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.style.setProperty('--swatch', hex);
    return b;
  }

  _renderPresets() {
    const groups = t('color.groups');
    this.el.presets.replaceChildren(...Object.entries(PRESETS).map(([key, colors]) => {
      const wrap = document.createElement('div');
      wrap.className = 'palette__group';
      const label = document.createElement('span');
      label.className = 'palette__label';
      label.textContent = groups[key];
      const row = document.createElement('div');
      row.className = 'palette__row';
      row.append(...colors.map((c) => this._swatch(c)));
      wrap.append(label, row);
      return wrap;
    }));
  }

  /** Muestra los colores recientes. */
  renderRecent() {
    const colors = this.state.recentColors.map((c) => rgbaToHex(c, true));
    this.el.recent.replaceChildren(...colors.map((c) => this._swatch(c)));
    this.el.recent.closest('.palette__group').hidden = colors.length === 0;
  }

  /** Tolerancia de agrupación elegida por el usuario. */
  get _tolerance() {
    return GROUPING_TOLERANCE[this.state.get('colorGrouping')] ?? GROUPING_TOLERANCE.similar;
  }

  /**
   * Descarga (o copia) la paleta de colores que usa la skin, con el mismo
   * nivel de agrupación que se ve en pantalla pero sin límite de muestras.
   * @param {'png'|'gpl'|'json'|'txt'|'copy'} kind
   */
  async exportSkinPalette(kind) {
    const { lookup } = getRegionMap(this.doc.model);
    const families = groupSkinColors(this.doc.pixels, lookup, { tolerance: this._tolerance, limit: Infinity });
    if (families.length === 0) {
      toast(t('toasts.noColorsToExport'), 'warning');
      return;
    }
    const name = sanitizeFileName(this.doc.name);
    const familyName = (f) => t(`color.families.${f}`);
    const hexList = families.map((f) => `${familyName(f.family)}: ${f.groups.map((g) => g.hex.toUpperCase()).join(', ')}`).join('\n');

    if (kind === 'copy') {
      const ok = await copyText(hexList);
      toast(ok ? t('toasts.copied', { value: t('color.skinColors') }) : t('toasts.copyFailed'), ok ? 'success' : 'error');
      return;
    }

    let blob;
    if (kind === 'png') {
      blob = await renderPaletteImage(
        families.map((f) => ({ label: familyName(f.family), colors: f.groups.map((g) => g.rgba) })),
        { cell: 64, columns: 12 },
      );
    } else if (kind === 'gpl') {
      blob = toGpl(t('color.paletteTitle', { name }), families.flatMap((f) => f.groups.map((g, i) => ({
        rgba: g.rgba, label: `${familyName(f.family)} ${i + 1}`,
      }))));
    } else if (kind === 'json') {
      const data = {
        skin: name,
        agrupacion: this.state.get('colorGrouping'),
        familias: families.map((f) => ({
          familia: f.family,
          nombre: familyName(f.family),
          colores: f.groups.map((g) => ({ ...describeColor(g.rgba), pixeles: g.pixels, tonosUnidos: g.variants })),
        })),
      };
      blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    } else {
      blob = new Blob([`${t('color.paletteTitle', { name })}\n\n${hexList}\n`], { type: 'text/plain' });
    }
    const file = `${name}-colores.${kind}`;
    const result = await downloadBlob(blob, file);
    if (result === 'saved') toast(t('toasts.paletteExported', { file }), 'success');
    else if (result === 'failed') toast(t('errors.download'), 'error');
  }

  /**
   * Recalcula los colores de la skin: une los casi iguales, los agrupa por
   * familia (rojos, azules, neutros…) y los ordena de claro a oscuro.
   * Se ejecuta con retardo para no hacerlo en cada píxel pintado.
   */
  refreshSkinColors() {
    clearTimeout(this._skinColorsTimer);
    this._skinColorsTimer = setTimeout(() => {
      const { lookup } = getRegionMap(this.doc.model);
      // Sin agrupar hay muchas más variantes: se muestran más muestras.
      const limit = this.state.get('colorGrouping') === 'exact' ? 64 : 48;
      const families = groupSkinColors(this.doc.pixels, lookup, { tolerance: this._tolerance, limit });
      if (families.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'palette__empty';
        empty.textContent = t('color.noSkinColors');
        this.el.skinColors.replaceChildren(empty);
        return;
      }
      this.el.skinColors.replaceChildren(...families.map(({ family, groups }) => {
        const wrap = document.createElement('div');
        wrap.className = 'skin-family';
        const label = document.createElement('span');
        label.className = 'skin-family__label';
        label.textContent = t(`color.families.${family}`);
        const count = document.createElement('small');
        count.textContent = String(groups.length);
        label.append(count);
        const row = document.createElement('div');
        row.className = 'palette__row';
        row.append(...groups.map((g) => {
          const params = { hex: g.hex.toUpperCase(), pixels: g.pixels, n: g.variants };
          const b = this._swatch(g.hex, t(g.variants > 1 ? 'color.swatchMerged' : 'color.swatchInfo', params));
          if (g.variants > 1) b.classList.add('swatch--merged');
          return b;
        }));
        wrap.append(label, row);
        return wrap;
      }));
    }, 250);
  }
}
