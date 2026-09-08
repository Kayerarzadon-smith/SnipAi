import Cocoa
import WebKit

// Renders a URL through WKWebView -- the same engine SnipAi.app uses -- and
// writes a PNG. Lets us see exactly what the native app shows, rather than
// inferring it from what Chrome rendered.

let urlString = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "http://localhost:4737/dashboard"
let outPath = CommandLine.arguments.count > 2 ? CommandLine.arguments[2] : "/tmp/wk-snap.png"
let w: CGFloat = CommandLine.arguments.count > 3 ? CGFloat(Double(CommandLine.arguments[3]) ?? 1180) : 1180
let h: CGFloat = CommandLine.arguments.count > 4 ? CGFloat(Double(CommandLine.arguments[4]) ?? 900) : 900

class Snapper: NSObject, WKNavigationDelegate {
    var webView: WKWebView!
    var window: NSWindow!

    func run() {
        let frame = NSRect(x: 0, y: 0, width: w, height: h)
        // Offscreen window: takeSnapshot needs the view in a window to paint.
        window = NSWindow(contentRect: frame,
                          styleMask: [.borderless],
                          backing: .buffered,
                          defer: false)
        window.setFrameOrigin(NSPoint(x: -10000, y: -10000))
        webView = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
        webView.navigationDelegate = self
        window.contentView = webView
        window.orderFront(nil)
        guard let url = URL(string: urlString) else { exit(1) }
        webView.load(URLRequest(url: url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // give webfonts + client-side fetches time to settle
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.0) {
            let cfg = WKSnapshotConfiguration()
            webView.takeSnapshot(with: cfg) { image, error in
                guard let image = image,
                      let tiff = image.tiffRepresentation,
                      let rep = NSBitmapImageRep(data: tiff),
                      let png = rep.representation(using: .png, properties: [:]) else {
                    FileHandle.standardError.write("snapshot failed: \(String(describing: error))\n".data(using: .utf8)!)
                    exit(1)
                }
                do {
                    try png.write(to: URL(fileURLWithPath: outPath))
                    print("wrote \(outPath)")
                    exit(0)
                } catch {
                    FileHandle.standardError.write("write failed: \(error)\n".data(using: .utf8)!)
                    exit(1)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        FileHandle.standardError.write("load failed: \(error)\n".data(using: .utf8)!)
        exit(1)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        FileHandle.standardError.write("provisional load failed: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let snapper = Snapper()
snapper.run()
app.run()
