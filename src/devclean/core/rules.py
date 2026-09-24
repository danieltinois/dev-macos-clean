"""Load and validate declarative rules from YAML files.

Rules live in ``devclean/rules/*.yaml`` inside the package so they work both
from a checkout and from an installed wheel. Everything that can be checked
statically (ids, severity, required fields, unknown keys) is enforced here.
"""

from __future__ import annotations

import logging
from pathlib import Path

import yaml
from pydantic import ValidationError

from devclean.core.models import Rule

logger = logging.getLogger("devclean.rules")

DEFAULT_RULES_DIR = Path(__file__).resolve().parent.parent / "rules"


class RuleError(Exception):
    """Raised when the packaged rules cannot be loaded or are invalid."""


def load_rules(directory: Path | None = None) -> list[Rule]:
    """Load every ``*.yaml`` in *directory* (default: packaged rules) as one Rule each."""
    rules_dir = directory or DEFAULT_RULES_DIR
    if not rules_dir.is_dir():
        raise RuleError(f"rules directory not found: {rules_dir}")

    rules: list[Rule] = []
    for file in sorted(rules_dir.glob("*.yaml")):
        try:
            data = yaml.safe_load(file.read_text(encoding="utf-8"))
        except yaml.YAMLError as exc:
            raise RuleError(f"{file.name}: invalid YAML: {exc}") from exc
        if not isinstance(data, dict):
            raise RuleError(f"{file.name}: expected a YAML mapping with a single rule")
        try:
            rules.append(Rule.model_validate(data))
        except ValidationError as exc:
            raise RuleError(f"{file.name}: invalid rule: {exc}") from exc

    ids = [rule.id for rule in rules]
    dupes = sorted({rule_id for rule_id in ids if ids.count(rule_id) > 1})
    if dupes:
        raise RuleError(f"duplicate rule ids: {dupes}")
    if not rules:
        logger.warning("no rules loaded from %s", rules_dir)
    return rules