/**
 * @file agent-panel.js
 * Interfaz de "Conectar con un agente de IA": botón del encabezado, diálogo con el
 * código de sesión, registro de actividad e indicador en la barra de estado.
 */
import { t } from '../i18n/i18n.js';
import { copyText } from '../utils/clipboard.js';
import { toast } from './toast.js';

const MAX_LOG = 8;

export class AgentPanel {
  /**
   * @param {import('../remote/agent-bridge.js').AgentBridge} bridge
   */
  constructor(bridge) {
    this.bridge = bridge;
    this.log = [];
    const $ = (id) => document.getElementById(id);
    this.el = {
      open: $('btn-agent'),
      dialog: $('dialog-agent'),
      status: $('agent-status'),
      statusText: $('agent-status-text'),
      codeBox: $('agent-code'),
      code: $('agent-code-value'),
      copyCode: $('btn-agent-copy-code'),
      copyMessage: $('btn-agent-copy-message'),
      mcpUrl: $('agent-mcp-url'),
      copyUrl: $('btn-agent-copy-url'),
      connect: $('btn-agent-connect'),
      disconnect: $('btn-agent-disconnect'),
      activity: $('agent-activity'),
      server: $('agent-server-url'),
      saveServer: $('btn-agent-save-server'),
      statusbar: $('status-agent'),
    };
    this._bind();
    this.render();
  }

  _bind() {
    const { el, bridge } = this;
    el.open.addEventListener('click', () => el.dialog.showModal());
    el.statusbar.addEventListener('click', () => el.dialog.showModal());
    el.connect.addEventListener('click', () => bridge.connect());
    el.disconnect.addEventListener('click', () => bridge.disconnect());

    const copy = async (value, label) => {
      const ok = await copyText(value);
      toast(ok ? t('toasts.copied', { value: label ?? value }) : t('toasts.copyFailed'), ok ? 'success' : 'error');
    };
    el.copyCode.addEventListener('click', () => copy(bridge.session?.code ?? ''));
    el.copyMessage.addEventListener('click', () => copy(t('agent.messageTemplate', { code: bridge.session?.code ?? '' }), t('agent.message')));
    el.copyUrl.addEventListener('click', () => copy(bridge.mcpUrl));
    el.saveServer.addEventListener('click', () => {
      try {
        bridge.setBaseUrl(el.server.value);
        toast(t('agent.serverSaved'), 'success');
        this.render();
      } catch (error) {
        toast(error.message, 'error');
      }
    });

    bridge.on('status', ({ status, message }) => {
      if (status === 'off' && message === 'idle') toast(t('agent.idleDisconnected'), 'info', 6000);
      if (status === 'off' && message === 'expired') toast(t('agent.expired'), 'warning', 6000);
      this.render(message);
    });
    bridge.on('activity', (entry) => {
      this.log = [entry, ...this.log].slice(0, MAX_LOG);
      this._renderActivity();
      this._flashStatusbar(entry.text);
    });
  }

  /** Muestra la última acción del agente en la barra de estado por unos segundos. */
  _flashStatusbar(text) {
    clearTimeout(this._flashTimer);
    this.el.statusbar.dataset.activity = 'true';
    this.el.statusbar.querySelector('span').textContent = `${t('agent.activityPrefix')}: ${text}`;
    this._flashTimer = setTimeout(() => {
      this.el.statusbar.dataset.activity = 'false';
      this.render();
    }, 4000);
  }

  _renderActivity() {
    const { activity } = this.el;
    if (this.log.length === 0) {
      activity.replaceChildren(Object.assign(document.createElement('li'), { className: 'agent-activity__empty', textContent: t('agent.noActivity') }));
      return;
    }
    activity.replaceChildren(...this.log.map((entry) => {
      const li = document.createElement('li');
      li.className = entry.ok ? '' : 'is-error';
      const time = document.createElement('time');
      time.textContent = new Date(entry.at).toLocaleTimeString('es-419', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      li.append(time, ` ${entry.text}`);
      return li;
    }));
  }

  /** Refleja el estado del puente en el diálogo, el botón y la barra de estado. */
  render(message = '') {
    const { el, bridge } = this;
    const status = bridge.status;
    el.status.dataset.state = status;
    el.statusText.textContent = status === 'error'
      ? `${t('agent.status.error')}: ${message}`
      : t(`agent.status.${status}`);
    const hasSession = Boolean(bridge.session) && status !== 'off';
    el.codeBox.hidden = !hasSession;
    el.code.textContent = bridge.session?.code ?? '';
    el.connect.hidden = hasSession;
    el.disconnect.hidden = !hasSession;
    el.mcpUrl.textContent = bridge.mcpUrl;
    if (document.activeElement !== el.server) el.server.value = bridge.baseUrl;

    el.open.dataset.state = status;
    el.open.title = t(`agent.status.${status}`);
    el.statusbar.hidden = status === 'off';
    el.statusbar.dataset.state = status;
    if (el.statusbar.dataset.activity !== 'true') {
      el.statusbar.querySelector('span').textContent = t(`agent.statusShort.${status}`);
    }
    this._renderActivity();
  }
}
