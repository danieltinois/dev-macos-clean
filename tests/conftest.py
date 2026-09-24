"""Shared test fixtures and helpers. No test depends on the real machine home."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from devclean.core.rules import load_rules


def make_file(path: Path, size: int) -> Path:
    """Create a file of exactly *size* bytes (sparse write, fast)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as handle:
        handle.seek(size - 1)
        handle.write(b"\0")
    return path


def build_tree(base: Path, spec: dict[str, int | None]) -> None:
    """Build a tree from {relative_path: size_bytes}; None means empty directory."""
    for rel, size in spec.items():
        path = base / rel
        if size is None:
            path.mkdir(parents=True, exist_ok=True)
        else:
            make_file(path, size)


@pytest.fixture(scope="session")
def packaged_rules():
    return load_rules()


@pytest.fixture()
def tmp_symlink(tmp_path):
    """Return a (link, target) pair, skipping the test when symlinks are unavailable."""
    target = tmp_path / "link-target"
    link = tmp_path / "link"
    try:
        os.symlink(target, link)
    except OSError as exc:
        pytest.skip(f"symlinks not available on this platform: {exc}")
    return link, target