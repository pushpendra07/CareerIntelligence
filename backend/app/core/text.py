import re
import unicodedata

LEGAL_SUFFIXES = re.compile(
    r"\b(private|pvt|limited|ltd|llp|llc|inc|incorporated|corp|corporation|co|company|gmbh|"
    r"plc|pte|sa|bv|ag|s\.?a\.?s?)\b\.?",
    re.IGNORECASE,
)
# Generic words dropped only for matching keys (display names keep them).
GENERIC_WORDS = re.compile(
    r"\b(technologies|technology|tech|solutions|solution|software|services|infotech|"
    r"infosystems|systems|labs|global|india|digital|consulting|group|the)\b",
    re.IGNORECASE,
)


def fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()


def company_key(name: str) -> str:
    """Matching key for company names: "Krish TechnoLabs Pvt. Ltd." -> "krishtechnolabs"."""
    s = fold(name).lower().replace("&", " and ")
    s = LEGAL_SUFFIXES.sub(" ", s)
    stripped = GENERIC_WORDS.sub(" ", s)
    key = re.sub(r"[^a-z0-9]", "", stripped)
    return key or re.sub(r"[^a-z0-9]", "", s)


def company_key_strict(name: str) -> str:
    """Like company_key but keeps generic words: "Aspire Systems" != "Aspire Software"."""
    s = LEGAL_SUFFIXES.sub(" ", fold(name).lower().replace("&", " and "))
    return re.sub(r"[^a-z0-9]", "", s)


def generic_words(name: str) -> set[str]:
    """The generic words company_key drops: "Wissen Infotech" -> {"infotech"}."""
    s = LEGAL_SUFFIXES.sub(" ", fold(name).lower().replace("&", " and "))
    return {_SAME_WORD.get(w.lower(), w.lower()) for w in GENERIC_WORDS.findall(s)}


# Singular and plural forms count as the same generic word ("Ingold Solution(s)").
_SAME_WORD = {"technologies": "technology", "solutions": "solution", "services": "service",
              "systems": "system"}


def same_company_name(a: str, b: str) -> bool:
    """Equal company_key alone is not enough: "Aspire Software Solutions" and "Aspire Systems"
    differ only in generic words, but different ones. Same when one name's generic words are
    a subset of the other's ("Kellton" / "Kellton Tech")."""
    if company_key(a) != company_key(b):
        return False
    ga, gb = generic_words(a), generic_words(b)
    return ga <= gb or gb <= ga


def title_key(title: str) -> str:
    s = fold(title).lower()
    s = re.sub(r"\b(sr|snr)\b\.?", "senior", s)
    s = re.sub(r"\b(jr)\b\.?", "junior", s)
    s = re.sub(r"\b(dev)\b", "developer", s)
    s = re.sub(r"\b(engg|engr)\b", "engineer", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


PLACEHOLDERS = {
    "",
    "-",
    "--",
    "—",
    "n/a",
    "na",
    "none",
    "null",
    "unknown",
    "not verified",
    "not publicly available",
    "not available",
    "tbd",
    "?",
    "unconfirmed",
}


def clean(value: object) -> str | None:
    """Treat research placeholders ("Not verified", "Unknown", ...) as missing."""
    if value is None:
        return None
    s = re.sub(r"\s+", " ", str(value)).strip()
    return None if s.lower() in PLACEHOLDERS else s


def split_list(value: object, sep: str = r"[;,/|]") -> list[str]:
    s = clean(value)
    if not s:
        return []
    return [p for p in (clean(x) for x in re.split(sep, s)) if p]
