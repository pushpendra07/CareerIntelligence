"""Edit a DOCX CV for one job without changing how it looks.

Only the text inside existing runs changes; every style, font, margin, table, text box, header
and footer stays as uploaded. Edits:
- skills the user confirmed are added to the Skills section, after the items of the line that
  holds skills of the same kind (or as a copy of the last item, when skills are one per line);
- in each skill line the job's skills move to the front;
- optionally the job title goes in front of the headline.

A line is rewritten only when its items share one run format and hold plain text; otherwise
the skill is appended to its last run, or the line is left alone. Nothing is ever invented:
the caller decides which skills to add.
"""

import copy
import io
import re
from dataclasses import dataclass, field

import docx
from docx.document import Document
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph
from docx.text.run import Run

from app.cv.parser import _heading_key, _split_items
from app.skills.catalog import ancestors, normalize_skill, skill_category

_SEPARATORS = (",", "|", "•", "·", ";")


@dataclass
class TailorResult:
    data: bytes
    added: list[str] = field(default_factory=list)
    not_added: list[str] = field(default_factory=list)
    reordered_lines: int = 0
    headline: str | None = None
    notes: list[str] = field(default_factory=list)


def paragraphs(doc: Document) -> list[Paragraph]:
    """Every paragraph in reading order, including tables and text boxes. Text boxes keep a
    fallback copy for old Word versions; only the copy Word shows is used."""
    out = []
    for p in doc.element.body.iter(qn("w:p")):
        parent = p.getparent()
        hidden = False
        while parent is not None:
            if parent.tag.endswith("}Fallback"):
                hidden = True
                break
            parent = parent.getparent()
        if not hidden:
            out.append(Paragraph(p, doc._body))
    return out


def docx_text(data: bytes) -> str:
    return "\n".join(p.text for p in paragraphs(docx.Document(io.BytesIO(data))))


def _plain(run: Run) -> bool:
    """A run holding only text (no tab, break, picture, field…)."""
    return all(child.tag in (qn("w:rPr"), qn("w:t")) for child in run._r)


def _rpr(run: Run) -> bytes:
    rpr = run._r.rPr
    return b"" if rpr is None else rpr.xml.encode()


@dataclass
class _Line:
    para: Paragraph
    start: int  # where the items begin in the paragraph text (after "Label:")
    sep: str  # the separator as written, e.g. ", " or " | "
    items: list[str]
    period: bool  # the line ends with "."

    @property
    def categories(self) -> set[str]:
        out = set()
        for item in self.items:
            name = normalize_skill(item)
            if name and (cat := skill_category(name)):
                out.add(cat)
        return out


def _as_line(para: Paragraph) -> _Line | None:
    text = para.text
    if not text.strip() or "".join(r.text for r in para.runs) != text:
        return None  # empty, or text in hyperlinks/fields the runs don't show
    start = 0
    label = re.match(r"\s*[^:,|•·;]{1,40}:\s*", text)
    if label:
        start = label.end()
    body = text[start:].rstrip()
    period = body.endswith(".")
    body = body.rstrip(".")
    counts = {s: body.count(s) for s in _SEPARATORS}
    sep_char = max(counts, key=lambda s: counts[s])
    if counts[sep_char] == 0:
        return None
    written = re.search(rf"\s*{re.escape(sep_char)}\s*", body)
    sep = written.group(0) if written else f"{sep_char} "
    if sep_char == ",":
        items = _split_items(body)
    else:
        items = [i.strip() for i in body.split(sep_char) if i.strip()]
    return _Line(para, start, sep, items, period)


def _rewrite(line: _Line, items: list[str]) -> bool:
    """Put `items` in place of the line's items, keeping the label and the run format."""
    runs = line.para.runs
    pos, first, covering = 0, None, []
    for i, run in enumerate(runs):
        end = pos + len(run.text)
        if end > line.start and run.text:
            covering.append(i)
            if first is None:
                first = (i, line.start - pos if line.start > pos else 0)
        pos = end
    if first is None or not all(_plain(runs[i]) for i in covering):
        return False
    if len({_rpr(runs[i]) for i in covering}) != 1:
        return False
    i0, offset = first
    keep = runs[i0].text[:offset]
    trail = line.para.text[len(line.para.text.rstrip()):]
    runs[i0].text = keep + line.sep.join(items) + ("." if line.period else "") + trail
    for i in covering[1:]:
        runs[i].text = ""
    return True


def _append(line: _Line, extra: list[str]) -> bool:
    """Fallback: add skills after the last item, inside the last run (keeps its format)."""
    runs = [r for r in line.para.runs if r.text]
    if not runs or not _plain(runs[-1]):
        return False
    run = runs[-1]
    text = run.text
    stripped = text.rstrip()
    trail = text[len(stripped):]
    if line.period and stripped.endswith("."):
        stripped = stripped[:-1]
    tail = ("." if line.period else "") + trail
    run.text = stripped + "".join(line.sep + s for s in extra) + tail
    return True


def _section(paras: list[Paragraph], key: str) -> list[Paragraph] | None:
    for i, p in enumerate(paras):
        if _heading_key(p.text) == key:
            body = []
            for q in paras[i + 1:]:
                if _heading_key(q.text):
                    break
                body.append(q)
            return body
    return None


def _one_per_line(body: list[Paragraph]) -> list[Paragraph]:
    """Skills written one per paragraph (a bullet list): short lines with no separators."""
    items = [p for p in body if p.text.strip()]
    short = all(len(p.text.split()) <= 4 and not any(s in p.text for s in _SEPARATORS)
                for p in items)
    if len(items) >= 3 and short:
        return items
    return []


def _clone_after(par: Paragraph, text: str) -> bool:
    runs = [r for r in par.runs if r.text]
    if len(runs) != 1 or not _plain(runs[0]):
        return False
    new = copy.deepcopy(par._p)
    par._p.addnext(new)
    clone = Paragraph(new, par._parent)
    kept = [r for r in clone.runs if r.text]
    kept[0].text = text
    return True


def _norm(item: str) -> str:
    return (normalize_skill(item) or item).lower()


def _forms(item: str) -> set[str]:
    """The item and the general skills it implies: "Magento 2" -> magento 2, magento."""
    name = normalize_skill(item)
    return {_norm(item), *(a.lower() for a in ancestors(name))} if name else {_norm(item)}


def tailor(data: bytes, *, add: list[str], job_skills: list[str],
           headline_title: str | None = None) -> TailorResult:
    doc = docx.Document(io.BytesIO(data))
    paras = paragraphs(doc)
    result = TailorResult(b"")
    wanted = {_norm(s) for s in job_skills}
    body = _section(paras, "skills")
    pending = list(dict.fromkeys(add))

    if body is None:
        if pending:
            result.notes.append("No Skills section was found (a heading such as “Skills” or "
                                "“Technical Skills”), so no skills were added.")
        result.not_added = pending
        pending = []
        body = []

    lines = [line for p in body if (line := _as_line(p))]
    present = {_norm(i) for line in lines for i in line.items}
    present |= {_norm(p.text.strip()) for p in body if p.text.strip()}
    pending = [s for s in pending if _norm(s) not in present]

    # Each skill goes to the line holding skills of its kind, else to the longest line; with
    # one skill per paragraph, a copy of the last one is made for each.
    listed = _one_per_line(body)
    plan: dict[int, list[str]] = {}
    for skill in [] if listed else pending:
        cat = skill_category(normalize_skill(skill) or "")
        target = next((i for i, line in enumerate(lines) if cat and cat in line.categories), None)
        if target is None and lines:
            target = max(range(len(lines)), key=lambda i: len(lines[i].items))
        if target is not None:
            plan.setdefault(target, []).append(skill)

    added: set[str] = set()
    for i, line in enumerate(lines):
        extra = plan.get(i, [])
        front = [it for it in line.items if _forms(it) & wanted]
        rest = [it for it in line.items if not _forms(it) & wanted]
        if front + extra + rest == line.items:
            continue
        if _rewrite(line, front + extra + rest):
            added.update(extra)
            if front + rest != line.items:
                result.reordered_lines += 1
        elif extra and _append(line, extra):
            added.update(extra)
    if listed:
        for skill in reversed(pending):
            if _clone_after(listed[-1], skill):
                added.add(skill)

    result.added = [s for s in pending if s in added]
    result.not_added += [s for s in pending if s not in added]
    if skipped := [s for s in pending if s not in added]:
        result.notes.append("Some skills couldn't be added without changing the layout: "
                            + ", ".join(skipped) + ". Add them by hand.")

    if headline_title:
        result.headline = _set_headline(paras, headline_title, result)

    out = io.BytesIO()
    doc.save(out)
    result.data = out.getvalue()
    return result


def _set_headline(paras: list[Paragraph], title: str, result: TailorResult) -> str | None:
    """Put the job title in front of the headline: the first short line after the name."""
    from app.cv.parser import parse_cv

    text = "\n".join(p.text for p in paras)
    headline = parse_cv(text).headline
    para = next((p for p in paras if headline and p.text.strip() == headline.strip()), None)
    if para is None or headline is None:
        result.notes.append("No headline line was found under your name, so the title wasn't "
                            "changed.")
        return None
    if title.lower() in headline.lower():
        return headline
    found = re.search(r"\s[|·–-]\s", headline)
    new = f"{title}{found.group(0) if found else ' | '}{headline.strip()}"
    runs = [r for r in para.runs if r.text]
    if not runs or not all(_plain(r) for r in runs) or len({_rpr(r) for r in runs}) != 1:
        result.notes.append("The headline mixes formats, so the title wasn't changed.")
        return None
    lead = runs[0].text[: len(runs[0].text) - len(runs[0].text.lstrip())]
    runs[0].text = lead + new
    for r in runs[1:]:
        r.text = ""
    return new
