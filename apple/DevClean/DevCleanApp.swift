import SwiftUI

@main
struct DevCleanApp: App {
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {
      ContentView()
        .environment(model)
    }
#if os(macOS)
    .defaultSize(width: 1180, height: 780)
    .commands {
      CommandGroup(after: .newItem) {
        Button("Analisar") {Task {await model.scan()}}.keyboardShortcut("r").disabled(model.busy)
        Button("Exportar .json…") {model.export()}.keyboardShortcut("e").disabled(model.report == nil)
      }
    }
#endif
  }
}
