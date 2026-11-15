import pytest

from app.ai import rotation as rot
from app.ai.base import Persona, ProviderResult
from app.ai.rotation import RotatingProvider, candidate_chain


class Stub:
    def __init__(self, name, results):
        self.name = name
        self.results = list(results)
        self.calls = 0

    def run(self, persona, prompt, timeout_s=300, should_cancel=None):
        self.calls += 1
        return self.results.pop(0) if self.results else ProviderResult(ok=False, error="no script left")


def quota():
    return ProviderResult(ok=False, error="Free usage limit reached. Connect a provider.", recoverable=True)


def ok(text="answer", provider="", model=""):
    return ProviderResult(ok=True, text=text, provider=provider, model=model)


def crashed():
    return ProviderResult(ok=False, error="binary crashed", recoverable=False)


persona = Persona(key="k", name="Byte", role="Developer", instructions="i")
coding = Persona(key="k", name="Byte", role="Developer", instructions="i", mode="coding", workspace="ws")


@pytest.fixture
def engines(monkeypatch):
    def make_provider(name):
        return stubs[name]
    stubs = {}
    monkeypatch.setattr(rot.registry, "make_provider", make_provider)
    return stubs


def test_quota_exhausted_detects_engine_failures():
    assert rot.quota_exhausted(quota())
    assert not rot.quota_exhausted(ok())
    assert not rot.quota_exhausted(crashed())
    assert not rot.quota_exhausted(ProviderResult(ok=False, error="Cancelled", recoverable=True))


def test_candidate_chain_prefers_free_models_and_skips_the_dead_pair():
    chain = candidate_chain(
        "opencode", "opencode/big-pickle",
        ["opencode", "qoder"],
        {"opencode": ["opencode/glm-5.3-flash-free", "opencode/gpt-5.5", "opencode/big-pickle"],
         "qoder": ["Efficient"]},
        limit=3,
    )
    assert chain[0] == ("opencode", "opencode/glm-5.3-flash-free")
    assert ("opencode", "opencode/big-pickle") not in chain
    assert len(chain) == 3


def test_rotating_provider_moves_to_a_free_model_on_quota(engines):
    engines["opencode"] = Stub("opencode", [quota(), ok("from free model")])
    engines["qoder"] = Stub("qoder", [ok("from qoder")])
    rotating = RotatingProvider(engines["opencode"], "opencode", "opencode/big-pickle",
                                [("opencode", "opencode/glm-5.3-flash-free"),
                                 ("qoder", "Efficient")], set())
    result = rotating.run(persona, "prompt")
    assert result.ok and result.text == "from free model"
    assert rotating.switched == ["opencode/opencode/big-pickle kehabisan kuota → "
                                 "dilanjutkan opencode/opencode/glm-5.3-flash-free"]
    # the dead model was asked once, the free model answered without touching qoder
    assert engines["opencode"].calls == 2
    assert engines["qoder"].calls == 0


def test_rotating_provider_keeps_going_until_the_chain_is_exhausted(engines):
    engines["opencode"] = Stub("opencode", [quota(), quota()])
    engines["qoder"] = Stub("qoder", [quota()])
    rotating = RotatingProvider(engines["opencode"], "opencode", "opencode/big-pickle",
                                [("qoder", "Efficient")], set())
    result = rotating.run(persona, "prompt")
    assert not result.ok and "usage limit" in result.error
    assert len(rotating.switched) == 1
    assert engines["qoder"].calls == 1


def test_non_quota_failures_never_rotate(engines):
    engines["opencode"] = Stub("opencode", [crashed()])
    engines["qoder"] = Stub("qoder", [ok()])
    rotating = RotatingProvider(engines["opencode"], "opencode", "opencode/big-pickle",
                                [("qoder", "Efficient")], set())
    result = rotating.run(persona, "prompt")
    assert not result.ok and rotating.switched == []
    assert engines["qoder"].calls == 0


def test_coding_persona_only_rotates_to_coding_engines(engines):
    engines["opencode"] = Stub("opencode", [quota()])
    rotating = RotatingProvider(engines["opencode"], "opencode", "opencode/big-pickle",
                                [("qoder", "Efficient")], coding_providers={"opencode"})
    result = rotating.run(coding, "prompt")
    assert not result.ok and rotating.switched == []


def test_rotating_provider_passes_the_new_model_to_the_engine(engines):
    seen = {}

    class Spy:
        name = "qoder"

        def run(self, persona, prompt, timeout_s=300, should_cancel=None):
            seen.update(model=persona.model, mode=persona.mode)
            return ok("done", "qoder", persona.model)

    engines["opencode"] = Stub("opencode", [quota()])
    engines["qoder"] = Spy()
    rotating = RotatingProvider(engines["opencode"], "opencode", "opencode/big-pickle",
                                [("qoder", "qoder-fast")], set())
    rotating.run(persona, "prompt")
    assert seen["model"] == "qoder-fast"