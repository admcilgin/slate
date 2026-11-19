// node --test: the CLI's placement, copy and warnings, run against a throwaway boards folder.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-test-'));
fs.mkdirSync(path.join(dir, 'boards'));
const slate = (...a) => JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'cli.js'), ...a], { env: { ...process.env, SLATE_DATA: dir }, encoding: 'utf8' }).split('\n')[0]);
const items = () => Object.fromEntries(JSON.parse(fs.readFileSync(path.join(dir, 'boards', 't.json'), 'utf8')).items.map(i => [i.id, i]));
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('add --at places, copy remaps, warnings catch overlaps and typos', () => {
  slate('new', 't');
  slate('add', 't', JSON.stringify([{ id: 'f', type: 'frame', x: 0, y: 0, w: 400, h: 200 }, { id: 'a', type: 'shape', x: 40, y: 60 }, { id: 'b', type: 'shape', x: 300, y: 300 },
    { id: 'ab', type: 'line', from: 'a', to: 'b', arrow: true }]));
  let r = slate('add', 't', '--at=f', '{"id":"n","type":"note","x":0,"y":0}'); // no room beside a: goes below it, frame grows
  let i = items();
  assert.deepStrictEqual([i.n.x, i.n.y], [40, 190]);
  assert.strictEqual(r.grew, 'f');
  assert.strictEqual(i.f.h, 430);
  r = slate('copy', 't', 'f');
  i = items();
  assert.ok(i['n-2'] && i['a-2'] && !i['b-2'] && !i['ab-2'], 'a frame brings its contents; a line leaving it stays behind');
  r = slate('copy', 't', 'a', 'b', '--at=right');
  assert.deepStrictEqual([items()['ab-3'].from, items()['ab-3'].to], ['a-3', 'b-3']);
  r = slate('add', 't', '{"id":"x","type":"callout","x":50,"y":70,"titel":"?"}');
  assert.ok(r.warn.includes('x overlaps a') && r.warn.some(w => w.includes('no field titel')), r.warn);
});

test('estimated heights of growing cards', () => {
  process.env.SLATE_DATA = dir; // lib.js sets up its folder on load
  const L = require('./lib');
  // measured in Chrome: a collapsed 20-line code block at 340px is 160px tall, this callout 67px
  assert.ok(Math.abs(L.height({ type: 'code', w: 340, collapsed: true, text: Array.from({ length: 20 }, (_, k) => 'line ' + k).join('\n') }) - 160) < 6);
  assert.ok(Math.abs(L.height({ type: 'callout', w: 340, title: 'Risk', text: 'short' }) - 67) < 6);
});
