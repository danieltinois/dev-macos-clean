// POSIX path helpers with node:path semantics. NSString.standardizingPath is
// avoided on purpose: it strips `/private` and would change identities.
import Foundation

enum Paths {
  static let separator = "/"

  // path.normalize: collapse `//`, `.` and `..`; keep a leading `/`.
  static func normalize(_ value: String) -> String {
    if value.isEmpty {return "."}
    let absolute = value.hasPrefix("/")
    var parts: [Substring] = []
    for part in value.split(separator: "/", omittingEmptySubsequences: true) {
      if part == "." {continue}
      if part == ".." {
        if let last = parts.last, last != ".." {parts.removeLast()} else if !absolute {parts.append(part)}
        continue
      }
      parts.append(part)
    }
    let joined = parts.joined(separator: "/")
    return absolute ? "/" + joined : (joined.isEmpty ? "." : joined)
  }

  static func resolve(_ value: String) -> String {
    value.hasPrefix("/") ? normalize(value) : normalize(FileManager.default.currentDirectoryPath + "/" + value)
  }

  static func join(_ base: String, _ components: String...) -> String {
    normalize(([base] + components).joined(separator: "/"))
  }

  static func basename(_ value: String) -> String {
    let trimmed = value.count > 1 && value.hasSuffix("/") ? String(value.dropLast()) : value
    guard let slash = trimmed.lastIndex(of: "/") else {return trimmed}
    return trimmed == "/" ? "" : String(trimmed[trimmed.index(after: slash)...])
  }

  static func dirname(_ value: String) -> String {
    let trimmed = value.count > 1 && value.hasSuffix("/") ? String(value.dropLast()) : value
    guard let slash = trimmed.lastIndex(of: "/") else {return "."}
    return slash == trimmed.startIndex ? "/" : String(trimmed[..<slash])
  }

  // True when `child` is `parent` or lies inside it.
  static func isInside(_ child: String, _ parent: String) -> Bool {
    child == parent || child.hasPrefix(parent == "/" ? "/" : parent + "/")
  }
}
