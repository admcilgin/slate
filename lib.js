// Shared by server.js and cli.js: where boards live and how they are read and written.
const fs = require('fs'), path = require('path');

const DATA = path.join(__dirname, 'data');
const ASSETS = path.join(DATA, 'assets');
const BOARDS = path.join(DATA, 'boards');
const RUN = path.join(DATA, '.server.json'); // written by a running server: { port, pid, url }
const CURSOR = path.join(DATA, '.cursor.json'); // written by the open tab: { board, selected, at }; `cli.js selection` reads it
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
};
const NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_ -]{0,59}$/u; // board name = file name, so keep it tame
const EMPTY = '{"items":[\n]}\n';
const TYPES = ['text', 'note', 'shape', 'line', 'draw', 'code', 'pin', 'image', 'video', 'embed', 'link', 'table', 'tasks', 'chart', 'timeline', 'stat', 'callout', 'kanban', 'frame'];

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
    .replace('<link rel="stylesheet" href="style.css">', () => `<style>${pub('style.css')}\n#shareBtn, #boardMenu { display: none !important; }</style>`)
    .replace('<script src="app.js"></script>', () => `<script>${shim}</script>\n<script>${pub('app.js').replace(/<\/script/gi, '<\\/script')}</script>`);
}

fs.mkdirSync(ASSETS, { recursive: true });
fs.mkdirSync(BOARDS, { recursive: true });
const legacy = path.join(DATA, 'board.json'); // single-board layout from v0.1
if (fs.existsSync(legacy) && !fs.existsSync(file('main'))) fs.renameSync(legacy, file('main'));
const demo = path.join(__dirname, 'demo.json');
if (!list().length) fs.existsSync(demo) ? fs.copyFileSync(demo, file('demo')) : fs.writeFileSync(file('main'), EMPTY); // first run: showcase board

module.exports = { DATA, ASSETS, BOARDS, RUN, CURSOR, MIME, NAME, EMPTY, TYPES, file, list, format, read, write, exportHTML };
