/**
 * @file editor-state.js
 * Estado de la interfaz del editor (no de la skin): herramienta activa,
 * colores, tamaño del pincel, capa activa, visibilidad, etc.
 *
 * Emite "change" con { key, value } cada vez que algo cambia, para que
 * la barra de herramientas, las vistas y los paneles se sincronicen.
 */
import { Emitter } from '../utils/emitter.js';
import { LAYER, STORAGE_KEYS, RECENT_COLORS_LIMIT } from '../config.js';
import { PART_ORDER } from '../core/skin-model.js';
import { loadJSON, saveJSON } from '../utils/storage.js';
import { rgbaToHex, sameColor } from '../utils/color.js';

/** Preferencias que se recuerdan entre sesiones. */
const PERSISTED = ['tool', 'brushSize', 'intensity', 'mirror', 'grid', 'dimInactive', 'viewMode',
  'autoRotate', 'animation', 'previewBackground', 'adaptArms', 'primary', 'secondary',
  'colorFormat', 'colorGrouping', 'harmonyType', 'scaleMode'];

export class EditorState extends Emitter {
  constructor() {
    super();
    const saved = loadJSON(STORAGE_KEYS.SETTINGS, {});
    /** Valores por defecto (sobrescritos por lo guardado). */
    this.values = {
      tool: 'pencil',
      primary: [47, 127, 122, 255],
      secondary: [255, 255, 255, 255],
      brushSize: 1,
      intensity: 0.25,
      mirror: false,
      grid: true,
      dimInactive: true,
      activeLayer: LAYER.BASE,
      viewMode: '3d',
      autoRotate: true,
      animation: 'walk',
      previewBackground: 'default', // fondo de la vista previa (ver core/backgrounds.js)
      previewOverlay: true,
      adaptArms: true,
      colorFormat: 'hex',        // formato del campo de color: hex | rgb | hsl | oklch
      colorGrouping: 'similar',  // agrupación de "Colores de tu skin": exact | similar | wide
      harmonyType: 'complementary',
      scaleMode: 'linear',       // escala tonal: linear | pixelart
      visibility: Object.fromEntries(PART_ORDER.map((p) => [p, { base: true, overlay: true }])),
      ...Object.fromEntries(PERSISTED.filter((k) => k in saved).map((k) => [k, saved[k]])),
    };
    /** @type {number[][]} */
    this.recentColors = loadJSON(STORAGE_KEYS.RECENT_COLORS, []);
  }

  /** Lee un valor. */
  get(key) {
    return this.values[key];
  }

  /**
   * Cambia un valor y avisa a los suscriptores.
   * @param {string} key
   * @param {*} value
   */
  set(key, value) {
    this.values[key] = value;
    if (PERSISTED.includes(key)) this._persist();
    this.emit('change', { key, value });
  }

  /** Invierte un valor booleano. */
  toggle(key) {
    this.set(key, !this.values[key]);
  }

  /**
   * Cambia la visibilidad de una parte en una capa.
   * @param {string} part
   * @param {string} layer
   * @param {boolean} [visible] Si se omite, se invierte.
   */
  setVisibility(part, layer, visible) {
    const vis = structuredClone(this.values.visibility);
    vis[part][layer] = visible ?? !vis[part][layer];
    this.set('visibility', vis);
  }

  /** Muestra u oculta una capa completa. */
  setLayerVisibility(layer, visible) {
    const vis = structuredClone(this.values.visibility);
    PART_ORDER.forEach((p) => { vis[p][layer] = visible; });
    this.set('visibility', vis);
  }

  /** ¿Hay al menos una parte visible en la capa? */
  isLayerVisible(layer) {
    return PART_ORDER.some((p) => this.values.visibility[p][layer]);
  }

  /** Intercambia color principal y secundario. */
  swapColors() {
    const { primary, secondary } = this.values;
    this.set('primary', secondary);
    this.set('secondary', primary);
  }

  /** Agrega un color al historial de recientes (sin duplicados). */
  addRecentColor(rgba) {
    this.recentColors = [rgba, ...this.recentColors.filter((c) => !sameColor(c, rgba))].slice(0, RECENT_COLORS_LIMIT);
    saveJSON(STORAGE_KEYS.RECENT_COLORS, this.recentColors);
    this.emit('change', { key: 'recentColors', value: this.recentColors });
  }

  _persist() {
    saveJSON(STORAGE_KEYS.SETTINGS, Object.fromEntries(PERSISTED.map((k) => [k, this.values[k]])));
  }

  /** Color principal en formato HEX (para mostrar). */
  get primaryHex() {
    return rgbaToHex(this.values.primary);
  }
}
