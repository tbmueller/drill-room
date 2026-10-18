import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const E = createRequire(import.meta.url)("../room/editor.js");

test("moveLines: one line up and down, cursor follows", () => {
  const v = "a\nbb\nccc";
  const up = E.moveLines(v, 3, 3, -1); // cursor in "bb"
  assert.equal(E.apply(v, up), "bb\na\nccc");
  assert.deepEqual([up.selStart, up.selEnd], [1, 1]);
  const down = E.moveLines(v, 3, 3, 1);
  assert.equal(E.apply(v, down), "a\nccc\nbb");
  assert.deepEqual([down.selStart, down.selEnd], [7, 7]);
});

test("moveLines: no-op at the first and last line", () => {
  assert.equal(E.moveLines("a\nb", 0, 0, -1), null);
  assert.equal(E.moveLines("a\nb", 3, 3, 1), null);
});

test("moveLines: a multi-line selection moves as a block", () => {
  const v = "1\n2\n3\n4";
  assert.equal(E.apply(v, E.moveLines(v, 2, 5, 1)), "1\n4\n2\n3");
  // A selection ending right after a newline doesn't drag the next line along.
  assert.equal(E.moveLines(v, 0, 4, -1), null);
  assert.equal(E.apply(v, E.moveLines(v, 2, 6, 1)), "1\n4\n2\n3");
});

test("indent: inserts at the cursor, or indents every selected line", () => {
  assert.equal(E.apply("ab", E.indent("ab", 1, 1)), "a  b");
  const v = "x\ny\nz";
  const e = E.indent(v, 0, 3);
  assert.equal(E.apply(v, e), "  x\n  y\nz");
  assert.deepEqual([e.selStart, e.selEnd], [0, 7]);
});

test("outdent: removes up to two leading spaces, or nothing", () => {
  assert.equal(E.apply("    a", E.outdent("    a", 4, 4)), "  a");
  assert.equal(E.apply(" a", E.outdent(" a", 1, 1)), "a");
  assert.equal(E.outdent("a", 0, 0), null);
});

test("newline: keeps indentation and adds a level after an opening bracket", () => {
  assert.equal(E.apply("  x", E.newline("  x", 3, 3)), "  x\n  ");
  assert.equal(E.apply("if (a) {", E.newline("if (a) {", 8, 8)), "if (a) {\n  ");
  assert.equal(E.apply("f(", E.newline("f(", 2, 2)), "f(\n  ");
});
