import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { canon, same, stripHeader, statusLine, createStore, HEADER_END } from "../room/lib.mjs";
import { pack, tempDir } from "./helpers.mjs";

test("canon/same: key order never matters, everything else does", () => {
  assert.deepEqual(Object.keys(canon({ b: 1, a: { d: 1, c: 2 } })), ["a", "b"]);
  assert.ok(same({ a: 1, b: [1, { x: 1, y: 2 }] }, { b: [1, { y: 2, x: 1 }], a: 1 }));
  assert.ok(!same([1, 2], [2, 1]));
  assert.ok(!same({ a: 1 }, { a: "1" }));
  assert.ok(!same(null, {}));
});

test("stripHeader removes the room's header and leaves other code alone", () => {
  assert.equal(stripHeader(`// Drill 1\n// ${HEADER_END}\n\ncode()\n`), "code()\n");
  assert.equal(stripHeader("plain()\n"), "plain()\n");
  assert.equal(stripHeader(`# ${HEADER_END}`), "");
});

test("statusLine covers every state", () => {
  assert.equal(statusLine({ lastEvent: "submit", lastSubmit: { passed: 5, total: 5 } }), "PASSED: 5/5 hidden tests");
  assert.equal(statusLine({ lastEvent: "submit", lastSubmit: { passed: 2, total: 5 } }), "IN PROGRESS: 2/5 hidden tests passing");
  assert.equal(statusLine({ lastEvent: "run", lastRun: { pass: true } }), "IN PROGRESS: sample passes, not submitted yet");
  assert.equal(statusLine({ lastEvent: "run", lastRun: { pass: false } }), "IN PROGRESS: sample failing");
  assert.equal(statusLine({ lastEvent: "save", firstPassed: "2026-01-02 03:04" }), "IN PROGRESS: edited since it passed (2026-01-02 03:04); not re-submitted");
  assert.equal(statusLine({ lastEvent: "save" }), "IN PROGRESS: saved, not run yet");
});

test("store: save, run, partial submit, full submit, unchanged save, edited save", (t) => {
  const dir = tempDir(t);
  let minute = 0;
  const now = () => new Date(2026, 0, 2, 9, minute++);
  const store = createStore(dir, { drills: pack.drills, now });
  const id = "01-reverse-words";
  const file = join(dir, "python", `${id}.py`);

  assert.equal(store.save("python", id, "v1", { type: "save" }).status, "IN PROGRESS: saved, not run yet");
  assert.match(readFileSync(file, "utf8"), /^# Drill 1: Reverse words \(Python 3\)\n/);
  assert.equal(store.read("python", id), "v1\n");

  assert.equal(store.save("python", id, "v2", { type: "run", pass: true }).status, "IN PROGRESS: sample passes, not submitted yet");
  assert.equal(store.save("python", id, "v2", { type: "submit", passed: 3, total: 5 }).status, "IN PROGRESS: 3/5 hidden tests passing");
  const full = store.save("python", id, "v3", { type: "submit", passed: 5, total: 5 });
  assert.deepEqual(full, { status: "PASSED: 5/5 hidden tests", lastSaved: "2026-01-02 09:03" });

  // Saving the same code (even with the header still on it) keeps the PASSED status.
  const withHeader = readFileSync(file, "utf8");
  assert.equal(store.save("python", id, withHeader, { type: "save" }).status, "PASSED: 5/5 hidden tests");
  assert.equal(store.read("python", id), "v3\n");

  assert.equal(store.save("python", id, "v4", { type: "save" }).status,
    "IN PROGRESS: edited since it passed (2026-01-02 09:03); not re-submitted");

  const e = store.loadProgress().python[id];
  assert.equal(e.runs, 1);
  assert.equal(e.submits, 2);
  assert.deepEqual(e.bestSubmit, { passed: 5, total: 5, at: "2026-01-02 09:03" });
  assert.deepEqual(e.history.map((h) => h.event), ["save", "run", "submit", "submit", "save"]);

  const summary = readFileSync(join(dir, "README.md"), "utf8");
  assert.match(summary, /\| 1\. Reverse words \| Python 3 \| IN PROGRESS: edited since it passed/);
  assert.match(summary, /\[code\]\(python\/01-reverse-words\.py\)/);
});

test("store: read returns null when nothing is saved", (t) => {
  const dir = tempDir(t);
  const store = createStore(dir, { drills: pack.drills });
  assert.equal(store.read("ruby", "02-min-stack"), null);
  assert.equal(store.loadProgress().ruby, undefined);
  assert.ok(!existsSync(join(dir, "progress.json")));
});

test("store: multi-part submits track each part, and parts unlock in order across languages", (t) => {
  const dir = tempDir(t);
  let minute = 0;
  const store = createStore(dir, { drills: pack.drills, now: () => new Date(2026, 0, 2, 10, minute++) });
  const id = "03-word-counts";
  assert.equal(store.unlocked(id), 1);
  assert.equal(store.unlocked("01-reverse-words"), 1);
  assert.equal(store.save("python", id, "a", { type: "run", pass: true, part: 1 }).status, "IN PROGRESS: part 1 sample passes");
  assert.equal(store.save("python", id, "a", { type: "submit", part: 1, perPart: { 1: { passed: 2, total: 4 } } }).status,
    "IN PROGRESS: part 1 at 2/4 hidden tests");
  assert.equal(store.unlocked(id), 1);
  assert.equal(store.save("python", id, "b", { type: "submit", part: 1, perPart: { 1: { passed: 4, total: 4 } } }).status,
    "IN PROGRESS: part 1 of 2 passes");
  // Passing part 1 in Python opens part 2 for every language.
  assert.equal(store.unlocked(id), 2);
  assert.equal(store.save("ruby", id, "c", { type: "submit", part: 2, perPart: { 1: { passed: 4, total: 4 }, 2: { passed: 4, total: 4 } } }).status,
    "PASSED: all 2 parts");
  const e = store.loadProgress().ruby[id];
  assert.equal(e.firstPassed, "2026-01-02 10:03");
  assert.deepEqual(Object.keys(e.parts), ["1", "2"]);
  assert.match(readFileSync(join(dir, "ruby", `${id}.rb`), "utf8"), /# Best submit: {2}2 of 2 parts passed/);
  assert.equal(statusLine({ lastEvent: "submit", lastSubmit: { part: 3, perPart: { 1: { passed: 1, total: 1 }, 2: { passed: 1, total: 1 }, 3: { passed: 1, total: 1 } } } }, 4),
    "IN PROGRESS: parts 1–3 of 4 pass");
});
