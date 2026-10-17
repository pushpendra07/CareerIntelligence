"""File storage behind a small interface, so an S3-compatible backend can replace it later.

Files are content-addressed and write-once: the key is derived from the SHA-256 of the bytes,
an existing key is never overwritten, and there is no delete. Original CVs are never destroyed.
"""

import hashlib
import os
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings


class Storage(Protocol):
    def put(self, area: str, data: bytes, ext: str) -> tuple[str, str]:
        """Store bytes; returns (key, sha256)."""
        ...

    def get(self, key: str) -> bytes: ...

    def exists(self, key: str) -> bool: ...


class LocalStorage:
    AREAS = ("cvs", "documents", "attachments")

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        path = (self.root / key).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError("storage key escapes the storage root")
        return path

    def put(self, area: str, data: bytes, ext: str) -> tuple[str, str]:
        if area not in self.AREAS:
            raise ValueError(f"unknown storage area {area!r}")
        digest = hashlib.sha256(data).hexdigest()
        key = f"{area}/{digest[:2]}/{digest}{ext}"
        path = self._path(key)
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            tmp = path.with_suffix(path.suffix + ".tmp")
            tmp.write_bytes(data)
            os.chmod(tmp, 0o600)
            tmp.replace(path)
        return key, digest

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def exists(self, key: str) -> bool:
        return self._path(key).is_file()


def get_storage() -> Storage:
    return LocalStorage(get_settings().storage_path)
