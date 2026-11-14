#!/usr/bin/env python3
"""Show your Claude Code sessions as characters in the AgentVille office.

Adds HTTP hooks to a Claude Code settings file so each session POSTs its lifecycle events
(prompt submitted, tool used, waiting for permission, turn finished, session ended) to the local
AgentVille backend. If the backend is not running, Claude Code treats the failed POST as a
non-blocking error and carries on — nothing in your sessions waits on AgentVille.

Usage (default is a dry run that only prints what would change):
  python3 scripts/claude_hooks.py                      # preview for ~/.claude/settings.json
  python3 scripts/claude_hooks.py --apply              # merge into ~/.claude/settings.json
  python3 scripts/claude_hooks.py --apply --project .  # only this project (.claude/settings.local.json)
  python3 scripts/claude_hooks.py --remove --apply     # take the AgentVille hooks out again

Existing hooks are kept. A timestamped backup is written next to the file before any change.
"""
from __future__ import annotations  # macOS ships Python 3.9; keep `str | None` hints working

import argparse
import copy
import json
import sys
import time
from pathlib import Path

DEFAULT_URL = "http://127.0.0.1:8000/api/claude/hooks"
EVENTS = (
    "SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest",
    "Notification", "SubagentStart", "Stop", "StopFailure", "SessionEnd",
)
TOOL_EVENTS = {"PreToolUse", "PostToolUse", "PermissionRequest"}


def hook_entry(url: str) -> dict:
    return {
        "type": "http",
        "url": url,
        "timeout": 3,
        # AgentVille's own Claude provider sets AGENTVILLE_RUN; the backend skips those runs so a
        # step is not drawn twice (once as the AgentVille agent, once as a Claude session).
        "headers": {"X-AgentVille-Run": "$AGENTVILLE_RUN"},
        "allowedEnvVars": ["AGENTVILLE_RUN"],
    }


def _ours(entry: dict, url: str) -> bool:
    return isinstance(entry, dict) and entry.get("type") == "http" and entry.get("url") == url


def merge(settings: dict, url: str) -> dict:
    out = copy.deepcopy(settings)
    hooks = out.setdefault("hooks", {})
    for event in EVENTS:
        groups = hooks.setdefault(event, [])
        if any(_ours(h, url) for g in groups if isinstance(g, dict) for h in g.get("hooks", [])):
            continue
        group: dict = {"hooks": [hook_entry(url)]}
        if event in TOOL_EVENTS:
            group = {"matcher": "*", **group}
        groups.append(group)
    return out


def remove(settings: dict, url: str) -> dict:
    out = copy.deepcopy(settings)
    hooks = out.get("hooks")
    if not isinstance(hooks, dict):
        return out
    for event in list(hooks):
        kept = []
        for group in hooks[event] if isinstance(hooks[event], list) else []:
            if not isinstance(group, dict):
                kept.append(group)
                continue
            rest = [h for h in group.get("hooks", []) if not _ours(h, url)]
            if rest:
                kept.append({**group, "hooks": rest})
        if kept:
            hooks[event] = kept
        else:
            del hooks[event]
    if not hooks:
        out.pop("hooks", None)
    return out


def target_file(project: str | None) -> Path:
    if project:
        return Path(project).expanduser().resolve() / ".claude" / "settings.local.json"
    return Path.home() / ".claude" / "settings.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="write the change (default: preview only)")
    parser.add_argument("--remove", action="store_true", help="remove the AgentVille hooks instead of adding them")
    parser.add_argument("--project", metavar="DIR", help="use DIR/.claude/settings.local.json instead of your user settings")
    parser.add_argument("--url", default=DEFAULT_URL, help=f"hook endpoint (default {DEFAULT_URL})")
    args = parser.parse_args(argv)

    path = target_file(args.project)
    try:
        current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except (OSError, json.JSONDecodeError) as e:
        print(f"Cannot read {path}: {e}", file=sys.stderr)
        return 1
    if not isinstance(current, dict):
        print(f"{path} does not hold a JSON object; leaving it alone.", file=sys.stderr)
        return 1
    updated = remove(current, args.url) if args.remove else merge(current, args.url)
    if updated == current:
        print(f"No change needed in {path}.")
        return 0
    if not args.apply:
        print(f"# Preview — would write {path}:\n")
        print(json.dumps(updated.get("hooks", {}), indent=2))
        print("\nRun again with --apply to write it.")
        return 0
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        backup = path.with_name(f"{path.name}.agentville-bak-{time.strftime('%Y%m%d-%H%M%S')}")
        backup.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Backup: {backup}")
    path.write_text(json.dumps(updated, indent=2) + "\n", encoding="utf-8")
    action = "Removed" if args.remove else "Added"
    print(f"{action} AgentVille hooks in {path}. New Claude Code sessions pick this up when they start.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
