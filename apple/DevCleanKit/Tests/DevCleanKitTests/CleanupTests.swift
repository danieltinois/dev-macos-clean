// Cleanup through the engine's policy and the native trusted side, mirroring
// desktop/cleanup.test.ts. A fake trash records calls; nothing reaches the real Trash.
import Foundation
import Testing
@testable import DevCleanKit

private struct Fixture {
  let dir = TempDir()
  var home: String {dir.path}
  var appRoot: String {dir("app")}
  let target: String
  let finding: Finding
  let engine = try! makeEngine()
  init() {
    target = Paths.join(dir.path, ".npm/_cacache")
    makeFile(Paths.join(target, "cache"), 5)
    finding = Finding(ruleId: "npm-cache", category: "node", severity: .safe, path: target, sizeBytes: 5)
  }
  func mkdir(_ rel: String) -> String {
    let path = dir(rel)
    try! FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
    return path
  }
  func prepare(_ findings: [Finding], now: Date = Date()) -> (report: Report, manifest: Cleanup.Manifest) {
    try! Cleanup.prepare(Report(schemaVersion: 1, scannedAt: "", roots: [], options: ReportOptions(globalScan: false, maxDepth: 6, maxFindings: 500, excludes: [], categories: []),
                           totals: Totals(findings: 0, bytes: 0, bySeverity: [:], byCategory: [:]), findings: findings, warnings: []),
                     engine: engine, home: home, appRoot: appRoot, now: now)
  }
}

@Suite struct CleanupTests {
  @Test func movesOnlySelectedTargetsAndRefreshesTotals() throws {
    let fx = Fixture()
    var (report, manifest) = fx.prepare([fx.finding])
    let items = try Cleanup.select(report, indices: [0, 0], token: report.cleanupToken, engine: fx.engine)
    #expect(items.count == 1)
    var called: [String] = []
    let outcome = try Cleanup.moveToTrash(items, manifest: &manifest, engine: fx.engine) {called.append($0)}
    #expect(called == [fx.target])
    let remaining = try Cleanup.remainingReport(report, moved: outcome.moved.map(\.path), engine: fx.engine)
    #expect(remaining.totals.bytes == 0 && remaining.findings.isEmpty)
    #expect(remaining.cleanupToken != report.cleanupToken)
    #expect(throws: Cleanup.Failure.self) {try Cleanup.moveToTrash(items, manifest: &manifest, engine: fx.engine) {_ in Issue.record("Repeated cleanup")}}
    report = remaining
    #expect(report.findings.isEmpty)
  }

  @Test func blocksArbitraryReviewDangerPartialAndOwnPaths() throws {
    let fx = Fixture()
    let own = fx.mkdir("app/node_modules")
    var variants = [fx.finding, fx.finding, fx.finding, fx.finding, fx.finding]
    variants[0].path = fx.home
    variants[1].severity = .review
    variants[2].severity = .danger
    variants[3].sizeComplete = false
    variants[4].ruleId = "node-modules"; variants[4].path = own; variants[4].metadata = ["package.json": "yes"]
    for f in variants {
      let (report, _) = fx.prepare([f])
      #expect(report.findings[0].cleanupAllowed == false)
      #expect(throws: (any Error).self) {try Cleanup.select(report, indices: [0], token: report.cleanupToken, engine: fx.engine)}
    }
  }

  @Test func rejectsSymlinksAndReplacedDirectories() throws {
    let fx = Fixture()
    var (report, manifest) = fx.prepare([fx.finding])
    let items = try Cleanup.select(report, indices: [0], token: report.cleanupToken, engine: fx.engine)
    rename(fx.target, fx.target + "-old")
    symlink(fx.target + "-old", fx.target)
    #expect(throws: Cleanup.Failure.self) {try Cleanup.moveToTrash(items, manifest: &manifest, engine: fx.engine) {_ in Issue.record("Unsafe trash")}}
    (report, _) = fx.prepare([fx.finding])
    #expect(report.findings[0].cleanupAllowed == false)
  }

  @Test func rejectsInvalidIndicesAndOldTokens() {
    let fx = Fixture()
    let (report, _) = fx.prepare([fx.finding])
    for indices in [[], [-1], [999]] {#expect(throws: (any Error).self) {try Cleanup.select(report, indices: indices, token: report.cleanupToken, engine: fx.engine)}}
    #expect(throws: (any Error).self) {try Cleanup.select(report, indices: [0], token: "old", engine: fx.engine)}
    #expect(throws: (any Error).self) {try Cleanup.select(nil, indices: [0], token: report.cleanupToken, engine: fx.engine)}
  }

  @Test func rejectsOverlappingSelections() throws {
    let fx = Fixture()
    func project(_ rel: String) -> Finding {
      makeFile(fx.dir("\(rel)/package.json"), 2)
      var f = fx.finding
      f.ruleId = "node-modules"; f.path = fx.mkdir("\(rel)/node_modules"); f.metadata = ["package.json": "yes"]
      return f
    }
    let (report, _) = fx.prepare([project("code/a"), project("code/a/node_modules/tool")])
    #expect(report.findings.map(\.cleanupAllowed) == [true, true])
    #expect(throws: EngineError(message: "A seleção contém diretórios sobrepostos.")) {try Cleanup.select(report, indices: [0, 1], token: report.cleanupToken, engine: fx.engine)}
  }

  @Test func preservesFailedItemsOnPartialSuccess() throws {
    let fx = Fixture()
    var gradle = fx.finding
    gradle.ruleId = "gradle-cache"; gradle.path = fx.mkdir(".gradle/caches")
    var (report, manifest) = fx.prepare([fx.finding, gradle])
    let items = try Cleanup.select(report, indices: [0, 1], token: report.cleanupToken, engine: fx.engine)
    let outcome = try Cleanup.moveToTrash(items, manifest: &manifest, engine: fx.engine) {if $0 == gradle.path {throw Cleanup.Failure("Permission denied")}}
    #expect(outcome.moved.count == 1 && outcome.errors.count == 1)
    report = try Cleanup.remainingReport(report, moved: outcome.moved.map(\.path), engine: fx.engine)
    #expect(report.findings.map(\.path) == [gradle.path])
  }

  @Test func projectOutputsNeedRealMarkers() throws {
    let fx = Fixture()
    var rust = fx.finding
    rust.ruleId = "rust-target"; rust.path = fx.mkdir("code/crate/target"); rust.metadata = ["Cargo.toml": "yes"]
    var support = fx.finding
    support.ruleId = "xcode-device-support"; support.path = fx.mkdir("Library/Developer/Xcode/watchOS DeviceSupport")
    #expect(fx.prepare([rust, support]).report.findings.map(\.cleanupAllowed) == [false, true])
    makeFile(fx.dir("code/crate/Cargo.toml"), 1)
    #expect(fx.prepare([rust]).report.findings[0].cleanupAllowed == true)
    var global = rust
    global.ruleId = "node-modules"; global.path = "/opt/homebrew/lib/node_modules"; global.metadata = ["package.json": "yes"]
    #expect(fx.prepare([global]).report.findings[0].cleanupAllowed == false)
  }

  @Test func versionedAndroidStudioCachesMatchDirectChildrenOnly() {
    let fx = Fixture()
    let cases = [("Library/Caches/Google/AndroidStudio2026.2", true), ("Library/Caches/Google/AndroidStudio", false),
                 ("Library/Caches/Google/Chrome", false), ("Library/Caches/Google/AndroidStudio2026.2/x", false)]
    let findings = cases.map {rel, _ in var f = fx.finding; f.ruleId = "jetbrains-caches"; f.path = fx.mkdir(rel); return f}
    #expect(fx.prepare(findings).report.findings.map(\.cleanupAllowed) == cases.map {Optional($0.1)})
  }

  @Test func automaticCleanupCoversSelfRecreatingCachesAndStaleProjects() {
    let fx = Fixture()
    let now = Date(timeIntervalSince1970: 1_791_417_600), day = 86400.0
    func project(_ name: String, age: Double?) -> Finding {
      makeFile(fx.dir("code/\(name)/package.json"), 2)
      var f = fx.finding
      f.ruleId = "node-modules"; f.path = fx.mkdir("code/\(name)/node_modules"); f.metadata = ["package.json": "yes"]
      f.lastModified = age.map {isoString(now.addingTimeInterval(-$0 * day))}
      return f
    }
    var jetbrains = fx.finding
    jetbrains.ruleId = "jetbrains-caches"; jetbrains.path = fx.mkdir("Library/Caches/JetBrains")
    var review = fx.finding
    review.severity = .review
    let report = fx.prepare([fx.finding, project("old", age: 120), project("active", age: 5), project("unknown", age: nil), jetbrains, review], now: now).report
    #expect(report.findings.map(\.autoClean) == [true, true, false, false, false, false])
    #expect(report.findings.map(\.cleanupAllowed) == [true, true, true, true, true, false])
  }

  @Test func reviewItemsAreManualOnlyAndRiskyOnesStayBlocked() throws {
    let fx = Fixture()
    func review(_ ruleId: String, _ path: String, complete: Bool = true) -> Finding {
      var f = fx.finding
      f.ruleId = ruleId; f.path = path; f.severity = .review; f.reclaimable = false; f.sizeComplete = complete
      return f
    }
    let avd = fx.mkdir(".android/avd/Pixel.avd")
    let ini = makeFile(fx.dir(".android/avd/Pixel.ini"), 5)
    let cacheFile = makeFile(fx.dir("Library/Caches/thumb.png"), 3)
    let prepared = fx.prepare([
      review("android-avds", avd),
      review("user-app-caches", fx.mkdir("Library/Caches/com.spotify.client")),
      review("user-app-caches", cacheFile),
      review("user-logs", fx.mkdir("Library/Logs/DiagnosticReports")),
      review("downloads", fx.mkdir("Downloads")),
      review("user-app-caches", fx.mkdir("Library/Caches/CloudKit"), complete: false),
      review("user-app-caches", fx.mkdir("Library/Caches/a/b")),
      review("android-avds", fx.mkdir(".android/avd/notes")),
    ])
    let report = prepared.report
    var manifest = prepared.manifest
    #expect(report.findings.map(\.cleanupAllowed) == [true, true, true, true, false, false, false, false])
    #expect(report.findings.filter {$0.cleanupAllowed == true}.allSatisfy {$0.cleanupReview == true && $0.autoClean == false})
    #expect(report.findings.filter {$0.cleanupAllowed != true}.allSatisfy {($0.cleanupReason ?? "").count > 10})
    let items = try Cleanup.select(report, indices: [0, 2], token: report.cleanupToken, engine: fx.engine)
    var called: [String] = []
    _ = try Cleanup.moveToTrash(items, manifest: &manifest, engine: fx.engine) {called.append($0)}
    #expect(called == [avd, ini, cacheFile])
  }
}
