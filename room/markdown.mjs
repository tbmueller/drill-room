// A small Markdown renderer for problem statements, so packs need no dependencies.
//
// Supported: # headings, paragraphs, - / * / 1. lists (nested one level), ``` fenced
// code, | tables |, `inline code`, **bold**, *italic* / _italic_, [links](https://...)
// and backslash escapes. Raw HTML is not passed through: every character is escaped, so a
// statement can show <angle brackets> as typed.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);

// Characters a backslash can escape. They're swapped for placeholders before the
// emphasis rules run, then put back as literal text.
const ESCAPABLE = "\\`*_[]()#+-.!>";

export function inline(text) {
  // An escaped backtick never opens a code span; hold it aside while splitting.
  const src = text.replace(/\\`/g, "\u0001");
  // Code spans become placeholders first: nothing inside backticks is formatted,
  // but **bold around `code`** still works.
  const codes = [];
  const held = src.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (m, ticks, body) =>
    `\u0002${codes.push(`<code>${escapeHtml(body.replace(/^ (.*) $/, "$1"))}</code>`) - 1}\u0002`);
  return formatText(held).replace(/\u0002(\d+)\u0002/g, (m, n) => codes[Number(n)]).replace(/\u0001/g, "`");
}

function formatText(text) {
  const held = [];
  const hold = (html) => `\u0000${held.push(html) - 1}\u0000`;
  let s = text.replace(/\\(.)/g, (m, c) => (ESCAPABLE.includes(c) ? hold(escapeHtml(c)) : m));
  s = escapeHtml(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) =>
    /^(https?:|mailto:)/i.test(url) ? hold(`<a href="${url}">${label}</a>`) : m);
  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__(?=\S)([\s\S]*?\S)__/g, "<strong>$1</strong>");
  s = s.replace(/\*(?=\S)([^*]*?\S)\*/g, "<em>$1</em>");
  s = s.replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (m, n) => held[Number(n)]);
}

const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const ROW = /^\s*\|.*\|\s*$/;
const SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function cells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").replace(/\\\|/g, "\u0003").split("|").map((c) => c.trim().replace(/\u0003/g, "|"));
}

function renderList(list) {
  const items = list.items.map((it) => `<li>${inline(it.text)}${it.sub ? renderList(it.sub) : ""}</li>`).join("");
  return `<${list.tag}>${items}</${list.tag}>`;
}

export function render(md) {
  const lines = String(md).replace(/\r\n?/g, "\n").split("\n");
  const html = [];
  let para = [];
  let list = null; // { tag, items: [{ text, sub: { tag, items } | null }] }

  const flushPara = () => {
    if (para.length) html.push(`<p>${inline(para.join("\n"))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) html.push(renderList(list));
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+-]*)\s*$/);
    if (fence) {
      flushPara(); flushList();
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      const cls = fence[2] ? ` class="language-${escapeHtml(fence[2])}"` : "";
      html.push(`<pre><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    if (ROW.test(line) && i + 1 < lines.length && SEPARATOR.test(lines[i + 1])) {
      flushPara(); flushList();
      const head = cells(line);
      const rows = [];
      i += 2;
      while (i < lines.length && ROW.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      html.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      flushPara(); flushList();
      const n = heading[1].length;
      html.push(`<h${n}>${inline(heading[2])}</h${n}>`);
      continue;
    }
    const item = line.match(ITEM);
    if (item && (!list || item[1].length < 2 || !list.items.length)) {
      flushPara();
      const tag = /\d/.test(item[2]) ? "ol" : "ul";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push({ text: item[3], sub: null });
      continue;
    }
    if (item && list) {
      // An indented item inside a list nests under the item above it.
      const parent = list.items[list.items.length - 1];
      const tag = /\d/.test(item[2]) ? "ol" : "ul";
      if (!parent.sub) parent.sub = { tag, items: [] };
      parent.sub.items.push({ text: item[3], sub: null });
      continue;
    }
    if (!line.trim()) {
      flushPara(); flushList();
      continue;
    }
    // An indented line right after a list item continues that item.
    if (list && /^\s+\S/.test(line)) {
      const last = list.items[list.items.length - 1];
      const target = last.sub ? last.sub.items[last.sub.items.length - 1] : last;
      target.text += "\n" + line.trim();
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return html.join("\n");
}
