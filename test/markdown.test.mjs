import { test } from "node:test";
import assert from "node:assert/strict";
import { render, inline } from "../room/markdown.mjs";

test("paragraphs and headings", () => {
  assert.equal(render("# Title\n\nOne line\nsame paragraph.\n\n## Next"),
    "<h1>Title</h1>\n<p>One line\nsame paragraph.</p>\n<h2>Next</h2>");
});

test("lists: unordered, ordered, and continuation lines", () => {
  assert.equal(render("- a\n- b\n  more b\n\n1. x\n2. y"),
    "<ul><li>a</li><li>b\nmore b</li></ul>\n<ol><li>x</li><li>y</li></ol>");
});

test("fenced code keeps text exactly and escapes it", () => {
  assert.equal(render("```ts\nconst a = <T>(x: T) => x && 1;\n  indented\n```"),
    '<pre><code class="language-ts">const a = &lt;T&gt;(x: T) =&gt; x &amp;&amp; 1;\n  indented</code></pre>');
});

test("inline code, bold, italics and links", () => {
  assert.equal(inline("Use `a < b` and **not** *this* or _that_."),
    "Use <code>a &lt; b</code> and <strong>not</strong> <em>this</em> or <em>that</em>.");
  assert.equal(inline("[docs](https://example.com/a?b=1&c=2)"), '<a href="https://example.com/a?b=1&amp;c=2">docs</a>');
});

test("no formatting inside code spans, and snake_case stays plain", () => {
  assert.equal(inline("`**x**` and snake_case_names_here"), "<code>**x**</code> and snake_case_names_here");
});

test("raw HTML and unsafe links are shown as text", () => {
  assert.equal(render("<script>alert(1)</script>"), "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>");
  assert.equal(inline("[x](javascript:alert(1))"), "[x](javascript:alert(1))");
});

test("backslash escapes", () => {
  assert.equal(inline("\\*not italic\\* and \\`tick\\`"), "*not italic* and `tick`");
});

test("bold around inline code", () => {
  assert.equal(inline("**Use `End Date`** to decide"), "<strong>Use <code>End Date</code></strong> to decide");
});

test("tables", () => {
  assert.equal(render("| Field | Notes |\n|---|:---:|\n| `id` | unique, a\\|b |\n| n | **int** |"),
    "<table><thead><tr><th>Field</th><th>Notes</th></tr></thead><tbody><tr><td><code>id</code></td><td>unique, a|b</td></tr><tr><td>n</td><td><strong>int</strong></td></tr></tbody></table>");
});

test("nested lists and continuation lines", () => {
  assert.equal(render("- a\n  - a1\n    more a1\n  - a2\n- b\n\n1. x\n   - x1"),
    "<ul><li>a<ul><li>a1\nmore a1</li><li>a2</li></ul></li><li>b</li></ul>\n<ol><li>x<ul><li>x1</li></ul></li></ol>");
});
