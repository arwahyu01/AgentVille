from dataclasses import dataclass, field
from typing import Callable, Literal, Protocol, runtime_checkable

MODE = Literal["text", "coding"]


@dataclass(frozen=True)
class Persona:
    key: str
    name: str
    role: str
    instructions: str
    model: str | None = None
    mode: MODE = "text"
    workspace: str | None = None


@dataclass
class ProviderResult:
    ok: bool
    text: str = ""
    error: str | None = None
    latency_s: float = 0.0
    raw: dict | None = field(default=None, repr=False)
    provider: str = ""
    model: str = ""
    recoverable: bool = False


RECOVERABLE_PATTERNS = (
    "free usage limit", "rate limit", "429", "quota", "overloaded",
    "502", "503", "504", "timeout", "timed out", "not found",
)


def is_recoverable(error: str | None) -> bool:
    lowered = (error or "").lower()
    return any(pattern in lowered for pattern in RECOVERABLE_PATTERNS)


CancelCheck = Callable[[], bool]


@runtime_checkable
class AIProvider(Protocol):
    name: str

    def run(self, persona: Persona, prompt: str, timeout_s: int = 300,
            should_cancel: CancelCheck | None = None) -> ProviderResult:
        ...
