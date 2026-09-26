/**
 * @file preview.js
 * Panel de vista previa: muestra el personaje "como en el juego"
 * (sin cuadrícula ni guías), con animaciones y rotación libre.
 */
import { SkinRenderer } from '../render/renderer.js';
import { OrbitCamera } from '../render/camera.js';
import { rotationX, rotationZ } from '../render/math.js';
import { PART, PART_ORDER } from '../core/skin-model.js';
import { readCssColor } from '../ui/theme.js';

/**
 * Calcula la pose (rotación de cada parte) para un instante de la animación.
 * Las rotaciones son alrededor del pivote de cada parte (hombros, cadera, cuello).
 * @param {string} name Nombre de la animación.
 * @param {number} t Tiempo en segundos.
 * @returns {Record<string, Float32Array>}
 */
export function computePose(name, t) {
  const pose = {};
  switch (name) {
    case 'idle': {
      // Respiración: los brazos se balancean muy levemente.
      const s = Math.sin(t * 1.6) * 0.05;
      pose[PART.RIGHT_ARM] = rotationZ(-0.05 - s);
      pose[PART.LEFT_ARM] = rotationZ(0.05 + s);
      pose[PART.HEAD] = rotationX(Math.sin(t * 0.8) * 0.05);
      break;
    }
    case 'walk':
    case 'run': {
      const fast = name === 'run';
      const swing = Math.sin(t * (fast ? 10 : 5.5)) * (fast ? 1.1 : 0.6);
      pose[PART.RIGHT_ARM] = rotationX(swing);
      pose[PART.LEFT_ARM] = rotationX(-swing);
      pose[PART.RIGHT_LEG] = rotationX(-swing);
      pose[PART.LEFT_LEG] = rotationX(swing);
      break;
    }
    case 'wave': {
      // Brazo derecho levantado que se mueve de lado a lado.
      const wave = Math.sin(t * 7) * 0.35;
      pose[PART.RIGHT_ARM] = rotationZ(-2.6 + wave);
      pose[PART.LEFT_ARM] = rotationZ(0.06);
      pose[PART.HEAD] = rotationZ(Math.sin(t * 3.5) * 0.06);
      break;
    }
    default:
      break;
  }
  return pose;
}

export class Preview {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} deps
   * @param {import('../core/skin-document.js').SkinDocument} deps.doc
   * @param {import('./editor-state.js').EditorState} deps.state
   */
  constructor(canvas, { doc, state }) {
    this.canvas = canvas;
    this.doc = doc;
    this.state = state;
    this.renderer = new SkinRenderer(canvas, { preserveDrawingBuffer: true });
    this.renderer.options.checkerEmpty = false; // como en el juego
    this.renderer.options.grid = false;
    this.renderer.options.activeLayer = null;   // ninguna capa se atenúa
    this.camera = new OrbitCamera({ fov: 35, distance: 64 });
    this.camera.yaw = 0.5;
    this.camera.pitch = 0.12;
    this.time = 0;
    this.dragging = false;
    this._last = 0;
    this._raf = 0;

    this.renderer.setModel(doc.model);
    this.renderer.updateTexture(doc.pixels);
    this.syncState();
    this.refreshTheme();
    this._bindEvents();
    new ResizeObserver(() => this.requestRender()).observe(canvas);
  }

  /** ¿Necesita dibujarse continuamente? */
  get animating() {
    return this.state.get('autoRotate') || this.state.get('animation') !== 'none';
  }

  syncState() {
    const showOverlay = this.state.get('previewOverlay');
    this.renderer.visibility = Object.fromEntries(PART_ORDER.map((p) => [p, { base: true, overlay: showOverlay }]));
    this.requestRender();
  }

  refreshTheme() {
    this.renderer.options.clearColor = readCssColor('--preview-bg');
    this.requestRender();
  }

  /**
   * Cambia la imagen de fondo (null = color del tema).
   * @param {Parameters<SkinRenderer['setBackground']>[0]} source
   */
  setBackground(source) {
    this.renderer.setBackground(source);
    this.requestRender();
  }

  onTextureChange() {
    this.renderer.updateTexture(this.doc.pixels);
    this.requestRender();
  }

  onModelChange() {
    this.renderer.setModel(this.doc.model);
    this.requestRender();
  }

  /** Dibuja un cuadro; si hay animación, programa el siguiente. */
  requestRender() {
    if (this._raf) return;
    this._raf = requestAnimationFrame((now) => {
      this._raf = 0;
      const dt = this._last ? Math.min(0.1, (now - this._last) / 1000) : 0;
      this._last = now;
      if (this.animating) {
        this.time += dt;
        if (this.state.get('autoRotate') && !this.dragging) this.camera.rotate(-dt * 0.6, 0);
      }
      this.renderer.render(this.camera, { pose: computePose(this.state.get('animation'), this.time) });
      if (this.animating) this.requestRender();
      else this._last = 0;
    });
  }

  resetCamera() {
    this.camera.reset();
    this.camera.distance = 64;
    this.camera.yaw = 0.5;
    this.camera.pitch = 0.12;
    this.requestRender();
  }

  /**
   * Genera una imagen PNG de la vista previa.
   * @returns {Promise<Blob>}
   */
  capture() {
    // Se dibuja justo antes de leer para garantizar que el búfer esté completo.
    this.renderer.render(this.camera, { pose: computePose(this.state.get('animation'), this.time) });
    return new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
  }

  /**
   * Captura con un encuadre fijo, sin animación y con el fondo liso del tema
   * (para que el agente revise la skin sin distracciones).
   * @param {'front'|'back'|'left'|'right'} [angle='front'] Vista 3/4 desde ese lado.
   * @returns {Promise<Blob>}
   */
  captureStandard(angle = 'front') {
    const yaw = { front: 0.45, back: Math.PI + 0.45, left: Math.PI / 2 + 0.3, right: -Math.PI / 2 - 0.3 }[angle] ?? 0.45;
    const saved = { yaw: this.camera.yaw, pitch: this.camera.pitch, distance: this.camera.distance, target: [...this.camera.target] };
    this.camera.reset();
    Object.assign(this.camera, { yaw, pitch: 0.15, distance: 60 });
    this.renderer.render(this.camera, { pose: {}, background: false });
    const promise = new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
    Object.assign(this.camera, saved);
    this.requestRender(); // vuelve a mostrar el fondo elegido
    return promise;
  }

  _bindEvents() {
    const c = this.canvas;
    let last = null;
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY, pan: e.button === 1 || e.button === 2 };
      this.dragging = true;
      c.classList.add('is-grabbing');
    });
    c.addEventListener('pointermove', (e) => {
      if (!last) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last.x = e.clientX; last.y = e.clientY;
      if (last.pan) this.camera.pan(dx, dy, c.clientHeight);
      else this.camera.rotate(dx * 0.01, dy * 0.01);
      this.requestRender();
    });
    const up = () => { last = null; this.dragging = false; c.classList.remove('is-grabbing'); };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', () => this.resetCamera());
    c.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) return; // solo la rueda sola hace zoom
      e.preventDefault();
      this.camera.zoom(Math.exp(e.deltaY * 0.0015));
      this.requestRender();
    }, { passive: false });
  }
}
