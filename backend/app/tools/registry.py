"""Declared tool surface for plans and agents.

AgentVille delegates coding work to a local CLI, so the orchestrator cannot intercept
every low-level call the model makes. What it *can* do — and what this module makes
explicit — is refuse a plan that asks for a tool nobody declared, refuse a mutating tool
on a role that may not write, and mark network/external tools so they stop at an explicit
human approval gate before any work starts.

This is an application-level contract, not an OS sandbox. The CLI flags documented in
`app/ai/opencode.py` / `app/ai/qoder.py` remain the execution boundary; the diff captured
around each step is what proves what actually changed.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

ToolKind = Literal["read", "write", "run", "network", "external"]
ToolRisk = Literal["low", "medium", "high"]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    kind: ToolKind
    summary: str
    needs_workspace: bool = True
    mutates: bool = False
    risk: ToolRisk = "low"


TOOLS: dict[str, ToolSpec] = {
    "read_file": ToolSpec("read_file", "read", "read one file inside the workspace"),
    "list_files": ToolSpec("list_files", "read", "list the files of the workspace"),
    "search_text": ToolSpec("search_text", "read", "search text/files inside the workspace"),
    "git_diff": ToolSpec("git_diff", "read", "inspect the workspace diff"),
    "write_file": ToolSpec("write_file", "write", "create or overwrite a file in the workspace",
                           mutates=True),
    "edit_file": ToolSpec("edit_file", "write", "change an existing file in the workspace",
                          mutates=True),
    "run_command": ToolSpec("run_command", "run", "run a local command in the workspace",
                            mutates=True, risk="medium"),
    "web_fetch": ToolSpec("web_fetch", "network", "fetch a URL from the internet",
                          needs_workspace=False, risk="medium"),
    "web_search": ToolSpec("web_search", "network", "search the web",
                           needs_workspace=False, risk="medium"),
    "publish_external": ToolSpec("publish_external", "external",
                                 "publish/deploy or otherwise change an external system",
                                 needs_workspace=False, mutates=True, risk="high"),
    "send_message": ToolSpec("send_message", "external",
                             "send a message to a real person or channel",
                             needs_workspace=False, mutates=True, risk="high"),
}

# The CLI names seen in provider streams, so a plan can use either the canonical name or
# the name the model already knows.
ALIASES = {
    "read": "read_file", "readfile": "read_file", "read_file": "read_file",
    "list": "list_files", "listfiles": "list_files", "list_files": "list_files",
    "glob": "list_files", "grep": "search_text", "search": "search_text",
    "search_text": "search_text", "git_diff": "git_diff", "diff": "git_diff",
    "write": "write_file", "writefile": "write_file", "write_file": "write_file",
    "edit": "edit_file", "multiedit": "edit_file", "edit_file": "edit_file",
    "bash": "run_command", "run": "run_command", "run_command": "run_command",
    "webfetch": "web_fetch", "web_fetch": "web_fetch",
    "websearch": "web_search", "web_search": "web_search",
    "publish": "publish_external", "deploy": "publish_external",
    "publish_external": "publish_external",
    "send_message": "send_message", "message": "send_message",
}

DEFAULT_CODING_TOOLS = ("read_file", "list_files", "search_text", "write_file",
                        "edit_file", "run_command", "git_diff")

# Canonical name → the tool name the local coding CLIs use (opencode/qoder/claude share it).
CLI_NAMES = {
    "read_file": "Read", "list_files": "Glob", "search_text": "Grep",
    "write_file": "Write", "edit_file": "Edit",
    "run_command": "Bash", "git_diff": "Bash",
}


def cli_allowlist(names, default: tuple[str, ...] = ("Read", "Write", "Edit", "Glob", "Grep",
                                                   "Bash")) -> list[str]:
    """The smallest CLI allowlist covering the declared tools. Empty/unknown → default set."""
    mapped = [CLI_NAMES[t] for t in names if t in CLI_NAMES]
    return list(dict.fromkeys(mapped)) or list(default)


def canonical_tool(name: str) -> str | None:
    """Map a plan/provider tool name to a declared tool, or None when it is unknown."""
    key = str(name or "").strip().lower().replace("-", "_").replace(" ", "_")
    return ALIASES.get(key) or (key if key in TOOLS else None)


def tool_spec(name: str) -> ToolSpec | None:
    canonical = canonical_tool(name)
    return TOOLS.get(canonical) if canonical else None


def normalise_tools(names: list[str]) -> list[str]:
    """Canonical, de-duplicated tool names. Unknown names are preserved so validation can
    reject them with a fixable message instead of silently dropping intent."""
    out: list[str] = []
    for raw in names:
        canonical = canonical_tool(raw)
        value = canonical or str(raw).strip()
        if value and value not in out:
            out.append(value)
    return out


def default_coding_tools() -> list[str]:
    return list(DEFAULT_CODING_TOOLS)
