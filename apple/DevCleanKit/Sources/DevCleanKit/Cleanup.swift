// Cleanup policy, mirroring desktop/cleanup.ts. The scanner decides what
// exists; this decides what may be moved. A rule never grants cleanup.
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
  }
  public struct Failure: LocalizedError, Equatable {
    public let message: String
    public init(_ message: String) {self.message = message}
    public var errorDescription: String? {message}
  }

  // Fixed, home-relative locations of known regenerable caches. A trailing `*`
  // matches versioned folder names directly inside the same parent.
  static let targets: [String: [String]] = [
    "homebrew-cache": ["Library/Caches/Homebrew"],
    "pip-cache": ["Library/Caches/pip", ".cache/pip"],
    "cargo-cache": [".cargo/registry/cache"],
    "npm-cache": [".npm/_cacache"],
    "gradle-cache": [".gradle/caches"],
    "gradle-wrapper": [".gradle/wrapper/dists"],
    "pnpm-cache": ["Library/Caches/pnpm"],
    "yarn-cache": ["Library/Caches/Yarn"],
    "bun-cache": [".bun/install/cache"],
    "playwright-browsers": ["Library/Caches/ms-playwright"],
    "xcode-derived-data": ["Library/Developer/Xcode/DerivedData"],
    "xcode-device-support": ["Library/Developer/Xcode/iOS DeviceSupport", "Library/Developer/Xcode/watchOS DeviceSupport", "Library/Developer/Xcode/tvOS DeviceSupport"],
    "ios-simulator-caches": ["Library/Developer/CoreSimulator/Caches"],
    "cocoapods-cache": ["Library/Caches/CocoaPods"],
    "go-build-cache": ["Library/Caches/go-build"],
    "go-mod-cache": ["go/pkg/mod"],
    "pub-cache": [".pub-cache/hosted"],
    "jetbrains-caches": ["Library/Caches/JetBrains", "Library/Caches/Google/AndroidStudio*"],
  ]
  // Per-project build outputs: directory name and the project file that must sit next to it.
  static let projectOutputs: [String: (dir: String, marker: String)] = [
    "node-modules": ("node_modules", "package.json"),
    "rust-target": ("target", "Cargo.toml"),
  ]
  // Automatic cleanup: caches the tool recreates by itself, with no manual step,
  // no lost local work and no open app holding them. Everything else needs a click.
  static let automatic: Set = [
    "xcode-derived-data", "ios-simulator-caches", "cocoapods-cache", "homebrew-cache", "pip-cache",
    "npm-cache", "pnpm-cache", "yarn-cache", "bun-cache", "go-build-cache", "gradle-cache", "gradle-wrapper", "pub-cache",
  ]
  public static let staleDays = 90.0
  // "Revisar" items the user may still send to the Trash by hand: never automatic,
  // always flagged in the confirmation. Matched against fixed home-relative places.
  static let reviewTargets: [String: [String]] = [
    "android-system-images": ["Library/Android/sdk/system-images"],
    "android-avds": [".android/avd/*.avd"],
    "xcode-archives": ["Library/Developer/Xcode/Archives"],
    "maven-repository": [".m2/repository"],
    "user-app-caches": ["Library/Caches/*"],
    "user-logs": ["Library/Logs/*"],
  ]
  // Review items that stay blocked, with the way to clean them instead.
  static let blockedReasons: [String: String] = [
    "downloads": "Mover a pasta Downloads inteira quebraria o Finder. Use “Mostrar no Finder” e escolha os arquivos.",
    "docker-data": "Apagar o disco do Docker corrompe containers e volumes. Use os comandos em Detalhes.",
    "ios-simulators": "Remova simuladores pelo Xcode ou com o comando em Detalhes.",
  ]

  // Project outputs only qualify when the project has not been touched for staleDays.
  static func isAutomatic(_ finding: Finding, now: Date) -> Bool {
    if automatic.contains(finding.ruleId) {return true}
    guard projectOutputs[finding.ruleId] != nil, let modified = finding.modifiedDate else {return false}
    return now.timeIntervalSince(modified) >= staleDays * 86400
  }

  static func matches(_ target: String, home: String, _ rel: String) -> Bool {
    let full = Paths.join(home, rel)
    if !rel.contains("*") {return target == full}
    if Paths.dirname(target) != Paths.dirname(full) {return false}
    let pieces = Paths.basename(full).split(separator: "*", maxSplits: 1, omittingEmptySubsequences: false)
    let prefix = String(pieces[0]), suffix = pieces.count > 1 ? String(pieces[1]) : ""
    let name = Paths.basename(target)
    return name.hasPrefix(prefix) && name.hasSuffix(suffix) && name.count > prefix.count + suffix.count
  }

  // Either path contains the other.
  static func overlaps(_ a: String, _ b: String) -> Bool {Paths.isInside(a, b) || Paths.isInside(b, a)}

  // Cleanup policy for one finding: (allowed, review, reason).
  static func policy(_ finding: Finding, home: String, appRoot: String) -> (allowed: Bool, review: Bool, reason: String) {
    let target = Paths.resolve(finding.path)
    let deny = {(reason: String) in (false, false, reason)}
    if overlaps(target, appRoot) {return deny("Arquivos do próprio DevClean estão protegidos.")}
    if !finding.sizeComplete {return deny("O macOS não permitiu ler tudo nesta pasta. Conceda Acesso Total ao Disco ou limpe pelo Finder.")}
    if let blocked = blockedReasons[finding.ruleId] {return deny(blocked)}
    if let project = projectOutputs[finding.ruleId] {
      if !target.hasPrefix(home + "/") {return deny("Pacotes instalados globalmente ficam fora da limpeza. Desinstale pelo gerenciador de pacotes.")}
      let ok = Paths.basename(target) == project.dir && finding.metadata[project.marker] == "yes" && target != Paths.join(home, project.dir)
      return ok ? (true, false, "") : deny("Só é limpo quando há \(project.marker) no projeto.")
    }
    if finding.severity == .safe && finding.reclaimable && (targets[finding.ruleId] ?? []).contains(where: {matches(target, home: home, $0)}) {return (true, false, "")}
    if finding.severity != .danger && (reviewTargets[finding.ruleId] ?? []).contains(where: {matches(target, home: home, $0)}) {return (true, true, "")}
    return deny("Este local não está na lista de limpeza do DevClean.")
  }

  static func hasMarker(_ finding: Finding) -> Bool {
    guard let project = projectOutputs[finding.ruleId] else {return true}
    return FileSystem.lstatInfo(Paths.join(Paths.dirname(finding.path), project.marker)).map {$0.st_mode & S_IFMT == S_IFREG} ?? false
  }

  // Files that belong to a target and go to the Trash with it (an AVD's .ini).
  static func companions(_ finding: Finding) -> [String] {
    guard finding.ruleId == "android-avds", finding.path.hasSuffix(".avd") else {return []}
    let ini = String(finding.path.dropLast(4)) + ".ini"
    return FileSystem.lstatInfo(ini).map {$0.st_mode & S_IFMT == S_IFREG} == true ? [ini] : []
  }

  // realpath, device, inode, mtime and ctime of a canonical, symlink-free path.
  static func identity(_ target: String) throws -> String {
    if Paths.resolve(target) != target {throw Failure("Caminho não canônico.")}
    var current = target
    while true {
      guard let info = FileSystem.lstatInfo(current) else {throw Failure("Caminho indisponível.")}
      if info.st_mode & S_IFMT == S_IFLNK {throw Failure("Links simbólicos não podem ser limpos.")}
      let parent = Paths.dirname(current)
      if parent == current {break}
      current = parent
    }
    guard let info = FileSystem.lstatInfo(target), let real = FileSystem.realpath(target) else {throw Failure("Caminho indisponível.")}
    let kind = info.st_mode & S_IFMT
    if kind != S_IFDIR && kind != S_IFREG {throw Failure("O alvo não é um arquivo nem um diretório.")}
    let m = info.st_mtimespec, c = info.st_ctimespec
    return "\(real):\(info.st_dev):\(info.st_ino):\(m.tv_sec).\(m.tv_nsec):\(c.tv_sec).\(c.tv_nsec)"
  }

  // Annotate every finding of `report` with its cleanup policy and capture identities.
  public static func prepare(_ report: Report, home: String, appRoot: String, now: Date = Date()) -> (report: Report, manifest: Manifest) {
    var manifest: Manifest = [:]
    var prepared = report
    prepared.findings = report.findings.map {original in
      var f = original
      var (allowed, review, reason) = policy(f, home: home, appRoot: appRoot)
      if allowed && !hasMarker(f) {(allowed, reason) = (false, "O arquivo do projeto não existe mais. Analise novamente.")}
      if allowed {
        if let id = try? identity(f.path) {
          manifest[f.path] = id
          f.cleanupAllowed = true; f.cleanupReview = review; f.cleanupReason = ""; f.autoClean = !review && isAutomatic(f, now: now)
          return f
        }
        reason = "Caminho indisponível ou contém link simbólico. Analise novamente."
      }
      f.cleanupAllowed = false; f.cleanupReview = false; f.cleanupReason = reason; f.autoClean = false
      return f
    }
    prepared.cleanupToken = UUID().uuidString.lowercased()
    return (prepared, manifest)
  }

  // Findings for `indices` of `report`, only when the token matches and every item is cleanable.
  public static func select(_ report: Report?, indices: [Int], token: String?) throws -> [Finding] {
    guard let report, let token, token == report.cleanupToken else {throw Failure("Relatório desatualizado. Analise novamente.")}
    if indices.isEmpty || indices.count > 1000 {throw Failure("Seleção inválida.")}
    var unique: [Int] = []
    for index in indices where !unique.contains(index) {unique.append(index)}
    let selected = try unique.map {index in
      guard report.findings.indices.contains(index), report.findings[index].cleanupAllowed == true else {throw Failure("Item não autorizado para limpeza.")}
      return report.findings[index]
    }
    for i in selected.indices {
      for j in selected.indices where j > i && overlaps(selected[i].path, selected[j].path) {throw Failure("A seleção contém diretórios sobrepostos.")}
    }
    return selected
  }

  public static func validate(_ selected: [Finding], manifest: Manifest) throws {
    for f in selected {
      guard let expected = manifest[f.path], (try? identity(f.path)) == expected else {throw Failure("O diretório mudou desde a análise: \(f.path). Analise novamente.")}
    }
  }

  // Revalidate each item right before moving it with `trash` (FileManager.trashItem in the app).
  public static func moveToTrash(_ selected: [Finding], manifest: inout Manifest, trash: (String) throws -> Void) throws -> Outcome {
    try validate(selected, manifest: manifest)
    var outcome = Outcome()
    for f in selected {
      do {
        try validate([f], manifest: manifest)
        let extra = companions(f)
        try trash(f.path)
        manifest[f.path] = nil
        for file in extra {try? trash(file)}
        outcome.moved.append((f.path, f.sizeBytes))
      } catch {outcome.errors.append((f.path, error.localizedDescription))}
    }
    return outcome
  }

  // The report without the moved paths, with fresh totals and a new token.
  public static func remainingReport(_ report: Report, moved: [String]) -> Report {
    let removed = Set(moved)
    var next = report
    next.findings = report.findings.filter {!removed.contains($0.path)}
    next.totals = buildTotals(next.findings)
    next.cleanupToken = UUID().uuidString.lowercased()
    return next
  }

  // The real Trash. Never removes anything permanently.
  public static func systemTrash(_ path: String) throws {
    try FileManager.default.trashItem(at: URL(fileURLWithPath: path), resultingItemURL: nil)
  }
}
