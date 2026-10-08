"""End-to-end scanner behavior: discovery, filters, caps, symlinks, permissions."""

from __future__ import annotations

import os
from collections import Counter
from pathlib import Path

import pytest

from devclean.core.models import Rule, Severity
from devclean.core.rules import load_rules
from devclean.core.scanner import ScanOptions, Scanner

from conftest import build_tree


def make_home(root: Path) -> Path:
    home = root / "home"
    build_tree(
        home,
        {
            "projects/a/package.json": 50,
            "projects/a/package-lock.json": 60,
            "projects/a/node_modules/pkg/index.js": 100,
            "projects/a/node_modules/pkg/dep.js": 100,
            "projects/b/package.json": 50,
            "projects/b/yarn.lock": 60,
            "projects/b/node_modules/x/y.js": 100,
            "projects/c/package.json": 50,
            # must never be discovered: hidden / vcs / already-matched dirs
            ".hidden/projects/h/node_modules/y": 10,
            ".git/something/node_modules/z": 10,
            "projects/a/node_modules/pkg/node_modules/internal/x": 10,
            # macOS-style paths probed directly by rules
            "Library/Developer/Xcode/DerivedData/App-abc/Build/x.app/one": 500,
            "Library/Caches/pnpm/store/v3/x": 44,
            "Library/Caches/Yarn/v6/x": 33,
            "Library/Android/sdk/system-images/android-35/arm64/system.img": 200,
            ".gradle/caches/modules-2/files/x/y/z.jar": 300,
            ".npm/_cacache/content-v2/x": 40,
            ".android/avd/pixel.avd/userdata-qemu.img": 50,
            ".android/avd/pixel.avd/emulator-user.ini": 20,
            ".android/avd/nexus.avd/config.ini": 20,
        },
    )
    return home


def scan(home: Path, **overrides):
    return Scanner(ScanOptions(home=home, **overrides)).run(load_rules())


def rule_counts(report) -> Counter[str]:
    return Counter(finding.rule_id for finding in report.findings)


def test_full_scan_detects_everything(tmp_path):
    report = scan(make_home(tmp_path))
    counts = rule_counts(report)
    assert counts == {
        "node-modules": 2,
        "npm-cache": 1,
        "pnpm-cache": 1,
        "yarn-cache": 1,
        "xcode-derived-data": 1,
        "gradle-cache": 1,
        "android-system-images": 1,
        "android-avds": 2,
    }
    # hidden dirs and .git are never entered; node_modules is never re-entered
    assert not any(".hidden" in str(f.path) or ".git" in str(f.path) for f in report.findings)
    for finding in report.findings:
        assert finding.last_modified is not None
    assert report.totals.findings == 10
    # 1517 = node 427 (a=210 incl. the nested internal file, b=100, caches 40+44+33)
    #        + xcode 500 + android 590 (gradle 300, images 200, avds 90)
    assert report.totals.bytes == 1517
    assert report.totals.by_severity == {"SAFE": 1227, "REVIEW": 290, "DANGER": 0}
    assert report.totals.by_category == {"node": 427, "xcode": 500, "android": 590}
    assert report.warnings == []


def test_category_filter(tmp_path):
    report = scan(make_home(tmp_path), categories={"node"})
    assert rule_counts(report) == {"node-modules": 2, "npm-cache": 1, "pnpm-cache": 1, "yarn-cache": 1}
    assert all(f.category == "node" for f in report.findings)


def test_excludes_skip_matching_targets(tmp_path):
    report = scan(make_home(tmp_path), excludes=["node_modules"])
    counts = rule_counts(report)
    assert counts["node-modules"] == 0
    assert counts["xcode-derived-data"] == 1


def test_max_depth_limits_pattern_discovery(tmp_path):
    report = scan(make_home(tmp_path), max_depth=2)
    counts = rule_counts(report)
    assert counts["node-modules"] == 0  # all node_modules live at depth 3
    assert counts["xcode-derived-data"] == 1  # path rules are unaffected


def test_max_findings_caps_and_warns(tmp_path):
    report = scan(make_home(tmp_path), max_findings=1)
    assert len(report.findings) == 1
    assert any("reached max findings" in warning for warning in report.warnings)


def test_scan_does_not_reenter_node_modules(tmp_path):
    home = tmp_path / "home"
    build_tree(home, {"p/node_modules/pkg/node_modules/internal/deep.js": 10})
    report = scan(home)
    assert rule_counts(report)["node-modules"] == 1
    assert report.findings[0].path == home / "p" / "node_modules"


def test_explicit_paths_win_over_patterns(tmp_path):
    home = tmp_path / "home"
    build_tree(home, {"projects/a/package.json": 50, "projects/a/node_modules/x": 100})
    target = home / "projects" / "a" / "node_modules"
    pattern_rule = Rule(
        id="node-modules",
        name="Node dependencies",
        category="node",
        severity=Severity.SAFE,
        reclaimable=True,
        description="d",
        patterns=["**/node_modules"],
    )
    path_rule = Rule(
        id="paths-rule",
        name="Explicit",
        category="node",
        severity=Severity.SAFE,
        reclaimable=True,
        description="d",
        paths=[str(target)],
    )
    report = Scanner(ScanOptions(home=home)).run([pattern_rule, path_rule])
    assert len(report.findings) == 1
    assert report.findings[0].rule_id == "paths-rule"


def test_explicit_root_matching_pattern_is_found(tmp_path):
    home = tmp_path / "home"
    build_tree(home, {"node_modules/x/y": 10})
    report = scan(home)
    assert rule_counts(report)["node-modules"] == 1
    assert report.findings[0].path == home / "node_modules"


def test_nonexistent_rule_paths_are_ignored(tmp_path):
    rule = Rule(
        id="missing",
        name="Missing",
        category="node",
        severity=Severity.SAFE,
        reclaimable=True,
        description="d",
        paths=["~/does/not/exist"],
    )
    report = Scanner(ScanOptions(home=tmp_path)).run([rule])
    assert report.findings == []
    assert report.warnings == []


def test_scan_tolerates_permission_errors(tmp_path, monkeypatch):
    home = make_home(tmp_path)
    real_scandir = os.scandir
    blocked = home / "projects" / "b"

    def fake_scandir(path, *args, **kwargs):
        if str(path) == str(blocked):
            raise PermissionError("denied")
        return real_scandir(path, *args, **kwargs)

    monkeypatch.setattr(os, "scandir", fake_scandir)
    report = scan(home)
    counts = rule_counts(report)
    assert counts["node-modules"] == 1  # project 'a' still found
    assert counts["xcode-derived-data"] == 1  # unrelated rules unaffected


def test_scan_is_symlink_loop_safe(tmp_path):
    home = tmp_path / "home"
    build_tree(home, {"projects/a/node_modules/x/y": 10})
    try:
        os.symlink(home, home / "projects" / "loop")
    except OSError as exc:
        pytest.skip(f"symlinks not available on this platform: {exc}")
    report = scan(home)
    assert rule_counts(report)["node-modules"] == 1  # completes, no duplicates


def test_extra_roots_are_scanned(tmp_path):
    home = tmp_path / "home"
    extra = tmp_path / "extra"
    build_tree(home, {"package.json": 10})
    build_tree(extra, {"side/node_modules/x": 100})
    report = scan(home, roots=[extra])
    assert report.roots == [str(home), str(extra)]
    assert any(str(f.path) == str(extra / "side" / "node_modules") for f in report.findings)

def test_global_scan_adds_disk_root_and_reports_scope(tmp_path, monkeypatch):
    home = make_home(tmp_path)
    visited = {}

    def discover(roots, patterns, **kwargs):
        visited["roots"] = roots
        visited["excludes"] = kwargs["excludes"]
        return iter(())

    monkeypatch.setattr("devclean.core.scanner.iter_matches", discover)
    original_iterdir = Path.iterdir
    monkeypatch.setattr(Path, "iterdir", lambda self: iter(()) if self == Path("/Users") else original_iterdir(self))
    report = Scanner(ScanOptions(home=home, global_scan=True)).run(load_rules())
    assert Path("/") in visited["roots"]
    assert "/System" in visited["excludes"]
    assert report.options["global_scan"] is True
    assert "user-app-caches" not in rule_counts(report)  # known cache rule keeps its identity


def test_markers_only_match_real_cargo_projects(tmp_path):
    home = tmp_path / "home"
    build_tree(
        home,
        {
            "code/crate/Cargo.toml": 10,
            "code/crate/target/debug/app": 400,
            "code/web/target/output.txt": 20,  # no Cargo.toml: not a Rust build
        },
    )
    report = scan(home, categories={"rust"})
    targets = [f for f in report.findings if f.rule_id == "rust-target"]
    assert [f.path for f in targets] == [home / "code/crate/target"]
    assert targets[0].size_bytes == 400
    assert targets[0].metadata["Cargo.toml"] == "yes"


def test_new_developer_caches_are_detected(tmp_path):
    home = tmp_path / "home"
    build_tree(
        home,
        {
            "Library/Developer/Xcode/iOS DeviceSupport/17.0/Symbols/x": 70,
            "Library/Developer/CoreSimulator/Devices/ABC/data/x": 30,
            "Library/Caches/CocoaPods/Pods/x": 20,
            "Library/Caches/go-build/aa/x": 10,
            "Library/Caches/JetBrains/IntelliJIdea2024.1/x": 15,
            "Library/Caches/ms-playwright/chromium-1/x": 25,
            ".bun/install/cache/x": 5,
        },
    )
    by_rule = {f.rule_id: f for f in scan(home).findings}
    assert by_rule["xcode-device-support"].severity == Severity.SAFE
    assert by_rule["ios-simulators"].severity == Severity.REVIEW
    for rule_id in ("cocoapods-cache", "go-build-cache", "jetbrains-caches", "playwright-browsers", "bun-cache"):
        assert by_rule[rule_id].severity == Severity.SAFE
    # Specific caches win over the generic per-app cache rule.
    generic = {f.path.name for f in scan(home).findings if f.rule_id == "user-app-caches"}
    assert not generic & {"CocoaPods", "go-build", "JetBrains", "ms-playwright"}
