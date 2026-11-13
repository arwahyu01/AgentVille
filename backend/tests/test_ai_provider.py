from app.ai.opencode import build_argv, parse_events
from app.orchestrator import TaskPlan, extract_json
from app.ai.personas import persona_for_role


def test_build_argv_uses_fixed_safe_args():
    argv = build_argv("opencode/big-pickle", title="my task!!")
    assert argv[:6] == ["opencode", "run", "--format", "json", "--model", "opencode/big-pickle"]
    assert argv[6:] == ["--title", "my-task--"]


def test_build_argv_rejects_shell_unsafe_model():
    import pytest
    with pytest.raises(ValueError):
        build_argv("evil; rm -rf /")


def test_parse_events_collects_text():
    stdout = "\n".join([
        '{"type":"step_start","sessionID":"ses_1"}',
        '{"type":"text","part":{"type":"text","text":"Hello "}}',
        '{"type":"text","part":{"type":"text","text":"world"}}',
        '{"type":"step_finish"}',
    ])
    text, error = parse_events(stdout)
    assert text == "Hello world"
    assert error is None


def test_parse_events_extracts_error_event():
    stdout = '{"type":"error","error":{"type":"provider.free-limit","message":"Free usage limit reached."}}'
    text, error = parse_events(stdout)
    assert error == "Free usage limit reached."


def test_parse_events_nested_error_data_message():
    stdout = '{"type":"error","error":{"name":"X","data":{"message":"Rate limited"}}}'
    _, error = parse_events(stdout)
    assert error == "Rate limited"


def test_parse_events_falls_back_to_plain_text():
    text, error = parse_events("> build · big-pickle\nThe answer is 42.")
    assert text == "The answer is 42."
    assert error is None


def test_extract_json_finds_object_in_prose():
    assert extract_json('Here you go: {"approved": true, "notes": "ok"} thanks') == {"approved": True, "notes": "ok"}
    assert extract_json("no json here") is None


def test_task_plan_validation():
    import pytest
    plan = TaskPlan.model_validate({"steps": [
        {"title": "a", "instruction": "do a", "agent_role": "Developer", "depends_on": []},
        {"title": "b", "instruction": "do b", "agent_role": "Frontend Developer", "depends_on": [0]},
    ]})
    assert plan.steps[1].agent_role == "Frontend Developer"
    with pytest.raises(ValueError, match="unknown agent_role"):
        # unknown roles are a fixable error, never a silent downgrade to the coordinator
        TaskPlan.model_validate({"steps": [
            {"title": "x", "instruction": "y", "agent_role": "Unknown Role"}]})
    with pytest.raises(ValueError):
        TaskPlan.model_validate({"steps": [{"title": "x", "instruction": "y", "agent_role": "Developer", "depends_on": [5]}]})
    with pytest.raises(ValueError):
        TaskPlan.model_validate({"steps": []})


def test_plan_step_roles_cover_app_building():
    from app.plan_schema import VALID_ROLES
    for role in ("Product Analyst", "UI/UX Designer", "Frontend Developer",
                 "Backend Developer", "QA Engineer"):
        assert role in VALID_ROLES


def test_uses_tools_requires_coding_capable_role():
    import pytest
    from app.plan_schema import TaskPlan
    plan = TaskPlan(steps=[{"title": "write it", "instruction": "i", "agent_role": "Content Creator",
                            "uses_tools": True}], acceptance_criteria=["done"])
    with pytest.raises(ValueError, match="cannot write files"):
        plan.validate_for_conversation()


def test_persona_for_role_has_instructions():
    persona = persona_for_role("Data Analyst", "Nova")
    assert persona.name == "Nova"
    assert "analyse" in persona.instructions.lower() or "analys" in persona.instructions.lower()
    assert "must not claim" in persona.instructions.lower()  # text-only roles cannot claim file edits


def test_coding_persona_is_told_it_can_edit_files():
    persona = persona_for_role("Backend Developer", "Forge", mode="coding")
    assert persona.mode == "coding"
    assert "may read, create" in persona.instructions
    text_persona = persona_for_role("Backend Developer", "Forge", mode="text")
    assert "must not claim" in text_persona.instructions


def test_seeded_roster_matches_the_role_source_of_truth():
    """The plan is only trustworthy if a step's role really has an agent to run it:
    ROLES and the seeded `agents` table must be the same set, one agent per role.
    Simulation-only staff (Housekeeping/Security) are seeded too but must never be
    planner roles."""
    from app.database import DEFAULT_AGENTS
    from app.plan_schema import ROLE_NAMES, VALID_ROLES
    from app.rooms import OPERATIONAL_ROLES
    seeded = [role for _name, role, _x, _z in DEFAULT_AGENTS]
    assert len(seeded) == len(set(seeded))
    planner = [role for role in seeded if role not in OPERATIONAL_ROLES]
    assert len(planner) == len(ROLE_NAMES)
    assert set(planner) == VALID_ROLES
    assert set(s for s in seeded if s in OPERATIONAL_ROLES) == set(OPERATIONAL_ROLES)
    for name, role, _x, _z in DEFAULT_AGENTS:
        if role in OPERATIONAL_ROLES:
            continue
        assert persona_for_role(role, name).instructions
