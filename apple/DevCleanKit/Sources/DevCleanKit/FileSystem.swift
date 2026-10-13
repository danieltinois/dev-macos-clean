// Filesystem helpers: size computation and constrained directory walking, with
// the same decisions as core/filesystem.ts:
// * dirSize never follows symlinks (avoids loops and double-counting).
// * iterMatches never enters hidden dirs, symlinks, known-heavy dirs, or a dir
//   that already matched (so node_modules is never re-entered).
// * Permission errors are counted and reported, never fatal.
// * Sizes above a configurable entry cap are reported as truncated.
import Foundation

public struct Measurement: Equatable, Sendable {
  public var bytes: Int
  public var errors: Int
  public var truncated: Bool
}

// Directories never descended into during pattern discovery. Hidden dirs are skipped separately.
let skipDirNames: Set = ["Library", "Applications", "Music", "Movies", "Pictures", "node_modules", "Pods", "DerivedData", "build", "target"]

enum FileSystem {
  struct Entry {let name: String; let type: UInt8}
  struct ReadError: Error {let message: String}

  // readdir(3) without `.`/`..`. d_type avoids one lstat per entry; DT_UNKNOWN falls back to lstat.
  static func entries(_ path: String) throws(ReadError) -> [Entry] {
    guard let dir = opendir(path) else {throw ReadError(message: String(cString: strerror(errno)))}
    defer {closedir(dir)}
    var result: [Entry] = []
    while let pointer = readdir(dir) {
      let name = withUnsafeBytes(of: pointer.pointee.d_name) {String(decoding: $0.prefix(while: {$0 != 0}), as: UTF8.self)}
      if name == "." || name == ".." {continue}
      var type = pointer.pointee.d_type
      if type == UInt8(DT_UNKNOWN), let info = lstatInfo(Paths.join(path, name)) {
        type = switch info.st_mode & S_IFMT {case S_IFDIR: UInt8(DT_DIR); case S_IFLNK: UInt8(DT_LNK); default: UInt8(DT_REG)}
      }
      result.append(Entry(name: name, type: type))
    }
    return result
  }

  static func lstatInfo(_ path: String) -> stat? {
    var info = stat()
    return lstat(path, &info) == 0 ? info : nil
  }

  static func statInfo(_ path: String) -> stat? {
    var info = stat()
    return stat(path, &info) == 0 ? info : nil
  }

  static func lexists(_ path: String) -> Bool {lstatInfo(path) != nil}
  static func isDir(_ path: String) -> Bool {statInfo(path).map {$0.st_mode & S_IFMT == S_IFDIR} ?? false}
  static func isFile(_ path: String) -> Bool {statInfo(path).map {$0.st_mode & S_IFMT == S_IFREG} ?? false}
  static func realpath(_ path: String) -> String? {
    guard let resolved = Darwin.realpath(path, nil) else {return nil}
    defer {free(resolved)}
    return String(cString: resolved)
  }

  // mtime of the path itself as an ISO string (a proxy for "when was it last used").
  static func mtime(_ path: String) -> String? {
    guard let info = lstatInfo(path) else {return nil}
    let spec = info.st_mtimespec
    // Truncated to milliseconds, like JavaScript dates.
    return isoString(Date(timeIntervalSince1970: Double(spec.tv_sec) + Double(spec.tv_nsec / 1_000_000) / 1000))
  }

  // Total size of a directory in bytes. File symlinks are skipped, directory
  // symlinks are never descended into. Per-entry errors are counted and the walk continues.
  static func dirSize(_ target: String, maxEntries: Int = 500_000, maxDepth: Int = 64) -> Measurement {
    var seen = 0, errors = 0, truncated = false
    func walk(_ current: String, _ depth: Int) -> Int {
      if truncated || depth > maxDepth {return 0}
      guard let list = try? entries(current) else {errors += 1; return 0}
      var total = 0
      for entry in list {
        seen += 1
        if seen > maxEntries {truncated = true; break}
        if entry.type == UInt8(DT_LNK) {continue}
        let child = current + "/" + entry.name
        if entry.type == UInt8(DT_DIR) {total += walk(child, depth + 1)}
        else if let info = lstatInfo(child) {total += Int(info.st_size)}
        else {errors += 1}
      }
      return total
    }
    return Measurement(bytes: walk(target, 0), errors: errors, truncated: truncated)
  }

  // Size of a file or directory. Top-level symlinks are measured through once.
  static func measure(_ target: String, maxEntries: Int = 500_000) -> Measurement {
    if isDir(target) {return dirSize(target, maxEntries: maxEntries)}
    guard let info = lstatInfo(target) else {return Measurement(bytes: 0, errors: 1, truncated: false)}
    return Measurement(bytes: Int(info.st_size), errors: 0, truncated: false)
  }

  // Paths matching a glob, one segment at a time. Like the shell, wildcards
  // never match names starting with `.` unless the segment itself does.
  static func glob(_ pattern: String) -> [String] {
    let parts = pattern.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
    var current = [parts.first.flatMap {$0.isEmpty ? nil : $0} ?? "/"]
    for part in parts.dropFirst() where !part.isEmpty {
      var next: [String] = []
      for dir in current {
        if !hasGlobMagic(part) {
          let candidate = Paths.join(dir, part)
          if lexists(candidate) {next.append(candidate)}
          continue
        }
        guard let names = try? entries(dir).map(\.name) else {continue}
        for name in names.sorted() {
          if name.hasPrefix(".") && !part.hasPrefix(".") {continue}
          if fnmatch(name, part) {next.append(Paths.join(dir, name))}
        }
      }
      current = next
    }
    return current
  }

  // Bounded walk over `roots` calling `found` for dirs matching any of `patterns`
  // (return false to stop). Never descends into hidden dirs, symlinks, excluded
  // dirs, skipDirNames dirs, or a dir that already matched.
  static func iterMatches(_ roots: [String], _ patterns: [String], maxDepth: Int, maxDirs: Int, excludes: [String], warnings: inout [String], found: (String) -> Bool) {
    let matches = {(target: String) in patterns.contains {rulePatternMatches(target, $0)}}
    var stack = roots.reversed().map {($0, 0)}
    var visited = 0
    while let (current, depth) = stack.popLast() {
      visited += 1
      if visited > maxDirs {warnings.append("discovery exceeded \(maxDirs) directories; scan is partial"); return}
      if excluded(current, excludes) {continue}
      if matches(current) {if !found(current) {return}; continue}
      if depth >= maxDepth {continue}
      let list: [Entry]
      do {list = try entries(current)} catch {warnings.append("cannot read \(current): \(error.message)"); continue}
      for entry in list {
        if entry.type != UInt8(DT_DIR) || entry.name.hasPrefix(".") {continue}
        let child = current == "/" ? "/" + entry.name : current + "/" + entry.name
        if excluded(child, excludes) {continue}
        // A matched child is reported and never descended into. This must run
        // before the skipDirNames check, which contains matches.
        if matches(child) {if !found(child) {return}; continue}
        if skipDirNames.contains(entry.name) {continue}
        stack.append((child, depth + 1))
      }
    }
  }
}

// Shell-style (fnmatch) match where `*` and `?` also match `/`.
public func fnmatch(_ name: String, _ pattern: String) -> Bool {
  let s = Array(name.unicodeScalars), p = Array(pattern.unicodeScalars)
  var si = 0, pi = 0, star = -1, mark = 0
  while si < s.count {
    if pi < p.count, p[pi] == "*" {star = pi; mark = si; pi += 1; continue}
    if pi < p.count, let next = matchOne(p, pi, s[si]) {si += 1; pi = next; continue}
    guard star >= 0 else {return false}
    pi = star + 1; mark += 1; si = mark
  }
  while pi < p.count, p[pi] == "*" {pi += 1}
  return pi == p.count
}

// The pattern index after `p[pi]` when it matches `char`, else nil.
private func matchOne(_ p: [Unicode.Scalar], _ pi: Int, _ char: Unicode.Scalar) -> Int? {
  switch p[pi] {
  case "?": return pi + 1
  case "[":
    guard pi + 2 < p.count, let end = p[(pi + 2)...].firstIndex(of: "]") else {return char == "[" ? pi + 1 : nil}
    var body = Array(p[(pi + 1)..<end])
    let negate = body.first == "!"
    if negate {body.removeFirst()}
    var hit = false, i = 0
    while i < body.count {
      if i + 2 < body.count, body[i + 1] == "-" {hit = hit || (body[i]...body[i + 2]).contains(char); i += 3}
      else {hit = hit || body[i] == char; i += 1}
    }
    return hit != negate ? end + 1 : nil
  default: return p[pi] == char ? pi + 1 : nil
  }
}

func hasGlobMagic(_ value: String) -> Bool {value.contains {"*?[".contains($0)}}

// Expand a leading `~` against `home`, then $VAR / ${VAR} (unknown variables stay as-is).
func expandPath(_ entry: String, home: String, environment: [String: String] = ProcessInfo.processInfo.environment) -> String {
  var value = entry.hasPrefix("~") ? home + entry.dropFirst() : entry
  let regex = /\$(\w+)|\$\{(\w+)\}/
  value = value.replacing(regex) {match in
    let key = String(match.output.1 ?? match.output.2 ?? "")
    return environment[key] ?? String(match.output.0)
  }
  return Paths.normalize(value)
}

// True when the path matches any exclusion pattern (by basename or full path).
func excluded(_ target: String, _ patterns: [String]) -> Bool {
  guard !patterns.isEmpty else {return false}
  let full = Paths.normalize(target), base = Paths.basename(target)
  return patterns.contains {fnmatch(base, $0) || fnmatch(full, $0)}
}

// Match a rule `patterns` entry against a discovered directory:
// * `**/node_modules`: match on the basename at any depth;
// * pattern containing `/`: match against the full path;
// * anything else (e.g. `node_modules`): match on the basename.
func rulePatternMatches(_ target: String, _ pattern: String) -> Bool {
  if pattern.hasPrefix("**/") {return fnmatch(Paths.basename(target), String(pattern.dropFirst(3)))}
  if !pattern.contains("/") || pattern.hasPrefix("*") {return fnmatch(Paths.basename(target), pattern)}
  return fnmatch(target, pattern)
}
