// Summary cards and the per-tool breakdown (click a tool to filter).
import DevCleanKit
import SwiftUI

extension Severity {
  var color: Color {
    switch self {case .safe: .green; case .review: .orange; case .danger: .red}
  }
}

struct OverviewPanel: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      let total = model.report?.totals.bytes ?? 0
      StatCard(label: "IDENTIFICADO", value: model.report.map {_ in Labels.bytes(total)}, fraction: total > 0 ? Double(model.safeBytes) / Double(total) : 0, color: .green,
               rest: total > 0 ? Double(model.reviewBytes) / Double(total) : 0, note: model.report.map {"\($0.totals.findings) artefatos encontrados"} ?? "Sem análise")
      StatCard(label: "LIMPEZA SEGURA", value: model.report.map {_ in Labels.bytes(model.safeBytes)}, fraction: total > 0 ? Double(model.safeBytes) / Double(total) : 0, color: .green,
               note: "Caches e dependências que se recriam")
      StatCard(label: "REVISAR", value: model.report.map {_ in Labels.bytes(model.reviewBytes)}, fraction: total > 0 ? Double(model.reviewBytes) / Double(total) : 0, color: .orange,
               note: "Conferir antes, ou limpar fora do app")
      Breakdown()
    }
  }
}

private struct StatCard: View {
  let label: String
  let value: String?
  let fraction: Double
  let color: Color
  var rest = 0.0 // stacked after `fraction` in amber, for the total
  let note: String

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      Text(label).font(.caption.monospaced()).foregroundStyle(.secondary)
      Text(value ?? "—").font(.title.monospacedDigit().bold()).contentTransition(.numericText())
      Bar(fraction: fraction, color: color, rest: rest)
      Text(note).font(.caption).foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .combine)
  }
}

struct Bar: View {
  let fraction: Double
  let color: Color
  var rest = 0.0

  var body: some View {
    GeometryReader {geometry in
      let clamp = {(value: Double) in geometry.size.width * min(max(value, 0), 1)}
      ZStack(alignment: .leading) {
        Capsule().fill(.quaternary)
        if rest > 0 {Capsule().fill(Color.orange.gradient).frame(width: clamp(fraction + rest))}
        Capsule().fill(color.gradient).frame(width: clamp(fraction))
      }
    }
    .frame(height: 6)
    .animation(.easeOut, value: fraction)
  }
}

private struct Breakdown: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text("POR FERRAMENTA").font(.caption.monospaced()).foregroundStyle(.secondary)
        Spacer()
        if !model.filters.category.isEmpty {Button("× limpar filtro") {model.filters.category = ""}.buttonStyle(.borderless).font(.caption)}
      }
      let categories = model.categories
      if model.report != nil && categories.isEmpty {Text("Nada encontrado.").foregroundStyle(.secondary)}
      ForEach(categories, id: \.slug) {category in
        let active = model.filters.category == category.slug
        Button {model.toggleCategory(category.slug)} label: {
          VStack(alignment: .leading, spacing: 3) {
            HStack {
              Text(Labels.category(category.slug)).fontWeight(active ? .semibold : .regular)
              Spacer()
              Text(Labels.bytes(category.bytes)).monospacedDigit().foregroundStyle(.secondary)
            }
            Bar(fraction: Double(category.bytes) / Double(max(categories.first?.bytes ?? 1, 1)), color: active ? .accentColor : .secondary)
          }
          .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
        .help("Mostrar só \(Labels.category(category.slug))")
      }
    }
  }
}
