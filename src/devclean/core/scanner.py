"""Scan orchestration: discovery -> measurement -> classification -> aggregation.

Explicit rule paths are probed first (cheap, most specific). Pattern rules
then drive one bounded BFS over the scan roots. Nothing here ever deletes.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from glob import glob as fs_glob
from pathlib import Path

from devclean.core import analyzer
from devclean.core.filesystem import (
    excluded,
    expand_path,
    has_glob_magic,
    iter_matches,
    measure,
    mtime,
    rule_pattern_matches,
)
from devclean.core.models import Finding, Rule, ScanReport, Totals

logger = logging.getLogger("devclean.scanner")


@dataclass
class ScanOptions:
    roots: list[Path] = field(default_factory=list)
    categories: set[str] | None = None
    excludes: list[str] = field(default_factory=list)
    max_depth: int = 6
    max_dirs: int = 25_000
    max_findings: int = 200
    max_entries: int = 500_000
    home: Path | None = None


class Scanner:
    def __init__(self, options: ScanOptions) -> None:
        self.options = options

    def run(self, rules: list[Rule]) -> ScanReport:
        opts = self.options
        warnings: list[str] = []

        selected = [rule for rule in rules if self._included(rule)]
        if not selected:
            warnings.append("no rules match the requested categories; nothing to scan")

        home = opts.home or Path.home()
        roots = list(dict.fromkeys([home, *opts.roots]))
        scan_roots: list[Path] = []
        for root in roots:
            if root.is_dir():
                scan_roots.append(root)
            else:
                warnings.append(f"scan root does not exist or is not a directory: {root}")

        findings: list[Finding] = []
        seen: dict[str, str] = {}  # normalized target path -> rule_id (keeps first match)
        pattern_rules = [rule for rule in selected if rule.patterns]

        # 1. Explicit rule paths (most specific, no walking required).
        for rule in selected:
            if len(findings) >= opts.max_findings:
                break
            for target in self._explicit_targets(rule, home):
                self._add_finding(target, rule, seen, findings, warnings, opts)
                if len(findings) >= opts.max_findings:
                    warnings.append(f"reached max findings ({opts.max_findings}); scan stopped early")
                    break

        # 2. Pattern discovery over the scan roots (bounded BFS).
        if pattern_rules and len(findings) < opts.max_findings:
            all_patterns = sorted({p for rule in pattern_rules for p in rule.patterns})
            for target in iter_matches(
                scan_roots,
                all_patterns,
                max_depth=opts.max_depth,
                max_dirs=opts.max_dirs,
                excludes=opts.excludes,
            ):
                if len(findings) >= opts.max_findings:
                    warnings.append(f"reached max findings ({opts.max_findings}); scan stopped early")
                    break
                rule = self._rule_for(target, pattern_rules)
                if rule is None:
                    continue
                self._add_finding(target, rule, seen, findings, warnings, opts)

        for finding in findings:
            analyzer.enrich(finding)

        findings.sort(key=lambda f: (f.category, f.name, str(f.path)))
        totals = analyzer.build_totals(findings)
        return ScanReport(
            scanned_at=datetime.now(timezone.utc),
            roots=[str(root) for root in scan_roots],
            options={
                "max_depth": opts.max_depth,
                "max_findings": opts.max_findings,
                "excludes": list(opts.excludes),
                "categories": sorted(opts.categories or []),
            },
            totals=totals,
            findings=findings,
            warnings=warnings,
        )

    def _included(self, rule: Rule) -> bool:
        categories = self.options.categories
        return categories is None or rule.category in categories

    def _explicit_targets(self, rule: Rule, home: Path):
        for entry in rule.paths:
            expanded = expand_path(entry, home)
            if not has_glob_magic(entry):
                if os.path.lexists(expanded):
                    yield expanded
                else:
                    logger.debug("rule %s: path not found: %s", rule.id, expanded)
                continue
            for match in fs_glob(str(expanded)):
                yield Path(match)

    @staticmethod
    def _rule_for(target: Path, pattern_rules: list[Rule]) -> Rule | None:
        for rule in pattern_rules:
            if any(rule_pattern_matches(target, pattern) for pattern in rule.patterns):
                return rule
        return None

    def _add_finding(
        self,
        target: Path,
        rule: Rule,
        seen: dict[str, str],
        findings: list[Finding],
        warnings: list[str],
        opts: ScanOptions,
    ) -> None:
        if excluded(target, opts.excludes):
            logger.debug("excluding %s", target)
            return
        try:
            key = os.path.normcase(str(target.resolve()))
        except OSError:
            key = os.path.normcase(str(target))
        if key in seen:
            logger.debug("duplicate target %s (kept rule %s)", target, seen[key])
            return

        measured = measure(target, max_entries=opts.max_entries)
        if measured.errors:
            warnings.append(f"errors while measuring {target} ({measured.errors} error(s))")
        seen[key] = rule.id
        findings.append(
            Finding(
                rule_id=rule.id,
                name=rule.name,
                category=rule.category,
                severity=rule.severity,
                reclaimable=rule.reclaimable,
                description=rule.description,
                rebuild=rule.rebuild,
                path=target,
                size_bytes=measured.bytes,
                size_complete=not measured.truncated,
                last_modified=mtime(target),
            )
        )