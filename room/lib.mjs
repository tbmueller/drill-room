// Drill Room internals: judging code in a subprocess, comparing answers, and
// keeping saved solutions on disk. server.mjs wires these to HTTP; the tests
// import them directly.
import { readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { LANG_META } from "./pack.mjs";

export { LANG_META };
export const ROOT = dirname(fileURLToPath(import.meta.url));
export const MARKER = "@@DRILLROOM_RESULTS@@";
export const HEADER_END = "---- end drill room header ----";

const LANGS = {
  typescript: { file: "solution.ts", cmd: () => [process.execPath, "--no-warnings", join(ROOT, "runners", "runner-ts.mjs")] },
  python: { file: "solution.py", cmd: () => [process.env.PYTHON || "python3", join(ROOT, "runners", "runner.py")] },
  ruby: { file: "solution.rb", cmd: () => [process.env.RUBY || "ruby", join(ROOT, "runners", "runner.rb")] },
};

// ---------------------------------------------------------------------------
// Comparing answers: key order never matters, everything else does.
// ---------------------------------------------------------------------------
export function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = canon(v[k]);
    return out;
  }
  return v;
}

export const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

// ---------------------------------------------------------------------------
// Judging: run the code against cases in a subprocess with a time limit.
// `drill` is a drill from loadPack(). Resolves to
// { results: [{ok, got | error, logs}] } or { fatal: message }.
// ---------------------------------------------------------------------------
export function judge(lang, drill, code, cases, { timeLimitMs = 5000 } = {}) {
  return new Promise((resolve) => {
    const spec = LANGS[lang];
    if (!spec || !drill.call[lang]) {
      resolve({ fatal: `Unknown language ${lang}` });
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "drillroom-"));
    const solution = join(dir, spec.file);
    const casesPath = join(dir, "cases.json");
    const specPath = join(dir, "spec.json");
    writeFileSync(solution, code);
    writeFileSync(casesPath, JSON.stringify(cases));
    writeFileSync(specPath, JSON.stringify({ name: drill.call[lang], args: drill.args, adapter: drill.adapters[lang] || null }));
    const [bin, ...args] = spec.cmd();
    let stdout = "", stderr = "", finished = false, timer = null, child;
    const finish = (payload) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve(payload);
    };
    try {
      child = spawn(bin, [...args, solution, specPath, casesPath], { cwd: dir, env: process.env });
    } catch (e) {
      finish({ fatal: `Couldn't start ${bin}: ${e.message}` });
      return;
    }
    timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ fatal: `Time limit exceeded (${timeLimitMs / 1000} s). Look for an infinite loop.` });
    }, timeLimitMs);
    child.stdout.on("data", (d) => { stdout += d; if (stdout.length > 2e6) child.kill("SIGKILL"); });
    child.stderr.on("data", (d) => { stderr += d; });
    child.on("error", (e) => {
      const hint = e.code === "ENOENT" ? ` Is ${bin} installed and on your PATH?` : "";
      finish({ fatal: `Couldn't run ${bin}: ${e.message}.${hint}` });
    });
    child.on("close", () => {
      const line = stdout.split("\n").find((l) => l.startsWith(MARKER));
      if (!line) {
        finish({ fatal: (stderr || stdout || "The runner exited without results.").trim().split("\n").slice(-12).join("\n") });
        return;
      }
      try {
        finish({ results: JSON.parse(line.slice(MARKER.length)) });
      } catch (e) {
        finish({ fatal: `Couldn't read the runner's results: ${e.message}` });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Saved solutions: <dir>/<lang>/<drill-id>.<ext> with a status header,
// <dir>/progress.json (history) and <dir>/README.md (summary table).
// `drills` is the pack's drill list ({ id, number, title }).
// ---------------------------------------------------------------------------
export function stamp(d = new Date()) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// `nParts` > 1 for a multi-part drill; its submits record every part judged.
export function statusLine(e, nParts = 1) {
  if (nParts > 1) return partsStatus(e, nParts);
  if (e.lastEvent === "submit") {
    return e.lastSubmit.passed === e.lastSubmit.total
      ? `PASSED: ${e.lastSubmit.passed}/${e.lastSubmit.total} hidden tests`
      : `IN PROGRESS: ${e.lastSubmit.passed}/${e.lastSubmit.total} hidden tests passing`;
  }
  if (e.lastEvent === "run") return e.lastRun.pass ? "IN PROGRESS: sample passes, not submitted yet" : "IN PROGRESS: sample failing";
  if (e.firstPassed) return `IN PROGRESS: edited since it passed (${e.firstPassed}); not re-submitted`;
  return "IN PROGRESS: saved, not run yet";
}

function partsStatus(e, nParts) {
  if (e.lastEvent === "submit") {
    const { part, perPart } = e.lastSubmit;
    for (let p = 1; p <= part; p++) {
      const r = perPart[p];
      if (r && r.passed !== r.total) return `IN PROGRESS: part ${p} at ${r.passed}/${r.total} hidden tests`;
    }
    if (part >= nParts) return `PASSED: all ${nParts} parts`;
    return part === 1 ? `IN PROGRESS: part 1 of ${nParts} passes` : `IN PROGRESS: parts 1–${part} of ${nParts} pass`;
  }
  if (e.lastEvent === "run") return `IN PROGRESS: part ${e.lastRun.part} sample ${e.lastRun.pass ? "passes" : "failing"}`;
  if (e.firstPassed) return `IN PROGRESS: edited since it passed (${e.firstPassed}); not re-submitted`;
  return "IN PROGRESS: saved, not run yet";
}

const partsPassed = (e) => Object.values(e.parts || {}).filter((p) => p.firstPassed).length;

export function stripHeader(code) {
  const i = code.indexOf(HEADER_END);
  if (i === -1) return code;
  const nl = code.indexOf("\n", i);
  return nl === -1 ? "" : code.slice(nl + 1).replace(/^\n/, "");
}

export function createStore(dir, { drills, now = () => new Date() }) {
  const progressFile = join(dir, "progress.json");
  const byId = Object.fromEntries(drills.map((d) => [d.id, d]));
  const fileOf = (lang, id) => join(dir, lang, `${id}.${LANG_META[lang].ext}`);
  const nParts = (id) => (byId[id].parts ? byId[id].parts.length : 1);

  function loadProgress() {
    try { return JSON.parse(readFileSync(progressFile, "utf8")); } catch { return {}; }
  }

  function bestText(e, n) {
    if (n > 1) return `${partsPassed(e)}/${n} parts`;
    return e.bestSubmit ? `${e.bestSubmit.passed}/${e.bestSubmit.total}` : "–";
  }

  function writeSummary(progress) {
    const rows = [];
    for (const lang of Object.keys(LANG_META)) {
      for (const d of drills) {
        const e = progress[lang] && progress[lang][d.id];
        if (!e) continue;
        const n = nParts(d.id);
        rows.push(`| ${d.number}. ${d.title} | ${LANG_META[lang].label} | ${statusLine(e, n)} | ${bestText(e, n)} | ${e.firstPassed || "–"} | ${e.lastSaved} | ${e.submits} | [code](${lang}/${d.id}.${LANG_META[lang].ext}) |`);
      }
    }
    const md = [
      "# My drill solutions",
      "",
      "Written by the Drill Room every time you Save (Ctrl/Cmd+S), Run, or Submit. Times are local.",
      "",
      "| Drill | Language | Status | Best submit | First passed | Last saved | Submits | |",
      "|---|---|---|---|---|---|---|---|",
      ...rows,
      "",
    ].join("\n");
    writeFileSync(join(dir, "README.md"), md);
  }

  // event: { type: "save" }, { type: "run", pass, part? },
  // or { type: "submit", passed, total } / { type: "submit", part, perPart: { [p]: { passed, total } } }.
  function save(lang, id, code, event) {
    const meta = LANG_META[lang];
    const d = byId[id];
    const n = nParts(id);
    const at = stamp(now());
    const progress = loadProgress();
    progress[lang] = progress[lang] || {};
    const e = progress[lang][id] || { firstSaved: at, runs: 0, submits: 0, history: [] };
    e.lastSaved = at;
    const hash = createHash("sha1").update(stripHeader(code).trim()).digest("hex");
    if (event.type === "run") {
      e.runs++;
      e.lastEvent = "run";
      e.lastRun = { pass: event.pass, at, ...(n > 1 ? { part: event.part } : {}) };
      e.history.push({ at, event: "run", ...(n > 1 ? { part: event.part } : {}), result: event.pass ? "sample passed" : "sample failed" });
      e.lastCodeHash = hash;
    } else if (event.type === "submit" && n > 1) {
      e.submits++;
      e.lastEvent = "submit";
      e.lastSubmit = { part: event.part, perPart: event.perPart, at };
      e.parts = e.parts || {};
      for (const [p, r] of Object.entries(event.perPart)) {
        const ep = e.parts[p] || {};
        if (!ep.best || r.passed > ep.best.passed) ep.best = { passed: r.passed, total: r.total, at };
        if (r.passed === r.total && !ep.firstPassed) ep.firstPassed = at;
        e.parts[p] = ep;
      }
      if (partsPassed(e) === n && !e.firstPassed) e.firstPassed = at;
      const summary = Object.entries(event.perPart).map(([p, r]) => `part ${p} ${r.passed}/${r.total}`).join(", ");
      e.history.push({ at, event: "submit", part: event.part, result: summary });
      e.lastCodeHash = hash;
    } else if (event.type === "submit") {
      e.submits++;
      e.lastEvent = "submit";
      e.lastSubmit = { passed: event.passed, total: event.total, at };
      if (!e.bestSubmit || event.passed > e.bestSubmit.passed) e.bestSubmit = { passed: event.passed, total: event.total, at };
      if (event.passed === event.total && !e.firstPassed) e.firstPassed = at;
      e.history.push({ at, event: "submit", result: `${event.passed}/${event.total}` });
      e.lastCodeHash = hash;
    } else if (hash !== e.lastCodeHash) {
      // A plain save only changes the status when the code differs from what was last tested.
      e.lastEvent = "save";
      e.lastCodeHash = hash;
      e.history.push({ at, event: "save" });
    }
    e.history = e.history.slice(-50);
    progress[lang][id] = e;

    const c = meta.comment;
    const best = n > 1
      ? `${partsPassed(e)} of ${n} parts passed`
      : e.bestSubmit ? `${e.bestSubmit.passed}/${e.bestSubmit.total} (${e.bestSubmit.at})` : "not submitted yet";
    const header = [
      `${c} Drill ${d.number}: ${d.title} (${meta.label})`,
      `${c} Status:       ${statusLine(e, n)}`,
      `${c} Best submit:  ${best}`,
      `${c} First passed: ${e.firstPassed || "not yet"}`,
      `${c} Started:      ${e.firstSaved}`,
      `${c} Last saved:   ${e.lastSaved}   (runs: ${e.runs}, submits: ${e.submits})`,
      `${c} ${HEADER_END}`,
      "",
    ].join("\n");
    mkdirSync(join(dir, lang), { recursive: true });
    writeFileSync(fileOf(lang, id), header + stripHeader(code).replace(/\s*$/, "\n"));
    writeFileSync(progressFile, JSON.stringify(progress, null, 2) + "\n");
    writeSummary(progress);
    return { status: statusLine(e, n), lastSaved: at };
  }

  function read(lang, id) {
    const f = fileOf(lang, id);
    if (!existsSync(f)) return null;
    return stripHeader(readFileSync(f, "utf8"));
  }

  // How many parts of a multi-part drill are open: part 1, plus each part after
  // one whose hidden tests have all passed (in any language).
  function unlocked(id) {
    const n = nParts(id);
    if (n === 1) return 1;
    const progress = loadProgress();
    const passed = (p) => Object.values(progress).some((byDrill) => byDrill[id] && byDrill[id].parts && byDrill[id].parts[p] && byDrill[id].parts[p].firstPassed);
    let open = 1;
    while (open < n && passed(open)) open++;
    return open;
  }

  return { save, read, loadProgress, unlocked };
}
