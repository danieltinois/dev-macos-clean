// The desktop UI (desktop/renderer.ts) talks to its shell through
// `window.devclean`. In the Swift app those calls arrive as script messages;
// this validates them like desktop/main.ts does for IPC: only indices into the
// last report plus its token, never paths from the page.
import Foundation

public enum BridgeRequest: Equatable, Sendable {
  case scan
  case cleanup(indices: [Int], token: String, automatic: Bool)
  case reveal(index: Int)
  case export

  public init(_ body: Any) throws {
    guard let body = body as? [String: Any], let method = body["method"] as? String else {throw Cleanup.Failure("Pedido inválido.")}
    switch method {
    case "scan": self = .scan
    case "export": self = .export
    case "reveal":
      guard let index = Self.integer(body["index"]) else {throw Cleanup.Failure("Item inválido")}
      self = .reveal(index: index)
    case "cleanup":
      guard let raw = body["indices"] as? [Any], raw.count <= 1000 else {throw Cleanup.Failure("Seleção inválida.")}
      let indices = try raw.map {value in
        guard let index = Self.integer(value) else {throw Cleanup.Failure("Seleção inválida.")}
        return index
      }
      // A missing or wrong token fails later against the report's own token.
      self = .cleanup(indices: indices, token: body["token"] as? String ?? "", automatic: Self.isTrue(body["automatic"]))
    default: throw Cleanup.Failure("Pedido inválido.")
    }
  }

  // An integral JavaScript number (booleans and fractions are rejected).
  static func integer(_ value: Any?) -> Int? {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {return nil}
    let double = number.doubleValue
    guard double.rounded() == double, abs(double) < 1e15 else {return nil}
    return Int(double)
  }

  // Like `automatic === true` in main.ts.
  static func isTrue(_ value: Any?) -> Bool {
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {return false}
    return number.boolValue
  }
}

// JSON replies in the shapes desktop/preload.ts declares.
public enum BridgeReply {
  public static let canceled = #"{"canceled":true}"#

  public static func report(_ report: Report) throws -> String {try json(report)}

  public static func cleanup(_ outcome: Cleanup.Outcome, report: Report) throws -> String {
    struct Moved: Encodable {let path: String; let size_bytes: Int}
    struct Failed: Encodable {let path: String; let message: String}
    struct Reply: Encodable {let moved: [Moved]; let errors: [Failed]; let report: Report}
    return try json(Reply(moved: outcome.moved.map {Moved(path: $0.path, size_bytes: $0.sizeBytes)},
                          errors: outcome.errors.map {Failed(path: $0.path, message: $0.message)}, report: report))
  }

  private static func json<T: Encodable>(_ value: T) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .withoutEscapingSlashes
    return String(decoding: try encoder.encode(value), as: UTF8.self)
  }
}

// The cleanup confirmation, with the same wording as desktop/main.ts.
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
