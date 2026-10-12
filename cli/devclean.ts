#!/usr/bin/env bun
// devclean CLI: analysis only, nothing is ever deleted from here.
import path from 'node:path';
import {parseArgs} from 'node:util';
import {loadRules, RuleError, SEVERITIES, scan, formatBytes, formatAgo, BANNER, bar, type Report, type Rule} from '../core';
import {version} from '../package.json';

interface Output {write(text: string): unknown}

const CATEGORY_LABELS: Record<string, string> = {node: 'Node.js', xcode: 'Xcode', android: 'Android'};
const WIDTH = 52;
const LINE = '─'.repeat(WIDTH);
const USAGE = `usage: devclean scan [ROOT ...] [options]

Analyze macOS developer storage: what uses space and what can be reclaimed.

  ROOT                   extra directories to scan in addition to the home directory
  --global               discover developer artifacts across local macOS directories
  -c, --category NAME    only scan rules of this category (repeatable)
  --exclude PATTERN      skip paths matching a glob pattern (repeatable)
  --max-depth N          maximum depth for pattern discovery (default: 6)
  --home DIR             home directory used to expand ~ in rules (default: actual home)
  --json                 print results as JSON (stable machine-readable contract)
  -v, --verbose          debug logging
  --version              show the version
  -h, --help             show this help`;

function categoryLabel(category: string) {
  return CATEGORY_LABELS[category] ?? category.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

// `Label ──────…` section header, padded to the banner width.
function heading(label: string) {return `${label} ${'─'.repeat(Math.max(3, WIDTH - label.length - 1))}`;}

// `  label   ████░░░░  1.2 GB` rows sharing one scale.
function bars(entries: [string, number][]) {
  const max = Math.max(0, ...entries.map(([, bytes]) => bytes));
  const pad = Math.max(...entries.map(([label]) => label.length)) + 2;
  return entries.map(([label, bytes]) => `  ${label.padEnd(pad)}${bar(bytes, max, 24)}  ${formatBytes(bytes)}`);
}

export function renderHuman(report: Report): string {
  const lines = [BANNER, '', 'developer storage analyzer · macOS', ''];
  if (!report.findings.length) lines.push('Scan complete. No findings in the scanned roots.', '');
  const largest = Math.max(0, ...report.findings.map(finding => finding.size_bytes));
  let current: string | null = null;
  for (const finding of report.findings) {
    if (finding.category !== current) {
      if (current !== null) lines.push('');
      current = finding.category;
      lines.push(heading(categoryLabel(current)));
    }
    lines.push('', `${finding.name} — ${finding.path}`);
    lines.push(`  Size:      ${bar(finding.size_bytes, largest, 16)}  ${formatBytes(finding.size_bytes)}${finding.size_complete ? '' : ' (partial)'}`);
    if (finding.last_modified) lines.push(`  Modified:  ${formatAgo(new Date(finding.last_modified))}`);
    lines.push(`  Risk:      ${finding.severity}`);
    if (finding.rebuild) lines.push(`  Rebuild:   ${finding.rebuild.description}`);
    else if (finding.reclaimable) lines.push('  Rebuild:   Regenerable.');
    const keys = Object.keys(finding.metadata);
    const pad = Math.max(11, ...keys.map(key => key.length + 2));
    for (const key of keys) lines.push(`  ${(key + ':').padEnd(pad)}${finding.metadata[key]}`);
  }
  if (report.findings.length) {
    lines.push('', heading('By category'), ...bars(Object.entries(report.totals.by_category).map(([category, bytes]) => [categoryLabel(category), bytes])));
    lines.push('', heading('By risk'), ...bars(SEVERITIES.map(severity => [`${severity}:`, report.totals.by_severity[severity] ?? 0])));
  }
  lines.push('', LINE, `Detected: ${formatBytes(report.totals.bytes)} (${report.totals.findings} finding(s))`);
  if (report.warnings.length) lines.push('', 'Warnings:', ...report.warnings.map(warning => `  - ${warning}`));
  lines.push('', 'DevClean only analyzes storage. Nothing was deleted.');
  return lines.join('\n');
}

// Run the CLI with `argv` (without the runtime and script). Returns the exit code.
export function main(argv: string[], {stdout = process.stdout as Output, stderr = process.stderr as Output} = {}): number {
  let args;
  try {
    args = parseArgs({args: argv, allowPositionals: true, options: {
      global: {type: 'boolean'}, category: {type: 'string', short: 'c', multiple: true}, exclude: {type: 'string', multiple: true},
      'max-depth': {type: 'string'}, home: {type: 'string'}, json: {type: 'boolean'}, verbose: {type: 'boolean', short: 'v'},
      version: {type: 'boolean'}, help: {type: 'boolean', short: 'h'},
    }});
  } catch (error) {
    stderr.write(`error: ${(error as Error).message}\n\n${USAGE}\n`);
    return 2;
  }
  const {values, positionals: [command, ...roots]} = args;
  if (values.version) {stdout.write(`devclean ${version}\n`); return 0;}
  if (values.help) {stdout.write(`${USAGE}\n`); return 0;}
  if (command !== 'scan') {
    stderr.write(`${command ? `error: unknown command: ${command}\n\n` : ''}${USAGE}\n`);
    return 2;
  }
  const maxDepth = values['max-depth'] === undefined ? 6 : Number(values['max-depth']);
  if (!Number.isInteger(maxDepth) || maxDepth < 0) {stderr.write('error: --max-depth must be a non-negative integer\n'); return 2;}

  let rules: Rule[];
  try {rules = loadRules();} catch (error) {
    if (!(error instanceof RuleError)) throw error;
    stderr.write(`error: ${error.message}\n`);
    return 2;
  }
  const report = scan(rules, {
    roots, categories: values.category, excludes: values.exclude ?? [], maxDepth,
    home: values.home && path.resolve(values.home), globalScan: values.global === true,
    log: values.verbose ? message => stderr.write(`DEBUG ${message}\n`) : undefined,
  });
  stdout.write(`${values.json ? JSON.stringify(report, null, 2) : renderHuman(report)}\n`);
  return 0;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
