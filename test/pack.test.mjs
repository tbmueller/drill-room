import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadPack, publicView } from "../room/pack.mjs";
import { EXAMPLE, pack, tempDir } from "./helpers.mjs";

test("the example pack loads with numbered drills, statements and starters", () => {
  assert.equal(pack.title, "Starter pack");
  assert.equal(pack.key, "starter-pack");
  assert.deepEqual(pack.drills.map((d) => [d.id, d.number, d.title]),
    [["01-reverse-words", 1, "Reverse words"], ["02-min-stack", 2, "Min stack"], ["03-word-counts", 3, "Word counts"]]);
  const [words, stack] = pack.drills;
  assert.deepEqual(words.args, ["text"]);
  assert.equal(words.call.python, "reverse_words");
  assert.match(words.html, /<h2>Example<\/h2>/);
  assert.match(words.starters.ruby, /def reverse_words/);
  assert.equal(stack.args, null);
  assert.deepEqual(Object.keys(stack.adapters).sort(), ["python", "ruby", "typescript"]);
  assert.ok(words.visible.length === 2 && words.hidden.length === 5);
});

test("the page's view of a pack never includes cases", () => {
  const text = JSON.stringify(publicView(pack));
  assert.ok(!text.includes("expected"));
  assert.ok(!text.includes("two line one line")); // a hidden answer
  assert.ok(!text.includes("most frequent words")); // part 2's statement, which unlocks later
  assert.ok(!text.includes("is at least 1")); // a note tagged (Part 2)
});

function brokenPack(t, edit) {
  const dir = join(tempDir(t), "pack");
  cpSync(EXAMPLE, dir, { recursive: true });
  edit(dir);
  return dir;
}
const drill = (dir, f = "") => join(dir, "drills", "01-reverse-words", f);

test("hidden.b64 works in place of hidden.json", (t) => {
  const dir = brokenPack(t, (d) => {
    const json = readFileSync(drill(d, "hidden.json"));
    writeFileSync(drill(d, "hidden.b64"), json.toString("base64").replace(/(.{60})/g, "$1\n"));
    rmSync(drill(d, "hidden.json"));
  });
  assert.equal(loadPack(dir).drills[0].hidden.length, 5);
});

test("pack.json can pick and order the drills", (t) => {
  const dir = brokenPack(t, (d) => writeFileSync(join(d, "pack.json"), JSON.stringify({ drills: ["02-min-stack"] })));
  const p = loadPack(dir);
  assert.deepEqual(p.drills.map((d) => [d.id, d.number]), [["02-min-stack", 1]]);
  assert.equal(p.title, "Drill Room");
});

for (const [what, edit, message] of [
  ["a missing starter", (d) => rmSync(drill(d, "starter.rb")), /drill 01-reverse-words: missing starter\.rb/],
  ["a missing statement", (d) => rmSync(drill(d, "problem.md")), /missing problem\.md/],
  ["no hidden cases", (d) => rmSync(drill(d, "hidden.json")), /needs hidden\.json or hidden\.b64/],
  ["a case without expected", (d) => writeFileSync(drill(d, "visible.json"), '[{"args":{"text":"a"}}]'), /visible\.json case 1 needs "args" and "expected"/],
  ["a case missing an argument", (d) => writeFileSync(drill(d, "visible.json"), '[{"args":{},"expected":""}]'), /every case's "args" needs "text"/],
  ["a bad call name", (d) => writeFileSync(drill(d, "drill.json"), '{"title":"x","call":"no spaces allowed","args":["text"]}'), /"call" needs a function or class name/],
  ["no args and no adapter", (d) => writeFileSync(drill(d, "drill.json"), '{"title":"x","call":"f"}'), /needs "args" \(or an adapter\.mjs for typescript\)/],
  ["an unknown language", (d) => writeFileSync(join(d, "pack.json"), '{"languages":["cobol"]}'), /"languages" must list some of/],
  ["broken JSON", (d) => writeFileSync(drill(d, "drill.json"), "{"), /can't read drill\.json/],
  ["an unsafe drill folder name", (d) => writeFileSync(join(d, "pack.json"), '{"drills":["../x"]}'), /drill folder names use/],
]) {
  test(`a pack with ${what} is rejected with a clear message`, (t) => {
    assert.throws(() => loadPack(brokenPack(t, edit)), message);
  });
}

test("a multi-part drill splits its statement and keys its cases by part", () => {
  const d = pack.byId["03-word-counts"];
  assert.equal(d.multipart, true);
  assert.equal(d.timer, 30);
  assert.deepEqual(d.parts.map((p) => [p.number, p.title, p.call.typescript, p.args]), [
    [1, "Part 1: Count", "countWords", ["text"]],
    [2, "Part 2: Top k", "topWords", ["text", "k"]],
  ]);
  assert.match(d.html, /two-part problem/);
  assert.doesNotMatch(d.html, /Word counts|Part 1/); // the "# Title" line and the parts are split off
  assert.match(d.parts[1].html, /topWords/);
  assert.deepEqual(d.parts.map((p) => [p.visible.length, p.hidden.length]), [[1, 4], [1, 4]]);
});

test("notes tagged (Part N) appear only once that part is open", async () => {
  const { notesHtml } = await import("../room/pack.mjs");
  const d = pack.byId["03-word-counts"];
  assert.doesNotMatch(notesHtml(d, 1), /at least 1/);
  assert.match(notesHtml(d, 1), /plain ASCII/);
  assert.match(notesHtml(d, 2), /\(Part 2\) <code>k<\/code> is at least 1/);
});

test("groups, extra folders and per-drill languages", (t) => {
  const dir = brokenPack(t, (d) => {
    cpSync(join(d, "drills", "03-word-counts"), join(d, "problems", "word-counts"), { recursive: true });
    rmSync(join(d, "drills", "03-word-counts"), { recursive: true });
    const meta = JSON.parse(readFileSync(join(d, "problems", "word-counts", "drill.json"), "utf8"));
    meta.languages = ["typescript"];
    writeFileSync(join(d, "problems", "word-counts", "drill.json"), JSON.stringify(meta));
    writeFileSync(join(d, "pack.json"), JSON.stringify({
      folders: ["drills", "problems"],
      groups: [{ title: "Problems", drills: ["word-counts"] }, { title: "Warm-ups", drills: ["02-min-stack", "01-reverse-words"] }],
    }));
  });
  const p = loadPack(dir);
  assert.deepEqual(p.drills.map((d) => [d.group, d.number, d.id]),
    [["Problems", 1, "word-counts"], ["Warm-ups", 1, "02-min-stack"], ["Warm-ups", 2, "01-reverse-words"]]);
  assert.deepEqual(p.byId["word-counts"].languages, ["typescript"]);
  assert.deepEqual(publicView(p).groups, [{ title: "Problems", drills: ["word-counts"] }, { title: "Warm-ups", drills: ["02-min-stack", "01-reverse-words"] }]);
});

test("fixed-value args and a statement file other than problem.md", (t) => {
  const dir = brokenPack(t, (d) => {
    writeFileSync(drill(d, "drill.json"), JSON.stringify({ title: "x", call: "f", args: ["text", { value: 2 }], statement: "README.md" }));
    writeFileSync(drill(d, "README.md"), "# Ignored title\n\nBody.");
  });
  const d = loadPack(dir).drills[0];
  assert.deepEqual(d.args, ["text", { value: 2 }]);
  assert.equal(d.html, "<p>Body.</p>");
});

const multi = (d, f = "") => join(d, "drills", "03-word-counts", f);
for (const [what, edit, message] of [
  ["cases not keyed by part", (d) => writeFileSync(multi(d, "visible.json"), "[]"), /visible\.json must map part numbers to cases/],
  ["a part with no hidden cases", (d) => writeFileSync(multi(d, "hidden.json"), '{"1": [{"args": {"text": ""}, "expected": {}}]}'), /hidden\.json has no cases for part 2/],
  ["a missing part heading", (d) => writeFileSync(multi(d, "problem.md"), "Intro\n\n## Part 1: Only\n\nBody"), /needs a "## Part N" heading for each of its 2 parts \(found 1\)/],
  ["a missing checker file", (d) => {
    const m = JSON.parse(readFileSync(multi(d, "drill.json"), "utf8")); m.parts[1].checker = "check.mjs";
    writeFileSync(multi(d, "drill.json"), JSON.stringify(m));
  }, /part 2: missing check\.mjs/],
  ["a language the pack doesn't have", (d) => {
    const m = JSON.parse(readFileSync(multi(d, "drill.json"), "utf8")); m.languages = ["cobol"];
    writeFileSync(multi(d, "drill.json"), JSON.stringify(m));
  }, /"languages" must list some of the pack's languages/],
]) {
  test(`a multi-part drill with ${what} is rejected with a clear message`, (t) => {
    assert.throws(() => loadPack(brokenPack(t, edit)), message);
  });
}
