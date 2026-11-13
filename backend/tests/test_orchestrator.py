import json

import pytest

import app.task_service as task_service
from app.ai.base import ProviderResult
from app.database import SessionLocal
from app.models import Settings, Task
from app.orchestrator import Orchestrator
from app.settings_store import set_setting


class FakeProvider:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[tuple[str, str]] = []

    def run(self, persona, prompt, timeout_s=300, should_cancel=None):
        self.calls.append((persona.key, prompt))
        response = self.responses.pop(0) if self.responses else ProviderResult(ok=False, error="exhausted")
        if callable(response):
            response = response(len(self.calls), self.calls[-1][1])
        return response


@pytest.fixture
def orch_db(monkeypatch, tmp_path, session_factory):
    monkeypatch.setattr("app.orchestrator.SessionLocal", session_factory)
    monkeypatch.setattr(task_service, "ARTIFACTS_DIR", tmp_path)
    with session_factory() as db:
        set_setting(db, "ai_enabled", "1")
        set_setting(db, "ai_model", "fake/model")
        db.commit()
    return session_factory


def make_task(session_factory, **kwargs):
    kwargs.setdefault("title", "Work item")
    kwargs.setdefault("description", "Do the thing")
    kwargs.setdefault("status", "queued")
    kwargs.setdefault("run_mode", "ai")
    with session_factory() as db:
        task = Task(**kwargs)
        db.add(task)
        db.commit()
        return task.id


def get_task(session_factory, task_id):
    with session_factory() as db:
        return db.get(Task, task_id)


def events_for(session_factory, task_id):
    from app.models import TaskEvent
    with session_factory() as db:
        return [e.event_type for e in db.query(TaskEvent).filter(TaskEvent.task_id == task_id).all()]


def tick(session_factory):
    orch = Orchestrator(provider=tick.provider)
    orch.RETRY_BACKOFF_S = 0
    orch.recover_interrupted()
    orch._tick()
    return orch


def test_direct_run_completes_and_stores_result(orch_db):
    tick.provider = FakeProvider([ProviderResult(ok=True, text="Final answer")])
    task_id = make_task(orch_db)
    tick(orch_db)
    task = get_task(orch_db, task_id)
    assert task.status == "completed"
    assert task.result == "Final answer"
    assert task.artifact_path.endswith(f"task-{task_id}.md")
    assert (task_service.ARTIFACTS_DIR / f"task-{task_id}.md").read_text(encoding="utf-8").startswith("# Work item")
    assert "step_completed" in events_for(orch_db, task_id)


def test_direct_run_fails_after_retry_with_error_message(orch_db):
    tick.provider = FakeProvider([
        ProviderResult(ok=False, error="Free usage limit reached"),
        ProviderResult(ok=False, error="Free usage limit reached"),
    ])
    task_id = make_task(orch_db)
    tick(orch_db)
    assert get_task(orch_db, task_id).status == "failed"
    assert "run_failed" in events_for(orch_db, task_id)
    assert len(tick.provider.calls) == 2


def test_direct_run_recovers_on_retry(orch_db):
    tick.provider = FakeProvider([
        ProviderResult(ok=False, error="transient"),
        ProviderResult(ok=True, text="Recovered"),
    ])
    task_id = make_task(orch_db)
    tick(orch_db)
    assert get_task(orch_db, task_id).status == "completed"
    assert get_task(orch_db, task_id).result == "Recovered"


def test_cancelled_task_is_not_overwritten(orch_db):
    # provider flips the task to "cancelled" while the run is in flight (simulates user cancel)
    class CancelDuring(FakeProvider):
        def __init__(self, session_factory, task_id):
            super().__init__([ProviderResult(ok=True, text="ignored")])
            self.session_factory = session_factory
            self.task_id = task_id
        def run(self, persona, prompt, timeout_s=300, should_cancel=None):
            with self.session_factory() as db:
                task = db.get(Task, self.task_id)
                task.status = "cancelled"
                db.commit()
            return super().run(persona, prompt, timeout_s, should_cancel)

    task_id = make_task(orch_db)
    tick.provider = CancelDuring(orch_db, task_id)
    tick(orch_db)
    assert get_task(orch_db, task_id).status == "cancelled"
    assert get_task(orch_db, task_id).result == ""


def test_tick_skips_when_disabled_or_manual(orch_db):
    with orch_db() as db:
        db.query(Settings).filter(Settings.key == "ai_enabled").update({"value": "0"})
        db.commit()
    tick.provider = FakeProvider([ProviderResult(ok=True, text="x")])
    task_id = make_task(orch_db)
    tick(orch_db)
    assert get_task(orch_db, task_id).status == "queued"  # untouched

    with orch_db() as db:
        db.query(Settings).filter(Settings.key == "ai_enabled").update({"value": "1"})
        db.commit()
    manual_id = make_task(orch_db, run_mode="manual")
    tick(orch_db)
    assert get_task(orch_db, manual_id).status == "queued"


def test_restart_recovery_marks_running_as_interrupted(orch_db):
    task_id = make_task(orch_db, status="running")
    orch = Orchestrator(provider=FakeProvider([]))
    orch.recover_interrupted()
    assert get_task(orch_db, task_id).status == "failed"
    assert "interrupted" in events_for(orch_db, task_id)


def test_plan_mode_creates_children_and_completes(orch_db):
    plan = {"steps": [
        {"title": "Collect data", "instruction": "gather numbers", "agent_role": "Data Analyst", "depends_on": []},
        {"title": "Write report", "instruction": "write report", "agent_role": "Administrator", "depends_on": [0]},
    ]}
    reviewer = {"approved": True, "notes": "complete"}
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text=json.dumps(plan)),
        ProviderResult(ok=True, text="Numbers: 42 rows"),
        ProviderResult(ok=True, text="Report drafted"),
        ProviderResult(ok=True, text=json.dumps(reviewer)),
    ])
    task_id = make_task(orch_db, run_mode="ai_plan")
    tick(orch_db)

    parent = get_task(orch_db, task_id)
    assert parent.status == "completed"
    assert "Numbers: 42 rows" in parent.result and "Report drafted" in parent.result
    assert "plan_created" in events_for(orch_db, task_id)
    assert "reviewed" in events_for(orch_db, task_id)

    with orch_db() as db:
        children = db.query(Task).filter(Task.parent_id == task_id).order_by(Task.id).all()
        assert [c.status for c in children] == ["completed", "completed"]
        assert children[0].title == "Collect data"
    # step 2 received the result of step 1
    assert "[Result of step 0: Numbers: 42 rows]" in tick.provider.calls[2][1]


def test_plan_mode_dependency_roles_map_to_agents(orch_db):
    plan = {"steps": [{"title": "Code it", "instruction": "code", "agent_role": "Developer", "depends_on": []}]}
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text=json.dumps(plan)),
        ProviderResult(ok=True, text="code written"),
        ProviderResult(ok=True, text=json.dumps({"approved": True, "notes": "ok"})),
    ])
    task_id = make_task(orch_db, run_mode="ai_plan")
    tick(orch_db)
    with orch_db() as db:
        child = db.query(Task).filter(Task.parent_id == task_id).first()
        from app.models import Agent
        agent = db.get(Agent, child.agent_id)
        assert agent.role == "Developer"


def test_plan_rejected_by_reviewer_fails_parent(orch_db):
    plan = {"steps": [{"title": "a", "instruction": "a", "agent_role": "Developer", "depends_on": []}]}
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text=json.dumps(plan)),
        ProviderResult(ok=True, text="work"),
        ProviderResult(ok=True, text=json.dumps({"approved": False, "notes": "missing tests"})),
    ])
    task_id = make_task(orch_db, run_mode="ai_plan")
    tick(orch_db)
    assert get_task(orch_db, task_id).status == "failed"
    assert "reviewed" in events_for(orch_db, task_id)


def test_planner_provider_error_fails_parent_without_children(orch_db):
    tick.provider = FakeProvider([
        ProviderResult(ok=False, error="Free usage limit reached"),
        ProviderResult(ok=False, error="Free usage limit reached"),
    ])
    task_id = make_task(orch_db, run_mode="ai_plan")
    tick(orch_db)
    assert get_task(orch_db, task_id).status == "failed"
    with orch_db() as db:
        from sqlalchemy import func
        count = db.query(func.count(Task.id)).filter(Task.parent_id == task_id).scalar()
    assert count == 0


def test_unparsable_plan_falls_back_to_direct(orch_db):
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text="I could not plan today"),
        ProviderResult(ok=True, text="direct answer"),
    ])
    task_id = make_task(orch_db, run_mode="ai_plan")
    tick(orch_db)
    parent = get_task(orch_db, task_id)
    assert parent.status == "completed"
    assert parent.result == "direct answer"
    assert "plan_fallback" in events_for(orch_db, task_id)


def test_step_failure_aborts_plan(orch_db):
    plan = {"steps": [
        {"title": "a", "instruction": "a", "agent_role": "Developer", "depends_on": []},
        {"title": "b", "instruction": "b", "agent_role": "Developer", "depends_on": [0]},
    ]}
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text=json.dumps(plan)),
        ProviderResult(ok=True, text="step a done"),
        ProviderResult(ok=False, error="boom"),
        ProviderResult(ok=False, error="boom"),
    ])
    task_id = make_task(orch_db, run_mode="ai_plan")
    tick(orch_db)
    assert get_task(orch_db, task_id).status == "failed"
    with orch_db() as db:
        children = db.query(Task).filter(Task.parent_id == task_id).order_by(Task.id).all()
        assert [c.status for c in children] == ["completed", "failed"]
