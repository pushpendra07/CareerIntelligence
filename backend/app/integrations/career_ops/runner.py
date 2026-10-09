"""Optional subprocess runner for Career-Ops' own CLIs.

Only two allowlisted commands, both documented, machine-readable Career-Ops interfaces:
  node scan.mjs --json        (writes to Career-Ops' own pipeline/scan-history, as designed)
  node fetch-jd.mjs <url>     (read-only; prints a JD or exits 1)
Arguments are passed as a list (no shell), with a timeout and a minimal environment.
"""

import json
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.urls import is_http_url

logger = logging.getLogger(__name__)
ENV_PASSTHROUGH = (
    "PATH",
    "HOME",
    "LANG",
    "CAREER_OPS_ROOT",
    "CAREER_OPS_DATA_DIR",
    "PLAYWRIGHT_BROWSERS_PATH",
)


class RunnerError(RuntimeError):
    pass


@dataclass
class RunResult:
    returncode: int
    stdout: str
    stderr: str


def node_binary() -> str | None:
    return shutil.which("node")


def _run(code_root: Path, args: list[str], timeout: int) -> RunResult:
    node = node_binary()
    if node is None:
        raise RunnerError("Node.js is not installed or not on PATH")
    if not (code_root / args[0]).is_file():
        raise RunnerError(f"{args[0]} not found in {code_root}")
    env = {k: v for k, v in os.environ.items() if k in ENV_PASSTHROUGH}
    try:
        proc = subprocess.run(  # noqa: S603 - fixed allowlisted script, list args, no shell
            [node, *args],
            cwd=code_root,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RunnerError(f"{args[0]} timed out after {timeout}s") from exc
    return RunResult(proc.returncode, proc.stdout, proc.stderr)


# Career-Ops scans check 10,000+ postings; they run in the background, so allow time.
SCAN_TIMEOUT_SECONDS = 45 * 60


def run_scan(code_root: Path, timeout: int = SCAN_TIMEOUT_SECONDS) -> dict[str, Any]:
    result = _run(code_root, ["scan.mjs", "--json", "--quiet"], timeout)
    lines = [ln for ln in result.stdout.splitlines() if ln.strip().startswith("{")]
    if not lines:
        logger.warning(
            "career-ops scan produced no receipt",
            extra={"returncode": result.returncode, "stderr": result.stderr[-500:]},
        )
        raise RunnerError(f"scan.mjs exited {result.returncode} without a JSON receipt")
    receipt: dict[str, Any] = json.loads(lines[-1])
    if receipt.get("version") != "careerops.scan.receipt@1":
        logger.warning("unexpected scan receipt version", extra={"version": receipt.get("version")})
    return receipt


def fetch_jd(code_root: Path, url: str, timeout: int = 45) -> str | None:
    if not is_http_url(url):
        raise RunnerError("Only http(s) URLs can be fetched")
    result = _run(code_root, ["fetch-jd.mjs", url], timeout)
    text = result.stdout.strip()
    return text if result.returncode == 0 and text else None
