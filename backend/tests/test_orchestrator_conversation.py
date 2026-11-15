import json
import re

import pytest

import app.task_service as task_service
from app import conversation_service
from app.ai.base import ProviderResult
from app.models import Conversation, Message, Plan, QcReview, Task
from app.orchestrator import Orchestrator
from app.settings_store import set_setting


class FakeProvider:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls: list[tuple] = []  # (persona, prompt)

    def run(self, persona, prompt, timeout_s=300, should_cancel=None):
        self.calls.append((persona, prompt))
        response = self.responses.pop(0) if self.responses else ProviderResult(ok=False, error="exhausted")
        if callable(response):
            response = response(len(self.calls), self.calls[-1][1])
        return response


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


def tick(session_factory):
    orch = Orchestrator(provider=tick.provider)
    orch.RETRY_BACKOFF_S = 0
    orch.recover_interrupted()
    orch._tick()
    return orch


def start_conversation(session_factory, text="I need a short report about our numbers"):
    with session_factory() as db:
        conv = conversation_service.create_conversation(db, text)
        return conv.id, conv.anchor_task_id


def ask_json(question="Which numbers — revenue or headcount?"):
    return ProviderResult(ok=True, text=json.dumps({"action": "ask", "question": question}))


def propose_json(step0_criteria="notes captured"):
    payload = {"action": "propose", "summary": "two-step report", "plan": {
        "steps": [
            {"title": "Investigate", "instruction": "dig into the numbers", "agent_role": "Researcher",
             "depends_on": [], "acceptance_criteria": [step0_criteria]},
            {"title": "Summarise", "instruction": "write the summary", "agent_role": "Administrator",
             "depends_on": [0], "acceptance_criteria": ["one paragraph"]},
        ],
        "acceptance_criteria": ["summary delivered"],
    }}
    return ProviderResult(ok=True, text=json.dumps(payload))


CRITERION_LINE = re.compile(r"^(C\d+)\.\s+(.+)$", re.MULTILINE)
INVENTORY_REF = re.compile(
    r"^(workspace:[^\s|]+|artifact:[^\s|]+|missing:[^\s|]+)\s+\|", re.MULTILINE)


def prompt_criteria(prompt):
    return [(cid, text.strip()) for cid, text in CRITERION_LINE.findall(prompt)]


def prompt_refs(prompt):
    return INVENTORY_REF.findall(prompt)


def qc_pass(*, findings="all acceptance criteria are met", evidence=None, failed_steps=None):
    """A contract-valid pass that cites only refs actually present in the evidence packet."""
    def build(_call_no, prompt):
        criteria = prompt_criteria(prompt)
        refs = prompt_refs(prompt)
        payload = {
            "verdict": "pass",
            "criteria": [{"id": cid, "criterion": text, "met": True,
                          "detail": "verified in the evidence packet"}
                         for cid, text in criteria],
            "findings": findings,
            "evidence": evidence or ("Checked " + ", ".join(refs[:2]) + " against the criteria"),
            "artifacts_checked": refs[:2],
            "failed_steps": failed_steps or [],
        }
        return ProviderResult(ok=True, text=json.dumps(payload))
    return build


def qc_fail(*, findings="summary lacks the numbers", evidence=None, failed_steps=(1,), met=()):
    """A contract-valid fail: concrete findings, cited refs, and responsible step indexes."""
    def build(_call_no, prompt):
        criteria = prompt_criteria(prompt)
        refs = prompt_refs(prompt)
        payload = {
            "verdict": "fail",
            "criteria": [{"id": cid, "criterion": text, "met": cid in met,
                          "detail": "not met by the delivered work"}
                         for cid, text in criteria],
            "findings": findings,
            "evidence": evidence or ("Inspected " + ", ".join(refs[:2])
                                     + "; the required evidence is absent"),
            "artifacts_checked": refs[:2],
            "failed_steps": list(failed_steps),
        }
        return ProviderResult(ok=True, text=json.dumps(payload))
    return build


QC_PASS = qc_pass()
QC_FAIL = qc_fail()


def state(session_factory, task_id):
    with session_factory() as db:
        return db.get(Task, task_id).status


def events_for(session_factory, task_id):
    from app.models import TaskEvent
    with session_factory() as db:
        return [e.event_type for e in db.query(TaskEvent).filter(TaskEvent.task_id == task_id).all()]


def messages_for(session_factory, conv_id):
    with session_factory() as db:
        return db.query(Message).filter(Message.conversation_id == conv_id).order_by(Message.id).all()


def drive_to_approval(session_factory):
    """Runs the clarify→propose turn. The leader signs the plan off immediately, so the
    request is already 'approved' with its step tasks materialised — ready to execute."""
    conv_id, anchor_id = start_conversation(session_factory)
    tick.provider = FakeProvider([propose_json()])
    tick(session_factory)
    assert state(session_factory, anchor_id) == "approved"
    return conv_id, anchor_id


# -- conversation turns --------------------------------------------------------


def test_ask_turn_stores_question_and_waits_for_reply(conv_db):
    conv_id, anchor_id = start_conversation(conv_db)
    tick.provider = FakeProvider([ask_json()])
    tick(conv_db)
    assert len(tick.provider.calls) == 1
    assert state(conv_db, anchor_id) == "clarifying"
    msgs = messages_for(conv_db, conv_id)
    assert msgs[-1].role == "assistant" and "revenue" in msgs[-1].content
    assert "coordinator_question" in events_for(conv_db, anchor_id)
    # second tick must not re-call the provider: only the newest user message triggers a turn
    tick.provider = FakeProvider([])
    tick(conv_db)
    assert len(tick.provider.calls) == 0


def test_propose_turn_creates_plan_and_starts_work(conv_db):
    conv_id, anchor_id = start_conversation(conv_db)
    tick.provider = FakeProvider([propose_json()])
    tick(conv_db)
    # No manual gate: the leader approves, the plan is approved and its steps are real tasks.
    assert state(conv_db, anchor_id) == "approved"
    with conv_db() as db:
        row = db.query(Plan).filter(Plan.conversation_id == conv_id).one()
        assert row.version == 1 and row.status == "approved"
        children = db.query(Task).filter(Task.parent_id == anchor_id).order_by(Task.id).all()
        assert [c.title for c in children] == ["Investigate", "Summarise"]
        assert all(c.status == "pending" for c in children)
        from app.models import Approval
        approval = db.query(Approval).filter(Approval.plan_id == row.id).one()
        assert approval.decided_by == "office-leader"
    assert "plan_proposed" in events_for(conv_db, anchor_id)
    assert "plan_approved" in events_for(conv_db, anchor_id)
    # the leader briefed the crew: one instruction per step, addressed to its owner
    assert "agent_chat" in events_for(conv_db, anchor_id)


def test_proposal_message_carries_full_plan_details(conv_db):
    conv_id, anchor_id = start_conversation(conv_db)
    tick.provider = FakeProvider([propose_json()])
    tick(conv_db)
    content = messages_for(conv_db, conv_id)[-1].content
    assert "Proposal v1" in content
    assert "two-step report" in content                      # scope
    assert "0. Investigate" in content and "Researcher" in content   # owner role
    assert "Depends on: nothing" in content                  # order/dependency
    assert "1. Summarise" in content and "Depends on: #0" in content
    assert "Accept: notes captured"                   # per-step criteria
    assert "Overall acceptance criteria:" in content and "summary delivered" in content
    assert "Work starts automatically" in content             # no manual gate, web channel


def test_telegram_proposal_is_queued_in_full_with_stable_order(conv_db):
    with conv_db() as db:
        conv = conversation_service.create_conversation(
            db, "big analysis please", channel="telegram", user_identity="telegram:42")
        conv_id = conv.id
    tick.provider = FakeProvider([propose_json()])
    tick(conv_db)
    from app.models import TelegramOutbox
    with conv_db() as db:
        rows = db.query(TelegramOutbox).order_by(TelegramOutbox.id).all()
    assert rows, "the proposal must reach the Telegram outbox"
    joined = "\n".join(r.text for r in rows)
    assert "Proposal v1" in joined
    assert "Depends on: #0" in joined
    assert "/revise <notes>" in joined                       # work starts, revision is the lever
    assert all(r.dedupe_key.startswith("assistant-") for r in rows)
    order = [int(r.dedupe_key.rsplit(":", 1)[1]) for r in rows]
    assert order == sorted(order)                            # chunks keep their sequence


def test_turn_provider_error_does_not_retry_until_new_user_message(conv_db):
    conv_id, anchor_id = start_conversation(conv_db)
    tick.provider = FakeProvider([ProviderResult(ok=False, error="Free usage limit reached")])
    tick(conv_db)
    assert len(tick.provider.calls) == 1
    assert state(conv_db, anchor_id) == "clarifying"
    msgs = messages_for(conv_db, conv_id)
    assert msgs[-1].role == "assistant" and "Coordinator error" in msgs[-1].content
    tick.provider = FakeProvider([])
    tick(conv_db)
    assert len(tick.provider.calls) == 0


# -- execution after approval ----------------------------------------------------


def test_approved_plan_materializes_children_and_completes(conv_db):
    conv_id, anchor_id = drive_to_approval(conv_db)
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text="Numbers: 42 rows"),
        ProviderResult(ok=True, text="One paragraph summary"),
        QC_PASS,
    ])
    tick(conv_db)
    task = None
    with conv_db() as db:
        task = db.get(Task, anchor_id)
        assert task.status == "completed"
        assert "Numbers: 42 rows" in task.result and "One paragraph summary" in task.result
        assert json.loads(task.plan_json)["steps"][0]["title"] == "Investigate"
        children = db.query(Task).filter(Task.parent_id == anchor_id).order_by(Task.id).all()
        assert [c.status for c in children] == ["completed", "completed"]
        assert [c.plan_step_index for c in children] == [0, 1]
        assert "notes captured" in children[0].acceptance_criteria
        assert children[0].provider_used == "opencode"
        assert children[0].model_used == "fake/model"
    # dependency context passed on
    assert "[Result of step 0: Numbers: 42 rows]" in tick.provider.calls[1][1]
    # step events carry journal metadata
    with conv_db() as db:
        from app.models import TaskEvent
        started = (db.query(TaskEvent)
                   .filter(TaskEvent.task_id == anchor_id, TaskEvent.event_type == "step_started").all())
        assert [e.step_index for e in started] == [0, 1]
        assert all(e.provider == "opencode" and e.conversation_id == conv_id for e in started)


def test_qc_fail_triggers_bounded_revision_then_pass(conv_db):
    with conv_db() as db:
        set_setting(db, "ai_retry_max", "1")
        db.commit()
    conv_id, anchor_id = drive_to_approval(conv_db)
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text="Numbers: 42 rows"),
        ProviderResult(ok=True, text="fluffy summary"),
        QC_FAIL,
        ProviderResult(ok=True, text="summary with 42 rows"),
        QC_PASS,
    ])
    tick(conv_db)
    assert state(conv_db, anchor_id) == "completed"
    with conv_db() as db:
        rows = db.query(QcReview).filter(QcReview.task_id == anchor_id).order_by(QcReview.iteration).all()
        assert [r.verdict for r in rows] == ["fail", "pass"]
        assert rows[0].findings == "summary lacks the numbers"
        child = (db.query(Task).filter(Task.parent_id == anchor_id, Task.plan_step_index == 1).first())
        assert "summary with 42 rows" in child.result
        from app.models import TaskEvent
        child_events = [e.event_type for e in
                        db.query(TaskEvent).filter(TaskEvent.task_id == child.id).all()]
    assert "step_revised" in child_events
    # findings reached the responsible step
    assert "Reviewer findings to address" in tick.provider.calls[3][1]


def test_qc_verdict_unparsable_fails_parent(conv_db):
    """Regression guard: an unreadable verdict must never count as approval."""
    conv_id, anchor_id = drive_to_approval(conv_db)
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text="a"),
        ProviderResult(ok=True, text="b"),
        ProviderResult(ok=True, text="I think it looks fine I guess"),
    ])
    tick(conv_db)
    assert state(conv_db, anchor_id) == "failed"
    with conv_db() as db:
        row = db.query(QcReview).filter(QcReview.task_id == anchor_id).one()
        assert row.verdict == "inconclusive"
        assert "I think it looks fine I guess" in row.evidence  # raw reply kept for debugging


def test_qc_fail_without_revision_budget_fails(conv_db):
    with conv_db() as db:
        set_setting(db, "ai_retry_max", "0")
        db.commit()
    conv_id, anchor_id = drive_to_approval(conv_db)
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text="a"),
        ProviderResult(ok=True, text="b"),
        QC_FAIL,
    ])
    tick(conv_db)
    assert state(conv_db, anchor_id) == "failed"
    assert len(tick.provider.calls) == 3


def test_step_failure_fails_child_and_anchor(conv_db):
    conv_id, anchor_id = drive_to_approval(conv_db)
    tick.provider = FakeProvider([ProviderResult(ok=False, error="boom"),
                                  ProviderResult(ok=False, error="boom")])
    tick(conv_db)
    with conv_db() as db:
        children = db.query(Task).filter(Task.parent_id == anchor_id).order_by(Task.id).all()
        assert children[0].status == "failed"
        assert db.get(Task, anchor_id).status == "failed"


# -- coding steps ---------------------------------------------------------------


def test_coding_step_runs_in_coding_persona_with_workspace(conv_db):
    conv_id, anchor_id = start_conversation(conv_db)
    payload = {"action": "propose", "summary": "code it", "plan": {"steps": [
        {"title": "Write script", "instruction": "create report.py", "agent_role": "Developer",
         "depends_on": [], "acceptance_criteria": ["file exists"], "uses_tools": True}]}}
    tick.provider = FakeProvider([ProviderResult(ok=True, text=json.dumps(payload))])
    tick(conv_db)
    with conv_db() as db:
        conversation_service.approve_plan(db, conv_id, 1)
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text="created report.py"),
        QC_PASS,
    ])
    tick(conv_db)
    assert state(conv_db, anchor_id) == "completed"
    persona = tick.provider.calls[0][0]
    assert persona.mode == "coding"
    ws_path = persona.workspace
    assert ws_path.endswith(f"project-{anchor_id}")
    from pathlib import Path
    assert (Path(ws_path) / ".git").exists()
    with conv_db() as db:
        child_id = db.query(Task).filter(Task.parent_id == anchor_id).first().id
    assert "diff_captured" in events_for(conv_db, child_id)
    # QC pass with a workspace stores the diff artifact
    assert (conv_db.artifacts / f"task-{anchor_id}.diff.txt").exists()


def test_step_records_which_provider_and_model_ran_it(conv_db, client):
    """Provenance must live on the Task row, not only in the journal — the result modal reads it."""
    conv_id, anchor_id = start_conversation(conv_db)
    payload = {"action": "propose", "summary": "code it", "plan": {"steps": [
        {"title": "Write script", "instruction": "create report.py", "agent_role": "Developer",
         "depends_on": [], "acceptance_criteria": ["file exists"], "uses_tools": True}]}}
    tick.provider = FakeProvider([ProviderResult(ok=True, text=json.dumps(payload))])
    tick(conv_db)
    with conv_db() as db:
        conversation_service.approve_plan(db, conv_id, 1)
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text="created report.py", provider="qoder", model="Efficient"),
        QC_PASS,
    ])
    tick(conv_db)
    assert state(conv_db, anchor_id) == "completed"
    with conv_db() as db:
        child = db.query(Task).filter(Task.parent_id == anchor_id).first()
        assert child.provider_used == "qoder"
        assert child.model_used == "Efficient"
    body = client.get(f"/api/tasks/{anchor_id}/result").json()
    assert body["children"][0]["provider_used"] == "qoder"
    assert body["children"][0]["model_used"] == "Efficient"


# -- result endpoint ------------------------------------------------------------


def test_result_endpoint_exposes_plan_steps_and_qc(conv_db, client):
    conv_id, anchor_id = drive_to_approval(conv_db)
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text="a"),
        ProviderResult(ok=True, text="b"),
        QC_PASS,
    ])
    tick(conv_db)
    body = client.get(f"/api/tasks/{anchor_id}/result").json()
    assert body["status"] == "completed"
    assert [s["title"] for s in body["plan_steps"]] == ["Investigate", "Summarise"]
    review = body["qc_reviews"][0]
    assert review["verdict"] == "pass"
    assert json.loads(review["artifacts_json"]), "the verdict must record the refs it cited"
    assert review["provider"] == "opencode"
    assert review["model"] == "fake/model"


# -- strict QC contract ---------------------------------------------------------


def fail_with_qc(session_factory, review):
    """Run the two steps and a QC reply, leaving the anchor failed."""
    with session_factory() as db:
        set_setting(db, "ai_retry_max", "0")
        db.commit()
    conv_id, anchor_id = drive_to_approval(session_factory)
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text="a"),
        ProviderResult(ok=True, text="b"),
        review,
    ])
    tick(session_factory)
    assert state(session_factory, anchor_id) == "failed"
    return conv_id, anchor_id


def test_qc_pass_citing_an_invented_artifact_is_rejected(conv_db):
    def invented(_call_no, prompt):
        criteria = prompt_criteria(prompt)
        return ProviderResult(ok=True, text=json.dumps({
            "verdict": "pass",
            "criteria": [{"id": cid, "criterion": text, "met": True, "detail": "ok"}
                         for cid, text in criteria],
            "findings": "looks fine",
            "evidence": "I checked backend/landing/index.html and it exists",
            "artifacts_checked": ["workspace:backend/landing/index.html"],
            "failed_steps": [],
        }))

    conv_id, anchor_id = fail_with_qc(conv_db, invented)
    with conv_db() as db:
        row = db.query(QcReview).filter(QcReview.task_id == anchor_id).one()
        assert row.verdict == "fail"
        assert "not in the evidence inventory" in row.findings


def test_qc_pass_missing_a_criterion_is_rejected(conv_db):
    def incomplete(_call_no, prompt):
        refs = prompt_refs(prompt)
        return ProviderResult(ok=True, text=json.dumps({
            "verdict": "pass",
            "criteria": [{"id": "C1", "criterion": "summary delivered", "met": True,
                          "detail": "present"}],
            "findings": "looks fine",
            "evidence": "C1 is satisfied by the delivered summary",
            "artifacts_checked": refs[:1],
            "failed_steps": [],
        }))

    conv_id, anchor_id = fail_with_qc(conv_db, incomplete)
    with conv_db() as db:
        row = db.query(QcReview).filter(QcReview.task_id == anchor_id).one()
        assert row.verdict == "fail"
        assert "must report every acceptance criterion" in row.findings


def test_qc_transport_failure_is_inconclusive(conv_db):
    conv_id, anchor_id = fail_with_qc(
        conv_db, ProviderResult(ok=False, error="provider unavailable"))
    with conv_db() as db:
        row = db.query(QcReview).filter(QcReview.task_id == anchor_id).one()
        assert row.verdict == "inconclusive"
        assert "transport failure" in row.findings


# -- QC-only rerun --------------------------------------------------------------


def test_qc_rerun_endpoint_queues_qc_only_and_completes(conv_db, client):
    conv_id, anchor_id = fail_with_qc(conv_db, qc_fail())
    body = client.post(f"/api/tasks/{anchor_id}/qc-rerun").json()
    assert body["status"] == "queued"
    assert body["qc_rerun_requested"] is True

    tick.provider = FakeProvider([qc_pass()])
    tick(conv_db)
    assert state(conv_db, anchor_id) == "completed"
    # QC-only: one provider call, no step revision, no workspace edit.
    assert len(tick.provider.calls) == 1
    with conv_db() as db:
        rows = (db.query(QcReview).filter(QcReview.task_id == anchor_id)
                .order_by(QcReview.iteration).all())
        assert [r.verdict for r in rows] == ["fail", "pass"]
        assert rows[-1].provider == "opencode"
        assert rows[-1].model == "fake/model"
        assert json.loads(rows[-1].artifacts_json)
        assert db.get(Task, anchor_id).qc_rerun_requested is False


def test_qc_rerun_failure_does_not_revise_steps(conv_db, client):
    conv_id, anchor_id = fail_with_qc(conv_db, qc_fail())
    client.post(f"/api/tasks/{anchor_id}/qc-rerun")
    tick.provider = FakeProvider([qc_fail(findings="still missing the numbers")])
    tick(conv_db)
    assert state(conv_db, anchor_id) == "failed"
    assert len(tick.provider.calls) == 1, "a QC-only rerun must never call a step provider"
    with conv_db() as db:
        rows = (db.query(QcReview).filter(QcReview.task_id == anchor_id)
                .order_by(QcReview.iteration).all())
        assert [r.verdict for r in rows] == ["fail", "fail"]
        assert rows[-1].findings == "still missing the numbers"


def test_qc_rerun_requires_a_failed_task(conv_db, client):
    conv_id, anchor_id = drive_to_approval(conv_db)
    response = client.post(f"/api/tasks/{anchor_id}/qc-rerun")
    assert response.status_code == 409
    assert "only available for a failed task" in response.json()["detail"]


def test_qc_rerun_rejects_non_conversation_tasks(conv_db, client):
    with conv_db() as db:
        task = Task(title="plain", status="failed", run_mode="ai")
        db.add(task)
        db.commit()
        task_id = task.id
    response = client.post(f"/api/tasks/{task_id}/qc-rerun")
    assert response.status_code == 422
    assert "conversation tasks" in response.json()["detail"]


def test_provider_is_resolved_from_settings_when_not_injected(conv_db, monkeypatch):
    """Regression: the live orchestrator must honour the configured provider, not hardcode opencode."""
    seen = []

    def fake_make(name):
        seen.append(name)
        return FakeProvider([])

    monkeypatch.setattr("app.ai.registry.make_provider", fake_make)
    with conv_db() as db:
        set_setting(db, "ai_provider", "qoder")
        db.commit()
    orch = Orchestrator()
    orch._provider()
    assert seen == ["qoder"]


# -- live action events -----------------------------------------------------------


class ActingProvider(FakeProvider):
    """Calls the persona's live hook like a provider that can see its own tool calls."""

    def __init__(self, responses, actions):
        super().__init__(responses)
        self.actions = actions

    def run(self, persona, prompt, timeout_s=300, should_cancel=None):
        if persona.mode == "coding" and persona.on_action:
            for kind, summary in self.actions:
                persona.on_action(kind, summary)
        return super().run(persona, prompt, timeout_s, should_cancel)


def _developer_plan(conv_db):
    conv_id, anchor_id = start_conversation(conv_db)
    payload = {"action": "propose", "summary": "code it", "plan": {"steps": [
        {"title": "Write script", "instruction": "create report.py", "agent_role": "Developer",
         "depends_on": [], "acceptance_criteria": ["file exists"], "uses_tools": True}]}}
    tick.provider = FakeProvider([ProviderResult(ok=True, text=json.dumps(payload))])
    tick(conv_db)
    with conv_db() as db:
        conversation_service.approve_plan(db, conv_id, 1)
    return conv_id, anchor_id


def test_tool_calls_become_action_events_attributed_to_the_step_agent(conv_db, client):
    from app.models import Agent, TaskEvent
    conv_id, anchor_id = _developer_plan(conv_db)
    # Three calls in the same instant: the gate keeps the first, so the journal stays readable.
    tick.provider = ActingProvider(
        [ProviderResult(ok=True, text="created report.py"), QC_PASS],
        [("write", "Tulis report.py"), ("read", "Baca data.csv"), ("run", "Terminal: python")])
    tick(conv_db)
    assert state(conv_db, anchor_id) == "completed"
    with conv_db() as db:
        byte = db.query(Agent).filter(Agent.role == "Developer").first()
        actions = db.query(TaskEvent).filter(TaskEvent.event_type.like("action\\_%", escape="\\")).all()
        assert [(e.event_type, e.message) for e in actions] == [("action_write", "Tulis report.py")]
        e = actions[0]
        assert e.agent_id == byte.id and e.step_index == 0 and e.conversation_id == conv_id
        assert e.provider == "opencode" and e.model == "fake/model"
    # The transcript feed hides them unless asked; the raw journal keeps them.
    quiet = client.get("/api/events/team", params={"conversation_id": conv_id}).json()
    assert all(not ev["event_type"].startswith("action_") for ev in quiet)
    loud = client.get("/api/events/team", params={"conversation_id": conv_id, "include_actions": "true"}).json()
    assert any(ev["event_type"] == "action_write" for ev in loud)


def test_a_provider_that_never_calls_the_hook_leaves_the_journal_unchanged(conv_db):
    from app.models import TaskEvent
    _conv_id, anchor_id = _developer_plan(conv_db)
    tick.provider = FakeProvider([ProviderResult(ok=True, text="created report.py"), QC_PASS])
    tick(conv_db)
    assert state(conv_db, anchor_id) == "completed"
    with conv_db() as db:
        assert db.query(TaskEvent).filter(TaskEvent.event_type.like("action\\_%", escape="\\")).count() == 0


# -- reviewer visit after a failed QC ---------------------------------------------


def test_failed_qc_sends_the_reviewer_to_the_step_owner(conv_db):
    from app.models import Agent, TaskEvent
    with conv_db() as db:
        set_setting(db, "ai_retry_max", "1")
        db.add(Agent(name="Sage", role="Researcher", status="idle", position_x=0, position_z=0))
        db.add(Agent(name="Quill", role="Administrator", status="idle", position_x=0, position_z=0))
        db.add(Agent(name="Proof", role="Reviewer", status="idle", position_x=0, position_z=0))
        db.commit()
    conv_id, anchor_id = drive_to_approval(conv_db)
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text="Numbers: 42 rows"),
        ProviderResult(ok=True, text="fluffy summary"),
        qc_fail(findings="summary lacks the numbers token=abc123"),
        ProviderResult(ok=True, text="summary with 42 rows"),
        QC_PASS,
    ])
    tick(conv_db)
    assert state(conv_db, anchor_id) == "completed"
    with conv_db() as db:
        by_name = {a.name: a for a in db.query(Agent).all()}
        [visit] = db.query(TaskEvent).filter(TaskEvent.event_type == "review_visit").all()
        assert visit.actor_agent_id == by_name["Proof"].id and visit.agent_id == by_name["Proof"].id
        assert visit.recipient_agent_id == by_name["Quill"].id   # owner of failed step 1
        assert visit.to_room == "admin" and visit.step_index == 1 and visit.conversation_id == conv_id
        assert "summary lacks the numbers" in visit.message and "abc123" not in visit.message
        # nobody is left parked in the meeting room once QC passes
        assert all(a.target_room != "meeting" for a in by_name.values())


def test_no_reviewer_on_the_roster_means_no_visit_is_announced(conv_db):
    from app.models import Agent, TaskEvent
    with conv_db() as db:
        set_setting(db, "ai_retry_max", "1")
        db.add(Agent(name="Quill", role="Administrator", status="idle", position_x=0, position_z=0))
        db.commit()
    _conv_id, anchor_id = drive_to_approval(conv_db)
    tick.provider = FakeProvider([
        ProviderResult(ok=True, text="Numbers: 42 rows"), ProviderResult(ok=True, text="fluffy"),
        QC_FAIL, ProviderResult(ok=True, text="better"), QC_PASS])
    tick(conv_db)
    assert state(conv_db, anchor_id) == "completed"
    with conv_db() as db:
        assert db.query(TaskEvent).filter(TaskEvent.event_type == "review_visit").count() == 0
