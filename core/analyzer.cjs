// Analysis: enrichment, classification and aggregation.
//
// Discovery and measurement live in the scanner; this module adds specialized
// logic per rule (via ENRICHERS) and builds the report totals. A rule stays
// declarative until it genuinely needs code.
const path = require('node:path');
const {isFile} = require('./filesystem.cjs');
const {SEVERITIES} = require('./rules.cjs');

const LOCKFILES = {'package-lock.json': 'npm', 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lockb': 'bun'};

// Risk classification of a rule's findings. The declarative severity is
// authoritative for now; environment-aware escalation hooks in here.
function classify(rule) {return rule.severity;}

// Attach parent-project information for node_modules findings.
function enrichNodeModules(finding) {
  const project = path.dirname(finding.path);
  const lockfile = Object.keys(LOCKFILES).find(name => isFile(path.join(project, name)));
  finding.metadata.project = project;
  finding.metadata['package.json'] = isFile(path.join(project, 'package.json')) ? 'yes' : 'no';
  finding.metadata.lockfile = lockfile ?? 'none';
  finding.metadata.package_manager = LOCKFILES[lockfile] ?? 'unknown';
}

// Attach the Cargo project that owns a `target` directory.
function enrichCargoTarget(finding) {
  const project = path.dirname(finding.path);
  finding.metadata.project = project;
  finding.metadata['Cargo.toml'] = isFile(path.join(project, 'Cargo.toml')) ? 'yes' : 'no';
}

// rule_id -> enricher. Rules with specialized logic register here.
const ENRICHERS = {'node-modules': enrichNodeModules, 'rust-target': enrichCargoTarget};

function enrich(finding) {ENRICHERS[finding.rule_id]?.(finding);}

// Aggregate sizes by severity and category.
function buildTotals(findings) {
  const bySeverity = Object.fromEntries(SEVERITIES.map(severity => [severity, 0]));
  const byCategory = {};
  let bytes = 0;
  for (const finding of findings) {
    bytes += finding.size_bytes;
    bySeverity[finding.severity] += finding.size_bytes;
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + finding.size_bytes;
  }
  const sortedCategories = Object.fromEntries(Object.entries(byCategory).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return {findings: findings.length, bytes, by_severity: bySeverity, by_category: sortedCategories};
}

module.exports = {LOCKFILES, ENRICHERS, classify, enrich, buildTotals};
