from app.ai.base import Persona, ProviderResult
from app.ai.fallback import run_with_fallback, should_fallback


class Stub:
    name = "stub"

    def __init__(self, results):
        self.results = list(results)
        self.calls = 0

    def run(self, persona, prompt, timeout_s=300, should_cancel=None):
        self.calls += 1
        return self.results.pop(0)


def quota_error():
    return ProviderResult(ok=False, error="Free usage limit reached. Connect a provider.", recoverable=True)


def ok_result(text="fine"):
    return ProviderResult(ok=True, text=text)


def dead_end():
    return ProviderResult(ok=False, error="binary crashed", recoverable=False)


text_persona = Persona(key="k", name="Atlas", role="AI Coordinator", instructions="i")
coding_persona = Persona(key="k", name="Byte", role="Developer", instructions="i",
                         mode="coding", workspace="ws")


def test_should_fallback_only_recoverable():
    assert should_fallback(quota_error())
    assert not should_fallback(dead_end())
    assert not should_fallback(ProviderResult(ok=False, error="Cancelled", recoverable=True))


def test_text_step_falls_back_to_alternate():
    primary, alternate = Stub([quota_error()]), Stub([ok_result("from qoder")])
    first, second = run_with_fallback(primary, alternate, text_persona, "prompt")
    assert primary.calls == 1 and alternate.calls == 1
    assert second.ok and second.text == "from qoder"


def test_nonrecoverable_does_not_fallback():
    primary, alternate = Stub([dead_end()]), Stub([ok_result()])
    first, second = run_with_fallback(primary, alternate, text_persona, "prompt")
    assert alternate.calls == 0 and second is None


def test_coding_fallback_blocked_when_workspace_dirty():
    primary, alternate = Stub([quota_error()]), Stub([ok_result()])
    probe = lambda: ("M index.html", "diff text")
    first, second = run_with_fallback(primary, alternate, coding_persona, "prompt", diff_probe=probe)
    assert second is None and alternate.calls == 0
    assert "fallback skipped" in first.error


def test_coding_fallback_allowed_when_workspace_clean():
    primary, alternate = Stub([quota_error()]), Stub([ok_result()])
    first, second = run_with_fallback(primary, alternate, coding_persona, "prompt",
                                      diff_probe=lambda: ("no-changes", ""))
    assert second is not None and alternate.calls == 1


def test_ok_primary_never_touches_alternate():
    primary, alternate = Stub([ok_result()]), Stub([ok_result()])
    first, second = run_with_fallback(primary, alternate, text_persona, "p")
    assert first.ok and second is None and alternate.calls == 0
