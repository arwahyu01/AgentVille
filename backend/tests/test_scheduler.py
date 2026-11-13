"""Phase A tests: DAG parallelism, dependency gating, atomic lease, configurable
budget limits, and concurrent coding worktree merge."""

import json
import re
import threading
import time

import pytest

import app.task_service as task_service
from app import conversation_service
from app.ai.base import ProviderResult
from app.models import Agent, Task
from app.orchestrator import Orchestrator
from app.plan_schema import PlanStep, TaskPlan
from app.settings_store import set_setting
from app.tools import repo


CRITERION_LINE = re.compile(r"^(C\d+)\.\s+(.+)$", re.MULTILINE)
INVENTORY_REF = re.compile(
    r"^(workspace:[^\s|]+|artifact:[^\s|]+|missing:[^\s|]+)\s+\|", re.MULTILINE)


def qc_reply(verdict, prompt):
    """Build a contract-valid verdict from the criteria and refs the orchestrator supplied."""
    criteria = [(cid, text.strip()) for cid, text in CRITERION_LINE.findall(prompt)]
    refs = INVENTORY_REF.findall(prompt)
    met = verdict == "pass"
    return json.dumps({
        "verdict": verdict,
        "criteria": [{"id": cid, "criterion": text, "met": met,
                      "detail": "checked in the evidence packet"}
                     for cid, text in criteria],
        "findings": "all criteria met" if met else "bad",
        "evidence": "Checked " + ", ".join(refs[:2]) + " against the criteria",
        "artifacts_checked": refs[:2],
        "failed_steps": [] if met else [0],
    })


class FakeProvider:
    """Thread-safe, role-keyed fake. Text steps record a (start,end) interval so the test
    can prove independent nodes overlapped and a dependent node waited for its inputs."""

    def __init__(self, qc="pass"):
        self._lock = threading.Lock()
        self.intervals: dict[str, tuple[float, float]] = {}
        self.qc = qc

    def run(self, persona, prompt, timeout_s=300, should_cancel=None):
        role = persona.role
        if role == "Reviewer" or persona.key == "qc-reviewer":
            return ProviderResult(ok=True, text=qc_reply(self.qc, prompt))
        start = time.monotonic()
        time.sleep(0.3)
        end = time.monotonic()
        with self._lock:
            self.intervals[role] = (start, end)
        return ProviderResult(ok=True, text=f"[{role} result]")


@pytest.fixture
def conv_db(monkeypatch, tmp_path, session_factory):
    monkeypatch.setattr("app.orchestrator.SessionLocal", session_factory)
    monkeypatch.setattr(task_service, "ARTIFACTS_DIR", tmp_path)
    with session_factory() as db:
        set_setting(db, "ai_enabled", "1")
        set_setting(db, "ai_model", "fake/model")
        set_setting(db, "workspace_root", str(tmp_path / "ws"))
        db.commit()
    session_factory.artifacts = tmp_path
    return session_factory


def tick(session_factory, provider):
    orch = Orchestrator(provider=provider)
    orch.RETRY_BACKOFF_S = 0
    orch.recover_interrupted()
    orch._tick()
    return orch


def test_independent_nodes_run_in_parallel_dependent_waits(conv_db):
    plan = {"steps": [
        {"title": "Research", "instruction": "dig", "agent_role": "Researcher", "depends_on": [], "acceptance_criteria": ["notes"]},
        {"title": "Analyse", "instruction": "analyse", "agent_role": "Data Analyst", "depends_on": [], "acceptance_criteria": ["findings"]},
        {"title": "Report", "instruction": "write", "agent_role": "Administrator", "depends_on": [0, 1], "acceptance_criteria": ["report"]},
    ], "acceptance_criteria": ["done"]}
    with conv_db() as db:
        conv = conversation_service.create_conversation(db, "need a report")
        row = conversation_service.propose_plan(db, conv.id, TaskPlan.model_validate(plan), summary="s")
        conversation_service.approve_plan(db, conv.id, row.version)
        anchor_id = conv.anchor_task_id

    provider = FakeProvider(qc="pass")
    tick(conv_db, provider)

    with conv_db() as db:
        anchor = db.get(Task, anchor_id)
        assert anchor.status == "completed"

    # The two independent steps overlapped in time.
    r0 = provider.intervals["Researcher"]
    r1 = provider.intervals["Data Analyst"]
    assert r0[0] < r1[1] and r1[0] < r0[1], "independent nodes did not run concurrently"
    # The dependent step started only after both finished.
    dep = provider.intervals["Administrator"]
    assert dep[0] >= max(r0[1], r1[1]), "dependent node started before its inputs were ready"


def test_lease_prevents_double_claim(session_factory):
    with session_factory() as db:
        task = Task(title="t", description="d", status="queued", run_mode="ai")
        db.add(task)
        db.commit()
        tid = task.id
    with session_factory() as db:
        assert task_service.claim_task(db, tid, "worker-a", 60) is True
    with session_factory() as db:
        # A different owner cannot take a node that is actively leased (not expired).
        assert task_service.claim_task(db, tid, "worker-b", 60) is False
    with session_factory() as db:
        task_service.release_lease(db, tid, "worker-a")
    with session_factory() as db:
        assert task_service.claim_task(db, tid, "worker-b", 60) is True


def test_expiring_lease_allows_reclaim(session_factory):
    with session_factory() as db:
        task = Task(title="t", description="d", status="running", run_mode="ai", lease_owner="dead-worker")
        task.lease_expires_at = None
        db.add(task)
        db.commit()
        tid = task.id
    with session_factory() as db:
        # No active expiry -> a new worker may take it over (crash recovery).
        assert task_service.claim_task(db, tid, "worker-b", 60) is True


def test_plan_over_step_budget_raises():
    plan = TaskPlan(steps=[PlanStep(title=f"s{i}", instruction="x", agent_role="Developer", depends_on=[]) for i in range(10)])
    with pytest.raises(ValueError, match="max_plan_steps"):
        plan.validate_for_budget(max_steps=6, max_depth=20)
    # not silently trimmed — the plan object is untouched
    assert len(plan.steps) == 10


def test_plan_over_depth_budget_raises():
    steps = []
    for i in range(5):
        steps.append(PlanStep(title=f"s{i}", instruction="x", agent_role="Developer",
                              depends_on=[i - 1] if i else []))
    plan = TaskPlan(steps=steps)
    assert plan.dependency_depth() == 5
    with pytest.raises(ValueError, match="max_delegation_depth"):
        plan.validate_for_budget(max_steps=50, max_depth=3)


def test_dependent_coding_merges_both_files(conv_db):
    """Two independent coding steps each write a distinct file in an isolated worktree; both
    must survive the merge back into the shared base workspace (no lost work)."""
    if not repo.git_available():
        pytest.skip("git not available")
    plan = {"steps": [
        {"title": "A", "instruction": "write a.txt", "agent_role": "Developer", "depends_on": [],
         "acceptance_criteria": ["a exists"], "uses_tools": True},
        {"title": "B", "instruction": "write b.txt", "agent_role": "Frontend Developer", "depends_on": [],
         "acceptance_criteria": ["b exists"], "uses_tools": True},
    ], "acceptance_criteria": ["both"]}

    class WriteFiles(FakeProvider):
        def run(self, persona, prompt, timeout_s=300, should_cancel=None):
            if persona.role == "Reviewer" or persona.key == "qc-reviewer":
                return ProviderResult(ok=True, text=qc_reply("pass", prompt))
            from pathlib import Path
            ws = Path(persona.workspace)
            name = "a.txt" if persona.role == "Developer" else "b.txt"
            (ws / name).write_text(f"content of {name}\n", encoding="utf-8")
            return ProviderResult(ok=True, text=f"wrote {name}")

    with conv_db() as db:
        conv = conversation_service.create_conversation(db, "two files")
        row = conversation_service.propose_plan(db, conv.id, TaskPlan.model_validate(plan), summary="s")
        conversation_service.approve_plan(db, conv.id, row.version)
        anchor_id = conv.anchor_task_id

    tick(conv_db, WriteFiles(qc="pass"))
    with conv_db() as db:
        assert db.get(Task, anchor_id).status == "completed"
        base = (conv_db.artifacts / "ws" / f"project-{anchor_id}")
        assert (base / "a.txt").exists() and (base / "b.txt").exists()


def test_coding_conflict_surfaces_and_fails(conv_db):
    """Two coding steps writing the SAME file with different content must not silently lose
    one change: the merge conflict fails the plan with a recorded conflict event."""
    if not repo.git_available():
        pytest.skip("git not available")
    plan = {"steps": [
        {"title": "A", "instruction": "write shared.txt", "agent_role": "Developer", "depends_on": [],
         "acceptance_criteria": ["a"], "uses_tools": True},
        {"title": "B", "instruction": "write shared.txt", "agent_role": "Frontend Developer", "depends_on": [],
         "acceptance_criteria": ["b"], "uses_tools": True},
    ], "acceptance_criteria": ["one file"]}

    class ConflictFiles(FakeProvider):
        def run(self, persona, prompt, timeout_s=300, should_cancel=None):
            if persona.role == "Reviewer" or persona.key == "qc-reviewer":
                return ProviderResult(ok=True, text=qc_reply("pass", prompt))
            from pathlib import Path
            ws = Path(persona.workspace)
            (ws / "shared.txt").write_text(f"written by {persona.role}\n", encoding="utf-8")
            return ProviderResult(ok=True, text=f"wrote shared as {persona.role}")

    with conv_db() as db:
        conv = conversation_service.create_conversation(db, "conflicting edits")
        row = conversation_service.propose_plan(db, conv.id, TaskPlan.model_validate(plan), summary="s")
        conversation_service.approve_plan(db, conv.id, row.version)
        anchor_id = conv.anchor_task_id

    tick(conv_db, ConflictFiles(qc="pass"))
    with conv_db() as db:
        assert db.get(Task, anchor_id).status == "failed"
        from app.models import TaskEvent
        kinds = [e.event_type for e in db.query(TaskEvent).all()]
    assert "merge_conflict" in kinds


def test_handoff_emits_travel_and_meeting_events_with_locations(conv_db):
    """A dependency edge must produce real workflow events carrying actor/recipient and rooms,
    and the office must be able to reconstruct where each specialist is going."""
    with conv_db() as db:
        admin = Agent(name="Quill", role="Administrator", status="idle", position_x=0, position_z=0)
        db.add(admin)
        db.commit()
        dev_id = db.query(Agent).filter(Agent.role == "Developer").first().id
    plan = {"steps": [
        {"title": "Build", "instruction": "implement", "agent_role": "Developer", "depends_on": [], "acceptance_criteria": ["code"]},
        {"title": "Document", "instruction": "write doc", "agent_role": "Administrator", "depends_on": [0], "acceptance_criteria": ["doc"]},
    ], "acceptance_criteria": ["done"]}
    with conv_db() as db:
        conv = conversation_service.create_conversation(db, "build and document")
        row = conversation_service.propose_plan(db, conv.id, TaskPlan.model_validate(plan), summary="s")
        conversation_service.approve_plan(db, conv.id, row.version)
        anchor_id = conv.anchor_task_id
        # bind the Administrator step to the seeded agent
        step_task = db.query(Task).filter(Task.parent_id == anchor_id, Task.plan_step_index == 1).first()
        if step_task and step_task.agent_id is None:
            step_task.agent_id = admin.id
            db.commit()

    tick(conv_db, FakeProvider(qc="pass"))

    with conv_db() as db:
        from app.models import TaskEvent
        events = db.query(TaskEvent).order_by(TaskEvent.id).all()
        by_type = {}
        for e in events:
            by_type.setdefault(e.event_type, []).append(e)
        assert "task_assigned" in by_type
        assert "handoff_requested" in by_type
        assert "handoff_accepted" in by_type
        assert "travel_started" in by_type and "travel_arrived" in by_type
        assert "meeting_started" in by_type and "meeting_ended" in by_type
        travel = by_type["travel_started"][0]
        assert travel.from_room == "dev" and travel.to_room == "admin"
        assert travel.actor_agent_id == dev_id
        handoff = by_type["handoff_requested"][0]
        assert handoff.actor_agent_id == dev_id and handoff.recipient_agent_id == admin.id
        assert db.get(Agent, dev_id).current_room == "dev"  # returned home after handoff
