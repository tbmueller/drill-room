// Drill Room editor helpers: pure functions over (text, selection) that return
// an edit { start, end, text, selStart, selEnd } to apply, or null for "no change".
// Loaded by the page as a plain script (window.DrillEditor) and by the tests via require.
(function (root) {
  "use strict";

  var INDENT = "  ";

  function lineStartOf(value, pos) {
    return value.lastIndexOf("\n", pos - 1) + 1;
  }

  // Alt/Option + Up/Down: move the line holding the cursor, or every line the
  // selection touches, one line up (dir = -1) or down (dir = 1).
  function moveLines(value, selStart, selEnd, dir) {
    var endAdj = (selEnd > selStart && value[selEnd - 1] === "\n") ? selEnd - 1 : selEnd;
    var start = lineStartOf(value, selStart);
    var end = value.indexOf("\n", endAdj);
    if (end === -1) end = value.length;
    var block = value.slice(start, end);
    if (dir < 0) {
      if (start === 0) return null;
      var prevStart = lineStartOf(value, start - 1);
      var prev = value.slice(prevStart, start - 1);
      var up = prev.length + 1;
      return { start: prevStart, end: end, text: block + "\n" + prev, selStart: selStart - up, selEnd: selEnd - up };
    }
    if (end === value.length) return null;
    var nextEnd = value.indexOf("\n", end + 1);
    if (nextEnd === -1) nextEnd = value.length;
    var next = value.slice(end + 1, nextEnd);
    var down = next.length + 1;
    return { start: start, end: nextEnd, text: next + "\n" + block, selStart: selStart + down, selEnd: selEnd + down };
  }

  // Tab: indent every selected line when the selection spans lines,
  // otherwise insert two spaces at the cursor.
  function indent(value, selStart, selEnd) {
    var start = lineStartOf(value, selStart);
    if (selStart !== selEnd && value.slice(selStart, selEnd).indexOf("\n") !== -1) {
      var block = value.slice(start, selEnd).replace(/^/gm, INDENT);
      return { start: start, end: selEnd, text: block, selStart: start, selEnd: start + block.length };
    }
    return { start: selStart, end: selEnd, text: INDENT, selStart: selStart + INDENT.length, selEnd: selStart + INDENT.length };
  }

  // Shift+Tab: remove up to two leading spaces from the cursor's line.
  function outdent(value, selStart, selEnd) {
    var start = lineStartOf(value, selStart);
    var remove = value.slice(start, start + INDENT.length) === INDENT ? INDENT.length
      : value[start] === " " ? 1 : 0;
    if (!remove) return null;
    return {
      start: start, end: start + remove, text: "",
      selStart: Math.max(start, selStart - remove), selEnd: Math.max(start, selEnd - remove),
    };
  }

  // Enter: keep the current line's indentation, and add one level after an opening bracket.
  function newline(value, selStart, selEnd) {
    var start = lineStartOf(value, selStart);
    var before = value.slice(start, selStart);
    var lead = (before.match(/^[ \t]*/) || [""])[0];
    if (/[{[(]$/.test(before.replace(/\s+$/, ""))) lead += INDENT;
    var text = "\n" + lead;
    return { start: selStart, end: selEnd, text: text, selStart: selStart + text.length, selEnd: selStart + text.length };
  }

  // Apply an edit to a string (used by the tests; the page applies edits to the textarea).
  function apply(value, edit) {
    if (!edit) return value;
    return value.slice(0, edit.start) + edit.text + value.slice(edit.end);
  }

  var api = { moveLines: moveLines, indent: indent, outdent: outdent, newline: newline, apply: apply };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DrillEditor = api;
})(typeof self !== "undefined" ? self : this);
