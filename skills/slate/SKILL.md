---
name: slate
description: Read and edit the user's Slate whiteboard boards from any project. Use when the user mentions Slate, their whiteboard or board ("put this on my board", "add to the board", "what's on my board", "tahtaya ekle", "boarda yaz"), or asks to lay out a diagram, flow, screen annotation, endpoint or JSON response, task list, kanban board, metric cards, callouts, table, chart, timeline or notes visually, or to start a new board for a project or topic ("yeni pano aç", "bu proje için board oluştur"). Works without opening the app or running its server.
---

# Slate

Slate is the user's local whiteboard, installed at `{{SLATE}}`. Each board is a JSON file in `{{SLATE}}/data/boards/`. You work on boards with the CLI below. Nothing has to be open: the CLI edits the files directly, and if the user does have a board open in the browser it updates by itself within a fraction of a second.

Run every command as `node {{SLATE}}/cli.js <command>`.

## Commands

| Command | What it does |
|---|---|
| `status` | Where Slate lives, the list of boards, and the URL and port if the server is running |
| `boards` | Boards with item counts |
| `show <board>` | Every item on the board, one JSON object per line |
| `new <board>` | Create an empty board |
| `add <board> '<json>'` | Add one item or an array of items. Prints the new ids |
| `set <board> <id> '<json>'` | Merge fields into an item. A `null` value removes that field |
| `rm <board> <id> [id…]` | Delete items |
| `rm-board <board>` | Delete a whole board (only when the user asks) |
| `asset <file>` | Copy an image or video into Slate. Prints the `src` to use in an `image` or `video` item |
| `cards <board>` | Every kanban card with its column, title and detail (lines after the first) |
| `move <board> "<card>" "<column>"` | Move a kanban card, matched by title, to another column. `--note="…"` adds a line to its detail |
| `selection` | The items the user has selected in the open tab: what "this" or "these" refers to |
| `wait <board> --timeout=<s>` | Block until the user changes the board, then print what was added, changed and removed, and what is selected |
| `shot <board> [id]` | Write a PNG of the board (or of one item, or a frame with its contents) and print its path, for you to look at |
| `pdf <board> [id]` / `html <board>` | Write a PDF, or one self-contained HTML file that opens without Slate, to give to someone. `--out=<file>` |
| `start` / `stop` | Start the server in the background and print the URL, or stop it |

For large or quote-heavy JSON, pass `-` and pipe it in: `node {{SLATE}}/cli.js add main - < items.json`, or use a heredoc. Board names with spaces need quoting.

## How to work

1. **Find the board.** Run `status`. If the user didn't name a board and there are several, ask which one, or create a new one with `new` when the work is clearly its own topic. A new project gets its own board: `new "<project name>"`, then one `add` with the starting layout (for example a title, a `kanban` for the work, `stat` cards for the numbers that matter and a `callout` for open decisions).
2. **Look before you write.** Run `show <board>` so you know what is there and where the free space is. Each item has `x`, `y`, `w`, `h` in pixels; `x` grows right and `y` grows down.
3. **Read the item reference once per session** before your first `add`: `{{SLATE}}/AGENTS.md` lists every item type, its fields, sizes, colours and layout tips. Only use types and fields documented there.
4. **Add in one call.** Build the whole layout as an array and send it with a single `add`, giving every item explicit `x`/`y` so nothing overlaps. Items without a position are stacked below the existing content. Give items readable ids (`"login-api"`) so you can `set` them later.
5. **Change with `set`, not delete-and-add.** `set` keeps the item's id and position.
6. **Tell the user where to look.** If `status` shows the server running, give them the board URL (`<url>/#<board>`). If it isn't running and they want to see the result, run `start`. You never need the server for your own reads and writes.

7. **Look at the picture when the numbers are not enough.** `shot` then read the PNG: to understand a hand-drawn sketch or wireframe (freehand strokes are unreadable as JSON), and to check a layout you just wrote for overlaps. Needs a Chromium-family browser installed.
8. **Let the user point.** If they say "this" or "the selected ones", run `selection`. If they want to steer you from the board ("watch the board", "I'll mark what to change"), loop on `wait <board> --timeout=<s>`: act on what they added or changed, then wait again.
9. **Work a kanban like a task queue.** When the user asks you to take tasks from their board: `cards` to read them (the detail is the brief), `move` the card to the in-progress column before you start, and to the done column only once the work is finished and checked. If you get stuck, leave the card and add `--note="<what is blocking>"`. Use `move`, not `set` on `columns`.

## Rules

- Change only what the user asked for. Never remove or rewrite items you didn't create in this task unless asked.
- The user may be editing the same board. Run `show` again right before a `set` or `rm` if time has passed since you last looked.
- Images and videos must go through `asset` (or be http(s) URLs). Don't reference paths outside Slate.
- A `frame` is a named region. To put items "in" a frame, give them positions inside its rectangle; to make a new section, add the frame first and its contents after it in the same `add`.
- For a flowchart use `shape` items (`diamond` for decisions) joined by `line` items with `from`, `to`, `arrow` and `elbow`: true.
- To update a task list, kanban, table, chart or timeline, `set` the whole array field (`tasks`, `rows`, `data`, `events`, `columns`) with the changed copy.

## Example

Annotate a screen with its API call:

```sh
node {{SLATE}}/cli.js asset ./login.png        # → {"src":"/assets/abc-login.png"}
node {{SLATE}}/cli.js add main - <<'JSON'
[
  {"id":"login-shot","type":"image","x":80,"y":700,"w":360,"h":640,"src":"/assets/abc-login.png"},
  {"id":"login-pin","type":"pin","x":240,"y":1180,"text":"1"},
  {"id":"login-arrow","type":"line","from":"login-pin","to":"login-api","arrow":true,"label":"onSubmit"},
  {"id":"login-api","type":"code","x":596,"y":840,"w":360,"title":"POST /api/login → 200","text":{"token":"…","user":{"id":42}}}
]
JSON
node {{SLATE}}/cli.js set main login-api '{"title":"POST /api/v2/login → 200"}'
```
