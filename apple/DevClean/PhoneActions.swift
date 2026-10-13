// The iPhone's native side: scan the photo library and the folders picked in the
// Files app with the TypeScript engine, and send confirmed items to Recently
// Deleted (in Photos or in Files).
// Cleanup starts only from the user's tap. Files need our confirmation, which
// defaults to Cancelar; photos get the system's own. Automatic cleanup only takes
// what the engine marks automatic: byte-identical photo copies and burst extras.
#if os(iOS)
import DevCleanKit
import QuickLook
import SwiftUI
import UIKit
import UniformTypeIdentifiers

@MainActor
final class PhoneActions: Actions {
  private var report: Report?
  private var manifest: Cleanup.Manifest = [:]
  private var busy = false
  private lazy var picked = PickedFolders.load()
  private var picker: FolderPicker?
  private var preview: Preview?

  // Photos by their library identity, files by path, device, inode and times.
  nonisolated private static func identity(_ path: String) throws -> String {
    path.hasPrefix(PhotoLibrary.prefix) ? try PhotoLibrary.identity(path) : try Cleanup.fileIdentity(path)
  }

  func scan(progress: @escaping @Sendable (String) -> Void) async throws -> Report {
    if busy {throw Cleanup.Failure("Uma análise já está em andamento.")}
    busy = true
    defer {busy = false}
    _ = await PhotoLibrary.requestAccess()
    let home = NSHomeDirectory(), appRoot = Bundle.main.bundlePath, folders = picked
    var prepared = try await Task.detached(priority: .userInitiated) {
      let engine = try Engine.bundled(host: NativeHost(home: home, photos: {try PhotoLibrary.assets(progress: progress)}, files: {PickedFolders.items(in: folders, progress: progress)}))
      var options = ScanOptions(home: home, sources: ["photos", "files"])
      options.maxFindings = 5000
      let report = try engine.scan(options)
      // Photo identities in one go: one fetch per item is slow with thousands of findings.
      progress("Conferindo \(report.findings.count) itens…")
      let photos = PhotoLibrary.identities(report.findings.map(\.path))
      return try Cleanup.prepare(report, engine: engine, home: home, appRoot: appRoot) {path in
        guard path.hasPrefix(PhotoLibrary.prefix) else {return try Cleanup.fileIdentity(path)}
        guard let identity = photos[path] else {throw Cleanup.Failure("A foto não existe mais. Analise novamente.")}
        return identity
      }
    }.value
    if PhotoLibrary.hasLimitedAccess {
      prepared.report.warnings.append("Acesso limitado: o DevClean só vê as fotos que você liberou. Ajustes › DevClean › Fotos › Acesso Total.")
    }
    report = prepared.report
    manifest = prepared.manifest
    return prepared.report
  }

  func cleanup(indices: [Int], token: String, automatic: Bool) async throws -> CleanupResult {
    if busy {throw Cleanup.Failure("Aguarde a operação atual.")}
    busy = true
    defer {busy = false}
    let engine = try Engine.bundled()
    let selected = try Cleanup.select(report, indices: indices, token: token, engine: engine)
    try Cleanup.validate(selected, manifest: manifest, identity: Self.identity)
    guard let current = report else {return .canceled}
    let photos = selected.filter {$0.path.hasPrefix(PhotoLibrary.prefix)}, files = selected.filter {!$0.path.hasPrefix(PhotoLibrary.prefix)}
    if automatic && (!files.isEmpty || photos.contains {$0.autoClean != true}) {throw Cleanup.Failure("Item não autorizado para limpeza automática.")}
    // Files only from the folders the user picked, whatever the report says.
    guard files.allSatisfy({file in picked.contains {file.path.hasPrefix($0.root + "/")}}) else {throw Cleanup.Failure("Item não autorizado para limpeza.")}
    if !files.isEmpty, await !confirm(files, photos: photos.count) {return .canceled}

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
        if files.isEmpty {return .canceled}
        outcome.errors += photos.map {(path: $0.metadata["label"] ?? $0.path, message: "Você cancelou no aviso do iOS.")}
      } catch {
        outcome.errors += photos.map {(path: $0.metadata["label"] ?? $0.path, message: error.localizedDescription)}
      }
    }
    let remaining = try Cleanup.remainingReport(current, moved: outcome.moved.map(\.path), engine: engine)
    report = remaining
    return .done(outcome, remaining)
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

  // iOS can't open a given photo in the Photos app, so the item opens here, in
  // Quick Look: photos and videos (downloaded from iCloud if needed) and files.
  func reveal(_ index: Int) async throws {
    guard preview == nil, let finding = report?.findings[safe: index] else {throw Cleanup.Failure("Item inválido")}
    let file: (url: URL, temporary: Bool)
    if finding.path.hasPrefix(PhotoLibrary.prefix) {
      file = try await PhotoLibrary.previewFile(finding.path)
    } else {
      guard picked.contains(where: {finding.path.hasPrefix($0.root + "/")}) else {throw Cleanup.Failure("Item inválido")}
      file = (URL(fileURLWithPath: finding.path), false)
    }
    guard let presenter = topController() else {return}
    let preview = Preview(url: file.url, temporary: file.temporary) {[weak self] in self?.preview = nil}
    self.preview = preview
    presenter.present(preview.controller, animated: true)
  }

  // MARK: Folders from the Files app

  func folders() -> [String] {picked.map(\.label)}

  // The system folder picker: the page never names a path.
  func addFolder() async throws -> [String] {
    guard picker == nil, let presenter = topController() else {return picked.map(\.label)}
    let urls = await withCheckedContinuation {continuation in
      let picker = FolderPicker {continuation.resume(returning: $0)}
      self.picker = picker
      presenter.present(picker.controller, animated: true)
    }
    picker = nil
    for url in urls {picked = try PickedFolders.add(url)}
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
    sheet.popoverPresentationController?.sourceView = presenter.view
    return await withCheckedContinuation {continuation in
      sheet.completionWithItemsHandler = {_, completed, _, _ in continuation.resume(returning: completed)}
      presenter.present(sheet, animated: true)
    }
  }

  private func topController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes.compactMap {$0 as? UIWindowScene}.first {$0.activationState == .foregroundActive}
    var top = scene?.keyWindow?.rootViewController
    while let presented = top?.presentedViewController {top = presented}
    return top
  }
}

// Quick Look for one file, read-only. A temporary copy (a photo) is removed when
// the preview closes; it is the app's own file, never one of the user's.
@MainActor
private final class Preview: NSObject, QLPreviewControllerDataSource, @preconcurrency QLPreviewControllerDelegate {
  let controller = QLPreviewController()
  private let url: URL, temporary: Bool, closed: () -> Void

  init(url: URL, temporary: Bool, closed: @escaping () -> Void) {
    self.url = url; self.temporary = temporary; self.closed = closed
    super.init()
    controller.dataSource = self
    controller.delegate = self
  }

  func numberOfPreviewItems(in controller: QLPreviewController) -> Int {1}
  func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> any QLPreviewItem {url as NSURL}
  func previewControllerDidDismiss(_ controller: QLPreviewController) {
    if temporary {try? FileManager.default.removeItem(at: url)}
    closed()
  }
}

// UIDocumentPickerViewController for one or more folders; reports the picks (none when canceled) once.
private final class FolderPicker: NSObject, UIDocumentPickerDelegate {
  let controller = UIDocumentPickerViewController(forOpeningContentTypes: [.folder])
  private var done: (([URL]) -> Void)?

  init(_ done: @escaping ([URL]) -> Void) {
    self.done = done
    super.init()
    controller.delegate = self
    controller.allowsMultipleSelection = true
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {finish(urls)}
  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {finish([])}
  private func finish(_ urls: [URL]) {done?(urls); done = nil}
}
#endif
