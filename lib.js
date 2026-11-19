// Shared by server.js and cli.js: where boards live and how they are read and written.
const fs = require('fs'), path = require('path');

// Boards live in data/ here, or in a folder of the user's own (the one they picked on the web copy): SLATE_DATA, or `cli.js use <folder>`.
const PICK = path.join(__dirname, '.slate-data');
const isDir = d => fs.statSync(d, { throwIfNoEntry: false })?.isDirectory();
const dataIn = d => !isDir(path.join(d, 'boards')) && isDir(path.join(d, 'data', 'boards')) ? path.join(d, 'data') : d; // same rule as public/folder.js
const picked = process.env.SLATE_DATA || (fs.existsSync(PICK) ? fs.readFileSync(PICK, 'utf8').trim() : '');
const DATA = picked ? dataIn(path.resolve(picked)) : path.join(__dirname, 'data');
const ASSETS = path.join(DATA, 'assets');
const BOARDS = path.join(DATA, 'boards');
const RUN = path.join(DATA, '.server.json'); // written by a running server: { port, pid, url }
const WEB = path.join(DATA, '.web.json'); // written every 30 s by a tab on a static host with this folder open: { url, at }
const MARK = path.join(DATA, '.cli.json'); // { dir }: the slate command uses this folder. public/folder.js looks for it
const CURSOR = path.join(DATA, '.cursor.json'); // written by the open tab: { board, selected, at }; `cli.js selection` reads it
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
  '.woff2': 'font/woff2',
};
const NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_ -]{0,59}$/u; // board name = file name, so keep it tame
const EMPTY = '{"items":[\n]}\n';
// Every item type: default size (mirrors DEF in public/app.js), its own fields, and a one-line hint. `slate types` prints this.
const SPEC = {
  text: [240, 28, 'text', 'plain text; height grows; color = text colour'],
  note: [200, 200, 'text', 'sticky note; color tints the paper (default #ffcc00)'],
  shape: [160, 100, 'shape:"rect"|"ellipse"|"diamond" text fill:bool dash:bool', 'color = border, fill tints it; diamond ~170x110 for decisions'],
  line: [0, 0, 'from:id to:id points:[[x,y],…] arrow:true|"both" label elbow:bool dash:bool width:2|4|8', 'from+to attach to items, no points needed; points are relative to x,y'],
  draw: [0, 0, 'points width dash', 'freehand stroke; unreadable as numbers, use shot'],
  code: [340, 60, 'title text collapsed:bool', 'monospace; text may be a JSON object (pretty-printed); height grows'],
  pin: [28, 28, 'text', 'numbered marker on a screenshot; color fills it (default red)'],
  image: [320, 220, 'src alt', 'src from `slate asset` or http(s); set h to the aspect ratio'],
  video: [400, 225, 'src', 'local asset or direct video URL; YouTube/Vimeo → embed'],
  embed: [480, 300, 'url', 'iframe; YouTube, Vimeo, Loom, Figma links converted'],
  link: [300, 62, 'url title', 'link card'],
  table: [380, 110, 'rows:[["head","…"],["a","…"]]', 'first row is the header; equal row lengths; height grows'],
  tasks: [260, 90, 'title tasks:[{text,done,due:"YYYY-MM-DD"}]', 'checklist; overdue open tasks red; height grows'],
  chart: [340, 240, 'chart:"bar"|"line"|"pie" title data:[{label,value}]', 'one series; color = bar/line colour'],
  timeline: [560, 170, 'title events:[{date,label}]', 'YYYY-MM-DD dates placed proportionally; ~140px width per event'],
  stat: [200, 112, 'label value delta', 'metric card; strings; delta "+…" green, "-…" red'],
  callout: [300, 64, 'title text', 'boxed remark; color: blue info, #ff9500 warning, #ff3b30 risk, #34c759 decision; height grows'],
  kanban: [600, 150, 'columns:[{title,cards:["title\\ndetail",…]}]', '~200px width per column; height grows'],
  frame: [640, 400, 'title', 'named dashed region, title drawn 20px above it; items fully inside move with it; list it before its contents, ~40px padding'],
};
const TYPES = Object.keys(SPEC);
const COMMON = ['id', 'type', 'x', 'y', 'w', 'h', 'color', 'group', 'locked', 'href', 'size', 'bold', 'italic', 'align'];
const fieldsOf = t => SPEC[t][2].split(' ').map(f => f.split(':')[0]);
const unknown = i => SPEC[i.type] ? Object.keys(i).filter(k => !COMMON.includes(k) && !fieldsOf(i.type).includes(k)) : [];

// The height an item takes on screen. Cards whose height grows with content (AUTO in app.js) are taller than their `h`;
// shortcut: a character-width guess instead of real text layout, good to a line or two; `slate shot` is exact.
function height(i) {
  const [dw, dh] = SPEC[i.type] || [0, 0], w = i.w || dw, h = i.h || dh, f = i.size || 14, lh = f * 1.4;
  const rows = (s, px, cw = f * .52) => String(s ?? '').split('\n').reduce((n, l) => n + Math.max(1, Math.ceil(l.length * cw / Math.max(px, 20))), 0);
  const mono = f * .86, mlh = mono * 1.55;
  switch (i.type) {
    case 'text': return Math.max(h, rows(i.text, w - 8, f * .50) * lh + 4);
    case 'code': {
      const t = typeof i.text === 'string' ? i.text : JSON.stringify(i.text ?? '', null, 2), n = rows(t, w - 28, mono * .6);
      return Math.max(h, 26 + (i.title ? mlh + 17 : 0) + (i.collapsed && n > 6 ? 6 * mlh + 23 : n * mlh));
    }
    case 'tasks': return Math.max(h, 28 + (i.title ? lh * .93 + 8 : 0) + (i.tasks || []).reduce((s, t) => s + rows(t.text, w - 60) * lh + 6, 0));
    case 'table': {
      const r = Array.isArray(i.rows) ? i.rows : [], cw = w / Math.max(1, r[0]?.length || 1) - 20;
      return Math.max(h, r.reduce((s, row) => s + Math.max(34, Math.max(...row.map(c => rows(c, cw))) * lh + 15), 0));
    }
    case 'callout': return Math.max(h, 24 + (i.title ? lh + 4 : 0) + (i.text ? rows(i.text, w - 36, f * .47) * lh : 0));
    case 'kanban': {
      const cols = i.columns || [], cw = (w - 24) / Math.max(1, cols.length) - 10 - 34, cf = f * .93;
      const card = c => { const [t, ...d] = String(c).split('\n'); return 6 + 14 + 1 + rows(t, cw, cf * .52) * cf * 1.4 + (d.length ? 3 + rows(d.join('\n'), cw, cf * .47) * cf * .9 * 1.4 : 0); };
      return Math.max(h, 24 + 16 + f * .86 * 1.4 + 4 + Math.max(0, ...cols.map(c => (c.cards || []).filter(Boolean).reduce((s, c) => s + card(c), 0))));
    }
    default: return h;
  }
}
// x, y, w, h as drawn; lines and strokes from their points (an attached line has none until a browser routes it).
function box(i) {
  if (i.type === 'line' || i.type === 'draw') {
    const p = Array.isArray(i.points) && i.points.length ? i.points : [[0, 0]], xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    return { x: (i.x || 0) + Math.min(...xs), y: (i.y || 0) + Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  }
  return { x: i.x || 0, y: i.y || 0, w: i.w || SPEC[i.type]?.[0] || 0, h: Math.round(height(i)) };
}
const inside = (a, f) => a.x >= f.x && a.y >= f.y && a.x + a.w <= f.x + f.w && a.y + a.h <= f.y + f.h;
const hits = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
// What a blind writer should hear about `ids`: boxes that overlap another item, and items cut by a frame's edge.
// Pins, lines, strokes and items of the same group are meant to sit on things, so they are left out.
function clashes(items, ids) {
  const solid = items.filter(i => !['line', 'draw', 'pin', 'frame'].includes(i.type)), frames = items.filter(i => i.type === 'frame'), out = [];
  for (const i of items.filter(i => ids.has(i.id))) {
    const a = box(i);
    if (i.type !== 'frame' && solid.includes(i)) for (const o of solid) if (o !== i && !(i.group && i.group === o.group) && (!ids.has(o.id) || i.id < o.id) && hits(a, box(o))) out.push(`${i.id} overlaps ${o.id}`);
    const pairs = i.type === 'frame' ? items.filter(o => o !== i && !['line', 'draw'].includes(o.type)).map(o => [o, i]) : ['line', 'draw'].includes(i.type) ? [] : frames.map(f => [i, f]);
    for (const [o, f] of pairs) {
      const s = box(o), t = box(f);
      if (o !== f && hits(s, t) && !inside(s, t) && !inside(t, s)) out.push(`${o.id} crosses the edge of frame ${f.id}`);
    }
  }
  return [...new Set(out)];
}

const file = n => path.join(BOARDS, n + '.json');
const list = () => fs.readdirSync(BOARDS).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).filter(n => NAME.test(n)).sort((a, b) => a.localeCompare(b));

// One item per line: cheap for agents to read, grep and diff.
const format = ({ items, ...rest }) =>
  JSON.stringify(rest).slice(0, -1) + (Object.keys(rest).length ? ',' : '') +
  '"items":[\n' + items.map(i => JSON.stringify(i)).join(',\n') + '\n]}\n';

const read = n => JSON.parse(fs.readFileSync(file(n), 'utf8'));
function write(n, board) {
  const out = format(board);
  fs.writeFileSync(file(n) + '.tmp', out);
  fs.renameSync(file(n) + '.tmp', file(n)); // atomic: readers never see a half-written board
  return out;
}

// A board as one self-contained HTML file: app, styles, board and its local media inlined. It opens anywhere and saves nowhere.
function exportHTML(n) {
  const pub = f => fs.readFileSync(path.join(__dirname, 'public', f), 'utf8');
  const board = read(n);
  for (const i of board.items) {
    const f = typeof i.src === 'string' && i.src.startsWith('/assets/') && path.join(ASSETS, path.basename(i.src));
    if (f && fs.existsSync(f)) i.src = `data:${MIME[path.extname(f).toLowerCase()]};base64,${fs.readFileSync(f).toString('base64')}`;
  }
  // Stand in for the server: reads return this board, writes fail, so the app says the copy is not saved.
  const shim = `(() => {
  const name = ${JSON.stringify(n)}, board = ${JSON.stringify(board).replace(/</g, '\\u003c')};
  window.fetch = async (u, o) => o ? new Response(null, { status: 503 }) : new Response(JSON.stringify(String(u).startsWith('/api/boards') ? [name] : board));
  window.EventSource = function () {};
  document.getElementById('status').textContent = 'Shared copy: changes are not saved';
})();`;
  return pub('index.html')
    .replace(/<script src="(mermaid|folder)\.js"><\/script>\n/g, '')
    .replace('<link rel="stylesheet" href="style.css">', () => `<style>${pub('style.css').replace(/url\("(fonts\/[\w-]+\.woff2)"\)/g, (_, f) => `url("data:font/woff2;base64,${fs.readFileSync(path.join(__dirname, 'public', f)).toString('base64')}")`)}\n#shareBtn, #boardMenu { display: none !important; }</style>`)
    .replace('<script src="app.js"></script>', () => `<script>${shim}</script>\n<script>${pub('app.js').replace(/<\/script/gi, '<\\/script')}</script>`);
}

fs.mkdirSync(ASSETS, { recursive: true });
fs.mkdirSync(BOARDS, { recursive: true });
const mark = JSON.stringify({ dir: DATA });
if ((fs.existsSync(MARK) && fs.readFileSync(MARK, 'utf8')) !== mark) fs.writeFileSync(MARK, mark);
const legacy = path.join(DATA, 'board.json'); // single-board layout from v0.1
if (fs.existsSync(legacy) && !fs.existsSync(file('main'))) fs.renameSync(legacy, file('main'));
const demo = path.join(__dirname, 'demo.json');
if (!list().length) fs.existsSync(demo) ? fs.copyFileSync(demo, file('demo')) : fs.writeFileSync(file('main'), EMPTY); // first run: showcase board

module.exports = { PICK, isDir, dataIn, picked, DATA, ASSETS, BOARDS, RUN, WEB, MARK, CURSOR, MIME, NAME, EMPTY, SPEC, TYPES, COMMON, unknown, height, box, inside, hits, clashes, file, list, format, read, write, exportHTML };
