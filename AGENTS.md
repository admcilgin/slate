# Slate — agent guide

Slate is a local whiteboard. Run it with `node server.js` and open http://localhost:4747.

**Each board is one file: `data/boards/<name>.json`.** To see what the user drew, read it. To draw, edit it. The open browser tab reloads within ~100 ms of any valid write, and your change lands on the user's undo stack. No API, no build step.

- List boards with `ls data/boards`. The file name (minus `.json`) is the board name shown in the switcher and in the URL (`http://localhost:4747/#<name>`).
- Create a board by writing a new file; it appears in the switcher immediately. An empty board is `{"items":[\n]}`.
- Names: letters, digits, spaces, `-` and `_`, up to 60 characters. Other files are ignored.
- If the user doesn't say which board, ask or use the one they most recently changed (`ls -t data/boards`). Don't delete or rename board files unless asked.

## Two ways in

- **Inside this folder:** edit `data/boards/<name>.json` directly, following the rules below.
- **From anywhere else:** use the CLI, `node <slate>/cli.js`. It needs no browser and no running server, validates what you write, and keeps the file format right. Run it with no arguments for the command list: `status`, `boards`, `show`, `new`, `add`, `set`, `rm`, `rm-board`, `asset`, `cards`, `move`, `selection`, `wait`, `shot`, `pdf`, `html`, `start`, `stop`.

A running server records its port in `data/.server.json` (`{port, pid, url}`); `cli.js status` reports it, along with where the boards are. The default is http://localhost:4747, changed with `PORT=`. You only need the server so a human can look at the board.

`node cli.js install` installs a Claude Code skill (`skills/slate/SKILL.md`) into `~/.claude/skills/slate`, so agents in other projects know Slate exists and how to drive it.

## Seeing the board and being pointed at things

- **`node cli.js shot <board> [id]`** writes a PNG to `data/shots/` and prints its path; read that image. Use it to look at what the user drew by hand (freehand strokes are only numbers in the file), to read a sketch or wireframe, and to check your own layout after writing: items whose height grows with their content are taller on screen than the `h` in the file. With an `id` it captures that item, or that frame with everything inside it. Needs Chrome, Chromium, Edge or Brave on the machine (`CHROME=/path` to point at one).
- **`node cli.js selection`** prints the items the user has selected in the open tab. When they say "this", "these" or "the selected ones", that is what they mean. `at` is when the selection last changed; it can be stale if the tab is closed.
- **`node cli.js wait <board>`** blocks until the user changes the board and has paused for 3 seconds (`--quiet=<s>`), then prints `added`, `changed` (each with a `was` holding the old values), `removed` and `selected`. Use it when the user wants to direct you from the board: they circle something, drop a note saying what to do, drag a card to another column, and you act on it and wait again. Pass `--timeout=<s>` below your shell's own limit; on timeout it prints `{"timeout":true}` and you can call it again.
- `pdf <board> [id]` and `html <board>` write a file to hand to someone: a vector PDF, or one self-contained HTML page with the board and its local media inside that opens in any browser without Slate. Both take `--out=<file>`.

## Working from a kanban

A kanban can be the user's task queue for you. `node cli.js cards <board>` lists every card with its column, title and detail. When asked to work the board (or a card):

1. Pick the card the user named, or the first card of the first column. Read its detail: that is the brief.
2. Before starting, `node cli.js move <board> "<card title>" "<in-progress column>"` so the user sees it has been taken. Columns are matched by title, so use the board's own names (`Doing`, `In progress`, `Yapılıyor`…).
3. Do the work. When it is finished and checked, `move` the card to the done column, with `--note="<one line on what was done>"` if that helps.
4. If you cannot finish it, leave it where it is (or move it back) with a `--note` saying what is blocking. Never move a card to done for work you did not complete.

Use `move` rather than rewriting `columns` with `set`: it re-reads the board at the moment of the move, so a card the user dragged meanwhile is not lost. To take cards as the user adds them, loop on `wait`.

## Rules for writing

- Keep the file valid JSON. Invalid writes are ignored until fixed.
- Keep the layout: `{"items":[` then **one item per line**, then `]}`. Use line-level edits for small changes; the file may contain long freehand strokes you don't need to read in full.
- Never drop or rewrite items you weren't asked to change. Re-read the file right before writing: the user may have edited it since you last looked.
- Every item needs a unique string `id` (any readable slug, e.g. `"roadmap-q1"`). Later items draw on top of earlier ones.
- Media files go in `data/assets/` and are referenced as `/assets/<filename>`.

## Coordinates

Pixels on an infinite canvas, `x` right and `y` down, any range including negatives. `x`,`y` is the item's top-left; `w`,`h` its size. A comfortable grid is 20–30 px gaps between items. Omitted fields fall back to the defaults below.

## Item types

Common fields on every item: `id`, `type`, `x`, `y`, `w`, `h`, and optional `color` (any CSS color; omit for the default ink, which adapts to dark mode), `group`, `locked` and `href`.

- `group`: any string. Items sharing the same `group` are selected and moved together in the UI. Use it to tie a screenshot to its pins and notes.
- `href`: turns the item into a link, shown as a small ↗ badge on it. Either a web address, or `"#board"` / `"#board/item-id"` to jump to another board (and centre on an item there). Use it to connect an overview board to detail boards.
- `locked`: true pins an item in place in the UI (no move, edit or delete until the user unlocks it). Good for a background screenshot. Don't change or remove items the user has locked unless asked.

| type | fields | default size | notes |
|---|---|---|---|
| `text` | `text` | 240×28 | Height grows with content. `color` is the text color. |
| `note` | `text` | 200×200 | Sticky note. `color` tints the paper (default `#ffcc00`). |
| `shape` | `shape`: `"rect"` \| `"ellipse"` \| `"diamond"`, `text`, `fill`: bool, `dash`: bool | 160×100 | `color` is the border; `fill` adds a light tint of it; `dash` makes the border dashed. Text is centered by default. In a flowchart use `diamond` for decisions and make it about 170×110 so the text fits. |
| `line` | `points`: `[[x,y],…]`, `arrow`: true \| `"both"`, `width`: 2 \| 4 \| 8, `dash`: bool, `elbow`: bool, `label`, `from`, `to` | from points | Points are **relative to the item's `x`,`y`**. Arrowhead sits on the last point. More than two points makes a polyline. `label` is short text shown on the middle of the line. Leave out `w`/`h`. `from` / `to` take the `id` of another item and attach that end to it: Slate aims the end at the item's edge and keeps it there when the item moves, so with both set you can omit `points`. `arrow`: `"both"` puts a head on each end. `elbow`: true draws a two-point line as a right-angled route, the usual look for flowcharts; with `from` and `to` set it leaves and enters through the middle of the facing sides (Slate may rewrite the value to `"h"` or `"v"`, the direction of the first leg). |
| `draw` | `points`, `width`, `dash` | from points | Freehand stroke, same point rules as `line`, rendered smoothed. |
| `code` | `title`, `text` | 340×60 | Monospace block for code, endpoints and JSON responses, with syntax colouring and a copy button. Set `collapsed`: true to show only the first 6 lines of a long block. `title` is an optional header such as `"GET /api/users → 200"`. `text` is a string, or put a raw JSON object/array there and Slate pretty-prints it. Height grows. |
| `pin` | `text` | 28×28 | Round numbered marker for calling out spots on a screenshot. `text` is the number or letter; `color` fills it (default red). Pair each pin with a `text`/`note`/`code` item that starts with the same number. |
| `image` | `src`, `alt` | 320×220 | `src` is `/assets/…` or an http(s) URL. Set `h` to match the aspect ratio. |
| `video` | `src` | 400×225 | Local file in `/assets/` or a direct video URL. For YouTube/Vimeo use `embed`. |
| `embed` | `url` | 480×300 | Iframe. YouTube, Vimeo, Loom and Figma share links are converted to their embed form automatically. Many ordinary sites refuse iframes; use `link` for those. |
| `link` | `url`, `title` | 300×62 | Link card. `title` defaults to the hostname. |
| `table` | `rows`: `[["a","b"],["c","d"]]` | 380×110 | First row is the header. All rows must have the same length. Height grows. |
| `tasks` | `title`, `tasks`: `[{"text","done","due"}]` | 260×90 | `due` is optional `YYYY-MM-DD`; overdue open tasks show red. Height grows. |
| `chart` | `chart`: `"bar"` \| `"line"` \| `"pie"`, `title`, `data`: `[{"label","value"}]` | 340×240 | One series. `color` sets the bar/line color; pie slices use a built-in palette. |
| `timeline` | `title`, `events`: `[{"date","label"}]` | 560×170 | `date` as `YYYY-MM-DD` positions events proportionally; non-date strings are spaced evenly. Give ~140 px of width per event. |
| `frame` | `title` | 640×400 | A named, dashed region for a section of the board. Items lying fully inside its rectangle move with it in the UI, and it can be exported on its own. Put it **before** its contents in `items` so it draws behind them, and leave ~40 px of padding around the contents. To add something "to a frame", place it inside the frame's rectangle; there is no parent field. |
| `stat` | `label`, `value`, `delta` | 200×112 | Metric card: small label, big value, optional change such as `"+12%"`. `value` and `delta` are strings. A `delta` starting with `+` shows green, with `-` red. `color` tints the value. |
| `callout` | `title`, `text` | 300×64 | Boxed remark with a coloured stripe on the left. `color` sets the stripe and tint: blue for info (default), orange for a warning, red for a risk, green for a decision. Height grows. |
| `kanban` | `columns`: `[{"title","cards":["text",…]}]` | 600×150 | Columns of plain-text cards; the user drags cards between columns. A card's first line is its title; any further lines (`\n`) are its detail, shown smaller under it. Give ~200 px of width per column. Height grows. |

Text styling for `text`, `note`, `shape` and the text cards (`tasks`, `table`, `callout`, `kanban`, `stat`, `code`, `link`): `size` (px; the UI offers 13, 15, 24, 40), `bold`, `italic`, `align` (`"left"` \| `"center"` \| `"right"`). On a card the style applies to the whole card, with titles and captions scaled along; on `tasks`, `table`, `kanban`, `code` and `link`, `color` is the text colour. Text is plain; `\n` makes a line break. There is no rich text or markdown inside items.

Palette the UI offers (use these to stay consistent): `#8e8e93` gray, `#ff3b30` red, `#ff9500` orange, `#ffcc00` yellow, `#34c759` green, `#007aff` blue, `#af52de` purple.

## Examples

```json
{"id":"h1","type":"text","x":80,"y":40,"w":500,"text":"Launch plan","size":40,"bold":true}
{"id":"risk","type":"note","x":80,"y":120,"text":"Pricing page is not localized","color":"#ff9500"}
{"id":"a","type":"shape","x":320,"y":120,"shape":"rect","text":"Design","color":"#007aff","fill":true}
{"id":"a-b","type":"line","x":488,"y":170,"points":[[0,0],[64,0]],"arrow":true}
{"id":"sprint","type":"tasks","x":80,"y":360,"title":"This week","tasks":[{"text":"Ship paywall copy","done":false,"due":"2026-11-20"}]}
{"id":"mrr","type":"chart","x":360,"y":360,"chart":"line","title":"MRR","data":[{"label":"Sep","value":1200},{"label":"Oct","value":1850}]}
```

To connect two items, add `{"type":"line","from":"<id A>","to":"<id B>","arrow":true}`. No coordinates needed; the arrow follows both items.

To annotate a screenshot, place the `image`, then either:
- drop numbered `pin`s on the spots and put matching numbered notes beside the image (cleanest when there are many callouts), or
- add a `line` with `arrow` whose first point is the spot on the image (give `x`,`y` and `points`) and whose `to` is the `text`, `note` or `code` item holding the detail — the flow, the endpoint, or the response JSON.

Give the image, its pins and its notes the same `group` so the user can move the whole annotated screen as one.

## What Slate cannot do

Nested groups, rich text, multi-series charts, rotation, real-time multi-user editing. Don't write fields or types not listed here; unknown types render as a placeholder.

## Code map

- `lib.js` — board paths, naming and file format, and the single-file HTML export, shared by the server and the CLI.
- `cli.js` — command-line access to boards for agents and scripts.
- `server.js` — static files, `GET /api/boards`, `GET/PUT/DELETE /api/board?b=<name>`, `POST /api/upload`, `GET /api/events` (live reload), `PUT /api/cursor` (the tab's selection, kept in `data/.cursor.json`), `GET /api/export?b=<name>` (the shared HTML file). Listens on 127.0.0.1 only.
- `public/app.js` — canvas, tools, one renderer per item type in `R`, defaults in `DEF`. Adding a type means one entry in each, plus a row in the table above.
- `public/style.css`, `public/index.html` — look and chrome.
