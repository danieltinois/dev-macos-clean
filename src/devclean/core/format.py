"""Human-friendly formatting. Bytes are always the source of truth internally."""

from __future__ import annotations

from datetime import datetime, timezone

_UNITS = ("B", "KB", "MB", "GB", "TB", "PB")


def format_bytes(size: int) -> str:
    """Format byte counts like ``842 MB``, ``2.4 GB``, ``31.7 GB`` (binary units)."""
    if size < 0:
        raise ValueError(f"negative size: {size}")
    value = float(size)
    unit = 0
    while value >= 1024 and unit < len(_UNITS) - 1:
        value /= 1024
        unit += 1
    if unit == 0:
        return f"{int(value)} B"
    return f"{value:.1f}".rstrip("0").rstrip(".") + " " + _UNITS[unit]


def format_ago(when: datetime, now: datetime | None = None) -> str:
    """Relative time like ``3 months ago`` (``now`` injectable for tests)."""
    now = now or datetime.now(timezone.utc)
    seconds = (now - when).total_seconds()
    if seconds < 0:
        return "in the future"
    if seconds < 60:
        return "just now"
    minutes = seconds / 60
    if minutes < 60:
        count = int(minutes)
        return f"{count} minute{'s' if count != 1 else ''} ago"
    hours = minutes / 60
    if hours < 24:
        count = int(hours)
        return f"{count} hour{'s' if count != 1 else ''} ago"
    days = hours / 24
    if days < 7:
        count = int(days)
        return f"{count} day{'s' if count != 1 else ''} ago"
    weeks = days / 7
    if weeks < 5:
        count = int(weeks)
        return f"{count} week{'s' if count != 1 else ''} ago"
    months = days / 30.44
    if months < 12:
        count = int(months)
        return f"{count} month{'s' if count != 1 else ''} ago"
    years = days / 365.25
    count = int(years)
    return f"{count} year{'s' if count != 1 else ''} ago"