// iPhone layout: summary, per-tool breakdown and results in one list.
#if os(iOS)
import DevCleanKit
import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
  var body: some View {PhoneLayout()}
}

private struct PhoneLayout: View {
  @Environment(AppModel.self) private var model
  @State private var importing = false

  var body: some View {
    @Bindable var model = model
    NavigationStack {
      Group {
        if model.report == nil {
          ContentUnavailableView {
            Label("Nenhum relatório", systemImage: "externaldrive.badge.questionmark")
          } description: {
            Text("O iPhone não enxerga o disco do Mac. Analise no DevClean do Mac, use “Exportar .json”, envie o arquivo por AirDrop e abra aqui. Relatórios do `devclean scan --json` também funcionam.")
          } actions: {
            Button("Abrir relatório") {importing = true}.buttonStyle(.borderedProminent)
          }
        } else {
          List {
            Section {OverviewPanel()}
            Section("Resultados") {ResultsRows()}
            if !model.errors.isEmpty || !(model.report?.warnings.isEmpty ?? true) {Section("Avisos") {Warnings()}}
          }
          .searchable(text: $model.filters.query, prompt: "Filtrar nome ou caminho")
        }
      }
      .navigationTitle("DevClean")
      .navigationDestination(item: $model.detail) {FindingDetail(item: $0)}
      .toolbar {
        ToolbarItem(placement: .primaryAction) {
          Button("Abrir relatório", systemImage: "doc.badge.plus") {importing = true}
        }
        if model.report != nil {
          ToolbarItem(placement: .topBarLeading) {FilterMenu()}
        }
      }
      .safeAreaInset(edge: .bottom) {
        if model.statusIsError {Text(model.status).font(.footnote).foregroundStyle(.red).padding(8).frame(maxWidth: .infinity).background(.bar)}
      }
    }
    .fileImporter(isPresented: $importing, allowedContentTypes: [.json]) {result in
      switch result {
      case .success(let url): model.open(url)
      case .failure(let error): model.say(error.localizedDescription, error: true)
      }
    }
    .onAppear {model.restore()}
  }
}

private struct FilterMenu: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    @Bindable var model = model
    Menu {
      Picker("Risco", selection: $model.filters.severity) {
        Text("Todos os riscos").tag("")
        ForEach(Severity.allCases, id: \.self) {Text(Labels.risk($0)).tag($0.rawValue)}
      }
      Picker("Ordenar", selection: $model.sort) {ForEach(SortOrder.allCases) {Text($0.rawValue).tag($0)}}
    } label: {
      Label("Filtros", systemImage: model.filters.isActive ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
    }
  }
}
#endif
