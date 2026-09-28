#!/usr/bin/env python3
"""Convierte docs/index.html en páginas de la Wiki de GitHub (Markdown).

Cada sección de la documentación pasa a ser una página, con una portada
(Home.md), una barra lateral (_Sidebar.md) y un pie (_Footer.md). Las
imágenes de docs/img/ se copian a images/.

Uso:
    pip install -r scripts/requirements-wiki.txt
    python3 scripts/docs_to_wiki.py [carpeta_de_salida]   # por defecto: wiki-build/

El workflow .github/workflows/wiki.yml lo ejecuta en cada cambio de la
documentación y publica el resultado en la Wiki del repositorio.
"""
from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path
from urllib.parse import quote

from bs4 import BeautifulSoup, NavigableString, Tag
from markdownify import MarkdownConverter

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs" / "index.html"
IMAGES = ROOT / "docs" / "img"
EDITOR_URL = "https://jacksonmultitech.github.io/minecraft-skins-editor/"
DOCS_URL = EDITOR_URL + "docs/"
REPO_URL = "https://github.com/jacksonmultitech/minecraft-skins-editor"
MCP_REPO_URL = "https://github.com/jacksonmultitech/mcp-minecraft-skins-editor"

# id de la sección → nombre de la página (el nombre del archivo usa guiones).
PAGES = {
    "introduccion": "Introducción",
    "inicio": "Inicio rápido",
    "interfaz": "La interfaz",
    "herramientas": "Herramientas",
    "color": "Color y teoría del color",
    "camara": "Cámara y navegación",
    "capas": "Capas y modelo",
    "preview": "Vista previa",
    "archivos": "Abrir y descargar",
    "formato": "Formato de skin",
    "juego": "Usar tu skin en el juego",
    "agente": "Conectar con un agente de IA",
    "atajos": "Atajos de teclado",
    "arquitectura": "Arquitectura del código",
    "desarrollo": "Guía para desarrolladores",
    "compatibilidad": "Navegadores compatibles",
    "faq": "Preguntas frecuentes",
    "referencias": "Referencias",
}


def page_file(title: str) -> str:
    """Nombre de archivo (y de URL) de una página de la Wiki."""
    return title.replace(" ", "-")


def page_link(title: str) -> str:
    return quote(page_file(title))


class WikiConverter(MarkdownConverter):
    """Ajustes de markdownify para el HTML de la documentación."""

    def convert_kbd(self, el, text, *args, **kwargs):
        return f"<kbd>{text}</kbd>"

    def convert_a(self, el, text, *args, **kwargs):
        href = el.get("href", "")
        if href.startswith("#"):
            section = href[1:]
            if section in PAGES:
                return f"[{text}]({page_link(PAGES[section])})"
            return text
        if href.startswith("../index.html"):
            href = EDITOR_URL
        return f"[{text}]({href})"


def md(node) -> str:
    return WikiConverter(heading_style="ATX", bullets="-", escape_underscores=False, escape_asterisks=False).convert(str(node))


def prepare(section: Tag) -> None:
    """Transforma los bloques especiales del HTML antes de convertirlo."""
    soup = section

    # Tarjetas de características: <li><strong>Título</strong>Texto</li> → "**Título**: texto".
    for ul in soup.select("ul.features"):
        for li in ul.find_all("li", recursive=False):
            strong = li.find("strong")
            if strong and strong.next_sibling and isinstance(strong.next_sibling, NavigableString):
                strong.next_sibling.replace_with(": " + strong.next_sibling.lstrip())

    # Diagrama de flujo: cajas → lista numerada.
    for flow in soup.select("div.flow"):
        ol = BeautifulSoup("<ol></ol>", "html.parser").ol
        for box in flow.select(".flow__box"):
            li = BeautifulSoup("<li></li>", "html.parser").li
            strong = box.find("strong")
            title = strong.get_text() if strong else ""
            if strong:
                strong.extract()
            li.append(BeautifulSoup(f"<strong>{title}</strong>: ", "html.parser"))
            for child in list(box.contents):
                li.append(child)
            ol.append(li)
        flow.replace_with(ol)

    # Mapa UV interactivo (necesita JavaScript) → imagen estática + enlace.
    for uv in soup.select("div.uv-map"):
        uv.replace_with(BeautifulSoup(
            '<p><img src="images/mapa-uv.png" alt="Mapa de la textura de 64×64 con la posición de cada parte y cara"></p>'
            f'<p>Versión interactiva (clásico y delgado): <a href="{DOCS_URL}#formato">mapa UV en la documentación web</a>.</p>',
            "html.parser"))


def callouts_to_alerts(section: Tag) -> None:
    """Convierte los avisos (.callout) en alertas de GitHub (> [!NOTE])."""
    for box in section.select(".callout"):
        kind = "WARNING" if "callout--warning" in box.get("class", []) else "NOTE"
        if box.name == "p":
            body = md(box).strip()
            title = ""
        else:
            strong = box.find("strong", recursive=False)
            title = strong.get_text().strip() if strong else ""
            if strong:
                strong.extract()
            body = md(box).strip()
        lines = [f"> [!{kind}]"]
        if title:
            lines.append(f"> **{title}**")
            lines.append(">")
        lines += [f"> {line}" if line else ">" for line in body.splitlines()]
        box.replace_with(NavigableString(f"\n\nALERT_START{len(ALERTS)}ALERT_END\n\n"))
        ALERTS.append("\n".join(lines))


ALERTS: list[str] = []


def clean(markdown: str) -> str:
    markdown = re.sub(r"ALERT_START(\d+)ALERT_END", lambda m: ALERTS[int(m.group(1))], markdown)
    markdown = re.sub(r"\n{3,}", "\n\n", markdown)
    return markdown.strip() + "\n"


def convert_section(section: Tag) -> str:
    h2 = section.find("h2")
    if h2:
        h2.extract()  # la Wiki muestra el título de la página
    prepare(section)
    callouts_to_alerts(section)
    body = md(section)
    # Los h3 pasan a ser el nivel 2 dentro de la página.
    body = re.sub(r"^### ", "## ", body, flags=re.M)
    return clean(body)


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "wiki-build"
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    soup = BeautifulSoup(DOCS.read_text(encoding="utf-8"), "html.parser")
    hero = soup.select_one(".hero")
    intro = hero.find("p").get_text(" ", strip=True) if hero else ""

    written = []
    for section in soup.select("section.doc-section"):
        sid = section.get("id")
        if sid not in PAGES:
            raise SystemExit(f"Sección sin página asignada en PAGES: #{sid}")
        title = PAGES[sid]
        (out / f"{page_file(title)}.md").write_text(convert_section(section), encoding="utf-8")
        written.append(title)

    missing = set(PAGES.values()) - set(written)
    if missing:
        raise SystemExit(f"Páginas sin sección en docs/index.html: {', '.join(sorted(missing))}")

    toc = "\n".join(f"{i}. [{t}]({page_link(t)})" for i, t in enumerate(written, 1))
    (out / "Home.md").write_text(clean(f"""
Bienvenido a la Wiki del **Editor de Skins de Minecraft**.

{intro}

![Editor de Skins de Minecraft](images/editor.png)

- **Abrir el editor:** <{EDITOR_URL}>
- **Documentación web** (con el mapa UV interactivo): <{DOCS_URL}>
- **Servidor MCP** para conectar un agente de IA: [mcp-minecraft-skins-editor]({MCP_REPO_URL})

## Contenido

{toc}
"""), encoding="utf-8")

    (out / "_Sidebar.md").write_text(clean(
        f"**[Inicio](Home)**\n\n" + "\n".join(f"- [{t}]({page_link(t)})" for t in written)
        + f"\n\n[Abrir el editor]({EDITOR_URL})"), encoding="utf-8")

    (out / "_Footer.md").write_text(clean(
        f"Esta Wiki se genera automáticamente desde [`docs/index.html`]({REPO_URL}/blob/main/docs/index.html): "
        "para corregirla, edita ese archivo en el repositorio. "
        "Proyecto independiente, sin afiliación con Mojang Studios ni Microsoft."), encoding="utf-8")

    if IMAGES.exists():
        shutil.copytree(IMAGES, out / "images")

    print(f"Wiki generada en {out}: {len(written) + 1} páginas")


if __name__ == "__main__":
    main()
