"""Filesystem helpers: size computation and constrained directory walking.

Performance/safety decisions (documented in the README):

* ``dir_size`` never follows symlinks (avoids loops and double-counting).
* ``iter_matches`` (pattern discovery) is a bounded BFS that never enters
  hidden dirs (``.git`` included), symlinks, known-heavy dirs, or a dir that
  already matched (so ``node_modules`` is never re-entered).
* Permission errors are counted and logged, never fatal.
* Sizes above a configurable entry cap are reported as truncated.
"""

from __future__ import annotations

import fnmatch
import glob as _glob
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

logger = logging.getLogger("devclean.fs")

# Directories never descended into during pattern discovery on a home directory.
# Hidden dirs are skipped separately, so this only lists public names.
SKIP_DIR_NAMES = frozenset(
    {
        "Library",
        "Applications",
        "Music",
        "Movies",
        "Pictures",
        "node_modules",
        "Pods",
        "DerivedData",
        "build",
        "target",
    }
)


@dataclass
class DirSize:
    """Result of measuring a path. ``bytes`` may be partial when truncated."""

    bytes: int
    errors: int = 0
    truncated: bool = False


def expand_path(entry: str, home: Path) -> Path:
    """Expand a leading ``~`` against *home* and environment variables."""
    if entry.startswith("~"):
        entry = str(home) + entry[1:]
    return Path(os.path.expandvars(entry))


def has_glob_magic(value: str) -> bool:
    return any(char in value for char in "*?[")


def mtime(path: Path) -> datetime | None:
    """UTC mtime of the path itself (a proxy for 'when was it last used')."""
    try:
        stamp = os.stat(path, follow_symlinks=False).st_mtime
    except OSError:
        return None
    return datetime.fromtimestamp(stamp, tz=timezone.utc)


def dir_size(path: Path, *, max_entries: int = 500_000, max_depth: int = 64) -> DirSize:
    """Total size of a directory in bytes.

    File symlinks are skipped, directory symlinks are never descended into.
    Per-entry errors are counted and the walk continues.
    """

    seen_entries = 0
    errors = 0
    truncated = False

    def walk(current: Path, depth: int) -> int:
        nonlocal seen_entries, errors, truncated
        if truncated or depth > max_depth:
            return 0
        total = 0
        try:
            iterator = os.scandir(current)
        except OSError:
            errors += 1
            return 0
        with iterator:
            try:
                for entry in iterator:
                    seen_entries += 1
                    if seen_entries > max_entries:
                        truncated = True
                        break
                    try:
                        if entry.is_symlink():
                            continue
                        if entry.is_dir(follow_symlinks=False):
                            total += walk(Path(entry.path), depth + 1)
                        else:
                            total += entry.stat(follow_symlinks=False).st_size
                    except OSError:
                        errors += 1
            except OSError:
                errors += 1
        return total

    return DirSize(walk(path, 0), errors, truncated)


def measure(path: Path, *, max_entries: int = 500_000, max_depth: int = 64) -> DirSize:
    """Size of a file or directory. Top-level symlinks are measured through once."""
    try:
        if path.is_dir():
            return dir_size(path, max_entries=max_entries, max_depth=max_depth)
        return DirSize(bytes=os.stat(path, follow_symlinks=False).st_size)
    except OSError:
        return DirSize(bytes=0, errors=1)


def excluded(path: Path, patterns: list[str]) -> bool:
    """True when the path matches any exclusion pattern (by basename or full path)."""
    if not patterns:
        return False
    full = os.path.normpath(str(path))
    return any(
        fnmatch.fnmatch(path.name, pattern)
        or fnmatch.fnmatch(full, pattern.replace("/", os.sep))
        for pattern in patterns
    )


def rule_pattern_matches(path: Path, pattern: str) -> bool:
    """Match a rule ``patterns`` entry against a discovered directory.

    * ``**/node_modules`` (leading ``**/``): match on the basename at any depth;
    * pattern containing ``/``: fnmatch against the full path;
    * anything else (e.g. ``node_modules``): match on the basename.
    """
    if pattern.startswith("**/"):
        return fnmatch.fnmatch(path.name, pattern[3:])
    if "/" not in pattern or pattern.startswith("*"):
        return fnmatch.fnmatch(path.name, pattern)
    return fnmatch.fnmatch(str(path), pattern.replace("/", os.sep))


def iter_matches(
    roots: list[Path],
    patterns: list[str],
    *,
    max_depth: int,
    max_dirs: int,
    excludes: list[str],
) -> Iterator[Path]:
    """Bounded BFS over *roots* yielding dirs matching any *pattern*.

    Never descends into hidden dirs, symlinks, excluded dirs,
    ``SKIP_DIR_NAMES`` dirs, or a dir that already matched.
    """

    visited = 0
    stack = [(root, 0) for root in reversed(roots)]
    while stack:
        visited += 1
        if visited > max_dirs:
            logger.warning("discovery walk exceeded %s dirs; stopping early", max_dirs)
            return
        path, depth = stack.pop()
        if excluded(path, excludes):
            continue
        if any(rule_pattern_matches(path, pattern) for pattern in patterns):
            yield path
            continue
        if depth >= max_depth:
            continue
        try:
            iterator = os.scandir(path)
        except OSError as exc:
            logger.warning("cannot read %s: %s", path, exc)
            continue
        with iterator:
            try:
                for entry in iterator:
                    try:
                        if entry.is_symlink():
                            continue
                        if not entry.is_dir(follow_symlinks=False):
                            continue
                    except OSError:
                        continue
                    if entry.name.startswith("."):
                        continue
                    child = Path(entry.path)
                    if excluded(child, excludes):
                        continue
                    # A matched child is yielded and never descended into
                    # (e.g. node_modules is never re-entered). This must run
                    # before the SKIP_DIR_NAMES check, which contains matches.
                    if any(rule_pattern_matches(child, pattern) for pattern in patterns):
                        yield child
                        continue
                    if entry.name in SKIP_DIR_NAMES:
                        continue
                    stack.append((child, depth + 1))
            except OSError as exc:
                logger.warning("cannot read %s: %s", path, exc)