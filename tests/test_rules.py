"""Rule parsing and validation."""

from __future__ import annotations

import pytest

from devclean.core.models import Severity
from devclean.core.rules import RuleError, load_rules

EXPECTED_IDS = {
    "node-modules",
    "npm-cache",
    "pnpm-cache",
    "yarn-cache",
    "xcode-derived-data",
    "gradle-cache",
    "android-system-images",
    "android-avds",
}


def test_loads_all_packaged_rules(packaged_rules):
    assert len(packaged_rules) >= len(EXPECTED_IDS)
    ids = [rule.id for rule in packaged_rules]
    assert len(ids) == len(set(ids)), "rule ids must be unique"
    assert EXPECTED_IDS <= set(ids)


def test_node_modules_rule_is_pattern_based(packaged_rules):
    rule = next(rule for rule in packaged_rules if rule.id == "node-modules")
    assert rule.patterns == ["**/node_modules"]
    assert rule.severity == Severity.SAFE
    assert rule.reclaimable is True
    assert rule.rebuild is not None


def test_avd_rule_uses_glob_path(packaged_rules):
    rule = next(rule for rule in packaged_rules if rule.id == "android-avds")
    assert any("*.avd" in path for path in rule.paths)
    assert rule.severity == Severity.REVIEW
    assert rule.reclaimable is False


def test_invalid_severity_rejected(tmp_path):
    (tmp_path / "bad.yaml").write_text(
        "id: x\nname: X\ncategory: c\nseverity: VERY_SAFE\nreclaimable: true\ndescription: d\npaths: ['/x']\n",
        encoding="utf-8",
    )
    with pytest.raises(RuleError, match="severity"):
        load_rules(tmp_path)


def test_unknown_key_rejected(tmp_path):
    (tmp_path / "bad.yaml").write_text(
        "id: x\nname: X\ncategory: c\nseverity: SAFE\nreclaimable: true\ndescription: d\npaths: ['/x']\ntypo_field: 1\n",
        encoding="utf-8",
    )
    with pytest.raises(RuleError, match="typofield|typo_field"):
        load_rules(tmp_path)


def test_rule_without_target_rejected(tmp_path):
    (tmp_path / "bad.yaml").write_text(
        "id: x\nname: X\ncategory: c\nseverity: SAFE\nreclaimable: true\ndescription: d\n",
        encoding="utf-8",
    )
    with pytest.raises(RuleError, match="paths or patterns"):
        load_rules(tmp_path)


def test_duplicate_ids_rejected(tmp_path):
    body = "id: dup\nname: X\ncategory: c\nseverity: SAFE\nreclaimable: true\ndescription: d\npaths: ['/x']\n"
    (tmp_path / "a.yaml").write_text(body, encoding="utf-8")
    (tmp_path / "b.yaml").write_text(body, encoding="utf-8")
    with pytest.raises(RuleError, match="duplicate rule ids"):
        load_rules(tmp_path)


def test_missing_rules_directory_raises(tmp_path):
    with pytest.raises(RuleError, match="rules directory not found"):
        load_rules(tmp_path / "does-not-exist")