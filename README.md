# Slate

**English** · [Türkçe](README.tr.md)

A local whiteboard that AI agents can read and write.

![The Slate demo board: text, sticky notes, callouts, a flowchart in a frame, lines, pins and an annotated screenshot](docs/board.jpg)

[![Two-minute demo: an agent turns a selected list into a kanban, works a card through to Done, and builds a form from a hand-drawn sketch](docs/demo-poster.jpg)](docs/slate-demo.mp4)

[▶ Watch the two-minute demo video](docs/slate-demo.mp4) (silent).

Slate runs on your machine, stores every board as a plain JSON file, and has no dependencies. Draw on it yourself, or point a coding agent at the folder and ask it to lay out a plan, a flow or a roadmap. Whatever the agent writes appears on the open board straight away.

## Run it

Needs [Node.js](https://nodejs.org) 18 or newer. Nothing to install.

```sh
git clone https://github.com/admcilgin/slate.git
cd slate
node server.js
```

Open http://localhost:4747. To use another port: `PORT=5000 node server.js`.

The first run opens a board called `demo` that shows every kind of item.

## What you can put on a board

**Drawing**
- Freehand strokes, lines, arrows, rectangles, ellipses, diamonds
- Arrows that attach to items and follow them, straight or right-angled, with labels, dashed strokes and heads on one or both ends
- Numbered pins for calling out spots on a screenshot

**Writing**
- Text and sticky notes
- Callouts: boxed remarks for info, warnings and decisions
- Code and JSON blocks with syntax colouring, collapse and copy; pasted JSON is formatted automatically
- Size, bold, italic, alignment and colour on text, notes, shapes and cards

**Data and planning**
- Metric cards, tables, and bar, line and pie charts
- Task lists with due dates, plus a panel listing every open task on the board
- Kanban boards with cards you drag between columns; a card can carry detail lines under its title (Shift+Enter)
- Timelines

**Media and links**
- Images and videos (drop them on the canvas, paste them, or pick a file)
- Link cards and embeds (YouTube, Vimeo, Figma, Loom)
- Any item can link to a web page or to another board

**Organising**
- Frames: named regions that carry what is inside them
- Grouping, locking, alignment guides while dragging, align and distribute
- Resize from any corner or side; scale a whole selection from its corners
- Multiple boards, each with its own link, and search across all of them
- PDF export of the board, a selection or a frame
- Share: the whole board as one HTML file that opens in any browser, media included

## Using it

| Action | How |
|---|---|
| Edit anything | Double-click it |
| Write text | Double-click empty space |
| Pan | Hold Space and drag, or scroll |
| Zoom | Pinch, or ⌘/Ctrl + scroll |
| Select several | Drag a box, or Shift-click |
| Undo / redo | ⌘Z / ⇧⌘Z |
| Copy / cut / paste, also between boards | ⌘C / ⌘X / ⌘V |
| Duplicate | ⌘D, or Alt-drag |
| Group / ungroup (Alt-click picks one item in a group) | ⌘G / ⇧⌘G |
| Nudge | Arrow keys (Shift for 10 px) |
| Move without snapping | Hold ⌘ while dragging |
| Move a frame with its contents | Drag the frame's title |
| Fit board or selection on screen | F |
| Search all boards | ⌘K |
| Export the selection or the whole board as PDF | ⌘P |
| Send the board to someone as a single HTML file | Share, top right |
| Move the toolbar to the bottom, left, top or right | Last button on the toolbar |
| Delete | Backspace |
| Tools | V select, H pan, P draw, L line, A arrow, R rectangle, O ellipse, D diamond, T text, N note, M numbered pin |

Everything else (images, links, code blocks, tables, tasks, charts, timelines, metric cards, callouts, kanban boards, frames) is in the **+** menu. Select an item to get its options in the bar at the top: colour, text style, dashed, arrowheads, elbow, link, align, lock and so on. Boards are switched, created, renamed and deleted from the menu in the top-left corner.

## Working with an agent

Each board is one file, `data/boards/<name>.json`, with one item per line. An agent reads the file to see the board and edits it to draw. The browser picks up the change in about a tenth of a second, and it lands on your undo stack, so ⌘Z reverts an agent's edit like any other.

[AGENTS.md](AGENTS.md) describes every item type, its fields, the coordinate system and the limits of the platform. Claude Code, Codex and other agents that read `AGENTS.md` or `CLAUDE.md` pick it up automatically when started in this folder. Then ask in plain language:

> Add a timeline of the launch plan to the demo board, and a task list for this week next to it.

There is no built-in chat and no API key to configure. The agent is whichever one you already use.

### From other projects

Agents working elsewhere on your machine use the CLI. It edits board files directly, so neither the browser nor the server has to be running:

```sh
node cli.js status                      # where Slate lives, boards, URL if the server is up
node cli.js show demo                   # every item, one per line
node cli.js new "Launch plan"           # create a board
node cli.js add demo '{"type":"note","text":"Ship it"}'
node cli.js set demo <id> '{"color":"#34c759"}'
node cli.js rm demo <id>
node cli.js start                       # start the server in the background; stop ends it
```

The board also works the other way round, as the thing you point with:

```sh
node cli.js selection                   # what you have selected in the open tab: "make these a task list"
node cli.js wait demo                   # blocks until you change the board, then prints what changed
node cli.js shot demo                   # a PNG the agent can look at: your sketches, or its own layout
node cli.js shot demo <frame-id>        # one frame with its contents
node cli.js pdf demo                    # vector PDF, no print dialog
node cli.js html demo                   # one self-contained HTML file to send to someone
node cli.js cards demo                  # every kanban card with its column and detail
node cli.js move demo "Export to PNG" Doing   # take a card; later move it to Done
```

A kanban works as a task queue for an agent: write a card with the brief in its detail lines, and ask the agent to work the board. It moves the card to your in-progress column when it starts and to done when the work is finished.

With `wait` you can steer an agent without typing to it: circle a part of a screenshot, drop a note that says what to change, and the agent picks it up. `shot` and `pdf` use the Chrome, Chromium, Edge or Brave already on your machine.

Run `node cli.js` for the full list. Inside the Slate folder every agent picks up `AGENTS.md` by itself. To teach your agents about Slate in every other project too, install the bundled skill once:

```sh
node cli.js install
```

It installs for each agent it finds on your machine:

| Agent | Skill goes to |
|---|---|
| Claude Code | `~/.claude/skills/slate` |
| Codex | `~/.codex/skills/slate` (or `$CODEX_HOME/skills/slate`) |
| GitHub Copilot (CLI, VS Code agent mode) | `~/.copilot/skills/slate` |

An agent you install later is picked up by running `install` again; run it again after `git pull` too, so the skill knows the new commands. After that you can say "put this flow on my Slate board" from any repo.

## Your data

- Boards live in `data/boards/`, uploaded media in `data/assets/`. Both are git-ignored, so `git pull` never touches your boards and they are not shared between computers.
- To move boards to another computer, copy the `data/` folder.
- The server listens on `127.0.0.1` only and rejects requests from other sites.
- Nothing is sent anywhere. Embeds and remote images load from their own hosts when you add them.

## Limits

- One person at a time: if you and an agent save within the same quarter-second, the last write wins.
- Text inside an item is plain. Style applies to the whole item, not to single words.
- Items cannot be rotated, and groups cannot be nested.
- A shared HTML file is a copy: whoever opens it can move things around, but nothing is saved and it does not sync back. Embeds in it need a connection, and some (YouTube) refuse to play from a local file.
- Scaling a selection changes positions and sizes, not text size.

## Code

About 1,900 lines, no build step.

- `cli.js` reads and edits boards from the command line; `lib.js` holds what it shares with the server.
- `server.js` serves the app, reads and writes board files, and pushes live-reload events.
- `public/app.js` is the canvas. Each item type has one renderer in `R` and its defaults in `DEF`.
- `demo.json` is the showcase board copied on first run.

## License

[MIT](LICENSE). Free to use, change and ship, for personal or commercial work. Keep the copyright notice.
