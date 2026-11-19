---
name: slate
metadata:
  version: "3"
description: Read and edit the user's Slate whiteboard boards from any project. Use when the user mentions Slate, their whiteboard or board ("put this on my board", "add to the board", "what's on my board", "tahtaya ekle", "boarda yaz"), or asks to lay out a diagram, flow, screen annotation, endpoint or JSON response, task list, kanban board, metric cards, callouts, table, chart, timeline or notes visually, or to start a new board for a project or topic ("yeni pano aç", "bu proje için board oluştur"). Works without opening the app or running its server.
---

# Slate

Slate is the user's local whiteboard, installed at `{{SLATE}}`. Each board is a JSON file in `{{SLATE}}/data/boards/`. You work on boards with the CLI below. Nothing has to be open: the CLI edits the files directly, and if the user does have a board open in the browser it updates by itself within a fraction of a second.

Run every command as `slate <command>`. If the shell cannot find `slate`, use `node {{SLATE}}/cli.js <command>` instead.

## Commands

| Command | What it does |
|---|---|
| `status` | Where Slate lives, the boards, the server URL if running, under `web` the web copy that last opened them (`open`: a tab has them now), and under `skills` whether each agent's Slate skill is current |
| `boards` | Boards with item counts |
| `map <board> [frame]` | **Read the board here first.** One line per item: `id type x,y wxh "text" style`, nested under its frame; arrows as `a -> b "label"`; where the free space is. Heights are the rendered ones |
| `show <board> [id…]` | Full JSON of items, one per line. Ids narrow it; a frame id brings its contents. Use it before a `set` that needs the current field values |
| `types` | Every item type with its fields, default size and the palette (~500 tokens). Run it once before your first `add` |
| `new <board>` | Create an empty board |
| `add <board> '<json>'` | Add one item or an array. `--at=below\|right\|<frame id>`: coordinates in the batch are relative (start at 0,0) and the CLI puts it in free space or inside that frame (the frame grows). Prints the ids and `warn` |
| `copy <board> <id…>` | Duplicate items with new ids (`id-2`); a frame brings its contents and arrows. `--to=<board>`, `--at=` as in `add` |
| `mermaid <board> '<flowchart>'` | Mermaid `flowchart` → shapes and arrows (or a file, or `-`). Quickest way to a flow or architecture diagram. `--at=` as in `add` |
| `set <board> <id> '<json>'` | Merge fields into an item. `null` removes a field |
| `rm <board> <id> [id…]` | Delete items |
| `rm-board <board>` | Delete a board (only when the user asks) |
| `asset <file>` | Copy an image or video into Slate; prints the `src` to use |
| `cards <board>` | Every kanban card: column, title and detail |
| `move <board> "<card>" "<column>"` | Move a kanban card by title. `--note="…"` adds a line to its detail |
| `selection` | The items the user has selected in the open tab: what "this" or "these" means |
| `wait <board> --timeout=<s>` | Block until the user changes the board; prints added, changed (with `was`), removed, selected |
| `shot <board> [id]` | PNG of the board, an item or a frame, to look at. Only for freehand sketches, screenshots, or when `map` is not enough |
| `pdf <board> [id]` / `html <board>` | A PDF, or one self-contained HTML file, to give to someone. `--out=<file>` |
| `use [folder\|default]` | Keep boards in another folder, or back in Slate's own `data/` |
| `start` / `stop` | Start the server in the background and print the URL, or stop it |

For large or quote-heavy JSON, pipe it: `slate add main - <<'JSON' … JSON`. Board names with spaces need quoting. Output is one-line JSON.

## How to work

1. **Find the board.** `status`. If the boards the user means are not listed, they may keep them in a folder of their own: ask for its path and run `use <folder>` once. If they didn't name a board and there are several, ask, or `new "<topic>"` when the work is its own topic.
2. **Read with `map`, not a screenshot.** It gives ids, positions, rendered sizes, text, frames, arrows and free space in a few tokens. `show <board> <id>` only for the full fields of what you will change.
3. **Write in one call, relative, and let the CLI place it.** Build the whole layout as an array starting at 0,0, give every item a readable id (`"login-api"`) and explicit relative `x`/`y`, and send it with `add --at=below` (or `right`, or a frame id). Lay items out on a grid: 20–40 px gaps, shapes 160×100, notes 200×200 (see `types`).
4. **Read the reply.** `warn` lists overlaps, items crossing a frame's edge, unknown fields and lines to missing ids. Fix them with `set` (move `x`/`y`) until there is no `warn`. No screenshot needed.
5. **Change with `set`, not delete-and-add**; it keeps the id. To change a list (`tasks`, `rows`, `data`, `events`, `columns`), `set` the whole array. Duplicate a section with `copy`.
6. **Tell the user where to look.** `new` and `add` print `url`. If it is null, give `https://admcilgin.github.io/slate/#<board>` (Chrome, Edge or Brave; the first time it asks for a folder: `{{SLATE}}/data`). Run `start` only if they want the local copy. You never need the server yourself.
7. **Let the user point.** "this" / "the selected ones" → `selection`. "Watch the board" → loop on `wait <board> --timeout=<s>` and act on what they added or changed. Freehand strokes (`draw`) are only numbers: `shot` to see them.
8. **Work a kanban like a task queue.** `cards`, `move` the card to the in-progress column before starting, to done only when finished and checked; if stuck, leave it with `--note="<what blocks>"`. Use `move`, not `set` on `columns`.

## Rules

- Change only what the user asked for. Never remove or rewrite items you didn't create in this task unless asked; leave `locked` items alone.
- The user may be editing the same board: `map` or `show` again before a `set` or `rm` if time has passed.
- Images and videos go through `asset` (or are http(s) URLs).
- Arrows: `{"type":"line","from":"<id>","to":"<id>","arrow":true}` needs no coordinates and follows the items. Add `"elbow":true` in flowcharts, `"label"` for yes/no.
- A `frame` is a region, not a parent: an item is "in" it when it lies fully inside. Put the frame first in the array, contents after, ~40 px padding and 60 px at the top. `add --at=<frame id>` does this for you.

## Layouts to copy

Each is a batch at relative 0,0: send it with `add <board> --at=below - <<'JSON'`, change the texts and ids.

Project start (title, work, numbers, open decision):
```json
[{"id":"p-title","type":"text","x":0,"y":0,"w":600,"text":"Project","size":40,"bold":true},
{"id":"p-work","type":"kanban","x":0,"y":80,"w":620,"columns":[{"title":"To do","cards":["First task\ndetail"]},{"title":"Doing","cards":[]},{"title":"Done","cards":[]}]},
{"id":"p-users","type":"stat","x":660,"y":80,"label":"Users","value":"0","delta":"+0%"},
{"id":"p-rev","type":"stat","x":880,"y":80,"label":"Revenue","value":"$0"},
{"id":"p-open","type":"callout","x":660,"y":220,"w":420,"title":"Open decision","text":"…","color":"#ff9500"}]
```

Section with a flow (or use `mermaid` for anything bigger than four boxes):
```json
[{"id":"s-frame","type":"frame","x":0,"y":0,"w":680,"h":220,"title":"Checkout"},
{"id":"s-a","type":"shape","x":40,"y":60,"text":"Cart","color":"#007aff","fill":true},
{"id":"s-b","type":"shape","shape":"diamond","x":240,"y":55,"w":170,"h":110,"text":"Paid?"},
{"id":"s-c","type":"shape","x":470,"y":60,"text":"Receipt","color":"#34c759","fill":true},
{"id":"s-ab","type":"line","from":"s-a","to":"s-b","arrow":true},
{"id":"s-bc","type":"line","from":"s-b","to":"s-c","arrow":true,"label":"yes"}]
```

Endpoint with request and response:
```json
[{"id":"ep","type":"shape","x":0,"y":0,"w":200,"h":80,"text":"POST /api/login","color":"#af52de","fill":true},
{"id":"ep-req","type":"code","x":240,"y":0,"w":340,"title":"Request","text":{"email":"…","password":"…"}},
{"id":"ep-res","type":"code","x":620,"y":0,"w":340,"title":"200","text":{"token":"…","user":{"id":42}}},
{"id":"ep-1","type":"line","from":"ep","to":"ep-req","arrow":true},
{"id":"ep-2","type":"line","from":"ep-req","to":"ep-res","arrow":true}]
```

Annotated screenshot (`slate asset ./login.png` first; one group so it moves as one):
```json
[{"id":"shot","type":"image","x":0,"y":0,"w":360,"h":640,"src":"/assets/<from asset>","group":"login"},
{"id":"pin1","type":"pin","x":160,"y":480,"text":"1","group":"login"},
{"id":"n1","type":"note","x":400,"y":440,"w":240,"h":120,"text":"1  Submit calls POST /api/login","group":"login"}]
```
