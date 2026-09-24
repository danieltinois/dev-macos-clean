"""Core data models for DevClean.

These models are the single contract between the scanner, the CLI and,
later, the desktop UI. Keep them UI-agnostic.
"""

from __future__ import annotations

import re
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]*$")


class Severity(str, Enum):
    """Safety classification of a finding."""

    SAFE = "SAFE"
    REVIEW = "REVIEW"
    DANGER = "DANGER"


class Rebuild(BaseModel):
    """How an artifact can be recreated. Informational only: commands are never executed."""

    description: str
    commands: list[str] = Field(default_factory=list)
    model_config = ConfigDict(extra="forbid")


class Rule(BaseModel):
    """Declarative description of one scanable artifact type (one YAML file per rule)."""

    id: str
    name: str
    category: str
    severity: Severity
    reclaimable: bool
    description: str
    paths: list[str] = Field(default_factory=list)
    patterns: list[str] = Field(default_factory=list)
    rebuild: Rebuild | None = None
    model_config = ConfigDict(extra="forbid")

    @field_validator("id", "category")
    @classmethod
    def _slug(cls, value: str) -> str:
        if not _SLUG_RE.match(value):
            raise ValueError(f"{value!r} must match {_SLUG_RE.pattern}")
        return value

    @model_validator(mode="after")
    def _has_target(self) -> Rule:
        if not self.paths and not self.patterns:
            raise ValueError("rule must define at least one of paths or patterns")
        return self


class Finding(BaseModel):
    """A single scanned artifact."""

    rule_id: str
    name: str
    category: str
    severity: Severity
    reclaimable: bool
    description: str
    path: Path
    size_bytes: int
    size_complete: bool = True
    last_modified: datetime | None = None
    rebuild: Rebuild | None = None
    metadata: dict[str, str] = Field(default_factory=dict)


class Totals(BaseModel):
    """Aggregated sizes over all findings."""

    findings: int
    bytes: int
    by_severity: dict[str, int]
    by_category: dict[str, int]


class ScanReport(BaseModel):
    """Stable machine-readable contract (schema_version = 1) for the whole scan."""

    schema_version: int = 1
    scanned_at: datetime
    roots: list[str]
    options: dict[str, Any]
    totals: Totals
    findings: list[Finding]
    warnings: list[str] = Field(default_factory=list)