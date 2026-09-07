import SwiftUI
import WebKit

struct ContentView: View {
    var body: some View {
        WebView()
            .ignoresSafeArea()
    }
}

/// Wraps a WKWebView loading the app's bundled `www/index.html` -- the
/// exact same single-file app used on the web, so there is nothing to
/// keep in sync beyond re-running `sync-web-assets.sh` after a web change.
/// Fully offline by construction (everything is already inside the app
/// bundle), so the web build's service worker isn't needed here -- it
/// registers, finds no usable ServiceWorker scope under `file://`, and
/// fails silently exactly like it does on any browser without SW support.
struct WebView: UIViewRepresentable {
    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "notesinoNative")

        /* The web app unconditionally calls window.NotesinoNative.saveTimetable(json)
           whenever the Timetable tab changes (guarded by a feature check,
           see pushTimetableToNative() in index.html) -- this shims that
           call onto the native message handler below, mirroring the
           Android WebView's addJavascriptInterface bridge. */
        let bridgeSource = """
        window.NotesinoNative = {
          saveTimetable: function(json) {
            try { window.webkit.messageHandlers.notesinoNative.postMessage(json); } catch (e) {}
          }
        };
        """
        let bridgeScript = WKUserScript(source: bridgeSource, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        contentController.addUserScript(bridgeScript)

        let config = WKWebViewConfiguration()
        config.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.scrollView.bounces = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 10.0 / 255, green: 10.0 / 255, blue: 18.0 / 255, alpha: 1)
        webView.scrollView.backgroundColor = webView.backgroundColor

        if let url = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }

        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKScriptMessageHandler {
        weak var webView: WKWebView?

        /// Mirrors the Android app's TimetableStore. A future WidgetKit
        /// extension (a separate target sharing an App Group with this
        /// app) could read this to show today's schedule without running
        /// the WebView's JS -- not implemented in this scaffold, but the
        /// data it would need is already saved here on every change.
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "notesinoNative", let json = message.body as? String else { return }
            UserDefaults.standard.set(json, forKey: "notesino_timetable_json")
        }
    }
}
