"""Explicit, config-gated provider fallback.

Quota/transport failures on the primary provider may be retried on the alternate one,
but NEVER silently for a coding step that might already have written files — the user
must decide what happens to half-finished work.
"""

from app.ai.base import AIProvider, CancelCheck, Persona, ProviderResult, is_recoverable


def should_fallback(result: ProviderResult) -> bool:
    return not result.ok and result.recoverable and "Cancelled" not in (result.error or "")


def run_with_fallback(primary: AIProvider, alternate: AIProvider, persona: Persona, prompt: str,
                      timeout_s: int = 300, should_cancel: CancelCheck | None = None,
                      diff_probe=None,
                      alternate_persona: Persona | None = None) -> tuple[ProviderResult, ProviderResult | None]:
    """Returns (first_result, fallback_result or None). For coding steps the fallback only
    runs when diff_probe() proves the primary provider changed nothing yet.

    `alternate_persona` carries the alternate engine's own model. Reusing the primary's
    persona verbatim meant a provider was asked to run another provider's model id
    (opencode's `vendor/model` on qodercli, for example), so every fallback died with
    `Invalid model identifier` instead of doing the work."""
    first = primary.run(persona, prompt, timeout_s=timeout_s, should_cancel=should_cancel)
    if first.ok or not should_fallback(first):
        return first, None
    if persona.mode == "coding":
        status, diff = diff_probe() if diff_probe else ("unknown", "")
        if (status or diff).strip() and status != "no-changes":
            first.error = f"{first.error} (fallback skipped: provider already changed the workspace)"
            first.recoverable = False
            return first, None
    second = alternate.run(alternate_persona or persona, prompt, timeout_s=timeout_s,
                           should_cancel=should_cancel)
    return first, second
