// UI-facing helpers shared by the macOS and iOS apps (labels in pt-BR), plus
// the filtering and quick-selection logic of desktop/selection.ts.
import Foundation

public enum Labels {
  public static let categories = ["node": "Node.js", "xcode": "Xcode", "android": "Android", "python": "Python", "rust": "Rust", "go": "Go", "java": "Java",
                                  "flutter": "Flutter", "docker": "Docker", "ide": "IDEs", "macos": "macOS", "downloads": "Downloads", "logs": "Logs", "homebrew": "Homebrew"]
  public static func category(_ slug: String) -> String {categories[slug] ?? slug}
  public static func risk(_ severity: Severity) -> String {
    switch severity {case .safe: "Baixo risco"; case .review: "Revisar"; case .danger: "Alto risco"}
  }

  // `842 MB`, `2,4 GB` (binary units, pt-BR decimal comma).
  public static func bytes(_ n: Int) -> String {
    if n < 1 {return "0 B"}
    let units = ["B", "KB", "MB", "GB", "TB"]
    let i = min(4, Int(log(Double(n)) / log(1024)))
    let value = Double(n) / pow(1024, Double(i))
    return "\(value.formatted(.number.precision(.fractionLength(0...(i > 0 ? 1 : 0))).locale(Locale(identifier: "pt_BR")))) \(units[i])"
  }

  public static func ageDays(_ finding: Finding, now: Date = Date()) -> Int? {
    finding.modifiedDate.map {Int(now.timeIntervalSince($0) / 86400)}
  }

  public static func ago(_ days: Int?) -> String {
    guard let days else {return ""}
    if days < 1 {return "hoje"}
    if days < 31 {return "há \(days) dia(s)"}
    if days < 365 {return "há \(days / 30) mês(es)"}
    return "há \((Double(days) / 365).formatted(.number.precision(.fractionLength(0...1)).locale(Locale(identifier: "pt_BR")))) ano(s)"
  }
}

public extension Finding {
  // "Safe" is what may go to the Trash without review. Reports without cleanup
  // fields (from the CLI) fall back to the rule classification.
  var isSafe: Bool {cleanupAllowed.map {$0 && cleanupReview != true} ?? (severity == .safe && reclaimable)}
  // A stale project output picked by automatic cleanup.
  var isStale: Bool {autoClean == true && metadata["project"] != nil}
  var canClean: Bool {cleanupAllowed == true}
}

public struct Filters: Equatable, Sendable {
  public var query = "", category = "", severity = ""
  public init(query: String = "", category: String = "", severity: String = "") {self.query = query; self.category = category; self.severity = severity}
  public var isActive: Bool {!query.isEmpty || !category.isEmpty || !severity.isEmpty}
}

public struct Indexed: Identifiable, Hashable, Sendable {
  public let index: Int
  public let finding: Finding
  public var id: Int {index}
}

public enum Selection {
  // Findings that pass the filters, each with its index in the report.
  public static func visible(_ findings: [Finding], _ filters: Filters) -> [Indexed] {
    let needle = filters.query.lowercased()
    return findings.enumerated().compactMap {index, f in
      guard filters.category.isEmpty || f.category == filters.category, filters.severity.isEmpty || f.severity.rawValue == filters.severity,
            needle.isEmpty || "\(f.name) \(f.path)".lowercased().contains(needle) else {return nil}
      return Indexed(index: index, finding: f)
    }
  }

  // Report indices of the cleanable `items` matching `predicate`. Shortest paths
  // first: a folder already picked covers anything inside it.
  public static func pick(_ items: [Indexed], _ predicate: (Finding) -> Bool) -> [Int] {
    var picked: [String] = [], indices: [Int] = []
    for item in items.filter({$0.finding.canClean && predicate($0.finding)}).sorted(by: {$0.finding.path.count < $1.finding.path.count}) {
      if picked.contains(where: {item.finding.path.hasPrefix($0 + "/")}) {continue}
      picked.append(item.finding.path); indices.append(item.index)
    }
    return indices
  }
}
