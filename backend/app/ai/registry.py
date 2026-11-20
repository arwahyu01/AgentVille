import re
import threading
import time

from app.ai import claude as claude_mod
from app.ai import opencode as opencode_mod
from app.ai import qoder as qoder_mod
from app.ai.base import AIProvider
from app.ai.claude import ClaudeProvider
from app.ai.opencode import OpencodeProvider
from app.ai.qoder import QoderProvider

_MODEL_CACHE_TTL_S = 120.0
_cache: dict[str, tuple[float, list[str]]] = {}
_cache_lock = threading.Lock()


def make_provider(name: str) -> AIProvider:
    if name == "qoder":
        return QoderProvider()
    if name == "claude":
        return ClaudeProvider()
    return OpencodeProvider()


PROVIDERS = ("opencode", "qoder", "claude")


def capabilities() -> dict[str, dict]:
    """Explicit per-provider capability matrix, probed from the binaries on this machine."""
    return {
        "opencode": {
            "text": OpencodeProvider,
            "coding": OpencodeProvider,
            "coding_flags": "--auto + cwd=<workspace> (opencode >= 2.x; verify with `opencode run --help`)",
        },
        "qoder": {
            "text": QoderProvider,
            "coding": QoderProvider,
            "coding_flags": "--permission-mode accept_edits + -w <workspace>",
        },
        "claude": {
            "text": ClaudeProvider,
            "coding": ClaudeProvider,
            "coding_flags": "--permission-mode acceptEdits + --tools/--allowedTools + cwd=<workspace>",
        },
    }


def coding_provider(cfg_name: str) -> tuple[str, type] | tuple[None, None]:
    """Pick a provider that can run coding steps: the configured one if it supports coding,
    otherwise any other that does. Returns (name, provider class)."""
    caps = capabilities()
    order = [cfg_name] + [n for n in caps if n != cfg_name]
    for name in order:
        cap = caps.get(name)
        if cap is not None and isinstance(cap["coding"], type):
            return name, cap["coding"]
    return None, None


def availability() -> dict[str, dict]:
    caps = capabilities()
    result = {}
    for name, cap in caps.items():
        if name == "opencode":
            available = bool(opencode_mod.shutil.which("opencode"))
            reason = None if available else "opencode CLI not found on PATH — install it or run `opencode auth login`"
        elif name == "claude":
            available = bool(claude_mod.find_binary())
            reason = None if available else ("claude CLI not found — install Claude Code "
                                             "(curl -fsSL https://claude.ai/install.sh | bash) and run `claude auth login`")
        else:
            available = bool(qoder_mod.find_binary())
            reason = None if available else "qodercli not found — install Qoder CLI or add it to PATH"
        result[name] = {
            "available": available,
            "reason": reason,
            "coding": available,
            "coding_flags": cap["coding_flags"] if available else "unavailable — CLI binary not found",
        }
    return result


# What each CLI accepts as a model identifier. These differ on purpose: opencode uses
# "<vendor>/<model>" ids, while qodercli and Claude Code reject a slash outright. Passing one
# provider's model to another is therefore an instant, avoidable failure — which is exactly
# what used to happen on every fallback (`Invalid model identifier: '...'`).
MODEL_PATTERNS = {
    "opencode": re.compile(r"^[A-Za-z0-9@._/\-]{1,120}$"),
    "qoder": re.compile(r"^[A-Za-z0-9 ._\-]{1,80}$"),
    "claude": re.compile(r"^[A-Za-z0-9._\-\[\]]{1,80}$"),
}


def model_supported(provider: str, model: str) -> bool:
    """True when `provider`'s CLI can accept this model identifier at all."""
    if not model:
        return False
    pattern = MODEL_PATTERNS.get(provider)
    return pattern is None or bool(pattern.match(model))


def resolve_model(provider: str, preferred: str, fallback: str = "") -> str:
    """A model identifier this provider can actually run.

    Used whenever a step moves between engines (fallback, rotation, rescue): the model that
    belongs to the provider is kept only if it is valid there, otherwise the provider's own
    configured model is used. An empty string means "no usable model", so the caller can
    skip that engine instead of launching a run that is guaranteed to fail."""
    if model_supported(provider, preferred):
        return preferred
    if model_supported(provider, fallback):
        return fallback
    return ""


def list_models(provider: str, force: bool = False) -> list[str]:
    if provider == "qoder":
        return _cached(provider, qoder_mod.list_available_models, force)
    if provider == "claude":
        return _cached(provider, claude_mod.list_available_models, force)
    return _cached("opencode", opencode_mod.list_available_models, force)


def _cached(key: str, fetch, force: bool) -> list[str]:
    now = time.monotonic()
    with _cache_lock:
        hit = _cache.get(key)
        if hit and not force and now - hit[0] < _MODEL_CACHE_TTL_S:
            return hit[1]
    models = fetch()
    with _cache_lock:
        _cache[key] = (now, models)
    return models
