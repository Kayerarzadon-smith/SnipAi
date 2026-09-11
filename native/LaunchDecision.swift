import Foundation

// Who owns the server on the port -- ledger N1 and P19.
//
// Both rows are the same wrong assumption seen from opposite sides:
//
//   N1  the app ADOPTS whatever is listening on 4737, checking only that the
//       BUILD matches. Launch with SNIPAI_DATA pointed at a sandbox while a
//       server for ~/Movies/SnipAi holds the port and the app serves, and
//       edits, the real library while reporting nothing. This happened on
//       2026-09-10.
//
//   P19 the app KILLS whatever is listening on 4737 when the build does not
//       match, whoever started it. Run `npm run dev`, edit a file, open
//       SnipAi.app, and your dev server dies mid-session.
//
// They pull in opposite directions only if you keep believing the port
// identifies the server. It does not. The rule that settles both:
//
//     the app may start and stop only a server it owns, it may use a server
//     it can identify as serving the right library, and it must say out loud
//     what it found -- never act on the port alone, and never silently.
//
// This file is separate from main.swift so the decision can be exercised
// without a window: it is Foundation only, no AppKit, and decide() is a pure
// function of what was found. See tests/native/launch-decision-probe.swift.

// MARK: - What is on the port

struct ServerIdentity: Equatable {
    let dataRoot: String
    let codeRoot: String
    let pid: Int32
    /// `process.argv[1]` -- the file the server was launched from. The server
    /// has to tell us because the outside world cannot see it: see
    /// ourListeningPIDs() below.
    let serverPath: String
    /// SNIPAI_LAUNCH_TOKEN: the UUID this app minted when it spawned a server,
    /// or "" for one a person started themselves.
    let launchToken: String

    init(dataRoot: String, codeRoot: String, pid: Int32,
         serverPath: String = "", launchToken: String = "") {
        self.dataRoot = dataRoot
        self.codeRoot = codeRoot
        self.pid = pid
        self.serverPath = serverPath
        self.launchToken = launchToken
    }
}

enum PortOccupant: Equatable {
    /// Nothing is serving the app on this port.
    case free
    /// A server that answers /api/health and says which library it serves.
    case identified(ServerIdentity)
    /// Something is serving the app but will not say who it is -- a build
    /// older than /api/health, or another program entirely.
    case unidentified
}

enum LaunchAction: Equatable {
    /// Nothing in the way: spawn our own and own its lifetime.
    case startOurOwn
    /// Use what is there. Never kill it -- we did not start it.
    case adopt(String)
    /// A server we ourselves left behind, in the way. Stop it, start again.
    case restartOrphan(String)
    /// Somebody else's server, or one we cannot identify. Do not adopt it and
    /// do not kill it: stop, and say what is there.
    case refuse(String)
}

// MARK: - Path comparison

/// Do two strings name the same directory?
///
/// The two sides normalise differently and must still agree: lib/paths.ts
/// does `path.resolve(SNIPAI_DATA)`, which flattens `..` but does NOT follow
/// symlinks, while Foundation's `standardizingPath` follows them for some
/// prefixes (/var -> /private/var is the one that bites on macOS, and it is
/// exactly where a sandbox library gets created). A false "these differ"
/// would refuse to launch against the app's own library, and a safety check
/// that cries wolf is one somebody switches off. So: equal if either
/// normalisation agrees.
func samePath(_ a: String, _ b: String) -> Bool {
    if a == b { return true }
    let sa = (a as NSString).standardizingPath
    let sb = (b as NSString).standardizingPath
    if sa == sb { return true }
    return (sa as NSString).resolvingSymlinksInPath == (sb as NSString).resolvingSymlinksInPath
}

// MARK: - The decision

/// Pure: everything it needs has already been looked up.
///
/// - Parameters:
///   - occupant: what answered on the port.
///   - expectedDataRoot: the library THIS launch was asked for.
///   - buildMatches: is the running server serving the build on disk?
///   - listenerIsOurOrphan: is the listening process a bundled server this
///     app started and lost -- as opposed to a person's `npm run dev`?
func decideLaunch(occupant: PortOccupant,
                  expectedDataRoot: String,
                  buildMatches: Bool,
                  listenerIsOurOrphan: Bool,
                  port: Int) -> LaunchAction {
    switch occupant {

    case .free:
        return .startOurOwn

    // Cannot be identified. Before /api/health existed every server looked
    // like this, so our own leftovers land here too -- hence the orphan check
    // rather than a flat refusal.
    case .unidentified:
        if listenerIsOurOrphan {
            return .restartOrphan(
                "A SnipAi server from an earlier run is still on port \(port) " +
                "and is too old to identify itself. Restarting it.")
        }
        return .refuse(
            "Something is already using port \(port) and it is not a SnipAi " +
            "server this app can identify. SnipAi has not started a server " +
            "and has not stopped that one. Quit whatever is on port \(port) " +
            "and open SnipAi again.")

    case .identified(let id):
        // THE check the old code never made. The build is not the dangerous
        // difference; the library is.
        if !samePath(id.dataRoot, expectedDataRoot) {
            if listenerIsOurOrphan {
                return .restartOrphan(
                    "A SnipAi server from an earlier run is on port \(port) " +
                    "serving \(id.dataRoot), but this launch was asked for " +
                    "\(expectedDataRoot). Restarting it against the right library.")
            }
            return .refuse(
                "Port \(port) is already serving a different SnipAi library.\n" +
                "  on the port: \(id.dataRoot)  (pid \(id.pid))\n" +
                "  asked for:   \(expectedDataRoot)\n" +
                "SnipAi has not started a server and has not stopped that one. " +
                "Using it would edit the wrong footage.")
        }

        if buildMatches {
            return .adopt(
                "Using the SnipAi server already running on port \(port) " +
                "(pid \(id.pid), library \(id.dataRoot)).")
        }

        // Right library, older build. Worth restarting -- "the changes did
        // not apply" is what this check was built for -- but only if the
        // server is ours. Somebody else's dev server serving the same library
        // is theirs to restart, so we say so and use it rather than pull it
        // out from under them. This is P19: the old code killed it.
        if listenerIsOurOrphan {
            return .restartOrphan(
                "A SnipAi server from an earlier run is on port \(port) " +
                "serving an older build. Restarting it.")
        }
        return .adopt(
            "Using the server already on port \(port) (pid \(id.pid)). It is " +
            "serving an older build than the one on disk, and SnipAi did not " +
            "start it, so it has been left alone -- restart it yourself if " +
            "the app looks out of date.")
    }
}

// MARK: - Looking those things up

/// Ask the server on the port who it is.
///
/// nil means "did not answer /api/health" -- which is not the same as "no
/// server": an older build serves the app perfectly well and has no such
/// route. The caller distinguishes those two with portIsOccupied().
///
/// The timeout is EIGHT seconds, and that number is the fix for ledger N6.
/// Next 14 compiles a route the first time it is requested, so a legitimately
/// running `next dev` can take several seconds to answer this the first time
/// anyone asks -- the two-second budget this used to have turned a cold dev
/// server into "did not answer", which is the same wrong answer as "nobody is
/// there". Nobody pays the eight seconds on an ordinary launch: an unoccupied
/// port refuses the connection immediately, so this returns nil in
/// milliseconds. It is paid only by a port that is genuinely held by
/// something that will not say who it is -- and being slow to refuse in that
/// case is exactly the right trade, because the alternative is being fast and
/// wrong about somebody's library.
func fetchServerIdentity(port: Int, timeout: TimeInterval = 8.0) -> ServerIdentity? {
    guard let url = URL(string: "http://127.0.0.1:\(port)/api/health") else { return nil }
    var request = URLRequest(url: url)
    request.timeoutInterval = timeout
    request.cachePolicy = .reloadIgnoringLocalCacheData

    var identity: ServerIdentity?
    let sem = DispatchSemaphore(value: 0)
    let task = URLSession.shared.dataTask(with: request) { data, response, _ in
        defer { sem.signal() }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let data = data,
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let dataRoot = obj["dataRoot"] as? String, !dataRoot.isEmpty
        else { return }
        let codeRoot = obj["codeRoot"] as? String ?? ""
        let pid = (obj["pid"] as? NSNumber)?.int32Value ?? -1
        // Absent on a server built before these existed, and "" is the right
        // answer there: it means "cannot prove this is ours", which is what a
        // build that cannot answer the question should say.
        let serverPath = obj["serverPath"] as? String ?? ""
        let launchToken = obj["launchToken"] as? String ?? ""
        identity = ServerIdentity(dataRoot: dataRoot, codeRoot: codeRoot, pid: pid,
                                  serverPath: serverPath, launchToken: launchToken)
    }
    task.resume()
    _ = sem.wait(timeout: .now() + timeout + 0.5)
    return identity
}

/// Is the port taken -- by anyone, answering or not?
///
/// This asks the kernel the same question our own server is about to ask it:
/// can this address be bound? Nothing else is a reliable answer. The launcher
/// used to decide the port was FREE when `GET /api/projects` failed to answer
/// inside 1.5s, which is not the same question at all -- a `next dev` that is
/// still compiling that route, or any program that holds the port without
/// speaking HTTP, reads as "nobody is there". It then started a server that
/// died on `EADDRINUSE` while the log said it had started one (ledger N5).
///
/// SO_REUSEADDR is set, and that is not a detail. libuv sets it on every TCP
/// bind, so it is what our own server asks with -- and this check is only
/// worth anything if it asks the identical question. Without it, a port whose
/// last server was stopped GRACEFULLY reads as occupied for up to thirty
/// seconds afterwards, because the connections it had accepted sit in
/// TIME_WAIT on this port while no process is listening at all. That is not a
/// corner: it is quit-the-app-and-reopen-it, and it cost this check a live
/// reproduction where the app refused to start, naming nobody, on a port that
/// `lsof` correctly reported as empty.
///
/// The socket is closed immediately, so this leaves nothing behind and the
/// port is still free for the server we start a moment later.
///
/// lsof is the second half, not a fallback. A bind to 127.0.0.1 succeeds while
/// something holds `::1` on the same port -- and the web view loads
/// `localhost`, which can resolve to either. lsof sees both families, so a
/// stranger we could technically bind alongside still counts as occupying the
/// port, and we refuse instead of racing it for the name.
func portIsOccupied(_ port: Int) -> Bool {
    let fd = socket(AF_INET, SOCK_STREAM, 0)
    if fd < 0 { return !listeningPIDs(port: port).isEmpty }
    defer { _ = Darwin.close(fd) }

    var on: Int32 = 1
    _ = setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, socklen_t(MemoryLayout<Int32>.size))

    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = UInt16(truncatingIfNeeded: port).bigEndian
    addr.sin_addr.s_addr = inet_addr("127.0.0.1")

    let rc = withUnsafePointer(to: &addr) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            Darwin.bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    // Any refusal counts, not just EADDRINUSE: whatever stops us binding here
    // would stop the server we were about to start, so it is in the way.
    if rc != 0 { return true }
    return !listeningPIDs(port: port).isEmpty
}

/// What is on the port -- identity FIRST, liveness second.
///
/// The order is the whole point (ledger N5, N6). Identification used to be
/// gated behind a liveness probe: ask `/api/projects` with a 1.5s budget, and
/// only if that answered, ask `/api/health` who it is. So a server that was
/// slow to answer one route was never asked the question that protects the
/// library, and the launch proceeded as though the port were empty. Asking
/// who is there first cannot have that failure: a silent port answers nothing
/// in milliseconds, and a slow one gets the time it needs to identify itself.
///
/// The closures are injected so the probe can exercise every combination
/// without a server, a port, or a wait.
func lookUpOccupant(port: Int,
                    identify: (Int) -> ServerIdentity? = { fetchServerIdentity(port: $0) },
                    occupied: (Int) -> Bool = { portIsOccupied($0) }) -> PortOccupant {
    if let identity = identify(port) { return .identified(identity) }
    return occupied(port) ? .unidentified : .free
}

/// Run a command and hand back its stdout. Foundation's Process directly --
/// no login shell, because nothing here needs the user's PATH and a shell
/// would only add a way for this to do more than it says.
private func capture(_ launchPath: String, _ args: [String]) -> String {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: launchPath)
    p.arguments = args
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return "" }
    let out = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    return String(data: out, encoding: .utf8) ?? ""
}

/// The pids actually LISTENING on the port -- never a client that merely has
/// a connection to it.
///
/// Deduplicated: `lsof -t` prints a pid once per matching socket, so one
/// server listening on both IPv4 and IPv6 comes back twice. The ownership
/// check below compares counts ("is EVERY listener ours?"), and a doubled pid
/// made that comparison fail against a server we had just proved was ours --
/// which fails safe, but by miscounting rather than by deciding.
func listeningPIDs(port: Int) -> [Int32] {
    let pids = capture("/usr/sbin/lsof", ["-ti:\(port)", "-sTCP:LISTEN"])
        .split(whereSeparator: { $0 == "\n" || $0 == " " })
        .compactMap { Int32($0) }
    return Array(Set(pids)).sorted()
}

/// The full command line of a pid, for deciding whether it is ours.
func commandLine(ofPID pid: Int32) -> String {
    return capture("/bin/ps", ["-o", "command=", "-p", "\(pid)"])
        .trimmingCharacters(in: .whitespacesAndNewlines)
}

// MARK: - What "we own it" means

/// The listening pids this app is entitled to stop. Nothing else may ever be
/// signalled, anywhere in the app.
///
/// **This definition changed on 2026-09-11, and the reason is worth keeping.**
/// It used to be: our own bundled server's path appears in the listener's
/// command line, via `ps -o command=`. That test can never be true in the
/// packaged app. The bundled server re-titles its own process, so
/// `ps -ww -o command= -p <pid>` returns exactly `next-server (v14.2.35)` with
/// no trace of `.../Resources/server/server.js` -- verified live against the
/// shipped bundle. `next dev` re-titles to the same string, so from the
/// outside the two are not merely hard to tell apart, they are identical.
///
/// So the old test matched nothing, ever: restartOrphan was unreachable in the
/// bundle, a force-quit that orphaned a bundled server was never cleaned up,
/// and the quit handler's bundled branch was dead code. It passed every safety
/// check we had, because "never claims ownership" is indistinguishable from
/// "claims ownership correctly" as long as you only test that strangers
/// survive. It was right by accident, and a thing that is right by accident is
/// one edit away from being wrong by accident.
///
/// Ownership now rests on what the SERVER says about itself, because that is
/// the only place the evidence still exists:
///
///   1. It must have identified itself at all. Silence is not ownership --
///      a server that will not answer /api/health cannot be proved ours, and
///      we leave it alone and say so. (This is the one capability lost: an
///      orphan from a build older than /api/health is now refused rather than
///      restarted. It was never restarted in practice anyway, for the reason
///      above, so nothing that used to work stops working.)
///   2. The pid it names must be one of the pids actually holding the port.
///      We signal that pid and no other -- never "whatever is on the port".
///   3. Then either:
///      - it carries THIS run's launch token, which only a server we spawned
///        a moment ago can have, or
///      - it was launched from the very file this bundle would launch
///        (`process.argv[1]` == our server path), which is an orphan from an
///        earlier run of this same app. A dev checkout has no bundled server
///        path, so it can never match this way, and `npm run dev` in the same
///        checkout is therefore never ours -- which is ledger P19 and must
///        stay true.
///   4. And the pid it names must be the ONLY thing listening on the port.
///
/// **Rule 4 was added on 2026-09-11 and it is ledger N12.** Without it, the
/// answer to "who may we signal" was not the same at all three call sites: the
/// count comparison lived in listenerIsOurOrphan() below, so the LAUNCH path
/// had it while the quit path (main.swift:275) and the restartOrphan path
/// (main.swift:526) called this function directly and skipped it. Reproduced
/// 2026-09-11, and no token was needed to do it, because `serverPath` is not a
/// secret -- it is just where the app is installed:
///
///   - a bystander holding `[::1]:4737`, which claimed nothing and was not
///     SnipAi at all;
///   - an impostor holding `127.0.0.1:4737` -- the address we probe -- which
///     answered /api/health with an empty token, the bundle's real serverPath,
///     and **the bystander's pid**.
///
/// Two processes CAN hold one port at once, one per address family; lsof
/// reports both and our probe reaches only the IPv4 one. Rule 2 was satisfied
/// (the named pid really was holding the port -- just not the half we were
/// talking to), so on quit the app logged "Stopping our own server" and
/// SIGTERMed the bystander. The process that lied survived; the one that never
/// spoke was signalled.
///
/// Rule 4 is the whole fix, and it is worth seeing why nothing more is needed.
/// This function returns at most ONE pid, so requiring `ours.count ==
/// holders.count` forces `holders.count == 1`. One listener, and it is the pid
/// that answered our probe -- because whatever answered a connection to this
/// port was, by construction, listening on it. So "the process that answered is
/// the process it named" follows from counting rather than from any new
/// machinery to check it. The honest statement turned out to be smaller than
/// the claim it replaces, which is why this row cost four lines.
///
/// What rule 4 gives up, stated plainly: if our own server is on the port and a
/// stranger is alongside it on the other address family, we now decline to stop
/// our own server. That leaks a server; the alternative leaks a SIGTERM into
/// somebody else's process. Failing towards the leak is the right way round.
func ourListeningPIDs(port: Int,
                      identity: ServerIdentity?,
                      ourServerPath: String,
                      ourLaunchToken: String,
                      listening: [Int32]? = nil) -> [Int32] {
    guard let identity = identity else { return [] }
    let holders = listening ?? listeningPIDs(port: port)
    guard holders.contains(identity.pid) else { return [] }
    // Rule 4. Anything else on this port means the thing that answered us is
    // not provably the thing we would be signalling. N12.
    guard holders.count == 1 else { return [] }

    if !ourLaunchToken.isEmpty && identity.launchToken == ourLaunchToken {
        return [identity.pid]
    }
    if !ourServerPath.isEmpty && !identity.serverPath.isEmpty
        && samePath(identity.serverPath, ourServerPath) {
        return [identity.pid]
    }
    return []
}

/// Is everything holding the port a server this app started?
///
/// Now exactly "is there anything we may signal", because ourListeningPIDs()
/// carries the count check itself (N12). It is kept as a named function because
/// decideLaunch() reads better with it, and deleting it would leave the launch
/// path phrasing the same question differently from the other two.
func listenerIsOurOrphan(port: Int,
                         identity: ServerIdentity?,
                         ourServerPath: String,
                         ourLaunchToken: String) -> Bool {
    return !ourListeningPIDs(port: port, identity: identity,
                             ourServerPath: ourServerPath,
                             ourLaunchToken: ourLaunchToken).isEmpty
}

// MARK: - Which library this launch was asked for

/// The data root the SERVER would resolve, computed the same way it does.
///
/// This mirrors `resolveDataRoot()` in lib/paths.ts exactly, and the two must
/// not drift: SNIPAI_DATA wins; otherwise the standard library location if
/// the migration has run; otherwise the old in-repo layout. If this function
/// and that one ever disagree, the app refuses to launch against its own
/// library, so the ordering of these three branches is load-bearing.
func expectedDataRoot(codeRoot: String,
                      environment: [String: String] = ProcessInfo.processInfo.environment,
                      fileExists: (String) -> Bool = { FileManager.default.fileExists(atPath: $0) }
) -> String {
    if let env = environment["SNIPAI_DATA"]?.trimmingCharacters(in: .whitespaces), !env.isEmpty {
        // path.resolve() on the other side: absolute, `..` flattened.
        return (((env as NSString).expandingTildeInPath) as NSString).standardizingPath
    }
    let standard = (("~/Movies/SnipAi") as NSString).expandingTildeInPath
    if fileExists(standard + "/projects") { return standard }
    return codeRoot
}
