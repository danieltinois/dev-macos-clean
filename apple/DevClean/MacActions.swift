// macOS-only actions: scan the disk, confirm and move to the Trash, reveal, export.
// Cleanup follows desktop/main.ts: select -> validate -> confirm (defaults to
// Cancelar) -> moveToTrash, and only ever after the user's own click.
#if os(macOS)
import AppKit
import DevCleanKit
import UniformTypeIdentifiers

extension AppModel {
  func scan() async {
    guard !busy else {return}
    busy = true
    say("Analisando arquivos…")
    defer {busy = false}
    do {
      // Not sandboxed, so this is the real home; the app bundle itself is protected.
      let home = NSHomeDirectory(), appRoot = Bundle.main.bundlePath
      // The TypeScript engine scans and decides; each task gets its own engine.
      let prepared = try await Task.detached(priority: .userInitiated) {
        let engine = try Engine.bundled(host: NativeHost(home: home))
        return try Cleanup.prepare(engine.scan(ScanOptions(home: home, globalScan: true)), engine: engine, home: home, appRoot: appRoot)
      }.value
      manifest = prepared.manifest
      show(prepared.report)
      errors = []
      writeShareCopy()
      let safe = safeBytes
      say(safe > 0 ? "Análise concluída · \(Labels.bytes(safe)) podem ir para a Lixeira com segurança" : "Análise concluída")
    } catch {
      say(error.localizedDescription, error: true)
    }
  }

  func clean(automatic: Bool) {
    guard let report, !busy else {return}
    busy = true
    defer {busy = false}
    say("Validando seleção…")
    do {
      // Automatic cleanup always covers the whole report, never just the filtered view.
      let engine = try Engine.bundled()
      let indices = automatic ? Selection.pick(Selection.visible(report.findings, Filters()), {$0.autoClean == true}) : Array(selected)
      let items = try Cleanup.select(report, indices: indices, token: report.cleanupToken, engine: engine)
      if automatic && items.contains(where: {$0.autoClean != true}) {throw Cleanup.Failure("Item não autorizado para limpeza automática.")}
      try Cleanup.validate(items, manifest: manifest)
      guard confirm(items, automatic: automatic) else {return say("Limpeza cancelada")}
      let outcome = try Cleanup.moveToTrash(items, manifest: &manifest, engine: engine, trash: Cleanup.systemTrash)
      self.report = try Cleanup.remainingReport(report, moved: outcome.moved.map(\.path), engine: engine)
      selected.removeAll()
      errors = outcome.errors.map {"\($0.path): \($0.message)"}
      writeShareCopy()
      let moved = outcome.moved.reduce(0) {$0 + $1.sizeBytes}
      say("\(outcome.moved.count) item(ns) na Lixeira · \(Labels.bytes(moved)). Esvazie a Lixeira para liberar espaço.\(errors.isEmpty ? "" : " Alguns itens falharam.")", error: !errors.isEmpty)
    } catch {
      say(error.localizedDescription, error: true)
    }
  }

  // The confirmation dialog. The first button, Cancelar, is the default.
  private func confirm(_ items: [Finding], automatic: Bool) -> Bool {
    let total = items.reduce(0) {$0 + $1.sizeBytes}
    let review = items.filter {$0.cleanupReview == true}
    func list(_ items: [Finding]) -> String {
      if items.isEmpty {return ""}
      let paths = items.prefix(25).map(\.path).joined(separator: "\n")
      return items.count > 25 ? "\(paths)\n… e mais \(items.count - 25)\n\n" : "\(paths)\n\n"
    }
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = automatic ? "Limpeza automática: mover \(items.count) cache(s) e dependência(s) para a Lixeira?" : "Mover \(items.count) item(ns) para a Lixeira?"
    alert.informativeText = "\(Labels.bytes(total)) selecionados.\n\n\(list(items.filter {$0.cleanupReview != true}))"
      + (review.isEmpty ? "" : "⚠️ PARA REVISAR — podem conter dados que não voltam sozinhos (AVDs, archives, logs, caches de apps):\n\(list(review))")
      + "Feche builds e ferramentas que usam estes diretórios. Dependências precisarão ser reinstaladas e caches serão recriados.\n\nVocê pode restaurar pelo Finder. O espaço no disco só é liberado após esvaziar a Lixeira."
    alert.addButton(withTitle: "Cancelar")
    alert.addButton(withTitle: "Enviar à Lixeira").keyEquivalent = ""
    return alert.runModal() == .alertSecondButtonReturn
  }

  func reveal(_ finding: Finding) {
    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: finding.path)])
  }

  func export() {
    guard let report else {return}
    let panel = NSSavePanel()
    panel.nameFieldStringValue = "devclean-report.json"
    panel.allowedContentTypes = [.json]
    guard panel.runModal() == .OK, let url = panel.url else {return}
    do {try report.encoded().write(to: url); say("Relatório exportado.")} catch {say(error.localizedDescription, error: true)}
  }

  private func writeShareCopy() {
    guard let report else {return}
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("devclean-report.json")
    shareURL = (try? report.encoded().write(to: url)) != nil ? url : nil
  }
}
#endif
