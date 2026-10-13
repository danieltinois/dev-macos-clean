// Analysis: enrichment, classification and aggregation.
//
// Discovery and measurement live in the scanner; this module adds specialized
// logic per rule (via ENRICHERS) and builds the report totals. A rule stays
// declarative until it genuinely needs code.
import * as path from './paths';
import {isFile} from './filesystem';
import {SEVERITIES} from './rules';
import type {Host} from './host';
import type {Finding, Rule, Severity, Totals} from './types';

export const LOCKFILES: Record<string, string> = {'package-lock.json': 'npm', 'pnpm-lock.yaml': 'pnpm', 'yarn.lock': 'yarn', 'bun.lock': 'bun', 'bun.lockb': 'bun'};

// Risk classification of a rule's findings. The declarative severity is
// authoritative for now; environment-aware escalation hooks in here.
export function classify(rule: Rule): Severity {return rule.severity;}

// Attach parent-project information for node_modules findings.
function enrichNodeModules(host: Host, finding: Finding) {
  const project = path.dirname(finding.path);
  const lockfile = Object.keys(LOCKFILES).find(name => isFile(host, path.join(project, name)));
  finding.metadata.project = project;
  finding.metadata['package.json'] = isFile(host, path.join(project, 'package.json')) ? 'yes' : 'no';
  finding.metadata.lockfile = lockfile ?? 'none';
  finding.metadata.package_manager = (lockfile && LOCKFILES[lockfile]) ?? 'unknown';
}

// Attach the Cargo project that owns a `target` directory.
function enrichCargoTarget(host: Host, finding: Finding) {
  const project = path.dirname(finding.path);
  finding.metadata.project = project;
  finding.metadata['Cargo.toml'] = isFile(host, path.join(project, 'Cargo.toml')) ? 'yes' : 'no';
}

// rule_id -> enricher. Rules with specialized logic register here.
export const ENRICHERS: Record<string, (host: Host, finding: Finding) => void> = {'node-modules': enrichNodeModules, 'rust-target': enrichCargoTarget};

export function enrich(host: Host, finding: Finding) {ENRICHERS[finding.rule_id]?.(host, finding);}

// Aggregate sizes by severity and category.
export function buildTotals(findings: Pick<Finding, 'severity' | 'category' | 'size_bytes'>[]): Totals {
  const bySeverity = Object.fromEntries(SEVERITIES.map(severity => [severity, 0])) as Record<Severity, number>;
  const byCategory: Record<string, number> = {};
  let bytes = 0;
  for (const finding of findings) {
    bytes += finding.size_bytes;
    bySeverity[finding.severity] += finding.size_bytes;
    byCategory[finding.category] = (byCategory[finding.category] ?? 0) + finding.size_bytes;
  }
  const sortedCategories = Object.fromEntries(Object.entries(byCategory).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  return {findings: findings.length, bytes, by_severity: bySeverity, by_category: sortedCategories};
}
