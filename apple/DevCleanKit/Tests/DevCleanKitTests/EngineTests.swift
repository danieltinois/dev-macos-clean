// The TypeScript engine running in JavaScriptCore with the native host. The
// fixtures mirror core/scanner.test.ts, so results must match the Node engine.
import Foundation
import Testing
@testable import DevCleanKit

@Suite struct EngineTests {
  func makeHome(_ dir: TempDir) -> String {
    let home = dir("home")
    buildTree(home, [
      "projects/a/package.json": 50, "projects/a/package-lock.json": 60,
      "projects/a/node_modules/pkg/index.js": 100, "projects/a/node_modules/pkg/dep.js": 100,
      "projects/b/package.json": 50, "projects/b/yarn.lock": 60, "projects/b/node_modules/x/y.js": 100,
      "projects/c/package.json": 50,
      ".hidden/projects/h/node_modules/y": 10, ".git/something/node_modules/z": 10,
      "projects/a/node_modules/pkg/node_modules/internal/x": 10,
      "Library/Developer/Xcode/DerivedData/App-abc/Build/x.app/one": 500,
      "Library/Caches/pnpm/store/v3/x": 44, "Library/Caches/Yarn/v6/x": 33,
      "Library/Android/sdk/system-images/android-35/arm64/system.img": 200,
      ".gradle/caches/modules-2/files/x/y/z.jar": 300, ".npm/_cacache/content-v2/x": 40,
      ".android/avd/pixel.avd/userdata-qemu.img": 50, ".android/avd/pixel.avd/emulator-user.ini": 20, ".android/avd/nexus.avd/config.ini": 20,
    ])
    return home
  }

  func counts(_ report: Report) -> [String: Int] {report.findings.reduce(into: [:]) {$0[$1.ruleId, default: 0] += 1}}

  @Test func loadsEveryRuleEmbeddedInTheBundle() throws {
    let rules = try FileManager.default.contentsOfDirectory(atPath: engineURL.appendingPathComponent("../../../rules").standardizedFileURL.path).filter {$0.hasSuffix(".json")}
    #expect(try makeEngine().ruleCount == rules.count)
  }

  @Test func fullScanMatchesTheNodeEngine() throws {
    let dir = TempDir()
    let report = try makeEngine().scan(ScanOptions(home: makeHome(dir)))
    #expect(counts(report) == ["node-modules": 2, "npm-cache": 1, "pnpm-cache": 1, "yarn-cache": 1, "xcode-derived-data": 1, "gradle-cache": 1, "android-system-images": 1, "android-avds": 2])
    #expect(report.totals == Totals(findings: 10, bytes: 1517, bySeverity: ["SAFE": 1227, "REVIEW": 290, "DANGER": 0], byCategory: ["android": 590, "node": 427, "xcode": 500]))
    #expect(report.warnings == [])
    #expect(report.findings.allSatisfy {$0.lastModified != nil && !$0.path.contains(".hidden") && !$0.path.contains(".git")})
  }

  @Test func nativeMeasureMatchesTheEngineWalk() throws {
    let dir = TempDir()
    let home = makeHome(dir)
    symlink(home, Paths.join(home, "projects/loop"))
    var native = try makeEngine(nativeMeasure: true).scan(ScanOptions(home: home))
    var walked = try makeEngine(nativeMeasure: false).scan(ScanOptions(home: home))
    // Free space moves between scans; the native host also knows purgeable space.
    let storage = try #require(native.storage)
    #expect(storage.totalBytes > 0 && storage.freeBytes > 0 && storage.purgeableBytes != nil)
    native.scannedAt = ""; walked.scannedAt = ""
    native.storage = nil; walked.storage = nil
    #expect(native == walked)
  }

  @Test func nodeModulesCarryProjectMetadata() throws {
    let dir = TempDir()
    let home = makeHome(dir)
    buildTree(home, ["bare/node_modules/x": 1])
    var options = ScanOptions(home: home)
    options.categories = ["node"]
    let report = try makeEngine().scan(options)
    let byProject = Dictionary(uniqueKeysWithValues: report.findings.filter {$0.ruleId == "node-modules"}.map {(Paths.basename($0.metadata["project"]!), $0.metadata)})
    #expect(byProject["a"] == ["project": Paths.join(home, "projects/a"), "package.json": "yes", "lockfile": "package-lock.json", "package_manager": "npm"])
    #expect(byProject["bare"]?["package_manager"] == "unknown")
  }

  @Test func capsAndMarkersWork() throws {
    let dir = TempDir()
    let home = makeHome(dir)
    buildTree(home, ["code/crate/Cargo.toml": 10, "code/crate/target/debug/app": 400, "code/web/target/output.txt": 20])
    var options = ScanOptions(home: home)
    options.maxFindings = 1
    let capped = try makeEngine().scan(options)
    #expect(capped.findings.count == 1 && capped.warnings.contains {$0.contains("reached max findings")})
    options = ScanOptions(home: home)
    options.categories = ["rust"]
    #expect(try makeEngine().scan(options).findings.map(\.path) == [Paths.join(home, "code/crate/target")])
  }

  @Test(.disabled(if: isRoot)) func unreadableDirectoriesBecomeWarnings() throws {
    let dir = TempDir()
    let home = makeHome(dir)
    chmod(Paths.join(home, "projects/b"), 0)
    let report = try makeEngine().scan(ScanOptions(home: home))
    #expect(counts(report)["node-modules"] == 1)
    #expect(report.warnings.contains {$0.hasPrefix("cannot read \(Paths.join(home, "projects/b")): ")})
  }

  @Test func photoLibraryItemsGoThroughTheEngine() throws {
    let now = Date().timeIntervalSince1970 * 1000, day = 86_400_000.0
    let library: @Sendable () throws -> [[String: Any]] = {[
      ["id": "V/L0/001", "name": "IMG_0100.MOV", "media": "video", "subtypes": [String](), "burst": "none", "bytes": 300.0 * 1024 * 1024, "created_ms": now - day, "local": true, "cloud": true, "width": 1920, "height": 1080, "duration_ms": 60_000.0],
      ["id": "C/L0/001", "name": "IMG_0101.MOV", "media": "video", "subtypes": [String](), "burst": "none", "bytes": 300.0 * 1024 * 1024, "created_ms": now - day, "local": false, "cloud": true, "width": 1920, "height": 1080, "duration_ms": 61_000.0],
      ["id": "S/L0/001", "name": "IMG_0200.PNG", "media": "image", "subtypes": ["screenshot"], "burst": "none", "bytes": NSNull(), "created_ms": now - 40 * day, "local": true, "cloud": NSNull(), "width": 1179, "height": 2556, "duration_ms": 0.0],
      ["id": "P/L0/001", "name": "IMG_0300.HEIC", "media": "image", "subtypes": [String](), "burst": "none", "bytes": 1000.0, "created_ms": now, "local": true, "cloud": false, "width": 4032, "height": 3024, "duration_ms": 0.0],
    ]}
    let engine = try Engine(script: String(contentsOf: engineURL, encoding: .utf8), host: NativeHost(home: "/nonexistent", photos: library))
    let report = try engine.scan(ScanOptions(home: "/nonexistent", sources: ["photos"]))
    // The video only in iCloud is listed too, marked so the app can badge and filter it.
    #expect(report.findings.map(\.ruleId).sorted() == ["large-videos", "large-videos", "screenshots"])
    #expect(report.findings.filter {!$0.onDevice}.map(\.path) == ["photos://C/L0/001"])
    // The app's precise check can mark more items after the scan.
    let marked = try engine.markOnlyInCloud(report, paths: ["photos://V/L0/001"])
    #expect(Set(marked.findings.filter {!$0.onDevice}.map(\.path)) == ["photos://C/L0/001", "photos://V/L0/001"])
    #expect(report.findings.first {$0.ruleId == "screenshots"}?.metadata["label"] == "IMG_0200.PNG")
    #expect(report.warnings == [] && report.roots == [])
    let decisions = try engine.decide(report, home: "/nonexistent", appRoot: "/app", now: Date())
    #expect(decisions.allSatisfy {$0.allowed && $0.review && !$0.auto})

    let denied = try Engine(script: String(contentsOf: engineURL, encoding: .utf8), host: NativeHost(home: "/nonexistent", photos: {throw EngineError(message: "Sem acesso às Fotos.")}))
    #expect(try denied.scan(ScanOptions(home: "/nonexistent", sources: ["photos"])).warnings == ["cannot read photos: Sem acesso às Fotos."])
  }

  @Test func asciiArtComesFromTheEngine() throws {
    let engine = try makeEngine()
    #expect(try engine.banner().split(separator: "\n").count == 5)
    #expect(try engine.spinner().count == 10)
    var pose = CatPose()
    pose.mouth = 2; pose.look = 1
    let cat = try engine.cat("happy", pose), bust = try engine.cat("happy", pose, bust: true)
    #expect(cat.split(separator: "\n", omittingEmptySubsequences: false).count > bust.split(separator: "\n", omittingEmptySubsequences: false).count)
    #expect(try engine.cat("idle", CatPose()) != cat)
  }

  @Test func engineErrorsSurfaceAsSwiftErrors() throws {
    #expect(throws: EngineError(message: "Seleção inválida.")) {try makeEngine().select([], indices: [])}
    #expect(throws: EngineError.self) {try Engine(script: "throw new Error('boom')")}
  }

  @Test func nativeMeasureFollowsTheEngineSemantics() {
    let dir = TempDir()
    buildTree(dir.path, ["a.txt": 1000, "sub/b.bin": 2000, "sub/deep/c": 500])
    symlink(dir("sub"), dir("loop"))
    #expect(NativeHost.measure(dir.path) == Measurement(bytes: 3500, errors: 0, truncated: false))
    #expect(NativeHost.measure(dir("loop")) == Measurement(bytes: 2500, errors: 0, truncated: false))
    #expect(NativeHost.measure(dir("nope")) == Measurement(bytes: 0, errors: 1, truncated: false))
    #expect(NativeHost.measure(dir.path, maxEntries: 2).truncated)
    // A sparse file (like Docker.raw) counts what it takes on disk, not its declared size.
    let image = dir("vm/disk.raw")
    makeFile(dir("vm/notes.txt"), 120)
    FileManager.default.createFile(atPath: image, contents: nil)
    truncate(image, 1 << 30)
    #expect(NativeHost.measure(image).bytes < 1 << 20)
    #expect(NativeHost.measure(dir("vm")).bytes < 1 << 20 && NativeHost.measure(dir("vm/notes.txt")).bytes == 120)
  }

  @Test func reportRoundTripsAndDecodesCLIOutput() throws {
    let dir = TempDir()
    let report = try makeEngine().scan(ScanOptions(home: makeHome(dir)))
    #expect(try Report.decode(report.encoded()) == report)
    let json = #"{"schema_version":1,"scanned_at":"2026-10-13T12:00:00.000Z","roots":["/Users/me"],"options":{"global_scan":false,"max_depth":6,"max_findings":500,"excludes":[],"categories":[]},"totals":{"findings":1,"bytes":10,"by_severity":{"SAFE":10,"REVIEW":0,"DANGER":0},"by_category":{"node":10}},"findings":[{"rule_id":"npm-cache","name":"npm","category":"node","severity":"SAFE","reclaimable":true,"description":"d","path":"/Users/me/.npm/_cacache","size_bytes":10,"size_complete":true,"last_modified":null,"rebuild":null,"metadata":{}}],"warnings":[]}"#
    let cli = try Report.decode(Data(json.utf8))
    #expect(cli.findings.first?.cleanupAllowed == nil)
    #expect(throws: ReportError.self) {try Report.decode(Data(json.replacingOccurrences(of: "\"schema_version\":1", with: "\"schema_version\":2").utf8))}
  }
}
