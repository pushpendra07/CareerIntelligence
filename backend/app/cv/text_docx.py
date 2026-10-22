"""A plain Word (DOCX) copy of a CV that exists only as PDF or text, so it can be tailored.

The text is the CV's own, line for line: lines a PDF wrapped are joined again, section headings
("Technical Skills", "Experience"…) become Word headings and "•" lines become bullets. The
design (fonts, columns, colours) of the PDF is not reproduced. Each paragraph is a single plain
run, which is what `tailor_docx` needs to add skills without breaking the format.
"""

import io
import re

import docx
from docx.enum.style import WD_STYLE_TYPE
from docx.shared import Inches, Pt, RGBColor

from app.cv.parser import _heading_key

_BULLET = re.compile(r"^\s*[•●▪◦○■\-–*]\s+")
_JOINERS = (",", "&", "-", "–", "/", "(", " and", " or", " of", " with", " in", " for", " to")
_LABEL = re.compile(r"^[A-Z][^:,.|•]{1,40}:\s")  # "Databases: …" starts its own line
_DARK = RGBColor(0x1F, 0x29, 0x37)


def _lines(text: str) -> list[str]:
    return [re.sub(r"\s+", " ", line).strip() for line in text.split("\n") if line.strip()]


def _continues(prev: str, line: str, full: int, listing: bool) -> bool:
    """`line` is the rest of `prev` (the line above it, as printed), wrapped by the PDF."""
    if _BULLET.match(line) or _LABEL.match(line) or _heading_key(line) or _heading_key(prev):
        return False
    if line[0].islower() or prev.rstrip().lower().endswith(_JOINERS):
        return True
    # Inside "Skills: a, b, c", a wrapped line of more items belongs to it.
    if listing and "," in line:
        return True
    # A line that reaches the right margin and doesn't end a sentence goes on below.
    return len(prev) >= 0.8 * full and not prev.rstrip().endswith((".", ":", "!", "?"))


def paragraphs(text: str) -> list[tuple[str, str]]:
    """(kind, text) per paragraph: name, headline, heading, bullet or text."""
    lines = _lines(text)
    if not lines:
        return []
    widths = sorted(len(line) for line in lines)
    full = widths[int(len(widths) * 0.9)]
    joined: list[str] = []
    for i, line in enumerate(lines):
        # The name, headline and contact lines at the top are never joined.
        if joined and i > 2 and _continues(lines[i - 1], line, full,
                                                 bool(_LABEL.match(joined[-1]))):
            joined[-1] = f"{joined[-1]} {line}"
        else:
            joined.append(line)
    out: list[tuple[str, str]] = []
    for i, line in enumerate(joined):
        if i == 0 and not _heading_key(line):
            out.append(("name", line))
        elif _heading_key(line):
            out.append(("heading", line))
        elif _BULLET.match(line):
            out.append(("bullet", _BULLET.sub("", line)))
        elif i == 1 and len(line.split()) <= 20 and out and out[0][0] == "name":
            out.append(("headline", line))
        else:
            out.append(("text", line))
    return out


def text_to_docx(text: str) -> bytes:
    doc = docx.Document()
    for section in doc.sections:
        section.left_margin = section.right_margin = Inches(0.75)
        section.top_margin = section.bottom_margin = Inches(0.6)
    styles = doc.styles
    normal = styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)
    normal.paragraph_format.space_after = Pt(3)
    title = styles["Title"]
    title.font.size, title.font.bold, title.font.color.rgb = Pt(20), True, _DARK
    heading = styles["Heading 1"]
    heading.font.size, heading.font.bold, heading.font.color.rgb = Pt(12), True, _DARK
    heading.paragraph_format.space_before, heading.paragraph_format.space_after = Pt(10), Pt(3)
    if "CV Headline" not in [s.name for s in styles]:
        lead = styles.add_style("CV Headline", WD_STYLE_TYPE.PARAGRAPH)
        lead.base_style = normal
        lead.font.size, lead.font.bold = Pt(11.5), True
    style = {"name": "Title", "headline": "CV Headline", "heading": "Heading 1",
             "bullet": "List Bullet", "text": "Normal"}
    for kind, line in paragraphs(text):
        doc.add_paragraph(line, style=style[kind])
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()
