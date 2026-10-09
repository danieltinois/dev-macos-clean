#!/usr/bin/env node
// devclean CLI: analysis only, nothing is ever deleted from here.
const path = require('node:path');
const {parseArgs} = require('node:util');
const {loadRules, RuleError, SEVERITIES, scan, formatBytes, formatAgo} = require('../core/index.cjs');
const {version} = require('../package.json');

const CATEGORY_LABELS = {node: 'Node.js', xcode: 'Xcode', android: 'Android'};
const LINE = '-'.repeat(40);
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

function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? category.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase());
}

function renderHuman(report) {
  const lines = ['DevClean — developer storage analyzer', ''];
  if (!report.findings.length) lines.push('Scan complete. No findings in the scanned roots.', '');
  let current = null;
  for (const finding of report.findings) {
    if (finding.category !== current) {
      current = finding.category;
      lines.push(categoryLabel(current), LINE);
    }
    lines.push('', `${finding.name} — ${finding.path}`);
    lines.push(`  Size:      ${formatBytes(finding.size_bytes)}${finding.size_complete ? '' : ' (partial)'}`);
    if (finding.last_modified) lines.push(`  Modified:  ${formatAgo(new Date(finding.last_modified))}`);
    lines.push(`  Risk:      ${finding.severity}`);
    if (finding.rebuild) lines.push(`  Rebuild:   ${finding.rebuild.description}`);
    else if (finding.reclaimable) lines.push('  Rebuild:   Regenerable.');
    const keys = Object.keys(finding.metadata);
    const pad = Math.max(11, ...keys.map(key => key.length + 2));
    for (const key of keys) lines.push(`  ${(key + ':').padEnd(pad)}${finding.metadata[key]}`);
  }
  lines.push('', LINE, `Detected: ${formatBytes(report.totals.bytes)} (${report.totals.findings} finding(s))`);
  for (const severity of SEVERITIES) lines.push(`${severity}: ${formatBytes(report.totals.by_severity[severity] ?? 0)}`);
  if (report.warnings.length) lines.push('', 'Warnings:', ...report.warnings.map(warning => `  - ${warning}`));
  lines.push('', 'DevClean only analyzes storage. Nothing was deleted.');
  return lines.join('\n');
}

// Run the CLI with `argv` (without node and script). Returns the exit code.
function main(argv, {stdout = process.stdout, stderr = process.stderr} = {}) {
  let args;
  try {
    args = parseArgs({args: argv, allowPositionals: true, options: {
      global: {type: 'boolean'}, category: {type: 'string', short: 'c', multiple: true}, exclude: {type: 'string', multiple: true},
      'max-depth': {type: 'string'}, home: {type: 'string'}, json: {type: 'boolean'}, verbose: {type: 'boolean', short: 'v'},
      version: {type: 'boolean'}, help: {type: 'boolean', short: 'h'},
    }});
  } catch (error) {
    stderr.write(`error: ${error.message}\n\n${USAGE}\n`);
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

  let rules;
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

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {main, renderHuman};
