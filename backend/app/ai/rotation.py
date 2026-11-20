"""Automatic model/provider rotation for quota exhaustion.

The configured pair runs first. When it answers "free usage limit / quota / 429", the
rotating provider hands the same prompt to the next candidate (same CLI, another model,
or another installed provider) and keeps going until the chain is exhausted. Free models
come first in the chain, exactly as asked: if one engine runs out of tokens, the office
moves to the next one instead of failing the job.

Providers are only swapped through this decorator, so nothing else in the pipeline knows
the difference; the result carries the provider/model that actually answered.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Callable

from app.ai import registry
from app.ai.base import AIProvider, CancelCheck, Persona, ProviderResult
from app.ai.base import is_recoverable

QUOTA_HINTS = ("free usage limit", "rate limit", "429", "quota", "overloaded",
               "out of credits", "usage limit")
# Errors that prove the engine refused the work before it could touch the workspace.
ENGINE_REFUSED_HINTS = QUOTA_HINTS + ("401", "402", "403", "502", "503", "504",
                                      "model not found", "end of life", "no longer available",
                                      "model unavailable", "model is unavailable", "retired",
                                      "unauthorized", "forbidden")


def quota_exhausted(result: ProviderResult) -> bool:
    """True for 'this engine cannot go on' failures — quota, rate limit, overload, gateway
    errors, timeouts. Worth retrying somewhere else. A crash, a bad file or a cancellation
    is not."""
    if result.ok or "Cancelled" in (result.error or ""):
        return False
    lowered = (result.error or "").lower()
    if any(hint in lowered for hint in QUOTA_HINTS):
        return True
    return is_recoverable(result.error)


def safe_to_rotate(result: ProviderResult, persona: Persona) -> bool:
    """A coding step is only handed to another engine when this engine clearly refused
    before doing work. A timeout/crash may have left partial files, so it stops for an
    explicit resume decision instead of silently running the step twice."""
    if not quota_exhausted(result):
        return False
    if persona.mode != "coding":
        return True
    lowered = (result.error or "").lower()
    return any(hint in lowered for hint in ENGINE_REFUSED_HINTS)


def looks_free(model: str) -> bool:
    lowered = (model or "").lower()
    return "free" in lowered or ":free" in lowered or lowered.endswith("-free")


def free_key(model: str) -> tuple[int, str]:
    # free models first, then a stable order so the chain is deterministic.
    return (0 if looks_free(model) else 1, model or "")


def candidate_chain(primary_name: str, model: str, provider_names: list[str],
                    models_by_provider: dict[str, list[str]], limit: int = 4) -> list[tuple[str, str]]:
    """Ordered (provider, model) pairs to try after the current one is out of quota.
    The configured pair is never repeated; free models sort first inside each provider."""
    others: list[tuple[str, str]] = []
    for name in provider_names:
        for candidate in models_by_provider.get(name, []):
            if name == primary_name and candidate == model:
                continue
            others.append((name, candidate))
    others.sort(key=lambda pair: free_key(pair[1]))
    if limit > 0:
        others = others[:limit]
    return others


class RotatingProvider:
    """Provider decorator: one engine first, then the candidates until one answers."""

    name = "auto"

    def __init__(self, primary: AIProvider, primary_name: str, model: str,
                 candidates: list[tuple[str, str]], coding_providers: set[str],
                 on_switch: Callable[[str, str, str, str], None] | None = None):
        self._primary = primary
        self._primary_name = primary_name
        self._model = model
        self._candidates = list(candidates)
        self._coding_providers = coding_providers
        self._on_switch = on_switch
        self.switched: list[str] = []
        self._engines: dict[str, AIProvider] = {primary_name: primary}

    def _engine(self, name: str) -> AIProvider:
        if name not in self._engines:
            self._engines[name] = registry.make_provider(name)
        return self._engines[name]

    def _allowed(self, name: str, persona: Persona) -> bool:
        if persona.mode != "coding":
            return True
        return name in self._coding_providers

    def run(self, persona: Persona, prompt: str, timeout_s: int = 300,
            should_cancel: CancelCheck | None = None) -> ProviderResult:
        engine, name, model = self._primary, self._primary_name, self._model
        # The chain is a finite list that is consumed one candidate at a time, so the loop
        # cannot spin: it ends when the chain is empty or the caller cancels. Do not add a
        # second, smaller cap here — `rotate_models_max` is the configured limit.
        while True:
            result = engine.run(replace(persona, model=model), prompt, timeout_s=timeout_s,
                                should_cancel=should_cancel)
            if result.ok or not quota_exhausted(result):
                if name != self._primary_name or model != self._model:
                    result = replace(result, provider=name or result.provider,
                                     model=model or result.model)
                return result
            if not safe_to_rotate(result, persona):
                # A coding attempt may already have written files. Do not hand the same
                # step to another engine behind the user's back.
                if persona.mode == "coding":
                    result = replace(result, error=(result.error or "provider failed") +
                                     " — not rotated: a coding step may have left partial "
                                     "changes; inspect the workspace before retrying")
                return result
            # out of budget: move to the next candidate that may take this persona.
            nxt = None
            while self._candidates:
                candidate_name, candidate_model = self._candidates.pop(0)
                if self._allowed(candidate_name, persona):
                    nxt = (candidate_name, candidate_model)
                    break
            if nxt is None or (should_cancel and should_cancel()):
                return result
            engine, name, model = self._engine(nxt[0]), nxt[0], nxt[1]
            note = (f"{self._primary_name}/{self._model} kehabisan kuota → "
                    f"dilanjutkan {name}/{model}")
            if note not in self.switched:
                self.switched.append(note)
            if self._on_switch:
                self._on_switch(self._primary_name, self._model, name, model)
