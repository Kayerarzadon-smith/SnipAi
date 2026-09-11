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
/// NOT the health route. This is "can the server answer a page yet", polled
/// after we start one of our own; /api/health is the different and older
/// question of WHO is on the port, and it is asked first (LaunchDecision).
/// The old name for this constant was `kHealthURL`, which is how the two got
/// confused into one check in the first place -- ledger N5.
let kReadyURL = "http://localhost:\(kPort)/api/projects"

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
/// sits in, so a dev launcher still works. Build it with BOTH files:
///
///     swiftc -o "$TMPDIR/SnipAiDev" native/LaunchDecision.swift native/main.swift
///
/// `swiftc native/main.swift` alone has not built since the server-ownership
/// rule moved out into native/LaunchDecision.swift -- it fails with `cannot
/// find 'decideLaunch' / 'PortOccupant' / 'ourOrphanPIDs' in scope` (ledger
/// N3). Naming the two files rather than globbing `native/*.swift` is also
/// deliberate: native/snapshot.swift is a separate standalone program with its
/// own top-level code, and two mains cannot share a binary.
///
/// The same pair is what scripts/bundle-app compiles and what
/// scripts/check-launcher compiles on every run of ./scripts/test, so this
/// command cannot go stale again without a gate going red.
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

/// Minted once per launch and handed to every server this app spawns, as
/// SNIPAI_LAUNCH_TOKEN. A server that reports it back from /api/health is one
/// we started during THIS run; anything else is somebody's, and not ours to
/// stop. See ourListeningPIDs() for why ownership has to be asked rather than
/// observed -- the process re-titles itself, so `ps` cannot tell our own
/// bundled server from a stranger's `next dev`.
let kLaunchToken = UUID().uuidString

/// Is the server we started ready to serve a page yet?
///
/// This answers readiness and nothing else. It must never again be used to
/// decide whether the port is FREE: a 200 proves a server is up, but a
/// timeout proves only that one did not answer in 1.5 seconds, which a
/// compiling `next dev` routinely does not (ledger N5, N6).
func serverIsUp(timeout: TimeInterval = 1.5) -> Bool {
    guard let url = URL(string: kReadyURL) else { return false }
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
    /// The server WE spawned, held so quitting can stop that exact process
    /// rather than whoever is on the port by then. nil in a dev checkout,
    /// where the server is started detached through a shell.
    var serverProcess: Process?
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

        // Stop the process we started, by pid.
        //
        // This used to be `lsof -ti:PORT | xargs kill`, which asks the wrong
        // question: it stops whoever holds the port now, not the server this
        // app spawned. Those are the same process right up until they are
        // not -- our server exits, someone starts a dev server on the freed
        // port, the app quits and takes it down. `weStartedServer` proves we
        // started *a* server; it does not prove the current listener is it.
        if let p = serverProcess, p.isRunning {
            p.terminate()                       // SIGTERM: let it finish its write
            return
        }

        // No handle. Two ways to get here and they now take the same path:
        // a dev checkout, where `npm start` is detached through a shell, and a
        // bundled run whose handle we somehow lost.
        //
        // This used to branch, and the dev half was `lsof -ti:PORT | xargs
        // kill` -- the exact fallacy the launch path had just stopped making,
        // defended by citing P12's clearance of `weStartedServer`. But
        // `weStartedServer` proves we started A server; it does not prove the
        // process on the port is it. In a dev checkout that gap is not
        // theoretical and not rare: `npm start` cannot succeed in a checkout
        // with no production build at all, so EVERY dev launch on a free port
        // set this flag, produced no server, and left the port free for
        // somebody else to take -- and then killed whoever took it. Reproduced
        // 2/2. Ledger P19's surviving half.
        //
        // So: ask the port who it is, and signal only the pid that says it is
        // ours. If our server died at birth, nobody answers with our token and
        // nothing is signalled, which is the correct outcome and the one the
        // reproduction checks.
        //
        // Two seconds is enough here, where the launch allows eight: by quit
        // time the server has been serving the app, so /api/health is long
        // since compiled and answers immediately. A quit must not hang on a
        // stranger who will not talk -- and a stranger is exactly who we are
        // not going to signal.
        let identity = fetchServerIdentity(port: kPort, timeout: 2.0)
        let ours = ourListeningPIDs(port: kPort, identity: identity,
                                    ourServerPath: kLayout.server,
                                    ourLaunchToken: kLaunchToken)
        if ours.isEmpty {
            NSLog("SnipAi: quitting. We started a server but nothing on port %d " +
                  "identifies itself as it, so nothing has been stopped.", kPort)
            return
        }
        for pid in ours {
            NSLog("SnipAi: quitting. Stopping our own server, pid %d", pid)
            kill(pid, SIGTERM)
        }
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

    /// Decide what to do about port \(kPort), then do exactly that.
    ///
    /// This used to be five lines that trusted the port: adopt whatever was
    /// listening if its build matched, otherwise `lsof | xargs kill`. Both
    /// halves were wrong, in opposite directions, and both are in the ledger
    /// (N1, P19) -- see native/LaunchDecision.swift for the rule that
    /// reconciles them. The short version: the port names nobody, so ask.
    func bootServerThenLoad() {
        DispatchQueue.global(qos: .userInitiated).async {
            // Who is there, asked first and asked directly.
            //
            // This used to read `!serverIsUp() ? .free : ...`, which gated
            // identification behind a 1.5s GET of /api/projects: a server too
            // slow to answer that route -- a cold `next dev` compiling it, for
            // one -- was never asked /api/health at all, and the port was
            // filed as empty. The app then said in the log that it had
            // started a server, printed a pid that was already dead of
            // EADDRINUSE, and sat on "Starting SnipAi…" for ever. Ledger N5,
            // with N6 for the timeout.
            let occupant = lookUpOccupant(port: kPort)
            let free: Bool = { if case .free = occupant { return true }; return false }()
            switch occupant {
            case .free:
                NSLog("SnipAi: port %d is free", kPort)
            case .identified(let id):
                NSLog("SnipAi: port %d is held by a SnipAi server (pid %d, library %@)",
                      kPort, id.pid, id.dataRoot)
            case .unidentified:
                // Say what it looks like, not just that there is something.
                // `next-server (v14.2.35)` here means an old SnipAi build;
                // anything else means a different program entirely, and the
                // person has to know which before they can act on the refusal.
                let who = listeningPIDs(port: kPort)
                    .map { "\($0) (\(commandLine(ofPID: $0)))" }
                    .joined(separator: ", ")
                NSLog("SnipAi: port %d is held by something that will not identify itself: %@",
                      kPort, who)
            }

            // Both of the lookups below cost a round trip or a subprocess,
            // and neither means anything when the port is free -- which is the
            // ordinary cold launch. Asking anyway put a 2s build check in
            // front of every start.
            let identity: ServerIdentity? = {
                if case .identified(let id) = occupant { return id }
                return nil
            }()

            let action = decideLaunch(
                occupant: occupant,
                expectedDataRoot: expectedDataRoot(codeRoot: kLayout.code),
                buildMatches: free ? false : serverMatchesDiskBuild(),
                listenerIsOurOrphan: free ? false
                    : listenerIsOurOrphan(port: kPort, identity: identity,
                                          ourServerPath: kLayout.server,
                                          ourLaunchToken: kLaunchToken),
                port: kPort)

            switch action {

            case .adopt(let why):
                // Announced, never silent. A run that quietly used somebody
                // else's server is how the sandbox leaked in the first place.
                NSLog("SnipAi: %@", why)
                DispatchQueue.main.async { self.loadApp() }

            case .refuse(let why):
                NSLog("SnipAi: refusing to start — %@", why)
                DispatchQueue.main.async { self.showRefusal(why) }

            case .restartOrphan(let why):
                NSLog("SnipAi: %@", why)
                DispatchQueue.main.async {
                    self.statusLabel.stringValue = "Restarting the SnipAi server…"
                }
                // Re-asked immediately before signalling, not just in the
                // decision above: between the two there is a window in which
                // the port could change hands, and the whole point of this
                // row is that we never signal a process we have not just
                // confirmed is ours. SIGTERM, not SIGKILL -- the server gets
                // to finish writing whatever it was writing.
                let confirmed = fetchServerIdentity(port: kPort)
                for pid in ourListeningPIDs(port: kPort, identity: confirmed,
                                            ourServerPath: kLayout.server,
                                            ourLaunchToken: kLaunchToken) {
                    NSLog("SnipAi: stopping our own orphaned server, pid %d", pid)
                    kill(pid, SIGTERM)
                }
                Thread.sleep(forTimeInterval: 1.2)
                self.startOurOwnServer()

            case .startOurOwn:
                self.startOurOwnServer()
            }
        }
    }

    /// Spawn a server and take responsibility for stopping it again.
    ///
    /// `weStartedServer` is set HERE and nowhere else: it is the whole record
    /// of whether this app owns the process on the port, and quitting reads
    /// it before stopping anything.
    private func startOurOwnServer() {
        self.weStartedServer = true
        NSLog("SnipAi: starting our own server on %d (bundled=%@)",
              kPort, kLayout.bundled ? "yes" : "no")
        DispatchQueue.main.async { self.statusLabel.stringValue = "Starting SnipAi…" }
        self.startServer()
        DispatchQueue.main.async { self.startPolling() }
    }

    /// Stop, with the reason on screen.
    ///
    /// The alternative -- carrying on against the wrong library -- is the
    /// failure this whole change exists to prevent, so there is deliberately
    /// no "continue anyway" button here.
    /// Stop, with the reason on screen -- ALL of it.
    ///
    /// The label is a one-line NSTextField, so a refusal showed its first line
    /// -- "Port 4737 is already serving a different SnipAi library." -- and
    /// dropped the two library roots and the pid, which are the only part that
    /// tells a person WHICH server to go and quit. They were in the log, and a
    /// GUI user never sees the log.
    func showRefusal(_ why: String) {
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        statusLabel.maximumNumberOfLines = 0
        statusLabel.lineBreakMode = .byWordWrapping
        statusLabel.usesSingleLineMode = false
        statusLabel.cell?.wraps = true
        statusLabel.cell?.isScrollable = false
        // Monospaced so the two roots line up under one another, and wide
        // enough to read a path without wrapping mid-directory.
        statusLabel.font = NSFont.monospacedDigitSystemFont(ofSize: 12, weight: .regular)
        statusLabel.alignment = .left
        if let container = window.contentView {
            let inset: CGFloat = 40
            statusLabel.frame = NSRect(x: inset, y: container.bounds.height / 2 - 90,
                                       width: container.bounds.width - inset * 2, height: 180)
            statusLabel.autoresizingMask = [.width, .minYMargin, .maxYMargin]
        }
        statusLabel.stringValue = why
    }

    /// Start the Node server the bundle carries.
    ///
    /// Spawned directly rather than through a login shell: a bundled app must
    /// not depend on the user having node, npm, or a particular PATH. The four
    /// SNIPAI_ variables are the whole contract with the server -- where its
    /// tools, interpreter, ffmpeg and library are.
    func startServer() {
        guard kLayout.bundled else {
            // dev fallback: run the repo the way it has always been run.
            //
            // The token goes on the command line rather than being inherited
            // through the login shell, so that what the server reports back is
            // what we passed and not whatever a profile left lying around.
            // It is the only thing that will let quitting recognise this
            // server: there is no process handle to hold, and no bundled
            // server path to compare against.
            shell("cd \(kProjectDir) && SNIPAI_LAUNCH_TOKEN=\(kLaunchToken) " +
                  "nohup npm start >> .snipai.log 2>&1 &", wait: false)
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
        // Say which library, explicitly, instead of letting the server work
        // it out again from an inherited environment. It resolves to the same
        // answer today -- expectedDataRoot() mirrors resolveDataRoot() -- but
        // "the same answer today" is what the launcher has just refused to
        // assume about the port, and the server we start is the one case
        // where we can simply remove the guesswork. It also makes
        // /api/health's reply comparable to what we asked for by
        // construction, rather than by coincidence.
        env["SNIPAI_DATA"] = expectedDataRoot(codeRoot: kLayout.code)
        // How this server will prove it is ours if we ever lose the handle.
        env["SNIPAI_LAUNCH_TOKEN"] = kLaunchToken
        p.environment = env
        if let handle = handle {
            p.standardOutput = handle
            p.standardError = handle
        }
        NSLog("SnipAi: launching %@ %@", kLayout.node, kLayout.server)
        do {
            try p.run()
            // Hold the handle: this is what quitting stops. Without it the
            // only way back to this process was "whatever is on the port",
            // which is not the same thing and was already wrong once.
            self.serverProcess = p
            NSLog("SnipAi: server pid %d", p.processIdentifier)
        } catch {
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
