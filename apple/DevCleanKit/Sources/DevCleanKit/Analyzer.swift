// Analysis: per-rule enrichment, classification and totals (core/analyzer.ts).
import Foundation

let lockfiles: [(name: String, manager: String)] = [("package-lock.json", "npm"), ("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("bun.lock", "bun"), ("bun.lockb", "bun")]

enum Analyzer {
  // The declarative severity is authoritative for now; environment-aware escalation hooks in here.
  static func classify(_ rule: Rule) -> Severity {rule.severity}

  static func enrich(_ finding: inout Finding) {
    let project = Paths.dirname(finding.path)
    let has = {(file: String) in FileSystem.isFile(Paths.join(project, file)) ? "yes" : "no"}
    switch finding.ruleId {
    case "node-modules":
      let lockfile = lockfiles.first {FileSystem.isFile(Paths.join(project, $0.name))}
      finding.metadata["project"] = project
      finding.metadata["package.json"] = has("package.json")
      finding.metadata["lockfile"] = lockfile?.name ?? "none"
      finding.metadata["package_manager"] = lockfile?.manager ?? "unknown"
    case "rust-target":
      finding.metadata["project"] = project
      finding.metadata["Cargo.toml"] = has("Cargo.toml")
    default: break
    }
  }
}

// Aggregate sizes by severity and category.
public func buildTotals(_ findings: [Finding]) -> Totals {
  var bySeverity = Dictionary(uniqueKeysWithValues: Severity.allCases.map {($0.rawValue, 0)})
  var byCategory: [String: Int] = [:]
  for finding in findings {
    bySeverity[finding.severity.rawValue, default: 0] += finding.sizeBytes
    byCategory[finding.category, default: 0] += finding.sizeBytes
  }
  return Totals(findings: findings.count, bytes: findings.reduce(0) {$0 + $1.sizeBytes}, bySeverity: bySeverity, byCategory: byCategory)
}
