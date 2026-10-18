// Drill Room: a local judge for a pack of coding drills.
//
//   node room/server.mjs [--pack <dir>]      (default: examples/starter-pack)
//   open http://localhost:4321
//
// Serves the practice page and judges submissions in TypeScript, Python or Ruby
// by running them in a subprocess with a time limit. Binds to 127.0.0.1 only:
// it runs whatever code you paste, so it is not meant to be exposed.
//
// Env overrides: PORT (default 4321), DRILLROOM_PACK, PYTHON (python3), RUBY (ruby).
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ROOT, judge, same, createStore } from "./lib.mjs";
import { loadPack, publicView, notesHtml } from "./pack.mjs";

export const DEFAULT_PACK = join(ROOT, "..", "examples", "starter-pack");

export function createApp({ packDir = DEFAULT_PACK, solutionsDir, timeLimitMs = 5000, now } = {}) {
  const pack = loadPack(packDir);
  const store = createStore(solutionsDir || join(pack.dir, "solutions"), { drills: pack.drills, ...(now ? { now } : {}) });
  const view = JSON.stringify(publicView(pack));
  const known = (lang, id) => Object.hasOwn(pack.byId, String(id)) && pack.byId[id].languages.includes(lang);
  const checkers = new Map();

  async function checkerFor(part) {
    if (!part.checker) return null;
    if (!checkers.has(part.checker)) checkers.set(part.checker, (await import(pathToFileURL(part.checker).href)).default);
    return checkers.get(part.checker);
  }

  // Judge one part's cases: [{ r, c, pass }] or { fatal }.
  async function judgePart(lang, part, code, cases) {
    if (!cases.length) return { results: [] };
    const res = await judge(lang, part, code, cases, { timeLimitMs });
    if (res.fatal) return res;
    const check = await checkerFor(part);
    return {
      results: res.results.map((r, i) => {
        let pass = false;
        if (r.ok) {
          try { pass = check ? Boolean(check(JSON.parse(JSON.stringify(cases[i].args)), r.got)) : same(r.got, cases[i].expected); }
          catch { pass = false; }
        }
        return { r, c: cases[i], pass };
      }),
    };
  }

  function state(drill) {
    const unlocked = store.unlocked(drill.id);
    return {
      unlocked,
      parts: drill.parts.map((p) => ({ number: p.number, title: p.title, html: p.number <= unlocked ? p.html : null })),
      notesHtml: notesHtml(drill, unlocked),
    };
  }

  async function handleJudge(body) {
    const { lang, drill: id, code, mode } = body;
    if (!pack.languages.includes(lang)) return { status: 400, json: { error: `Unknown language ${lang}` } };
    if (!Object.hasOwn(pack.byId, String(id))) return { status: 400, json: { error: `Unknown drill ${id}` } };
    const drill = pack.byId[id];
    if (!drill.languages.includes(lang)) return { status: 400, json: { error: `${drill.title} isn't available in ${lang}` } };
    if (typeof code !== "string" || code.length > 100_000) return { status: 400, json: { error: "Missing or oversized code" } };
    const n = drill.parts.length;
    const k = body.part === undefined ? 1 : Number(body.part);
    if (!Number.isInteger(k) || k < 1 || k > n) return { status: 400, json: { error: `Unknown part ${body.part}` } };
    if (k > store.unlocked(id)) return { status: 400, json: { error: `Part ${k} is locked: pass part ${k - 1}'s hidden tests first.` } };
    const multi = n > 1;

    if (mode === "run") {
      const part = drill.parts[k - 1];
      const res = await judgePart(lang, part, code, part.visible);
      if (res.fatal) {
        const saved = store.save(lang, id, code, { type: "run", pass: false, part: k });
        return { json: { fatal: res.fatal, saved } };
      }
      const cases = res.results.map(({ r, c, pass }) => ({ pass, args: c.args, expected: c.expected, ok: r.ok, got: r.got, error: r.error, logs: r.logs }));
      const saved = store.save(lang, id, code, { type: "run", pass: cases.length > 0 && cases.every((c) => c.pass), part: k });
      return { json: { mode, part: k, saved, cases } };
    }
    if (mode === "submit") {
      // Every part up to this one, so a change that breaks an earlier part shows up.
      const parts = [];
      for (let p = multi ? 1 : k; p <= k; p++) {
        const part = drill.parts[p - 1];
        const res = await judgePart(lang, part, code, part.hidden);
        // Hidden cases never leave the server: only pass/fail and the error type.
        const cases = res.fatal
          ? part.hidden.map(() => ({ pass: false, error: "Error" }))
          : res.results.map(({ r, pass }) => ({ pass, error: r.ok ? undefined : String(r.error || "").split(":")[0] }));
        parts.push({ part: p, fatal: res.fatal, cases });
        if (res.fatal) break;
      }
      const perPart = Object.fromEntries(parts.map((x) => [x.part, { passed: x.cases.filter((c) => c.pass).length, total: x.cases.length }]));
      const last = parts[parts.length - 1];
      const event = multi
        ? { type: "submit", part: k, perPart }
        : { type: "submit", passed: perPart[k].passed, total: perPart[k].total };
      const saved = store.save(lang, id, code, event);
      if (last.fatal) return { json: { fatal: last.fatal, saved, ...(multi ? { part: last.part } : {}) } };
      const out = { mode, saved, cases: last.cases };
      if (multi) Object.assign(out, { part: k, parts: parts.map(({ part, cases }) => ({ part, cases })), unlocked: store.unlocked(id) });
      return { json: out };
    }
    return { status: 400, json: { error: `Unknown mode ${mode}` } };
  }

  async function readBody(req, limit) {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > limit) return null;
    }
    return raw;
  }

  const server = createServer(async (req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(body);
    };
    const json = (status, obj) => send(status, "application/json", typeof obj === "string" ? obj : JSON.stringify(obj));
    try {
      if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
        return send(200, "text/html; charset=utf-8", readFileSync(join(ROOT, "index.html")));
      }
      if (req.method === "GET" && req.url === "/editor.js") {
        return send(200, "text/javascript; charset=utf-8", readFileSync(join(ROOT, "editor.js")));
      }
      if (req.method === "GET" && req.url === "/api/pack") {
        return json(200, view);
      }
      if (req.method === "GET" && req.url.startsWith("/api/state?")) {
        const id = new URL(req.url, "http://x").searchParams.get("drill");
        if (!Object.hasOwn(pack.byId, String(id))) return json(400, { error: "Bad request" });
        return json(200, state(pack.byId[id]));
      }
      if (req.method === "GET" && req.url.startsWith("/api/solution?")) {
        const q = new URL(req.url, "http://x").searchParams;
        const lang = q.get("lang"), id = q.get("drill");
        if (!known(lang, id)) return json(400, { error: "Bad request" });
        return json(200, { code: store.read(lang, id) });
      }
      if (req.method === "POST" && req.url === "/api/save") {
        const raw = await readBody(req, 200_000);
        if (raw === null) return json(413, { error: "Too large" });
        const { lang, drill: id, code } = JSON.parse(raw);
        if (!known(lang, id) || typeof code !== "string" || code.length > 100_000) {
          return json(400, { error: "Bad request" });
        }
        return json(200, { saved: store.save(lang, String(id), code, { type: "save" }) });
      }
      if (req.method === "POST" && req.url === "/api/judge") {
        const raw = await readBody(req, 200_000);
        if (raw === null) return json(413, { error: "Too large" });
        const out = await handleJudge(JSON.parse(raw));
        return json(out.status || 200, out.json);
      }
      send(404, "text/plain", "Not found");
    } catch (e) {
      json(e instanceof SyntaxError ? 400 : 500, { error: e.message });
    }
  });
  server.pack = pack;
  return server;
}

function packFromArgs(argv) {
  const i = argv.indexOf("--pack");
  if (i !== -1 && argv[i + 1]) return resolve(argv[i + 1]);
  if (process.env.DRILLROOM_PACK) return resolve(process.env.DRILLROOM_PACK);
  return DEFAULT_PACK;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 4321);
  let app;
  try {
    app = createApp({ packDir: packFromArgs(process.argv.slice(2)) });
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  app.listen(port, "127.0.0.1", () => {
    console.log(`Drill Room: ${app.pack.title} (${app.pack.drills.length} drills from ${app.pack.dir})`);
    console.log(`Open http://localhost:${port}  (Ctrl+C to stop)`);
  });
}
