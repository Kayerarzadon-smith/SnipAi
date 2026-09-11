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
      pid: process.pid,
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

server.listen(port, "127.0.0.1", () => {
  console.log(`listening ${port}`);
});
