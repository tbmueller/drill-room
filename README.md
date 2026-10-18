# Drill Room

A local judge for timed coding practice. The problem is on
the left and the editor on the right. **Run** checks the sample cases and shows
expected versus actual output; **Submit** runs hidden cases and only tells you
which ones passed. There's a 10/15/30/60-minute timer. Write your solution in
TypeScript, Python or Ruby.

The problems come from a **pack**: a folder of drills you write yourself (or
get from someone else). Keep your packs, and your solutions, wherever you like,
including a private repo. A drill can have several **parts** that unlock one at
a time, each building on the last. Drill Room ships with a three-drill
example pack, including a two-part one.

```bash
git clone https://github.com/tbmueller/drill-room.git
cd drill-room
npm start                              # the example pack
node room/server.mjs --pack ~/my-pack  # your own pack
# then open http://localhost:4321
```

- **Needs:** Node 22.13+ (it strips TypeScript types itself; there's nothing to
  `npm install`), plus `python3` and `ruby` on your PATH for those languages.
- **Run** shows each sample's input, the expected output, your output, and
  anything you printed (`console.log` / `print` / `puts`).
- **Submit** runs the hidden cases and reports pass/fail per case (plus the
  error type if your code crashed). Hidden cases never leave the server.
- **Limits:** 5 seconds per run, then it's stopped as "time limit exceeded".
- **Saving:** your code autosaves in the browser as you type. **Save**
  (Ctrl/Cmd+S), Run and Submit also write it to the pack's
  `solutions/<language>/<drill>.<ext>`, with a header recording its status
  (passed, or in progress with the score), best submit, first-passed date and
  last-saved time. `solutions/README.md` is a summary table and
  `solutions/progress.json` keeps the history. If a browser has no copy, the
  page loads your saved one.
- **Shortcuts:** Ctrl/Cmd+S saves, Ctrl/Cmd+Enter runs, Ctrl/Cmd+Shift+Enter
  submits, Alt/Option+Up/Down moves the line (or selected lines), and Tab and
  Shift+Tab indent. Undo works for all of them.
- **Plain characters:** the editor shows `===`, `=>` and `!=` as typed, with no
  font ligatures.
- **Safety:** the server only listens on localhost, because it runs whatever
  code you paste. Don't expose it.

Overrides: `PORT=5000`, `DRILLROOM_PACK=~/my-pack` (same as `--pack`),
`PYTHON=python3.12`, `RUBY=/path/to/ruby`.

## Writing a pack

```
my-pack/
  pack.json                        optional: title, languages, notes, drill order
  drills/
    01-two-sum/
      drill.json                   title, difficulty, time, tags, what to call
      problem.md                   the statement, in Markdown
      starter.ts                   starter code, one file per language
      starter.py
      starter.rb
      visible.json                 sample cases (shown with expected output)
      hidden.json                  hidden cases (or hidden.b64, see below)
      adapter.mjs                  optional, per language: custom call logic
      adapter.py
      adapter.rb
      checker.mjs                  optional: accepts any valid answer
  solutions/                       written by Drill Room; commit it to keep your work
```

Drills appear in folder-name order (so number them), unless `pack.json` lists
or groups them. Look at [`examples/starter-pack`](examples/starter-pack) for a complete
example of each piece.

### pack.json

```json
{
  "title": "Graphs week",
  "languages": ["typescript", "python"],
  "notes": { "python": "Python: use the snake_case names from the starter." },
  "folders": ["drills", "problems"],
  "groups": [
    { "title": "Problems", "drills": ["islands-and-bridges"] },
    { "title": "Warm-ups", "drills": ["01-two-sum", "02-islands"] }
  ]
}
```

Every field is optional. `languages` defaults to all three; `notes` shows a
line above the statement for that language; `folders` lists where drill folders
live (default `["drills"]`). `groups` sorts drills into labelled sections of
the drill menu, numbered within each group; `"drills": [...]` instead picks and
orders them without groups; with neither, every drill folder is used. Your browser drafts are
stored per pack under the pack folder's name, or under `"key"` if you set one.

### drill.json

```json
{
  "title": "Two sum",
  "difficulty": "Easy",
  "time": "~10 min",
  "tags": ["Hashing"],
  "call": { "typescript": "twoSum", "python": "two_sum", "ruby": "two_sum" },
  "args": ["nums", "target"]
}
```

`call` names the function (or class) your solution defines, per language. A
plain string uses the same name everywhere. `args` lists which keys of each
case's `args` to pass, in order, so the case `{"args": {"nums": [2, 7], "target": 9}}`
becomes `twoSum([2, 7], 9)`. An entry like `{"value": 2}` passes that fixed
value instead. `difficulty`, `time` and `tags` show as chips under the title.

Also optional: `languages` (a subset of the pack's, for a drill that only
comes in some), `timer` (the default timer in minutes when the drill opens),
`statement` (the statement file, default `problem.md`), and `checker` (see
below).

### Multi-part drills

List the parts in `drill.json`. Each part can call a different function, or
inherit `call` and `args` from the drill:

```json
{
  "title": "Word counts",
  "timer": 30,
  "parts": [
    { "call": "countWords", "args": ["text"] },
    { "call": "topWords", "args": ["text", "k"] }
  ]
}
```

- **Statement:** one `## Part N` section per part (any word works: `## Task 2`,
  `## Requirement 3`). Text before part 1 is the introduction. `##` sections
  after the last part are notes. A note's list item that starts with `(Part N)`
  stays hidden until part N unlocks.
- **Cases:** `visible.json` and the hidden file map part numbers to lists:
  `{"1": [...], "2": [...]}`. A part can have no visible cases.
- **Unlocking:** part 1 is open from the start. Each later part opens once
  every hidden test of the part before it has passed, in any language. Until
  then the page doesn't show its statement or its tagged notes.
- **Submit** on part N runs the hidden tests of parts 1 to N and scores each
  one, so a change that breaks an earlier part shows up.
- **Saving:** one solution file per drill holds every part, and its header
  tracks how many parts pass.

See `examples/starter-pack/drills/03-word-counts` for a complete one.

### Cases

`visible.json` and `hidden.json` each hold a list of
`{"args": {...}, "expected": ...}` (a single object works for one case).
An answer passes when it equals `expected` as JSON: object key order doesn't
matter, list order does. Tuples, Sets and symbol keys are converted first, so
a Python tuple or a Ruby symbol-keyed hash compares like the JSON it would
produce.

To keep hidden cases from spoiling themselves in search results or a diff,
store them as `hidden.b64` instead: the same JSON, base64-encoded
(`base64 -w 76 hidden.json > hidden.b64`). It's an honor system, not security.

### Adapters

When a drill is more than "call a function with these arguments" (a class you
drive with a sequence of operations, or a check that the input wasn't
modified), add an adapter for each language. It gets the function or class
named in `call`, plus the case's `args`, and returns the answer to compare:

```js
// adapter.mjs (TypeScript solutions)
export default function adapt(MinStack, args) { /* ... */ }
```

```python
# adapter.py
def adapt(MinStack, args): ...
```

```ruby
# adapter.rb
def drill_room_adapt(min_stack, args) ... end
```

Errors an adapter raises show up as that case's error, so a check like "don't
modify the input" can explain itself.

### Checkers

For a drill with many right answers, `"checker": "checker.mjs"` in drill.json
(or on one part) replaces the comparison with `expected`. The module's default
export gets the case's `args` and the solution's answer, and returns true when
the answer is valid:

```js
export default function check(args, got) { /* ... */ return true; }
```

### Statements

`problem.md` is the statement, minus the title (that comes from
`drill.json`). The renderer covers what statements need: headings,
paragraphs, lists (nested one level), tables, fenced code blocks,
`inline code`, **bold**, *italics* and links. A leading `# Title` line is
ignored, so a README can double as the statement. HTML is shown as typed rather than rendered, so `<id>` needs no escaping.

## Development

```bash
npm test     # node --test test/*.test.mjs; the Python and Ruby tests skip if those aren't installed
```

No dependencies. The room is `room/server.mjs` (HTTP) over `room/lib.mjs`
(judging and saving), `room/pack.mjs` (loading packs), `room/markdown.mjs`
and `room/editor.js` (the editor's key handling, shared by the page and the
tests). Each language has a small runner in `room/runners/` that loads the
solution, calls it once per case and prints the results.

## License

MIT
