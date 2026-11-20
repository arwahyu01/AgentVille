import json
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

from app.ai.base import CancelCheck, Persona, ProviderResult, is_recoverable
from app.tools import registry
from app.tools.procs import OutputPump, kill_tree, reap, wait_for_drain, watch_run

MAX_PROMPT_CHARS = 12000
# A silent engine is a stuck engine; see app.tools.procs.OutputPump.
IDLE_TIMEOUT_S = 120.0
MODEL_PATTERN = re.compile(r"^[A-Za-z0-9 ._-]{1,80}$")
CODING_TOOLS = "Read,Write,Edit,Glob,Grep,Bash"
# Canonical registry name → the CLI tool name qodercli understands.
def cli_tools(tools: tuple[str, ...] | list[str]) -> str:
    """Minimum allowlist for this step, in qodercli's names. Unknown/empty → default set."""
    return ",".join(registry.cli_allowlist(tools))
QODER_HOME = Path.home() / ".qoder" / "bin" / "qodercli"


def find_binary() -> str | None:
    found = shutil.which("qodercli")
    if found:
        return found
    for candidate in (QODER_HOME / "qodercli.exe", QODER_HOME / "qodercli"):
        if candidate.exists():
            return str(candidate)
    return None


def _default_config_dir() -> Path:
    """Reuse the machine-level qodercli login when present; a dedicated dir otherwise."""
    machine = Path.home() / ".qoder"
    if (machine / ".auth").exists():
        return machine
    return Path.home() / ".agentville-qoder"


def build_text_argv(binary: str, model: str, config_dir: str) -> list[str]:
    if not MODEL_PATTERN.match(model):
        raise ValueError(f"Invalid model identifier: {model!r}")
    return [binary, "-p", "--output-format", "json", "--no-session-persistence",
            "--config-dir", config_dir, "--tools", "", "-m", model]


def build_coding_argv(binary: str, model: str, workspace: str, config_dir: str,
                      allowed_tools: str = CODING_TOOLS) -> list[str]:
    if not MODEL_PATTERN.match(model):
        raise ValueError(f"Invalid model identifier: {model!r}")
    return [binary, "-p", "--output-format", "json", "--config-dir", config_dir,
            "-w", workspace, "--permission-mode", "accept_edits",
            "--allowed-tools", allowed_tools, "-m", model]


def parse_result(stdout: str) -> tuple[str, str | None]:
    """qodercli -p --output-format json emits one result object; be tolerant of log noise."""
    for line in stdout.splitlines():
        stripped = line.strip()
        if not stripped.startswith("{"):
            continue
        try:
            event = json.loads(stripped)
        except json.JSONDecodeError:
            continue
        if event.get("type") == "result":
            if event.get("is_error"):
                return "", str(event.get("result") or event.get("subtype") or "qodercli reported an error")
            return str(event.get("result") or ""), None
    return "", None


class QoderProvider:
    """Runs the local Qoder CLI once per work item. Text mode has all tools disabled;
    coding mode sets cwd to the approved workspace with --permission-mode accept_edits.
    -w/accept_edits scopes edits by CLI convention — it is NOT an OS security boundary;
    the diff capture around each step is what proves what changed."""

    name = "qoder"

    def __init__(self, binary: str | None = None, config_dir: str | None = None) -> None:
        self.binary = binary or find_binary() or "qodercli"
        self.config_dir = config_dir or str(_default_config_dir())

    def _tag(self, result: ProviderResult, model: str) -> ProviderResult:
        result.provider = self.name
        result.model = model
        if not result.ok:
            result.recoverable = is_recoverable(result.error)
        return result

    def run(self, persona: Persona, prompt: str, timeout_s: int = 300,
            should_cancel: CancelCheck | None = None) -> ProviderResult:
        model = persona.model or "Efficient"
        coding = persona.mode == "coding"
        if coding and not persona.workspace:
            return self._tag(ProviderResult(ok=False, error="coding step has no workspace"), model)
        try:
            if coding:
                argv = build_coding_argv(self.binary, model, str(persona.workspace),
                                         self.config_dir, cli_tools(persona.tools))
            else:
                argv = build_text_argv(self.binary, model, self.config_dir)
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
                # -w scopes the CLI; cwd additionally scopes any relative path a tool use takes.
                cwd=str(persona.workspace) if coding else None,
            )
        except FileNotFoundError:
            return self._tag(ProviderResult(ok=False, error="qodercli not found on PATH"), model)

        pump = OutputPump(proc, full_prompt).start()
        if pump.feeds_stdin:
            try:
                proc.stdin.write(full_prompt)
                proc.stdin.flush()
                proc.stdin.close()
            except Exception:  # noqa: BLE001 - a CLI that closed stdin early still reports via stdout
                pass
        deadline = started + timeout_s
        outcome = watch_run(proc, pump, deadline, should_cancel, idle_s=IDLE_TIMEOUT_S)
        killed = outcome != "finished"
        drained = wait_for_drain(pump)
        latency = time.monotonic() - started
        if killed:
            reason = {"cancelled": "Cancelled",
                      "timeout": f"Timed out after {timeout_s}s",
                      "idle": (f"Engine produced no output for {IDLE_TIMEOUT_S:.0f}s — stopped "
                               f"early instead of waiting for the full {timeout_s}s")}[outcome]
            if not drained:
                reason += (" — pipes stayed open after killing the tree; a surviving descendant "
                           "may still hold the workspace, so do not assume it is clean")
            return self._tag(ProviderResult(ok=False, error=reason, latency_s=latency), model)
        if not drained:
            return self._tag(ProviderResult(ok=False, error="output pipes never reached EOF after the run",
                                            latency_s=latency), model)
        stdout, stderr = pump.text()
        stdout, stderr = stdout or "", stderr or ""
        text, error_event = parse_result(stdout)
        if error_event:
            return self._tag(ProviderResult(ok=False, text=text, error=error_event, latency_s=latency), model)
        rc = reap(proc)
        if rc not in (None, 0) or not text:
            fallback = (stderr or "").strip()[:300] or (stdout or "").strip()[-400:]
            return self._tag(ProviderResult(ok=False, text=text,
                                            error=fallback or f"qodercli exited with code {rc}",
                                            latency_s=latency), model)
        return self._tag(ProviderResult(ok=True, text=text, latency_s=latency), model)


def list_available_models(timeout_s: int = 30) -> list[str]:
    binary = find_binary()
    if not binary:
        raise RuntimeError("qodercli not found on PATH")
    result = subprocess.run([binary, "--list-models"], capture_output=True, text=True,
                            encoding="utf-8", errors="replace", timeout=timeout_s, shell=False)
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout).strip()[:300] or "qodercli --list-models failed")
    models = []
    for line in result.stdout.splitlines():
        name = line.strip()
        if not name or name.upper() == "MODEL":
            continue
        models.append(name)
    return models[:200]
