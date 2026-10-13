// iOS-only actions: open a report exported from the Mac and keep the last one.
// The iPhone never sees the Mac's disk, so it only reads reports.
#if os(iOS)
import DevCleanKit
import Foundation

extension AppModel {
  private static var savedURL: URL {URL.applicationSupportDirectory.appendingPathComponent("last-report.json")}

  func open(_ url: URL) {
    let scoped = url.startAccessingSecurityScopedResource()
    defer {if scoped {url.stopAccessingSecurityScopedResource()}}
    do {
      let data = try Data(contentsOf: url)
      show(try Report.decode(data))
      try FileManager.default.createDirectory(at: .applicationSupportDirectory, withIntermediateDirectories: true)
      try data.write(to: Self.savedURL)
      say("Relatório aberto.")
    } catch is DecodingError {
      say("Este arquivo não é um relatório do DevClean.", error: true)
    } catch {
      say(error.localizedDescription, error: true)
    }
  }

  func restore() {
    guard report == nil, let data = try? Data(contentsOf: Self.savedURL), let saved = try? Report.decode(data) else {return}
    show(saved)
  }
}
#endif
