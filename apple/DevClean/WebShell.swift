// The shell shared by macOS and iPhone: the web UI (ui/index.html,
// renderer.ts, style.css) in a WKWebView, with `window.devclean`
// (ui/bridge.ts) answered natively.
//
// The page stays sandboxed: it is served from the devclean:// scheme (only the
// three UI files), can't navigate or open windows, and only sends indices into
// the last report plus its token. What each platform does with those calls
// lives in its ShellActions (MacActions, PhoneActions).
import DevCleanKit
import SwiftUI
import WebKit

// One platform's answers to window.devclean.
@MainActor
protocol ShellActions: AnyObject {
  // 'mac' or 'ios': which texts and buttons the UI shows (ui/platform.ts).
  var platform: String {get}
  var shell: WebShell? {get set}
  func scan() async throws -> String
  func cleanup(indices: [Int], token: String, automatic: Bool) async throws -> String
  func reveal(_ index: Int) async throws
  func export() async throws -> Bool
  // Folders picked in the Files app, as labels (iPhone only).
  func folders() throws -> [String]
  func addFolder() async throws -> [String]
  func removeFolder(_ index: Int) throws -> [String]
}

// The Mac scans the whole disk, so it has no picked folders.
extension ShellActions {
  func folders() throws -> [String] {[]}
  func addFolder() async throws -> [String] {throw Cleanup.Failure("Disponível só no iPhone.")}
  func removeFolder(_ index: Int) throws -> [String] {throw Cleanup.Failure("Disponível só no iPhone.")}
}

@MainActor
final class WebShell: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
  let webView: WKWebView
  private let actions: ShellActions

  init(actions: ShellActions) {
    self.actions = actions
    let configuration = WKWebViewConfiguration()
    let content = configuration.userContentController
    content.addUserScript(WKUserScript(source: Self.shim(platform: actions.platform), injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = false
    // Must be set before the web view exists: it copies the configuration.
    configuration.setURLSchemeHandler(UIFiles(), forURLScheme: UIFiles.scheme)
    webView = ShellWebView(frame: .zero, configuration: configuration)
    super.init()
    actions.shell = self
    // The user content controller is shared, so `self` can be added afterwards.
    content.addScriptMessageHandler(self, contentWorld: .page, name: "devclean")
#if DEBUG
    webView.isInspectable = true
#endif
#if os(iOS)
    // Show the UI's background, not white, while the page loads.
    webView.isOpaque = false
#endif
    webView.navigationDelegate = self
    webView.uiDelegate = self
    webView.load(URLRequest(url: URL(string: "\(UIFiles.scheme)://app/index.html")!))
  }

  private static func shim(platform: String) -> String {
    """
    (() => {
      const call = (method, args = {}) => window.webkit.messageHandlers.devclean.postMessage({method, ...args});
      const parsed = promise => promise.then(text => JSON.parse(text));
      Object.defineProperty(window, 'devclean', {value: Object.freeze({
        platform: '\(platform)',
        scan: () => parsed(call('scan')),
        cleanup: (indices, token, automatic) => parsed(call('cleanup', {indices, token, automatic: automatic === true})),
        reveal: index => call('reveal', {index}).then(() => undefined),
        exportReport: () => call('export'),
        folders: () => parsed(call('folders')),
        addFolder: () => parsed(call('addFolder')),
        removeFolder: index => parsed(call('removeFolder', {index})),
      })});
    })();
    """
  }

  // Status text for long calls, sent to the page as a `devclean-progress` event.
  // The page only reads it; nothing comes back.
  func progress(_ text: String) {
    guard let data = try? JSONSerialization.data(withJSONObject: [text]), let json = String(data: data, encoding: .utf8) else {return}
    webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('devclean-progress', {detail: \(json)[0]}))", completionHandler: nil)
  }

  // MARK: window.devclean

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) async -> (Any?, String?) {
    // Only our page's main frame may call.
    guard message.webView === webView, message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.protocol == UIFiles.scheme else {return (nil, "Origem inválida")}
    do {
      switch try BridgeRequest(message.body) {
      case .scan: return (try await actions.scan(), nil)
      case .cleanup(let indices, let token, let automatic): return (try await actions.cleanup(indices: indices, token: token, automatic: automatic), nil)
      case .reveal(let index): try await actions.reveal(index); return (nil, nil)
      case .export: return (try await actions.export(), nil)
      case .folders: return (try BridgeReply.folders(actions.folders()), nil)
      case .addFolder: return (try BridgeReply.folders(await actions.addFolder()), nil)
      case .removeFolder(let index): return (try BridgeReply.folders(actions.removeFolder(index)), nil)
      }
    } catch {
      return (nil, error.localizedDescription)
    }
  }

  // MARK: Page sandbox

  func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
    action.request.url?.scheme == UIFiles.scheme && action.targetFrame?.isMainFrame == true ? .allow : .cancel
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

#if os(macOS)
// No "Reload" in the context menu: reloading would drop the report mid-cleanup.
private final class ShellWebView: WKWebView {
  override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
    menu.items.removeAll {$0.identifier?.rawValue == "WKMenuItemIdentifierReload"}
    super.willOpenMenu(menu, with: event)
  }
}

struct ShellView: NSViewRepresentable {
  let shell: WebShell
  func makeNSView(context: Context) -> WKWebView {shell.webView}
  func updateNSView(_ view: WKWebView, context: Context) {}
}
#else
private typealias ShellWebView = WKWebView

struct ShellView: UIViewRepresentable {
  let shell: WebShell
  func makeUIView(context: Context) -> WKWebView {shell.webView}
  func updateUIView(_ view: WKWebView, context: Context) {}
}
#endif

// The UI's background, behind the page and the safe areas.
extension Color {
  static let shellBackground = Color(red: 0x19 / 255, green: 0x1b / 255, blue: 0x1e / 255)
}

extension Array {
  subscript(safe index: Int) -> Element? {indices.contains(index) ? self[index] : nil}
}
