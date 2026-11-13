"""SSE journal stream tests.

The current starlette TestClient / httpx ASGITransport buffer responses that never
finish, so an infinite SSE generator cannot be driven through them. These tests call the
ASGI app directly with a minimal receive/send harness, which exercises the real
generator output (frames + headers) without the transport limitation."""

import asyncio
import contextlib
import json

from fastapi.testclient import TestClient

from app.main import app


async def _collect_stream_frames(path: str, query: bytes, headers: list[tuple[bytes, bytes]],
                                 stop_after: int = 1, timeout_s: float = 10.0):
    """Run the ASGI app for one streaming request and stop once `stop_after` body
    frames have been sent. Returns (start_headers, frames)."""
    start = {}
    frames: list[str] = []
    done = asyncio.Event()

    async def receive():
        await asyncio.Event().wait()  # never disconnect

    async def send(message):
        if message["type"] == "http.response.start":
            start["headers"] = {k.decode().lower(): v.decode()
                                for k, v in message.get("headers", [])}
            start["status"] = message["status"]
        elif message["type"] == "http.response.body":
            body = message.get("body", b"").decode()
            if body.strip():
                frames.append(body)
                if len(frames) >= stop_after:
                    done.set()

    scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
             "method": "GET", "scheme": "http", "path": path, "raw_path": path.encode(),
             "query_string": query, "root_path": "", "headers": headers,
             "client": ("test", 1), "server": ("test", 80)}
    task = asyncio.create_task(app(scope, receive, send))
    try:
        await asyncio.wait_for(done.wait(), timeout_s)
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    return start, frames


def _data_frames(frames: list[str]) -> list[dict]:
    events = []
    for chunk in frames:
        for line in chunk.splitlines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


def test_sse_stream_replays_journal(session_factory, monkeypatch):
    monkeypatch.setattr("app.events.SessionLocal", session_factory)
    client = TestClient(app)
    task = client.post("/api/tasks",
                       json={"title": "Stream me", "description": "", "priority": "normal",
                             "agent_id": None}).json()
    start, frames = asyncio.run(
        _collect_stream_frames("/api/events/stream", b"since=0", []))
    assert start["status"] == 200
    assert start["headers"]["content-type"].startswith("text/event-stream")
    events = _data_frames(frames)
    assert events[0]["taskId"] == task["id"]
    assert events[0]["type"] == "created"
    assert "createdAt" in events[0]


def test_sse_stream_uses_last_event_id_header(session_factory, monkeypatch):
    monkeypatch.setattr("app.events.SessionLocal", session_factory)
    client = TestClient(app)
    task = client.post("/api/tasks",
                       json={"title": "Resume", "description": "", "priority": "normal",
                             "agent_id": None}).json()
    start, frames = asyncio.run(_collect_stream_frames("/api/events/stream", b"",
                                                       [(b"last-event-id", b"0")]))
    events = _data_frames(frames)
    assert events[0]["taskId"] == task["id"]
