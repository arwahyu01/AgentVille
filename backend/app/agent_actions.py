"""What an agent is doing, as one short redacted line.

Shared by the Claude Code session hooks (`claude_sessions.py`) and by AgentVille's own Claude
provider, which turns the tool calls of a running step into `action_*` journal events. This
module imports nothing from the database layer so providers can use it freely.

Privacy: tool inputs can hold whole files, full shell commands and secrets. Only a bounded,
redacted one-liner is ever produced from them; the raw input is never stored or forwarded.
"""
import json
import os
import re
import time

SUMMARY_MAX = 120

# `key=value` / `key: value` pairs, and `Bearer <token>` / `Authorization <value>`; a bare word
# such as the file name `secret.env` is left alone.
_SECRET_KV = re.compile(r"(?i)\b(api[_-]?key|token|secret|password|passwd)\s*[:=]\s*\S+"
                        r"|\b(bearer|authorization:?)\s+\S+")
_LONG_TOKEN = re.compile(r"[A-Za-z0-9_\-+/=]{28,}")
# Model identifiers look exactly like a long token (`nvidia/stepfun-ai/step-5-preview`) but
# they are not secrets. Masking them turned "model X is unavailable" into "model '•••' is
# unavailable", which hid the real cause of a failure from everyone reading the journal.
_MODEL_ID = re.compile(
    r"(?<![\w./-])[A-Za-z0-9][A-Za-z0-9._-]{0,63}(?:/[A-Za-z0-9][A-Za-z0-9._-]{0,63}){1,3}(?![\w./-])")
_SPACE = re.compile(r"\s+")


def _mask_tokens(text: str) -> str:
    """Mask long opaque tokens while keeping model identifiers readable."""
    held: list[str] = []

    def hold(match: re.Match) -> str:
        held.append(match.group(0))
        return f"\x00{len(held) - 1}\x00"

    masked = _MODEL_ID.sub(hold, text)
    masked = _LONG_TOKEN.sub("•••", masked)
    for index, value in enumerate(held):
        masked = masked.replace(f"\x00{index}\x00", value)
    return masked


def redact(text: str, limit: int = SUMMARY_MAX) -> str:
    """One line, secrets masked, bounded length."""
    clean = _SPACE.sub(" ", str(text or "")).strip()
    clean = _SECRET_KV.sub(lambda m: f"{(m.group(1) or m.group(2)).rstrip(':')} •••", clean)
    clean = _mask_tokens(clean)
    return clean if len(clean) <= limit else clean[: limit - 1] + "…"


def scrub_secrets(text: str) -> str:
    """Mask secret-looking values while preserving newlines and layout (journal messages
    such as plans or QC findings are multi-line, so they cannot be flattened)."""
    clean = _SECRET_KV.sub(lambda m: f"{(m.group(1) or m.group(2)).rstrip(':')} •••",
                           str(text or ""))
    return _mask_tokens(clean)


def sanitize_event(text: str, limit: int = 4000) -> str:
    """The single gate every journal message goes through: secrets masked, size bounded.
    Never stores raw tool input, credentials or an unbounded provider error."""
    clean = scrub_secrets(text).strip()
    return clean if len(clean) <= limit else clean[: limit - 1] + "…"


def _base(path: str) -> str:
    return os.path.basename(str(path or "").rstrip("/\\")) or str(path or "")


def summarize_tool(tool: str, data: dict | None) -> str:
    """A short Indonesian line for a tool call, built only from safe fields."""
    data = data if isinstance(data, dict) else {}
    tool = str(tool or "")
    if tool in ("Read", "Edit", "Write", "MultiEdit", "NotebookEdit"):
        verb = {"Read": "Baca", "Write": "Tulis"}.get(tool, "Edit")
        return redact(f"{verb} {_base(data.get('file_path') or data.get('notebook_path') or '')}")
    if tool == "Bash":
        # Prefer Claude's own description of the command; fall back to the program name only.
        desc = data.get("description")
        if desc:
            return redact(f"Terminal: {desc}")
        words = str(data.get("command") or "").split()
        return redact(f"Terminal: {' '.join(words[:2])}" if words else "Terminal")
    if tool in ("Glob", "Grep"):
        return redact(f"Cari: {data.get('pattern') or ''}", 60)
    if tool == "WebFetch":
        url = str(data.get("url") or "")
        host = re.sub(r"^[a-z]+://", "", url).split("/")[0]
        return redact(f"Buka web: {host}")
    if tool == "WebSearch":
        return redact(f"Cari web: {data.get('query') or ''}", 70)
    if tool in ("Agent", "Task"):
        return redact(f"Subagen: {data.get('description') or data.get('subagent_type') or ''}")
    if tool.startswith("mcp__"):
        parts = tool.split("__")
        return redact(f"MCP {parts[1] if len(parts) > 1 else ''} · {parts[-1]}")
    if tool in ("TodoWrite", "TaskCreate", "TaskUpdate"):
        return "Perbarui daftar tugas"
    return redact(tool or "Alat")


# ── Live tool calls → action events ──────────────────────────────────────────────────────────

# Journal event types are `action_<kind>` (max 32 chars in task_events.event_type).
ACTION_KINDS = ("read", "write", "run", "search", "think")
_KIND_BY_TOOL = {
    "Read": "read",
    "Write": "write", "Edit": "write", "MultiEdit": "write", "NotebookEdit": "write",
    "Bash": "run",
    "Glob": "search", "Grep": "search", "WebSearch": "search", "WebFetch": "search",
    "Agent": "think", "Task": "think", "TodoWrite": "think",
}


def action_kind(tool: str) -> str:
    """Coarse kind for a tool name; MCP and unknown tools read as a generic `run`."""
    return _KIND_BY_TOOL.get(str(tool or ""), "run")


def actions_from_stream_line(line: str) -> list[tuple[str, str]]:
    """`claude -p --output-format stream-json --verbose` prints one JSON event per line. Each
    tool call is an `assistant` event whose content holds a `tool_use` block (name + input);
    everything else (init, thinking, tool results, summaries) yields nothing."""
    line = (line or "").strip()
    if not line.startswith("{"):
        return []
    try:
        event = json.loads(line)
    except json.JSONDecodeError:
        return []
    if not isinstance(event, dict) or event.get("type") != "assistant":
        return []
    message = event.get("message")
    blocks = message.get("content") if isinstance(message, dict) else None
    out: list[tuple[str, str]] = []
    for block in blocks if isinstance(blocks, list) else []:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            name = str(block.get("name") or "")
            out.append((action_kind(name), summarize_tool(name, block.get("input"))))
    return out


class ActionGate:
    """Keeps the journal readable: at most one action per `min_gap_s` and `max_total` per step.
    The newest call wins over a skipped one only by being the next to arrive, so a burst of
    reads shows its first line and the next distinct moment, not every file."""

    def __init__(self, min_gap_s: float = 1.5, max_total: int = 60, clock=time.monotonic) -> None:
        self.min_gap_s = min_gap_s
        self.max_total = max_total
        self._clock = clock
        self._last = float("-inf")
        self.sent = 0

    def allow(self) -> bool:
        now = self._clock()
        if self.sent >= self.max_total or now - self._last < self.min_gap_s:
            return False
        self._last = now
        self.sent += 1
        return True
