/**
 * @file renderer.js
 * Renderizador WebGL2 del personaje, escrito sin librerías externas.
 *
 * Dibuja 12 cajas (6 partes × 2 capas) con la textura de la skin usando
 * filtrado "nearest" (píxeles nítidos). El shader además puede dibujar:
 *  - una cuadrícula sobre cada píxel,
 *  - el resaltado del píxel bajo el cursor (y su simétrico en modo espejo),
 *  - un patrón de ajedrez donde la capa base es transparente.
 * Opcionalmente dibuja una imagen de fondo detrás del personaje (vista previa).
 */
import { SKIN_WIDTH, SKIN_HEIGHT, LAYER, OVERLAY_ALPHA_CUTOFF } from '../config.js';
import { getBoxes, PART_ORDER } from '../core/skin-model.js';
import { multiply, translation, identity } from './math.js';

/* ------------------------------------------------------------------------ */
/* Shaders (GLSL ES 3.00)                                                     */
/* ------------------------------------------------------------------------ */

const VERTEX_SHADER = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUV;
uniform mat4 uViewProjection;
uniform mat4 uModel;
out vec2 vUV;
out vec3 vNormal;
void main() {
  vUV = aUV;
  vNormal = mat3(uModel) * aNormal;
  gl_Position = uViewProjection * uModel * vec4(aPosition, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vNormal;
uniform sampler2D uTexture;
uniform bool uIsOverlay;       // capa externa: descarta píxeles transparentes
uniform float uAlphaCutoff;
uniform bool uGrid;            // dibujar cuadrícula
uniform bool uEmptyGrid;       // en capa externa: mostrar cuadrícula de píxeles vacíos
uniform vec4 uGridColor;
uniform bool uCheckerEmpty;    // base transparente → ajedrez (editor) o negro (juego)
uniform vec2 uHover;           // píxel resaltado (−1 = ninguno)
uniform vec2 uHoverMirror;     // píxel simétrico resaltado
uniform vec4 uHoverColor;
uniform float uOpacity;        // atenuar capa inactiva
out vec4 outColor;

float gridFactor(vec2 texel) {
  vec2 f = fract(texel);
  vec2 w = fwidth(texel);
  vec2 d = min(f, 1.0 - f) / max(w, vec2(1e-5));
  return 1.0 - clamp(min(d.x, d.y), 0.0, 1.0);
}

void main() {
  vec2 texel = vUV * vec2(${SKIN_WIDTH}.0, ${SKIN_HEIGHT}.0);
  vec2 cell = floor(texel);
  vec4 color = texture(uTexture, (cell + 0.5) / vec2(${SKIN_WIDTH}.0, ${SKIN_HEIGHT}.0));

  bool hovered = cell == uHover || cell == uHoverMirror;
  float grid = uGrid ? gridFactor(texel) : 0.0;

  // Iluminación simple por cara (similar al sombreado de Minecraft).
  vec3 n = normalize(vNormal);
  float light = 0.62 + 0.38 * max(dot(n, normalize(vec3(0.35, 0.9, 0.55))), 0.0);
  light = mix(light, 1.0, 0.25 * max(n.y, 0.0));

  if (uIsOverlay) {
    if (color.a < uAlphaCutoff) {
      // Píxel vacío de la capa externa: solo guías si se está editando esta capa.
      if (hovered) { outColor = vec4(uHoverColor.rgb, 0.55); return; }
      if (uEmptyGrid && grid > 0.0) { outColor = vec4(uGridColor.rgb, uGridColor.a * grid * 0.8); return; }
      discard;
    }
  } else if (color.a < 0.5) {
    if (uCheckerEmpty) {
      float c = mod(cell.x + cell.y, 2.0);
      color = vec4(vec3(mix(0.55, 0.72, c)), 1.0);
    } else {
      color = vec4(0.0, 0.0, 0.0, 1.0); // Java dibuja la base opaca
    }
  } else {
    color.a = 1.0;
  }

  vec3 rgb = color.rgb * light;
  if (hovered) rgb = mix(rgb, uHoverColor.rgb, uHoverColor.a);
  rgb = mix(rgb, uGridColor.rgb, grid * uGridColor.a);
  outColor = vec4(rgb, color.a * uOpacity);
}`;

/* Fondo: un rectángulo que cubre el lienzo y recorta la imagen como "cover". */
const BACKGROUND_VERTEX_SHADER = `#version 300 es
in vec2 aCorner;
uniform vec4 uCover; // escala (xy) y desplazamiento (zw) de las coordenadas de textura
out vec2 vUV;
void main() {
  vec2 uv = aCorner * 0.5 + 0.5;
  vUV = vec2(uv.x, 1.0 - uv.y) * uCover.xy + uCover.zw;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}`;

const BACKGROUND_FRAGMENT_SHADER = `#version 300 es
precision mediump float;
in vec2 vUV;
uniform sampler2D uBackground;
out vec4 outColor;
void main() {
  outColor = vec4(texture(uBackground, vUV).rgb, 1.0);
}`;

/**
 * Escala y desplazamiento de las coordenadas de textura para que la imagen
 * cubra todo el lienzo sin deformarse (se recorta el sobrante, centrado).
 * @param {number} canvasAspect Ancho / alto del lienzo.
 * @param {number} imageAspect Ancho / alto de la imagen.
 * @returns {[number, number, number, number]} [escalaX, escalaY, desplX, desplY]
 */
export function coverTransform(canvasAspect, imageAspect) {
  if (canvasAspect > imageAspect) {
    const sy = imageAspect / canvasAspect;
    return [1, sy, 0, (1 - sy) / 2];
  }
  const sx = canvasAspect / imageAspect;
  return [sx, 1, (1 - sx) / 2, 0];
}

/** Compila un shader y lanza un error legible si falla. */
function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Error al compilar shader: ${log}`);
  }
  return shader;
}

/** Enlaza un programa de shaders. */
function createProgram(gl, vertexSource = VERTEX_SHADER, fragmentSource = FRAGMENT_SHADER) {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Error al enlazar shaders: ${gl.getProgramInfoLog(program)}`);
  }
  return program;
}

/**
 * Genera vértices e índices de una caja a partir de la información de sus caras.
 * Cada cara usa 4 vértices propios (para tener UV y normal independientes).
 */
function buildBoxGeometry(box) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (const face of box.faces) {
    const base = positions.length / 3;
    const corners = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const [s, t] of corners) {
      for (let k = 0; k < 3; k++) {
        positions.push(face.origin[k] + face.uAxis[k] * s * face.uLen + face.vAxis[k] * t * face.vLen);
      }
      normals.push(...face.normal);
      uvs.push((face.rect.x + s * face.rect.w) / SKIN_WIDTH, (face.rect.y + t * face.rect.h) / SKIN_HEIGHT);
    }
    // Orden de vértices antihorario visto desde fuera (necesario para el "culling").
    const u = face.uAxis, v = face.vAxis, n = face.normal;
    const crossUV = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const outward = crossUV[0] * n[0] + crossUV[1] * n[1] + crossUV[2] * n[2] > 0;
    if (outward) indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: new Uint16Array(indices),
  };
}

export class SkinRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {boolean} [options.preserveDrawingBuffer] Necesario para capturas.
   */
  constructor(canvas, { preserveDrawingBuffer = false } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer });
    if (!gl) throw new Error('WEBGL2_UNAVAILABLE');
    this.gl = gl;
    this.program = createProgram(gl);
    this._locateUniforms();

    /** Visibilidad por parte y capa: visibility[part][layer] = boolean. */
    this.visibility = Object.fromEntries(PART_ORDER.map((p) => [p, { base: true, overlay: true }]));
    /** Opciones de dibujo que la vista puede cambiar. */
    this.options = {
      grid: false,
      emptyGrid: false,
      checkerEmpty: true,
      gridColor: [0, 0, 0, 0.35],
      hoverColor: [1, 1, 1, 0.45],
      clearColor: [0.93, 0.93, 0.93],
      inactiveLayerOpacity: 1,
      activeLayer: LAYER.BASE,
    };
    this.hover = null;       // {x, y}
    this.hoverMirror = null; // {x, y}

    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SKIN_WIDTH, SKIN_HEIGHT, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    /** @type {Array<{box: object, vao: WebGLVertexArrayObject, count: number, buffers: WebGLBuffer[]}>} */
    this.meshes = [];
    this.model = null;

    /** Fondo opcional: { texture, width, height } o null (color liso). */
    this.background = null;
    this._backgroundGL = null; // programa y geometría del fondo (se crean al primer uso)
  }

  /**
   * Cambia la imagen de fondo.
   * @param {null | { pixels: Uint8ClampedArray, width: number, height: number, smooth?: boolean }
   *   | { image: TexImageSource & { width: number, height: number }, smooth?: boolean }} source
   *   `null` vuelve al color liso; `smooth` suaviza al escalar (fotos) en lugar de mantener los píxeles nítidos.
   */
  setBackground(source) {
    const { gl } = this;
    if (!source) {
      if (this.background) gl.deleteTexture(this.background.texture);
      this.background = null;
      return;
    }
    this._ensureBackgroundGL();
    const texture = this.background?.texture ?? gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    let width, height;
    if (source.pixels) {
      ({ width, height } = source);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE,
        new Uint8Array(source.pixels.buffer, source.pixels.byteOffset, source.pixels.byteLength));
    } else {
      width = source.image.naturalWidth || source.image.width;
      height = source.image.naturalHeight || source.image.height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source.image);
    }
    if (source.smooth) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.background = { texture, width, height };
  }

  /** Crea el programa y el rectángulo del fondo la primera vez que se necesitan. */
  _ensureBackgroundGL() {
    if (this._backgroundGL) return;
    const { gl } = this;
    const program = createProgram(gl, BACKGROUND_VERTEX_SHADER, BACKGROUND_FRAGMENT_SHADER);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(program, 'aCorner');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this._backgroundGL = {
      program,
      vao,
      uCover: gl.getUniformLocation(program, 'uCover'),
      uBackground: gl.getUniformLocation(program, 'uBackground'),
    };
  }

  /** Dibuja el fondo cubriendo el lienzo (sin escribir profundidad). */
  _drawBackground(width, height) {
    const { gl, background } = this;
    const bg = this._backgroundGL;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.useProgram(bg.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, background.texture);
    gl.uniform1i(bg.uBackground, 0);
    gl.uniform4fv(bg.uCover, coverTransform(width / height, background.width / background.height));
    gl.bindVertexArray(bg.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  _locateUniforms() {
    const { gl, program } = this;
    const names = ['uViewProjection', 'uModel', 'uTexture', 'uIsOverlay', 'uAlphaCutoff', 'uGrid', 'uEmptyGrid',
      'uGridColor', 'uCheckerEmpty', 'uHover', 'uHoverMirror', 'uHoverColor', 'uOpacity'];
    this.u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)]));
    this.a = {
      position: gl.getAttribLocation(program, 'aPosition'),
      normal: gl.getAttribLocation(program, 'aNormal'),
      uv: gl.getAttribLocation(program, 'aUV'),
    };
  }

  /**
   * Cambia el modelo (clásico/delgado) regenerando la geometría.
   * @param {string} model
   */
  setModel(model) {
    if (model === this.model) return;
    const { gl } = this;
    this.meshes.forEach((m) => { gl.deleteVertexArray(m.vao); m.buffers.forEach((b) => gl.deleteBuffer(b)); });
    this.meshes = getBoxes(model).map((box) => {
      const geo = buildBoxGeometry(box);
      const vao = gl.createVertexArray();
      gl.bindVertexArray(vao);
      const buffers = [];
      const attrib = (loc, data, size) => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        buffers.push(buf);
      };
      attrib(this.a.position, geo.positions, 3);
      attrib(this.a.normal, geo.normals, 3);
      attrib(this.a.uv, geo.uvs, 2);
      const ibo = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.indices, gl.STATIC_DRAW);
      buffers.push(ibo);
      gl.bindVertexArray(null);
      return { box, vao, count: geo.indices.length, buffers };
    });
    this.model = model;
  }

  /**
   * Sube los píxeles de la skin a la GPU.
   * @param {Uint8ClampedArray} pixels
   */
  updateTexture(pixels) {
    const { gl } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SKIN_WIDTH, SKIN_HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength));
  }

  /** Ajusta el tamaño interno del lienzo al tamaño en pantalla (nitidez en pantallas HiDPI). */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return { width: w, height: h };
  }

  /** Relación de aspecto actual del lienzo. */
  get aspect() {
    return this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
  }

  /**
   * Matriz de una caja según la pose (rotaciones por parte alrededor de su pivote).
   * @param {object} box
   * @param {Record<string, Float32Array>} [pose] Rotación por parte.
   */
  static boxMatrix(box, pose) {
    const rot = pose?.[box.part];
    if (!rot) return identity();
    const [px, py, pz] = box.pivot;
    return multiply(translation(px, py, pz), multiply(rot, translation(-px, -py, -pz)));
  }

  /**
   * Dibuja la escena.
   * @param {import('./camera.js').OrbitCamera} camera
   * @param {{ pose?: Record<string, Float32Array>, root?: Float32Array, background?: boolean }} [scene]
   *   background: false dibuja solo el color liso aunque haya una imagen de fondo.
   */
  render(camera, { pose, root, background = true } = {}) {
    const { gl, u, options } = this;
    const { width, height } = this.resize();
    gl.viewport(0, 0, width, height);
    const [r, g, b] = options.clearColor;
    gl.clearColor(r, g, b, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (background && this.background) this._drawBackground(width, height);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(u.uTexture, 0);
    gl.uniformMatrix4fv(u.uViewProjection, false, camera.viewProjection(this.aspect));
    gl.uniform1f(u.uAlphaCutoff, OVERLAY_ALPHA_CUTOFF);
    gl.uniform1i(u.uGrid, options.grid ? 1 : 0);
    gl.uniform4fv(u.uGridColor, options.gridColor);
    gl.uniform1i(u.uCheckerEmpty, options.checkerEmpty ? 1 : 0);
    gl.uniform4fv(u.uHoverColor, options.hoverColor);
    gl.uniform2f(u.uHover, this.hover?.x ?? -1, this.hover?.y ?? -1);
    gl.uniform2f(u.uHoverMirror, this.hoverMirror?.x ?? -1, this.hoverMirror?.y ?? -1);

    // 1) Capa base: opaca, con eliminación de caras traseras.
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
    this._drawLayer(LAYER.BASE, pose, root);

    // 2) Capa externa: con transparencia y visible por dentro (sin culling).
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.CULL_FACE);
    this._drawLayer(LAYER.OVERLAY, pose, root);
    gl.disable(gl.BLEND);
  }

  _drawLayer(layer, pose, root) {
    const { gl, u, options } = this;
    const isOverlay = layer === LAYER.OVERLAY;
    const isActive = options.activeLayer === layer;
    gl.uniform1i(u.uIsOverlay, isOverlay ? 1 : 0);
    gl.uniform1i(u.uEmptyGrid, isOverlay && options.emptyGrid && isActive ? 1 : 0);
    gl.uniform1f(u.uOpacity, isActive ? 1 : options.inactiveLayerOpacity);
    // Sin cuadrícula en la capa que no se está editando (menos ruido visual).
    gl.uniform1i(u.uGrid, options.grid && isActive ? 1 : 0);
    for (const mesh of this.meshes) {
      if (mesh.box.layer !== layer || !this.visibility[mesh.box.part][layer]) continue;
      let m = SkinRenderer.boxMatrix(mesh.box, pose);
      if (root) m = multiply(root, m);
      gl.uniformMatrix4fv(u.uModel, false, m);
      gl.bindVertexArray(mesh.vao);
      gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  }
}
