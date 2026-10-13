import SwiftUI

// One window with the native interface (RootView), on the Mac and on the iPhone.
@main
struct DevCleanApp: App {
  var body: some Scene {
#if os(macOS)
    Window("DevClean", id: "main") {
      RootView()
        // The title bar is drawn by the app; the traffic lights sit over it.
        .ignoresSafeArea()
        .frame(minWidth: 900, minHeight: 650)
        .preferredColorScheme(.dark)
    }
    .windowStyle(.hiddenTitleBar)
    .defaultSize(width: 1280, height: 850)
#else
    WindowGroup {
      RootView().preferredColorScheme(.dark)
    }
#endif
  }
}
