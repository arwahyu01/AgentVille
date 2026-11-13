"""Validated contract for the final QC verdict.

The reviewer runs in text-only mode, so its reply is the only thing it can produce. This
module is the trust boundary: a `pass` must be backed by one met result per acceptance
criterion, concrete evidence, and artifact references that the orchestrator actually put
in front of the reviewer. Anything else is rejected instead of being treated as approval.
"""

from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

CRITERION_ID = re.compile(r"^C\d+$")
ARTIFACT_REF = re.compile(r"^(workspace|artifact|missing):[^\s]+$")


class QcCriterion(BaseModel):
    id: str = Field(min_length=2, max_length=8)
    criterion: str = Field(min_length=1, max_length=500)
    met: bool
    detail: str = Field(default="", max_length=800)

    @field_validator("id")
    @classmethod
    def normalise_id(cls, value: str) -> str:
        value = value.strip().upper()
        if not CRITERION_ID.match(value):
            raise ValueError("criterion id must look like C1, C2, ...")
        return value


class QcVerdict(BaseModel):
    verdict: Literal["pass", "fail"]
    criteria: list[QcCriterion] = Field(min_length=1, max_length=80)
    findings: str = Field(min_length=1, max_length=2000)
    evidence: str = Field(min_length=1, max_length=2000)
    artifacts_checked: list[str] = Field(min_length=1, max_length=30)
    failed_steps: list[int] = Field(default_factory=list, max_length=80)

    @field_validator("artifacts_checked")
    @classmethod
    def artifact_refs(cls, values: list[str]) -> list[str]:
        cleaned: list[str] = []
        for value in values:
            ref = value.strip()
            if not ARTIFACT_REF.match(ref):
                raise ValueError(
                    "artifacts_checked entries must be 'workspace:<path>', "
                    "'artifact:<path>', or 'missing:<path>'"
                )
            if ref not in cleaned:
                cleaned.append(ref)
        return cleaned

    @field_validator("failed_steps")
    @classmethod
    def non_negative_steps(cls, values: list[int]) -> list[int]:
        for value in values:
            if not isinstance(value, int) or isinstance(value, bool) or value < 0:
                raise ValueError("failed_steps must be non-negative step indexes")
        return sorted(set(values))

    @model_validator(mode="after")
    def pass_is_earned(self) -> "QcVerdict":
        if self.verdict != "pass":
            return self
        if self.failed_steps:
            raise ValueError("a pass cannot name failed_steps")
        if not all(item.met for item in self.criteria):
            raise ValueError("a pass requires every listed criterion to be met")
        if any(ref.startswith("missing:") for ref in self.artifacts_checked):
            raise ValueError("a pass cannot cite missing artifacts")
        if len(self.evidence.strip()) < 20:
            raise ValueError("a pass needs concrete evidence, not a one-word claim")
        return self


def criterion_ids(criteria: list[str]) -> list[str]:
    """Stable IDs used in the prompt and in the stored criteria_json."""
    return [f"C{index + 1}" for index in range(len(criteria))]


def validate_qc_payload(
    payload: dict,
    plan_criteria: list[str],
    artifact_refs: set[str],
    step_count: int,
) -> QcVerdict:
    """Validate a reviewer payload against the plan and the evidence inventory.

    Raises ValueError with a human-readable diagnostic. The caller keeps the task failed
    on any error; this function never returns a pass that the evidence cannot support.
    """
    verdict = QcVerdict.model_validate(payload)
    expected = criterion_ids(plan_criteria) or ["C1"]
    returned = [item.id for item in verdict.criteria]

    unknown = [item for item in returned if item not in expected]
    if unknown:
        raise ValueError(
            f"unknown criterion ids {unknown}; expected {expected}"
        )

    unknown_artifacts = [ref for ref in verdict.artifacts_checked if ref not in artifact_refs]
    if unknown_artifacts:
        raise ValueError(
            "artifacts_checked cites files that were not in the evidence inventory: "
            + ", ".join(unknown_artifacts)
        )

    bad_steps = [index for index in verdict.failed_steps if index >= step_count]
    if bad_steps:
        raise ValueError(f"failed_steps indexes outside the plan: {bad_steps}")

    if verdict.verdict == "pass":
        missing = [item for item in expected if item not in returned]
        if missing:
            raise ValueError(
                "a pass must report every acceptance criterion; missing " + ", ".join(missing)
            )
        if not any(ref.startswith("workspace:") or ref.startswith("artifact:")
                   for ref in verdict.artifacts_checked):
            raise ValueError("a pass must cite at least one existing artifact")
    return verdict
