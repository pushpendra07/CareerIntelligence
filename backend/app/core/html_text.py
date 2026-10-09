"""HTML job descriptions -> readable plain text (stdlib only)."""

import html
import re
from html.parser import HTMLParser

BLOCK = {"p", "div", "section", "article", "header", "footer", "h1", "h2", "h3", "h4", "h5",
         "h6", "ul", "ol", "table", "tr", "br", "hr"}


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style"):
            self.skip += 1
        elif tag == "li":
            self.parts.append("\n• ")
        elif tag in BLOCK:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style"):
            self.skip = max(0, self.skip - 1)
        elif tag in BLOCK:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip:
            self.parts.append(data)


def html_to_text(value: str | None) -> str:
    """Also handles entity-escaped HTML (Greenhouse returns `&lt;p&gt;...`)."""
    if not value:
        return ""
    raw = value
    if "&lt;" in raw and "<" not in raw:
        raw = html.unescape(raw)
    if "<" not in raw:
        return html.unescape(raw).strip()
    parser = _Text()
    parser.feed(raw)
    text = "".join(parser.parts).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.split("\n")]
    out: list[str] = []
    for ln in lines:
        if ln in ("", "•"):
            if out and out[-1] != "":
                out.append("")
            continue
        out.append(ln)
    return "\n".join(out).strip()
