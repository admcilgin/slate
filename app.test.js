const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'public', 'app.js'), 'utf8');
function section(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end));
}

async function checkConcurrentEdit(finish) {
  const board = { items: [{ id: 'existing', type: 'text' }] };
  let disk = JSON.stringify(board);
  const context = vm.createContext({
    api: n => n, norm: i => i, byId: () => true, render() {}, syncUI() {},
    setTimeout: () => 1, clearTimeout() {}, $: () => ({}),
    async fetch(url, options) {
      if (options?.method === 'PUT') { disk = options.body; return { ok: true }; }
      return { json: async () => JSON.parse(disk) };
    }
  });
  const run = code => vm.runInContext(code, context);
  run("let name = 'test', board, drag, editing, sel = new Set();" +
    section('// ---------- history + persistence', '// ---------- editing'));
  await run('load()');
  run("board.items.push({ id: 'local', type: 'text' }); commit()");
  disk = JSON.stringify({ items: [...board.items, { id: 'agent', type: 'text' }] });
  await run(finish);
  assert.deepEqual(JSON.parse(disk).items.map(i => i.id), ['existing', 'agent', 'local']);
}

test('live reload preserves browser edits waiting to save', async () => {
  await checkConcurrentEdit('Promise.all([load(true), flush()])');
});

test('save preserves agent edits before notification arrives', async () => {
  await checkConcurrentEdit('flush()');
});

test('rename deletes the source only after the destination was saved', async () => {
  for (const ok of [false, true]) {
    const requests = [], destinations = [], status = { hidden: true };
    const menu = { hidePopover() {}, replaceChildren(...children) { this.children = children; } };
    const context = vm.createContext({
      api: n => n, localStorage: {}, $: selector => ({ '#boardMenu': menu, '#status': status })[selector] || {},
      h: (_, props) => props, go: n => destinations.push(n),
      askName: async () => 'new', commit() {}, flush: async () => true,
      async fetch(n, options) {
        requests.push([n, options.method]);
        return { ok: options.method === 'DELETE' || ok };
      }
    });
    vm.runInContext("let name = 'old', last = '{\"items\":[]}', editing;" +
      section('function renderBoards(', "addEventListener('hashchange', openBoard)") +
      "renderBoards(['old']);", context);
    menu.children.find(item => item?.textContent === 'Rename…').onclick();
    await new Promise(setImmediate);
    assert.deepEqual(requests, ok ? [['new', 'PUT'], ['old', 'DELETE']] : [['new', 'PUT']]);
    assert.deepEqual(destinations, ok ? ['new'] : []);
    assert.equal(status.hidden, ok);
  }
});
