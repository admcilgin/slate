#!/usr/bin/env node
// Slate CLI — read and change boards from anywhere, no browser or server needed.
// It edits the board files directly; a running server notices and live-reloads open tabs.
const fs = require('fs'), path = require('path'), os = require('os');
const L = require('./lib');

const [cmd, ...args] = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const pos = args.filter(a => !a.startsWith('--'));

const HELP = `Usage: slate <command>. Boards live in ${L.BOARDS}

  status                        where Slate lives, its boards, the URL if the server is running, the web copy that last opened them,
                                and each agent's skill (ok, not installed, or out of date)
  start                         start the server in the background (only needed for a human to look)
  stop                          stop the server
  boards                        list boards with item counts
  map <board> [id]              the layout in few tokens: every item as id, type, x,y, w×h (rendered), text; nested by
                                frame; arrows as a→b; where the free space is. Read this first; show for full fields
  overlaps <board> [frame-id]   report overlapping components and frame crossings as JSON
                                --group=<group> checks pairs involving a member, including pairs within the group
  show <board> [id…] [--full]   items as JSON, one per line; ids narrow it (a frame brings its contents)
  types                         every item type with its fields, default size and colours
  new <board>                   create an empty board
  add <board> [json|-]          add one item or an array of items; prints the new ids and any overlaps
                                --at=below|right|<frame id> (or --x=, --y=) treats the batch's coordinates as relative
                                and puts it in free space, or inside that frame (which grows to fit)
  copy <board> <id…>            duplicate items (a frame brings its contents and arrows) with new ids; --to=<board>,
                                --at= / --x= / --y= as in add (default: below everything)
  mermaid <board> [file|text|-] draw a Mermaid flowchart as shapes and arrows, below what is there (--at=, --x=, --y=)
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
const out = v => console.log(typeof v === 'string' ? v : JSON.stringify(v, null, process.stdout.isTTY ? 2 : 0)); // indented in a terminal; one line when piped to an agent, where indentation is tokens
const uid = () => Math.random().toString(36).slice(2, 9);
const opt = k => [...flags].find(f => f.startsWith(`--${k}=`))?.slice(k.length + 3);
const brief = i => i.type === 'draw' ? { ...i, points: `<${i.points?.length || 0} points>` } : i; // freehand strokes are long and say nothing as numbers; use shot
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const attached = i => i.type === 'line' && (i.from || i.to);

// Bounds of what is drawn (attached lines follow their items, so they are left out).
function bounds(items) {
  const bs = items.filter(i => !attached(i)).map(L.box);
  return bs.length ? { x: Math.min(...bs.map(b => b.x)), y: Math.min(...bs.map(b => b.y)), r: Math.max(...bs.map(b => b.x + b.w)), b: Math.max(...bs.map(b => b.y + b.h)) } : null;
}
const inFrame = (items, f) => items.filter(i => i !== f && !attached(i) && L.inside(L.box(i), L.box(f)));

// Items named by id; a frame brings what lies inside it, and lines joining two of them come along.
function expand(items, ids) {
  const missing = ids.filter(id => !items.some(i => i.id === id));
  if (missing.length) die(`no such item: ${missing.join(', ')}`);
  const set = new Set(ids);
  for (const f of items.filter(i => set.has(i.id) && i.type === 'frame')) for (const i of inFrame(items, f)) set.add(i.id);
  for (const l of items.filter(attached)) if (set.has(l.from) && set.has(l.to)) set.add(l.id);
  return items.filter(i => set.has(i.id));
}

// --at / --x / --y: move the batch (its own coordinates taken as relative) to free space or into a frame. Returns the frame it grew, if any.
function place(b, batch) {
  const at = opt('at'), X = opt('x'), Y = opt('y');
  if (!at && X == null && Y == null) return null;
  const own = bounds(batch) || { x: 0, y: 0, r: 0, b: 0 }, all = bounds(b.items), f = at && !['below', 'right'].includes(at) && b.items.find(i => i.id === at);
  if (at && !['below', 'right'].includes(at) && f?.type !== 'frame') die(`--at takes below, right or the id of a frame; "${at}" is ${f ? 'a ' + f.type : 'not on the board'}`);
  let x = 80, y = 80;
  const frame = f && L.box(f);
  if (f) {
    const c = bounds(inFrame(b.items, f)), fits = c && c.r + 30 + own.r - own.x <= frame.x + frame.w - 40 && c.y + own.b - own.y <= frame.y + frame.h - 40;
    [x, y] = !c ? [frame.x + 40, frame.y + 60] : fits ? [c.r + 30, c.y] : [frame.x + 40, c.b + 30]; // beside what is there while it fits, else below (the frame grows)
  }
  else if (all && at === 'right') { x = all.r + 80; y = all.y; }
  else if (all) { x = all.x; y = all.b + 80; }
  const dx = (X != null ? +X : x) - own.x, dy = (Y != null ? +Y : y) - own.y;
  for (const i of batch) if (!attached(i) || i.x != null) { i.x = (i.x || 0) + dx; i.y = (i.y || 0) + dy; }
  if (!f) return null;
  const nb = bounds(batch);
  if (!nb) return null;
  const grow = { w: Math.max(frame.w, nb.r + 40 - frame.x), h: Math.max(frame.h, nb.b + 40 - frame.y) };
  if (grow.w === frame.w && grow.h === frame.h) return null;
  Object.assign(f, grow);
  return f.id;
}

// What add, set and copy say back about what they wrote: overlaps, unknown fields, lines to nothing.
function warnings(items, ids) {
  const byId = new Set(items.map(i => i.id)), w = L.clashes(items, ids);
  for (const i of items.filter(i => ids.has(i.id))) {
    const u = L.unknown(i);
    if (u.length) w.push(`${i.id}: ${i.type} has no field ${u.join(', ')} (see slate types)`);
    for (const k of ['from', 'to']) if (i[k] && !byId.has(i[k])) w.push(`${i.id}: ${k} "${i[k]}" is not on the board`);
  }
  return w;
}
const report = (o, items, ids) => { const w = warnings(items, ids); out(w.length ? { ...o, warn: w } : o); };

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
  require('child_process').spawn(process.execPath, [js], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', fs.openSync(log, 'w')] }).unref();
  for (let i = 0; i < 30 && !(s = server()); i++) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  if (!s) die(`server did not start:\n${fs.readFileSync(log, 'utf8').trim().split('\n').slice(0, 6).join('\n') || '(no output)'}\nRun \`node "${js}"\` to try it yourself.`);
  return { ...s, mine: true };
}

// Run the system's Chromium-family browser headless and return what it prints. No dependency: it is already on most machines.
function chrome(args) {
  const bins = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    ...[process.env.LOCALAPPDATA, process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).flatMap(d => // Windows: Edge is always there
      [['Google', 'Chrome', 'chrome.exe'], ['Microsoft', 'Edge', 'msedge.exe'], ['BraveSoftware', 'Brave-Browser', 'brave.exe']].map(([v, b, exe]) => path.join(d, v, b, 'Application', exe))),
    'google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge'].filter(Boolean);
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

// Agents that can load the skill, and the skill as `install` writes it for this copy of Slate.
const AGENTS = () => [['Claude Code', path.join(os.homedir(), '.claude')], ['Codex', process.env.CODEX_HOME || path.join(os.homedir(), '.codex')], ['GitHub Copilot', path.join(os.homedir(), '.copilot')]];
const SLATE = __dirname.split(path.sep).join('/'); // C:/Users/… on Windows: Git Bash would eat the backslashes, and node takes either
const skillText = () => fs.readFileSync(path.join(__dirname, 'skills', 'slate', 'SKILL.md'), 'utf8').replaceAll('{{SLATE}}', SLATE);
const skillVersion = s => /^\s+version:\s*"?([\w.]+)/m.exec(s)?.[1] || 'none';
// Each agent on this machine and its skill: "ok", "not installed", or how it differs from this Slate's.
function skills() {
  const want = skillText(), v = skillVersion(want);
  return { version: v, ...Object.fromEntries(AGENTS().filter(([, d]) => fs.existsSync(d)).map(([n, d]) => {
    let have;
    try { have = fs.readFileSync(path.join(d, 'skills', 'slate', 'SKILL.md'), 'utf8'); } catch { return [n, 'not installed']; }
    return [n, have === want ? 'ok' : skillVersion(have) !== v ? `version ${skillVersion(have)}, this Slate has ${v}` : 'differs from this Slate'];
  })) };
}
// On `slate` and `slate start`: tell the user when an agent has no skill or an older one. stderr, so stdout stays parseable.
function checkSkills() {
  const { version, ...agents } = skills(), bad = Object.entries(agents).filter(([, st]) => st !== 'ok').map(([n, st]) => `${n}: ${st}`);
  if (bad.length) console.error(`slate: the agent skill is missing or out of date (${bad.join('; ')}). Run \`slate install\` to update it.`);
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
    out({ dir: __dirname, boardsDir: L.BOARDS, assetsDir: L.ASSETS, boards: L.list(), running: !!s, url: s?.url || null, port: s?.port || null, web: web(), skills: skills() });
  },

  start() { out(up().url); checkSkills(); },

  stop() {
    const s = server();
    if (!s) return out('not running');
    process.kill(s.pid);
    out('stopped');
  },

  boards() { out(L.list().map(n => `${n}\t${L.read(n).items.length} items`).join('\n')); },

  show() {
    const n = name(pos[0]), b = L.read(n), items = pos.length > 1 ? expand(b.items, pos.slice(1)) : b.items;
    out(items.map(i => JSON.stringify(flags.has('--full') ? i : brief(i))).join('\n') || '(empty board)');
  },

  map() {
    const n = name(pos[0]), b = L.read(n), all = pos[1] ? expand(b.items, [pos[1]]) : b.items;
    const cut = (s, k = 60) => { s = String(s ?? '').replace(/\s*\n\s*/g, ' / ').trim(); return s.length > k ? s.slice(0, k - 1) + '…' : s; };
    const what = i => ({
      code: () => `${i.title ? i.title + ': ' : ''}${typeof i.text === 'string' ? `${i.text.split('\n').length} lines` : 'JSON'}`,
      callout: () => `${i.title || ''}: ${i.text || ''}`,
      link: () => i.title || i.url, embed: () => i.url, image: () => i.alt || i.src, video: () => i.src,
      stat: () => `${i.label} = ${i.value}${i.delta ? ' ' + i.delta : ''}`,
      table: () => `${i.rows?.length}×${i.rows?.[0]?.length}: ${(i.rows?.[0] || []).join(' | ')}`,
      tasks: () => `${i.title || ''} [${(i.tasks || []).filter(t => t.done).length}/${(i.tasks || []).length} done]`,
      kanban: () => (i.columns || []).map(c => `${c.title} ${(c.cards || []).filter(Boolean).length}`).join(' | '),
      chart: () => `${i.title || ''} (${i.data?.length || 0} points)`, timeline: () => `${i.title || ''} (${i.events?.length || 0} events)`,
      draw: () => `${i.points?.length || 0} points`, frame: () => i.title, line: () => i.label,
    }[i.type] || (() => i.text))();
    const style = i => ['color', 'fill', 'dash', 'bold', 'size', 'collapsed', 'locked', 'group', 'href'].filter(k => i[k] != null && i[k] !== false)
      .map(k => i[k] === true ? k : k === 'color' ? i[k] : `${k}=${i[k]}`).join(' ');
    const row = i => {
      const r = L.box(i), d = cut(what(i)), st = style(i);
      return `${i.id} ${i.type}${i.shape && i.shape !== 'rect' ? '/' + i.shape : i.chart ? '/' + i.chart : ''} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.w)}x${Math.round(r.h)}${d ? ' ' + JSON.stringify(d) : ''}${st ? ' ' + st : ''}`;
    };
    const lines = [], placed = new Set(), body = all.filter(i => !attached(i));
    const frames = body.filter(i => i.type === 'frame').sort((a, c) => L.box(c).w * L.box(c).h - L.box(a).w * L.box(a).h); // biggest first, so nesting works
    const parent = new Map(body.map(i => [i.id, frames.filter(f => f !== i && L.inside(L.box(i), L.box(f))).pop()?.id]));
    const walk = (pid, ind) => body.filter(i => parent.get(i.id) === pid).forEach(i => {
      if (i.type !== 'frame') return lines.push(ind + row(i));
      const kids = body.filter(k => parent.get(k.id) === i.id), c = bounds(kids), fb = L.box(i);
      lines.push(`${ind}[${row(i)}]${c && c.b + 60 < fb.y + fb.h ? ` free inside from y=${Math.round(c.b + 30)}` : !c ? ' empty' : ' full'}`);
      walk(i.id, ind + '  ');
    });
    walk(undefined, '');
    const arrows = all.filter(attached).map(l => `${l.id}: ${l.from || '?'} ${l.arrow === 'both' ? '<->' : l.arrow ? '->' : '--'} ${l.to || '?'}${l.label ? ' ' + JSON.stringify(cut(l.label, 40)) : ''}${l.dash ? ' dash' : ''}`);
    const bb = bounds(all);
    out([`${n}: ${all.length} items${bb ? `, drawn within ${Math.round(bb.x)},${Math.round(bb.y)} to ${Math.round(bb.r)},${Math.round(bb.b)}; free space below y=${Math.round(bb.b + 80)} and right of x=${Math.round(bb.r + 80)}` : ''}`,
      '(id type x,y wxh "text" style; h is the rendered height; [frame] holds the indented items)', ...lines, ...(arrows.length ? ['arrows:', ...arrows] : [])].join('\n'));
  },

  overlaps() {
    const n = name(pos[0]), { items } = L.read(n), id = pos[1], group = opt('group');
    if (pos.length > 2 || [...flags].some(flag => !flag.startsWith('--group='))) {
      die('usage: overlaps <board> [frame-id] [--group=<group>]');
    }
    const frame = id && items.find(i => i.id === id && i.type === 'frame');
    if (id && !frame) die(`no frame "${id}" on "${n}"`);
    if (group !== undefined && !items.some(i => i.group === group)) die(`no group "${group}" on "${n}"`);
    out({ board: n, ...(frame && { frame: id }), ...(group !== undefined && { group }), ...L.inspectOverlaps(items, { frame, group }) });
  },

  types() {
    out(['Every item: id type x y w h, optional color group locked href; text style: size bold italic align. Positions in px, x right, y down.',
      'Palette: gray #8e8e93, red #ff3b30, orange #ff9500, yellow #ffcc00, green #34c759, blue #007aff, purple #af52de. Omit color for default ink.',
      ...Object.entries(L.SPEC).map(([t, [w, h, f, d]]) => `${t}${w ? ` ${w}x${h}` : ''}: ${f}. ${d}`)].join('\n'));
  },

  new() {
    const n = name(pos[0], false);
    L.write(n, { items: [] });
    out({ board: n, url: urlFor(n) });
  },

  add() {
    const n = name(pos[0]), b = L.read(n), ids = new Set(b.items.map(i => i.id));
    const items = [].concat(input(pos[1])), grew = place(b, items);
    for (const it of items) {
      if (!it || !L.TYPES.includes(it.type)) die(`unknown type "${it?.type}". Types: ${L.TYPES.join(', ')}`);
      if (it.id != null && ids.has(String(it.id))) die(`id "${it.id}" already exists on "${n}"; use set to change it`);
      it.id = String(it.id ?? `${it.type}-${uid()}`);
      ids.add(it.id);
      if (it.x == null || it.y == null) { // no position given: put it under everything else
        it.x ??= 80;
        it.y ??= (bounds(b.items)?.b ?? 40) + 40;
      }
      b.items.push(it);
    }
    L.write(n, b);
    report({ board: n, added: items.map(i => i.id), ...(grew && { grew }), url: urlFor(n) }, b.items, new Set([...items.map(i => i.id), grew]));
  },

  copy() {
    const n = name(pos[0]), to = opt('to') ? name(opt('to')) : n, src = L.read(n), b = to === n ? src : L.read(to);
    if (pos.length < 2) die('usage: copy <board> <id…> [--to=<board>] [--at=below|right|<frame>]');
    const items = structuredClone(expand(src.items, pos.slice(1))), taken = new Set(b.items.map(i => i.id));
    let k = 2;
    while (items.some(i => taken.has(`${i.id}-${k}`))) k++;
    const old = new Set(items.map(i => i.id)), re = id => old.has(id) ? `${id}-${k}` : id;
    for (const i of items) { i.id = re(i.id); if (i.from) i.from = re(i.from); if (i.to) i.to = re(i.to); if (i.group) i.group += `-${k}`; delete i.locked; }
    if (!opt('at') && opt('x') == null && opt('y') == null) flags.add('--at=below');
    const grew = place(b, items);
    b.items.push(...items);
    L.write(to, b);
    report({ board: to, added: items.map(i => i.id), ...(grew && { grew }), url: urlFor(to) }, b.items, new Set([...items.map(i => i.id), grew]));
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
    if (!opt('at') && opt('x') == null && opt('y') == null) flags.add('--at=below');
    const grew = place(b, items);
    b.items.push(...items);
    L.write(n, b);
    report({ board: n, added: items.map(i => i.id), ...(grew && { grew }), url: urlFor(n) }, b.items, new Set([...items.map(i => i.id), grew]));
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
    const w = warnings(b.items, new Set([it.id]));
    out(JSON.stringify(brief(it)) + (w.length ? '\nwarn: ' + w.join('; ') : ''));
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
    const skill = skillText(), agents = AGENTS();
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
    for (const [, d] of AGENTS()) {
      const dir = path.join(d, 'skills', 'slate'); // only a skill that points at this copy (install writes the path into it)
      try { if (fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').includes(SLATE)) { fs.rmSync(dir, { recursive: true }); done.push(dir); } } catch {}
    }
    for (const rc of ['.zshrc', '.bash_profile', '.bashrc', '.profile', '.config/fish/config.fish'].map(f => path.join(home, f))) {
      try {
        const t = fs.readFileSync(rc, 'utf8'), u = t.replace(/\n?[^\n]*# added by slate[^\n]*/g, '');
        if (u !== t) { fs.writeFileSync(rc, u); done.push(`the PATH line in ${rc}`); }
      } catch {}
    }
    if (process.platform === 'win32') try { // install.ps1 put <this>\bin on the user PATH; the folder goes with this copy below
      const r = require('child_process').execFileSync('powershell', ['-NoProfile', '-Command', "$p = [Environment]::GetEnvironmentVariable('Path', 'User'); "
        + "$q = ($p -split ';' | Where-Object { $_ -and $_ -ne $env:SLATE_BIN }) -join ';'; if ($p -and $q -ne $p) { [Environment]::SetEnvironmentVariable('Path', $q, 'User'); 'removed' }"],
        { env: { ...process.env, SLATE_BIN: path.join(__dirname, 'bin') }, encoding: 'utf8' });
      if (r.trim() === 'removed') done.push(`${path.join(__dirname, 'bin')} from your user PATH`);
    } catch {} // no PowerShell: the entry stays, pointing at a folder that is gone
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

if (!commands[cmd]) { out(HELP); if (!cmd || cmd === 'help') checkSkills(); process.exit(cmd && cmd !== 'help' ? 1 : 0); }
commands[cmd]();
