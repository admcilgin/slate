#!/usr/bin/env node
// Slate CLI — read and change boards from anywhere, no browser or server needed.
// It edits the board files directly; a running server notices and live-reloads open tabs.
const fs = require('fs'), path = require('path'), os = require('os');
const L = require('./lib');

const [cmd, ...args] = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const pos = args.filter(a => !a.startsWith('--'));

const HELP = `Slate CLI. Boards live in ${L.BOARDS}

  status                        where Slate lives, its boards, and the URL if the server is running
  start                         start the server in the background (only needed for a human to look)
  stop                          stop the server
  boards                        list boards with item counts
  show <board> [--full]         print the board, one item per line (--full includes freehand points)
  new <board>                   create an empty board
  add <board> [json|-]          add one item or an array of items; prints the new ids
  set <board> <id> [json|-]     merge fields into an item (a null value removes the field)
  rm <board> <id> [id…]         delete items
  rm-board <board>              delete a board
  asset <file>                  copy an image or video into Slate; prints the src to use in an item
  install                       install the Claude Code skill into ~/.claude/skills/slate

JSON comes from the argument, or from stdin when it is "-" or missing.
Item types and fields are documented in ${path.join(__dirname, 'AGENTS.md')}`;

const die = m => { console.error('slate: ' + m); process.exit(1); };
const out = v => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const uid = () => Math.random().toString(36).slice(2, 9);

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

const urlFor = (s, n) => s ? `${s.url}/#${encodeURIComponent(n)}` : null;

const commands = {
  status() {
    const s = server();
    out({ dir: __dirname, boardsDir: L.BOARDS, assetsDir: L.ASSETS, boards: L.list(), running: !!s, url: s?.url || null, port: s?.port || null });
  },

  start() {
    let s = server();
    if (!s) {
      require('child_process').spawn(process.execPath, [path.join(__dirname, 'server.js')], { detached: true, stdio: 'ignore' }).unref();
      for (let i = 0; i < 30 && !(s = server()); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
      if (!s) die('server did not start; run `node server.js` to see why');
    }
    out(s.url);
  },

  stop() {
    const s = server();
    if (!s) return out('not running');
    process.kill(s.pid);
    out('stopped');
  },

  boards() { out(L.list().map(n => `${n}\t${L.read(n).items.length} items`).join('\n')); },

  show() {
    const n = name(pos[0]), b = L.read(n);
    out(b.items.map(i => JSON.stringify(i.type === 'draw' && !flags.has('--full') ? { ...i, points: `<${i.points?.length || 0} points>` } : i)).join('\n') || '(empty board)');
  },

  new() {
    const n = name(pos[0], false);
    L.write(n, { items: [] });
    out({ board: n, url: urlFor(server(), n) });
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
    out({ board: n, added: items.map(i => i.id), url: urlFor(server(), n) });
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

  install() {
    const dir = path.join(os.homedir(), '.claude', 'skills', 'slate');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), fs.readFileSync(path.join(__dirname, 'skills', 'slate', 'SKILL.md'), 'utf8').replaceAll('{{SLATE}}', __dirname));
    out(`Installed ${path.join(dir, 'SKILL.md')}`);
  },
};

if (!commands[cmd]) { out(HELP); process.exit(cmd && cmd !== 'help' ? 1 : 0); }
commands[cmd]();
