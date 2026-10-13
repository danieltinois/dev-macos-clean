// The macOS window and its answers to window.devclean: scan the disk with the
// TypeScript engine and move confirmed items to the Trash, like desktop/main.ts.
// Cleanup starts only from the user's click; the confirmation defaults to Cancelar.
#if os(macOS)
import AppKit
import DevCleanKit
import SwiftUI
import UniformTypeIdentifiers

struct DesktopWindow: View {
  @State private var shell = WebShell(actions: MacActions())

  var body: some View {
    ShellView(shell: shell)
      .ignoresSafeArea()
      // The page's title bar is drawn in HTML; this makes it drag the window,
      // like `-webkit-app-region: drag` does in Electron.
      .overlay(alignment: .top) {
        Color.clear.frame(height: 52).contentShape(Rectangle()).gesture(WindowDragGesture()).allowsWindowActivationEvents(true)
      }
      .frame(minWidth: 900, minHeight: 650)
      .background(Color.shellBackground)
  }
}

@MainActor
final class MacActions: ShellActions {
  let platform = "mac"
  weak var shell: WebShell?
  private var report: Report?
  private var manifest: Cleanup.Manifest = [:]
  private var busy = false

  func scan() async throws -> String {
    if busy {throw Cleanup.Failure("Uma análise já está em andamento.")}
    busy = true
    defer {busy = false}
    // Not sandboxed, so this is the real home; the app bundle itself is protected.
    let home = NSHomeDirectory(), appRoot = Bundle.main.bundlePath
    let prepared = try await Task.detached(priority: .userInitiated) {
      let engine = try Engine.bundled(host: NativeHost(home: home))
      return try Cleanup.prepare(engine.scan(ScanOptions(home: home, globalScan: true)), engine: engine, home: home, appRoot: appRoot)
    }.value
    report = prepared.report
    manifest = prepared.manifest
    return try BridgeReply.report(prepared.report)
  }

  func cleanup(indices: [Int], token: String, automatic: Bool) async throws -> String {
    if busy {throw Cleanup.Failure("Aguarde a operação atual.")}
    busy = true
    defer {busy = false}
    let engine = try Engine.bundled()
    let selected = try Cleanup.select(report, indices: indices, token: token, engine: engine)
    if automatic && selected.contains(where: {$0.autoClean != true}) {throw Cleanup.Failure("Item não autorizado para limpeza automática.")}
    try Cleanup.validate(selected, manifest: manifest)
    guard await confirm(Confirmation(selected, automatic: automatic)), let current = report else {return BridgeReply.canceled}
    let outcome = try Cleanup.moveToTrash(selected, manifest: &manifest, engine: engine, trash: Cleanup.systemTrash)
    let remaining = try Cleanup.remainingReport(current, moved: outcome.moved.map(\.path), engine: engine)
    report = remaining
    return try BridgeReply.cleanup(outcome, report: remaining)
  }

  // A sheet on the window; the first button, Cancelar, is the default.
  private func confirm(_ confirmation: Confirmation) async -> Bool {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.window.title = confirmation.title
    alert.messageText = confirmation.message
    alert.informativeText = confirmation.detail
    alert.addButton(withTitle: "Cancelar")
    alert.addButton(withTitle: "Enviar à Lixeira").keyEquivalent = ""
    guard let window = shell?.webView.window else {return alert.runModal() == .alertSecondButtonReturn}
    return await alert.beginSheetModal(for: window) == .alertSecondButtonReturn
  }

  func reveal(_ index: Int) throws {
    guard let finding = report?.findings[safe: index] else {throw Cleanup.Failure("Item inválido")}
    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: finding.path)])
  }

  func export() async throws -> Bool {
    guard let report else {throw Cleanup.Failure("Faça uma análise primeiro.")}
    let panel = NSSavePanel()
    panel.nameFieldStringValue = "devclean-report.json"
    panel.allowedContentTypes = [.json]
    let response = if let window = shell?.webView.window {await panel.beginSheetModal(for: window)} else {panel.runModal()}
    guard response == .OK, let url = panel.url else {return false}
    try report.encoded().write(to: url)
    return true
  }
}
#endif
