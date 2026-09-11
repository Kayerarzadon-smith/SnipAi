import Cocoa
import WebKit

/*
 * A layout probe: loads a local HTML file in WKWebView -- the same engine
 * SnipAi.app renders with -- at a given viewport size, evaluates a JS file
 * against it, and prints whatever that returns as JSON on stdout.
 *
 * It exists because of ledger C30, where the claim worth proving was not
 * "the Play button is rendered" (it was, all night, while five real clicks
 * did nothing) but "the topmost element at the Play button's centre is the
 * Play button". That is a question about clipping, stacking and flow, so it
 * needs something that actually performs layout. `document.elementFromPoint`
 * answers it in one call; nothing in Node can.
 *
 * Deliberately dumb and deliberately small. It is not a DOM harness and must
 * not grow into one: no React, no bundler, no component rendering. It takes a
 * file of HTML, a file of JS, and a size. M2 (jsdom + a render helper) is a
 * separate, larger piece of work and this does not stand in for it -- jsdom
 * has no layout engine and could not answer C30's question at all.
 *
 *   layout-probe <html> <js> [width] [height]
 *
 * Compiled on demand by tests/regressions/C30-*.test.mts, the way
 * scripts/check-launcher compiles tests/native/launch-decision-probe.swift.
 */

guard CommandLine.arguments.count > 2 else {
    FileHandle.standardError.write("usage: layout-probe <html> <js> [w] [h]\n".data(using: .utf8)!)
    exit(2)
}
let htmlPath = CommandLine.arguments[1]
let jsPath = CommandLine.arguments[2]
let w: CGFloat = CommandLine.arguments.count > 3 ? CGFloat(Double(CommandLine.arguments[3]) ?? 1180) : 1180
let h: CGFloat = CommandLine.arguments.count > 4 ? CGFloat(Double(CommandLine.arguments[4]) ?? 900) : 900

// A load that never finishes must not hang the suite.
DispatchQueue.global().asyncAfter(deadline: .now() + 30) {
    FileHandle.standardError.write("layout-probe: timed out after 30s\n".data(using: .utf8)!)
    exit(3)
}

final class Probe: NSObject, WKNavigationDelegate {
    var webView: WKWebView!
    var window: NSWindow!

    func run() {
        let frame = NSRect(x: 0, y: 0, width: w, height: h)
        // Offscreen, but in a window: WebKit does not lay out a view that has
        // never been hosted, and an unlaid-out page reports every rect as zero.
        window = NSWindow(contentRect: frame, styleMask: [.borderless],
                          backing: .buffered, defer: false)
        window.setFrameOrigin(NSPoint(x: -10000, y: -10000))
        webView = WKWebView(frame: frame, configuration: WKWebViewConfiguration())
        webView.navigationDelegate = self
        window.contentView = webView
        window.orderFront(nil)
        let url = URL(fileURLWithPath: htmlPath)
        // read access to the folder, so the page can pull in its stylesheet
        webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let js = try? String(contentsOfFile: jsPath, encoding: .utf8) else {
            FileHandle.standardError.write("cannot read \(jsPath)\n".data(using: .utf8)!)
            exit(1)
        }
        // one turn of the run loop past `didFinish`, so the stylesheet has been
        // applied and the first layout has happened
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            webView.evaluateJavaScript("JSON.stringify((function(){\n\(js)\n})())") { result, error in
                if let error = error {
                    FileHandle.standardError.write("js failed: \(error)\n".data(using: .utf8)!)
                    exit(1)
                }
                print(result as? String ?? "null")
                exit(0)
            }
        }
    }

    func fail(_ error: Error) {
        FileHandle.standardError.write("load failed: \(error)\n".data(using: .utf8)!)
        exit(1)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)   // no Dock icon, no menu bar, no focus stolen
let probe = Probe()
probe.run()
app.run()
