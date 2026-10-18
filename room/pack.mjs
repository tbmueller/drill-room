// Problem packs: a folder of drills the room loads at startup.
//
//   my-pack/
//     pack.json                      { "title", "languages", "notes", "folders", "groups" | "drills" } (all optional)
//     drills/<drill-id>/
//       drill.json                   { "title", "call", "args", "parts"?, ... }
//       problem.md                   the statement (Markdown)
//       starter.ts / .py / .rb       starter code, one per language
//       visible.json                 sample case(s), shown with expected vs. got
//       hidden.json or hidden.b64    hidden cases (base64 of the same JSON)
//       adapter.mjs / .py / .rb      optional: custom call logic for one language
//       checker.mjs                  optional: accepts any valid answer instead of one expected value
//     solutions/                     written by the room (your saved code)
//
// A multi-part drill lists its "parts" in drill.json; its statement has one
// "## Part N" (or "## Task N", ...) section per part, and its cases are keyed by
// part number. See README.md for the full format.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { render } from "./markdown.mjs";

export const LANG_META = {
  typescript: { label: "TypeScript", ext: "ts", adapter: "adapter.mjs", comment: "//" },
  python: { label: "Python 3", ext: "py", adapter: "adapter.py", comment: "#" },
  ruby: { label: "Ruby", ext: "rb", adapter: "adapter.rb", comment: "#" },
};

const ID = /^[A-Za-z0-9][\w.-]*$/;
const NAME = /^[A-Za-z_$][\w$]*[?!]?$/;
const FILE = /^[\w.-]+$/;

class PackError extends Error {}

function readJson(path, where) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    throw new PackError(`${where}: can't read ${basename(path)} (${e.code === "ENOENT" ? "missing" : e.message})`);
  }
}

function caseList(value, where, file, { allowEmpty }) {
  const list = Array.isArray(value) ? value : [value];
  if (!list.length && !allowEmpty) throw new PackError(`${where}: ${file} has no cases`);
  list.forEach((c, i) => {
    if (!c || typeof c !== "object" || !("args" in c) || !("expected" in c)) {
      throw new PackError(`${where}: ${file} case ${i + 1} needs "args" and "expected"`);
    }
  });
  return list;
}

// Cases for each part: a multi-part drill keys them by part number ("1", "2", ...);
// a single drill may use a plain list (or one case object), or { "1": [...] }.
function casesByPart(value, nParts, where, file, { allowEmpty }) {
  const keyed = value && typeof value === "object" && !Array.isArray(value) && !("args" in value);
  if (nParts > 1 && !keyed) throw new PackError(`${where}: ${file} must map part numbers to cases, like {"1": [...], "2": [...]}`);
  if (!keyed) return [caseList(value, where, file, { allowEmpty })];
  const out = [];
  for (let p = 1; p <= nParts; p++) {
    const list = value[String(p)];
    if (list === undefined) throw new PackError(`${where}: ${file} has no cases for part ${p}`);
    out.push(caseList(list, where, `${file} part ${p}`, { allowEmpty }));
  }
  return out;
}

function readCases(dir, where, nParts) {
  const visible = casesByPart(readJson(join(dir, "visible.json"), where), nParts, where, "visible.json", { allowEmpty: true });
  const json = join(dir, "hidden.json"), b64 = join(dir, "hidden.b64");
  let raw;
  if (existsSync(json)) raw = readJson(json, where);
  else if (existsSync(b64)) {
    try {
      raw = JSON.parse(Buffer.from(readFileSync(b64, "utf8").replace(/\s+/g, ""), "base64").toString("utf8"));
    } catch (e) {
      throw new PackError(`${where}: hidden.b64 isn't base64-encoded JSON (${e.message})`);
    }
  } else throw new PackError(`${where}: needs hidden.json or hidden.b64`);
  const hidden = casesByPart(raw, nParts, where, existsSync(json) ? "hidden.json" : "hidden.b64", { allowEmpty: false });
  return { visible, hidden };
}

// Split a multi-part statement into intro, one section per part, and notes (any
// "## " sections after the last part). Part sections start with "## <Word> <N>".
function splitStatement(md, nParts, where) {
  const lines = md.split("\n");
  const starts = [];
  lines.forEach((line, i) => {
    const m = line.match(/^##\s+\S+\s+(\d+)\b/);
    if (m && Number(m[1]) === starts.length + 1 && starts.length < nParts) starts.push(i);
  });
  if (starts.length !== nParts) {
    throw new PackError(`${where}: the statement needs a "## Part N" heading for each of its ${nParts} parts (found ${starts.length})`);
  }
  let end = lines.length;
  for (let i = starts[nParts - 1] + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break; }
  }
  const slice = (a, b) => lines.slice(a, b).join("\n").trim();
  return {
    intro: slice(0, starts[0]),
    parts: starts.map((s, k) => ({
      heading: lines[s].replace(/^##\s+/, "").trim(),
      body: slice(s + 1, k + 1 < nParts ? starts[k + 1] : end),
    })),
    notes: slice(end, lines.length),
  };
}

// Notes after the last part: list items tagged "(Part N)" (or Task/Requirement N)
// belong to that part and stay hidden until it unlocks; everything else always shows.
function tagNotes(md) {
  if (!md) return [];
  const out = [];
  let tag = null;
  for (const line of md.split("\n")) {
    const item = line.match(/^\s{0,3}[-*+]\s+(?:\*\*)?\((?:Part|Task|Requirement|Step)\s+(\d+)\)/i);
    if (item) tag = Number(item[1]);
    else if (/^\s{0,3}([-*+]|\d+[.)])\s/.test(line) || (!/^\s/.test(line) && line.trim())) tag = null;
    out.push({ part: tag, line });
  }
  return out;
}

// The notes a reader can see once `unlocked` parts are open, as HTML.
export function notesHtml(drill, unlocked) {
  const md = drill.notes.filter((n) => n.part === null || n.part <= unlocked).map((n) => n.line).join("\n").trim();
  return md ? render(md) : null;
}

function callNames(call, languages, where) {
  const out = {};
  for (const lang of languages) {
    const name = typeof call === "string" ? call : call && call[lang];
    if (typeof name !== "string" || !NAME.test(name)) {
      throw new PackError(`${where}: "call" needs a function or class name for ${lang}`);
    }
    out[lang] = name;
  }
  return out;
}

function argSpec(args, where) {
  if (args === undefined || args === null) return null;
  const ok = Array.isArray(args) && args.every((a) => typeof a === "string" || (a && typeof a === "object" && "value" in a));
  if (!ok) throw new PackError(`${where}: "args" must list argument names (or {"value": ...} for a fixed value)`);
  return args;
}

function checkerPath(dir, name, where) {
  if (name === undefined || name === null) return null;
  if (typeof name !== "string" || !FILE.test(name) || !name.endsWith(".mjs")) throw new PackError(`${where}: "checker" must name an .mjs file in the drill folder`);
  if (!existsSync(join(dir, name))) throw new PackError(`${where}: missing ${name}`);
  return join(dir, name);
}

function loadDrill(dir, id, packLanguages) {
  const where = `drill ${id}`;
  const meta = readJson(join(dir, "drill.json"), where);
  if (typeof meta.title !== "string" || !meta.title.trim()) throw new PackError(`${where}: drill.json needs a "title"`);
  const languages = meta.languages || packLanguages;
  if (!Array.isArray(languages) || !languages.length || languages.some((l) => !packLanguages.includes(l))) {
    throw new PackError(`${where}: "languages" must list some of the pack's languages (${packLanguages.join(", ")})`);
  }

  const starters = {}, adapters = {};
  for (const lang of languages) {
    const starter = join(dir, `starter.${LANG_META[lang].ext}`);
    if (!existsSync(starter)) throw new PackError(`${where}: missing starter.${LANG_META[lang].ext}`);
    starters[lang] = readFileSync(starter, "utf8");
    const adapter = join(dir, LANG_META[lang].adapter);
    if (existsSync(adapter)) adapters[lang] = adapter;
  }

  const partMetas = meta.parts === undefined ? [{}] : meta.parts;
  if (!Array.isArray(partMetas) || !partMetas.length || partMetas.some((p) => !p || typeof p !== "object")) {
    throw new PackError(`${where}: "parts" must be a list like [{"title": "..."}, ...]`);
  }
  const nParts = partMetas.length;
  const multipart = meta.parts !== undefined;
  const { visible, hidden } = readCases(dir, where, nParts);

  const statementFile = meta.statement || "problem.md";
  if (typeof statementFile !== "string" || !FILE.test(statementFile)) throw new PackError(`${where}: "statement" must name a file in the drill folder`);
  if (!existsSync(join(dir, statementFile))) throw new PackError(`${where}: missing ${statementFile}`);
  // A leading "# Title" line is dropped: the title comes from drill.json.
  const md = readFileSync(join(dir, statementFile), "utf8").replace(/\r\n?/g, "\n").replace(/^\s*#\s[^\n]*\n/, "");
  const split = multipart ? splitStatement(md, nParts, where) : null;

  const parts = partMetas.map((pm, k) => {
    const pw = multipart ? `${where} part ${k + 1}` : where;
    const call = callNames(pm.call ?? meta.call, languages, pw);
    const args = argSpec(pm.args !== undefined ? pm.args : meta.args, pw);
    for (const lang of languages) {
      if (args === null && !adapters[lang]) throw new PackError(`${pw}: needs "args" (or an ${LANG_META[lang].adapter} for ${lang})`);
    }
    for (const c of [...visible[k], ...hidden[k]]) {
      const names = (args || []).filter((a) => typeof a === "string");
      if (names.some((a) => !c.args || typeof c.args !== "object" || !(a in c.args))) {
        throw new PackError(`${pw}: every case's "args" needs ${names.map((a) => `"${a}"`).join(", ")}`);
      }
    }
    return {
      number: k + 1,
      title: typeof pm.title === "string" ? pm.title : split ? split.parts[k].heading : null,
      html: split ? render(split.parts[k].body) : null,
      call,
      args,
      adapters,
      checker: checkerPath(dir, pm.checker ?? meta.checker, pw),
      visible: visible[k],
      hidden: hidden[k],
    };
  });

  const first = parts[0];
  return {
    id,
    title: meta.title.trim(),
    difficulty: meta.difficulty || null,
    time: meta.time || null,
    tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
    timer: Number.isFinite(meta.timer) && meta.timer > 0 ? meta.timer : null,
    languages,
    starters,
    adapters,
    multipart,
    html: multipart ? render(split.intro) : render(md),
    notes: multipart ? tagNotes(split.notes) : [],
    parts,
    // A single drill's call details, at the top level for convenience.
    call: first.call,
    args: first.args,
    checker: first.checker,
    visible: first.visible,
    hidden: first.hidden,
  };
}

export function loadPack(packDir) {
  const dir = resolve(packDir);
  try {
    const meta = existsSync(join(dir, "pack.json")) ? readJson(join(dir, "pack.json"), "pack") : {};
    const languages = meta.languages || Object.keys(LANG_META);
    if (!Array.isArray(languages) || !languages.length || languages.some((l) => !LANG_META[l])) {
      throw new PackError(`pack.json "languages" must list some of: ${Object.keys(LANG_META).join(", ")}`);
    }
    const folders = meta.folders || ["drills"];
    if (!Array.isArray(folders) || !folders.length || folders.some((f) => typeof f !== "string" || !ID.test(f))) {
      throw new PackError('pack.json "folders" must list folder names, like ["drills"]');
    }
    const locate = (id) => {
      if (!ID.test(id)) throw new PackError(`drill ${id}: drill folder names use letters, digits, ".", "_" and "-"`);
      for (const f of folders) {
        const d = join(dir, f, id);
        if (existsSync(join(d, "drill.json")) && statSync(d).isDirectory()) return d;
      }
      throw new PackError(`drill ${id}: no ${folders.map((f) => `${f}/${id}/drill.json`).join(" or ")}`);
    };

    let groups;
    if (meta.groups !== undefined) {
      if (!Array.isArray(meta.groups) || !meta.groups.length || meta.groups.some((g) => !g || !Array.isArray(g.drills) || !g.drills.length)) {
        throw new PackError('pack.json "groups" must be a list like [{"title": "...", "drills": ["..."]}]');
      }
      groups = meta.groups.map((g) => ({ title: typeof g.title === "string" ? g.title : null, ids: g.drills.map(String) }));
    } else if (meta.drills !== undefined) {
      if (!Array.isArray(meta.drills) || !meta.drills.length) throw new PackError("the pack has no drills");
      groups = [{ title: null, ids: meta.drills.map(String) }];
    } else {
      const ids = [];
      for (const f of folders) {
        if (!existsSync(join(dir, f))) continue;
        for (const d of readdirSync(join(dir, f), { withFileTypes: true })) {
          if (d.isDirectory() && existsSync(join(dir, f, d.name, "drill.json"))) ids.push(d.name);
        }
      }
      if (!ids.length) throw new PackError(`no drills found in ${folders.map((f) => f + "/").join(", ")}`);
      groups = [{ title: null, ids: ids.sort() }];
    }
    const all = groups.flatMap((g) => g.ids);
    if (new Set(all).size !== all.length) throw new PackError("pack.json lists a drill twice");

    const drills = [];
    for (const g of groups) {
      g.ids.forEach((id, i) => {
        const d = loadDrill(locate(id), id, languages);
        d.number = i + 1;
        d.group = g.title;
        drills.push(d);
      });
    }
    return {
      dir,
      key: typeof meta.key === "string" && ID.test(meta.key) ? meta.key : basename(dir),
      title: typeof meta.title === "string" ? meta.title : "Drill Room",
      languages,
      notes: meta.notes && typeof meta.notes === "object" ? meta.notes : {},
      groups: groups.map((g) => ({ title: g.title, drills: g.ids })),
      drills,
      byId: Object.fromEntries(drills.map((d) => [d.id, d])),
    };
  } catch (e) {
    if (e instanceof PackError) throw new Error(`Problem pack ${dir}: ${e.message}`);
    throw e;
  }
}

// What the page gets: everything except the cases (the server judges those) and
// the part statements (the server hands those out as parts unlock).
export function publicView(pack) {
  return {
    key: pack.key,
    title: pack.title,
    languages: pack.languages.map((id) => ({ id, label: LANG_META[id].label })),
    notes: pack.notes,
    groups: pack.groups,
    drills: pack.drills.map((d) => ({
      id: d.id, number: d.number, group: d.group, title: d.title, difficulty: d.difficulty, time: d.time,
      tags: d.tags, timer: d.timer, languages: d.languages, html: d.html, starters: d.starters,
      multipart: d.multipart, parts: d.parts.map((p) => ({ number: p.number, title: p.title })),
    })),
  };
}
