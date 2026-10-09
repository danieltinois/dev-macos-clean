// Filesystem helpers: size computation and constrained directory walking.
//
// Performance/safety decisions (documented in the README):
// * dirSize never follows symlinks (avoids loops and double-counting).
// * iterMatches (pattern discovery) is a bounded walk that never enters hidden
//   dirs (.git included), symlinks, known-heavy dirs, or a dir that already
//   matched (so node_modules is never re-entered).
// * Permission errors are counted and reported, never fatal.
// * Sizes above a configurable entry cap are reported as truncated.
const fs = require('node:fs');
const path = require('node:path');

// Directories never descended into during pattern discovery on a home directory.
// Hidden dirs are skipped separately, so this only lists public names.
const SKIP_DIR_NAMES = new Set(['Library', 'Applications', 'Music', 'Movies', 'Pictures', 'node_modules', 'Pods', 'DerivedData', 'build', 'target']);

const regexCache = new Map();
// Shell-style (fnmatch) match where `*` and `?` also match `/`.
function fnmatch(name, pattern) {
  let regex = regexCache.get(pattern);
  if (!regex) {
    let source = '';
    for (let i = 0; i < pattern.length; i++) {
      const char = pattern[i];
      if (char === '*') source += '.*';
      else if (char === '?') source += '.';
      else if (char === '[') {
        const end = pattern.indexOf(']', i + 2);
        if (end === -1) {source += '\\['; continue;}
        let body = pattern.slice(i + 1, end).replace(/\\/g, '\\\\');
        if (body[0] === '!') body = '^' + body.slice(1);
        source += `[${body}]`;
        i = end;
      } else source += char.replace(/[.+^${}()|\\\]]/g, '\\$&');
    }
    regex = new RegExp(`^${source}$`, 's');
    regexCache.set(pattern, regex);
  }
  return regex.test(name);
}

function hasGlobMagic(value) {return /[*?[]/.test(value);}

// Expand a leading `~` against `home`, then $VAR / ${VAR} (unknown variables stay as-is).
function expandPath(entry, home) {
  if (entry.startsWith('~')) entry = home + entry.slice(1);
  return path.normalize(entry.replace(/\$(\w+)|\$\{(\w+)\}/g, (match, a, b) => process.env[a || b] ?? match));
}

// Paths matching a glob, one segment at a time. Like the shell, wildcards
// never match names starting with `.` unless the segment itself does.
function glob(pattern) {
  const parts = pattern.split(path.sep);
  let current = [parts[0] || path.sep];
  for (const part of parts.slice(1)) {
    if (!part) continue;
    const next = [];
    for (const dir of current) {
      if (!hasGlobMagic(part)) {
        const candidate = path.join(dir, part);
        if (lexists(candidate)) next.push(candidate);
        continue;
      }
      let names;
      try {names = fs.readdirSync(dir);} catch {continue;}
      for (const name of names.sort()) {
        if (name.startsWith('.') && !part.startsWith('.')) continue;
        if (fnmatch(name, part)) next.push(path.join(dir, name));
      }
    }
    current = next;
  }
  return current;
}

function lexists(target) {
  try {fs.lstatSync(target); return true;} catch {return false;}
}

function isDir(target) {
  try {return fs.statSync(target).isDirectory();} catch {return false;}
}

function isFile(target) {
  try {return fs.statSync(target).isFile();} catch {return false;}
}

// mtime of the path itself as an ISO string (a proxy for "when was it last used").
function mtime(target) {
  try {return fs.lstatSync(target).mtime.toISOString();} catch {return null;}
}

// Total size of a directory in bytes. File symlinks are skipped, directory
// symlinks are never descended into. Per-entry errors are counted and the walk continues.
function dirSize(target, {maxEntries = 500_000, maxDepth = 64} = {}) {
  let seen = 0, errors = 0, truncated = false;
  function walk(current, depth) {
    if (truncated || depth > maxDepth) return 0;
    let entries;
    try {entries = fs.readdirSync(current, {withFileTypes: true});} catch {errors++; return 0;}
    let total = 0;
    for (const entry of entries) {
      if (++seen > maxEntries) {truncated = true; break;}
      if (entry.isSymbolicLink()) continue;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) total += walk(child, depth + 1);
      else {
        try {total += fs.lstatSync(child).size;} catch {errors++;}
      }
    }
    return total;
  }
  return {bytes: walk(target, 0), errors, truncated};
}

// Size of a file or directory. Top-level symlinks are measured through once.
function measure(target, options = {}) {
  if (isDir(target)) return dirSize(target, options);
  try {return {bytes: fs.lstatSync(target).size, errors: 0, truncated: false};} catch {return {bytes: 0, errors: 1, truncated: false};}
}

// True when the path matches any exclusion pattern (by basename or full path).
function excluded(target, patterns) {
  if (!patterns?.length) return false;
  const full = path.normalize(target);
  return patterns.some(pattern => fnmatch(path.basename(target), pattern) || fnmatch(full, pattern));
}

// Match a rule `patterns` entry against a discovered directory:
// * `**/node_modules` (leading `**/`): match on the basename at any depth;
// * pattern containing `/`: match against the full path;
// * anything else (e.g. `node_modules`): match on the basename.
function rulePatternMatches(target, pattern) {
  if (pattern.startsWith('**/')) return fnmatch(path.basename(target), pattern.slice(3));
  if (!pattern.includes('/') || pattern.startsWith('*')) return fnmatch(path.basename(target), pattern);
  return fnmatch(target, pattern);
}

// Bounded walk over `roots` yielding dirs matching any of `patterns`. Never
// descends into hidden dirs, symlinks, excluded dirs, SKIP_DIR_NAMES dirs, or a
// dir that already matched.
function* iterMatches(roots, patterns, {maxDepth, maxDirs, excludes, warnings}) {
  const matches = target => patterns.some(pattern => rulePatternMatches(target, pattern));
  const stack = [...roots].reverse().map(root => [root, 0]);
  let visited = 0;
  while (stack.length) {
    if (++visited > maxDirs) {
      warnings?.push(`discovery exceeded ${maxDirs} directories; scan is partial`);
      return;
    }
    const [current, depth] = stack.pop();
    if (excluded(current, excludes)) continue;
    if (matches(current)) {yield current; continue;}
    if (depth >= maxDepth) continue;
    let entries;
    try {entries = fs.readdirSync(current, {withFileTypes: true});} catch (error) {
      warnings?.push(`cannot read ${current}: ${error.message}`);
      continue;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory() || entry.name.startsWith('.')) continue;
      const child = path.join(current, entry.name);
      if (excluded(child, excludes)) continue;
      // A matched child is yielded and never descended into (e.g. node_modules is
      // never re-entered). This must run before the SKIP_DIR_NAMES check, which contains matches.
      if (matches(child)) {yield child; continue;}
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      stack.push([child, depth + 1]);
    }
  }
}

module.exports = {SKIP_DIR_NAMES, fnmatch, hasGlobMagic, expandPath, glob, lexists, isDir, isFile, mtime, dirSize, measure, excluded, rulePatternMatches, iterMatches};
