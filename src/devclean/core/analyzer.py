"""Analysis: enrichment, classification and aggregation.

Discovery and measurement live in the scanner; this module adds specialized
Python logic per rule (via ``ENRICHERS``), classifies findings and builds
the report totals. The "discovery / analysis / presentation" separation
means a rule stays declarative until it genuinely needs code.
"""

from __future__ import annotations

import logging
from collections import Counter
from typing import Callable

from devclean.core.models import Finding, Rule, Severity, Totals

logger = logging.getLogger("devclean.analyzer")

_LOCKFILES: dict[str, str] = {
    "package-lock.json": "npm",
    "pnpm-lock.yaml": "pnpm",
    "yarn.lock": "yarn",
    "bun.lockb": "bun",
}


def classify(rule: Rule) -> Severity:
    """Risk classification of a rule's findings.

    Currently the declarative ``rule.severity`` is authoritative. Environment-
    aware escalation (e.g. an SDK that another tool depends on) hooks in here
    without touching the rule files.
    """
    return rule.severity


def enrich_node_modules(finding: Finding) -> None:
    """Attach parent-project information for node_modules findings."""
    project = finding.path.parent
    lockfile = next((name for name in _LOCKFILES if (project / name).is_file()), None)
    finding.metadata["project"] = str(project)
    finding.metadata["package.json"] = "yes" if (project / "package.json").is_file() else "no"
    finding.metadata["lockfile"] = lockfile or "none"
    finding.metadata["package_manager"] = _LOCKFILES.get(lockfile or "", "unknown")


# rule_id -> enricher. Contributors with specialized logic register here.
ENRICHERS: dict[str, Callable[[Finding], None]] = {
    "node-modules": enrich_node_modules,
}


def enrich(finding: Finding) -> None:
    """Run the specialized enricher for this finding, if any."""
    fn = ENRICHERS.get(finding.rule_id)
    if fn is None:
        return
    try:
        fn(finding)
    except OSError as exc:
        logger.warning("enrichment for %s failed: %s", finding.rule_id, exc)


def build_totals(findings: list[Finding]) -> Totals:
    """Aggregate sizes by severity and category."""
    by_severity: Counter[str] = Counter()
    by_category: Counter[str] = Counter()
    for finding in findings:
        by_severity[finding.severity.value] += finding.size_bytes
        by_category[finding.category] += finding.size_bytes
    ordered = {severity.value: by_severity.get(severity.value, 0) for severity in Severity}
    return Totals(
        findings=len(findings),
        bytes=sum(finding.size_bytes for finding in findings),
        by_severity=ordered,
        by_category=dict(sorted(by_category.items())),
    )