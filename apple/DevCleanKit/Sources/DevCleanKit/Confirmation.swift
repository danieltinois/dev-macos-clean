// The cleanup confirmation on the Mac: what goes, review items listed apart, and
// how to get things back. The app shows it in an alert that defaults to Cancelar.
import Foundation

public struct Confirmation: Equatable, Sendable {
  public let title: String
  public let message: String
  public let detail: String

  public init(_ items: [Finding], automatic: Bool) {
    func list(_ items: [Finding]) -> String {
      if items.isEmpty {return ""}
      let paths = items.prefix(25).map(\.path).joined(separator: "\n")
      return items.count > 25 ? "\(paths)\n… e mais \(items.count - 25)\n\n" : "\(paths)\n\n"
    }
    let total = Double(items.reduce(0) {$0 + $1.sizeBytes}) / (1024 * 1024)
    let megabytes = total.formatted(.number.precision(.fractionLength(0...1)).locale(Locale(identifier: "pt_BR")))
    let review = items.filter {$0.cleanupReview == true}
    title = automatic ? "Limpeza automática" : "Enviar à Lixeira"
    message = automatic ? "Limpeza automática: mover \(items.count) cache(s) e dependência(s) para a Lixeira?" : "Mover \(items.count) item(ns) para a Lixeira?"
    detail = "\(megabytes) MB selecionados.\n\n\(list(items.filter {$0.cleanupReview != true}))"
      + (review.isEmpty ? "" : "⚠️ PARA REVISAR — podem conter dados que não voltam sozinhos (AVDs, archives, logs, caches de apps):\n\(list(review))")
      + "Feche builds e ferramentas que usam estes diretórios. Dependências precisarão ser reinstaladas e caches serão recriados.\n\nVocê pode restaurar pelo Finder. O espaço no disco só é liberado após esvaziar a Lixeira."
  }
}
