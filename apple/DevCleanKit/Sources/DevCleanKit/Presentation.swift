// What the app shows, without any UI: texts that differ between the Mac and the
// iPhone, labels and formatting (pt-BR), filters and quick selections, the disk
// panel's numbers and the guided tour. The SwiftUI views only lay these out.
import CoreGraphics
import Foundation

// MARK: Platform

public struct Platform: Sendable, Equatable {
  public enum ID: String, Sendable {case mac, ios}
  public let id: ID
  public let device: String
  // Title bar, scope line and footer.
  public let mode, scope, scopeNote, footer: String
  // Where cleanup sends items: as a button, a destination, a place and the cat's cheer.
  public let send, toTrash, inTrash, cheer: String
  // How to actually get the space back afterwards (status line and the cat).
  public let freeSpace, catFreeSpace: String
  // The details button (Finder on the Mac, Quick Look on the iPhone) and its loading text.
  public let reveal, opening: String
  // Automatic cleanup (with its tooltip and the summary's note on what is safe),
  // and the stale-projects shortcut (Mac only).
  public let automatic: Bool
  public let autoHelp, safeNote: String
  public let staleProjects: Bool
  // Folders picked in the Files app (the iPhone can't see the disk otherwise).
  public let folders: Bool
  // The disk panel: its title, and notes for findings and purgeable space.
  public let disk, foundNote, purgeableNote: String
  public let scanning, lookWhat: String

  public static let mac = Platform(
    id: .mac, device: "Mac", mode: "macOS / storage",
    scope: "Mac inteiro · caches, projetos e arquivos para revisão", scopeNote: "Disco local · acesso permitido pelo macOS",
    footer: "Limpeza via Lixeira · restauração pelo Finder.",
    send: "Enviar à Lixeira", toTrash: "para a Lixeira", inTrash: "na Lixeira", cheer: "Pra Lixeira!",
    freeSpace: "Esvazie a Lixeira para liberar espaço.", catFreeSpace: "Agora é só esvaziar a Lixeira.",
    reveal: "Mostrar no Finder", opening: "Abrindo no Finder…", automatic: true,
    autoHelp: "Envia à Lixeira caches que se recriam sozinhos e dependências de projetos parados há 90+ dias",
    safeNote: "Caches e dependências que se recriam", staleProjects: true, folders: false,
    disk: "DISCO DO MAC", foundNote: "Fica livre depois de esvaziar a Lixeira", purgeableNote: "Caches e cópias que o macOS apaga sozinho quando falta espaço",
    scanning: "Varrendo caches e node_modules…", lookWhat: "caches, node_modules e outras tralhas de dev")

  public static let ios = Platform(
    id: .ios, device: "iPhone", mode: "iOS / storage",
    scope: "iPhone · fototeca e pastas do Arquivos", scopeNote: "Só o que o iOS deixa ver · nada de outros apps",
    footer: "Limpeza via Apagados · recuperável nos apps Fotos e Arquivos.",
    send: "Enviar para Apagados", toTrash: "para Apagados", inTrash: "em Apagados", cheer: "Pra Apagados!",
    freeSpace: "Para liberar espaço já, apague de vez em Apagados, no app Fotos ou Arquivos.", catFreeSpace: "O espaço volta quando Apagados esvaziar.",
    reveal: "Abrir para conferir", opening: "Abrindo… Vídeos grandes podem levar alguns segundos.", automatic: true,
    autoHelp: "Envia para Apagados as cópias idênticas e as fotos extras de rajadas: sempre sobra uma",
    safeNote: "Cópias idênticas e extras de rajadas: sempre sobra uma", staleProjects: false, folders: true,
    disk: "ARMAZENAMENTO DO IPHONE", foundNote: "Fica livre quando Apagados esvaziar", purgeableNote: "Caches e originais do iCloud que o iOS apaga sozinho quando falta espaço",
    scanning: "Varrendo fotos e vídeos…", lookWhat: "vídeos grandes, fotos repetidas, capturas de tela velhas e outras tralhas")

#if os(iOS)
  public static let current = ios
#else
  public static let current = mac
#endif
}

// MARK: Labels and formatting

public enum Labels {
  public static let categories = [
    "node": "Node.js", "xcode": "Xcode", "android": "Android", "python": "Python", "rust": "Rust", "go": "Go", "java": "Java", "flutter": "Flutter",
    "docker": "Docker", "ide": "IDEs", "macos": "macOS", "downloads": "Downloads", "logs": "Logs", "homebrew": "Homebrew", "videos": "Vídeos",
    "screenshots": "Capturas", "photos": "Fotos", "duplicates": "Repetidas", "similar": "Parecidas", "files": "Arquivos",
    "caches": "Caches", "installers": "Instaladores",
  ]
  public static func category(_ slug: String) -> String {categories[slug] ?? slug}
  public static func risk(_ severity: Severity) -> String {
    switch severity {case .safe: "Baixo risco"; case .review: "Revisar"; case .danger: "Alto risco"}
  }

  private static let ptBR = Locale(identifier: "pt_BR")

  // `842 MB`, `2,4 GB`: binary units, pt-BR decimal comma, one decimal above bytes.
  public static func bytes(_ n: Int) -> String {
    if n < 1 {return "0 B"}
    let units = ["B", "KB", "MB", "GB", "TB"]
    let i = min(4, Int(log(Double(n)) / log(1024)))
    let value = Double(n) / pow(1024, Double(i))
    return "\(value.formatted(.number.precision(.fractionLength(0...(i > 0 ? 1 : 0))).rounded(rule: .toNearestOrAwayFromZero).locale(ptBR))) \(units[i])"
  }

  public static func ageDays(_ finding: Finding, now: Date = Date()) -> Int? {
    finding.modifiedDate.map {Int((now.timeIntervalSince($0) / 86400).rounded(.down))}
  }

  // `hoje`, `há 3 dia(s)`, `há 2 mês(es)`, `há 1,5 ano(s)`.
  public static func ago(_ days: Int?) -> String {
    guard let days else {return ""}
    if days < 1 {return "hoje"}
    if days < 31 {return "há \(days) dia(s)"}
    if days < 365 {return "há \(days / 30) mês(es)"}
    return "há \((Double(days) / 365).formatted(.number.precision(.fractionLength(0...1)).locale(ptBR))) ano(s)"
  }

  public static func dateTime(_ date: Date) -> String {
    date.formatted(Date.FormatStyle(date: .numeric, time: .standard).locale(ptBR))
  }
}

public extension Finding {
  // What to show as the location: the path, or a label for items without one (photos).
  var location: String {metadata["label"] ?? path}
  var canClean: Bool {cleanupAllowed == true}
  // "Safe" is what may go to the Trash without review; everything else needs a look.
  var isSafe: Bool {cleanupAllowed == true && cleanupReview != true}
  // A stale project output picked by automatic cleanup.
  var isStale: Bool {autoClean == true && metadata["project"] != nil}
}

// MARK: Filters and selection

public struct Filters: Equatable, Sendable {
  public var query = "", category = "", severity = ""
  public init(query: String = "", category: String = "", severity: String = "") {self.query = query; self.category = category; self.severity = severity}
  public var isActive: Bool {!query.isEmpty || !category.isEmpty || !severity.isEmpty}
}

public enum Sort: String, CaseIterable, Sendable {
  case size, name, date
  public var label: String {
    switch self {case .size: "Tamanho ↓"; case .name: "Nome A–Z"; case .date: "Modificação ↓"}
  }
}

public struct Indexed: Identifiable, Hashable, Sendable {
  public let index: Int
  public let finding: Finding
  public var id: Int {index}
  public init(index: Int, finding: Finding) {self.index = index; self.finding = finding}
}

public enum Selection {
  // Findings that pass the filters, each with its index in the report.
  public static func visible(_ findings: [Finding], _ filters: Filters) -> [Indexed] {
    let needle = filters.query.lowercased()
    return findings.enumerated().compactMap {index, f in
      guard filters.category.isEmpty || f.category == filters.category, filters.severity.isEmpty || f.severity.rawValue == filters.severity,
            needle.isEmpty || "\(f.name) \(f.location)".lowercased().contains(needle) else {return nil}
      return Indexed(index: index, finding: f)
    }
  }

  public static func sorted(_ items: [Indexed], by sort: Sort) -> [Indexed] {
    switch sort {
    case .size: items.sorted {$0.finding.sizeBytes > $1.finding.sizeBytes}
    case .name: items.sorted {$0.finding.name.localizedStandardCompare($1.finding.name) == .orderedAscending}
    case .date: items.sorted {($0.finding.modifiedDate ?? .distantPast) > ($1.finding.modifiedDate ?? .distantPast)}
    }
  }

  // Report indices of the cleanable `items` matching `predicate`. Shortest paths
  // first: a folder already picked covers anything inside it.
  public static func pick(_ items: [Indexed], _ predicate: (Finding) -> Bool) -> [Int] {
    var picked: [String] = [], indices: [Int] = []
    for item in items.filter({$0.finding.canClean && predicate($0.finding)}).sorted(by: {$0.finding.path.count < $1.finding.path.count}) {
      if picked.contains(where: {item.finding.path.hasPrefix($0 + "/")}) {continue}
      picked.append(item.finding.path); indices.append(item.index)
    }
    return indices
  }
}

// MARK: Disk panel

public struct DiskParts: Equatable, Sendable {
  public let total: Int
  // In use by everything else: system, apps and files DevClean didn't flag.
  public let other: Int
  // What DevClean found, capped at the space in use.
  public let found: Int
  // What the system frees by itself when it needs room; nil when unknown.
  public let purgeable: Int?
  public let free: Int
  // Free space if every finding were cleaned and the Trash emptied.
  public let freeAfter: Int

  public init(_ storage: Storage, found: Int) {
    let used = max(0, storage.totalBytes - storage.freeBytes - (storage.purgeableBytes ?? 0)), onDisk = max(0, min(found, used))
    total = storage.totalBytes; other = used - onDisk; self.found = onDisk; purgeable = storage.purgeableBytes; free = storage.freeBytes; freeAfter = storage.freeBytes + onDisk
  }
}

// Blocks filled in a `width`-wide bar for `value` of `max` (core/ascii.ts bar()):
// any non-zero value gets at least one block so small items stay visible.
public func barBlocks(_ value: Int, of max: Int, width: Int) -> Int {
  guard max > 0 else {return 0}
  let ratio = Swift.min(Swift.max(Double(value) / Double(max), 0), 1)
  return ratio > 0 ? Swift.max(1, Int((ratio * Double(width)).rounded())) : 0
}

// MARK: Guided tour

public enum MascotState: String, Sendable {case idle, scanning, cleaning, done, error, empty}

// What a tour step points at; the first one on screen wins.
public enum TourTarget: String, Sendable, CaseIterable {
  case scan, addFolder, stats, disk, breakdown, filters, firstRow, list, quick, clean, auto, mascot, tourOpen
}

public struct TourStep: Sendable {
  public let targets: [TourTarget]
  public let mood: MascotState
  private let before: String, after: String
  init(_ targets: [TourTarget], mood: MascotState = .idle, _ text: String, afterScan: String? = nil) {
    self.targets = targets; self.mood = mood; before = text; after = afterScan ?? text
  }
  // Before the first scan the tour promises to start it; afterwards it doesn't.
  public func text(scanned: Bool) -> String {scanned ? after : before}
}

public enum Tour {
  public static let catName = "Floco"
  public static let seenKey = "devclean.tour.seen"

  // The tour for `platform`; the iPhone skips what it doesn't have.
  public static func steps(for platform: Platform) -> [TourStep] {
    let device = platform.device, look = platform.lookWhat
    var steps = [
      TourStep([], "Oi! Eu sou o \(catName), o gato da faxina. Vou te mostrar o DevClean num minutinho."),
      TourStep([.scan], "Esse botão vasculha o \(device) atrás de \(look). Assim que a gente terminar, eu faço a primeira análise.",
               afterScan: "Aqui eu vasculho o \(device) atrás de \(look). Eu já faço isso sozinho quando o app abre."),
    ]
    if platform.folders {steps.append(TourStep([.addFolder], "Quer que eu varra o app Arquivos também? Escolhe No Meu iPhone e o iCloud Drive aqui: eu olho até as pastas de outros apps."))}
    steps += [
      TourStep([.stats], "O resumo: quanto eu achei, quanto dá pra limpar sem medo e quanto é melhor você conferir antes."),
      TourStep([.disk, .stats], "O espaço do \(device): o que está em uso, o que eu achei, o que o sistema libera sozinho e quanto está livre."),
      TourStep([.breakdown], "Espaço por ferramenta, do maior pro menor. Clica numa barra que eu filtro a lista pra você."),
      TourStep([.filters], "Também dá pra buscar por nome ou caminho, filtrar por risco e mudar a ordem."),
      TourStep([.firstRow, .list], "Cada linha é um achado: ferramenta, caminho, risco e tamanho. Clica pra ver detalhes e como recriar. Cadeado quer dizer que eu não deixo limpar, e eu explico o porquê."),
    ]
    steps += platform.id == .mac ? [
      TourStep([.quick], "\"Selecionar tudo\" pega só o que está nos filtros. \"Projetos parados\" pega dependências de projetos sem mexer há 90+ dias."),
      TourStep([.clean], "Escolheu? Manda pra Lixeira. Eu sempre peço confirmação, e dá pra restaurar pelo Finder."),
      TourStep([.auto], "Com pressa? A limpeza automática leva só caches que se recriam sozinhos e dependências de projetos parados."),
    ] : [
      TourStep([.quick], "\"Selecionar tudo\" pega só o que está nos filtros. O resto é com você: foto é sua, você escolhe."),
      TourStep([.clean], "Escolheu? Manda pra Apagados. O iPhone pede confirmação, e dá pra recuperar nos apps Fotos e Arquivos."),
      TourStep([.auto], "Com pressa? A limpeza automática leva só cópias idênticas e extras de rajadas. Sempre sobra uma de cada."),
    ]
    steps += [
      TourStep([.mascot], "E aqui é o meu cantinho. Quando a gente terminar eu volto pra cá, fico dando dicas e aceito carinho."),
      TourStep([.tourOpen], mood: .done, "Pronto! Agora eu começo a análise. Se quiser rever o tour, é só clicar em Tutorial.",
               afterScan: "Pronto! Se quiser rever, é só clicar em Tutorial. Boa faxina!"),
    ]
    return steps
  }

  public enum Side: Sendable {case right, left, below, above, center}

  // Where to put the guide (size `guide`) next to `target` inside `view`: to the right
  // if it fits, else left, below, above; centered when there is no target. Always clamped to the view.
  public static func place(_ target: CGRect?, guide: CGSize, in view: CGSize, gap: CGFloat = 18) -> (origin: CGPoint, side: Side) {
    func clamp(_ v: CGFloat, _ max: CGFloat) -> CGFloat {Swift.max(12, Swift.min(v, max - 12))}
    guard let target else {
      return (CGPoint(x: clamp((view.width - guide.width) / 2, view.width - guide.width), y: clamp((view.height - guide.height) / 2, view.height - guide.height)), .center)
    }
    let middleY = target.midY - guide.height / 2, middleX = target.midX - guide.width / 2
    let options: [(Side, CGFloat, CGFloat, Bool)] = [
      (.right, target.maxX + gap, middleY, target.maxX + gap + guide.width <= view.width - 12),
      (.left, target.minX - gap - guide.width, middleY, target.minX - gap - guide.width >= 12),
      (.below, middleX, target.maxY + gap, target.maxY + gap + guide.height <= view.height - 12),
      (.above, middleX, target.minY - gap - guide.height, target.minY - gap - guide.height >= 12),
    ]
    let pick = options.first {$0.3} ?? options[2]
    return (CGPoint(x: clamp(pick.1, view.width - guide.width), y: clamp(pick.2, view.height - guide.height)), pick.0)
  }
}
