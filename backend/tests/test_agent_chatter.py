from app import chatter, settings_store
from app.ai.base import ProviderResult
from app.models import Agent, Task, TaskEvent


class FakeProvider:
    name = "fake"

    def __init__(self, text: str = "Saya ambil alih langkah ini, tenang."):
        self.text = text
        self.calls = 0

    def run(self, persona, prompt, timeout_s=300, should_cancel=None):
        self.calls += 1
        assert "Fakta yang harus disampaikan" in prompt
        return ProviderResult(ok=True, text=self.text, provider="fake", model="fake-1")


class ExplodingProvider:
    name = "boom"

    def run(self, *a, **kw):
        raise AssertionError("the model must not be called in static mode")


def _seed(session_factory, event_type="needs_help", mode="milestone"):
    with session_factory() as db:
        settings_store.set_setting(db, "ai_enabled", "1")
        settings_store.set_setting(db, "agent_chat_mode", mode)
        speaker = db.query(Agent).filter(Agent.role == "Developer").first()
        leader = db.query(Agent).filter(Agent.role == "AI Coordinator").first()
        task = Task(title="Bangun landing page", description="", status="running",
                    priority="normal", agent_id=speaker.id, run_mode="ai_plan")
        db.add(task)
        db.flush()
        event = TaskEvent(task_id=task.id, event_type=event_type,
                          message="Lapor, langkah 1 macet: tes gagal.",
                          agent_id=speaker.id, actor_agent_id=speaker.id,
                          recipient_agent_id=leader.id)
        db.add(event)
        db.commit()
        return chatter.Line(
            event_id=event.id, speaker=speaker.name, role=speaker.role,
            recipient=leader.name, event_type=event_type,
            static_message=event.message, task_title=task.title,
        )


def test_should_narrate_respects_mode():
    assert not chatter.should_narrate("static", "needs_help")
    assert chatter.should_narrate("milestone", "needs_help")
    assert chatter.should_narrate("milestone", "handoff_accepted")
    assert not chatter.should_narrate("milestone", "agent_chat")
    assert chatter.should_narrate("full", "agent_chat")
    assert not chatter.should_narrate("full", "status_changed")


def test_narrate_rewrites_a_milestone_line(session_factory):
    ctx = _seed(session_factory)
    provider = FakeProvider()
    text = chatter.narrate(ctx, session_factory=session_factory, provider=provider)
    assert text == provider.text
    assert provider.calls == 1
    with session_factory() as db:
        event = db.get(TaskEvent, ctx.event_id)
        assert event.message == provider.text
        assert event.provider == "fake"


def test_narrate_leaves_templates_alone_in_static_mode(session_factory):
    ctx = _seed(session_factory, mode="static")
    assert chatter.narrate(ctx, session_factory=session_factory, provider=ExplodingProvider()) is None
    with session_factory() as db:
        assert db.get(TaskEvent, ctx.event_id).message.startswith("Lapor, langkah 1 macet")


def test_narrate_skips_routine_chat_in_milestone_mode(session_factory):
    ctx = _seed(session_factory, event_type="agent_chat")
    assert chatter.narrate(ctx, session_factory=session_factory, provider=ExplodingProvider()) is None


def test_narrate_keeps_template_when_model_fails(session_factory):
    ctx = _seed(session_factory)

    class Failing:
        name = "failing"

        def run(self, *a, **kw):
            return ProviderResult(ok=False, error="rate limit")

    assert chatter.narrate(ctx, session_factory=session_factory, provider=Failing()) is None
    with session_factory() as db:
        assert db.get(TaskEvent, ctx.event_id).message.startswith("Lapor, langkah 1 macet")
