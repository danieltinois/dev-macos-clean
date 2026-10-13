// The macOS window: the same UI as the Electron app (desktop/index.html,
// renderer.ts, style.css) in a WKWebView, with `window.devclean` answered by
// the TypeScript engine and the native trusted side, like desktop/main.ts.
//
// The page stays sandboxed: it is served from the devclean:// scheme (only the
// three UI files), can't navigate or open windows, and only sends indices into
// the last report plus its token. Cleanup starts only from the user's click and
// the confirmation defaults to Cancelar.
#if os(macOS)
import AppKit
import DevCleanKit
import SwiftUI
import WebKit

struct DesktopWindow: View {
  @State private var controller = DesktopController()

  var body: some View {
    WebView(webView: controller.webView)
      .ignoresSafeArea()
      // The page's title bar is drawn in HTML; this makes it drag the window,
      // like `-webkit-app-region: drag` does in Electron.
      .overlay(alignment: .top) {
        Color.clear.frame(height: 52).contentShape(Rectangle()).gesture(WindowDragGesture()).allowsWindowActivationEvents(true)
      }
      .frame(minWidth: 900, minHeight: 650)
      .background(Color(red: 0x19 / 255, green: 0x1b / 255, blue: 0x1e / 255))
  }
}

private struct WebView: NSViewRepresentable {
  let webView: WKWebView
  func makeNSView(context: Context) -> WKWebView {webView}
  func updateNSView(_ view: WKWebView, context: Context) {}
}

// No "Reload" in the context menu: reloading would drop the report mid-cleanup.
private final class DesktopWebView: WKWebView {
  override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
    menu.items.removeAll {$0.identifier?.rawValue == "WKMenuItemIdentifierReload"}
    super.willOpenMenu(menu, with: event)
  }
}

@MainActor
final class DesktopController: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
  static let scheme = UIFiles.scheme
  private static let shim = """
  (() => {
    const call = (method, args = {}) => window.webkit.messageHandlers.devclean.postMessage({method, ...args});
    const parsed = promise => promise.then(text => JSON.parse(text));
    Object.defineProperty(window, 'devclean', {value: Object.freeze({
      scan: () => parsed(call('scan')),
      cleanup: (indices, token, automatic) => parsed(call('cleanup', {indices, token, automatic: automatic === true})),
      reveal: index => call('reveal', {index}).then(() => undefined),
      exportReport: () => call('export'),
    })});
  })();
  """

  let webView: WKWebView
  private var report: Report?
  private var manifest: Cleanup.Manifest = [:]
  private var busy = false

  override init() {
    let configuration = WKWebViewConfiguration()
    let content = configuration.userContentController
    content.addUserScript(WKUserScript(source: Self.shim, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    // Must be set before the web view exists: it copies the configuration.
    configuration.setURLSchemeHandler(UIFiles(), forURLScheme: Self.scheme)
    webView = DesktopWebView(frame: .zero, configuration: configuration)
    super.init()
    // The user content controller is shared, so `self` can be added afterwards.
    content.addScriptMessageHandler(self, contentWorld: .page, name: "devclean")
#if DEBUG
    webView.isInspectable = true
#endif
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.load(URLRequest(url: URL(string: "\(Self.scheme)://app/index.html")!))
  }

  // MARK: window.devclean

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
    // Like trusted() in main.ts: only our page's main frame may call.
    guard message.webView === webView, message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == Self.scheme else {return (nil, "Origem inválida")}
    do {
      switch try BridgeRequest(message.body) {
      case .scan: return (try await scan(), nil)
      case .cleanup(let indices, let token, let automatic): return (try await cleanup(indices: indices, token: token, automatic: automatic), nil)
      case .reveal(let index): try reveal(index); return (nil, nil)
      case .export: return (try await export(), nil)
      }
    } catch {
      return (nil, error.localizedDescription)
    }
  }

  private func scan() async throws -> String {
    if busy {throw Cleanup.Failure("Uma análise já está em andamento.")}
    busy = true
    defer {busy = false}
    // Not sandboxed, so this is the real home; the app bundle itself is protected.
    let home = NSHomeDirectory(), appRoot = Bundle.main.bundlePath
    let prepared = try await Task.detached(priority: .userInitiated) {
      let engine = try Engine.bundled(host: NativeHost(home: home))
      return try Cleanup.prepare(engine.scan(ScanOptions(home: home, globalScan: true)), engine: engine, home: home, appRoot: appRoot)
    }.value
    report = prepared.report
    manifest = prepared.manifest
    return try BridgeReply.report(prepared.report)
  }

  private func cleanup(indices: [Int], token: String, automatic: Bool) async throws -> String {
    if busy {throw Cleanup.Failure("Aguarde a operação atual.")}
    busy = true
    defer {busy = false}
    let engine = try Engine.bundled()
    let selected = try Cleanup.select(report, indices: indices, token: token, engine: engine)
    if automatic && selected.contains(where: {$0.autoClean != true}) {throw Cleanup.Failure("Item não autorizado para limpeza automática.")}
    try Cleanup.validate(selected, manifest: manifest)
    guard await confirm(Confirmation(selected, automatic: automatic)), let current = report else {return BridgeReply.canceled}
    let outcome = try Cleanup.moveToTrash(selected, manifest: &manifest, engine: engine, trash: Cleanup.systemTrash)
    let remaining = try Cleanup.remainingReport(current, moved: outcome.moved.map(\.path), engine: engine)
    report = remaining
    return try BridgeReply.cleanup(outcome, report: remaining)
  }

  // A sheet on the window; the first button, Cancelar, is the default.
  private func confirm(_ confirmation: Confirmation) async -> Bool {
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.window.title = confirmation.title
    alert.messageText = confirmation.message
    alert.informativeText = confirmation.detail
    alert.addButton(withTitle: "Cancelar")
    alert.addButton(withTitle: "Enviar à Lixeira").keyEquivalent = ""
    guard let window = webView.window else {return alert.runModal() == .alertSecondButtonReturn}
    return await alert.beginSheetModal(for: window) == .alertSecondButtonReturn
  }

  private func reveal(_ index: Int) throws {
    guard let finding = report?.findings[safe: index] else {throw Cleanup.Failure("Item inválido")}
    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: finding.path)])
  }

  private func export() async throws -> Bool {
    guard let report else {throw Cleanup.Failure("Faça uma análise primeiro.")}
    let panel = NSSavePanel()
    panel.nameFieldStringValue = "devclean-report.json"
    panel.allowedContentTypes = [.json]
    let response = if let window = webView.window {await panel.beginSheetModal(for: window)} else {panel.runModal()}
    guard response == .OK, let url = panel.url else {return false}
    try report.encoded().write(to: url)
    return true
  }

  // MARK: Page sandbox

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
    action.request.url?.scheme == Self.scheme && action.targetFrame?.isMainFrame == true ? .allow : .cancel
  }

  func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {nil}
}

// Serves devclean://app/<file> from the app's Resources/ui, and nothing else.
private final class UIFiles: NSObject, WKURLSchemeHandler {
  static let scheme = "devclean"
  private static let files = ["index.html": "text/html", "renderer.js": "text/javascript", "style.css": "text/css"]

  func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
    let url = task.request.url
    guard url?.host == "app", let name = url.map({String($0.path.dropFirst())}), let type = Self.files[name],
          let file = Bundle.main.url(forResource: name, withExtension: nil, subdirectory: "ui"), let data = try? Data(contentsOf: file) else {
      task.didFailWithError(URLError(.fileDoesNotExist))
      return
    }
    task.didReceive(HTTPURLResponse(url: url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "\(type); charset=utf-8"])!)
    task.didReceive(data)
    task.didFinish()
  }

  func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {}
}

private extension Array {
  subscript(safe index: Int) -> Element? {indices.contains(index) ? self[index] : nil}
}
#endif
