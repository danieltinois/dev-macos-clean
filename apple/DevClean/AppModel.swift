// The app's state and flows (the web UI's renderer.ts without the markup): scan,
// filters, selection, cleanup, details, the Files folders and the guided tour.
// What each platform does natively (disk and Trash on the Mac, photos and Files
// on the iPhone) lives in its Actions. The views only show this model.
import DevCleanKit
import SwiftUI

enum CleanupResult {
  case canceled
  case done(Cleanup.Outcome, Report)
}

// One platform's native side: it keeps the last report and its manifest, and only
// takes indices into that report plus its token, like the old web bridge did.
@MainActor
protocol Actions: AnyObject {
  func scan(progress: @escaping @Sendable (String) -> Void) async throws -> Report
  func cleanup(indices: [Int], token: String, automatic: Bool) async throws -> CleanupResult
  func reveal(_ index: Int) async throws
  func export() async throws -> Bool
  // Folders picked in the Files app, as labels (iPhone only).
  func folders() -> [String]
  func addFolder() async throws -> [String]
  func removeFolder(_ index: Int) throws -> [String]
}

// The Mac scans the whole disk, so it has no picked folders.
extension Actions {
  func folders() -> [String] {[]}
  func addFolder() async throws -> [String] {throw Cleanup.Failure("Disponível só no iPhone.")}
  func removeFolder(_ index: Int) throws -> [String] {throw Cleanup.Failure("Disponível só no iPhone.")}
}

@MainActor
@Observable
final class AppModel {
  let platform = Platform.current
  let actions: any Actions
  let cat = Mascot()
  let guideCat = Mascot(bust: true, typeDelay: 0.02)

  private(set) var report: Report?
  var selected = Set<Int>()
  var filters = Filters()
  var sort = Sort.size
  private(set) var busy = false
  private(set) var scanned = false

  // Footer status line; while a long step runs, a spinner and `progress` replace it.
  private(set) var status = "Pronto"
  private(set) var statusError = false
  private(set) var progress: String?
  private(set) var scanLabel = "Analisar"
  private(set) var count = "Sem análise"
  private(set) var warnings: [String] = []
  private(set) var timestamp: String
  private(set) var folderLabels: [String] = []

  // The details dialog and its loading layer.
  var details: Indexed?
  private(set) var opening = false
  // Rows that just went to the Trash fade out before the report drops them.
  private(set) var leaving = Set<String>()
  // A new list fades its rows in; rows scrolled into view later just appear.
  private(set) var rowsAnimateUntil = Date.distantPast

  // The guided tour, and where its targets are on screen.
  let steps: [TourStep]
  private(set) var tourIndex: Int?
  var targets: [TourTarget: CGRect] = [:]
  // Where Floco's card art is, so his eyes can follow the pointer.
  var catFrame = CGRect.zero
  // Set when a step needs its target scrolled into view.
  private(set) var scrollRequest: (target: TourTarget, id: Int)?

  init(actions: any Actions) {
    self.actions = actions
    steps = Tour.steps(for: platform)
    timestamp = platform.footer
    cat.tips = {[weak self] in self?.tips() ?? []}
  }

  // MARK: Derived

  var shown: [Indexed] {report.map {Selection.sorted(Selection.visible($0.findings, filters), by: sort)} ?? []}
  var categories: [String] {report.map {$0.totals.byCategory.keys.sorted()} ?? []}
  private func sum(_ findings: some Sequence<Finding>) -> Int {findings.reduce(0) {$0 + $1.sizeBytes}}
  var safeBytes: Int {sum(report?.findings.filter(\.isSafe) ?? [])}
  var autoBytes: Int {sum(report?.findings.filter {$0.autoClean == true} ?? [])}
  var hasAuto: Bool {report?.findings.contains {$0.autoClean == true} ?? false}
  private var staleShown: [Finding] {shown.map(\.finding).filter {$0.canClean && $0.isStale}}
  var staleBytes: Int {sum(staleShown)}
  var hasStale: Bool {!staleShown.isEmpty}
  var canSelectAll: Bool {shown.contains {$0.finding.canClean}}

  var selectionText: String {
    guard let report, !selected.isEmpty else {return "Selecione itens para limpar"}
    let total = sum(selected.compactMap {report.findings[safe: $0]})
    let review = selected.filter {report.findings[safe: $0]?.cleanupReview == true}.count
    let inView = Set(shown.map(\.index)), hidden = selected.subtracting(inView).count
    return "\(selected.count) selecionado(s) · \(Labels.bytes(total))\(review > 0 ? " · \(review) para revisar" : "")\(hidden > 0 ? " · \(hidden) fora do filtro" : "")"
  }

  // Things the cat brings up between tasks, based on the last report.
  private func tips() -> [String] {
    var list = ["Clique numa ferramenta no gráfico para filtrar.", "Esqueceu como funciona? O botão Tutorial chama o tour.", platform.freeSpace, "Psiu… pode me fazer carinho, é só clicar."]
    guard let report else {return list}
    if let (top, size) = report.totals.byCategory.max(by: {$0.value < $1.value}) {list.append("\(Labels.category(top)) ocupa \(Labels.bytes(size)). Vale uma olhada!")}
    if autoBytes > 0 {list.append("A limpeza automática libera \(Labels.bytes(autoBytes)) com um clique.")}
    let stale = report.findings.filter(\.isStale)
    if !stale.isEmpty {list.append("\(stale.count) projeto(s) parado(s) há 90+ dias: \(Labels.bytes(sum(stale))) em dependências.")}
    return list
  }

  // MARK: Launch

  // First launch: Floco shows the app before the first scan. Afterwards, scan right away.
  func launch() {
    folderLabels = actions.folders()
    if UserDefaults.standard.bool(forKey: Tour.seenKey) {
      cat.set(.idle, "Oi! Já vou dar uma olhada no seu \(platform.device).")
      Task {await scan()}
    } else {
      cat.set(.idle, "Oi! Eu sou o \(Tour.catName).")
      startTour()
    }
  }

  private func setStatus(_ text: String, error: Bool = false) {progress = nil; status = text; statusError = error}

  // MARK: Scan

  func scan() async {
    guard !busy else {return}
    busy = true
    progress = "Analisando arquivos…"
    cat.set(.scanning, platform.scanning)
    do {
      let next = try await actions.scan {[weak self] text in Task {@MainActor in if self?.progress != nil {self?.progress = text}}}
      report = next; scanned = true; selected.removeAll()
      if !filters.category.isEmpty && next.totals.byCategory[filters.category] == nil {filters.category = ""}
      count = "\(next.totals.findings) artefatos encontrados"
      warnings = next.warnings
      timestamp = "Última análise: \(next.scannedDate.map(Labels.dateTime) ?? next.scannedAt)"
      rowsAnimateUntil = Date().addingTimeInterval(1)
      let safe = safeBytes
      setStatus(safe > 0 ? "Análise concluída · \(Labels.bytes(safe)) podem ir \(platform.toTrash) com segurança" : "Análise concluída")
      if safe > 0 {cat.set(.done, "Achei \(Labels.bytes(safe)) para limpar sem medo!")}
      else if !next.findings.isEmpty {cat.set(.done, "Tudo conferido. Veja os itens para revisar.")}
      else {cat.set(.empty, "Nada para varrer. Seu \(platform.device) está em dia!")}
    } catch {
      setStatus(error.localizedDescription, error: true)
      cat.set(.error, "Ops! A análise não terminou.")
    }
    progress = nil
    busy = false
    scanLabel = "Analisar novamente"
  }

  // MARK: Filters and selection

  // Clicking a tool in the chart filters the list to it, or clears the filter.
  func toggleCategory(_ category: String, size: Int) {
    let active = filters.category == category
    filters.category = active ? "" : category
    cat.react(active ? "Mostrando tudo de novo." : "Só \(Labels.category(category)) agora: \(Labels.bytes(size)).")
  }

  func toggle(_ index: Int) {
    if selected.contains(index) {selected.remove(index)} else {selected.insert(index)}
  }

  // Quick selections act on what the filters show; automatic cleanup always covers the whole report.
  private func selectWhere(_ predicate: (Finding) -> Bool, in items: [Indexed]? = nil) {
    selected = Set(Selection.pick(items ?? shown, predicate))
  }

  // The cat comments on quick selections.
  func quickSelect(_ predicate: (Finding) -> Bool) {
    selectWhere(predicate)
    guard let report, !selected.isEmpty else {return cat.react("Seleção limpa.")}
    let total = sum(selected.compactMap {report.findings[safe: $0]})
    let review = selected.filter {report.findings[safe: $0]?.cleanupReview == true}.count
    cat.react("\(selected.count) item(ns), \(Labels.bytes(total)).\(review > 0 ? " \(review) para revisar, confere antes!" : " Pode mandar!")")
  }

  // MARK: Cleanup

  func cleanAutomatically() async {
    guard let report else {return}
    selectWhere({$0.autoClean == true}, in: Selection.visible(report.findings, Filters()))
    await clean(automatic: true)
  }

  func clean(automatic: Bool = false) async {
    guard let report, !busy, !selected.isEmpty else {return}
    busy = true
    defer {busy = false}
    setStatus("Validando seleção…")
    cat.set(.idle, "Confere a lista antes de confirmar.")
    do {
      guard case .done(let outcome, let next) = try await actions.cleanup(indices: Array(selected), token: report.cleanupToken ?? "", automatic: automatic) else {
        setStatus("Limpeza cancelada")
        cat.set(.idle, "Tudo bem, nada foi movido.")
        return
      }
      cat.set(.cleaning, platform.cheer)
      let moved = Set(outcome.moved.map(\.path))
      if !UIMotion.reduced {
        withAnimation(.easeOut(duration: 0.3)) {leaving = moved}
        try? await Task.sleep(for: .milliseconds(320))
      }
      self.report = next; selected.removeAll(); leaving = []
      count = "\(next.totals.findings) artefatos restantes"
      warnings = next.warnings + outcome.errors.map {"\($0.path): \($0.message)"}
      let movedBytes = outcome.moved.reduce(0) {$0 + $1.sizeBytes}
      setStatus("\(outcome.moved.count) item(ns) \(platform.inTrash) · \(Labels.bytes(movedBytes)). \(platform.freeSpace)\(outcome.errors.isEmpty ? "" : " Alguns itens falharam.")", error: !outcome.errors.isEmpty)
      if outcome.errors.isEmpty {cat.set(.done, "Prontinho! \(Labels.bytes(movedBytes)) a menos. \(platform.catFreeSpace)")}
      else {cat.set(.error, "\(outcome.errors.count) item(ns) não saíram. Veja os avisos.")}
    } catch {
      setStatus(error.localizedDescription, error: true)
      cat.set(.error, "Ops! Não consegui limpar.")
    }
  }

  // MARK: Details, export and folders

  // On the iPhone this may download the item from iCloud first, so a loading layer
  // covers the details. It only shows when opening takes a moment: the Finder is instant.
  func reveal() async {
    guard let item = details, !opening else {return}
    let show = Task {try? await Task.sleep(for: .milliseconds(200)); if !Task.isCancelled {opening = true}}
    do {try await actions.reveal(item.index)} catch {
      setStatus(error.localizedDescription, error: true)
      details = nil
    }
    show.cancel()
    opening = false
  }

  func export() async {
    do {if try await actions.export() {setStatus("Relatório exportado.")}} catch {setStatus(error.localizedDescription, error: true)}
  }

  // Adding or removing a Files folder rescans when the list changed.
  func changeFolders(_ change: () async throws -> [String]) async {
    guard !busy else {return}
    do {
      let before = folderLabels.count
      folderLabels = try await change()
      if folderLabels.count != before {await scan()}
    } catch {setStatus(error.localizedDescription, error: true)}
  }
  func addFolder() async {await changeFolders {try await actions.addFolder()}}
  func removeFolder(_ index: Int) async {await changeFolders {try actions.removeFolder(index)}}

  // MARK: Photo review (iPhone)

  // Photos to review, one set per rule, in the order people usually clean them:
  // what loses nothing first, then what takes the most room.
  struct PhotoSet: Identifiable {
    let rule: String
    let name: String
    let items: [Indexed]
    let bytes: Int
    var id: String {rule}
    // Copies and similar photos come in groups, each around the photo that stays.
    var grouped: Bool {rule == "duplicate-photos" || rule == "similar-photos"}
    // Sets that start selected: copies, burst extras and the weaker similar photos.
    var preselected: Bool {["duplicate-photos", "burst-extras", "similar-photos"].contains(rule)}
  }
  private static let photoOrder = ["duplicate-photos", "burst-extras", "similar-photos", "large-videos", "screen-recordings", "screenshots", "large-photos"]

  var photoSets: [PhotoSet] {
    guard let report else {return []}
    let photos = report.findings.enumerated().filter {$0.element.path.hasPrefix(Cleanup.photoPrefix) && $0.element.canClean}
    let byRule = Dictionary(grouping: photos) {$0.element.ruleId}
    return Self.photoOrder.compactMap {rule in
      guard let items = byRule[rule], let first = items.first else {return nil}
      let indexed = items.map {Indexed(index: $0.offset, finding: $0.element)}.sorted {$0.finding.sizeBytes > $1.finding.sizeBytes}
      return PhotoSet(rule: rule, name: first.element.name, items: indexed, bytes: sum(items.map(\.element)))
    }
  }

  // The set being reviewed full screen.
  var reviewing: String?
  var reviewSet: PhotoSet? {reviewing.flatMap {rule in photoSets.first {$0.rule == rule}}}

  // Sends what the review picked to Recently Deleted (one system confirmation).
  func deleteReviewed(_ indices: Set<Int>) async {
    reviewing = nil
    selected = indices
    await clean()
  }

  // Opens one item in Quick Look from the review.
  func preview(_ index: Int) async {
    let show = Task {try? await Task.sleep(for: .milliseconds(200)); if !Task.isCancelled {opening = true}}
    do {try await actions.reveal(index)} catch {setStatus(error.localizedDescription, error: true)}
    show.cancel()
    opening = false
  }

  // MARK: Tour

  var touring: Bool {tourIndex != nil}
  var step: TourStep? {tourIndex.map {steps[$0]}}
  // The first target of the step that is on screen; nil centers the guide.
  var stepTarget: (target: TourTarget, frame: CGRect)? {
    for target in step?.targets ?? [] {if let frame = targets[target], frame.width > 0, frame.height > 0 {return (target, frame)}}
    return nil
  }

  func startTour() {
    guard !touring else {return}
    cat.set(.idle, "Fui ali te mostrar o app!")
    showStep(0)
  }

  func showStep(_ index: Int) {
    let index = max(0, min(steps.count - 1, index))
    tourIndex = index
    let step = steps[index]
    if let target = step.targets.first(where: {targets[$0] != nil}) {scrollRequest = (target, (scrollRequest?.id ?? 0) + 1)}
    guideCat.set(step.mood, step.text(scanned: scanned))
  }

  // Mid-sentence, Next finishes the line first; then it moves on.
  func nextStep() {
    guard let index = tourIndex else {return}
    if guideCat.talking {guideCat.finish()} else if index == steps.count - 1 {endTour()} else {showStep(index + 1)}
  }
  func previousStep() {if let index = tourIndex, index > 0 {showStep(index - 1)}}

  func endTour() {
    guard touring else {return}
    tourIndex = nil
    guideCat.stop()
    UserDefaults.standard.set(true, forKey: Tour.seenKey)
    // On first launch the tour runs before anything else; the first scan starts when it ends.
    if report == nil && !busy {Task {await scan()}} else {cat.react("Voltei! Qualquer coisa, chama o \(Tour.catName) no Tutorial.")}
  }
}

// Whether the system asks to reduce motion, outside views.
enum UIMotion {
  @MainActor static var reduced: Bool {
#if os(macOS)
    NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
#else
    UIAccessibility.isReduceMotionEnabled
#endif
  }
}

extension Array {
  subscript(safe index: Int) -> Element? {indices.contains(index) ? self[index] : nil}
}
