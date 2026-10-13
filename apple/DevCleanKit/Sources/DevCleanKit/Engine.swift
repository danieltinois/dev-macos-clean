// Runs the TypeScript engine (core/jsc.ts, bundled by `bun run build:engine`)
// in JavaScriptCore with a native Host. Scanning, rules and the cleanup policy
// all live in TypeScript; data crosses the bridge as JSON.
//
// An Engine is not thread-safe: create one per task (they are cheap).
import Foundation
import JavaScriptCore

public struct EngineError: LocalizedError, Equatable {
  public let message: String
  public var errorDescription: String? {message}
}

// core/scanner.ts ScanOptions. nil fields take the engine defaults.
public struct ScanOptions: Encodable, Sendable {
  public var roots: [String]?
  public var categories: [String]?
  public var excludes: [String]?
  public var maxDepth: Int?
  public var maxDirs: Int?
  public var maxFindings: Int?
  public var maxEntries: Int?
  public var home: String?
  public var globalScan: Bool?
  public var usersDir: String?
  // "disk", "photos" and/or "files"; the engine skips photos and files when the host has none.
  public var sources: [String]?
  public var now: Double?
  public init(home: String? = nil, globalScan: Bool? = nil, sources: [String]? = nil) {self.home = home; self.globalScan = globalScan; self.sources = sources}
}

// The engine's cleanup decision for one finding (core/policy.ts).
public struct Decision: Decodable, Equatable, Sendable {
  public var allowed: Bool
  public var review: Bool
  public var reason: String
  public var auto: Bool
}

// Floco's pose (core/cat.ts Pose): animation time, broom angle, gaze, mouth,
// ear flick, head tilt, hop and tail swish.
public struct CatPose: Encodable, Equatable, Sendable {
  public var t = 0.0, sweep = 0.0
  public var look = 0, mouth = 0, tilt = 0
  public var ear = false, hop = false
  public var swish = 0.0
  public init() {}
}

public final class Engine {
  public static let resourceName = "devclean-engine"
  private let context: JSContext
  private let api: JSValue
  private let host: JSValue

  public init(script: String, host: NativeHost = NativeHost()) throws {
    guard let context = JSContext() else {throw EngineError(message: "JavaScriptCore indisponível.")}
    self.context = context
    context.evaluateScript(script, withSourceURL: URL(string: "devclean-engine.js"))
    api = context.objectForKeyedSubscript("DevCleanEngine")
    self.host = host.object(in: context)
    try check()
    if api.isUndefined {throw EngineError(message: "O motor do DevClean não carregou.")}
  }

  // The engine shipped in the app bundle by the Xcode build phase.
  public static func bundled(in bundle: Bundle = .main, host: NativeHost = NativeHost()) throws -> Engine {
    guard let url = bundle.url(forResource: resourceName, withExtension: "js"), let script = try? String(contentsOf: url, encoding: .utf8) else {
      throw EngineError(message: "Motor do DevClean não encontrado no app. Recompile com o Bun instalado.")
    }
    return try Engine(script: script, host: host)
  }

  public var ruleCount: Int {get throws {Int(try invoke("ruleCount", []).toInt32())}}

  public func scan(_ options: ScanOptions) throws -> Report {
    try decode(invoke("scan", [host, json(options)]))
  }

  public func decide(_ report: Report, home: String, appRoot: String, now: Date) throws -> [Decision] {
    try decode(invoke("decide", [host, json(report), home, appRoot, now.timeIntervalSince1970 * 1000]))
  }

  // The findings at `indices`; throws when one is not cleanable or two overlap.
  public func select(_ findings: [Finding], indices: [Int]) throws -> [Finding] {
    try decode(invoke("select", [json(findings), json(indices)]))
  }

  // Files that go to the Trash together with `finding` (an AVD's .ini).
  public func companions(_ finding: Finding) throws -> [String] {
    try decode(invoke("companions", [host, json(finding)]))
  }

  // `report` without `moved`, with fresh totals.
  public func remaining(_ report: Report, moved: [String]) throws -> Report {
    try decode(invoke("remaining", [json(report), json(moved)]))
  }

  // ASCII art drawn by core/ascii.ts and core/cat.ts, the same code as the CLI.
  public func banner() throws -> String {try invoke("banner", []).toString()}
  public func spinner() throws -> [String] {try decode(invoke("spinner", []))}
  // The whole cat (tail and broom), or the bust for the tutorial.
  public func cat(_ mood: String, _ pose: CatPose, bust: Bool = false) throws -> String {
    try invoke(bust ? "portrait" : "cat", [mood, json(pose)]).toString()
  }

  private func invoke(_ name: String, _ arguments: [Any]) throws -> JSValue {
    let result = api.invokeMethod(name, withArguments: arguments)
    try check()
    guard let result else {throw EngineError(message: "O motor não respondeu a \(name).")}
    return result
  }

  // JavaScriptCore stores uncaught exceptions on the context.
  private func check() throws {
    guard let exception = context.exception else {return}
    context.exception = nil
    let message = exception.forProperty("message")
    throw EngineError(message: message.map {$0.isUndefined ? exception.toString() : $0.toString()} ?? exception.toString())
  }

  private func json<T: Encodable>(_ value: T) throws -> String {String(decoding: try JSONEncoder().encode(value), as: UTF8.self)}
  private func decode<T: Decodable>(_ value: JSValue) throws -> T {try JSONDecoder().decode(T.self, from: Data(value.toString().utf8))}
}
