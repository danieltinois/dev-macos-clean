// The app's one screen, laid out like the original web UI: title bar, heading,
// scope, the overview sidebar next to the results, warnings and footer, with
// the details dialog and the guided tour on top. Layout follows the window
// width with the same breakpoints the CSS used.
import DevCleanKit
import SwiftUI

struct RootView: View {
  @State private var model: AppModel
  @State private var launched = false

  init() {
#if os(macOS)
    _model = State(initialValue: AppModel(actions: MacActions()))
#else
    _model = State(initialValue: AppModel(actions: PhoneActions()))
#endif
  }

  var body: some View {
    MainView(model: model)
      .onAppear {
        guard !launched else {return}
        launched = true
        model.launch()
      }
  }
}

struct MainView: View {
  @Bindable var model: AppModel

  var body: some View {
    GeometryReader {geometry in
      let metrics = Metrics(width: geometry.size.width)
      ZStack(alignment: .topLeading) {
        ScrollViewReader {proxy in
          ScrollView {
            content(metrics)
          }
          .scrollDisabled(model.details != nil)
          .onChange(of: model.scrollRequest?.id) {
            guard let target = model.scrollRequest?.target else {return}
            withAnimation(UIMotion.reduced ? nil : .easeInOut(duration: 0.35)) {proxy.scrollTo(target, anchor: .center)}
          }
        }
        DetailsOverlay(model: model)
        if model.opening {OpeningOverlay(text: model.platform.opening)}
        if model.touring {TourOverlay(model: model, view: geometry.size)}
      }
      .environment(\.metrics, metrics)
    }
    .coordinateSpace(.named("root"))
    .background(Theme.background.ignoresSafeArea())
    .foregroundStyle(Theme.text)
    .font(Theme.sans(13))
#if os(macOS)
    // Floco's eyes follow the pointer when it is clearly to one side of him.
    .onContinuousHover(coordinateSpace: .named("root")) {phase in
      if case .active(let point) = phase {model.cat.pointer(at: point.x, artFrame: model.catFrame)} else {model.cat.pointer(at: nil, artFrame: .zero)}
    }
#endif
  }

  private func content(_ metrics: Metrics) -> some View {
    VStack(spacing: 0) {
      TitleBar(platform: model.platform)
      VStack(alignment: .leading, spacing: 0) {
        Heading(model: model)
        Scope(platform: model.platform)
        if model.platform.folders {FoldersBar(model: model)}
        Columns(model: model)
          .padding(.top, metrics.compact ? 16 : 22)
        if !model.warnings.isEmpty {
          VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(model.warnings.enumerated()), id: \.offset) {Text($0.element)}
          }
          .font(Theme.mono(11)).foregroundStyle(Theme.amber).textSelection(.enabled)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding(.top, 12)
        }
        Footer(model: model)
      }
      .padding(metrics.padding)
      .frame(maxWidth: 1600)
    }
    .frame(maxWidth: .infinity)
  }
}

// MARK: Title bar, heading, scope

struct TitleBar: View {
  let platform: Platform

  var body: some View {
    let phone = platform.id == .ios
    HStack {
      HStack(alignment: .firstTextBaseline, spacing: 12) {
        Text("devclean").font(Theme.mono(12, .semibold)).foregroundStyle(Color(hex: 0xe3e5e8))
        Text("0.1").font(Theme.mono(10)).foregroundStyle(Color(hex: 0x818791))
      }
      Spacer()
      Text(platform.mode).font(Theme.mono(10)).foregroundStyle(Color(hex: 0x818791))
    }
    // The Mac's traffic lights sit on the left of the bar.
    .padding(.leading, phone ? 16 : 92).padding(.trailing, phone ? 16 : 24)
    .frame(height: phone ? 40 : 52)
    .background(Theme.titlebar)
    .overlay(alignment: .bottom) {Theme.line.frame(height: 1)}
#if os(macOS)
    .contentShape(Rectangle())
    .gesture(WindowDragGesture())
    .allowsWindowActivationEvents(true)
#endif
  }
}

struct Heading: View {
  let model: AppModel
  @Environment(\.metrics) private var metrics

  var body: some View {
    Group {
      if metrics.compact {
        VStack(alignment: .leading, spacing: 14) {brand; actions}
      } else {
        HStack(alignment: .center) {brand; Spacer(minLength: 20); actions}
      }
    }
    .padding(.bottom, metrics.compact ? 16 : 24)
  }

  private var brand: some View {
    VStack(alignment: .leading, spacing: 0) {
      TypedLogo(size: metrics.compact ? 7 : 9)
        .frame(minHeight: 5 * 1.15 * (metrics.compact ? 7 : 9), alignment: .topLeading)
        .padding(.bottom, 10)
        .accessibilityLabel("DevClean")
      Text("Caches, dependências, logs e arquivos para revisão.")
        .font(Theme.sans(12)).foregroundStyle(Theme.muted).lineSpacing(12 * 0.6 - 3)
    }
  }

  private var actions: some View {
    let compact = metrics.compact, height: CGFloat = compact ? 40 : 0
    let scanning = model.busy && model.progress != nil
    return HStack(spacing: 8) {
      Button("? Tutorial") {model.startTour()}
        .devButton(.subtle, minHeight: height, fill: compact)
        .disabled(model.busy)
        .help("Tour guiado pelo \(Tour.catName)")
        .tourTarget(.tourOpen, in: model)
      Button {Task {await model.scan()}} label: {
        if scanning {Spinning {Text("\($0) Analisando…")}} else {Text(model.scanLabel)}
      }
      .devButton(minHeight: height, fill: compact, pulsing: scanning)
      .disabled(model.busy)
      .tourTarget(.scan, in: model)
      if model.platform.automatic {
        Button(model.autoBytes > 0 ? "Limpeza automática · \(Labels.bytes(model.autoBytes))" : "Limpeza automática") {Task {await model.cleanAutomatically()}}
          .devButton(.primary, minHeight: height, fill: compact)
          .disabled(model.busy || !model.hasAuto)
          .help(model.platform.autoHelp)
          .tourTarget(.auto, in: model)
      }
    }
  }
}

struct Scope: View {
  let platform: Platform
  @Environment(\.metrics) private var metrics

  var body: some View {
    let path = Group {
      Text("ESCOPO").label()
      Text(platform.scope).font(Theme.mono(11))
    }
    Group {
      if metrics.compact {
        VStack(alignment: .leading, spacing: 4) {
          VStack(alignment: .leading, spacing: 4) {path}
          Text(platform.scopeNote).label()
        }
      } else {
        HStack(spacing: 20) {
          HStack(spacing: 20) {path}.lineLimit(1)
          Spacer(minLength: 0)
          if !metrics.narrow {Text(platform.scopeNote).label().lineLimit(1)}
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 10)
    .overlay(alignment: .top) {Theme.line.frame(height: 1)}
    .overlay(alignment: .bottom) {Theme.line.frame(height: 1)}
  }
}

// Folders picked in the Files app (iPhone): chips with a remove button.
struct FoldersBar: View {
  let model: AppModel
  @Environment(\.metrics) private var metrics

  var body: some View {
    let chips = FlowLayout(spacing: 6) {
      if model.folderLabels.isEmpty {
        Text("Nenhuma pasta. Adicione No Meu iPhone e o iCloud Drive para eu varrer tudo o que o iOS deixa, inclusive pastas de outros apps.").font(Theme.sans(11)).foregroundStyle(Theme.muted)
      }
      ForEach(Array(model.folderLabels.enumerated()), id: \.offset) {index, label in
        HStack(spacing: 4) {
          Text(label).font(Theme.mono(11)).lineLimit(1).truncationMode(.middle)
          Button("×") {Task {await model.removeFolder(index)}}
            .buttonStyle(.plain).foregroundStyle(Theme.muted)
            .padding(.horizontal, 7).padding(.vertical, 2)
            .frame(minWidth: metrics.compact ? 32 : 0, minHeight: metrics.compact ? 28 : 0)
            .disabled(model.busy)
            .accessibilityLabel("Remover a pasta \(label)")
        }
        .padding(.leading, 8).padding(.trailing, 2).padding(.vertical, 2)
        .background(Color(hex: 0x24272b), in: Capsule())
        .overlay(Capsule().strokeBorder(Theme.line, lineWidth: 1))
      }
    }
    let add = Button("+ Pasta do Arquivos") {Task {await model.addFolder()}}
      .devButton(.subtle, minHeight: metrics.compact ? 40 : 0, fill: metrics.compact)
      .disabled(model.busy)
      .tourTarget(.addFolder, in: model)
    Group {
      if metrics.compact {
        VStack(alignment: .leading, spacing: 8) {Text("ARQUIVOS").label(); chips; add}
      } else {
        HStack(spacing: 8) {Text("ARQUIVOS").label(); chips.frame(maxWidth: .infinity, alignment: .leading); add}
      }
    }
    .padding(.vertical, 10)
    .overlay(alignment: .bottom) {Theme.line.frame(height: 1)}
  }
}

// MARK: Columns and footer

// The overview sidebar next to the results; stacked above them on narrower windows.
struct Columns: View {
  let model: AppModel
  @Environment(\.metrics) private var metrics

  var body: some View {
    if metrics.stacked {
      VStack(spacing: metrics.compact ? 16 : 24) {
        overview
        Results(model: model)
      }
    } else {
      HStack(alignment: .top, spacing: 24) {
        overview.frame(width: 400)
        Results(model: model)
      }
    }
  }

  @ViewBuilder private var overview: some View {
    let gap: CGFloat = metrics.compact ? 12 : 16
    let hasDisk = model.report?.storage != nil
    if metrics.stacked && !metrics.overviewSingle {
      // Two columns, rows as tall as their tallest card (CSS grid).
      Grid(horizontalSpacing: gap, verticalSpacing: gap) {
        GridRow {
          MascotCard(model: model).frame(maxHeight: .infinity, alignment: .top)
          StatsCard(model: model).frame(maxHeight: .infinity, alignment: .top)
        }
        GridRow {
          if hasDisk {DiskCard(model: model).frame(maxHeight: .infinity, alignment: .top)}
          BreakdownCard(model: model).frame(maxHeight: .infinity, alignment: .top)
        }
      }
    } else {
      VStack(spacing: gap) {
        MascotCard(model: model)
        StatsCard(model: model)
        if hasDisk {DiskCard(model: model)}
        BreakdownCard(model: model)
      }
    }
  }
}

struct Footer: View {
  let model: AppModel
  @Environment(\.metrics) private var metrics

  var body: some View {
    let status = HStack(spacing: 5) {
      StatusDot(blinking: model.busy)
      Group {
        if let progress = model.progress {Spinning {Text("\($0) \(progress)")}} else {Text(model.status)}
      }
      .foregroundStyle(model.statusError ? Theme.danger : Color(hex: 0x8e97a4))
      .accessibilityAddTraits(.updatesFrequently)
    }
    Group {
      if metrics.compact {
        VStack(alignment: .leading, spacing: 6) {status; Text(model.timestamp)}
          .padding(.bottom, 8)
      } else {
        HStack(alignment: .firstTextBaseline, spacing: 25) {status; Spacer(minLength: 0); Text(model.timestamp)}
      }
    }
    .font(Theme.mono(10)).foregroundStyle(Color(hex: 0x8e97a4))
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(.vertical, 16)
  }
}

// The status dot, blinking while something runs.
struct StatusDot: View {
  var blinking: Bool
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    TimelineView(.periodic(from: .now, by: 0.4)) {timeline in
      let dim = blinking && !reduceMotion && Int(timeline.date.timeIntervalSinceReferenceDate / 0.4) % 2 == 1
      Circle().fill(Theme.accent).frame(width: 5, height: 5).opacity(dim ? 0.2 : 1)
    }
    .frame(width: 5, height: 5)
  }
}

// MARK: Helpers

// Lays children out in rows, wrapping when the width runs out (CSS flex-wrap).
struct FlowLayout: Layout {
  var spacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = arrange(proposal.width ?? .infinity, subviews)
    return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: rows.reduce(0) {$0 + $1.height} + spacing * CGFloat(max(0, rows.count - 1)))
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in arrange(bounds.width, subviews) {
      var x = bounds.minX
      for index in row.items {
        let size = subviews[index].sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
        subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
        x += min(size.width, bounds.width) + spacing
      }
      y += row.height + spacing
    }
  }

  private func arrange(_ width: CGFloat, _ subviews: Subviews) -> [(items: [Int], width: CGFloat, height: CGFloat)] {
    var rows: [(items: [Int], width: CGFloat, height: CGFloat)] = []
    for index in subviews.indices {
      let size = subviews[index].sizeThatFits(ProposedViewSize(width: width, height: nil)), w = min(size.width, width)
      if let last = rows.last, last.width + spacing + w <= width {
        rows[rows.count - 1].items.append(index)
        rows[rows.count - 1].width += spacing + w
        rows[rows.count - 1].height = max(last.height, size.height)
      } else {
        rows.append(([index], w, size.height))
      }
    }
    return rows
  }
}

extension View {
  // Marks a view the tour can point at: its frame (in the root space) and a scroll id.
  func tourTarget(_ target: TourTarget, in model: AppModel) -> some View {
    background {Color.clear.id(target)}
      .onGeometryChange(for: CGRect.self) {$0.frame(in: .named("root"))} action: {model.targets[target] = $0}
      .onDisappear {model.targets[target] = nil}
  }
}
