// The trusted side of cleanup, like desktop/cleanup.ts: the engine's policy
// (core/policy.ts) decides what may move; this captures identities at scan time,
// issues report tokens and revalidates every target right before the Trash.
//
// Flow: prepare -> select -> validate -> moveToTrash. Only the Trash is ever
// used: nothing here deletes permanently, and the Trash is never emptied.
import Foundation

public enum Cleanup {
  // Path -> identity captured by prepare(); a target must still match it when trashed.
  public typealias Manifest = [String: String]
  public struct Outcome: Sendable {
    public var moved: [(path: String, sizeBytes: Int)] = []
    public var errors: [(path: String, message: String)] = []
    public init() {}
  }
  public struct Failure: LocalizedError, Equatable {
    public let message: String
    public init(_ message: String) {self.message = message}
    public var errorDescription: String? {message}
  }

  // How a target is identified: files by fileIdentity, photos by PhotoLibrary.identity.
  public typealias Identity = (String) throws -> String

  // Annotate every finding with the engine's decision and capture identities.
  public static func prepare(_ report: Report, engine: Engine, home: String, appRoot: String, now: Date = Date(), identity: Identity = fileIdentity) throws -> (report: Report, manifest: Manifest) {
    let decisions = try engine.decide(report, home: home, appRoot: appRoot, now: now)
    var manifest: Manifest = [:]
    var prepared = report
    prepared.findings = zip(report.findings, decisions).map {original, decision in
      var f = original
      var reason = decision.reason
      if decision.allowed {
        if let id = try? identity(f.path) {
          manifest[f.path] = id
          f.cleanupAllowed = true; f.cleanupReview = decision.review; f.cleanupReason = ""; f.autoClean = decision.auto
          return f
        }
        reason = "Caminho indisponível ou contém link simbólico. Analise novamente."
      }
      f.cleanupAllowed = false; f.cleanupReview = false; f.cleanupReason = reason; f.autoClean = false
      return f
    }
    prepared.cleanupToken = newToken()
    return (prepared, manifest)
  }

  // Findings for `indices` of `report`, only when the token matches and the engine allows them.
  public static func select(_ report: Report?, indices: [Int], token: String?, engine: Engine) throws -> [Finding] {
    guard let report, let token, token == report.cleanupToken else {throw Failure("Relatório desatualizado. Analise novamente.")}
    return try engine.select(report.findings, indices: indices)
  }

  public static func validate(_ selected: [Finding], manifest: Manifest, identity: Identity = fileIdentity) throws {
    for f in selected {
      guard let expected = manifest[f.path], (try? identity(f.path)) == expected else {throw Failure("O diretório mudou desde a análise: \(f.path). Analise novamente.")}
    }
  }

  // Revalidate each item right before moving it with `trash` (FileManager.trashItem in the app).
  public static func moveToTrash(_ selected: [Finding], manifest: inout Manifest, engine: Engine, trash: (String) throws -> Void) throws -> Outcome {
    try validate(selected, manifest: manifest)
    var outcome = Outcome()
    for f in selected {
      do {
        try validate([f], manifest: manifest)
        let extra = try engine.companions(f)
        try trash(f.path)
        manifest[f.path] = nil
        for file in extra {try? trash(file)}
        outcome.moved.append((f.path, f.sizeBytes))
      } catch {outcome.errors.append((f.path, error.localizedDescription))}
    }
    return outcome
  }

  // The report without the moved paths, with fresh totals and a new token.
  public static func remainingReport(_ report: Report, moved: [String], engine: Engine) throws -> Report {
    var next = try engine.remaining(report, moved: moved)
    next.cleanupToken = newToken()
    return next
  }

  // realpath, device, inode, mtime and ctime of a canonical, symlink-free path.
  public static func fileIdentity(_ target: String) throws -> String {
    if Paths.resolve(target) != target {throw Failure("Caminho não canônico.")}
    var current = target
    while true {
      guard let info = NativeHost.lstatInfo(current) else {throw Failure("Caminho indisponível.")}
      if info.st_mode & S_IFMT == S_IFLNK {throw Failure("Links simbólicos não podem ser limpos.")}
      let parent = Paths.dirname(current)
      if parent == current {break}
      current = parent
    }
    guard let info = NativeHost.lstatInfo(target), let real = NativeHost.realpath(target) else {throw Failure("Caminho indisponível.")}
    let kind = info.st_mode & S_IFMT
    if kind != S_IFDIR && kind != S_IFREG {throw Failure("O alvo não é um arquivo nem um diretório.")}
    let m = info.st_mtimespec, c = info.st_ctimespec
    return "\(real):\(info.st_dev):\(info.st_ino):\(m.tv_sec).\(m.tv_nsec):\(c.tv_sec).\(c.tv_nsec)"
  }

  private static func newToken() -> String {UUID().uuidString.lowercased()}

  // The real Trash. Never removes anything permanently.
  public static func systemTrash(_ path: String) throws {
    try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: nil)
  }
}
