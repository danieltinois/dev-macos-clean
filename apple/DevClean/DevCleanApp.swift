import SwiftUI

// One window running the shared UI (see WebShell.swift).
@main
struct DevCleanApp: App {
  var body: some Scene {
#if os(macOS)
    Window("DevClean", id: "main") {DesktopWindow()}
      .windowStyle(.hiddenTitleBar)
      .defaultSize(width: 1280, height: 850)
#else
    WindowGroup {PhoneWindow()}
#endif
  }
}
