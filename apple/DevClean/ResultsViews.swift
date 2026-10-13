// The results box: title and export, filters, quick selections and cleanup,
// the table head and one row per finding (the web UI's `.results`). On the
// phone, rows become compact cards.
import DevCleanKit
import SwiftUI

struct Results: View {
  @Bindable var model: AppModel
  @Environment(\.metrics) private var metrics

  var body: some View {
    let items = model.shown
    VStack(spacing: 0) {
      VStack(spacing: 0) {
        title(items.count)
        FiltersBar(model: model)
      }
      .background(Theme.panel)
      CleanupBar(model: model)
      if !metrics.compact {TableHead()}
      list(items)
    }
    .frame(maxWidth: .infinity)
    .clipShape(RoundedRectangle(cornerRadius: 4))
    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.line, lineWidth: 1))
  }

  private func title(_ visible: Int) -> some View {
    HStack {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        Text("Resultados").font(Theme.sans(12, .semibold)).foregroundStyle(Color(hex: 0xd5d9df))
        if let report = model.report {Text("\(visible) / \(report.findings.count)").label()}
      }
      Spacer()
      Button("Exportar .json") {Task {await model.export()}}
        .devButton(.subtle)
        .disabled(model.busy || model.report == nil)
    }
    .padding(.horizontal, 14).padding(.vertical, 12)
  }

  @ViewBuilder private func list(_ items: [Indexed]) -> some View {
    if let report = model.report {
      if items.isEmpty {
        Text(report.findings.isEmpty ? "Nenhum artefato encontrado nesta análise." : "Nenhum resultado corresponde aos filtros.")
          .foregroundStyle(Color(hex: 0xa9b1bd)).multilineTextAlignment(.center)
          .frame(maxWidth: .infinity).padding(.vertical, 65).padding(.horizontal, 20)
          .overlay(alignment: .top) {Color(hex: 0x2b2e33).frame(height: 1)}
          .tourTarget(.list, in: model)
      } else {
        LazyVStack(spacing: 0) {
          ForEach(Array(items.enumerated()), id: \.element.id) {position, item in
            FindingRow(model: model, item: item, position: position)
              .modifier(FirstRow(model: model, first: position == 0))
          }
        }
        .tourTarget(.list, in: model)
      }
    } else {
      VStack(spacing: 10) {
        Text("nenhuma análise executada").font(Theme.mono(11))
        Text("Use “Analisar” para listar os artefatos.").font(Theme.sans(11)).foregroundStyle(Theme.muted)
      }
      .foregroundStyle(Color(hex: 0xa9b1bd))
      .frame(maxWidth: .infinity).padding(.vertical, 65).padding(.horizontal, 20)
      .overlay(alignment: .top) {Theme.line.frame(height: 1)}
      .tourTarget(.list, in: model)
    }
  }
}

private struct FirstRow: ViewModifier {
  let model: AppModel
  let first: Bool
  func body(content: Content) -> some View {
    if first {content.tourTarget(.firstRow, in: model)} else {content}
  }
}

// MARK: Filters

struct FiltersBar: View {
  @Bindable var model: AppModel
  @Environment(\.metrics) private var metrics

  var body: some View {
    let search = TextField("", text: $model.filters.query, prompt: Text("Filtrar nome ou caminho").foregroundStyle(Color(hex: 0x828995)))
      .textFieldStyle(.plain)
      .autocorrectionDisabled()
      .modifier(FieldLook(compact: metrics.compact))
      .frame(minWidth: 100)
      .accessibilityLabel("Buscar artefatos")
    let category = Picker(selection: $model.filters.category, label: "Categoria",
                          options: [("", "Todas as ferramentas")] + model.categories.map {($0, Labels.category($0))})
    let severity = Picker(selection: $model.filters.severity, label: "Risco",
                          options: [("", "Todos os riscos"), ("SAFE", "Baixo risco"), ("REVIEW", "Revisar"), ("DANGER", "Alto risco")])
    let sort = Picker(selection: Binding(get: {model.sort.rawValue}, set: {model.sort = Sort(rawValue: $0) ?? .size}), label: "Ordenação",
                      options: Sort.allCases.map {($0.rawValue, $0.label)})
    Group {
      if metrics.compact {
        VStack(spacing: 8) {
          search
          HStack(spacing: 8) {category; severity; sort}
        }
      } else {
        HStack(spacing: 8) {search; category.fixedSize(); severity.fixedSize(); sort.fixedSize()}
      }
    }
    .padding(.horizontal, 14).padding(.bottom, 12)
    .tourTarget(.filters, in: model)
  }

  // A `<select>`: the current option and a chevron, opening a menu.
  private struct Picker: View {
    @Binding var selection: String
    let label: String
    let options: [(value: String, title: String)]
    @Environment(\.metrics) private var metrics

    var body: some View {
      Menu {
        ForEach(options, id: \.value) {option in
          Button {selection = option.value} label: {
            if option.value == selection {Label(option.title, systemImage: "checkmark")} else {Text(option.title)}
          }
        }
      } label: {
        HStack(spacing: 6) {
          Text(options.first {$0.value == selection}?.title ?? options.first?.title ?? "").lineLimit(1).truncationMode(.tail)
          Spacer(minLength: 0)
          Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .semibold)).foregroundStyle(Color(hex: 0x828995))
        }
        .modifier(FieldLook(compact: metrics.compact))
        .contentShape(Rectangle())
      }
      .menuStyle(.button)
      .buttonStyle(.plain)
      .menuIndicator(.hidden)
      .accessibilityLabel(label)
    }
  }
}

// The look of the toolbar's inputs and selects.
private struct FieldLook: ViewModifier {
  let compact: Bool
  func body(content: Content) -> some View {
    content
      .font(Theme.sans(compact ? 14 : 11)).foregroundStyle(Color(hex: 0xb7bec8))
      .padding(.horizontal, compact ? 9 : 9).padding(.vertical, compact ? 9 : 7)
      .background(Theme.background, in: RoundedRectangle(cornerRadius: 3))
      .overlay(RoundedRectangle(cornerRadius: 3).strokeBorder(Color(hex: 0x363a40), lineWidth: 1))
  }
}

// MARK: Cleanup bar

struct CleanupBar: View {
  let model: AppModel
  @Environment(\.metrics) private var metrics

  var body: some View {
    let compact = metrics.compact, busy = model.busy
    let quick = FlowLayout(spacing: 8) {
      Button(model.filters.isActive ? "Selecionar filtrados" : "Selecionar tudo") {model.quickSelect {_ in true}}
        .devButton(.subtle, minHeight: compact ? 36 : 0)
        .disabled(busy || !model.canSelectAll)
        .help("Seleciona os itens visíveis que podem ir \(model.platform.toTrash), inclusive itens para revisar")
      if model.platform.automatic {
        Button("Projetos parados (90+ dias)\(model.hasStale ? " · \(Labels.bytes(model.staleBytes))" : "")") {model.quickSelect(\.isStale)}
          .devButton(.subtle, minHeight: compact ? 36 : 0)
          .disabled(busy || !model.hasStale)
          .help("node_modules e target/ visíveis de projetos sem modificação há mais de 90 dias")
      }
      Button("Limpar seleção") {model.quickSelect {_ in false}}
        .devButton(.subtle, minHeight: compact ? 36 : 0)
        .disabled(busy || model.selected.isEmpty)
      Text(model.selectionText).label().padding(.leading, 6)
    }
    .tourTarget(.quick, in: model)
    let clean = CleanButton(model: model)
    Group {
      if compact {
        VStack(alignment: .leading, spacing: 10) {quick; clean}
      } else {
        HStack(spacing: 15) {quick.frame(maxWidth: .infinity, alignment: .leading); clean}
      }
    }
    .padding(.horizontal, 14).padding(.vertical, 10)
    .overlay(alignment: .top) {Theme.line.frame(height: 1)}
  }
}

// The send button, glowing softly while something is selected.
private struct CleanButton: View {
  let model: AppModel
  @Environment(\.metrics) private var metrics
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var glow = false

  var body: some View {
    let ready = !model.selected.isEmpty
    Button(model.platform.send) {Task {await model.clean()}}
      .devButton(.primary, fontSize: metrics.compact ? 13 : 11, padding: EdgeInsets(top: 7, leading: 10, bottom: 7, trailing: 10), minHeight: metrics.compact ? 44 : 0, fill: metrics.compact)
      .disabled(model.busy || !ready)
      .background(RoundedRectangle(cornerRadius: 4).stroke(Theme.accent.opacity(glow && ready ? 0.13 : 0), lineWidth: 8))
      .tourTarget(.clean, in: model)
      .onChange(of: ready && !reduceMotion, initial: true) {_, on in
        if on {withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {glow = true}} else {glow = false}
      }
  }
}

// MARK: Table

struct TableHead: View {
  @Environment(\.metrics) private var metrics

  var body: some View {
    let c = metrics.columns
    HStack(spacing: c.gap) {
      Color.clear.frame(width: 18)
      Text("FERRAMENTA").frame(width: c.tool, alignment: .leading)
      Text("ARTEFATO / CAMINHO").frame(maxWidth: .infinity, alignment: .leading)
      Text("RISCO").frame(width: c.risk, alignment: .leading)
      Text("TAMANHO").frame(width: c.size, alignment: .trailing)
      Color.clear.frame(width: c.chevron)
    }
    .font(Theme.mono(9)).tracking(0.5).foregroundStyle(Color(hex: 0x838b97))
    .padding(.horizontal, 14).frame(height: 30)
    .background(Color(hex: 0x202327))
    .overlay(alignment: .top) {Theme.line.frame(height: 1)}
    .accessibilityHidden(true)
  }
}

struct FindingRow: View {
  let model: AppModel
  let item: Indexed
  let position: Int
  @Environment(\.metrics) private var metrics
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var hover = false
  @State private var shown = true

  var body: some View {
    let f = item.finding, selected = model.selected.contains(item.index), leaving = model.leaving.contains(f.path)
    let check = CheckBox(isOn: Binding(get: {selected}, set: {_ in model.toggle(item.index)}), size: metrics.compact ? 20 : 13, label: "Selecionar \(f.location)")
      .disabled(model.busy || !f.canClean)
      .help(f.cleanupReason.flatMap {$0.isEmpty ? nil : $0} ?? model.platform.send)
    Group {
      if metrics.compact {
        HStack(alignment: .center, spacing: 10) {
          check.frame(width: 22)
          Button {model.details = item} label: {
            HStack(alignment: .top, spacing: 10) {
              info(f)
              VStack(alignment: .trailing, spacing: 4) {size(f, selected); badge(f)}
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
        .padding(12)
      } else {
        let c = metrics.columns
        HStack(spacing: c.gap) {
          check.frame(width: 18)
          Button {model.details = item} label: {
            HStack(spacing: c.gap) {
              Text(Labels.category(f.category)).font(Theme.mono(11)).foregroundStyle(Color(hex: 0x9da7b5)).lineLimit(1).frame(width: c.tool, alignment: .leading)
              info(f).frame(maxWidth: .infinity, alignment: .leading)
              badge(f).frame(width: c.risk, alignment: .leading)
              size(f, selected).frame(width: c.size, alignment: .trailing)
              Text("›").foregroundStyle(hover ? Theme.accent : Color(hex: 0x747d89))
                .offset(x: hover && !reduceMotion ? 3 : 0).frame(width: c.chevron)
            }
            .contentShape(Rectangle())
          }
          .buttonStyle(.plain)
        }
        .padding(.horizontal, 14).padding(.vertical, 12)
      }
    }
    .background(selected ? Color(hex: 0x20251f) : hover ? Color(hex: 0x24282d) : Theme.background)
    .overlay(alignment: .top) {Color(hex: 0x2b2e33).frame(height: 1)}
    .onHover {hover = $0}
    .animation(reduceMotion ? nil : .easeOut(duration: 0.2), value: hover)
    .opacity(leaving || !shown ? 0 : 1)
    .offset(x: leaving ? 24 : 0, y: shown ? 0 : 6)
    .accessibilityElement(children: .contain)
    .accessibilityLabel("Detalhes de \(f.name), \(f.location)")
    .onAppear {
      // A new list fades its first rows in, one after another.
      guard !reduceMotion, Date() < model.rowsAnimateUntil else {return}
      shown = false
      withAnimation(.timingCurve(0.2, 0.7, 0.3, 1, duration: 0.35).delay(Double(min(position, 24)) * 0.018)) {shown = true}
    }
  }

  private func info(_ f: Finding) -> some View {
    let age = Labels.ageDays(f)
    return VStack(alignment: .leading, spacing: 0) {
      Text(f.name).font(Theme.sans(12, .medium)).foregroundStyle(Color(hex: 0xd4d9e0)).lineLimit(2)
      Text(age.map {"\(Labels.ago($0)) · \(f.location)"} ?? f.location)
        .font(Theme.mono(10)).foregroundStyle(Color(hex: 0x8e97a4)).lineLimit(1).truncationMode(.tail)
        .padding(.top, 6)
      if f.cleanupAllowed != true, let reason = f.cleanupReason, !reason.isEmpty {
        Text("🔒 \(reason)").font(Theme.mono(10)).foregroundStyle(Color(hex: 0x8a7f6e)).fixedSize(horizontal: false, vertical: true)
          .padding(.top, 4)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func badge(_ f: Finding) -> some View {
    Text(Labels.risk(f.severity)).font(Theme.mono(10))
      .foregroundStyle(f.severity == .safe ? Theme.accent : f.severity == .review ? Theme.amber : Theme.danger)
      .lineLimit(1)
  }

  private func size(_ f: Finding, _ selected: Bool) -> some View {
    Text("\(f.sizeComplete ? "" : "≥ ")\(Labels.bytes(f.sizeBytes))").font(Theme.mono(11)).monospacedDigit()
      .foregroundStyle(selected ? Theme.accent : Color(hex: 0xd4d9e0)).lineLimit(1).fixedSize()
  }
}
