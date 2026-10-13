// The iPhone window and its answers to window.devclean: scan the photo library
// and the folders picked in the Files app with the TypeScript engine, and send
// confirmed items to Recently Deleted (in Photos or in Files).
// Cleanup starts only from the user's tap. Files need our confirmation, which
// defaults to Cancelar; photos get the system's own. Nothing on the iPhone is
// cleaned automatically.
#if os(iOS)
import DevCleanKit
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct PhoneWindow: View {
  @State private var shell = WebShell(actions: PhoneActions())

  var body: some View {
    ShellView(shell: shell)
      .background(Color.shellBackground.ignoresSafeArea())
      .preferredColorScheme(.dark)
  }
}

@MainActor
final class PhoneActions: ShellActions {
  let platform = "ios"
  weak var shell: WebShell?
  private var report: Report?
  private var manifest: Cleanup.Manifest = [:]
  private var busy = false
  private lazy var picked = PickedFolders.load()
  private var picker: FolderPicker?

  // Photos by their library identity, files by path, device, inode and times.
  nonisolated private static func identity(_ path: String) throws -> String {
    path.hasPrefix(PhotoLibrary.prefix) ? try PhotoLibrary.identity(path) : try Cleanup.fileIdentity(path)
  }

  func scan() async throws -> String {
    if busy {throw Cleanup.Failure("Uma análise já está em andamento.")}
    busy = true
    defer {busy = false}
    _ = await PhotoLibrary.requestAccess()
    let home = NSHomeDirectory(), appRoot = Bundle.main.bundlePath, folders = picked
    var prepared = try await Task.detached(priority: .userInitiated) {
      let engine = try Engine.bundled(host: NativeHost(home: home, photos: PhotoLibrary.assets, files: {PickedFolders.items(in: folders)}))
      var options = ScanOptions(home: home, sources: ["photos", "files"])
      options.maxFindings = 5000
      return try Cleanup.prepare(engine.scan(options), engine: engine, home: home, appRoot: appRoot, identity: Self.identity)
    }.value
    if PhotoLibrary.hasLimitedAccess {
      prepared.report.warnings.append("Acesso limitado: o DevClean só vê as fotos que você liberou. Ajustes › DevClean › Fotos › Acesso Total.")
    }
    report = prepared.report
    manifest = prepared.manifest
    return try BridgeReply.report(prepared.report)
  }

  func cleanup(indices: [Int], token: String, automatic: Bool) async throws -> String {
    if busy {throw Cleanup.Failure("Aguarde a operação atual.")}
    busy = true
    defer {busy = false}
    if automatic {throw Cleanup.Failure("No iPhone nada é limpo automaticamente.")}
    let engine = try Engine.bundled()
    let selected = try Cleanup.select(report, indices: indices, token: token, engine: engine)
    try Cleanup.validate(selected, manifest: manifest, identity: Self.identity)
    guard let current = report else {return BridgeReply.canceled}
    let photos = selected.filter {$0.path.hasPrefix(PhotoLibrary.prefix)}, files = selected.filter {!$0.path.hasPrefix(PhotoLibrary.prefix)}
    // Files only from the folders the user picked, whatever the report says.
    guard files.allSatisfy({file in picked.contains {file.path.hasPrefix($0.root + "/")}}) else {throw Cleanup.Failure("Item não autorizado para limpeza.")}
    if !files.isEmpty, await !confirm(files, photos: photos.count) {return BridgeReply.canceled}

    var outcome = Cleanup.Outcome()
    if !files.isEmpty {
      outcome = try Cleanup.moveToTrash(files, manifest: &manifest, engine: engine) {
        try FileManager.default.trashItem(at: URL(fileURLWithPath: $0), resultingItemURL: nil)
      }
    }
    if !photos.isEmpty {
      // The system asks for confirmation; declining it is a cancel, not an error.
      do {
        try await PhotoLibrary.delete(photos.map(\.path))
        outcome.moved += photos.map {(path: $0.path, sizeBytes: $0.sizeBytes)}
        for finding in photos {manifest[finding.path] = nil}
      } catch is PhotoLibrary.Canceled {
        if files.isEmpty {return BridgeReply.canceled}
        outcome.errors += photos.map {(path: $0.metadata["label"] ?? $0.path, message: "Você cancelou no aviso do iOS.")}
      } catch {
        outcome.errors += photos.map {(path: $0.metadata["label"] ?? $0.path, message: error.localizedDescription)}
      }
    }
    let remaining = try Cleanup.remainingReport(current, moved: outcome.moved.map(\.path), engine: engine)
    report = remaining
    return try BridgeReply.cleanup(outcome, report: remaining)
  }

  // Like the Mac's confirmation: what goes, and Cancelar as the default.
  private func confirm(_ files: [Finding], photos: Int) async -> Bool {
    guard let presenter = topController() else {return false}
    let megabytes = (Double(files.reduce(0) {$0 + $1.sizeBytes}) / (1024 * 1024)).formatted(.number.precision(.fractionLength(0...1)).locale(Locale(identifier: "pt_BR")))
    let names = files.prefix(10).map {$0.metadata["label"] ?? $0.path}.joined(separator: "\n") + (files.count > 10 ? "\n… e mais \(files.count - 10)" : "")
    let next = photos > 0 ? "\n\nDepois o iOS pede confirmação para \(photos) foto(s) e vídeo(s)." : ""
    let alert = UIAlertController(title: "Enviar para Apagados", message: "Mover \(files.count) arquivo(s), \(megabytes) MB, para Apagados no app Arquivos?\n\n\(names)\(next)", preferredStyle: .alert)
    return await withCheckedContinuation {continuation in
      let cancel = UIAlertAction(title: "Cancelar", style: .cancel) {_ in continuation.resume(returning: false)}
      alert.addAction(cancel)
      alert.addAction(UIAlertAction(title: "Enviar para Apagados", style: .destructive) {_ in continuation.resume(returning: true)})
      alert.preferredAction = cancel
      presenter.present(alert, animated: true)
    }
  }

  func reveal(_ index: Int) throws {
    throw Cleanup.Failure("Abra o app Fotos ou Arquivos para ver este item.")
  }

  // MARK: Folders from the Files app

  func folders() throws -> [String] {picked.map(\.label)}

  // The system folder picker: the page never names a path.
  func addFolder() async throws -> [String] {
    guard picker == nil, let presenter = topController() else {return picked.map(\.label)}
    let url = await withCheckedContinuation {continuation in
      let picker = FolderPicker {continuation.resume(returning: $0)}
      self.picker = picker
      presenter.present(picker.controller, animated: true)
    }
    picker = nil
    if let url {picked = try PickedFolders.add(url)}
    return picked.map(\.label)
  }

  func removeFolder(_ index: Int) throws -> [String] {
    if busy {throw Cleanup.Failure("Aguarde a operação atual.")}
    picked = try PickedFolders.remove(at: index)
    return picked.map(\.label)
  }

  // The share sheet, with the report as a JSON file (AirDrop, Arquivos, Mail…).
  func export() async throws -> Bool {
    guard let report else {throw Cleanup.Failure("Faça uma análise primeiro.")}
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("devclean-report.json")
    try report.encoded().write(to: url)
    guard let presenter = topController() else {return false}
    let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
    sheet.popoverPresentationController?.sourceView = shell?.webView
    return await withCheckedContinuation {continuation in
      sheet.completionWithItemsHandler = {_, completed, _, _ in continuation.resume(returning: completed)}
      presenter.present(sheet, animated: true)
    }
  }

  private func topController() -> UIViewController? {
    var top = shell?.webView.window?.rootViewController
    while let presented = top?.presentedViewController {top = presented}
    return top
  }
}

// UIDocumentPickerViewController for one folder; reports the pick (or nil) once.
private final class FolderPicker: NSObject, UIDocumentPickerDelegate {
  let controller = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
  private var done: ((URL?) -> Void)?

  init(_ done: @escaping (URL?) -> Void) {
    self.done = done
    super.init()
    controller.delegate = self
    controller.allowsMultipleSelection = false
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {finish(urls.first)}
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {finish(nil)}
  private func finish(_ url: URL?) {done?(url); done = nil}
}
#endif
