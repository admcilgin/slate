#!/usr/bin/env node
// Slate CLI — read and change boards from anywhere, no browser or server needed.
// It edits the board files directly; a running server notices and live-reloads open tabs.
const fs = require('fs'), path = require('path'), os = require('os');
const L = require('./lib');

const [cmd, ...args] = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const pos = args.filter(a => !a.startsWith('--'));

const HELP = `Usage: slate <command>. Boards live in ${L.BOARDS}

  status                        where Slate lives, its boards, the URL if the server is running, and the web copy that last opened them
  start                         start the server in the background (only needed for a human to look)
  stop                          stop the server
  boards                        list boards with item counts
  show <board> [--full]         print the board, one item per line (--full includes freehand points)
  new <board>                   create an empty board
  add <board> [json|-]          add one item or an array of items; prints the new ids
  mermaid <board> [file|text|-] draw a Mermaid flowchart as shapes and arrows, below what is there (--x=, --y= to place it)
  set <board> <id> [json|-]     merge fields into an item (a null value removes the field)
  rm <board> <id> [id…]         delete items
  rm-board <board>              delete a board
  asset <file>                  copy an image or video into Slate; prints the src to use in an item
  cards <board>                 every kanban card with its column and detail, one per line
  move <board> <card> <column>  move a kanban card (matched by its title) to another column; --note=<text> adds a line
                                to its detail, --kanban=<id> picks the kanban when a board has several
  selection                     the items the user has selected in the open tab ("this one")
  wait <board>                  block until the user changes the board, then print what changed and what is selected
                                (--quiet=3 seconds of calm before reporting, --timeout=<seconds> to give up)
  shot <board> [id]             PNG of the board, or of one item or frame with its contents, to look at (--out=file)
  pdf <board> [id]              the same as a vector PDF (--out=file)
  html <board>                  the board as one self-contained HTML file to send to someone (--out=file)
  use [folder|default]          keep boards in another folder (one the user picked on the web copy), or back in data/;
                                with no folder, print where they are now. SLATE_DATA=<folder> does the same for one run
  install                       install the agent skill for Claude Code, Codex and GitHub Copilot (each one found here)
  uninstall [--yes]             remove Slate, the slate command, its PATH line and the agent skills; boards stay

JSON comes from the argument, or from stdin when it is "-" or missing.
Item types and fields are documented in ${path.join(__dirname, 'AGENTS.md')}`;

const die = m => { console.error('slate: ' + m); process.exit(1); };
const out = v => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const uid = () => Math.random().toString(36).slice(2, 9);
const opt = k => [...flags].find(f => f.startsWith(`--${k}=`))?.slice(k.length + 3);
const brief = i => i.type === 'draw' ? { ...i, points: `<${i.points?.length || 0} points>` } : i; // freehand strokes are long and say nothing as numbers; use shot
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function name(n, mustExist = true) {
  if (!n || !L.NAME.test(n)) die(`bad or missing board name${n ? ` "${n}"` : ''} (letters, digits, spaces, - and _)`);
  const hit = L.list().find(b => b.toLowerCase() === n.toLowerCase());
  if (mustExist && !hit) die(`no board "${n}". Boards: ${L.list().join(', ')}`);
  if (!mustExist && hit) die(`board "${hit}" already exists`);
  return hit || n;
}

function input(arg) {
  const s = arg && arg !== '-' ? arg : fs.readFileSync(0, 'utf8');
  try { return JSON.parse(s); } catch (e) { die('invalid JSON: ' + e.message); }
}

function server() {
  try { const s = JSON.parse(fs.readFileSync(L.RUN, 'utf8')); process.kill(s.pid, 0); return s; } catch { return null; }
}

// Kanban cards are strings: the first line is the title, further lines the detail.
const kanbans = b => b.items.filter(i => i.type === 'kanban' && Array.isArray(i.columns));
// The one entry whose label is `q` (case-insensitive), or failing that the only one containing it.
function pick(list, q, label, what) {
  const lc = s => String(s).toLowerCase().trim(), exact = list.filter(x => lc(label(x)) === lc(q));
  const hits = exact.length ? exact : list.filter(x => lc(label(x)).includes(lc(q)));
  if (hits.length !== 1) die(`${hits.length ? 'more than one' : 'no'} ${what} matches "${q}". Choices: ${list.map(label).join(' | ') || 'none'}`);
  return hits[0];
}

// The web copy that last opened this folder (see public/folder.js); `open` if a tab has checked in within 90 s.
function web() {
  try { const w = JSON.parse(fs.readFileSync(L.WEB, 'utf8')); return { url: w.url, open: Date.now() - Date.parse(w.at) < 90e3, seen: w.at }; } catch { return null; }
}
const urlFor = n => { const u = server()?.url || web()?.url; return u ? `${u}/#${encodeURIComponent(n)}` : null; };

// The running server, started if there is none (`mine` marks one we started).
function up() {
  let s = server();
  if (s) return s;
  const log = path.join(L.DATA, '.server.log'), js = path.join(__dirname, 'server.js');
  require('child_process').spawn(process.execPath, [js], { detached: true, stdio: ['ignore', 'ignore', fs.openSync(log, 'w')] }).unref();
  for (let i = 0; i < 30 && !(s = server()); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  if (!s) die(`server did not start:\n${fs.readFileSync(log, 'utf8').trim().split('\n').slice(0, 6).join('\n') || '(no output)'}\nRun \`node "${js}"\` to try it yourself.`);
  return { ...s, mine: true };
}

// Run the system's Chromium-family browser headless and return what it prints. No dependency: it is already on most machines.
function chrome(args) {
  const bins = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'].filter(Boolean);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-')); // own profile, so it never collides with the user's open browser
  try {
    for (const bin of bins) {
      try {
        return require('child_process').execFileSync(bin, ['--headless', '--disable-gpu', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${tmp}`, '--virtual-time-budget=5000', ...args],
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28, timeout: 60000 });
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  throw new Error('needs Chrome, Chromium, Edge or Brave. Set CHROME=/path/to/browser if it is somewhere unusual');
}

// shot / pdf: let the real app lay the board out (see printSetup in app.js) and capture that.
function capture(kind, ext) {
  const n = name(pos[0]), id = pos[1] || '';
  if (id && !L.read(n).items.some(i => i.id === id)) die(`no item "${id}" on "${n}"`);
  const file = path.resolve(opt('out') || path.join(kind === 'shot' ? path.join(__dirname, 'data', 'shots') : '.', `${n}${id && '-' + id}.${ext}`));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  const s = up(), url = `${s.url}/?${kind}=${encodeURIComponent(id)}#${encodeURIComponent(n)}`;
  let err;
  try {
    if (kind === 'shot') {
      const m = /data-shot="(\d+),(\d+)"/.exec(chrome(['--dump-dom', url])); // first pass: the real size, text heights included
      if (m) chrome([`--screenshot=${file}`, `--window-size=${m[1]},${m[2]}`, url]);
    } else chrome([`--print-to-pdf=${file}`, '--no-pdf-header-footer', url]);
  } catch (e) { err = e.message; }
  if (s.mine) process.kill(s.pid);
  if (err || !fs.existsSync(file)) die(err || `nothing to capture on "${n}" (is it empty?)`);
  out({ board: n, file });
}

const commands = {
  status() {
    const s = server();
    out({ dir: __dirname, boardsDir: L.BOARDS, assetsDir: L.ASSETS, boards: L.list(), running: !!s, url: s?.url || null, port: s?.port || null, web: web() });
  },

  start() { out(up().url); },

  stop() {
    const s = server();
    if (!s) return out('not running');
    process.kill(s.pid);
    out('stopped');
  },

  boards() { out(L.list().map(n => `${n}\t${L.read(n).items.length} items`).join('\n')); },

  show() {
    const n = name(pos[0]), b = L.read(n);
    out(b.items.map(i => JSON.stringify(flags.has('--full') ? i : brief(i))).join('\n') || '(empty board)');
  },

  new() {
    const n = name(pos[0], false);
    L.write(n, { items: [] });
    out({ board: n, url: urlFor(n) });
  },

  add() {
    const n = name(pos[0]), b = L.read(n), ids = new Set(b.items.map(i => i.id));
    const items = [].concat(input(pos[1]));
    for (const it of items) {
      if (!it || !L.TYPES.includes(it.type)) die(`unknown type "${it?.type}". Types: ${L.TYPES.join(', ')}`);
      if (it.id != null && ids.has(String(it.id))) die(`id "${it.id}" already exists on "${n}"; use set to change it`);
      it.id = String(it.id ?? `${it.type}-${uid()}`);
      ids.add(it.id);
      if (it.x == null || it.y == null) { // no position given: put it under everything else
        it.x ??= 80;
        it.y ??= b.items.length ? Math.max(...b.items.map(i => (i.y || 0) + (i.h || 120))) + 40 : 80;
      }
      b.items.push(it);
    }
    L.write(n, b);
    out({ board: n, added: items.map(i => i.id), url: urlFor(n) });
  },

  mermaid() {
    const n = name(pos[0]), b = L.read(n), a = pos[1];
    const src = !a || a === '-' ? fs.readFileSync(0, 'utf8') : fs.existsSync(a) ? fs.readFileSync(a, 'utf8') : a;
    const ids = new Set(b.items.map(i => i.id));
    let items, p = 'mm-';
    for (let k = 2; ; k++) { // a second diagram on the same board gets mm2-, mm3-…
      try { items = require('./public/mermaid')(src, p); } catch (e) { die(e.message); }
      if (!items.some(i => ids.has(i.id))) break;
      p = `mm${k}-`;
    }
    const x0 = Number(opt('x') ?? 80), y0 = Number(opt('y') ?? (b.items.length ? Math.max(...b.items.map(i => (i.y || 0) + (i.h || 120))) + 80 : 80));
    for (const i of items) { i.x += x0; i.y += y0; }
    b.items.push(...items);
    L.write(n, b);
    out({ board: n, added: items.map(i => i.id), url: urlFor(n) });
  },

  set() {
    const n = name(pos[0]), b = L.read(n), it = b.items.find(i => i.id === pos[1]);
    if (!it) die(`no item "${pos[1]}" on "${n}"`);
    const patch = input(pos[2]);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) die('patch must be a JSON object');
    if ('id' in patch) die('ids cannot be changed');
    for (const [k, v] of Object.entries(patch)) if (v === null) delete it[k]; else it[k] = v;
    if (!L.TYPES.includes(it.type)) die(`unknown type "${it.type}"`);
    L.write(n, b);
    out(JSON.stringify(it));
  },

  rm() {
    const n = name(pos[0]), b = L.read(n), ids = pos.slice(1);
    if (!ids.length) die('give at least one item id');
    const missing = ids.filter(id => !b.items.some(i => i.id === id));
    if (missing.length) die(`no such item on "${n}": ${missing.join(', ')}`);
    b.items = b.items.filter(i => !ids.includes(i.id));
    L.write(n, b);
    out({ board: n, removed: ids });
  },

  'rm-board'() {
    const n = name(pos[0]);
    fs.rmSync(L.file(n));
    out({ removed: n });
  },

  asset() {
    const src = pos[0];
    if (!src || !fs.existsSync(src)) die(`no such file: ${src}`);
    if (!/\.(png|jpe?g|gif|webp|svg|avif|mp4|webm|mov|m4v)$/i.test(src)) die('only images and videos (png, jpg, gif, webp, svg, avif, mp4, webm, mov, m4v)');
    const file = Date.now().toString(36) + '-' + path.basename(src).replace(/[^\w.-]/g, '_');
    fs.copyFileSync(src, path.join(L.ASSETS, file));
    out({ src: '/assets/' + file });
  },

  cards() {
    const n = name(pos[0]);
    out(kanbans(L.read(n)).flatMap(k => k.columns.flatMap(col => (col.cards || []).filter(Boolean).map(c => {
      const [card, ...detail] = String(c).split('\n');
      return JSON.stringify({ kanban: k.id, column: col.title, card, ...(detail.length && { detail: detail.join('\n') }) });
    }))).join('\n') || '(no kanban cards)');
  },

  move() {
    if (!pos[1] || !pos[2]) die('usage: move <board> <card> <column> [--note=<text>] [--kanban=<id>]');
    const n = name(pos[0]), b = L.read(n); // read here, write a few lines down: the window for clobbering the user's own edit is milliseconds
    const all = kanbans(b).filter(k => !opt('kanban') || k.id === opt('kanban'))
      .flatMap(k => k.columns.flatMap(col => (col.cards || []).map((c, at) => ({ k, col, at, title: String(c).split('\n')[0] })))).filter(x => x.title);
    const hit = pick(all, pos[1], x => x.title, 'card'), to = pick(hit.k.columns, pos[2], c => c.title, 'column');
    const card = hit.col.cards[hit.at] + (opt('note') ? '\n' + opt('note') : '');
    if (to === hit.col) hit.col.cards[hit.at] = card; // same column: only the note changes, the card keeps its place
    else { hit.col.cards.splice(hit.at, 1); (to.cards ??= []).push(card); }
    L.write(n, b);
    out({ board: n, kanban: hit.k.id, card: hit.title, from: hit.col.title, to: to.title });
  },

  selection() {
    let c = {};
    try { c = JSON.parse(fs.readFileSync(L.CURSOR, 'utf8')); } catch {}
    const ids = new Set(c.selected), items = L.list().includes(c.board) ? L.read(c.board).items : [];
    out({ board: c.board || null, at: c.at || null, selected: items.filter(i => ids.has(i.id)).map(brief) });
  },

  wait() {
    const n = name(pos[0]), quiet = (+opt('quiet') || 3) * 1000, until = +opt('timeout') ? Date.now() + opt('timeout') * 1000 : Infinity;
    const snap = () => new Map(L.read(n).items.map(i => [i.id, i]));
    const mtime = () => { try { return fs.statSync(L.file(n)).mtimeMs; } catch { return 0; } };
    // ponytail: the first browser save after an agent's write fills in defaults and re-routes attached lines; these two lists keep that from
    // reading as the user's change. A style key the user adds in that same first save to an otherwise untouched item is kept; a default is not.
    const STYLE = ['color', 'size', 'bold', 'italic', 'align', 'fill', 'dash', 'width', 'arrow', 'elbow', 'label', 'href', 'locked', 'group', 'collapsed', 'from', 'to'];
    const ROUTED = ['x', 'y', 'w', 'h', 'points', 'elbow'];
    const delta = (o, i) => Object.keys({ ...o, ...i }).filter(k => !same(o[k], i[k]) && (k in o || STYLE.includes(k))
      && !(i.type === 'line' && (i.from || i.to) && ROUTED.includes(k))
      && !(!(k in o) && ((i.type === 'note' && k === 'color') || (i.type === 'shape' && k === 'align') || (i.type === 'stat' && k === 'label'))));
    const before = snap();
    let seen = mtime(), at = 0;
    setInterval(() => { // ponytail: polls the file's mtime; fs.watch loses the file on every atomic rename
      const m = mtime(), now = Date.now();
      if (m !== seen) { seen = m; at = now; }
      if (at && now - at >= quiet) { // the user has stopped for a moment
        at = 0;
        let after;
        try { after = snap(); } catch { return; } // invalid or deleted: keep waiting
        const added = [...after.values()].filter(i => !before.has(i.id)).map(brief);
        const removed = [...before.keys()].filter(id => !after.has(id));
        const changed = [...after.values()].flatMap(i => {
          const o = before.get(i.id), keys = o ? delta(o, i) : [];
          return keys.length ? [{ ...brief(i), was: Object.fromEntries(keys.map(k => [k, k === 'points' ? '<points>' : o[k] ?? null])) }] : [];
        });
        if (added.length || removed.length || changed.length) {
          let c = {};
          try { c = JSON.parse(fs.readFileSync(L.CURSOR, 'utf8')); } catch {}
          out({ board: n, added, changed, removed, selected: c.board === n ? c.selected.filter(id => after.has(id)) : [] });
          process.exit(0);
        }
      }
      if (now > until) { out({ board: n, timeout: true }); process.exit(0); }
    }, 300);
  },

  shot() { capture('shot', 'png'); },
  pdf() { capture('print', 'pdf'); },

  html() {
    const n = name(pos[0]), file = path.resolve(opt('out') || `${n}.html`);
    fs.writeFileSync(file, L.exportHTML(n));
    out({ board: n, file, bytes: fs.statSync(file).size });
  },

  use() {
    if (!pos[0]) return out({ dataDir: L.DATA, picked: L.picked || null });
    const want = pos[0] === 'default' ? '' : path.resolve(pos[0]);
    if (want && !L.isDir(want)) die('no such folder: ' + want);
    want ? fs.writeFileSync(L.PICK, want + '\n') : fs.rmSync(L.PICK, { force: true });
    const to = want ? L.dataIn(want) : path.join(__dirname, 'data');
    fs.rmSync(L.MARK, { force: true }); // the web copy no longer counts the old folder as the command's (see lib.js)
    fs.mkdirSync(to, { recursive: true });
    fs.writeFileSync(path.join(to, '.cli.json'), JSON.stringify({ dir: to }));
    const s = server(); // it serves the old folder, and after the switch `stop` could no longer find it
    if (s) process.kill(s.pid);
    out({ dataDir: to, ...(s && { note: 'stopped the server; `start` serves the new folder' }) });
  },

  install() { // the three read the same SKILL.md format, each from its own folder
    const home = os.homedir(), skill = fs.readFileSync(path.join(__dirname, 'skills', 'slate', 'SKILL.md'), 'utf8').replaceAll('{{SLATE}}', __dirname);
    const agents = [['Claude Code', path.join(home, '.claude')], ['Codex', process.env.CODEX_HOME || path.join(home, '.codex')], ['GitHub Copilot', path.join(home, '.copilot')]];
    const found = agents.filter(([, d]) => fs.existsSync(d));
    if (!found.length) die(`no agent found: looked for ${agents.map(([, d]) => d).join(', ')}. Run the agent once, then install again`);
    for (const [, d] of found) {
      const dir = path.join(d, 'skills', 'slate');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'SKILL.md'), skill);
    }
    out(found.map(([n, d]) => `${n}: ${path.join(d, 'skills', 'slate', 'SKILL.md')}`).join('\n'));
  },

  uninstall() {
    const home = os.homedir(), clone = fs.existsSync(path.join(__dirname, '.git')); // a git clone is the user's own work: leave it on disk
    const inside = L.DATA.startsWith(__dirname + path.sep), keep = path.join(home, 'Slate');
    const demoOnly = L.list().every(n => n === 'demo' && fs.readFileSync(L.file(n), 'utf8') === fs.readFileSync(path.join(__dirname, 'demo.json'), 'utf8'));
    const move = inside && !clone && !demoOnly; // boards in ~/.slate/data would go with it: take them to ~/Slate first
    if (move && fs.existsSync(keep)) die(`your boards are in ${L.DATA}, inside Slate, and ${keep} already exists. Move them out (or \`slate use <folder>\`) and run uninstall again`);
    if (!flags.has('--yes')) {
      if (!process.stdin.isTTY) die('run `slate uninstall --yes` to remove Slate');
      process.stdout.write(`Remove Slate from ${__dirname}? Your boards ${move ? `move to ${keep}` : `stay in ${inside ? L.DATA : path.dirname(L.BOARDS)}`}. [y/N] `);
      const b = Buffer.alloc(64);
      let n;
      for (;;) try { n = fs.readSync(0, b, 0, 64, null); break; } // a terminal's stdin can be non-blocking: wait for the answer
      catch (e) { if (e.code !== 'EAGAIN') throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
      if (!/^y/i.test(b.toString('utf8', 0, n).trim())) return out('nothing removed');
    }
    const done = [], cli = path.join(__dirname, 'cli.js');
    const s = server();
    if (s) { process.kill(s.pid); done.push('stopped the server'); }
    for (const d of new Set((process.env.PATH || '').split(path.delimiter).concat(path.join(home, '.local', 'bin')))) { // only links to this copy
      const f = path.join(d, 'slate');
      try { if (fs.lstatSync(f).isSymbolicLink() && fs.realpathSync(f) === fs.realpathSync(cli)) { fs.rmSync(f); done.push(f); } } catch {}
    }
    for (const d of [path.join(home, '.claude'), process.env.CODEX_HOME || path.join(home, '.codex'), path.join(home, '.copilot')]) {
      const dir = path.join(d, 'skills', 'slate'); // only a skill that points at this copy (install writes the path into it)
      try { if (fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').includes(__dirname)) { fs.rmSync(dir, { recursive: true }); done.push(dir); } } catch {}
    }
    for (const rc of ['.zshrc', '.bash_profile', '.bashrc', '.profile', '.config/fish/config.fish'].map(f => path.join(home, f))) {
      try {
        const t = fs.readFileSync(rc, 'utf8'), u = t.replace(/\n?[^\n]*# added by slate[^\n]*/g, '');
        if (u !== t) { fs.writeFileSync(rc, u); done.push(`the PATH line in ${rc}`); }
      } catch {}
    }
    if (move) { // without the old server, cursor and marker files
      fs.cpSync(L.DATA, keep, { recursive: true, filter: f => f === L.DATA || !path.basename(f).startsWith('.') });
      done.push(`moved your boards to ${keep}`);
    }
    if (!inside) for (const f of [L.MARK, path.join(L.DATA, '.server.log')]) fs.rmSync(f, { force: true }); // the web copy then says agents no longer use the folder
    if (!clone) { fs.rmSync(__dirname, { recursive: true, force: true }); done.push(__dirname); }
    out(`Removed:\n  ${done.join('\n  ')}\nYour boards: ${move ? keep : inside && !clone ? 'there were none besides the demo' : path.dirname(L.BOARDS)}`
      + (clone ? `\nThis is a git clone, so ${__dirname} stays; delete it yourself if you like (and \`npm unlink -g slate\` if you linked it).` : ''));
  },
};

if (!commands[cmd]) { out(HELP); process.exit(cmd && cmd !== 'help' ? 1 : 0); }
commands[cmd]();
