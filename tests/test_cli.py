"""CLI: exit codes, human output and the stable JSON contract."""

from __future__ import annotations

import json
from pathlib import Path

from devclean.cli.main import main

from conftest import build_tree


def make_home(root: Path) -> Path:
    home = root / "home"
    build_tree(
        home,
        {
            "projects/a/package.json": 50,
            "projects/a/package-lock.json": 60,
            "projects/a/node_modules/pkg/index.js": 100,
            "Library/Developer/Xcode/DerivedData/App/Build/x.app/one": 500,
            ".android/avd/pixel.avd/userdata-qemu.img": 20,
        },
    )
    return home


REQUIRED_FINDING_KEYS = {
    "rule_id",
    "name",
    "category",
    "severity",
    "reclaimable",
    "description",
    "path",
    "size_bytes",
    "size_complete",
    "last_modified",
    "rebuild",
    "metadata",
}


def test_json_contract(tmp_path, capsys):
    home = make_home(tmp_path)
    code = main(["scan", "--home", str(home), "--json"])
    assert code == 0
    data = json.loads(capsys.readouterr().out)

    assert data["schema_version"] == 1
    assert data["scanned_at"]
    assert data["roots"] == [str(home)]
    assert data["totals"]["findings"] == 3
    assert data["totals"]["bytes"] == 620
    assert data["totals"]["by_severity"] == {"SAFE": 600, "REVIEW": 20, "DANGER": 0}
    for finding in data["findings"]:
        assert REQUIRED_FINDING_KEYS <= finding.keys()

    node = next(f for f in data["findings"] if f["rule_id"] == "node-modules")
    assert node["metadata"]["package_manager"] == "npm"
    assert node["metadata"]["package.json"] == "yes"
    assert node["last_modified"] is not None
    avd = next(f for f in data["findings"] if f["rule_id"] == "android-avds")
    assert avd["severity"] == "REVIEW"
    assert avd["reclaimable"] is False


def test_human_output(tmp_path, capsys):
    home = make_home(tmp_path)
    code = main(["scan", "--home", str(home)])
    assert code == 0
    out = capsys.readouterr().out
    assert "Node.js" in out
    assert "Xcode" in out
    assert "Android" in out
    assert "Risk:      SAFE" in out
    assert "Risk:      REVIEW" in out
    assert "100 B" in out
    assert "Detected:" in out
    assert "SAFE: " in out
    assert "Nothing was deleted." in out


def test_category_filter_via_cli(tmp_path, capsys):
    home = make_home(tmp_path)
    code = main(["scan", "--home", str(home), "--category", "node", "--json"])
    assert code == 0
    data = json.loads(capsys.readouterr().out)
    assert data["findings"]
    assert all(f["category"] == "node" for f in data["findings"])


def test_exclude_via_cli(tmp_path, capsys):
    home = make_home(tmp_path)
    code = main(["scan", "--home", str(home), "--exclude", "node_modules", "--json"])
    assert code == 0
    data = json.loads(capsys.readouterr().out)
    assert all(f["rule_id"] != "node-modules" for f in data["findings"])


def test_unknown_category_yields_empty_report(tmp_path, capsys):
    home = make_home(tmp_path)
    code = main(["scan", "--home", str(home), "--category", "nonsense"])
    assert code == 0
    out = capsys.readouterr().out
    assert "No findings" in out
    assert "Nothing was deleted." in out


def test_scan_with_extra_root(tmp_path, capsys):
    home = make_home(tmp_path)
    extra = tmp_path / "extra"
    build_tree(extra, {"side/node_modules/x/y": 100})
    code = main(["scan", "--home", str(home), str(extra), "--json"])
    assert code == 0
    data = json.loads(capsys.readouterr().out)
    assert data["roots"] == [str(home), str(extra)]
    assert data["totals"]["bytes"] == 720