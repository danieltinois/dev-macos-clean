import SwiftUI

@main
struct DevCleanApp: App {
#if os(macOS)
  var body: some Scene {
    // One window, like the Electron app.
    Window("DevClean", id: "main") {DesktopWindow()}
      .windowStyle(.hiddenTitleBar)
      .defaultSize(width: 1280, height: 850)
  }
#else
  @State private var model = AppModel()

  var body: some Scene {
    WindowGroup {ContentView().environment(model)}
  }
#endif
}
