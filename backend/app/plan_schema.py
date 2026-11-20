import json
import re
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field, field_validator

from app.tools import registry as tool_registry


_DESTRUCTIVE_CHANGE = re.compile(
    r"\brm\s+-rf\b|\bremove-item\b[^\n]*(?:-recurse|-force)|"
    r"\bgit\s+reset\s+--hard\b|\bwipe\b|\btruncate\b|"
    r"\bformat\s+(?:disk|drive|partition|volume|database|db)\b|"
    r"\bdrop\s+(?:database|table)\b|\bdelete\s+(?:all|from)\b|"
    r"\b(?:hapus|menghapus)\s+(?:semua|seluruh|database|tabel|folder|file)\b|"
    r"\b(?:revoke|disable)\s+(?:all\s+)?(?:access|permission|authentication|security|firewall|mfa)\b",
    re.IGNORECASE,
)
_DANGER_NEGATION = re.compile(r"\b(?:do not|don't|never|jangan|tidak boleh|hindari|tanpa)\s*$",
                              re.IGNORECASE)


def _contains_destructive_change(text: str) -> bool:
    for match in _DESTRUCTIVE_CHANGE.finditer(text):
        prefix = text[max(0, match.start() - 40):match.start()]
        if not _DANGER_NEGATION.search(prefix):
            return True
    return False


@dataclass(frozen=True)
class RoleSpec:
    """One source of truth for the roster: planner prompts, schema validation,
    personas, the agent seed and the UI all read this list."""
    name: str
    blurb: str
    coding_capable: bool = False


ROLES: tuple[RoleSpec, ...] = (
    RoleSpec("AI Coordinator", "coordinate the work, ask clarifying questions, keep the plan coherent"),
    RoleSpec("Product Analyst", "turn the request into requirements, user stories and scope notes"),
    RoleSpec("UI/UX Designer", "produce screen flows, wireframe descriptions and design tokens"),
    RoleSpec("Frontend Developer", "implement the interface in the workspace", coding_capable=True),
    RoleSpec("Backend Developer", "implement services, APIs and data layers in the workspace", coding_capable=True),
    RoleSpec("QA Engineer", "write and execute tests against the acceptance criteria", coding_capable=True),
    RoleSpec("Developer", "implement code changes in the workspace", coding_capable=True),
    RoleSpec("Researcher", "collect, summarise and structure information"),
    RoleSpec("Data Analyst", "analyse data and present findings"),
    RoleSpec("Administrator", "draft formal documents and reports"),
    RoleSpec("Content Creator", "write content ideas, scripts and captions"),
    RoleSpec("Reviewer", "check completeness and correctness of delivered work"),
)

VALID_ROLES = {role.name for role in ROLES}
CODING_CAPABLE_ROLES = {role.name for role in ROLES if role.coding_capable}
ROLE_NAMES = tuple(role.name for role in ROLES)


class PlanStep(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    instruction: str = Field(min_length=1)
    agent_role: str
    depends_on: list[int] = Field(default_factory=list)
    required: bool = True
    acceptance_criteria: list[str] = Field(default_factory=list)
    uses_tools: bool = False
    # Declared tool intent. Empty keeps older plans valid (the coding CLI default set is
    # used), but anything named must exist in app.tools.registry and be legal for the role.
    tools: list[str] = Field(default_factory=list, max_length=12)
    risk: Literal["low", "medium", "high"] = "low"

    @field_validator("agent_role")
    @classmethod
    def known_role(cls, value: str) -> str:
        if value not in VALID_ROLES:
            raise ValueError(
                f"unknown agent_role {value!r}; use one of: {', '.join(ROLE_NAMES)}")
        return value

    @field_validator("tools")
    @classmethod
    def declared_tools(cls, values: list[str]) -> list[str]:
        for value in values:
            if not str(value).strip() or len(str(value)) > 40:
                raise ValueError("tool names must be short, non-empty identifiers")
        return tool_registry.normalise_tools(values)


class TaskPlan(BaseModel):
    # No hard step cap here: the safety limit is configurable per deployment
    # (see settings_store.plan_max_steps) and enforced in validate_for_budget with a
    # clear error, so a plan is never silently trimmed.
    steps: list[PlanStep] = Field(min_length=1)
    summary: str = ""
    goal: str = Field(default="", max_length=1000)
    scope: str = Field(default="", max_length=4000)
    assumptions: list[str] = Field(default_factory=list, max_length=20)
    risks: list[str] = Field(default_factory=list, max_length=20)
    external_actions: list[str] = Field(default_factory=list, max_length=20)
    acceptance_criteria: list[str] = Field(default_factory=list)

    @field_validator("steps")
    @classmethod
    def dependencies_reference_earlier_steps(cls, steps: list[PlanStep]) -> list[PlanStep]:
        for index, step in enumerate(steps):
            if any(dep < 0 or dep >= index for dep in step.depends_on):
                raise ValueError("depends_on may only reference earlier step indexes")
        return steps

    def dependency_depth(self) -> int:
        """Length of the longest chain (in steps) through the DAG; a single node is depth 1."""
        memo: dict[int, int] = {}

        def depth(index: int) -> int:
            if index in memo:
                return memo[index]
            deps = self.steps[index].depends_on
            memo[index] = 1 + (max((depth(d) for d in deps), default=0))
            return memo[index]

        return max((depth(i) for i in range(len(self.steps))), default=0)

    def validate_for_conversation(self) -> None:
        """Stricter contract for plans that will gate execution: criteria must exist and
        every dependency target must be present (guaranteed by ordering, checked anyway).
        A step that claims to write files must be owned by a coding-capable role, and every
        declared tool must exist and be legal for that role."""
        if not self.acceptance_criteria and not any(step.acceptance_criteria for step in self.steps):
            raise ValueError("plan must define acceptance criteria")
        for index, step in enumerate(self.steps):
            for dep in step.depends_on:
                if dep >= len(self.steps):
                    raise ValueError("dependency references a step that does not exist")
            if step.uses_tools and step.agent_role not in CODING_CAPABLE_ROLES:
                raise ValueError(
                    f"step {index} ({step.agent_role}) sets uses_tools but that role cannot "
                    f"write files; assign it to one of: {', '.join(sorted(CODING_CAPABLE_ROLES))}")
            for raw in step.tools:
                canonical = tool_registry.canonical_tool(raw)
                spec = tool_registry.tool_spec(raw)
                if canonical is None or spec is None:
                    raise ValueError(
                        f"step {index} requests unknown tool {raw!r}; declared tools are: "
                        + ", ".join(sorted(tool_registry.TOOLS)))
                if spec.mutates and not step.uses_tools:
                    raise ValueError(
                        f"step {index} requests mutating tool {canonical!r} but uses_tools is "
                        "false; set uses_tools=true and assign a coding-capable role")
                if spec.kind in ("write", "run") and step.agent_role not in CODING_CAPABLE_ROLES:
                    raise ValueError(
                        f"step {index} requests {canonical!r} but {step.agent_role} cannot write; "
                        f"assign it to one of: {', '.join(sorted(CODING_CAPABLE_ROLES))}")
                if spec.kind == "external" and step.agent_role not in CODING_CAPABLE_ROLES:
                    raise ValueError(
                        f"step {index} requests external tool {canonical!r}; assign it to a "
                        "coding-capable role so the operation has an actual executor")

    def explicit_approval_reasons(self) -> list[str]:
        """Why this plan must stop for a human before anything runs. Empty means the normal
        auto-approval path applies. Reasons name the concrete action/tool/risk, never a
        generic 'approve this plan'."""
        reasons: list[str] = []
        for action in self.external_actions:
            text = str(action).strip()
            if text:
                reasons.append(f"external action: {text[:200]}")
        for index, step in enumerate(self.steps):
            if step.risk == "high":
                reasons.append(f"step {index} is marked high risk")
            instruction = f"{step.title}\n{step.instruction}"
            if _contains_destructive_change(instruction):
                reasons.append(f"step {index} includes a destructive or security-sensitive change")
            for raw in step.tools:
                spec = tool_registry.tool_spec(raw)
                if spec is not None and (spec.kind == "external" or spec.risk == "high"):
                    reasons.append(f"step {index} uses {spec.name} ({spec.summary})")
        plan_context = "\n".join((self.goal, self.scope, *self.assumptions, *self.risks))
        if _contains_destructive_change(plan_context):
            reasons.append("plan scope includes a destructive or security-sensitive change")
        # Preserve order, drop duplicates.
        return list(dict.fromkeys(reasons))

    def validate_for_budget(self, max_steps: int, max_depth: int) -> None:
        """Enforce the configurable safety limits with a fixable error instead of trimming
        the plan. max_steps/max_depth come from settings (see settings_store)."""
        if len(self.steps) > max_steps:
            raise ValueError(
                f"plan has {len(self.steps)} steps but the configured safety limit "
                f"(max_plan_steps) is {max_steps}; reduce the scope or raise the limit")
        depth = self.dependency_depth()
        if depth > max_depth:
            raise ValueError(
                f"plan has a dependency chain {depth} steps deep but the configured limit "
                f"(max_delegation_depth) is {max_depth}; flatten the chain or raise the limit")


def extract_json(text: str) -> dict | None:
    """Return the first complete JSON object in a provider reply.

    Tolerates surrounding prose, fenced blocks and trailing commentary. It never
    repairs truncated or structurally invalid JSON, so an unreadable verdict stays
    unreadable and fails closed.
    """
    if not text:
        return None
    decoder = json.JSONDecoder(strict=False)
    for match in re.finditer(r"\{", text):
        try:
            parsed, _ = decoder.raw_decode(text, match.start())
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None
