"""Claude Code CLI provider (`claude -p`).

Flags are taken from the Claude Code CLI reference (code.claude.com/docs/en/cli-reference):
`-p`, `--output-format json`, `--model`, `--tools`, `--allowedTools`, `--permission-mode`,
`--no-session-persistence` and `--strict-mcp-config`. They were not run against a local binary
when this module was written (no `claude` CLI on the dev machine), so the argv snapshot tests
pin the shape and the availability probe reports a missing binary honestly.

Isolation:
- Text mode disables every built-in tool (`--tools ""`) and loads no MCP servers.
- Coding mode runs with cwd = the approved workspace, `--permission-mode acceptEdits` and an
  explicit tool list. Like qodercli/opencode this is scoping by CLI convention, not an OS jail;
  the git diff around each step remains the proof of what changed.
- Every run carries `AGENTVILLE_RUN` in its environment. The optional AgentVille hooks forward
  it as a header, so the office does not draw a second "Claude session" character for work an
  AgentVille agent is already shown doing.
"""
import json
import os
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

from app.agent_actions import actions_from_stream_line
from app.ai.base import CancelCheck, Persona, ProviderResult, is_recoverable
from app.tools import registry
from app.tools.procs import OutputPump, kill_tree, reap, wait_for_drain, watch_run

MAX_PROMPT_CHARS = 12000
# A silent engine is a stuck engine; see app.tools.procs.OutputPump.
IDLE_TIMEOUT_S = 120.0
# Aliases (sonnet, opus, haiku, fable) or full model ids such as claude-sonnet-5-5.
MODEL_PATTERN = re.compile(r"^[A-Za-z0-9._\-\[\]]{1,80}$")
CODING_TOOLS = "Read,Write,Edit,Glob,Grep,Bash"
MODEL_ALIASES = ["sonnet", "opus", "haiku", "fable"]
RUN_ENV = "AGENTVILLE_RUN"


BIN_ENV = "AGENTVILLE_CLAUDE_BIN"


def _version_key(path: Path) -> tuple:
    """Sort key from the first `2.1.325`-style folder in the path, so the newest install wins."""
    match = re.search(r"(\d+(?:\.\d+)+)", str(path))
    return tuple(int(p) for p in match.group(1).split(".")) if match else ()


def desktop_binaries() -> list[Path]:
    """Claude Code executables bundled with the Claude Desktop app on macOS, newest first.
    Desktop keeps one folder per version (`claude-code/<version>/<hash>/claude.app`) and prunes old
    ones on update, so the path is looked up at run time instead of being stored."""
    root = Path.home() / "Library" / "Application Support" / "Claude" / "claude-code"
    found = [p for p in root.glob("*/*/claude.app/Contents/MacOS/claude") if os.access(p, os.X_OK)]
    return sorted(found, key=_version_key, reverse=True)


def find_binary() -> str | None:
    """Order: explicit override, `claude` on PATH, the native/legacy installs, then the copy that
    ships inside Claude Desktop. The Desktop copy is a separate login from the Desktop chat app:
    run `<path> auth login` once."""
    override = os.environ.get(BIN_ENV, "").strip()
    if override and Path(override).is_file() and os.access(override, os.X_OK):
        return override
    found = shutil.which("claude")
    if found:
        return found
    for candidate in (Path.home() / ".local" / "bin" / "claude", Path.home() / ".claude" / "local" / "claude"):
        if candidate.exists() and os.access(candidate, os.X_OK):
            return str(candidate)
    bundled = desktop_binaries()
    return str(bundled[0]) if bundled else None


def _check_model(model: str) -> None:
    if not MODEL_PATTERN.match(model):
        raise ValueError(f"Invalid model identifier: {model!r}")


def _output_flags(stream: bool) -> list[str]:
    # stream-json prints one event per line (tool calls included) and requires --verbose; the
    # final `result` event has the same shape as the single object `json` prints.
    return ["--output-format", "stream-json", "--verbose"] if stream else ["--output-format", "json"]


def build_text_argv(binary: str, model: str, stream: bool = False) -> list[str]:
    _check_model(model)
    return [binary, "-p", *_output_flags(stream), "--no-session-persistence",
            "--strict-mcp-config", "--model", model, "--tools", ""]


def build_coding_argv(binary: str, model: str, stream: bool = False,
                      allowed_tools: str = CODING_TOOLS) -> list[str]:
    _check_model(model)
    return [binary, "-p", *_output_flags(stream), "--no-session-persistence",
            "--strict-mcp-config", "--model", model, "--permission-mode", "acceptEdits",
            "--tools", allowed_tools, "--allowedTools", allowed_tools]


def parse_result(stdout: str) -> tuple[str, str | None]:
    """`--output-format json` prints one result object; tolerate stray log lines around it."""
    candidates = [stdout.strip()] + [line.strip() for line in stdout.splitlines()]
    for chunk in candidates:
        if not chunk.startswith("{"):
            continue
        try:
            event = json.loads(chunk)
        except json.JSONDecodeError:
            continue
        if isinstance(event, dict) and event.get("type") == "result":
            if event.get("is_error"):
                return "", str(event.get("result") or event.get("subtype") or "claude reported an error")
            return str(event.get("result") or ""), None
    return "", None


class ClaudeProvider:
    """Runs the local Claude Code CLI once per work item, logged in with the machine's own
    `claude auth login` (or ANTHROPIC_API_KEY). AgentVille never stores a key."""

    name = "claude"

    def __init__(self, binary: str | None = None) -> None:
        self.binary = binary or find_binary() or "claude"

    def _tag(self, result: ProviderResult, model: str) -> ProviderResult:
        result.provider = self.name
        result.model = model
        if not result.ok:
            result.recoverable = is_recoverable(result.error)
        return result

    def run(self, persona: Persona, prompt: str, timeout_s: int = 300,
            should_cancel: CancelCheck | None = None) -> ProviderResult:
        model = persona.model or "sonnet"
        coding = persona.mode == "coding"
        if coding and not persona.workspace:
            return self._tag(ProviderResult(ok=False, error="coding step has no workspace"), model)
        sink = persona.on_action
        stream = sink is not None
        try:
            argv = (build_coding_argv(self.binary, model, stream,
                                      ",".join(registry.cli_allowlist(persona.tools)))
                    if coding else build_text_argv(self.binary, model, stream))
        except ValueError as e:
            return self._tag(ProviderResult(ok=False, error=str(e)), model)
        full_prompt = f"{persona.instructions}\n\n---\n\nTask: {prompt}"[:MAX_PROMPT_CHARS]
        env = dict(os.environ)
        env[RUN_ENV] = f"{persona.key}:{int(time.time())}"
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
                env=env,
            )
        except FileNotFoundError:
            return self._tag(ProviderResult(ok=False, error="claude CLI not found on PATH"), model)

        box: dict = {}
        if sink is None:
            reader = OutputPump(proc, full_prompt).start()
            if reader.feeds_stdin:
                try:
                    proc.stdin.write(full_prompt)
                    proc.stdin.flush()
                    proc.stdin.close()
                except Exception:  # noqa: BLE001 - a CLI that closed stdin early still reports via stdout
                    pass
            activity = None
        else:
            activity_box = {"last": time.monotonic()}

            def _drain() -> None:
                box["io"] = _drain_stream(proc, full_prompt, sink, activity_box)

            reader = threading.Thread(target=_drain, daemon=True)
            reader.start()
            activity = lambda: activity_box["last"]
        deadline = started + timeout_s
        outcome = watch_run(proc, reader, deadline, should_cancel, idle_s=IDLE_TIMEOUT_S,
                            activity=activity)
        killed = outcome != "finished"
        drained = wait_for_drain(reader)
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
        stdout, stderr = (reader.text() if isinstance(reader, OutputPump)
                          else box.get("io", ("", "")))
        stdout, stderr = stdout or "", stderr or ""
        text, error_event = parse_result(stdout)
        if error_event:
            return self._tag(ProviderResult(ok=False, text=text, error=error_event, latency_s=latency), model)
        rc = reap(proc)
        if rc not in (None, 0) or not text:
            fallback = (stderr or "").strip()[:300] or (stdout or "").strip()[-400:]
            return self._tag(ProviderResult(ok=False, text=text,
                                            error=fallback or f"claude exited with code {rc}",
                                            latency_s=latency), model)
        return self._tag(ProviderResult(ok=True, text=text, latency_s=latency), model)


def _drain_stream(proc, prompt: str, sink, activity: dict | None = None) -> tuple[str, str]:
    """Like `communicate()`, but hands each tool call to `sink` while the process still runs.
    Stdin and stderr get their own threads so a full pipe can never stall the stdout loop. A
    failing sink is ignored: the journal is a convenience and must not abort a working step."""
    err: list[str] = []

    def _write() -> None:
        try:
            proc.stdin.write(prompt)
        except (BrokenPipeError, OSError, ValueError):
            pass
        finally:
            try:
                proc.stdin.close()
            except (OSError, ValueError):
                pass

    def _read_err() -> None:
        try:
            err.append(proc.stderr.read() or "")
        except (OSError, ValueError):
            pass

    threads = [threading.Thread(target=_write, daemon=True), threading.Thread(target=_read_err, daemon=True)]
    for t in threads:
        t.start()
    lines: list[str] = []
    for line in proc.stdout:
        lines.append(line)
        if activity is not None:
            activity["last"] = time.monotonic()
        for kind, summary in actions_from_stream_line(line):
            try:
                sink(kind, summary)
            except Exception:  # noqa: BLE001 - see docstring
                pass
    proc.wait()
    for t in threads:
        t.join(2)
    return "".join(lines), "".join(err)


def list_available_models(timeout_s: int = 30) -> list[str]:
    """The CLI has no model-listing command; `--model` accepts these aliases or a full id."""
    if not find_binary():
        raise RuntimeError("claude CLI not found on PATH — install Claude Code and run `claude auth login`")
    return list(MODEL_ALIASES)
