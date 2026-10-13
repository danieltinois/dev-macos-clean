// Rules, filesystem helpers, the scanner and the report contract.
import Foundation
import Testing
@testable import DevCleanKit

@Suite struct RuleTests {
  @Test func loadsPackagedRulesWithUniqueIds() throws {
    let rules = try loadRules(from: rulesDir)
    #expect(Set(rules.map(\.id)).count == rules.count)
    for id in ["node-modules", "npm-cache", "xcode-derived-data", "android-avds"] {#expect(rules.contains {$0.id == id}, "\(id)")}
    let node = try #require(rules.first {$0.id == "node-modules"})
    #expect(node.patterns == ["**/node_modules"])
    #expect(node.rebuild?.commands == [])
  }

  @Test(arguments: [
    (#"{"id":"x","name":"X","category":"c","severity":"SAFE","reclaimable":true,"description":"d","paths":["~/a"],"extra":1}"#, "unknown field(s): extra"),
    (#"{"id":"Bad","name":"X","category":"c","severity":"SAFE","reclaimable":true,"description":"d","paths":["~/a"]}"#, "id \"Bad\""),
    (#"{"id":"x","name":"X","category":"c","severity":"MAYBE","reclaimable":true,"description":"d","paths":["~/a"]}"#, "severity must be"),
    (#"{"id":"x","name":"X","category":"c","severity":"SAFE","reclaimable":1,"description":"d","paths":["~/a"]}"#, "reclaimable must be"),
    (#"{"id":"x","name":"X","category":"c","severity":"SAFE","reclaimable":true,"description":"d"}"#, "at least one of paths or patterns"),
    (#"{"id":"x","name":"X","category":"c","severity":"SAFE","reclaimable":true,"description":"d","paths":["~/a"],"markers":["m"]}"#, "markers only apply"),
    (#"{"id":"x","name":"X","category":"c","severity":"SAFE","reclaimable":true,"description":"d","patterns":["p"],"markers":["a/b"]}"#, "plain file names"),
    (#"{"id":"x","name":"X","category":"c","severity":"SAFE","reclaimable":true,"description":"d","paths":["~/a"],"rebuild":{"x":1}}"#, "unknown rebuild field(s): x"),
  ])
  func rejectsInvalidRules(json: String, message: String) throws {
    let dir = TempDir()
    try json.write(toFile: dir("bad.json"), atomically: true, encoding: .utf8)
    #expect {try loadRules(from: URL(fileURLWithPath: dir.path))} throws: {($0 as? RuleError)?.message.contains(message) == true}
  }

  @Test func rejectsDuplicateIds() throws {
    let dir = TempDir()
    let json = #"{"id":"x","name":"X","category":"c","severity":"SAFE","reclaimable":true,"description":"d","paths":["~/a"]}"#
    for name in ["a.json", "b.json"] {try json.write(toFile: dir(name), atomically: true, encoding: .utf8)}
    #expect(throws: RuleError(message: "duplicate rule ids: x")) {try loadRules(from: URL(fileURLWithPath: dir.path))}
  }
}

@Suite struct FileSystemTests {
  @Test func fnmatchFollowsShellSemantics() {
    #expect(fnmatch("AndroidStudio2024.1", "AndroidStudio*"))
    #expect(fnmatch("a.b", "a?b"))
    #expect(fnmatch("x1", "x[0-9]"))
    #expect(!fnmatch("x1", "x[!0-9]"))
    #expect(!fnmatch("a.b", "a+b"))
    #expect(fnmatch("/tmp/projects/a/node_modules", "*/a/node_modules"))
  }

  @Test func expandPathUsesHomeAndEnvironment() {
    #expect(expandPath("~", home: "/h") == "/h")
    #expect(expandPath("~/Library/Caches/Yarn", home: "/h") == "/h/Library/Caches/Yarn")
    #expect(expandPath("$VAR/x", home: "/h", environment: ["VAR": "/env"]) == "/env/x")
    #expect(expandPath("${UNSET}/x", home: "/h", environment: [:]) == "${UNSET}/x")
  }

  @Test func dirSizeSumsFilesWithoutFollowingSymlinks() {
    let dir = TempDir()
    buildTree(dir.path, ["a.txt": 1000, "sub/b.bin": 2000, "sub/deep/c": 500])
    symlink(dir("sub"), dir("loop"))
    #expect(FileSystem.dirSize(dir.path) == Measurement(bytes: 3500, errors: 0, truncated: false))
    #expect(FileSystem.measure(dir("nope")) == Measurement(bytes: 0, errors: 1, truncated: false))
    #expect(FileSystem.dirSize(dir.path, maxEntries: 2).truncated)
  }

  @Test(.disabled(if: isRoot)) func dirSizeToleratesPermissionErrors() {
    let dir = TempDir()
    buildTree(dir.path, ["ok.bin": 300, "blocked/secret.bin": 5000])
    chmod(dir("blocked"), 0)
    #expect(FileSystem.dirSize(dir.path) == Measurement(bytes: 300, errors: 1, truncated: false))
  }

  @Test func globSkipsHiddenNames() {
    let dir = TempDir()
    buildTree(dir.path, ["avd/a.avd": nil, "avd/b.avd": nil, "avd/c.ini": 1, "Caches/Foo": nil, "Caches/.hidden": nil])
    #expect(FileSystem.glob(dir("avd/*.avd")) == [dir("avd/a.avd"), dir("avd/b.avd")])
    #expect(FileSystem.glob(dir("Caches/*")) == [dir("Caches/Foo")])
    #expect(FileSystem.glob(dir("missing/*")) == [])
  }

  @Test func iterMatchesSkipsHiddenHeavyAndMatchedDirs() {
    let dir = TempDir()
    buildTree(dir.path, ["a/node_modules/p/node_modules/x": 1, ".hidden/node_modules/h": 1, "Library/node_modules/l": 1, "lvl1/lvl2/lvl3/node_modules/d": 1])
    var warnings: [String] = [], found: [String] = []
    FileSystem.iterMatches([dir.path], ["**/node_modules"], maxDepth: 3, maxDirs: 1000, excludes: [], warnings: &warnings) {found.append($0); return true}
    #expect(found == [dir("a/node_modules")])
    FileSystem.iterMatches([dir.path], ["**/node_modules"], maxDepth: 6, maxDirs: 2, excludes: [], warnings: &warnings) {_ in true}
    #expect(warnings == ["discovery exceeded 2 directories; scan is partial"])
  }
}

@Suite struct ScannerTests {
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

  @Test func fullScanMatchesTheTypeScriptScanner() throws {
    let dir = TempDir()
    let report = scan(try loadRules(from: rulesDir), options: options(home: makeHome(dir)))
    #expect(counts(report) == ["node-modules": 2, "npm-cache": 1, "pnpm-cache": 1, "yarn-cache": 1, "xcode-derived-data": 1, "gradle-cache": 1, "android-system-images": 1, "android-avds": 2])
    #expect(report.totals == Totals(findings: 10, bytes: 1517, bySeverity: ["SAFE": 1227, "REVIEW": 290, "DANGER": 0], byCategory: ["android": 590, "node": 427, "xcode": 500]))
    #expect(report.warnings == [])
    #expect(report.findings.allSatisfy {$0.lastModified != nil && !$0.path.contains(".hidden") && !$0.path.contains(".git")})
  }

  @Test func nodeModulesCarryProjectMetadata() throws {
    let dir = TempDir()
    let home = makeHome(dir)
    buildTree(home, ["bare/node_modules/x": 1])
    let report = scan(try loadRules(from: rulesDir), options: options(home: home) {$0.categories = ["node"]})
    let byProject = Dictionary(uniqueKeysWithValues: report.findings.filter {$0.ruleId == "node-modules"}.map {(Paths.basename($0.metadata["project"]!), $0.metadata)})
    #expect(byProject["a"] == ["project": Paths.join(home, "projects/a"), "package.json": "yes", "lockfile": "package-lock.json", "package_manager": "npm"])
    #expect(byProject["b"]?["package_manager"] == "yarn")
    #expect(byProject["bare"] == ["project": Paths.join(home, "bare"), "package.json": "no", "lockfile": "none", "package_manager": "unknown"])
  }

  @Test func filtersCapsAndExcludes() throws {
    let dir = TempDir(), rules = try loadRules(from: rulesDir), home = makeHome(dir)
    #expect(counts(scan(rules, options: options(home: home) {$0.categories = ["node"]})) == ["node-modules": 2, "npm-cache": 1, "pnpm-cache": 1, "yarn-cache": 1])
    #expect(scan(rules, options: options(home: home) {$0.categories = ["nonsense"]}).warnings.first?.contains("no rules match") == true)
    #expect(counts(scan(rules, options: options(home: home) {$0.excludes = ["node_modules"]}))["node-modules"] == nil)
    #expect(counts(scan(rules, options: options(home: home) {$0.maxDepth = 2}))["node-modules"] == nil)
    let capped = scan(rules, options: options(home: home) {$0.maxFindings = 1})
    #expect(capped.findings.count == 1 && capped.warnings.contains {$0.contains("reached max findings")})
  }

  @Test func explicitPathsWinOverPatterns() {
    let dir = TempDir()
    buildTree(dir.path, ["projects/a/package.json": 50, "projects/a/node_modules/x": 100])
    let report = scan([rule("node-modules", patterns: ["**/node_modules"]), rule("paths-rule", paths: [dir("projects/a/node_modules")])], options: options(home: dir.path))
    #expect(report.findings.map(\.ruleId) == ["paths-rule"])
  }

  @Test func markersOnlyMatchRealCargoProjects() throws {
    let dir = TempDir()
    buildTree(dir.path, ["code/crate/Cargo.toml": 10, "code/crate/target/debug/app": 400, "code/web/target/output.txt": 20])
    let targets = scan(try loadRules(from: rulesDir), options: options(home: dir.path) {$0.categories = ["rust"]}).findings.filter {$0.ruleId == "rust-target"}
    #expect(targets.map(\.path) == [dir("code/crate/target")])
    #expect(targets.first?.metadata["Cargo.toml"] == "yes")
  }

  @Test func specificCachesWinOverTheGenericRule() throws {
    let dir = TempDir()
    buildTree(dir.path, ["Library/Caches/CocoaPods/Pods/x": 20, "Library/Caches/go-build/aa/x": 10, "Library/Caches/com.example/x": 5])
    let findings = scan(try loadRules(from: rulesDir), options: options(home: dir.path)).findings
    let generic = Set(findings.filter {$0.ruleId == "user-app-caches"}.map {Paths.basename($0.path)})
    #expect(generic == ["com.example"])
  }

  @Test func scanIsSymlinkLoopSafe() throws {
    let dir = TempDir()
    buildTree(dir.path, ["projects/a/node_modules/x/y": 10])
    symlink(dir.path, dir("projects/loop"))
    #expect(counts(scan(try loadRules(from: rulesDir), options: options(home: dir.path)))["node-modules"] == 1)
  }

  @Test func reportRoundTripsAsJSON() throws {
    let dir = TempDir()
    let report = scan(try loadRules(from: rulesDir), options: options(home: makeHome(dir)))
    let decoded = try Report.decode(report.encoded())
    #expect(decoded == report)
    let json = try #require(JSONSerialization.jsonObject(with: report.encoded()) as? [String: Any])
    #expect(json["schema_version"] as? Int == 1)
    #expect((json["findings"] as? [[String: Any]])?.first?["size_bytes"] != nil)
    #expect(json["cleanup_token"] == nil)
  }

  @Test func decodesACLIReport() throws {
    let json = #"{"schema_version":1,"scanned_at":"2026-10-13T12:00:00.000Z","roots":["/Users/me"],"options":{"global_scan":false,"max_depth":6,"max_findings":500,"excludes":[],"categories":[]},"totals":{"findings":1,"bytes":10,"by_severity":{"SAFE":10,"REVIEW":0,"DANGER":0},"by_category":{"node":10}},"findings":[{"rule_id":"npm-cache","name":"npm","category":"node","severity":"SAFE","reclaimable":true,"description":"d","path":"/Users/me/.npm/_cacache","size_bytes":10,"size_complete":true,"last_modified":null,"rebuild":null,"metadata":{}}],"warnings":[]}"#
    let report = try Report.decode(Data(json.utf8))
    #expect(report.findings.first?.isSafe == true)
    #expect(report.findings.first?.canClean == false)
    #expect(throws: ReportError.self) {try Report.decode(Data(json.replacingOccurrences(of: "\"schema_version\":1", with: "\"schema_version\":2").utf8))}
  }
}

@Suite struct PresentationTests {
  @Test func formatsBytesInPortuguese() {
    #expect(Labels.bytes(0) == "0 B")
    #expect(Labels.bytes(512) == "512 B")
    #expect(Labels.bytes(1024) == "1 KB")
    #expect(Labels.bytes(Int(2.4 * 1024 * 1024 * 1024)) == "2,4 GB")
  }

  @Test func pickSkipsNestedPaths() {
    func item(_ index: Int, _ path: String, _ allowed: Bool = true) -> Indexed {
      var f = Finding(ruleId: "x", category: "node", severity: .safe, path: path)
      f.cleanupAllowed = allowed
      return Indexed(index: index, finding: f)
    }
    #expect(Selection.pick([item(0, "/a/b"), item(1, "/a"), item(2, "/c", false), item(3, "/ab")], {_ in true}) == [1, 3])
  }
}
