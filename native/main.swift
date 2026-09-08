import Cocoa
import WebKit

// SnipAi -- native macOS shell around the local SnipAi server.
//
// This is a real app window (WKWebView, no browser chrome), not a browser tab.
// It owns the Node server's lifecycle: starting the app starts the server,
// quitting the app stops it -- but only if this app is what started it, so
// quitting never kills a server someone else launched from the terminal.

let kPort = 4737
let kURLString = "http://localhost:\(kPort)/dashboard"
let kHealthURL = "http://localhost:\(kPort)/api/projects"
let kProjectDir = NSString(string: "~/Projects/SnipAi").expandingTildeInPath

func serverIsUp(timeout: TimeInterval = 1.5) -> Bool {
    guard let url = URL(string: kHealthURL) else { return false }
    var request = URLRequest(url: url)
    request.timeoutInterval = timeout
    var alive = false
    let sem = DispatchSemaphore(value: 0)
    let task = URLSession.shared.dataTask(with: request) { data, response, _ in
        if let http = response as? HTTPURLResponse, http.statusCode == 200,
           let data = data, let body = String(data: data, encoding: .utf8),
           body.contains("\"projects\"") {
            alive = true
        }
        sem.signal()
    }
    task.resume()
    _ = sem.wait(timeout: .now() + timeout + 0.5)
    return alive
}

/// Is the server on our port running the build that's currently on disk?
///
/// `next start` reads the build once, at boot. Leave one running, rebuild the
/// app, and it keeps serving the old bundle indefinitely -- which looks exactly
/// like "the changes didn't apply". Every page carries its own build id in the
/// payload, so comparing that against .next/BUILD_ID says whether the running
/// server is current.
func serverMatchesDiskBuild(timeout: TimeInterval = 2.0) -> Bool {
    let idPath = (kProjectDir as NSString).appendingPathComponent(".next/BUILD_ID")
    guard let diskId = try? String(contentsOfFile: idPath, encoding: .utf8)
            .trimmingCharacters(in: .whitespacesAndNewlines),
          !diskId.isEmpty,
          let url = URL(string: kURLString) else { return true }   // can't tell: don't churn

    var request = URLRequest(url: url)
    request.timeoutInterval = timeout
    request.cachePolicy = .reloadIgnoringLocalCacheData
    var matches = false
    let sem = DispatchSemaphore(value: 0)
    let task = URLSession.shared.dataTask(with: request) { data, _, _ in
        if let data = data, let body = String(data: data, encoding: .utf8) {
            matches = body.contains(diskId)
        }
        sem.signal()
    }
    task.resume()
    _ = sem.wait(timeout: .now() + timeout + 0.5)
    return matches
}

@discardableResult
func shell(_ command: String, wait: Bool = true) -> Process {
    let p = Process()
    p.launchPath = "/bin/bash"
    // login shell so PATH picks up node (a GUI-launched app gets a minimal PATH)
    p.arguments = ["-lc", command]
    p.launch()
    if wait { p.waitUntilExit() }
    return p
}

class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    var statusLabel: NSTextField!
    var spinner: NSProgressIndicator!
    var weStartedServer = false
    var pollTimer: Timer?
    var pollAttempts = 0

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildMenu()
        buildWindow()
        NSApp.activate(ignoringOtherApps: true)
        bootServerThenLoad()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        guard weStartedServer else { return }
        // Kill only the actual listener on our port -- never a client
        // connection that merely touches that port number.
        shell("lsof -ti:\(kPort) -sTCP:LISTEN | xargs kill 2>/dev/null")
    }

    // MARK: - UI

    func buildWindow() {
        let frame = NSRect(x: 0, y: 0, width: 1180, height: 820)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "SnipAi"
        // NOT .fullSizeContentView / titlebarAppearsTransparent: those let the
        // WKWebView cover the titlebar, which swallows drags and makes the
        // window impossible to move.
        window.isMovableByWindowBackground = false
        window.minSize = NSSize(width: 900, height: 600)
        // Always open centered on the PRIMARY display. Restoring the last
        // frame meant the window kept reopening on a second monitor, which
        // reads as "the app didn't launch" if you're looking at the main one.
        //
        // NSScreen.screens.first is the primary display (menu bar, origin
        // 0,0). NSScreen.main is NOT that -- it's whichever screen currently
        // has keyboard focus, which is exactly the wrong thing here.
        if let screen = NSScreen.screens.first {
            let vf = screen.visibleFrame
            let w = min(frame.width, vf.width - 80)
            let h = min(frame.height, vf.height - 80)
            window.setFrame(NSRect(x: vf.midX - w / 2, y: vf.midY - h / 2, width: w, height: h),
                            display: true)
        } else {
            window.center()
        }

        // Report where we actually landed, so placement can be verified
        // without needing a screen capture.
        let placed = window.frame
        let screenDesc = NSScreen.screens.enumerated().map { i, s in
            "screen\(i) origin=(\(Int(s.frame.origin.x)),\(Int(s.frame.origin.y))) size=\(Int(s.frame.width))x\(Int(s.frame.height))"
        }.joined(separator: " | ")
        let report = "[\(Date())] window placed at x=\(Int(placed.origin.x)) y=\(Int(placed.origin.y)) \(Int(placed.width))x\(Int(placed.height)) :: \(screenDesc)\n"
        if let data = report.data(using: .utf8) {
            let logPath = "\(kProjectDir)/.snipai-window.log"
            if FileManager.default.fileExists(atPath: logPath),
               let fh = FileHandle(forWritingAtPath: logPath) {
                fh.seekToEndOfFile()
                fh.write(data)
                fh.closeFile()
            } else {
                try? data.write(to: URL(fileURLWithPath: logPath))
            }
        }

        let config = WKWebViewConfiguration()
        webView = WKWebView(frame: frame, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.autoresizingMask = [.width, .height]
        webView.isHidden = true

        let container = NSView(frame: frame)
        container.addSubview(webView)

        spinner = NSProgressIndicator(frame: NSRect(x: frame.width / 2 - 16, y: frame.height / 2 + 10, width: 32, height: 32))
        spinner.style = .spinning
        spinner.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]
        spinner.startAnimation(nil)
        container.addSubview(spinner)

        statusLabel = NSTextField(labelWithString: "Starting SnipAi…")
        statusLabel.frame = NSRect(x: 0, y: frame.height / 2 - 30, width: frame.width, height: 20)
        statusLabel.alignment = .center
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.autoresizingMask = [.width, .minYMargin, .maxYMargin]
        container.addSubview(statusLabel)

        window.contentView = container
        window.makeKeyAndOrderFront(nil)
    }

    func buildMenu() {
        let mainMenu = NSMenu()

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About SnipAi", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Hide SnipAi", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(NSMenuItem.separator())
        appMenu.addItem(withTitle: "Quit SnipAi", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu

        let viewMenuItem = NSMenuItem()
        mainMenu.addItem(viewMenuItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "Back", action: #selector(goBack), keyEquivalent: "")
        viewMenu.addItem(NSMenuItem.separator())
        viewMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        viewMenuItem.submenu = viewMenu

        let editMenuItem = NSMenuItem()
        mainMenu.addItem(editMenuItem)
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu

        NSApp.mainMenu = mainMenu
    }

    @objc func reloadPage() { webView.reload() }
    @objc func goBack() { webView.goBack() }

    // MARK: - Server lifecycle

    func bootServerThenLoad() {
        DispatchQueue.global(qos: .userInitiated).async {
            if serverIsUp() {
                if serverMatchesDiskBuild() {
                    DispatchQueue.main.async { self.loadApp() }
                    return
                }
                // Serving an older build than what's on disk. Restart it --
                // this only relaunches the server, it never builds.
                DispatchQueue.main.async {
                    self.statusLabel.stringValue = "Loading the latest build…"
                }
                shell("lsof -ti:\(kPort) -sTCP:LISTEN | xargs kill 2>/dev/null")
                Thread.sleep(forTimeInterval: 1.2)
            }
            self.weStartedServer = true
            DispatchQueue.main.async { self.statusLabel.stringValue = "Starting SnipAi…" }
            // Never builds -- a prebuilt .next is expected. Building from a
            // GUI-launched process has been observed to hang.
            shell("cd \(kProjectDir) && nohup npm start >> .snipai.log 2>&1 &", wait: false)
            DispatchQueue.main.async { self.startPolling() }
        }
    }

    func startPolling() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.7, repeats: true) { timer in
            self.pollAttempts += 1
            DispatchQueue.global(qos: .userInitiated).async {
                if serverIsUp(timeout: 1.0) {
                    DispatchQueue.main.async {
                        timer.invalidate()
                        self.loadApp()
                    }
                } else if self.pollAttempts > 45 {
                    DispatchQueue.main.async {
                        timer.invalidate()
                        self.showFailure()
                    }
                }
            }
        }
    }

    func loadApp() {
        guard let url = URL(string: kURLString) else { return }
        webView.load(URLRequest(url: url))
    }

    func showFailure() {
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        statusLabel.stringValue = "SnipAi couldn't start. Check ~/Projects/SnipAi/.snipai.log"
    }

    // MARK: - WKUIDelegate

    /// Let our own page use the microphone.
    ///
    /// WKWebView denies capture by default, so the voice box fails with no
    /// visible error. The typed API (WKMediaCaptureType / WKPermissionDecision)
    /// needs the macOS 12 SDK and the command line tools here are 11.3, so the
    /// selector is implemented with raw values instead: type 1 is microphone,
    /// decision 1 is grant, 2 is deny. Only our own localhost origin is
    /// granted -- the app loads nothing else, and this must not become a
    /// blanket yes.
    @objc(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:)
    func webViewRequestMediaCapture(_ webView: WKWebView,
                                    origin: WKSecurityOrigin,
                                    initiatedByFrame frame: WKFrameInfo,
                                    type: Int,
                                    decisionHandler: @escaping (Int) -> Void) {
        let ours = origin.host == "localhost" && origin.port == kPort
        decisionHandler(ours && type == 1 ? 1 : 2)
    }

    // MARK: - WKNavigationDelegate

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        statusLabel.isHidden = true
        webView.isHidden = false
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showFailure()
    }

    // Open external links (anything not localhost) in the real browser
    // instead of trapping them inside the app window.
    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url,
           let host = url.host,
           host != "localhost" && host != "127.0.0.1" {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
