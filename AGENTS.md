# Slate — agent guide

Slate is a local whiteboard. Run it with `node server.js` and open http://localhost:4747.

**Each board is one file: `data/boards/<name>.json`.** To see what the user drew, read it. To draw, edit it. The open browser tab reloads within ~100 ms of any valid write, and your change lands on the user's undo stack. No API, no build step.

- List boards with `ls data/boards`. The file name (minus `.json`) is the board name shown in the switcher and in the URL (`http://localhost:4747/#<name>`).
- Create a board by writing a new file; it appears in the switcher immediately. An empty board is `{"items":[\n]}`.
- Names: letters, digits, spaces, `-` and `_`, up to 60 characters. Other files are ignored.
- If the user doesn't say which board, ask or use the one they most recently changed (`ls -t data/boards`). Don't delete or rename board files unless asked.

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
| `line` | `points`: `[[x,y],…]`, `arrow`: bool, `width`: 2 \| 4 \| 8, `label` | from points | Points are **relative to the item's `x`,`y`**. Arrowhead sits on the last point. More than two points makes a polyline. `label` is short text shown on the middle of the line. Leave out `w`/`h`. |
| `draw` | `points`, `width` | from points | Freehand stroke, same point rules as `line`, rendered smoothed. |
| `code` | `title`, `text` | 340×60 | Monospace block for code, endpoints and JSON responses, with syntax colouring. `title` is an optional header such as `"GET /api/users → 200"`. `text` is a string, or put a raw JSON object/array there and Slate pretty-prints it. Height grows. |
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

To annotate a screenshot: place the `image`, then for each callout add a `line` with `arrow` (and a short `label` if useful) from the spot on the image to a `text`, `note` or `code` item beside it holding the detail — the flow, the endpoint, or the response JSON.

To connect two items with an arrow, start the line at the first item's edge and end it at the second's: for a horizontal link from A to B at the same height, `x = A.x + A.w + 8`, `y = A.y + A.h / 2`, `points = [[0,0],[B.x - x - 8, 0]]`. Arrows are not attached to shapes, so move them together.

## What Slate cannot do

Links between boards, grouping or frames, connectors that follow shapes, rich text, multi-series charts, rotation, real-time multi-user editing. Don't write fields or types not listed here; unknown types render as a placeholder.

## Code map

- `server.js` — static files, `GET /api/boards`, `GET/PUT/DELETE /api/board?b=<name>`, `POST /api/upload`, `GET /api/events` (live reload). Listens on 127.0.0.1 only.
- `public/app.js` — canvas, tools, one renderer per item type in `R`, defaults in `DEF`. Adding a type means one entry in each, plus a row in the table above.
- `public/style.css`, `public/index.html` — look and chrome.
