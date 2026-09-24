"""Enrichment, classification and aggregation."""

from __future__ import annotations

from devclean.core import analyzer
from devclean.core.models import Finding, Rule, Severity

from conftest import build_tree


def _rule(severity: Severity = Severity.SAFE) -> Rule:
    return Rule(
        id="test-rule",
        name="Test",
        category="node",
        severity=severity,
        reclaimable=True,
        description="d",
        paths=["~/x"],
    )


def _finding(severity: Severity, category: str, size: int, path: str = "/tmp/x") -> Finding:
    return Finding(
        rule_id="test-rule",
        name="Test",
        category=category,
        severity=severity,
        reclaimable=True,
        description="d",
        path=path,
        size_bytes=size,
    )


def test_enrich_node_modules_package_managers(tmp_path):
    projects = tmp_path / "projects"
    build_tree(
        projects,
        {
            "npm/package.json": 1,
            "npm/package-lock.json": 1,
            "npm/node_modules/x": 1,
            "yarn/package.json": 1,
            "yarn/yarn.lock": 1,
            "yarn/node_modules/x": 1,
            "bare/node_modules/x": 1,
        },
    )

    def enriched(name: str) -> Finding:
        finding = Finding(
            rule_id="node-modules",
            name="Test",
            category="node",
            severity=Severity.SAFE,
            reclaimable=True,
            description="d",
            path=str(projects / name / "node_modules"),
            size_bytes=1,
        )
        analyzer.enrich(finding)
        return finding

    npm = enriched("npm")
    yarn = enriched("yarn")
    bare = enriched("bare")
    assert npm.metadata["package_manager"] == "npm"
    assert npm.metadata["lockfile"] == "package-lock.json"
    assert npm.metadata["package.json"] == "yes"
    assert yarn.metadata["package_manager"] == "yarn"
    assert bare.metadata["package_manager"] == "unknown"
    assert bare.metadata["package.json"] == "no"
    assert bare.metadata["lockfile"] == "none"


def test_classify_passes_through_declarative_severity():
    assert analyzer.classify(_rule(Severity.REVIEW)) == Severity.REVIEW
    assert analyzer.classify(_rule(Severity.DANGER)) == Severity.DANGER


def test_build_totals_aggregates():
    findings = [
        _finding(Severity.SAFE, "node", 100),
        _finding(Severity.REVIEW, "node", 200),
        _finding(Severity.DANGER, "xcode", 300),
        _finding(Severity.SAFE, "node", 50),
    ]
    totals = analyzer.build_totals(findings)
    assert totals.findings == 4
    assert totals.bytes == 650
    assert totals.by_severity == {"SAFE": 150, "REVIEW": 200, "DANGER": 300}
    assert totals.by_category == {"node": 350, "xcode": 300}