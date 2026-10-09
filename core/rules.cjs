// Load and validate declarative rules from JSON files (one rule per file).
// Everything that can be checked statically (ids, severity, required fields,
// unknown keys) is enforced here, so a typo never reaches the scanner.
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_RULES_DIR = path.resolve(__dirname, '..', 'rules');
const SEVERITIES = ['SAFE', 'REVIEW', 'DANGER'];
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const RULE_KEYS = new Set(['id', 'name', 'category', 'severity', 'reclaimable', 'description', 'paths', 'patterns', 'markers', 'rebuild']);
const REBUILD_KEYS = new Set(['description', 'commands']);

class RuleError extends Error {}

function isStringList(value) {return Array.isArray(value) && value.every(item => typeof item === 'string');}

// Validate one parsed rule and return it with defaults filled in. Throws a plain Error.
function validateRule(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('expected a JSON object with a single rule');
  const unknown = Object.keys(data).filter(key => !RULE_KEYS.has(key));
  if (unknown.length) throw new Error(`unknown field(s): ${unknown.join(', ')}`);
  for (const key of ['id', 'name', 'category', 'description']) {
    if (typeof data[key] !== 'string') throw new Error(`${key} must be a string`);
  }
  for (const key of ['id', 'category']) {
    if (!SLUG.test(data[key])) throw new Error(`${key} ${JSON.stringify(data[key])} must match ${SLUG.source}`);
  }
  if (!SEVERITIES.includes(data.severity)) throw new Error(`severity must be one of ${SEVERITIES.join(', ')}`);
  if (typeof data.reclaimable !== 'boolean') throw new Error('reclaimable must be true or false');
  const rule = {...data, paths: data.paths ?? [], patterns: data.patterns ?? [], markers: data.markers ?? [], rebuild: data.rebuild ?? null};
  for (const key of ['paths', 'patterns', 'markers']) {
    if (!isStringList(rule[key])) throw new Error(`${key} must be a list of strings`);
  }
  if (!rule.paths.length && !rule.patterns.length) throw new Error('rule must define at least one of paths or patterns');
  if (rule.markers.length && !rule.patterns.length) throw new Error('markers only apply to patterns');
  if (rule.markers.some(marker => marker.includes('/') || ['', '.', '..'].includes(marker))) throw new Error('markers must be plain file names');
  if (rule.rebuild !== null) {
    const rebuild = rule.rebuild;
    if (typeof rebuild !== 'object' || Array.isArray(rebuild)) throw new Error('rebuild must be an object');
    const extra = Object.keys(rebuild).filter(key => !REBUILD_KEYS.has(key));
    if (extra.length) throw new Error(`unknown rebuild field(s): ${extra.join(', ')}`);
    if (typeof rebuild.description !== 'string') throw new Error('rebuild.description must be a string');
    if (rebuild.commands !== undefined && !isStringList(rebuild.commands)) throw new Error('rebuild.commands must be a list of strings');
    rule.rebuild = {description: rebuild.description, commands: rebuild.commands ?? []};
  }
  return rule;
}

// Load every `*.json` in `directory` (default: the project's rules/) as one rule each.
function loadRules(directory = DEFAULT_RULES_DIR) {
  let files;
  try {files = fs.readdirSync(directory).filter(name => name.endsWith('.json')).sort();} catch {
    throw new RuleError(`rules directory not found: ${directory}`);
  }
  const rules = files.map(file => {
    let data;
    try {data = JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8'));} catch (error) {
      throw new RuleError(`${file}: invalid JSON: ${error.message}`);
    }
    try {return validateRule(data);} catch (error) {throw new RuleError(`${file}: invalid rule: ${error.message}`);}
  });
  const ids = rules.map(rule => rule.id);
  const dupes = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  if (dupes.length) throw new RuleError(`duplicate rule ids: ${dupes.join(', ')}`);
  return rules;
}

module.exports = {DEFAULT_RULES_DIR, SEVERITIES, RuleError, validateRule, loadRules};
