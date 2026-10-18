import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { cpSync, writeFileSync, readFileSync } from "node:fs";
import { createApp } from "../room/server.mjs";
import { EXAMPLE, reference } from "./helpers.mjs";

let server, base, solutions;

before(async () => {
  solutions = mkdtempSync(join(tmpdir(), "drillroom-server-"));
  server = createApp({ packDir: EXAMPLE, solutionsDir: solutions, timeLimitMs: 3000 });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  rmSync(solutions, { recursive: true, force: true });
});

const post = (path, body) => fetch(base + path, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("serves the page, the editor script and the pack", async () => {
  assert.match(await (await fetch(base + "/")).text(), /<title>Drill Room<\/title>/);
  assert.match(await (await fetch(base + "/editor.js")).text(), /DrillEditor/);
  const pack = await (await fetch(base + "/api/pack")).json();
  assert.equal(pack.title, "Starter pack");
  assert.deepEqual(pack.drills.map((d) => d.id), ["01-reverse-words", "02-min-stack", "03-word-counts"]);
  assert.equal((await fetch(base + "/nope")).status, 404);
});

test("run shows the visible cases with expected and got", async () => {
  const code = reference("01-reverse-words", "typescript");
  const j = await (await post("/api/judge", { lang: "typescript", drill: "01-reverse-words", code, mode: "run" })).json();
  assert.equal(j.cases.length, 2);
  assert.ok(j.cases.every((c) => c.pass && "expected" in c && "got" in c));
  assert.equal(j.saved.status, "IN PROGRESS: sample passes, not submitted yet");
});

test("submit reports pass/fail only, never the hidden cases", async () => {
  const code = 'function reverseWords(text: string): string {\n  if (!text.trim()) throw new RangeError("empty");\n  return "";\n}\n';
  const res = await post("/api/judge", { lang: "typescript", drill: "01-reverse-words", code, mode: "submit" });
  const text = await res.text();
  for (const leak of ["expected", "got", "args", "two line one line"]) assert.ok(!text.includes(leak), leak);
  const j = JSON.parse(text);
  assert.equal(j.cases.length, 5);
  assert.deepEqual(j.cases.slice(0, 2), [{ pass: false, error: "RangeError" }, { pass: false, error: "RangeError" }]);
  assert.equal(j.saved.status, "IN PROGRESS: 0/5 hidden tests passing");
});

test("save writes the solution into the solutions folder, and the page can read it back", async () => {
  const j = await (await post("/api/save", { lang: "python", drill: "02-min-stack", code: "class MinStack:\n    pass\n" })).json();
  assert.equal(j.saved.status, "IN PROGRESS: saved, not run yet");
  assert.ok(existsSync(join(solutions, "python", "02-min-stack.py")));
  const back = await (await fetch(`${base}/api/solution?lang=python&drill=02-min-stack`)).json();
  assert.equal(back.code, "class MinStack:\n    pass\n");
  const none = await (await fetch(`${base}/api/solution?lang=ruby&drill=02-min-stack`)).json();
  assert.equal(none.code, null);
});

test("bad requests get 400s", async () => {
  const bad = [
    ["/api/judge", { lang: "cobol", drill: "01-reverse-words", code: "", mode: "run" }],
    ["/api/judge", { lang: "python", drill: "99", code: "", mode: "run" }],
    ["/api/judge", { lang: "python", drill: "../../etc", code: "", mode: "run" }],
    ["/api/judge", { lang: "python", drill: "01-reverse-words", code: "", mode: "peek" }],
    ["/api/judge", { lang: "python", drill: "01-reverse-words", code: 5, mode: "run" }],
    ["/api/save", { lang: "python", drill: "toString", code: "" }],
  ];
  for (const [path, body] of bad) assert.equal((await post(path, body)).status, 400, JSON.stringify(body));
  assert.equal((await fetch(`${base}/api/solution?lang=python&drill=constructor`)).status, 400);
  const garbled = await fetch(base + "/api/save", { method: "POST", body: "{" });
  assert.equal(garbled.status, 400);
});

test("oversized bodies get a 413", async () => {
  const res = await post("/api/save", { lang: "python", drill: "01-reverse-words", code: "x".repeat(250_000) });
  assert.equal(res.status, 413);
});

// ---------------- Multi-part drills ----------------
const WC = "03-word-counts";
const state = async () => (await fetch(`${base}/api/state?drill=${WC}`)).json();
const judgeWC = async (mode, part, code) =>
  post("/api/judge", { lang: "typescript", drill: WC, part, code, mode });

test("multi-part: part 2 stays locked, statement and notes included, until part 1 passes", async () => {
  const st = await state();
  assert.equal(st.unlocked, 1);
  assert.equal(st.parts[0].title, "Part 1: Count");
  assert.match(st.parts[0].html, /countWords/);
  assert.equal(st.parts[1].html, null);
  assert.doesNotMatch(st.notesHtml, /at least 1/);
  const locked = await judgeWC("run", 2, "");
  assert.equal(locked.status, 400);
  assert.match((await locked.json()).error, /Part 2 is locked/);
  assert.equal((await judgeWC("run", 3, "")).status, 400);
});

test("multi-part: passing part 1 unlocks part 2, whose submit re-checks part 1", async () => {
  const good = reference(WC, "typescript");
  const run = await (await judgeWC("run", 1, good)).json();
  assert.equal(run.part, 1);
  assert.ok(run.cases[0].pass);

  // Part 1 right, part 2 still the stub: part 1 passes, and part 2 opens.
  const half = good.replace(/function topWords[\s\S]*$/, "function topWords(text: string, k: number) { return []; }\n");
  const s1 = await (await judgeWC("submit", 1, half)).json();
  assert.deepEqual(s1.parts.map((p) => [p.part, p.cases.every((c) => c.pass)]), [[1, true]]);
  assert.equal(s1.unlocked, 2);
  assert.equal(s1.saved.status, "IN PROGRESS: part 1 of 2 passes");
  const st = await state();
  assert.equal(st.unlocked, 2);
  assert.match(st.parts[1].html, /topWords/);
  assert.match(st.notesHtml, /at least 1/);

  const s2 = await (await judgeWC("submit", 2, half)).json();
  assert.deepEqual(s2.parts.map((p) => p.part), [1, 2]);
  assert.equal(s2.saved.status, "IN PROGRESS: part 2 at 1/4 hidden tests");

  // A part-2 change that breaks part 1 shows up in part 1's score.
  const broken = good.replace("(out[w] || 0) + 1", "1");
  const s3 = await (await judgeWC("submit", 2, broken)).json();
  assert.ok(!s3.parts[0].cases.every((c) => c.pass));
  assert.match(s3.saved.status, /^IN PROGRESS: part 1 at \d\/4 hidden tests$/);

  const s4 = await (await judgeWC("submit", 2, good)).json();
  assert.ok(s4.parts.every((p) => p.cases.every((c) => c.pass)));
  assert.equal(s4.saved.status, "PASSED: all 2 parts");
  const summary = readFileSync(join(solutions, "README.md"), "utf8");
  assert.match(summary, /\| 3\. Word counts \| TypeScript \| PASSED: all 2 parts \| 2\/2 parts \|/);
});

test("a checker accepts any valid answer, and drill languages are enforced", async (t) => {
  const pack = mkdtempSync(join(tmpdir(), "drillroom-checker-"));
  const sol = mkdtempSync(join(tmpdir(), "drillroom-checker-sol-"));
  t.after(() => { rmSync(pack, { recursive: true, force: true }); rmSync(sol, { recursive: true, force: true }); });
  cpSync(EXAMPLE, pack, { recursive: true });
  const d = join(pack, "drills", "01-reverse-words");
  const meta = JSON.parse(readFileSync(join(d, "drill.json"), "utf8"));
  writeFileSync(join(d, "drill.json"), JSON.stringify({ ...meta, languages: ["typescript"], checker: "checker.mjs" }));
  // Any ordering of the right words passes; "expected" is ignored.
  writeFileSync(join(d, "checker.mjs"), `export default (args, got) =>
    typeof got === "string" && got.split(" ").filter(Boolean).sort().join(" ") === args.text.split(/\\s+/).filter(Boolean).sort().join(" ");\n`);
  const app = createApp({ packDir: pack, solutionsDir: sol });
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  t.after(() => app.close());
  const url = `http://127.0.0.1:${app.address().port}/api/judge`;
  const call = (lang, code) => fetch(url, { method: "POST", body: JSON.stringify({ lang, drill: "01-reverse-words", code, mode: "submit" }) });
  const same = "function reverseWords(text: string) { return text.split(/\\s+/).filter(Boolean).join(\" \"); }";
  const j = await (await call("typescript", same)).json();
  assert.ok(j.cases.every((c) => c.pass), JSON.stringify(j));
  const py = await call("python", "def reverse_words(t):\n    return t\n");
  assert.equal(py.status, 400);
  assert.match((await py.json()).error, /isn't available in python/);
});
