// Scan orchestration (core/scanner.ts): discovery -> measurement -> classification -> aggregation.
//
// Explicit rule paths are probed first (cheap, most specific). Pattern rules
// then drive one bounded walk over the scan roots. Nothing here ever deletes.
import Foundation

public struct ScanOptions: Sendable {
  public var roots: [String] = []
  public var categories: [String]? = nil
  public var excludes: [String] = []
  public var maxDepth = 6
  public var maxDirs = 25_000
  public var maxFindings = 500
  public var maxEntries = 500_000
  public var home: String? = nil
  public var globalScan = false
  public var usersDir = "/Users"
  public var log: @Sendable (String) -> Void = {_ in}
  public init() {}
}

public let globalExcludes = ["/System", "/Volumes", "/dev", "/private", "/usr", "/bin", "/sbin"]

// Other users' homes, for a global scan.
private func otherHomes(_ usersDir: String, home: String, warnings: inout [String]) -> [String] {
  do {
    return try FileSystem.entries(usersDir).filter {$0.type == UInt8(DT_DIR)}.map {Paths.join(usersDir, $0.name)}.filter {$0 != home}.sorted()
  } catch {
    warnings.append("cannot list \(usersDir): \(error.message)")
    return []
  }
}

private func explicitTargets(_ rule: Rule, home: String, log: (String) -> Void) -> [String] {
  var targets: [String] = []
  for entry in rule.paths {
    let expanded = expandPath(entry, home: home)
    if hasGlobMagic(entry) {targets += FileSystem.glob(expanded)}
    else if FileSystem.lexists(expanded) {targets.append(expanded)}
    else {log("rule \(rule.id): path not found: \(expanded)")}
  }
  return targets
}

private func rule(for target: String, in patternRules: [Rule]) -> Rule? {
  patternRules.first {rule in
    rule.patterns.contains {rulePatternMatches(target, $0)} &&
      (rule.markers.isEmpty || rule.markers.contains {FileSystem.isFile(Paths.join(Paths.dirname(target), $0))})
  }
}

// Run a scan over `rules` and return the report (schema_version 1).
public func scan(_ rules: [Rule], options opts: ScanOptions = ScanOptions()) -> Report {
  var warnings: [String] = []
  let categories = opts.categories.flatMap {$0.isEmpty ? nil : Set($0)}
  // The generic per-app cache rule runs last so specific cache rules claim their folders first.
  let selected = rules.filter {categories?.contains($0.category) ?? true}
    .enumerated().sorted {($0.element.id == "user-app-caches" ? 1 : 0, $0.offset) < ($1.element.id == "user-app-caches" ? 1 : 0, $1.offset)}.map(\.element)
  if selected.isEmpty {warnings.append("no rules match the requested categories; nothing to scan")}

  let home = Paths.resolve(opts.home ?? NSHomeDirectory())
  let homes = [home] + (opts.globalScan ? otherHomes(opts.usersDir, home: home, warnings: &warnings) : [])
  var roots: [String] = []
  for root in homes + opts.roots.map(Paths.resolve) + (opts.globalScan ? ["/"] : []) where !roots.contains(root) {roots.append(root)}
  let scanRoots = roots.filter {root in
    if FileSystem.isDir(root) {return true}
    warnings.append("scan root does not exist or is not a directory: \(root)")
    return false
  }
  let scanExcludes = opts.excludes + (opts.globalScan ? globalExcludes : [])

  var findings: [Finding] = []
  var seen: [String: String] = [:] // resolved target path -> rule_id (keeps first match)
  var full: Bool {findings.count >= opts.maxFindings}
  func add(_ target: String, _ rule: Rule) {
    if excluded(target, opts.excludes) {return opts.log("excluding \(target)")}
    let key = FileSystem.realpath(target) ?? Paths.resolve(target)
    if let kept = seen[key] {return opts.log("duplicate target \(target) (kept rule \(kept))")}
    let measured = FileSystem.measure(target, maxEntries: opts.maxEntries)
    if measured.errors > 0 {warnings.append("errors while measuring \(target) (\(measured.errors) error(s))")}
    seen[key] = rule.id
    findings.append(Finding(ruleId: rule.id, name: rule.name, category: rule.category, severity: Analyzer.classify(rule), reclaimable: rule.reclaimable,
                            description: rule.description, path: target, sizeBytes: measured.bytes, sizeComplete: !measured.truncated && measured.errors == 0,
                            lastModified: FileSystem.mtime(target), rebuild: rule.rebuild))
  }
  let stopped = "reached max findings (\(opts.maxFindings)); scan stopped early"

  // 1. Explicit rule paths (most specific, no walking required).
  explicit: for rule in selected {
    if full {break}
    for userHome in homes {
      for target in explicitTargets(rule, home: userHome, log: opts.log) {
        add(target, rule)
        if full {warnings.append(stopped); break explicit}
      }
    }
  }

  // 2. Pattern discovery over the scan roots (bounded walk).
  let patternRules = selected.filter {!$0.patterns.isEmpty}
  if !patternRules.isEmpty && !full {
    let patterns = Set(patternRules.flatMap(\.patterns)).sorted()
    var capped = false
    var walkWarnings: [String] = []
    FileSystem.iterMatches(scanRoots, patterns, maxDepth: opts.maxDepth, maxDirs: opts.maxDirs, excludes: scanExcludes, warnings: &walkWarnings) {target in
      if full {capped = true; return false}
      if let rule = rule(for: target, in: patternRules) {add(target, rule)}
      return true
    }
    warnings += walkWarnings
    if capped {warnings.append(stopped)}
  }

  for index in findings.indices {Analyzer.enrich(&findings[index])}
  findings.sort {($0.category, $0.name, $0.path) < ($1.category, $1.name, $1.path)}
  return Report(schemaVersion: schemaVersion, scannedAt: isoString(Date()), roots: scanRoots,
                options: ReportOptions(globalScan: opts.globalScan, maxDepth: opts.maxDepth, maxFindings: opts.maxFindings, excludes: scanExcludes, categories: (categories ?? []).sorted()),
                totals: buildTotals(findings), findings: findings, warnings: warnings)
}
