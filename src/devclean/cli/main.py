"""devclean CLI entry point."""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from devclean import __version__
from devclean.cli.output import render_human, report_to_json
from devclean.core.rules import RuleError, load_rules
from devclean.core.scanner import ScanOptions, Scanner

LOG_FORMAT = "%(levelname)s %(name)s: %(message)s"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="devclean",
        description="Analyze macOS developer storage: what uses space and what can be reclaimed.",
    )
    parser.add_argument("--version", action="version", version=f"devclean {__version__}")
    subparsers = parser.add_subparsers(dest="command", required=True, metavar="COMMAND")
    scan = subparsers.add_parser(
        "scan",
        help="scan the developer environment (analysis only, nothing is deleted)",
    )
    scan.add_argument(
        "roots",
        nargs="*",
        metavar="ROOT",
        help="extra directories to scan in addition to the home directory",
    )
    scan.add_argument(
        "--category",
        "-c",
        action="append",
        metavar="CATEGORY",
        help="only scan rules of this category (repeatable)",
    )
    scan.add_argument(
        "--exclude",
        action="append",
        metavar="PATTERN",
        help="skip paths matching a glob pattern (repeatable)",
    )
    scan.add_argument(
        "--max-depth",
        type=int,
        default=6,
        metavar="N",
        help="maximum depth for pattern discovery (default: 6)",
    )
    scan.add_argument(
        "--home",
        type=Path,
        default=None,
        metavar="DIR",
        help="home directory used to expand ~ in rules (default: actual home)",
    )
    scan.add_argument(
        "--json",
        action="store_true",
        help="print results as JSON (stable machine-readable contract)",
    )
    scan.add_argument("--verbose", "-v", action="store_true", help="debug logging")
    return parser


def _cmd_scan(args: argparse.Namespace) -> int:
    try:
        rules = load_rules()
    except RuleError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    options = ScanOptions(
        roots=[Path(root) for root in args.roots],
        categories=set(args.category) if args.category else None,
        excludes=args.exclude or [],
        max_depth=args.max_depth,
        home=args.home,
    )
    report = Scanner(options).run(rules)
    output = report_to_json(report) if args.json else render_human(report)
    print(output)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if getattr(args, "verbose", False) else logging.WARNING,
        format=LOG_FORMAT,
    )
    if args.command == "scan":
        return _cmd_scan(args)
    parser.error(f"unknown command: {args.command}")
    return 2  # pragma: no cover - required subparsers make this unreachable