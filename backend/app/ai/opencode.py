import json
import os
import re
import shutil
import subprocess
import threading
import time

from app.ai.base import CancelCheck, Persona, ProviderResult, is_recoverable
from app.tools.procs import kill_tree, wait_for_drain

MAX_PROMPT_CHARS = 12000
MODEL_PATTERN = re.compile(r"^[A-Za-z0-9@._/-]{1,80}$")


def build_argv(model: str, title: str | None = None, auto: bool = False) -> list[str]:
    if not MODEL_PATTERN.match(model):
        raise ValueError(f"Invalid model identifier: {model!r}")
    argv = ["opencode", "run", "--format", "json", "--model", model]
    if title:
        argv += ["--title", re.sub(r"[^A-Za-z0-9_-]", "-", title)[:60]]
    if auto:
        # Verified against `opencode run --help` (v2.1.4): auto-approves permissions that are
        # not explicitly denied. The process is started with cwd=<approved workspace>; this is
        # path scoping by convention, NOT an OS security boundary.
        argv.append("--auto")
    return argv


def parse_events(stdout: str) -> tuple[str, str | None]:
    """Extract assistant text and the first error message from opencode NDJSON output.
    Tolerant by design: unknown event types are ignored, and if nothing parses as JSON
    the whole output is treated as plain text (older/newer CLI formats)."""
    texts: list[str] = []
    error: str | None = None
    json_lines = 0
    for line in stdout.splitlines():
        stripped = line.strip()
        if not stripped or not stripped.startswith("{"):
            continue
        try:
            event = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        json_lines += 1
        etype = event.get("type")
        if etype == "error":
            err = event.get("error") or {}
            data = err.get("data") if isinstance(err.get("data"), dict) else {}
            error = error or str(err.get("message") or data.get("message") or err.get("type") or "Unknown opencode error")
        elif etype == "text":
            part = event.get("part") or {}
            if part.get("text"):
                texts.append(part["text"])
    if json_lines == 0:
        plain = "\n".join(l for l in stdout.splitlines() if not l.startswith(">")).strip()
        return plain, None
    return "".join(texts).strip(), error


class OpencodeProvider:
    """Runs the local opencode CLI once per work item. Text mode is plain JSON output;
    coding mode adds --auto and starts the CLI with cwd set to the approved per-task
    workspace, so relative file operations stay inside it. That confinement is a
    workspace convention, not an OS sandbox — the diff capture around each coding step is
    what proves what changed. Credentials stay inside opencode (`opencode auth login`);
    AgentVille never touches API keys."""

    name = "opencode"

    def __init__(self, binary: str | None = None) -> None:
        self.binary = binary or shutil.which("opencode") or "opencode"

    def _tag(self, result: ProviderResult, model: str) -> ProviderResult:
        result.provider = self.name
        result.model = model
        if not result.ok:
            result.recoverable = is_recoverable(result.error)
        return result

    def run(self, persona: Persona, prompt: str, timeout_s: int = 300,
            should_cancel: CancelCheck | None = None) -> ProviderResult:
        model = persona.model or "opencode/big-pickle"
        coding = persona.mode == "coding"
        if coding and not persona.workspace:
            return self._tag(ProviderResult(ok=False, error="coding step has no workspace"), model)
        try:
            argv = [self.binary if os.path.isabs(self.binary) else "opencode",
                    *build_argv(model, title=persona.key, auto=coding)[1:]]
        except ValueError as e:
            return self._tag(ProviderResult(ok=False, error=str(e)), model)
        full_prompt = f"{persona.instructions}\n\n---\n\nTask: {prompt}"[:MAX_PROMPT_CHARS]
        started = time.monotonic()
        try:
            proc = subprocess.Popen(
                argv,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                shell=False,
                start_new_session=True,
                cwd=str(persona.workspace) if coding else None,
            )
        except FileNotFoundError:
            return self._tag(ProviderResult(ok=False, error="opencode CLI not found on PATH"), model)

        box: dict = {}

        def _drain() -> None:
            box["io"] = proc.communicate(input=full_prompt)

        reader = threading.Thread(target=_drain, daemon=True)
        reader.start()
        deadline = started + timeout_s
        killed = False
        while reader.is_alive():
            if should_cancel and should_cancel():
                kill_tree(proc.pid)
                killed = True
                break
            if time.monotonic() > deadline:
                kill_tree(proc.pid)
                killed = True
                break
            reader.join(0.5)
        drained = wait_for_drain(reader)
        latency = time.monotonic() - started
        if killed:
            reason = "Cancelled" if (should_cancel and should_cancel()) else f"Timed out after {timeout_s}s"
            if not drained:
                reason += (" — pipes stayed open after killing the tree; a surviving descendant "
                           "may still hold the workspace, so do not assume it is clean")
            return self._tag(ProviderResult(ok=False, error=reason, latency_s=latency), model)
        if not drained:
            return self._tag(ProviderResult(ok=False, error="output pipes never reached EOF after the run",
                                            latency_s=latency), model)
        stdout, stderr = box.get("io", ("", ""))
        stdout, stderr = stdout or "", stderr or ""
        text, error_event = parse_events(stdout)
        if error_event:
            return self._tag(ProviderResult(ok=False, text=text, error=error_event, latency_s=latency), model)
        if proc.returncode != 0 or not text:
            fallback = (stderr or stdout or "").strip()[:300]
            return self._tag(ProviderResult(ok=False, text=text,
                                            error=fallback or f"opencode exited with code {proc.returncode}",
                                            latency_s=latency), model)
        return self._tag(ProviderResult(ok=True, text=text, latency_s=latency), model)


def list_available_models(timeout_s: int = 20) -> list[str]:
    """`opencode models` catalog for the UI picker. Raises RuntimeError when the CLI is unavailable."""
    binary = shutil.which("opencode")
    if not binary:
        raise RuntimeError("opencode CLI not found on PATH")
    result = subprocess.run([binary, "models"], capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=timeout_s, shell=False)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip()[:300] or "opencode models failed")
    return [line.strip() for line in result.stdout.splitlines() if "/" in line][:200]
