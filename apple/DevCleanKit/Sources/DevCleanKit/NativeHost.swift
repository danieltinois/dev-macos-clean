// The native Host (core/host.ts) for the TypeScript engine: POSIX calls exposed
// to JavaScriptCore. Measuring sizes is the hot loop, so it runs natively with
// the semantics of core/filesystem.ts measure().
import Foundation
import JavaScriptCore

public struct Measurement: Equatable, Sendable {
  public var bytes: Int
  public var errors: Int
  public var truncated: Bool
}

public struct NativeHost: Sendable {
  public var home: String
  public var cwd: String
  // false makes the engine measure through readdir/lstat, to check parity in tests.
  public var nativeMeasure: Bool

  public init(home: String = NSHomeDirectory(), cwd: String = FileManager.default.currentDirectoryPath, nativeMeasure: Bool = true) {
    self.home = home; self.cwd = cwd; self.nativeMeasure = nativeMeasure
  }

  struct Entry {let name: String; let kind: String}
  struct ReadError: Error {let message: String}

  // The JavaScript object handed to the engine as its Host.
  func object(in context: JSContext) -> JSValue {
    let host = JSValue(newObjectIn: context)!
    // Blocks must be passed as Objective-C objects, not boxed Swift closures.
    func set(_ name: String, _ block: AnyObject) {host.setObject(block, forKeyedSubscript: name as NSString)}
    // Throwing inside a block: set the exception on the calling context.
    func fail(_ message: String) -> Any {
      if let current = JSContext.current() {current.exception = JSValue(newErrorFromMessage: message, in: current)}
      return NSNull()
    }
    let readdir: @convention(block) (String) -> Any = {path in
      do {return try Self.entries(path).map {["name": $0.name, "kind": $0.kind]}} catch {return fail(error.localizedDescription)}
    }
    let lstat: @convention(block) (String) -> Any = {Self.lstatInfo($0).map(Self.info) ?? NSNull()}
    let stat: @convention(block) (String) -> Any = {Self.statInfo($0).map(Self.info) ?? NSNull()}
    let realpath: @convention(block) (String) -> Any = {Self.realpath($0) ?? NSNull()}
    let env: @convention(block) (String) -> Any = {ProcessInfo.processInfo.environment[$0] ?? NSNull()}
    let home = self.home, cwd = self.cwd
    let homeBlock: @convention(block) () -> String = {home}
    let cwdBlock: @convention(block) () -> String = {cwd}
    let blocks: [(String, AnyObject)] = [
      ("readdir", unsafeBitCast(readdir, to: AnyObject.self)), ("lstat", unsafeBitCast(lstat, to: AnyObject.self)),
      ("stat", unsafeBitCast(stat, to: AnyObject.self)), ("realpath", unsafeBitCast(realpath, to: AnyObject.self)),
      ("env", unsafeBitCast(env, to: AnyObject.self)), ("home", unsafeBitCast(homeBlock, to: AnyObject.self)), ("cwd", unsafeBitCast(cwdBlock, to: AnyObject.self)),
    ]
    for (name, block) in blocks {set(name, block)}
    if nativeMeasure {
      let measure: @convention(block) (String, JSValue) -> [String: Any] = {path, options in
        let number = {(key: String, fallback: Int) in options.hasProperty(key) && !options.forProperty(key).isUndefined ? Int(options.forProperty(key).toInt32()) : fallback}
        let result = Self.measure(path, maxEntries: number("maxEntries", 500_000), maxDepth: number("maxDepth", 64))
        return ["bytes": result.bytes, "errors": result.errors, "truncated": result.truncated]
      }
      set("measure", unsafeBitCast(measure, to: AnyObject.self))
    }
    return host
  }

  private static func kind(_ mode: mode_t) -> String {
    switch mode & S_IFMT {case S_IFDIR: "dir"; case S_IFLNK: "symlink"; case S_IFREG: "file"; default: "other"}
  }

  private static func info(_ info: stat) -> [String: Any] {
    let m = info.st_mtimespec
    return ["kind": kind(info.st_mode), "size": Double(info.st_size), "mtimeMs": Double(m.tv_sec) * 1000 + Double(m.tv_nsec) / 1_000_000]
  }

  // readdir(3) without `.`/`..`. d_type avoids one lstat per entry; DT_UNKNOWN falls back to lstat.
  static func entries(_ path: String) throws(ReadError) -> [Entry] {
    guard let dir = opendir(path) else {throw ReadError(message: String(cString: strerror(errno)))}
    defer {closedir(dir)}
    var result: [Entry] = []
    while let pointer = readdir(dir) {
      let name = withUnsafeBytes(of: pointer.pointee.d_name) {String(decoding: $0.prefix(while: {$0 != 0}), as: UTF8.self)}
      if name == "." || name == ".." {continue}
      let kind: String = switch Int32(pointer.pointee.d_type) {
      case DT_DIR: "dir"
      case DT_LNK: "symlink"
      case DT_REG: "file"
      case DT_UNKNOWN: lstatInfo(path + "/" + name).map {Self.kind($0.st_mode)} ?? "other"
      default: "other"
      }
      result.append(Entry(name: name, kind: kind))
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

  static func realpath(_ path: String) -> String? {
    guard let resolved = Darwin.realpath(path, nil) else {return nil}
    defer {free(resolved)}
    return String(cString: resolved)
  }

  // core/filesystem.ts dirSize(): file symlinks are skipped, directory symlinks are
  // never descended into, per-entry errors are counted and the walk continues.
  static func dirSize(_ target: String, maxEntries: Int = 500_000, maxDepth: Int = 64) -> Measurement {
    var seen = 0, errors = 0, truncated = false
    func walk(_ current: String, _ depth: Int) -> Int {
      if truncated || depth > maxDepth {return 0}
      guard let list = try? entries(current) else {errors += 1; return 0}
      var total = 0
      for entry in list {
        seen += 1
        if seen > maxEntries {truncated = true; break}
        if entry.kind == "symlink" {continue}
        let child = current == "/" ? "/" + entry.name : current + "/" + entry.name
        if entry.kind == "dir" {total += walk(child, depth + 1)}
        else if let info = lstatInfo(child) {total += Int(info.st_size)}
        else {errors += 1}
      }
      return total
    }
    return Measurement(bytes: walk(target, 0), errors: errors, truncated: truncated)
  }

  // core/filesystem.ts measure(): top-level symlinks are measured through once.
  static func measure(_ target: String, maxEntries: Int = 500_000, maxDepth: Int = 64) -> Measurement {
    if let info = statInfo(target), info.st_mode & S_IFMT == S_IFDIR {return dirSize(target, maxEntries: maxEntries, maxDepth: maxDepth)}
    guard let info = lstatInfo(target) else {return Measurement(bytes: 0, errors: 1, truncated: false)}
    return Measurement(bytes: Int(info.st_size), errors: 0, truncated: false)
  }
}

extension NativeHost.ReadError: LocalizedError {var errorDescription: String? {message}}
