// A stand-in for whatever is already on the port, for the launch probe.
//
// It exists to model one specific and entirely realistic server: one that
// knows who it is instantly and is SLOW to serve a page. That is a cold
// `next dev` -- Next 14 compiles a route the first time it is asked for, so
// /api/projects can take seconds while a route already in memory answers at
// once. The launcher used to gate identification behind /api/projects with a
// 1.5s budget, so this server read as "nobody is there" (ledger N5).
//
//   node tests/native/fake-occupant.mjs --port 4901 --data-root /tmp/other \
//        --projects-delay 4000
//
//   --projects-delay MS   how long GET /api/projects takes to answer
//   --no-health           404 /api/health, like a build older than that route
//
// It can also model a server that LIES about itself, which is ledger N12:
//
//   --claim-pid N         report pid N instead of its own -- a server naming
//                         somebody else's process as the one to signal
//   --server-path P       report P as process.argv[1]. Not a secret: it is
//                         just where the app is installed, so any local
//                         process can state the bundle's real one
//   --launch-token T      report T as SNIPAI_LAUNCH_TOKEN
//   --host H              bind H rather than 127.0.0.1, so two of these can
//                         hold one port at once (127.0.0.1 and ::1)
//
// Prints "listening <port>" on stdout once it is actually bound, so the
// caller never has to sleep and guess.

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const flag = (name) => args.includes(name);

const port = Number(arg("--port", "4901"));
const dataRoot = arg("--data-root", "/tmp/fake-occupant-library");
const codeRoot = arg("--code-root", "/tmp/fake-occupant-code");
const projectsDelay = Number(arg("--projects-delay", "0"));
const withHealth = !flag("--no-health");
const claimedPid = Number(arg("--claim-pid", String(process.pid)));
const serverPath = arg("--server-path", "");
const launchToken = arg("--launch-token", "");
const host = arg("--host", "127.0.0.1");

const { createServer } = await import("node:http");

const server = createServer((req, res) => {
  const url = (req.url || "").split("?")[0];

  if (url === "/api/health") {
    if (!withHealth) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      dataRoot,
      codeRoot,
      pid: claimedPid,
      serverPath,
      launchToken,
      pipeline: { version: 3, known: true },
    }));
    return;
  }

  if (url === "/api/projects") {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ projects: [] }));
    }, projectsDelay);
    return;
  }

  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

// --port 0 lets the kernel choose, and the real port comes back on stdout --
// which is how a caller gets a port nobody else can be holding.
// ipv6Only matters: without it a bind to :: would take BOTH families on some
// systems, and the N12 case needs one process per family on one port.
server.listen({ port, host, ipv6Only: host === "::1" || host === "::" }, () => {
  console.log(`listening ${server.address().port} pid ${process.pid}`);
});
