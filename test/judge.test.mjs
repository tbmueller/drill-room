import { test } from "node:test";
import assert from "node:assert/strict";
import { judge, same } from "../room/lib.mjs";
import { pack, reference, AVAILABLE } from "./helpers.mjs";

const [words, stack] = pack.drills;
const all = (d) => [...d.visible, ...d.hidden];
const passed = (res, cases) => res.results.filter((r, i) => r.ok && same(r.got, cases[i].expected)).length;

// Per-language snippets for the failure cases.
const BROKEN = {
  typescript: {
    syntax: "function reverseWords(text: string): string {\n  return (;\n}\n",
    runtime: "function reverseWords(text: string): string {\n  const words = null as any;\n  return words.reverse();\n}\n",
    logs: 'console.log("loaded");\nfunction reverseWords(text: string): string {\n  console.log("got", text.length);\n  return "";\n}\n',
    loop: "function reverseWords(text: string): string {\n  while (true) {}\n}\n",
    renamed: "function reverse(text: string): string {\n  return text;\n}\n",
  },
  python: {
    syntax: "def reverse_words(text):\n    return (\n",
    runtime: "def reverse_words(text):\n    words = None\n    return words.reverse()\n",
    logs: 'print("loaded")\ndef reverse_words(text):\n    print("got", len(text))\n    return ""\n',
    loop: "def reverse_words(text):\n    while True:\n        pass\n",
    renamed: "def reverse(text):\n    return text\n",
  },
  ruby: {
    syntax: "def reverse_words(text)\n  return (\nend\n",
    runtime: "def reverse_words(text)\n  words = nil\n  words.reverse\nend\n",
    logs: 'puts "loaded"\ndef reverse_words(text)\n  puts "got #{text.length}"\n  ""\nend\n',
    loop: "def reverse_words(text)\n  loop {}\nend\n",
    renamed: "def reverse(text)\n  text\nend\n",
  },
};

for (const lang of ["typescript", "python", "ruby"]) {
  const skip = AVAILABLE[lang] ? false : `${lang} isn't installed`;
  const b = BROKEN[lang];

  test(`${lang}: reference solutions pass every visible and hidden case`, { skip }, async () => {
    for (const d of [words, stack]) {
      const res = await judge(lang, d, reference(d.id, lang), all(d));
      assert.equal(res.fatal, undefined);
      assert.equal(passed(res, all(d)), all(d).length, `${d.id} in ${lang}`);
    }
  });

  test(`${lang}: the blank starters run and only pass the trivial cases`, { skip }, async () => {
    const res = await judge(lang, words, words.starters[lang], all(words));
    assert.ok(res.results.every((r) => r.ok));
    assert.equal(passed(res, all(words)), 2);
  });

  test(`${lang}: a syntax error names the line`, { skip }, async () => {
    const res = await judge(lang, words, b.syntax, words.visible);
    assert.ok(res.results.every((r) => !r.ok));
    assert.match(res.results[0].error, /^SyntaxError/);
    if (lang !== "typescript") assert.match(res.results[0].error, /2|3/);
  });

  test(`${lang}: a runtime error reports the solution's line`, { skip }, async () => {
    const res = await judge(lang, words, b.runtime, words.visible);
    assert.equal(res.results[0].ok, false);
    assert.match(res.results[0].error, /\(line 3\)$/);
  });

  test(`${lang}: printed output is captured per case`, { skip }, async () => {
    const res = await judge(lang, words, b.logs, words.visible);
    assert.deepEqual(res.results[0].logs, ["loaded", "got 24"]);
    assert.deepEqual(res.results[1].logs, ["got 5"]);
  });

  test(`${lang}: an infinite loop hits the time limit`, { skip }, async () => {
    const res = await judge(lang, words, b.loop, words.visible, { timeLimitMs: 1500 });
    assert.match(res.fatal, /Time limit exceeded/);
  });

  test(`${lang}: a renamed function gets a clear message`, { skip }, async () => {
    const res = await judge(lang, words, b.renamed, words.visible);
    assert.match(res.results[0].error, /is not defined\. Keep the name from the starter code\./);
  });
}

test("typescript: Sets and Maps compare like arrays and objects", async () => {
  const code = "function reverseWords(text: string) {\n  return new Set(text.split(/\\s+/).filter(Boolean).reverse());\n}\n";
  const res = await judge("typescript", words, code, [{ args: { text: "a b" }, expected: ["b", "a"] }]);
  assert.deepEqual(res.results[0].got, ["b", "a"]);
});

test("an unknown language is a fatal error, not a crash", async () => {
  assert.match((await judge("cobol", words, "", words.visible)).fatal, /Unknown language/);
});

test("typescript: export keywords are fine, and undefined inside an answer becomes null", async () => {
  const code = "export function reverseWords(text: string) {\n  return [undefined, text] as any;\n}\n";
  const res = await judge("typescript", words, code, [{ args: { text: "a" }, expected: [null, "a"] }]);
  assert.deepEqual(res.results[0].got, [null, "a"]);
});

for (const lang of ["typescript", "python", "ruby"]) {
  test(`${lang}: fixed-value args are passed after the case's args`, { skip: AVAILABLE[lang] ? false : `${lang} isn't installed` }, async () => {
    const part = { ...words, args: ["text", { value: 3 }] };
    const code = {
      typescript: "function reverseWords(t: string, n: number) { return t.repeat(n); }\n",
      python: "def reverse_words(t, n):\n    return t * n\n",
      ruby: "def reverse_words(t, n)\n  t * n\nend\n",
    }[lang];
    const res = await judge(lang, part, code, [{ args: { text: "ab" }, expected: "ababab" }]);
    assert.equal(res.results[0].got, "ababab");
  });

  test(`${lang}: each part of a multi-part drill calls its own function`, { skip: AVAILABLE[lang] ? false : `${lang} isn't installed` }, async () => {
    const d = pack.byId["03-word-counts"];
    for (const p of d.parts) {
      const cases = [...p.visible, ...p.hidden];
      const res = await judge(lang, p, reference(d.id, lang), cases);
      assert.equal(passed(res, cases), cases.length, `part ${p.number}`);
    }
  });
}
