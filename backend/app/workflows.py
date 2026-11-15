"""Workflow templates: who does each stage, who checks it, what it hands on, who signs off.

A template is data. Atlas picks one by key and fills in the instructions; `apply_workflow`
then checks the plan against the template and stamps each step with its reviewer and
deliverable, so the order of work is never improvised for these job types. A request that fits
no template stays a free-form plan (workflow = "").

Gates:
  none  - the step flows straight on
  user  - handled outside the steps: `user_gates` lists the two points where the user must act
          ("plan" before work starts, "final" before the result counts as accepted)
"""
from __future__ import annotations

from dataclasses import dataclass

from app.plan_schema import TaskPlan


@dataclass(frozen=True)
class Stage:
    key: str
    title: str
    roles: tuple[str, ...]          # who may carry out the stage (any of)
    reviewer: str = ""              # who checks the output before the next stage ("" = none)
    deliverable: str = ""
    optional: bool = False
    rank: int = 0                   # stages with the same rank may run in parallel


@dataclass(frozen=True)
class Workflow:
    key: str
    label: str
    use_when: str
    stages: tuple[Stage, ...]
    user_gates: tuple[str, ...] = ("plan", "final")


MARKETING = Workflow(
    key="marketing",
    label="Marketing",
    use_when="campaigns, promotion, branding, ads, social content, go-to-market",
    stages=(
        Stage("brief", "Brief & tujuan", ("AI Coordinator",), "", "brief + KPI", rank=0),
        Stage("research", "Riset pasar & pesaing", ("Researcher",), "Fact-Checker",
              "ringkasan riset bersumber", rank=1),
        Stage("strategy", "Strategi & pesan inti", ("Marketing Strategist",), "AI Coordinator",
              "strategi, audiens, kanal", rank=2),
        Stage("content", "Pembuatan konten", ("Copywriter", "Content Creator"),
              "Marketing Strategist", "naskah, skrip, caption", rank=3),
        Stage("visual", "Arahan visual", ("UI/UX Designer",), "Marketing Strategist",
              "arahan visual", optional=True, rank=3),
        Stage("verify", "Verifikasi akhir", ("Reviewer",), "", "verdict per kriteria",
              optional=True, rank=4),
    ),
)

APP = Workflow(
    key="app",
    label="Membuat aplikasi",
    use_when="building a web/mobile app, feature, API, site or other software",
    stages=(
        Stage("requirements", "Requirement", ("Product Analyst",), "AI Coordinator",
              "user story + kriteria", rank=0),
        Stage("design", "Desain alur & UI", ("UI/UX Designer",), "Product Analyst",
              "wireframe, token desain", rank=1),
        Stage("architecture", "Arsitektur & pembagian tugas", ("Tech Lead",), "AI Coordinator",
              "struktur dan kontrak API", rank=2),
        Stage("frontend", "Frontend", ("Frontend Developer",), "Tech Lead",
              "kode antarmuka", rank=3),
        Stage("backend", "Backend", ("Backend Developer",), "Tech Lead",
              "kode layanan dan data", rank=3),
        Stage("testing", "Pengujian", ("QA Engineer",), "Tech Lead", "hasil tes", rank=4),
        Stage("verify", "Verifikasi akhir", ("Reviewer",), "", "verdict per kriteria",
              optional=True, rank=5),
    ),
)

WORKFLOWS: dict[str, Workflow] = {w.key: w for w in (MARKETING, APP)}


def _hint() -> str:
    parts = []
    for w in WORKFLOWS.values():
        chain = " -> ".join(
            f"{'/'.join(s.roles)}{'?' if s.optional else ''}" for s in w.stages)
        parts.append(f'"{w.key}" ({w.use_when}): {chain}')
    return (
        'Add "workflow": <key> to the plan when the request fits a template, and follow its stage '
        "order exactly (one step per stage, a stage marked ? may be skipped; stages whose roles "
        "share a position may run in parallel via depends_on): " + "; ".join(parts) + ". "
        'Leave "workflow" out for anything else. Each step may carry "reviewer_role" and '
        '"deliverable"; they are filled in from the template when omitted. '
    )


WORKFLOW_HINT = _hint()


def get(key: str) -> Workflow | None:
    return WORKFLOWS.get(key)


def depth_allowance(key: str) -> int:
    """A template is a deliberate chain, so its length must not trip the generic delegation-depth
    safety limit (default 4) that exists to stop runaway free-form plans."""
    flow = WORKFLOWS.get(key)
    return len({s.rank for s in flow.stages}) if flow else 0


def apply_workflow(plan: TaskPlan) -> None:
    """Check the plan against its template and stamp reviewers/deliverables onto the steps.

    Raises ValueError with a fixable message when a required stage is missing, a stage is out
    of order, or a role outside the template is used. Free-form plans pass untouched."""
    if not plan.workflow:
        return
    workflow = WORKFLOWS.get(plan.workflow)
    if workflow is None:
        raise ValueError(
            f"unknown workflow {plan.workflow!r}; use one of: {', '.join(WORKFLOWS)}")

    def stage_of(role: str, after_rank: int) -> Stage | None:
        # The earliest stage this role can fill that is not behind the previous step.
        for stage in workflow.stages:
            if role in stage.roles and stage.rank >= after_rank:
                return stage
        return None

    rank = 0
    matched: list[Stage] = []
    for index, step in enumerate(plan.steps):
        stage = stage_of(step.agent_role, rank)
        if stage is None:
            raise ValueError(
                f"step {index} ({step.agent_role}) does not fit the '{workflow.key}' workflow "
                f"order: {' -> '.join(s.title for s in workflow.stages)}")
        rank = stage.rank
        matched.append(stage)
        if not step.reviewer_role:
            step.reviewer_role = stage.reviewer
        if not step.deliverable:
            step.deliverable = stage.deliverable
        if step.reviewer_role and step.reviewer_role == step.agent_role:
            raise ValueError(f"step {index}: {step.agent_role} cannot review its own work")

    present = {s.key for s in matched}
    missing = [s.title for s in workflow.stages if not s.optional and s.key not in present]
    if missing:
        raise ValueError(f"the '{workflow.key}' workflow needs these stages: {', '.join(missing)}")
