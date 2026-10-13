// Shared test helpers. No test touches the real home directory.
import Foundation
@testable import DevCleanKit

// The engine bundle built from core/ by `bun run build:engine` (`bun run test:apple` does both).
let engineURL = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../dist/engine/devclean-engine.js").standardizedFileURL

func makeEngine(home: String = NSHomeDirectory(), nativeMeasure: Bool = true) throws -> Engine {
  guard let script = try? String(contentsOf: engineURL, encoding: .utf8) else {
    throw EngineError(message: "missing \(engineURL.path): run `bun run build:engine` first")
  }
  return try Engine(script: script, host: NativeHost(home: home, nativeMeasure: nativeMeasure))
}

// A temporary directory removed when the value is deinitialized.
final class TempDir {
  let path: String
  init() {
    let base = FileManager.default.temporaryDirectory.appendingPathComponent("devclean-test-\(UUID().uuidString)")
    try! FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    path = NativeHost.realpath(base.path)!
  }
  deinit {
    // Restore permissions a test may have removed, so cleanup can't fail.
    if let walker = FileManager.default.enumerator(atPath: path) {for case let rel as String in walker {chmod(path + "/" + rel, 0o755)}}
    try? FileManager.default.removeItem(atPath: path)
  }
  func callAsFunction(_ rel: String) -> String {Paths.join(path, rel)}
}

// Create a file holding `size` real bytes (a truncated file would be sparse,
// and sizes count what files take on disk).
@discardableResult
func makeFile(_ target: String, _ size: Int) -> String {
  try! FileManager.default.createDirectory(atPath: Paths.dirname(target), withIntermediateDirectories: true)
  FileManager.default.createFile(atPath: target, contents: Data(repeating: 0x78, count: size))
  return target
}

// Build a tree from [relativePath: sizeBytes]; nil means an empty directory.
func buildTree(_ base: String, _ spec: [String: Int?]) {
  for (rel, size) in spec {
    let target = Paths.join(base, rel)
    if let size {makeFile(target, size)} else {try! FileManager.default.createDirectory(atPath: target, withIntermediateDirectories: true)}
  }
}

let isRoot = getuid() == 0
