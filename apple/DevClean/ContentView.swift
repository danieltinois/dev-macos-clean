// Top-level layout: a split view with actions on the Mac, a single list on the iPhone.
import DevCleanKit
import SwiftUI
import UniformTypeIdentifiers

struct ContentView: View {
  @Environment(AppModel.self) private var model

  var body: some View {
#if os(macOS)
    MacLayout()
#else
    PhoneLayout()
#endif
  }
}

#if os(macOS)
private struct MacLayout: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    NavigationSplitView {
      ScrollView {OverviewPanel().padding()}
        .navigationSplitViewColumnWidth(min: 280, ideal: 320)
    } detail: {
      VStack(spacing: 0) {
        FilterBar().padding([.horizontal, .top])
        CleanupBar().padding()
        Divider()
        ResultsList()
        StatusLine()
      }
    }
    .navigationTitle("DevClean")
    .navigationSubtitle(model.report.map {"\($0.totals.findings) artefatos · \(Labels.bytes($0.totals.bytes))"} ?? "Caches, dependências, logs e arquivos para revisão")
    .toolbar {
      ToolbarItemGroup {
        Button(model.report == nil ? "Analisar" : "Analisar novamente", systemImage: "arrow.clockwise") {Task {await model.scan()}}
          .disabled(model.busy)
        if let url = model.shareURL {
          ShareLink(item: url) {Label("Enviar ao iPhone", systemImage: "iphone.and.arrow.forward")}
            .help("Envie o relatório por AirDrop e abra no DevClean do iPhone")
        }
        Button("Exportar .json", systemImage: "square.and.arrow.down") {model.export()}
          .disabled(model.report == nil || model.busy)
      }
    }
    .sheet(item: Bindable(model).detail) {FindingDetail(item: $0)}
    .task {if model.report == nil {await model.scan()}}
  }
}

private struct CleanupBar: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    let items = model.shown
    let stale = items.filter {$0.finding.canClean && $0.finding.isStale}
    let auto = model.report?.findings.filter {$0.autoClean == true} ?? []
    HStack {
      Button(model.filters.isActive ? "Selecionar filtrados" : "Selecionar tudo") {model.select {_ in true}}
        .disabled(model.busy || !items.contains {$0.finding.canClean})
      Button("Projetos parados (90+ dias)\(stale.isEmpty ? "" : " · \(Labels.bytes(stale.reduce(0) {$0 + $1.finding.sizeBytes}))")") {model.select(where: \.isStale)}
        .disabled(model.busy || stale.isEmpty)
        .help("node_modules e target/ de projetos sem modificação há mais de 90 dias")
      Button("Limpar seleção") {model.selected.removeAll()}.disabled(model.busy || model.selected.isEmpty)
      Text(model.selected.isEmpty ? "Selecione itens para limpar" : "\(model.selected.count) selecionado(s) · \(Labels.bytes(model.selectedBytes))\(model.selectedReview > 0 ? " · \(model.selectedReview) para revisar" : "")")
        .foregroundStyle(.secondary).font(.callout)
      Spacer()
      Button("Limpeza automática\(auto.isEmpty ? "" : " · \(Labels.bytes(auto.reduce(0) {$0 + $1.sizeBytes}))")") {model.clean(automatic: true)}
        .disabled(model.busy || auto.isEmpty)
        .help("Envia à Lixeira caches que se recriam sozinhos e dependências de projetos parados há 90+ dias")
      Button("Enviar à Lixeira") {model.clean(automatic: false)}
        .buttonStyle(.borderedProminent)
        .disabled(model.busy || model.selected.isEmpty)
    }
    .controlSize(.regular)
  }
}

private struct StatusLine: View {
  @Environment(AppModel.self) private var model

  var body: some View {
    HStack {
      if model.busy {ProgressView().controlSize(.small)}
      Text(model.status).foregroundStyle(model.statusIsError ? .red : .secondary)
      Spacer()
      Text(model.report?.scannedDate.map {"Última análise: \($0.formatted(date: .abbreviated, time: .shortened))"} ?? "Limpeza via Lixeira · restauração pelo Finder.")
        .foregroundStyle(.secondary)
    }
    .font(.callout)
    .padding(.horizontal).padding(.vertical, 8)
    .background(.bar)
  }
}
#endif

#if os(iOS)
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
            Text("O iPhone não enxerga o disco do Mac. Analise no DevClean do Mac, toque em “Enviar ao iPhone” e abra o arquivo aqui. Relatórios do `devclean scan --json` também funcionam.")
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
