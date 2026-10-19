"""The Job collector Chrome extension (browser-extension/) as a zip to download from Settings.

The zip is set up for the app it was downloaded from: its default API and app addresses are
written into settings.js, so it works without changing anything after "Load unpacked".
"""

import io
import re
import zipfile
from pathlib import Path
from urllib.parse import urlsplit

from app.core.errors import DomainValidationError, NotFoundError

ZIP_FOLDER = "career-intelligence-extension"
_HERE = Path(__file__).resolve()
# Repository checkout (backend/app/services -> repo root) or the Docker image (/app).
CANDIDATES = (_HERE.parents[3] / "browser-extension", _HERE.parents[2] / "browser-extension")


def extension_dir() -> Path:
    for path in CANDIDATES:
        if (path / "manifest.json").is_file():
            return path
    raise NotFoundError("The Job collector extension isn't included in this installation")


def _origin(url: str) -> str:
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise DomainValidationError(f"Not an http(s) address: {url!r}")
    return f"{parts.scheme}://{parts.netloc}"


def build_zip(api_url: str, app_url: str) -> bytes:
    """All extension files under one folder, with settings.js pointing at this app."""
    root = extension_dir()
    defaults = (f'const CI_DEFAULTS = {{ apiUrl: "{_origin(api_url)}", '
                f'appUrl: "{_origin(app_url)}" }};')
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path in sorted(root.rglob("*")):
            rel = path.relative_to(root)
            if not path.is_file() or any(p.startswith(".") for p in rel.parts):
                continue
            data = path.read_bytes()
            if rel.as_posix() == "settings.js":
                data = re.sub(rb"const CI_DEFAULTS = \{[^\n]*\};", defaults.encode(), data, count=1)
            zf.writestr(f"{ZIP_FOLDER}/{rel.as_posix()}", data)
    return buf.getvalue()
