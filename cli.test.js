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

test('placement uses default frame dimensions and grows only when needed', () => {
  slate('new', 'defaults');
  slate('add', 'defaults', '{"id":"frame","type":"frame"}');
  const fits = slate('add', 'defaults', '--at=frame', '{"type":"text","text":"Fits"}');
  assert.strictEqual(fits.grew, undefined);
  const grows = slate('add', 'defaults', '--at=frame', '{"type":"shape","w":650,"h":400}');
  assert.strictEqual(grows.grew, 'frame');
  const [frame] = JSON.parse(fs.readFileSync(path.join(dir, 'boards', 'defaults.json'), 'utf8')).items;
  assert.strictEqual(frame.w, 730);
  assert.ok(frame.h > 400);
});

test('Mermaid edge IDs cannot collide with node IDs', () => {
  const items = require('./public/mermaid')('flowchart TD\ne1 --> B');
  assert.strictEqual(new Set(items.map(i => i.id)).size, items.length);
  const edge = items.find(i => i.type === 'line');
  assert.ok(items.some(i => i.type === 'shape' && i.id === edge.from && i.text === 'e1'));
  assert.ok(items.some(i => i.type === 'shape' && i.id === edge.to && i.text === 'B'));
});

test('overlaps reports component intersections and frame crossings with optional scopes', () => {
  slate('new', 'layout');
  slate('add', 'layout', JSON.stringify([
    { id: 'frame', type: 'frame', x: 0, y: 0, w: 300, h: 300 },
    { id: 'nested', type: 'frame', x: 5, y: 5, w: 145, h: 145 },
    { id: 'a', type: 'shape', x: 10, y: 10, w: 100, h: 100, group: 'checkout' },
    { id: 'b', type: 'shape', x: 70, y: 20, w: 70, h: 70, group: 'checkout' },
    { id: 'peer', type: 'shape', x: 110, y: 20, w: 30, h: 50 },
    { id: 'pin', type: 'pin', x: 30, y: 30 },
    { id: 'spill', type: 'shape', x: 280, y: 50, w: 50, h: 50 },
    { id: 'outside-a', type: 'shape', x: 400, y: 10 },
    { id: 'outside-b', type: 'shape', x: 410, y: 20 }
  ]));
  const file = path.join(dir, 'boards', 'layout.json'), before = fs.readFileSync(file, 'utf8');
  const report = slate('overlaps', 'layout');
  assert.deepStrictEqual(report.overlaps.map(pair => pair.items), [['a', 'b'], ['b', 'peer'], ['outside-a', 'outside-b']]);
  assert.deepStrictEqual(report.overlaps[0], {
    items: ['a', 'b'], intersection: { x: 70, y: 20, w: 40, h: 70 },
    frames: ['frame', 'nested'], group: 'checkout'
  });
  assert.deepStrictEqual(report.frameCrossings, [
    { item: 'spill', frame: 'frame', intersection: { x: 280, y: 50, w: 20, h: 50 } }
  ]);
  assert.deepStrictEqual(slate('overlaps', 'layout', 'frame').overlaps, report.overlaps.slice(0, 2));
  const group = slate('overlaps', 'layout', 'frame', '--group=checkout');
  assert.deepStrictEqual(group.overlaps, report.overlaps.slice(0, 2));
  assert.deepStrictEqual(group.frameCrossings, []);
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});
