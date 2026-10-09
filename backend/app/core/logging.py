"""Structured logging on top of the stdlib.

Every record carries the request id (when inside a request) and any `extra={...}` fields.
Keys that look like secrets are redacted so a careless `extra` can never leak a credential.
"""

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_RESERVED = set(vars(logging.makeLogRecord({}))) | {"message", "asctime"}
_SECRET_MARKERS = ("password", "secret", "token", "api_key", "apikey", "authorization")


def _redact(key: str, value: Any) -> Any:
    return "***" if any(m in key.lower() for m in _SECRET_MARKERS) else value


def _extras(record: logging.LogRecord) -> dict[str, Any]:
    return {k: _redact(k, v) for k, v in vars(record).items() if k not in _RESERVED}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        if rid := request_id_var.get():
            payload["request_id"] = rid
        payload.update(_extras(record))
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class TextFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = f"{record.levelname:<7} {record.name}: {record.getMessage()}"
        if rid := request_id_var.get():
            base += f" [req={rid}]"
        if extras := _extras(record):
            base += " " + " ".join(f"{k}={v}" for k, v in extras.items())
        if record.exc_info:
            base += "\n" + self.formatException(record.exc_info)
        return base


def configure_logging(level: str = "INFO", fmt: str = "json") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if fmt == "json" else TextFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level.upper())
    # uvicorn's access log duplicates our request log.
    logging.getLogger("uvicorn.access").disabled = True
