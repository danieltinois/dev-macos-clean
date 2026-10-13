// The Node adapter: the only module in core/ that uses node: APIs. The CLI,
// Electron and tests run the engine through it; the Swift apps provide their own Host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseRules, RuleError} from './rules';
import * as scanner from './scanner';
import type {Entry, EntryKind, Host, Info} from './host';
import type {Report, Rule} from './types';

export const DEFAULT_RULES_DIR = path.resolve(import.meta.dirname, '..', 'rules');

function kind(entry: fs.Dirent | fs.Stats): EntryKind {
  return entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : 'other';
}
function info(read: () => fs.Stats): Info | null {
  try {const stats = read(); return {kind: kind(stats), size: stats.size, mtimeMs: stats.mtimeMs};} catch {return null;}
}

export const nodeHost: Host = {
  readdir: target => fs.readdirSync(target, {withFileTypes: true}).map((entry): Entry => ({name: entry.name, kind: kind(entry)})),
  lstat: target => info(() => fs.lstatSync(target)),
  stat: target => info(() => fs.statSync(target)),
  realpath: target => {try {return fs.realpathSync(target);} catch {return null;}},
  env: name => process.env[name],
  home: () => os.homedir(),
  cwd: () => process.cwd(),
  // statfs has no notion of purgeable space; only the Swift app can ask macOS for it.
  storage: target => {
    const {bsize, blocks, bavail} = fs.statfsSync(target);
    return {total_bytes: blocks * bsize, free_bytes: bavail * bsize, purgeable_bytes: null};
  },
};

// Load every `*.json` in `directory` (default: the project's rules/) as one rule each.
export function loadRules(directory = DEFAULT_RULES_DIR): Rule[] {
  let names: string[];
  try {names = fs.readdirSync(directory).filter(name => name.endsWith('.json'));} catch {
    throw new RuleError(`rules directory not found: ${directory}`);
  }
  return parseRules(names.map(name => ({name, text: fs.readFileSync(path.join(directory, name), 'utf8')})));
}

// Scan this machine (see scanner.DEFAULTS for options).
export function scan(rules: Rule[], options: Partial<scanner.ScanOptions> = {}): Report {return scanner.scan(nodeHost, rules, options);}
