// Load and validate declarative rules from JSON files (one rule per file).
// Everything that can be checked statically (ids, severity, required fields,
// unknown keys) is enforced here, so a typo never reaches the scanner.
import fs from 'node:fs';
import path from 'node:path';
import type {Rule, Severity} from './types';

export const DEFAULT_RULES_DIR = path.resolve(import.meta.dirname, '..', 'rules');
export const SEVERITIES: readonly Severity[] = ['SAFE', 'REVIEW', 'DANGER'];
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const RULE_KEYS = new Set(['id', 'name', 'category', 'severity', 'reclaimable', 'description', 'paths', 'patterns', 'markers', 'rebuild']);
const REBUILD_KEYS = new Set(['description', 'commands']);

export class RuleError extends Error {}

function isStringList(value: unknown): value is string[] {return Array.isArray(value) && value.every(item => typeof item === 'string');}
function isObject(value: unknown): value is Record<string, unknown> {return Boolean(value) && typeof value === 'object' && !Array.isArray(value);}

// Validate one parsed rule and return it with defaults filled in. Throws a plain Error.
export function validateRule(data: unknown): Rule {
  if (!isObject(data)) throw new Error('expected a JSON object with a single rule');
  const unknown = Object.keys(data).filter(key => !RULE_KEYS.has(key));
  if (unknown.length) throw new Error(`unknown field(s): ${unknown.join(', ')}`);
  for (const key of ['id', 'name', 'category', 'description']) {
    if (typeof data[key] !== 'string') throw new Error(`${key} must be a string`);
  }
  for (const key of ['id', 'category']) {
    if (!SLUG.test(data[key] as string)) throw new Error(`${key} ${JSON.stringify(data[key])} must match ${SLUG.source}`);
  }
  if (!SEVERITIES.includes(data.severity as Severity)) throw new Error(`severity must be one of ${SEVERITIES.join(', ')}`);
  if (typeof data.reclaimable !== 'boolean') throw new Error('reclaimable must be true or false');
  const lists = {paths: data.paths ?? [], patterns: data.patterns ?? [], markers: data.markers ?? []};
  for (const [key, value] of Object.entries(lists)) {
    if (!isStringList(value)) throw new Error(`${key} must be a list of strings`);
  }
  const {paths, patterns, markers} = lists as Record<keyof typeof lists, string[]>;
  if (!paths.length && !patterns.length) throw new Error('rule must define at least one of paths or patterns');
  if (markers.length && !patterns.length) throw new Error('markers only apply to patterns');
  if (markers.some(marker => marker.includes('/') || ['', '.', '..'].includes(marker))) throw new Error('markers must be plain file names');
  let rebuild: Rule['rebuild'] = null;
  if (data.rebuild !== undefined && data.rebuild !== null) {
    if (!isObject(data.rebuild)) throw new Error('rebuild must be an object');
    const extra = Object.keys(data.rebuild).filter(key => !REBUILD_KEYS.has(key));
    if (extra.length) throw new Error(`unknown rebuild field(s): ${extra.join(', ')}`);
    const {description, commands} = data.rebuild;
    if (typeof description !== 'string') throw new Error('rebuild.description must be a string');
    if (commands !== undefined && !isStringList(commands)) throw new Error('rebuild.commands must be a list of strings');
    rebuild = {description, commands: commands ?? []};
  }
  return {...(data as Omit<Rule, 'paths' | 'patterns' | 'markers' | 'rebuild'>), paths, patterns, markers, rebuild};
}

// Load every `*.json` in `directory` (default: the project's rules/) as one rule each.
export function loadRules(directory = DEFAULT_RULES_DIR): Rule[] {
  let files: string[];
  try {files = fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort();} catch {
    throw new RuleError(`rules directory not found: ${directory}`);
  }
  const rules = files.map(file => {
    let data: unknown;
    try {data = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));} catch (error) {
      throw new RuleError(`${file}: invalid JSON: ${(error as Error).message}`);
    }
    try {return validateRule(data);} catch (error) {throw new RuleError(`${file}: invalid rule: ${(error as Error).message}`);}
  });
  const ids = rules.map(rule => rule.id);
  const dupes = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  if (dupes.length) throw new RuleError(`duplicate rule ids: ${dupes.join(', ')}`);
  return rules;
}
