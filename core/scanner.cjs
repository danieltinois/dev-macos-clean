// Scan orchestration: discovery -> measurement -> classification -> aggregation.
//
// Explicit rule paths are probed first (cheap, most specific). Pattern rules
// then drive one bounded walk over the scan roots. Nothing here ever deletes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const filesystem = require('./filesystem.cjs');
const analyzer = require('./analyzer.cjs');

const SCHEMA_VERSION = 1;
const GLOBAL_EXCLUDES = ['/System', '/Volumes', '/dev', '/private', '/usr', '/bin', '/sbin'];
const DEFAULTS = {roots: [], categories: null, excludes: [], maxDepth: 6, maxDirs: 25_000, maxFindings: 500, maxEntries: 500_000, home: null, globalScan: false, usersDir: '/Users', log: () => {}};

function compare(a, b) {return a < b ? -1 : a > b ? 1 : 0;}

// Other users' homes, for a global scan.
function otherHomes(usersDir, home, warnings) {
  try {
    return fs.readdirSync(usersDir, {withFileTypes: true})
      .filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
      .map(entry => path.join(usersDir, entry.name))
      .filter(dir => dir !== home)
      .sort();
  } catch (error) {
    warnings.push(`cannot list ${usersDir}: ${error.message}`);
    return [];
  }
}

function explicitTargets(rule, home, log) {
  const targets = [];
  for (const entry of rule.paths) {
    const expanded = filesystem.expandPath(entry, home);
    if (filesystem.hasGlobMagic(entry)) targets.push(...filesystem.glob(expanded));
    else if (filesystem.lexists(expanded)) targets.push(expanded);
    else log(`rule ${rule.id}: path not found: ${expanded}`);
  }
  return targets;
}

function ruleFor(target, patternRules) {
  return patternRules.find(rule =>
    rule.patterns.some(pattern => filesystem.rulePatternMatches(target, pattern)) &&
    (!rule.markers.length || rule.markers.some(marker => filesystem.isFile(path.join(path.dirname(target), marker)))));
}

// Run a scan with `options` (see DEFAULTS) over `rules` and return the report (schema_version 1).
function scan(rules, options = {}) {
  const opts = {...DEFAULTS, ...Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined))};
  const warnings = [];
  const categories = opts.categories?.length ? new Set(opts.categories) : null;
  // The generic per-app cache rule runs last so specific cache rules claim their folders first.
  const selected = rules.filter(rule => !categories || categories.has(rule.category))
    .sort((a, b) => (a.id === 'user-app-caches') - (b.id === 'user-app-caches'));
  if (!selected.length) warnings.push('no rules match the requested categories; nothing to scan');

  const home = path.resolve(opts.home ?? os.homedir());
  const homes = [home, ...(opts.globalScan ? otherHomes(opts.usersDir, home, warnings) : [])];
  const roots = [...new Set([...homes, ...opts.roots.map(root => path.resolve(root)), ...(opts.globalScan ? ['/'] : [])])];
  const scanRoots = roots.filter(root => {
    if (filesystem.isDir(root)) return true;
    warnings.push(`scan root does not exist or is not a directory: ${root}`);
    return false;
  });
  const scanExcludes = [...opts.excludes, ...(opts.globalScan ? GLOBAL_EXCLUDES : [])];

  const findings = [];
  const seen = new Map(); // resolved target path -> rule_id (keeps first match)
  const full = () => findings.length >= opts.maxFindings;
  function add(target, rule) {
    if (filesystem.excluded(target, opts.excludes)) return opts.log(`excluding ${target}`);
    let key;
    try {key = fs.realpathSync(target);} catch {key = path.resolve(target);}
    if (seen.has(key)) return opts.log(`duplicate target ${target} (kept rule ${seen.get(key)})`);
    const measured = filesystem.measure(target, {maxEntries: opts.maxEntries});
    if (measured.errors) warnings.push(`errors while measuring ${target} (${measured.errors} error(s))`);
    seen.set(key, rule.id);
    findings.push({
      rule_id: rule.id, name: rule.name, category: rule.category, severity: analyzer.classify(rule),
      reclaimable: rule.reclaimable, description: rule.description, path: target,
      size_bytes: measured.bytes, size_complete: !measured.truncated && !measured.errors,
      last_modified: filesystem.mtime(target), rebuild: rule.rebuild, metadata: {},
    });
  }

  // 1. Explicit rule paths (most specific, no walking required).
  explicit: for (const rule of selected) {
    if (full()) break;
    for (const userHome of homes) {
      for (const target of explicitTargets(rule, userHome, opts.log)) {
        add(target, rule);
        if (full()) {warnings.push(`reached max findings (${opts.maxFindings}); scan stopped early`); break explicit;}
      }
    }
  }

  // 2. Pattern discovery over the scan roots (bounded walk).
  const patternRules = selected.filter(rule => rule.patterns.length);
  if (patternRules.length && !full()) {
    const patterns = [...new Set(patternRules.flatMap(rule => rule.patterns))].sort();
    for (const target of filesystem.iterMatches(scanRoots, patterns, {maxDepth: opts.maxDepth, maxDirs: opts.maxDirs, excludes: scanExcludes, warnings})) {
      if (full()) {warnings.push(`reached max findings (${opts.maxFindings}); scan stopped early`); break;}
      const rule = ruleFor(target, patternRules);
      if (rule) add(target, rule);
    }
  }

  findings.forEach(analyzer.enrich);
  findings.sort((a, b) => compare(a.category, b.category) || compare(a.name, b.name) || compare(a.path, b.path));
  return {
    schema_version: SCHEMA_VERSION,
    scanned_at: new Date().toISOString(),
    roots: scanRoots,
    options: {global_scan: opts.globalScan, max_depth: opts.maxDepth, max_findings: opts.maxFindings, excludes: scanExcludes, categories: [...(categories ?? [])].sort()},
    totals: analyzer.buildTotals(findings),
    findings,
    warnings,
  };
}

module.exports = {SCHEMA_VERSION, GLOBAL_EXCLUDES, DEFAULTS, scan};
