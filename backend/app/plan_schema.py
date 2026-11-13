import json
import re
from dataclasses import dataclass

from pydantic import BaseModel, Field, field_validator


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

    @field_validator("agent_role")
    @classmethod
    def known_role(cls, value: str) -> str:
        if value not in VALID_ROLES:
            raise ValueError(
                f"unknown agent_role {value!r}; use one of: {', '.join(ROLE_NAMES)}")
        return value


class TaskPlan(BaseModel):
    # No hard step cap here: the safety limit is configurable per deployment
    # (see settings_store.plan_max_steps) and enforced in validate_for_budget with a
    # clear error, so a plan is never silently trimmed.
    steps: list[PlanStep] = Field(min_length=1)
    summary: str = ""
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
        A step that claims to write files must be owned by a coding-capable role."""
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
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    try:
        parsed = json.loads(match.group(0))
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None
