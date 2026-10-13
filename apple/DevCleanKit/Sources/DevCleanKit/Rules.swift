// Load and validate declarative rules from JSON files, with the same checks as
// core/rules.ts: unknown keys, bad slugs or duplicate ids fail loading.
import Foundation

public struct Rule: Hashable, Sendable {
  public var id: String
  public var name: String
  public var category: String
  public var severity: Severity
  public var reclaimable: Bool
  public var description: String
  public var paths: [String]
  public var patterns: [String]
  public var markers: [String]
  public var rebuild: Rebuild?
}

public struct RuleError: LocalizedError, Equatable {
  public let message: String
  public var errorDescription: String? {message}
}

private let ruleKeys: Set = ["id", "name", "category", "severity", "reclaimable", "description", "paths", "patterns", "markers", "rebuild"]
private let rebuildKeys: Set = ["description", "commands"]

func isSlug(_ value: String) -> Bool {
  guard let first = value.unicodeScalars.first, first.isSlugChar, first != "-" else {return false}
  return value.unicodeScalars.allSatisfy(\.isSlugChar)
}
private extension Unicode.Scalar {
  var isSlugChar: Bool {("a"..."z").contains(self) || ("0"..."9").contains(self) || self == "-"}
}

private func isBool(_ value: Any?) -> Bool {
  guard let number = value as? NSNumber else {return false}
  return CFGetTypeID(number) == CFBooleanGetTypeID()
}

private func stringList(_ value: Any?, _ key: String) throws -> [String] {
  guard let value, !(value is NSNull) else {return []}
  guard let list = value as? [Any], list.allSatisfy({$0 is String}) else {throw RuleError(message: "\(key) must be a list of strings")}
  return list as! [String]
}

// Validate one parsed rule (a JSONSerialization object) and return it with defaults filled in.
public func validateRule(_ data: Any) throws -> Rule {
  guard let data = data as? [String: Any] else {throw RuleError(message: "expected a JSON object with a single rule")}
  let unknown = data.keys.filter {!ruleKeys.contains($0)}.sorted()
  if !unknown.isEmpty {throw RuleError(message: "unknown field(s): \(unknown.joined(separator: ", "))")}
  var strings: [String: String] = [:]
  for key in ["id", "name", "category", "description"] {
    guard let value = data[key] as? String else {throw RuleError(message: "\(key) must be a string")}
    strings[key] = value
  }
  for key in ["id", "category"] where !isSlug(strings[key]!) {
    throw RuleError(message: "\(key) \"\(strings[key]!)\" must match ^[a-z0-9][a-z0-9-]*$")
  }
  guard let raw = data["severity"] as? String, let severity = Severity(rawValue: raw) else {throw RuleError(message: "severity must be one of SAFE, REVIEW, DANGER")}
  guard isBool(data["reclaimable"]) else {throw RuleError(message: "reclaimable must be true or false")}
  let paths = try stringList(data["paths"], "paths"), patterns = try stringList(data["patterns"], "patterns"), markers = try stringList(data["markers"], "markers")
  if paths.isEmpty && patterns.isEmpty {throw RuleError(message: "rule must define at least one of paths or patterns")}
  if !markers.isEmpty && patterns.isEmpty {throw RuleError(message: "markers only apply to patterns")}
  if markers.contains(where: {$0.contains("/") || ["", ".", ".."].contains($0)}) {throw RuleError(message: "markers must be plain file names")}
  var rebuild: Rebuild?
  if let value = data["rebuild"], !(value is NSNull) {
    guard let object = value as? [String: Any] else {throw RuleError(message: "rebuild must be an object")}
    let extra = object.keys.filter {!rebuildKeys.contains($0)}.sorted()
    if !extra.isEmpty {throw RuleError(message: "unknown rebuild field(s): \(extra.joined(separator: ", "))")}
    guard let description = object["description"] as? String else {throw RuleError(message: "rebuild.description must be a string")}
    rebuild = Rebuild(description: description, commands: try stringList(object["commands"], "rebuild.commands"))
  }
  return Rule(id: strings["id"]!, name: strings["name"]!, category: strings["category"]!, severity: severity, reclaimable: (data["reclaimable"] as! NSNumber).boolValue,
              description: strings["description"]!, paths: paths, patterns: patterns, markers: markers, rebuild: rebuild)
}

// Load every `*.json` in `directory` as one rule each, sorted by file name.
public func loadRules(from directory: URL) throws -> [Rule] {
  let files: [String]
  do {files = try FileManager.default.contentsOfDirectory(atPath: directory.path).filter {$0.hasSuffix(".json")}.sorted()} catch {
    throw RuleError(message: "rules directory not found: \(directory.path)")
  }
  let rules = try files.map {file in
    let data: Any
    do {data = try JSONSerialization.jsonObject(with: Data(contentsOf: directory.appendingPathComponent(file)))} catch {
      throw RuleError(message: "\(file): invalid JSON: \(error.localizedDescription)")
    }
    do {return try validateRule(data)} catch let error as RuleError {throw RuleError(message: "\(file): invalid rule: \(error.message)")}
  }
  var seen = Set<String>(), dupes = Set<String>()
  for rule in rules where !seen.insert(rule.id).inserted {dupes.insert(rule.id)}
  if !dupes.isEmpty {throw RuleError(message: "duplicate rule ids: \(dupes.sorted().joined(separator: ", "))")}
  return rules
}
