// Result rows, filters and the details view.
#if os(iOS)
import DevCleanKit
import SwiftUI

struct FilterBar: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var model = model
    HStack {
      TextField("Filtrar nome ou caminho", text: $model.filters.query).textFieldStyle(.roundedBorder)
      Picker("Ferramenta", selection: $model.filters.category) {
        Text("Todas as ferramentas").tag("")
        ForEach(model.categories.map(\.slug).sorted(), id: \.self) {Text(Labels.category($0)).tag($0)}
      }
      Picker("Risco", selection: $model.filters.severity) {
        Text("Todos os riscos").tag("")
        ForEach(Severity.allCases, id: \.self) {Text(Labels.risk($0)).tag($0.rawValue)}
      }
      Picker("Ordenar", selection: $model.sort) {ForEach(SortOrder.allCases) {Text($0.rawValue).tag($0)}}
    }
    .labelsHidden()
  }
}

struct ResultsList: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    if model.report == nil {
      ContentUnavailableView(model.busy ? "Analisando…" : "Nenhuma análise executada", systemImage: "magnifyingglass",
                             description: Text(model.busy ? "Varrendo caches e node_modules…" : "Use “Analisar” para listar os artefatos."))
    } else {
      List {
        ResultsRows()
        if !model.errors.isEmpty || !(model.report?.warnings.isEmpty ?? true) {
          DisclosureGroup("Avisos (\(model.errors.count + (model.report?.warnings.count ?? 0)))") {Warnings()}
        }
      }
    }
  }
}

struct ResultsRows: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    let items = model.shown
    if items.isEmpty {
      Text(model.report?.findings.isEmpty ?? true ? "Nenhum artefato encontrado nesta análise." : "Nenhum resultado corresponde aos filtros.").foregroundStyle(.secondary)
    }
    ForEach(items) {FindingRow(item: $0)}
  }
}

struct Warnings: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    ForEach(Array(((model.report?.warnings ?? []) + model.errors).enumerated()), id: \.offset) {
      Text($0.element).font(.caption.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
    }
  }
}

private struct FindingRow: View {
  @Environment(AppModel.self) private var model
  let item: Indexed

  var body: some View {
    let f = item.finding
    HStack(spacing: 12) {
      Button {model.detail = item} label: {
        HStack(spacing: 12) {
          VStack(alignment: .leading, spacing: 2) {
            Text(f.name).fontWeight(.medium)
            Text([Labels.ago(Labels.ageDays(f)), f.path].filter {!$0.isEmpty}.joined(separator: " · "))
              .font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
            if f.cleanupAllowed == false, let reason = f.cleanupReason, !reason.isEmpty {
              Text("🔒 \(reason)").font(.caption).foregroundStyle(.secondary).lineLimit(2)
            }
          }
          Spacer()
          Badge(severity: f.severity)
          Text("\(f.sizeComplete ? "" : "≥ ")\(Labels.bytes(f.sizeBytes))").monospacedDigit().frame(minWidth: 70, alignment: .trailing)
        }
        .contentShape(Rectangle())
      }
      .buttonStyle(.plain)
      .accessibilityLabel("Detalhes de \(f.name), \(f.path)")
    }
    .padding(.vertical, 2)
  }
}

struct Badge: View {
  let severity: Severity

  var body: some View {
    Text(Labels.risk(severity))
      .font(.caption2.weight(.semibold))
      .padding(.horizontal, 6).padding(.vertical, 2)
      .background(severity.color.opacity(0.15), in: Capsule())
      .foregroundStyle(severity.color)
  }
}

struct FindingDetail: View {
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss
  let item: Indexed

  var body: some View {
    let f = item.finding
    Form {
      Section {Text(f.description)}
      Section("Caminho") {Text(f.path).textSelection(.enabled).font(.callout.monospaced())}
      Section("Tamanho e classificação") {
        LabeledContent("Tamanho", value: "\(f.sizeComplete ? "" : "Medição parcial: pelo menos ")\(Labels.bytes(f.sizeBytes))")
        LabeledContent("Risco") {Badge(severity: f.severity)}
        LabeledContent("Recriável", value: f.reclaimable ? "Sim" : "Pode conter dados locais")
        LabeledContent("Última modificação", value: f.modifiedDate?.formatted(date: .abbreviated, time: .shortened) ?? "Indisponível")
      }
      Section("Como recriar") {
        Text(f.rebuild?.description ?? "Sem instruções de reconstrução.")
        if let commands = f.rebuild?.commands, !commands.isEmpty {
          Text(commands.joined(separator: "\n")).font(.callout.monospaced()).textSelection(.enabled)
        }
      }
      Section("Limpeza") {Text(cleanupText(f))}
      if !f.metadata.isEmpty {
        Section("Projeto") {
          ForEach(f.metadata.sorted(by: {$0.key < $1.key}), id: \.key) {LabeledContent($0.key, value: $0.value)}
        }
      }
    }
    .formStyle(.grouped)
    .navigationTitle(f.name)
  }

  private func cleanupText(_ f: Finding) -> String {
    guard let allowed = f.cleanupAllowed else {return "Analise novamente no DevClean do Mac para limpar."}
    if !allowed {return f.cleanupReason ?? ""}
    let place = "pelo DevClean no Mac"
    if f.autoClean == true {return "Incluído na limpeza automática."}
    if f.cleanupReview == true {return "Pode ir para a Lixeira \(place). Confira antes: pode conter dados que não voltam sozinhos."}
    return "Pode ir para a Lixeira \(place)."
  }
}
#endif
