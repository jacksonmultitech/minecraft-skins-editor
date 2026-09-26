/**
 * @file camera.js
 * Cámara orbital: gira alrededor de un punto objetivo, se puede desplazar
 * (paneo) y acercar/alejar (zoom). Usa coordenadas esféricas:
 *  - yaw:   giro horizontal (0 = mirando el frente del personaje),
 *  - pitch: inclinación vertical,
 *  - distance: distancia al objetivo.
 */
import { lookAt, perspective, multiply, invert, transformVec, normalize, sub, add, scale, cross } from './math.js';
import { CAMERA_LIMITS } from '../config.js';
import { clamp } from '../utils/color.js';

const DEFAULTS = Object.freeze({ yaw: -0.5, pitch: 0.25, target: [0, 16, 0] });

export class OrbitCamera {
  /**
   * @param {object} [options]
   * @param {number} [options.fov] Campo de visión vertical en grados.
   * @param {number} [options.distance] Distancia inicial.
   */
  constructor({ fov = 40, distance = CAMERA_LIMITS.DEFAULT_DISTANCE } = {}) {
    this.fov = (fov * Math.PI) / 180;
    this.defaultDistance = distance;
    this.reset();
  }

  /** Vuelve a la posición inicial. */
  reset() {
    this.yaw = DEFAULTS.yaw;
    this.pitch = DEFAULTS.pitch;
    this.distance = this.defaultDistance;
    this.target = [...DEFAULTS.target];
  }

  /**
   * Coloca la cámara mirando una cara concreta.
   * @param {'front'|'back'|'left'|'right'|'top'|'bottom'} view
   */
  setView(view) {
    const views = {
      front: [0, 0], back: [Math.PI, 0], right: [-Math.PI / 2, 0], left: [Math.PI / 2, 0],
      top: [0, CAMERA_LIMITS.MAX_PITCH], bottom: [0, CAMERA_LIMITS.MIN_PITCH],
    };
    [this.yaw, this.pitch] = views[view] ?? views.front;
  }

  /** Posición de la cámara en el mundo. */
  get eye() {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.distance * cp * Math.sin(this.yaw),
      this.target[1] + this.distance * Math.sin(this.pitch),
      this.target[2] + this.distance * cp * Math.cos(this.yaw),
    ];
  }

  /**
   * Gira la cámara.
   * @param {number} dYaw  Radianes horizontales.
   * @param {number} dPitch Radianes verticales.
   */
  rotate(dYaw, dPitch) {
    this.yaw -= dYaw;
    this.pitch = clamp(this.pitch + dPitch, CAMERA_LIMITS.MIN_PITCH, CAMERA_LIMITS.MAX_PITCH);
  }

  /**
   * Desplaza el objetivo en el plano de la pantalla.
   * @param {number} dx Píxeles de pantalla en X.
   * @param {number} dy Píxeles de pantalla en Y.
   * @param {number} viewportHeight Alto del lienzo en píxeles CSS.
   */
  pan(dx, dy, viewportHeight) {
    const worldPerPixel = (2 * this.distance * Math.tan(this.fov / 2)) / viewportHeight;
    const forward = normalize(sub(this.target, this.eye));
    const right = normalize(cross(forward, [0, 1, 0]));
    const up = cross(right, forward);
    const move = add(scale(right, -dx * worldPerPixel), scale(up, dy * worldPerPixel));
    this.target = add(this.target, move);
    // Evita que el objetivo se aleje demasiado del personaje.
    this.target = this.target.map((v, i) => clamp(v, [-40, -20, -40][i], [40, 52, 40][i]));
  }

  /**
   * Acerca (factor < 1) o aleja (factor > 1) la cámara.
   * @param {number} factor
   */
  zoom(factor) {
    this.distance = clamp(this.distance * factor, CAMERA_LIMITS.MIN_DISTANCE, CAMERA_LIMITS.MAX_DISTANCE);
  }

  /** Matriz de vista. */
  viewMatrix() {
    return lookAt(this.eye, this.target, [0, 1, 0]);
  }

  /** Matriz de proyección para la relación de aspecto dada. */
  projectionMatrix(aspect) {
    return perspective(this.fov, aspect, 0.5, 1000);
  }

  /** Producto proyección × vista. */
  viewProjection(aspect) {
    return multiply(this.projectionMatrix(aspect), this.viewMatrix());
  }

  /**
   * Rayo que sale de la cámara y pasa por un punto de la pantalla.
   * @param {number} ndcX Coordenada normalizada (−1 a 1).
   * @param {number} ndcY Coordenada normalizada (−1 a 1, arriba positivo).
   * @param {number} aspect
   * @returns {{origin:number[], dir:number[]}}
   */
  rayFromNDC(ndcX, ndcY, aspect) {
    const inv = invert(this.viewProjection(aspect));
    const near = transformVec(inv, [ndcX, ndcY, -1]);
    const far = transformVec(inv, [ndcX, ndcY, 1]);
    return { origin: near, dir: normalize(sub(far, near)) };
  }
}
