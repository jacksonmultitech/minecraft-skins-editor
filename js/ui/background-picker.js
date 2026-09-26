/**
 * @file background-picker.js
 * Selector "Fondo" de la vista previa: fondos al estilo de Minecraft
 * generados por código o una imagen propia.
 *
 * La imagen personalizada se reduce (lado mayor ≤ 1024 px), se guarda como
 * JPEG en el almacenamiento local y se vuelve a cargar al abrir el editor.
 * Si no cabe en el almacenamiento, se usa solo durante esta sesión.
 */
import { t } from '../i18n/i18n.js';
import { STORAGE_KEYS } from '../config.js';
import { loadJSON, saveJSON } from '../utils/storage.js';
import { generateBackground, BACKGROUND_IDS } from '../core/backgrounds.js';
import { toast } from './toast.js';

/** Lado mayor de la imagen personalizada guardada. */
const MAX_IMAGE_SIDE = 1024;

export class BackgroundPicker {
  /**
   * @param {object} deps
   * @param {HTMLSelectElement} deps.select
   * @param {HTMLButtonElement} deps.uploadButton
   * @param {HTMLInputElement} deps.fileInput
   * @param {import('../editor/editor-state.js').EditorState} deps.state
   * @param {import('../editor/preview.js').Preview} deps.preview
   */
  constructor({ select, uploadButton, fileInput, state, preview }) {
    this.select = select;
    this.uploadButton = uploadButton;
    this.fileInput = fileInput;
    this.state = state;
    this.preview = preview;
    /** @type {HTMLImageElement | null} */
    this.customImage = null;

    this._buildOptions();
    this._bind();
    this.ready = this._restoreCustomImage().then(() => this.apply());
  }

  _buildOptions() {
    this.select.replaceChildren(...BACKGROUND_IDS.map((id) => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = t(`preview.bg.${id}`);
      return option;
    }));
    this.select.value = this.state.get('previewBackground');
  }

  _bind() {
    this.select.addEventListener('change', () => {
      const id = this.select.value;
      if (id === 'custom' && !this.customImage) {
        // Aún no hay imagen: se mantiene el fondo anterior hasta que el usuario elija una.
        this.select.value = this.state.get('previewBackground');
        this.fileInput.click();
        return;
      }
      this.state.set('previewBackground', id);
    });
    this.uploadButton.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', async () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = ''; // permite volver a elegir el mismo archivo
      if (file) await this.loadFile(file);
    });
  }

  /** Aplica el fondo elegido en el estado a la vista previa. */
  apply() {
    let id = this.state.get('previewBackground');
    if (!BACKGROUND_IDS.includes(id) || (id === 'custom' && !this.customImage)) id = 'default';
    this.select.value = id;
    if (id === 'custom') this.preview.setBackground({ image: this.customImage, smooth: true });
    else {
      const generated = generateBackground(id);
      this.preview.setBackground(generated ? { ...generated, smooth: false } : null);
    }
  }

  /**
   * Usa una imagen del usuario como fondo.
   * @param {File} file
   */
  async loadFile(file) {
    if (!file.type.startsWith('image/')) {
      toast(t('errors.notImage'), 'error');
      return;
    }
    try {
      const dataUrl = await shrinkImage(file, MAX_IMAGE_SIDE);
      this.customImage = await loadImage(dataUrl);
      const saved = saveJSON(STORAGE_KEYS.PREVIEW_BACKGROUND_IMAGE, dataUrl);
      if (this.state.get('previewBackground') === 'custom') this.apply();
      else this.state.set('previewBackground', 'custom');
      toast(saved ? t('preview.bgLoaded') : t('preview.bgNotSaved'), saved ? 'success' : 'warning', saved ? 3000 : 6000);
    } catch {
      toast(t('errors.decode'), 'error');
    }
  }

  async _restoreCustomImage() {
    const dataUrl = loadJSON(STORAGE_KEYS.PREVIEW_BACKGROUND_IMAGE, null);
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return;
    try {
      this.customImage = await loadImage(dataUrl);
    } catch {
      this.customImage = null; // imagen dañada: se usa el fondo predeterminado
    }
  }
}

/** Carga una imagen desde una URL (data:) y espera a que esté decodificada. */
function loadImage(src) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

/**
 * Reduce una imagen para que su lado mayor no pase de `maxSide` y la
 * devuelve como JPEG en una URL data: (ocupa poco en el almacenamiento).
 * @param {Blob} file
 * @param {number} maxSide
 * @returns {Promise<string>}
 */
async function shrinkImage(file, maxSide) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000'; // JPEG no guarda transparencia: esas zonas quedan en negro
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return canvas.toDataURL('image/jpeg', 0.88);
}
