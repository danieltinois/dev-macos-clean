"""DevClean CLI presentation layer: human-readable and JSON output."""

from __future__ import annotations

import json

from devclean.core.format import format_ago, format_bytes
from devclean.core.models import ScanReport, Severity

CATEGORY_LABELS = {
    "node": "Node.js",
    "xcode": "Xcode",
    "android": "Android",
}
_LINE = "-" * 40


def render_human(report: ScanReport) -> str:
    lines = ["DevClean — developer storage analyzer", ""]
    if not report.findings:
        lines += ["Scan complete. No findings in the scanned roots.", ""]
    else:
        current: str | None = None
        for finding in report.findings:
            if finding.category != current:
                current = finding.category
                label = CATEGORY_LABELS.get(current, current.replace("-", " ").title())
                lines += [label, _LINE]
            lines.append("")
            lines.append(f"{finding.name} — {finding.path}")
            size = format_bytes(finding.size_bytes)
            if not finding.size_complete:
                size += " (partial)"
            lines.append(f"  Size:      {size}")
            if finding.last_modified:
                lines.append(f"  Modified:  {format_ago(finding.last_modified)}")
            lines.append(f"  Risk:      {finding.severity.value}")
            if finding.rebuild:
                lines.append(f"  Rebuild:   {finding.rebuild.description}")
            elif finding.reclaimable:
                lines.append("  Rebuild:   Regenerable.")
            if finding.metadata:
                pad = max(len(key) for key in finding.metadata) + 2
                for key, value in finding.metadata.items():
                    lines.append(f"  {(key + ':'):<{max(pad, 11)}}{value}")

    lines += ["", _LINE, f"Detected: {format_bytes(report.totals.bytes)} ({report.totals.findings} finding(s))"]
    for severity in Severity:
        lines.append(f"{severity.value}: {format_bytes(report.totals.by_severity.get(severity.value, 0))}")
    if report.warnings:
        lines += ["", "Warnings:"]
        lines += [f"  - {warning}" for warning in report.warnings]
    lines += ["", "DevClean only analyzes storage. Nothing was deleted."]
    return "\n".join(lines)


def report_to_json(report: ScanReport) -> str:
    """Stable machine-readable contract (findings + totals). Consumed by the future desktop UI."""
    return json.dumps(report.model_dump(mode="json"), indent=2, ensure_ascii=False)