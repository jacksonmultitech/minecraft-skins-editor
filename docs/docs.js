/**
 * @file docs.js
 * Interactividad de la documentación:
 *  - Mapa UV generado a partir del MISMO módulo que usa el editor
 *    (js/core/skin-model.js), así el diagrama nunca queda desactualizado.
 *  - Botón de tema claro/oscuro (compartido con el editor).
 *  - Resaltado de la sección visible en el índice.
 */
import { getBoxes, PART_ORDER } from '../js/core/skin-model.js';
import { MODEL } from '../js/config.js';
import { t, setLocale } from '../js/i18n/i18n.js';
import { initTheme, toggleTheme, currentTheme, themeEvents } from '../js/ui/theme.js';
import { icon } from '../js/ui/icons.js';

setLocale('es-419');

/** Color de cada parte en el diagrama. */
const PART_COLORS = {
  head: '#e76f51',
  body: '#2a9d8f',
  rightArm: '#e9c46a',
  leftArm: '#f4a261',
  rightLeg: '#5b9bd5',
  leftLeg: '#a78bfa',
};
const FACE_SHORT = { top: 'Arr', bottom: 'Abj', right: 'Der', front: 'Fre', left: 'Izq', back: 'Atr' };
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Dibuja el mapa UV del modelo indicado dentro del <svg>. */
function renderUvMap(svg, caption, model) {
  svg.replaceChildren();
  for (const box of getBoxes(model)) {
    const overlay = box.layer === 'overlay';
    for (const face of box.faces) {
      const { x, y, w, h } = face.rect;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', x);
      rect.setAttribute('y', y);
      rect.setAttribute('width', w);
      rect.setAttribute('height', h);
      rect.setAttribute('fill', PART_COLORS[box.part]);
      rect.setAttribute('fill-opacity', overlay ? '0.45' : '0.95');
      rect.setAttribute('class', `uv-rect${overlay ? ' uv-rect--overlay' : ''}`);
      const text = `${t(`parts.${box.part}`)} · ${t(`faces.${face.name}`)} · ${t(`layerNames.${box.layer}`)} — x ${x}–${x + w - 1}, y ${y}–${y + h - 1} (${w}×${h} px)`;
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = text;
      rect.append(title);
      rect.addEventListener('mouseenter', () => { caption.textContent = text; });
      svg.append(rect);

      if (w >= 3 && h >= 3) {
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', x + w / 2);
        label.setAttribute('y', y + h / 2 + 0.6);
        label.setAttribute('text-anchor', 'middle');
        label.setAttribute('class', 'uv-label');
        label.textContent = FACE_SHORT[face.name];
        svg.append(label);
      }
    }
  }
}

function initUvMap() {
  const root = document.getElementById('uv-map');
  if (!root) return;
  const svg = root.querySelector('svg');
  const caption = root.querySelector('.uv-map__caption');
  const buttons = root.querySelectorAll('[data-model]');
  const legend = root.querySelector('.uv-map__legend');
  legend.replaceChildren(...PART_ORDER.map((part) => {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.style.background = PART_COLORS[part];
    li.append(sw, t(`parts.${part}`));
    return li;
  }));
  const extra = document.createElement('li');
  extra.innerHTML = '<span style="background:repeating-linear-gradient(45deg,#999 0 2px,transparent 2px 4px)"></span>Transparente = capa externa (borde punteado)';
  legend.append(extra);

  const select = (model) => {
    buttons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.model === model)));
    renderUvMap(svg, caption, model);
    caption.textContent = 'Pasa el cursor sobre una zona para ver sus coordenadas.';
  };
  buttons.forEach((b) => b.addEventListener('click', () => select(b.dataset.model)));
  select(MODEL.CLASSIC);
}

function initThemeButton() {
  initTheme();
  const btn = document.getElementById('doc-theme');
  const update = () => {
    const dark = currentTheme() === 'dark';
    btn.innerHTML = `${icon(dark ? 'sun' : 'moon', 18)}<span>${dark ? 'Tema claro' : 'Tema oscuro'}</span>`;
  };
  btn.addEventListener('click', toggleTheme);
  themeEvents.on('change', update);
  update();
}

/** Marca en el índice la sección que se está leyendo. */
function initTocHighlight() {
  const links = new Map([...document.querySelectorAll('.toc a')].map((a) => [a.getAttribute('href').slice(1), a]));
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((a) => a.classList.remove('is-active'));
      links.get(entry.target.id)?.classList.add('is-active');
    });
  }, { rootMargin: '-20% 0px -70% 0px' });
  document.querySelectorAll('section.doc-section[id]').forEach((s) => observer.observe(s));
}

initThemeButton();
initUvMap();
initTocHighlight();
