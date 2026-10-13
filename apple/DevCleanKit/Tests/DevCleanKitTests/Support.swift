// Shared test helpers. No test touches the real home directory.
import Foundation
@testable import DevCleanKit

// The repository's rules/ directory, shared with the TypeScript scanner.
let rulesDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../rules").standardizedFileURL

// A temporary directory removed when the value is deinitialized.
final class TempDir {
  let path: String
  init() {
    let base = FileManager.default.temporaryDirectory.appendingPathComponent("devclean-test-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    path = FileSystem.realpath(base.path)!
  }
  deinit {
    // Restore permissions a test may have removed, so cleanup can't fail.
    if let walker = FileManager.default.enumerator(atPath: path) {for case let rel as String in walker {chmod(path + "/" + rel, 0o755)}}
    try? FileManager.default.removeItem(atPath: path)
  }
  func callAsFunction(_ rel: String) -> String {Paths.join(path, rel)}
}

// Create a file of exactly `size` bytes (sparse, fast).
@discardableResult
func makeFile(_ target: String, _ size: Int) -> String {
  try! FileManager.default.createDirectory(atPath: Paths.dirname(target), withIntermediateDirectories: true)
  FileManager.default.createFile(atPath: target, contents: nil)
  truncate(target, off_t(size))
  return target
}

// Build a tree from [relativePath: sizeBytes]; nil means an empty directory.
func buildTree(_ base: String, _ spec: [String: Int?]) {
  for (rel, size) in spec {
    let target = Paths.join(base, rel)
    if let size {makeFile(target, size)} else {try! FileManager.default.createDirectory(atPath: target, withIntermediateDirectories: true)}
  }
}

func rule(_ id: String, paths: [String] = [], patterns: [String] = []) -> Rule {
  Rule(id: id, name: "Test", category: "node", severity: .safe, reclaimable: true, description: "d", paths: paths, patterns: patterns, markers: [], rebuild: nil)
}

func options(home: String, _ configure: (inout ScanOptions) -> Void = {_ in}) -> ScanOptions {
  var opts = ScanOptions()
  opts.home = home
  configure(&opts)
  return opts
}

let isRoot = getuid() == 0
