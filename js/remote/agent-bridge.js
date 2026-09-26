/**
 * @file agent-bridge.js
 * Puente entre el editor y Claude (a través del servidor MCP en Vercel).
 *
 *  1. connect(): pide al servidor una sesión → recibe { code, token }.
 *     El usuario le da el CÓDIGO a Claude; el TOKEN nunca sale del navegador.
 *  2. Bucle de consulta ("polling"): cada pocos cientos de ms pregunta si
 *     Claude envió órdenes, las ejecuta en orden y devuelve los resultados.
 *     La frecuencia baja sola cuando no hay actividad para ahorrar peticiones.
 *  3. Se desconecta solo tras un rato sin órdenes o si la sesión vence.
 *
 * Eventos: "status" ({ status, message }) y "activity" ({ op, ok, text, at }).
 */
import { Emitter } from '../utils/emitter.js';
import { loadJSON, saveJSON, removeKey } from '../utils/storage.js';
import { REMOTE, STORAGE_KEYS } from '../config.js';
import { describeCommand } from './commands.js';

/** Espera `ms` milisegundos. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Error HTTP del puente (conserva el estado para decidir si reintentar). */
class BridgeHttpError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export class AgentBridge extends Emitter {
  /**
   * @param {object} options
   * @param {Record<string, (args: object) => Promise<object>>} options.handlers Órdenes disponibles.
   */
  constructor({ handlers }) {
    super();
    this.handlers = handlers;
    this.status = 'off';          // off | connecting | connected | error
    this.session = null;          // { code, token, baseUrl, expiresAt }
    this.lastActivity = 0;
    this.lastCommandAt = 0;
    this._runId = 0;              // invalida bucles anteriores al reconectar
    this.baseUrl = this._initialBaseUrl();
  }

  /* --------------------------- Configuración --------------------------- */

  /** URL del servidor: ?bridge=… en la dirección > la guardada > la predeterminada. */
  _initialBaseUrl() {
    const fromQuery = new URLSearchParams(location.search).get('bridge');
    if (fromQuery && /^https?:\/\//.test(fromQuery)) {
      saveJSON(STORAGE_KEYS.BRIDGE_URL, fromQuery);
      return fromQuery.replace(/\/$/, '');
    }
    return (loadJSON(STORAGE_KEYS.BRIDGE_URL, null) ?? REMOTE.DEFAULT_BRIDGE_URL).replace(/\/$/, '');
  }

  /** Cambia la URL del servidor (opciones avanzadas). Vacío = predeterminada. */
  setBaseUrl(url) {
    const clean = String(url || '').trim().replace(/\/$/, '');
    if (!clean || clean === REMOTE.DEFAULT_BRIDGE_URL) {
      removeKey(STORAGE_KEYS.BRIDGE_URL);
      this.baseUrl = REMOTE.DEFAULT_BRIDGE_URL;
    } else {
      if (!/^https?:\/\//.test(clean)) throw new Error('La URL debe empezar con https://');
      saveJSON(STORAGE_KEYS.BRIDGE_URL, clean);
      this.baseUrl = clean;
    }
  }

  /** URL del endpoint MCP (la que se agrega como conector en Claude). */
  get mcpUrl() {
    return `${this.baseUrl}/mcp`;
  }

  /* ----------------------------- Conexión ------------------------------ */

  _setStatus(status, message = '') {
    this.status = status;
    this.emit('status', { status, message });
  }

  async _call(path, method, body) {
    let res;
    try {
      res = await fetch(`${this.session?.baseUrl ?? this.baseUrl}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new BridgeHttpError('No se pudo contactar al servidor del MCP.', 0, 'network');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new BridgeHttpError(data.error || `Error ${res.status}`, res.status, data.code);
    return data;
  }

  /** Crea una sesión nueva y empieza a escuchar órdenes. */
  async connect() {
    if (this.status === 'connected' || this.status === 'connecting') return;
    this._setStatus('connecting');
    try {
      const { code, token, expiresIn } = await this._call('/api/bridge/session', 'POST');
      this.session = { code, token, baseUrl: this.baseUrl, expiresAt: Date.now() + expiresIn * 1000 };
      saveJSON(STORAGE_KEYS.AGENT_SESSION, this.session);
      this._start();
    } catch (error) {
      this.session = null;
      this._setStatus('error', error.message);
    }
  }

  /** Recupera la sesión guardada (por ejemplo, tras recargar la página). */
  resume() {
    const saved = loadJSON(STORAGE_KEYS.AGENT_SESSION, null);
    if (!saved?.code || !saved?.token || saved.expiresAt < Date.now()) {
      removeKey(STORAGE_KEYS.AGENT_SESSION);
      return false;
    }
    this.session = saved;
    this._setStatus('connecting');
    this._start();
    return true;
  }

  /**
   * Termina la sesión.
   * @param {{ reason?: string, notifyServer?: boolean }} [options]
   */
  async disconnect({ reason = '', notifyServer = true } = {}) {
    const session = this.session;
    this._runId++;
    this.session = null;
    removeKey(STORAGE_KEYS.AGENT_SESSION);
    this._setStatus('off', reason);
    if (notifyServer && session) {
      fetch(`${session.baseUrl}/api/bridge/session`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: session.code, token: session.token }),
        keepalive: true,
      }).catch(() => {});
    }
  }

  /* ------------------------------ Bucle -------------------------------- */

  _start() {
    const runId = ++this._runId;
    this.lastActivity = Date.now();
    this._loop(runId);
  }

  /** Tiempo de espera entre consultas según la actividad reciente. */
  _nextDelay() {
    const idle = Date.now() - this.lastCommandAt;
    if (idle < REMOTE.ACTIVE_WINDOW_MS) return REMOTE.POLL_ACTIVE_MS;
    if (idle < 2 * 60_000) return REMOTE.POLL_WARM_MS;
    return REMOTE.POLL_IDLE_MS;
  }

  async _loop(runId) {
    let failures = 0;
    while (runId === this._runId && this.session) {
      const { code, token } = this.session;
      try {
        const { commands } = await this._call('/api/bridge/poll', 'POST', { code, token });
        if (runId !== this._runId) return;
        failures = 0;
        if (this.status !== 'connected') this._setStatus('connected');
        if (commands.length) {
          const results = [];
          for (const cmd of commands) results.push(await this._execute(cmd));
          await this._call('/api/bridge/result', 'POST', { code, token, results });
          this.lastCommandAt = Date.now();
          this.lastActivity = Date.now();
        }
        if (Date.now() - this.lastActivity > REMOTE.IDLE_DISCONNECT_MS) {
          await this.disconnect({ reason: 'idle' });
          return;
        }
        await sleep(commands.length ? 150 : this._nextDelay());
      } catch (error) {
        if (runId !== this._runId) return;
        if (error.status === 404 || error.status === 403) {
          // La sesión venció o el servidor ya no la reconoce.
          await this.disconnect({ reason: 'expired', notifyServer: false });
          return;
        }
        failures++;
        this._setStatus('error', error.message);
        await sleep(Math.min(10_000, 1000 * 2 ** Math.min(failures, 4)));
      }
    }
  }

  /** Ejecuta una orden y arma su resultado (los errores también se informan a Claude). */
  async _execute({ id, op, args }) {
    const handler = Object.hasOwn(this.handlers, op) ? this.handlers[op] : null;
    if (!handler) return { id, ok: false, error: `Orden desconocida: ${op}` };
    try {
      const data = await handler(args ?? {});
      this.emit('activity', { op, ok: true, text: describeCommand(op, args, data), at: Date.now() });
      return { id, ok: true, data };
    } catch (error) {
      this.emit('activity', { op, ok: false, text: `${describeCommand(op, args)}: ${error.message}`, at: Date.now() });
      return { id, ok: false, error: error.message };
    }
  }
}
