// Requests from the shared web UI are validated like the Electron IPC handlers.
import Foundation
import Testing
@testable import DevCleanKit

@Suite struct BridgeTests {
  // What WebKit hands over for a JavaScript object (numbers and booleans as NSNumber).
  func body(_ json: String) throws -> Any {try JSONSerialization.jsonObject(with: Data(json.utf8))}

  @Test func parsesEveryCall() throws {
    #expect(try BridgeRequest(body(#"{"method":"scan"}"#)) == .scan)
    #expect(try BridgeRequest(body(#"{"method":"export"}"#)) == .export)
    #expect(try BridgeRequest(body(#"{"method":"reveal","index":3}"#)) == .reveal(index: 3))
    #expect(try BridgeRequest(body(#"{"method":"cleanup","indices":[0,2],"token":"t","automatic":true}"#)) == .cleanup(indices: [0, 2], token: "t", automatic: true))
    #expect(try BridgeRequest(body(#"{"method":"folders"}"#)) == .folders)
    #expect(try BridgeRequest(body(#"{"method":"addFolder","path":"/etc"}"#)) == .addFolder)
    #expect(try BridgeRequest(body(#"{"method":"removeFolder","index":1}"#)) == .removeFolder(index: 1))
  }

  @Test(arguments: [
    #"{"method":"cleanup","indices":["0"],"token":"t"}"#, #"{"method":"cleanup","indices":[0.5],"token":"t"}"#,
    #"{"method":"cleanup","indices":[true],"token":"t"}"#, #"{"method":"cleanup","indices":"0","token":"t"}"#,
    #"{"method":"reveal","index":"1"}"#, #"{"method":"reveal"}"#, #"{"method":"removeFolder","index":"/"}"#, #"{"method":"removeFolder"}"#, #"{"method":"rm","path":"/"}"#, #"{"path":"/"}"#, #"[]"#,
  ])
  func rejectsAnythingButIndicesAndTokens(json: String) throws {
    #expect(throws: Cleanup.Failure.self) {try BridgeRequest(body(json))}
  }

  @Test func automaticMustBeExactlyTrue() throws {
    for value in ["1", "\"true\"", "false", "null"] {
      #expect(try BridgeRequest(body(#"{"method":"cleanup","indices":[0],"token":"t","automatic":\#(value)}"#)) == .cleanup(indices: [0], token: "t", automatic: false))
    }
  }

  @Test func refusesTooManyIndices() throws {
    let indices = (0...1000).map(String.init).joined(separator: ",")
    #expect(throws: Cleanup.Failure.self) {try BridgeRequest(body(#"{"method":"cleanup","indices":[\#(indices)],"token":"t"}"#))}
  }

  @Test func confirmationMatchesTheElectronDialog() {
    var safe = Finding(ruleId: "npm-cache", category: "node", severity: .safe, path: "/h/.npm/_cacache", sizeBytes: 3 * 1024 * 1024 / 2)
    safe.cleanupReview = false
    var review = Finding(ruleId: "user-logs", category: "logs", severity: .review, path: "/h/Library/Logs/x", sizeBytes: 1024 * 1024)
    review.cleanupReview = true
    let confirmation = Confirmation([safe, review], automatic: false)
    #expect(confirmation.message == "Mover 2 item(ns) para a Lixeira?")
    #expect(confirmation.detail.hasPrefix("2,5 MB selecionados.\n\n/h/.npm/_cacache\n\n⚠️ PARA REVISAR"))
    #expect(confirmation.detail.contains("/h/Library/Logs/x\n\nFeche builds"))
    #expect(Confirmation([safe], automatic: true).message == "Limpeza automática: mover 1 cache(s) e dependência(s) para a Lixeira?")
  }

  @Test func cleanupReplyHasThePreloadShape() throws {
    var outcome = Cleanup.Outcome()
    outcome.moved = [("/a", 5)]
    outcome.errors = [("/b", "falhou")]
    let report = Report(schemaVersion: 1, scannedAt: "", roots: [], options: ReportOptions(globalScan: true, maxDepth: 6, maxFindings: 500, excludes: [], categories: []),
                        totals: Totals(findings: 0, bytes: 0, bySeverity: [:], byCategory: [:]), findings: [], warnings: [], cleanupToken: "t")
    let reply = try #require(JSONSerialization.jsonObject(with: Data(BridgeReply.cleanup(outcome, report: report).utf8)) as? [String: Any])
    #expect((reply["moved"] as? [[String: Any]])?.first?["size_bytes"] as? Int == 5)
    #expect((reply["errors"] as? [[String: Any]])?.first?["message"] as? String == "falhou")
    #expect((reply["report"] as? [String: Any])?["cleanup_token"] as? String == "t")
    #expect(reply["canceled"] == nil)
  }
}
