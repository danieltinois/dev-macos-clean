"""Size computation, exclusions, symlinks, permission errors and formatters."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from devclean.core.filesystem import (
    dir_size,
    excluded,
    expand_path,
    iter_matches,
    measure,
)
from devclean.core.format import format_ago, format_bytes

from conftest import build_tree, make_file


def test_dir_size_sums_files(tmp_path):
    build_tree(tmp_path, {"a.txt": 1000, "sub/b.bin": 2000, "sub/deep/c": 500})
    result = dir_size(tmp_path)
    assert result.bytes == 3500
    assert result.errors == 0
    assert result.truncated is False


def test_dir_size_empty_directory_is_zero(tmp_path):
    result = dir_size(tmp_path)
    assert result.bytes == 0
    assert result.errors == 0


def test_measure_handles_file_target(tmp_path):
    path = make_file(tmp_path / "f.bin", 1234)
    result = measure(path)
    assert result.bytes == 1234
    assert result.errors == 0


def test_measure_missing_path_reports_error(tmp_path):
    result = measure(tmp_path / "nope")
    assert result.bytes == 0
    assert result.errors == 1


def test_dir_size_respects_entry_cap(tmp_path):
    build_tree(tmp_path, {f"file{i}.bin": 100 for i in range(10)})
    result = dir_size(tmp_path, max_entries=3)
    assert result.truncated is True
    assert 0 < result.bytes < 1000


def test_dir_size_does_not_follow_symlinks(tmp_path, tmp_symlink):
    (tmp_path / "real").mkdir()
    make_file(tmp_path / "real" / "big.bin", 5000)
    os.symlink(tmp_path / "real", tmp_path / "loop")
    result = dir_size(tmp_path)
    assert result.bytes == 0  # only a symlink was created inside; nothing dereferenced


def test_dir_size_tolerates_permission_errors(tmp_path, monkeypatch):
    make_file(tmp_path / "ok.bin", 300)
    blocked = tmp_path / "blocked"
    blocked.mkdir()
    make_file(blocked / "secret.bin", 5000)

    real_scandir = os.scandir

    def fake_scandir(path, *args, **kwargs):
        if str(path) == str(blocked):
            raise PermissionError("denied")
        return real_scandir(path, *args, **kwargs)

    monkeypatch.setattr(os, "scandir", fake_scandir)
    result = dir_size(tmp_path)
    assert result.bytes == 300
    assert result.errors == 1


def test_excluded_by_basename_and_full_path(tmp_path):
    target = tmp_path / "projects" / "a" / "node_modules"
    assert excluded(target, ["node_modules"]) is True
    assert excluded(target, [str(target)]) is True
    assert excluded(target, ["other"]) is False


def test_expand_path_uses_injected_home(tmp_path):
    home = tmp_path / "home"
    assert expand_path("~", home) == home
    assert expand_path("~/Library/Caches/Yarn", home) == home / "Library" / "Caches" / "Yarn"
    assert expand_path("/abs/path", home) == Path("/abs/path")


def test_iter_matches_finds_and_does_not_descend(tmp_path):
    build_tree(
        tmp_path,
        {
            "projects/a/node_modules/pkg/one.js": 10,
            "projects/a/node_modules/pkg/two.js": 10,
            "projects/b/node_modules/x/y.js": 10,
        },
    )
    matches = sorted(iter_matches([tmp_path], ["**/node_modules"], max_depth=6, max_dirs=1000, excludes=[]))
    assert matches == sorted([tmp_path / "projects/a/node_modules", tmp_path / "projects/b/node_modules"])
    # matched dirs yield once and are not re-entered -> exactly two entries


def test_iter_matches_skips_hidden_and_heavy_dirs(tmp_path):
    build_tree(
        tmp_path,
        {
            ".hidden/node_modules/h": 10,
            ".git/node_modules/g": 10,
            "Library/node_modules/lib": 10,
            "visible/node_modules/v": 10,
        },
    )
    matches = list(iter_matches([tmp_path], ["**/node_modules"], max_depth=6, max_dirs=1000, excludes=[]))
    assert matches == [tmp_path / "visible" / "node_modules"]


def test_iter_matches_respects_max_depth(tmp_path):
    build_tree(
        tmp_path,
        {
            "lvl1/lvl2/lvl3/node_modules/deep": 10,
            "lvl1/lvl2/node_modules/mid": 10,
        },
    )
    # both node_modules live at depth >= 3; with max_depth=2 they are not reached
    matches = list(iter_matches([tmp_path], ["**/node_modules"], max_depth=2, max_dirs=1000, excludes=[]))
    assert matches == []
    deep = list(iter_matches([tmp_path], ["**/node_modules"], max_depth=3, max_dirs=1000, excludes=[]))
    assert deep == [tmp_path / "lvl1" / "lvl2" / "node_modules"]


def test_iter_matches_is_symlink_loop_safe(tmp_path, tmp_symlink):
    build_tree(tmp_path, {"p/node_modules/only/x": 10})
    (tmp_path / "p").mkdir(exist_ok=True)
    os.symlink(tmp_path, tmp_path / "p" / "back-to-root")
    matches = list(iter_matches([tmp_path], ["**/node_modules"], max_depth=6, max_dirs=1000, excludes=[]))
    assert matches == [tmp_path / "p" / "node_modules"]  # no hang, no duplicates


def test_iter_matches_applies_excludes(tmp_path):
    build_tree(tmp_path, {"a/node_modules/x": 10, "b/node_modules/x": 10})
    matches = list(
        iter_matches([tmp_path], ["**/node_modules"], max_depth=6, max_dirs=1000, excludes=["*/a/node_modules"])
    )
    assert matches == [tmp_path / "b" / "node_modules"]


@pytest.mark.parametrize(
    ("size", "expected"),
    [
        (0, "0 B"),
        (512, "512 B"),
        (1023, "1023 B"),
        (1024, "1 KB"),
        (842 * 1024 * 1024, "842 MB"),
        (int(2.4 * 1024 * 1024 * 1024), "2.4 GB"),
        (int(31.17 * 1024 * 1024 * 1024), "31.2 GB"),
    ],
)
def test_format_bytes(size, expected):
    assert format_bytes(size) == expected


def test_format_bytes_rejects_negative():
    with pytest.raises(ValueError):
        format_bytes(-1)


def test_format_ago_boundaries():
    now = datetime(2026, 9, 24, 12, 0, tzinfo=timezone.utc)
    assert format_ago(now - timedelta(seconds=30), now) == "just now"
    assert format_ago(now - timedelta(minutes=1), now) == "1 minute ago"
    assert format_ago(now - timedelta(minutes=90), now) == "1 hour ago"
    assert format_ago(now - timedelta(hours=5), now) == "5 hours ago"
    assert format_ago(now - timedelta(days=3), now) == "3 days ago"
    assert format_ago(now - timedelta(weeks=2), now) == "2 weeks ago"
    assert format_ago(now - timedelta(days=100), now) == "3 months ago"
    assert format_ago(now - timedelta(days=400), now) == "1 year ago"
    assert format_ago(now + timedelta(minutes=5), now) == "in the future"