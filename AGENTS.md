# Slate — agent guide

Slate is a local whiteboard. Run it with `node server.js` and open http://localhost:4747.

**Each board is one file: `data/boards/<name>.json`.** To see what the user drew, read it. To draw, edit it. The open browser tab reloads within ~100 ms of any valid write, and your change lands on the user's undo stack. No API, no build step.

- List boards with `ls data/boards`. The file name (minus `.json`) is the board name shown in the switcher and in the URL (`http://localhost:4747/#<name>`).
- Create a board by writing a new file; it appears in the switcher immediately. An empty board is `{"items":[\n]}`.
- Names: letters, digits, spaces, `-` and `_`, up to 60 characters. Other files are ignored.
- If the user doesn't say which board, ask or use the one they most recently changed (`ls -t data/boards`). Don't delete or rename board files unless asked.

## Two ways in

- **Inside this folder:** edit `data/boards/<name>.json` directly, following the rules below.
- **From anywhere else:** use the CLI, `node <slate>/cli.js`. It needs no browser and no running server, validates what you write, and keeps the file format right. Run it with no arguments for the command list: `status`, `boards`, `show`, `new`, `add`, `set`, `rm`, `rm-board`, `asset`, `start`, `stop`.

A running server records its port in `data/.server.json` (`{port, pid, url}`); `cli.js status` reports it, along with where the boards are. The default is http://localhost:4747, changed with `PORT=`. You only need the server so a human can look at the board.

`node cli.js install` installs a Claude Code skill (`skills/slate/SKILL.md`) into `~/.claude/skills/slate`, so agents in other projects know Slate exists and how to drive it.

## Rules for writing

- Keep the file valid JSON. Invalid writes are ignored until fixed.
- Keep the layout: `{"items":[` then **one item per line**, then `]}`. Use line-level edits for small changes; the file may contain long freehand strokes you don't need to read in full.
- Never drop or rewrite items you weren't asked to change. Re-read the file right before writing: the user may have edited it since you last looked.
- Every item needs a unique string `id` (any readable slug, e.g. `"roadmap-q1"`). Later items draw on top of earlier ones.
- Media files go in `data/assets/` and are referenced as `/assets/<filename>`.

## Coordinates

Pixels on an infinite canvas, `x` right and `y` down, any range including negatives. `x`,`y` is the item's top-left; `w`,`h` its size. A comfortable grid is 20–30 px gaps between items. Omitted fields fall back to the defaults below.

## Item types

Common fields on every item: `id`, `type`, `x`, `y`, `w`, `h`, and optional `color` (any CSS color; omit for the default ink, which adapts to dark mode).

| type | fields | default size | notes |
|---|---|---|---|
| `text` | `text` | 240×28 | Height grows with content. `color` is the text color. |
| `note` | `text` | 200×200 | Sticky note. `color` tints the paper (default `#ffcc00`). |
| `shape` | `shape`: `"rect"` \| `"ellipse"`, `text`, `fill`: bool | 160×100 | `color` is the border; `fill` adds a light tint of it. Text is centered by default. |
| `line` | `points`: `[[x,y],…]`, `arrow`: bool, `width`: 2 \| 4 \| 8, `label`, `from`, `to` | from points | Points are **relative to the item's `x`,`y`**. Arrowhead sits on the last point. More than two points makes a polyline. `label` is short text shown on the middle of the line. Leave out `w`/`h`. `from` / `to` take the `id` of another item and attach that end to it: Slate aims the end at the item's edge and keeps it there when the item moves, so with both set you can omit `points`. |
| `draw` | `points`, `width` | from points | Freehand stroke, same point rules as `line`, rendered smoothed. |
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

Text styling for `text`, `note` and `shape`: `size` (px; the UI offers 13, 15, 24, 40), `bold`, `italic`, `align` (`"left"` \| `"center"` \| `"right"`). Text is plain; `\n` makes a line break. There is no rich text or markdown inside items.

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

## What Slate cannot do

Links between boards, grouping or frames (pins and free arrow ends don't move with an image), rich text, multi-series charts, rotation, real-time multi-user editing. Don't write fields or types not listed here; unknown types render as a placeholder.

## Code map

- `lib.js` — board paths, naming and file format, shared by the server and the CLI.
- `cli.js` — command-line access to boards for agents and scripts.
- `server.js` — static files, `GET /api/boards`, `GET/PUT/DELETE /api/board?b=<name>`, `POST /api/upload`, `GET /api/events` (live reload). Listens on 127.0.0.1 only.
- `public/app.js` — canvas, tools, one renderer per item type in `R`, defaults in `DEF`. Adding a type means one entry in each, plus a row in the table above.
- `public/style.css`, `public/index.html` — look and chrome.
