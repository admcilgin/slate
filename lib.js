// Shared by server.js and cli.js: where boards live and how they are read and written.
const fs = require('fs'), path = require('path');

const DATA = path.join(__dirname, 'data');
const ASSETS = path.join(DATA, 'assets');
const BOARDS = path.join(DATA, 'boards');
const RUN = path.join(DATA, '.server.json'); // written by a running server: { port, pid, url }
const NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_ -]{0,59}$/u; // board name = file name, so keep it tame
const EMPTY = '{"items":[\n]}\n';
const TYPES = ['text', 'note', 'shape', 'line', 'draw', 'code', 'pin', 'image', 'video', 'embed', 'link', 'table', 'tasks', 'chart', 'timeline'];

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

fs.mkdirSync(ASSETS, { recursive: true });
fs.mkdirSync(BOARDS, { recursive: true });
const legacy = path.join(DATA, 'board.json'); // single-board layout from v0.1
if (fs.existsSync(legacy) && !fs.existsSync(file('main'))) fs.renameSync(legacy, file('main'));
const demo = path.join(__dirname, 'demo.json');
if (!list().length) fs.writeFileSync(file('main'), fs.existsSync(demo) ? fs.readFileSync(demo) : EMPTY); // first run: welcome board

module.exports = { DATA, ASSETS, BOARDS, RUN, NAME, EMPTY, TYPES, file, list, format, read, write };
