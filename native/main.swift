import Cocoa
import WebKit
import AVFoundation

// SnipAi -- native macOS shell around the local SnipAi server.
//
// This is a real app window (WKWebView, no browser chrome), not a browser tab.
// It owns the Node server's lifecycle: starting the app starts the server,
// quitting the app stops it -- but only if this app is what started it, so
// quitting never kills a server someone else launched from the terminal.

let kPort = 4737
let kURLString = "http://localhost:\(kPort)/dashboard"
let kHealthURL = "http://localhost:\(kPort)/api/projects"

/// What the file chooser will let you pick.
///
/// WKOpenPanelParameters does not carry the input's `accept` attribute, so the
/// panel cannot mirror `accept="video/*"` on its own -- the filter has to be
/// stated here. This is VIDEO_EXT_LIST from lib/videoFiles.ts, which is
/// what the importer will actually take; scripts/guard-open-panel.py fails
/// the build if the two drift apart, or if a file input appears that is not
/// asking for video.
let kVideoExtensions = ["mov", "mp4", "m4v", "avi", "mkv", "webm"]

/// Everything the app runs lives beside it in Contents/Resources.
///
/// This used to be a hardcoded ~/Projects/SnipAi, which meant the app was not
/// really an app: rename that folder and it died, and on anyone else's Mac it
/// had never worked at all. Resources is wherever the bundle is, so the app
/// can be dragged to /Applications or handed to someone.
///
/// A checkout with no bundled Resources falls back to running the repo it
/// sits in, so `swiftc native/main.swift` still gives a working dev launcher.
struct Layout {
    let node: String
    let server: String        // server.js
    let code: String          // dir holding tools/
    let python: String
    let ffmpeg: String
    let buildIDPath: String
    let bundled: Bool

    static func resolve() -> Layout {
        let res0 = Bundle.main.resourcePath ?? "(nil)"
        NSLog("SnipAi: resourcePath=%@ node=%@", res0,
              FileManager.default.isExecutableFile(atPath: res0 + "/node") ? "yes" : "no")
        if let res = Bundle.main.resourcePath,
           FileManager.default.isExecutableFile(atPath: res + "/node") {
            return Layout(
                node: res + "/node",
                server: res + "/server/server.js",
                code: res + "/pipeline",
                python: res + "/pipeline/python/bin/python3",
                ffmpeg: res + "/pipeline/bin/ffmpeg",
                buildIDPath: res + "/server/.next/BUILD_ID",
                bundled: true)
        }
        // dev: the repo this binary was compiled from
        let repo = NSString(string: "~/Projects/SnipAi").expandingTildeInPath
        return Layout(
            node: "", server: "", code: repo + "/ugc-edit-system",
            python: repo + "/ugc-edit-system/.venv/bin/python3",
            ffmpeg: repo + "/ugc-edit-system/.venv/bin/ffmpeg",
            buildIDPath: repo + "/.next/BUILD_ID",
            bundled: false)
    }
}
let kLayout = Layout.resolve()
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
    guard let diskId = try? String(contentsOfFile: kLayout.buildIDPath, encoding: .utf8)
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
        primeMicrophone()
        buildMenu()
        buildWindow()
        NSApp.activate(ignoringOtherApps: true)
        bootServerThenLoad()
    }

    /// Deal with the microphone prompt at launch, not mid-sentence.
    ///
    /// Two separate permissions sit in front of the voice box: macOS has to
    /// have granted the APP microphone access, and the web view has to allow
    /// the page's request (handled in the capture delegate below). The second
    /// is automatic; the first shows a system dialog the first time, and it
    /// used to land the moment someone pressed record -- which loses the
    /// sentence they were part way through saying.
    ///
    /// Asked once, when undetermined. An outright refusal is respected: the
    /// dialog never comes back, and the voice box says why.
    func primeMicrophone() {
        guard AVCaptureDevice.authorizationStatus(for: .audio) == .notDetermined else { return }
        AVCaptureDevice.requestAccess(for: .audio) { granted in
            NSLog("SnipAi: microphone access %@", granted ? "granted" : "refused")
        }
    }

    /// Closing the window is not quitting.
    ///
    /// This returned true, so the red button ended the process -- the app
    /// vanished from the running list, the server it owns was killed, and
    /// there was no prompt and no way back. On a Mac the close button closes
    /// a window; Quit is Quit. It matters more here than it usually would,
    /// because an edit made just before the close is saved to disk and its
    /// render is still queued behind it.
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }

    /// Clicking the Dock icon brings the window back.
    ///
    /// With the app still running after a close, this is the way most people
    /// will reopen it -- and without it, the icon does nothing at all, which
    /// is worse than quitting. Window > SnipAi is the other way, for anyone
    /// who does not go to the Dock.
    func applicationShouldHandleReopen(_ sender: NSApplication,
                                       hasVisibleWindows: Bool) -> Bool {
        showMainWindow()
        return true
    }

    @objc func showMainWindow() {
        guard let w = window else { return }
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
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
        // Closing an NSWindow deallocates it by default, and reopening a
        // deallocated window is a crash, not an empty window. Nothing noticed
        // while closing quit the app outright.
        window.isReleasedWhenClosed = false
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

        // File exists for one command, and it is the one that was missing:
        // a close that is a close. Import lives on the page, not up here --
        // a menu item that only works on one screen is worse than no item.
        let fileMenuItem = NSMenuItem()
        mainMenu.addItem(fileMenuItem)
        let fileMenu = NSMenu(title: "File")
        fileMenu.addItem(withTitle: "Close Window", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileMenuItem.submenu = fileMenu

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
        // Deliberately NO Undo/Redo item here.
        //
        // A menu key equivalent is matched before the web view ever sees the
        // key, so a ⌘Z item wired to the responder chain would swallow the
        // one the editor already handles -- the undo stack in the review
        // screen, which restores the beat list. It works today precisely
        // because nothing up here claims the shortcut. Adding one to "support
        // ⌘Z" would remove it.
        editMenu.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editMenuItem.submenu = editMenu

        // Window, with an explicit way back. macOS fills a windows menu with
        // the windows that are OPEN, which is no help at all to someone whose
        // only window is the one they just closed -- so "SnipAi" is a real
        // item pointing at the window, not the list AppKit maintains.
        let windowMenuItem = NSMenuItem()
        mainMenu.addItem(windowMenuItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(NSMenuItem.separator())
        let back = NSMenuItem(title: "SnipAi", action: #selector(showMainWindow), keyEquivalent: "0")
        back.target = self
        windowMenu.addItem(back)
        windowMenuItem.submenu = windowMenu
        NSApp.windowsMenu = windowMenu

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
            NSLog("SnipAi: no server up — starting one (bundled=%@)", kLayout.bundled ? "yes" : "no")
            DispatchQueue.main.async { self.statusLabel.stringValue = "Starting SnipAi…" }
            self.startServer()
            DispatchQueue.main.async { self.startPolling() }
        }
    }

    /// Start the Node server the bundle carries.
    ///
    /// Spawned directly rather than through a login shell: a bundled app must
    /// not depend on the user having node, npm, or a particular PATH. The four
    /// SNIPAI_ variables are the whole contract with the server -- where its
    /// tools, interpreter, ffmpeg and library are.
    func startServer() {
        guard kLayout.bundled else {
            // dev fallback: run the repo the way it has always been run
            shell("cd \(kProjectDir) && nohup npm start >> .snipai.log 2>&1 &", wait: false)
            return
        }
        let logDir = NSString(string: "~/Library/Logs/SnipAi").expandingTildeInPath
        try? FileManager.default.createDirectory(atPath: logDir,
                                                withIntermediateDirectories: true)
        let logPath = logDir + "/server.log"
        if !FileManager.default.fileExists(atPath: logPath) {
            FileManager.default.createFile(atPath: logPath, contents: nil)
        }
        let handle = FileHandle(forWritingAtPath: logPath)
        handle?.seekToEndOfFile()

        let p = Process()
        p.executableURL = URL(fileURLWithPath: kLayout.node)
        p.arguments = [kLayout.server]
        // server.js resolves .next and public relative to its own directory
        p.currentDirectoryURL = URL(fileURLWithPath: (kLayout.server as NSString).deletingLastPathComponent)
        var env = ProcessInfo.processInfo.environment
        env["PORT"] = String(kPort)
        env["HOSTNAME"] = "127.0.0.1"          // never the whole network
        env["NODE_ENV"] = "production"
        env["SNIPAI_CODE"] = kLayout.code
        env["SNIPAI_PYTHON"] = kLayout.python
        env["SNIPAI_FFMPEG"] = kLayout.ffmpeg
        p.environment = env
        if let handle = handle {
            p.standardOutput = handle
            p.standardError = handle
        }
        NSLog("SnipAi: launching %@ %@", kLayout.node, kLayout.server)
        do { try p.run(); NSLog("SnipAi: server pid %d", p.processIdentifier) } catch {
            NSLog("SnipAi: could not start the server: \(error)")
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

    /// Put a file chooser in front of <input type="file">.
    ///
    /// WKWebView has no picker of its own. Without this method the click is
    /// accepted, nothing opens, no change event fires, and the page has no way
    /// to know -- which is exactly what "Import footage opens no file picker,
    /// no sheet, no error" looks like. The same page in a browser worked
    /// because the browser brings its own.
    ///
    /// Two things this has to get right. The completion handler must be called
    /// exactly once: call it twice and WebKit traps, never and the input is
    /// dead until the page reloads. And it takes the file's real URL -- the
    /// page reads the bytes straight off disk and streams them, so a 2GB
    /// import never passes through here.
    func webView(_ webView: WKWebView,
                 runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping ([URL]?) -> Void) {
        // The only route to the handler, so it cannot fire twice.
        var answered = false
        let done: ([URL]?) -> Void = { urls in
            if answered { return }
            answered = true
            completionHandler(urls)
        }

        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        // Neither input sets webkitdirectory, so a folder is never wanted.
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedFileTypes = kVideoExtensions
        panel.message = parameters.allowsMultipleSelection
            ? "Choose the video files to bring in."
            : "Choose a video file."
        panel.prompt = "Choose"

        // A sheet, so it belongs to the window it came from and the app is not
        // frozen behind it. Modal only if there is somehow no window to hang
        // it on, which would otherwise drop the picker silently again.
        if let host = webView.window ?? self.window {
            panel.beginSheetModal(for: host) { response in
                done(response == .OK ? panel.urls : nil)
            }
        } else {
            done(panel.runModal() == .OK ? panel.urls : nil)
        }
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
