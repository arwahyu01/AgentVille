"""Channel adapter contract: every inbound surface (web, telegram) is normalised into a
ChannelEvent and fed through the same conversation pipeline."""

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class ChannelEvent:
    channel: str          # "telegram" (web posts go through the REST API directly)
    external_id: str      # dedupe key, e.g. the telegram update_id
    identity: str         # stable per-user id within the channel, e.g. "telegram:123456"
    text: str


class ChannelAdapter(Protocol):
    def poll_once(self) -> None: ...
    def stop(self) -> None: ...
