// The report contract (schema_version 1), byte-compatible with core/types.ts.
// Cleanup fields are optional: the CLI omits them, the desktop apps add them.
import Foundation

public enum Severity: String, Codable, CaseIterable, Sendable {
  case safe = "SAFE", review = "REVIEW", danger = "DANGER"
}

public struct Rebuild: Codable, Hashable, Sendable {
  public var description: String
  public var commands: [String]
  public init(description: String, commands: [String] = []) {self.description = description; self.commands = commands}
  public init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: CodingKeys.self)
    description = try c.decode(String.self, forKey: .description)
    commands = try c.decodeIfPresent([String].self, forKey: .commands) ?? []
  }
}

public struct Finding: Codable, Hashable, Sendable {
  public var ruleId: String
  public var name: String
  public var category: String
  public var severity: Severity
  public var reclaimable: Bool
  public var description: String
  public var path: String
  public var sizeBytes: Int
  public var sizeComplete: Bool
  public var lastModified: String?
  public var rebuild: Rebuild?
  public var metadata: [String: String]
  // Set by Cleanup.prepare on macOS; nil in reports from the CLI.
  public var cleanupAllowed: Bool?
  public var cleanupReview: Bool?
  public var cleanupReason: String?
  public var autoClean: Bool?

  enum CodingKeys: String, CodingKey {
    case ruleId = "rule_id", name, category, severity, reclaimable, description, path, sizeBytes = "size_bytes", sizeComplete = "size_complete"
    case lastModified = "last_modified", rebuild, metadata, cleanupAllowed = "cleanup_allowed", cleanupReview = "cleanup_review", cleanupReason = "cleanup_reason", autoClean = "auto_clean"
  }

  public init(ruleId: String, name: String = "", category: String, severity: Severity, reclaimable: Bool = true, description: String = "", path: String,
              sizeBytes: Int = 0, sizeComplete: Bool = true, lastModified: String? = nil, rebuild: Rebuild? = nil, metadata: [String: String] = [:]) {
    self.ruleId = ruleId; self.name = name; self.category = category; self.severity = severity; self.reclaimable = reclaimable
    self.description = description; self.path = path; self.sizeBytes = sizeBytes; self.sizeComplete = sizeComplete
    self.lastModified = lastModified; self.rebuild = rebuild; self.metadata = metadata
  }

  public var modifiedDate: Date? {lastModified.flatMap(parseISODate)}
}

public struct Totals: Codable, Hashable, Sendable {
  public var findings: Int
  public var bytes: Int
  public var bySeverity: [String: Int]
  public var byCategory: [String: Int]
  enum CodingKeys: String, CodingKey {case findings, bytes, bySeverity = "by_severity", byCategory = "by_category"}
}

public struct ReportOptions: Codable, Hashable, Sendable {
  public var globalScan: Bool
  public var maxDepth: Int
  public var maxFindings: Int
  public var excludes: [String]
  public var categories: [String]
  enum CodingKeys: String, CodingKey {case globalScan = "global_scan", maxDepth = "max_depth", maxFindings = "max_findings", excludes, categories}
}

public struct Report: Codable, Hashable, Sendable {
  public var schemaVersion: Int
  public var scannedAt: String
  public var roots: [String]
  public var options: ReportOptions
  public var totals: Totals
  public var findings: [Finding]
  public var warnings: [String]
  public var cleanupToken: String?
  enum CodingKeys: String, CodingKey {
    case schemaVersion = "schema_version", scannedAt = "scanned_at", roots, options, totals, findings, warnings, cleanupToken = "cleanup_token"
  }

  public var scannedDate: Date? {parseISODate(scannedAt)}

  // Decode a report exported by the CLI (`--json`) or either desktop app.
  public static func decode(_ data: Data) throws -> Report {
    let report = try JSONDecoder().decode(Report.self, from: data)
    guard report.schemaVersion == DevCleanKit.schemaVersion else {throw ReportError.unsupportedVersion(report.schemaVersion)}
    return report
  }

  public func encoded() throws -> Data {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .withoutEscapingSlashes]
    return try encoder.encode(self)
  }
}

public let schemaVersion = 1

public enum ReportError: LocalizedError {
  case unsupportedVersion(Int)
  public var errorDescription: String? {
    switch self {case .unsupportedVersion(let version): "Relatório com versão \(version) não suportada (esperado \(schemaVersion))."}
  }
}

// Matches JavaScript's Date#toISOString (`2026-10-13T12:00:00.000Z`).
func isoString(_ date: Date) -> String {Date.ISO8601FormatStyle(includingFractionalSeconds: true).format(date)}
func parseISODate(_ value: String) -> Date? {
  (try? Date.ISO8601FormatStyle(includingFractionalSeconds: true).parse(value)) ?? (try? Date.ISO8601FormatStyle().parse(value))
}
