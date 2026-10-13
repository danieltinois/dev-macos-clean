// Validate declarative rules parsed from JSON files (one rule per file).
// Everything that can be checked statically (ids, severity, required fields,
// unknown keys) is enforced here, so a typo never reaches the scanner.
// Reading the files is the caller's job (loadRules in node.ts).
import type {FileMatch, PhotoMatch, Rule, Severity} from './types';

export const SEVERITIES: readonly Severity[] = ['SAFE', 'REVIEW', 'DANGER'];
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const RULE_KEYS = new Set(['id', 'name', 'category', 'severity', 'reclaimable', 'description', 'paths', 'patterns', 'markers', 'photos', 'files', 'rebuild']);
const PHOTO_VALUES: Record<string, readonly string[]> = {media: ['image', 'video'], subtype: ['screenshot', 'screen-recording'], burst: ['extra'], duplicate: ['extra']};
const NUMBERS = ['min_bytes', 'min_age_days'];

// Photo and file criteria: each key is a known choice, a non-negative integer or,
// for files, a folder name.
function validateMatch(field: 'photos' | 'files', value: unknown, choices: Record<string, readonly string[]>): object {
  if (!isObject(value)) throw new Error(`${field} must be an object`);
  const keys = Object.keys(value);
  if (!keys.length) throw new Error(`${field} needs at least one criterion`);
  for (const key of keys) {
    const allowed = choices[key];
    if (allowed) {
      if (!allowed.includes(value[key] as string)) throw new Error(`${field}.${key} must be one of ${allowed.join(', ')}`);
    } else if (NUMBERS.includes(key)) {
      if (!Number.isInteger(value[key]) || (value[key] as number) < 0) throw new Error(`${field}.${key} must be a non-negative integer`);
    } else if (field === 'files' && key === 'folder') {
      const folder = value[key];
      if (typeof folder !== 'string' || !folder || folder.includes('/')) throw new Error('files.folder must be a plain folder name');
    } else throw new Error(`unknown ${field} field(s): ${key}`);
  }
  return value;
}
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
  const photos = data.photos === undefined || data.photos === null ? null : validateMatch('photos', data.photos, PHOTO_VALUES) as PhotoMatch;
  const files = data.files === undefined || data.files === null ? null : validateMatch('files', data.files, {}) as FileMatch;
  if (photos && files) throw new Error('a rule matches photos or files, not both');
  if ((photos || files) && (paths.length || patterns.length || markers.length)) throw new Error(`${photos ? 'photos' : 'files'} rules take no paths, patterns or markers`);
  if (!paths.length && !patterns.length && !photos && !files) throw new Error('rule must define at least one of paths, patterns, photos or files');
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
  return {...(data as Omit<Rule, 'paths' | 'patterns' | 'markers' | 'photos' | 'files' | 'rebuild'>), paths, patterns, markers, photos, files, rebuild};
}

export interface RuleFile {name: string; text: string}

// Parse `files` (only `*.json` names are used, in name order) as one rule each.
export function parseRules(files: RuleFile[]): Rule[] {
  const rules = files.filter(file => file.name.endsWith('.json')).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map(({name, text}) => {
    let data: unknown;
    try {data = JSON.parse(text);} catch (error) {
      throw new RuleError(`${name}: invalid JSON: ${(error as Error).message}`);
    }
    try {return validateRule(data);} catch (error) {throw new RuleError(`${name}: invalid rule: ${(error as Error).message}`);}
  });
  const ids = rules.map(rule => rule.id);
  const dupes = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  if (dupes.length) throw new RuleError(`duplicate rule ids: ${dupes.join(', ')}`);
  return rules;
}
