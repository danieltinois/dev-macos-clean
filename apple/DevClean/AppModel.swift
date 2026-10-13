// App state shared by both platforms. On macOS it scans and cleans; on iOS it
// shows reports exported from a Mac (DevClean or `devclean scan --json`).
import DevCleanKit
import Foundation
import Observation

enum SortOrder: String, CaseIterable, Identifiable {
  case size = "Tamanho ↓", name = "Nome A–Z", date = "Modificação ↓"
  var id: Self {self}
}

@MainActor @Observable
final class AppModel {
  var report: Report?
  var filters = Filters()
  var sort = SortOrder.size
  var selected = Set<Int>()
  var detail: Indexed?
  var busy = false
  var status = "Pronto"
  var statusIsError = false
  var errors: [String] = []

  var shown: [Indexed] {
    guard let report else {return []}
    let items = Selection.visible(report.findings, filters)
    switch sort {
    case .size: return items.sorted {$0.finding.sizeBytes > $1.finding.sizeBytes}
    case .name: return items.sorted {$0.finding.name.localizedStandardCompare($1.finding.name) == .orderedAscending}
    case .date: return items.sorted {($0.finding.modifiedDate ?? .distantPast) > ($1.finding.modifiedDate ?? .distantPast)}
    }
  }

  var safeBytes: Int {report?.findings.filter(\.isSafe).reduce(0) {$0 + $1.sizeBytes} ?? 0}
  var reviewBytes: Int {(report?.totals.bytes ?? 0) - safeBytes}
  var categories: [(slug: String, bytes: Int)] {
    (report?.totals.byCategory ?? [:]).filter {$0.value > 0}.sorted {$0.value > $1.value}.map {($0.key, $0.value)}
  }
  var selectedBytes: Int {selected.reduce(0) {$0 + (report?.findings[safe: $1]?.sizeBytes ?? 0)}}
  var selectedReview: Int {selected.filter {report?.findings[safe: $0]?.cleanupReview == true}.count}

  func say(_ text: String, error: Bool = false) {status = text; statusIsError = error}

  func toggleCategory(_ slug: String) {filters.category = filters.category == slug ? "" : slug}

  // Quick selections act on what the filters show.
  func select(where predicate: (Finding) -> Bool) {selected = Set(Selection.pick(shown, predicate))}

  func show(_ report: Report) {
    self.report = report
    selected.removeAll()
    filters.category = ""
  }

#if os(macOS)
  var manifest: Cleanup.Manifest = [:]
  // A copy of the last report, ready to send to the iPhone with AirDrop.
  var shareURL: URL?
#endif
}

extension Array {
  subscript(safe index: Int) -> Element? {indices.contains(index) ? self[index] : nil}
}
