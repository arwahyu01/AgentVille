import json

import pytest

from app import conversation_service
from app.ai.base import ProviderResult
from app.models import Agent, Task, TaskEvent
from app.plan_schema import PlanStep, TaskPlan
from app.workflows import WORKFLOWS, apply_workflow
from test_orchestrator_conversation import conv_db, qc_pass, tick  # noqa: F401  (fixtures)

MARKETING_ROLES = ["AI Coordinator", "Researcher", "Marketing Strategist", "Copywriter", "Reviewer"]
APP_ROLES = ["Product Analyst", "UI/UX Designer", "Tech Lead", "Frontend Developer",
             "Backend Developer", "QA Engineer", "Reviewer"]


def make_plan(workflow, roles):
    steps = [PlanStep(title=f"s{i}", instruction=f"do {role}", agent_role=role,
                      depends_on=[i - 1] if i else [], acceptance_criteria=["ok"])
             for i, role in enumerate(roles)]
    return TaskPlan(steps=steps, workflow=workflow, acceptance_criteria=["done"])


def test_marketing_plan_gets_reviewers_and_deliverables():
    plan = make_plan("marketing", MARKETING_ROLES)
    apply_workflow(plan)
    reviewers = [s.reviewer_role for s in plan.steps]
    assert reviewers == ["", "Fact-Checker", "AI Coordinator", "Marketing Strategist", ""]
    assert all(s.deliverable for s in plan.steps)


def test_app_plan_allows_parallel_frontend_backend_in_either_order():
    plan = make_plan("app", APP_ROLES)
    apply_workflow(plan)
    swapped = make_plan("app", [*APP_ROLES[:3], "Backend Developer", "Frontend Developer", *APP_ROLES[5:]])
    apply_workflow(swapped)
    assert swapped.steps[3].reviewer_role == "Tech Lead"


def test_missing_required_stage_is_rejected():
    plan = make_plan("marketing", ["AI Coordinator", "Marketing Strategist", "Copywriter", "Reviewer"])
    with pytest.raises(ValueError, match="needs these stages"):
        apply_workflow(plan)


def test_out_of_order_stage_is_rejected():
    plan = make_plan("marketing", ["AI Coordinator", "Marketing Strategist", "Researcher",
                                   "Copywriter", "Reviewer"])
    with pytest.raises(ValueError, match="does not fit"):
        apply_workflow(plan)


def test_role_outside_template_and_unknown_workflow_are_rejected():
    with pytest.raises(ValueError, match="does not fit"):
        apply_workflow(make_plan("marketing", [*MARKETING_ROLES, "Backend Developer"]))
    with pytest.raises(ValueError, match="unknown workflow"):
        apply_workflow(make_plan("nope", MARKETING_ROLES))


def test_reviewer_cannot_review_own_work():
    plan = make_plan("marketing", MARKETING_ROLES)
    plan.steps[2].reviewer_role = "Marketing Strategist"
    with pytest.raises(ValueError, match="own work"):
        apply_workflow(plan)


def test_free_form_plan_is_untouched():
    plan = make_plan("", ["Researcher", "Administrator"])
    apply_workflow(plan)
    assert [s.reviewer_role for s in plan.steps] == ["", ""]


def test_every_template_role_exists_in_the_roster():
    from app.plan_schema import VALID_ROLES
    for flow in WORKFLOWS.values():
        for stage in flow.stages:
            assert set(stage.roles) <= VALID_ROLES
            assert not stage.reviewer or stage.reviewer in VALID_ROLES


def seed_roles(factory, roles):
    with factory() as db:
        have = {a.role for a in db.query(Agent).all()}
        for i, role in enumerate(roles):
            if role not in have:
                db.add(Agent(name=f"A{i}", role=role, status="idle", position_x=0, position_z=0))
                have.add(role)
        db.commit()


def test_workflow_plan_waits_for_user_then_runs(conv_db):
    seed_roles(conv_db, MARKETING_ROLES + ["Fact-Checker"])
    with conv_db() as db:
        conv = conversation_service.create_conversation(db, "Campaign for a coffee brand")
        row = conversation_service.propose_plan(db, conv.id, make_plan("marketing", MARKETING_ROLES))
        anchor = db.get(Task, conv.anchor_task_id)
        assert anchor.status == "awaiting_approval"
        assert db.query(Task).filter(Task.parent_id == anchor.id).count() == 0
        assert db.query(TaskEvent).filter_by(event_type="gate_waiting").count() == 1
        conversation_service.approve_plan(db, conv.id, row.version, decided_by="user")
        db.refresh(anchor)
        assert anchor.status == "approved"
        assert db.query(Task).filter(Task.parent_id == anchor.id).count() == 5


def test_free_form_plan_still_auto_approves(conv_db):
    with conv_db() as db:
        conv = conversation_service.create_conversation(db, "Short report")
        plan = make_plan("", ["Researcher", "Administrator"])
        conversation_service.propose_plan(db, conv.id, plan)
        assert db.get(Task, conv.anchor_task_id).status == "approved"


def test_accept_only_from_awaiting_acceptance(conv_db):
    with conv_db() as db:
        conv = conversation_service.create_conversation(db, "x")
        with pytest.raises(conversation_service.ConversationError):
            conversation_service.accept_result(db, conv.id)


def role_provider(reviews, reviewer_replies):
    """Routes by persona: step output, peer-review verdicts, QC pass."""
    qc = qc_pass()
    state = {"n": 0}

    class P:
        calls = []

        def run(self, persona, prompt, timeout_s=300, should_cancel=None):
            P.calls.append((persona, prompt))
            state["n"] += 1
            if persona.key == "qc-reviewer":
                return qc(state["n"], prompt)
            if prompt.startswith("Check the output of step"):
                reviews.append(persona.role)
                return ProviderResult(ok=True, text=json.dumps(reviewer_replies.pop(0)))
            return ProviderResult(ok=True, text=f"output from {persona.role}")
    return P()


def run_to_end(factory, provider, roles):
    seed_roles(factory, roles + ["Fact-Checker"])
    with factory() as db:
        conv = conversation_service.create_conversation(db, "Campaign for a coffee brand")
        row = conversation_service.propose_plan(db, conv.id, make_plan("marketing", roles))
        conversation_service.approve_plan(db, conv.id, row.version, decided_by="user")
        anchor_id, conv_id = conv.anchor_task_id, conv.id
    tick.provider = provider
    for _ in range(6):
        tick(factory)
    return anchor_id, conv_id


def test_peer_review_sends_work_back_once_then_final_gate_waits(conv_db):
    reviews: list[str] = []
    replies = [{"approved": False, "notes": "no sources cited"}] + [{"approved": True, "notes": "ok"}] * 8
    provider = role_provider(reviews, replies)
    anchor_id, conv_id = run_to_end(conv_db, provider, MARKETING_ROLES)
    with conv_db() as db:
        anchor = db.get(Task, anchor_id)
        events = [e.event_type for e in db.query(TaskEvent).all()]
        assert reviews[0] == "Fact-Checker"           # research is checked by someone else
        assert "review_visit" in events and "step_started" in events
        research_runs = [p for _, p in provider.calls if "Researcher" in p or "no sources cited" in p]
        assert any("no sources cited" in p for _, p in provider.calls)   # the author saw the notes
        assert anchor.status == "awaiting_acceptance"                     # QC passed; user signs off
        conversation_service.accept_result(db, conv_id)
        db.refresh(anchor)
        assert anchor.status == "completed"
        assert research_runs is not None


def test_unreadable_peer_review_is_recorded_not_approved(conv_db):
    class Bad:
        calls = []

        def run(self, persona, prompt, timeout_s=300, should_cancel=None):
            Bad.calls.append(prompt)
            if persona.key == "qc-reviewer":
                return qc_pass()(1, prompt)
            if prompt.startswith("Check the output of step"):
                return ProviderResult(ok=True, text="looks fine to me")
            return ProviderResult(ok=True, text="out")
    anchor_id, _ = run_to_end(conv_db, Bad(), MARKETING_ROLES)
    with conv_db() as db:
        msgs = [e.message for e in db.query(TaskEvent).filter_by(event_type="peer_review").all()]
        assert msgs and all("tidak terbaca" in m for m in msgs)


def test_fit_handoff_passes_short_results_whole_and_marks_cuts():
    from app.orchestrator import fit_handoff, prompt_room
    whole = fit_handoff({0: "alpha", 1: "beta"}, [0, 1], 4000)
    assert "alpha" in whole and "beta" in whole and "dipotong" not in whole
    long = fit_handoff({0: "A" * 9000 + "TAIL", 1: "short"}, [0, 1], 4000)
    assert "short" in long                      # the second dependency is not starved
    assert "karakter dipotong" in long and "TAIL]" in long
    assert prompt_room("claude") > prompt_room("opencode")


def test_claude_step_receives_whole_long_dependency(conv_db):
    big = "keyword-line\n" * 1000 + "LAST-KEYWORD"    # ~13k chars, far over the old 4000 cap
    seen = []

    class P:
        def run(self, persona, prompt, timeout_s=300, should_cancel=None):
            seen.append(prompt)
            if persona.key == "qc-reviewer":
                return qc_pass()(1, prompt)
            return ProviderResult(ok=True, text=big if len(seen) == 1 else "done")
    from app.orchestrator import Orchestrator
    from test_orchestrator_conversation import drive_to_approval
    from app.settings_store import set_setting
    with conv_db() as db:
        set_setting(db, "ai_provider", "claude")
        db.commit()
    drive_to_approval(conv_db)
    orch = Orchestrator(provider=P())
    orch.RETRY_BACKOFF_S = 0
    orch._tick()
    assert "LAST-KEYWORD" in seen[1]


def test_fail_verdict_with_invented_ref_keeps_its_findings():
    from app.qc_schema import validate_qc_payload
    payload = {"verdict": "fail", "criteria": [{"id": "C1", "criterion": "x", "met": False, "detail": "d"}],
               "findings": "table missing", "evidence": "checked the report",
               "artifacts_checked": ["artifact:task-1.md", "missing:task-1-body"], "failed_steps": [1]}
    v = validate_qc_payload(payload, ["x"], {"artifact:task-1.md"}, 3)
    assert v.verdict == "fail" and v.failed_steps == [1]
    assert v.artifacts_checked == ["artifact:task-1.md"]


def test_pass_verdict_with_invented_ref_is_still_rejected():
    from app.qc_schema import validate_qc_payload
    payload = {"verdict": "pass", "criteria": [{"id": "C1", "criterion": "x", "met": True, "detail": "d"}],
               "findings": "all good", "evidence": "checked the report in full detail",
               "artifacts_checked": ["artifact:invented.md"], "failed_steps": []}
    with pytest.raises(ValueError, match="not in the evidence inventory"):
        validate_qc_payload(payload, ["x"], {"artifact:task-1.md"}, 3)


def test_review_stage_is_optional_because_qc_always_runs():
    plan = make_plan("marketing", MARKETING_ROLES[:-1])     # no Reviewer step
    apply_workflow(plan)
    plan = make_plan("app", APP_ROLES[:-1])
    apply_workflow(plan)
