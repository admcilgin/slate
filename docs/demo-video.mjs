#!/usr/bin/env node
// Records docs/slate-demo.mp4 and docs/demo-poster.jpg: headless Chrome drives the real app with real mouse and key
// input, the agent scenes run the real `slate` CLI, and ffmpeg stitches the frames and lays the music under them.
//   node docs/demo-video.mjs [--music=docs/demo-music.mp3]
// Needs Chrome (CHROME=/path) and ffmpeg. Works on a throwaway copy of the boards, never on yours.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const MUSIC = arg('music') ?? (fs.existsSync(path.join(ROOT, 'docs/demo-music.mp3')) ? path.join(ROOT, 'docs/demo-music.mp3') : null);
const OUT = path.join(ROOT, 'docs/slate-demo.mp4'), POSTER = path.join(ROOT, 'docs/demo-poster.jpg');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'slate-demo-')), DATA = path.join(TMP, 'data'), FRAMES = path.join(TMP, 'frames');
const PORT = 4851, DEBUG = 9333, W = 1280, H = 720, DPR = 1.5; // 1920×1080 frames
const sleep = ms => new Promise(r => setTimeout(r, ms));

fs.mkdirSync(path.join(DATA, 'boards'), { recursive: true });
fs.mkdirSync(FRAMES);
fs.copyFileSync(path.join(ROOT, 'demo.json'), path.join(DATA, 'boards/demo.json'));
for (const b of ['sketch', 'checkout']) fs.writeFileSync(path.join(DATA, `boards/${b}.json`), '{"items":[\n]}\n');

const env = { ...process.env, SLATE_DATA: DATA, PORT: String(PORT) };
const slate = (args, input) => execFileSync('node', [path.join(ROOT, 'cli.js'), ...args], { env, input, encoding: 'utf8' });
const server = spawn('node', [path.join(ROOT, 'server.js')], { env, stdio: 'ignore' });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${path.join(TMP, 'chrome')}`,
  '--no-first-run', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--mute-audio', `--window-size=${W},${H}`, 'about:blank'], { stdio: 'ignore' });
const quit = () => { chrome.kill(); server.kill(); };
process.on('exit', quit);

// ---------- DevTools protocol ----------
let ws, seq = 0;
const pending = new Map(), handlers = {};
async function connect() {
  for (let n = 0; n < 50; n++) {
    try {
      const t = (await (await fetch(`http://127.0.0.1:${DEBUG}/json/list`)).json()).find(t => t.type === 'page');
      if (t) { ws = new WebSocket(t.webSocketDebuggerUrl); break; }
    } catch {}
    await sleep(200);
  }
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method) handlers[m.method]?.(m.params);
  };
}
const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
async function js(expr) {
  const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}

// ---------- input ----------
let mx = W / 2, my = H / 2;
const ease = k => k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
const mouse = (type, x, y, o = {}) => cdp('Input.dispatchMouseEvent', { type, x, y, button: o.button ?? 'none', buttons: o.buttons ?? 0, clickCount: o.clickCount ?? 0, modifiers: o.modifiers ?? 0 });
async function move(x, y, ms = 500, down = false) {
  const x0 = mx, y0 = my, n = Math.max(1, Math.round(ms / 16));
  for (let i = 1; i <= n; i++) {
    const k = ease(i / n);
    mx = x0 + (x - x0) * k; my = y0 + (y - y0) * k;
    await mouse('mouseMoved', mx, my, down ? { button: 'left', buttons: 1 } : {});
    await sleep(16);
  }
}
async function click(x, y, { ms = 450, count = 1 } = {}) {
  if (x != null) await move(x, y, ms);
  for (let c = 1; c <= count; c++) {
    await mouse('mousePressed', mx, my, { button: 'left', buttons: 1, clickCount: c });
    await mouse('mouseReleased', mx, my, { button: 'left', clickCount: c });
    if (c < count) await sleep(90);
  }
  await sleep(120);
}
async function drag(x0, y0, x1, y1, ms = 600) {
  await move(x0, y0, 400);
  await mouse('mousePressed', mx, my, { button: 'left', buttons: 1, clickCount: 1 });
  await move(x1, y1, ms, true);
  await mouse('mouseReleased', mx, my, { button: 'left', clickCount: 1 });
  await sleep(150);
}
async function stroke(pts, ms = 700) { // a freehand line through the given points
  await move(...pts[0], 300);
  await mouse('mousePressed', mx, my, { button: 'left', buttons: 1, clickCount: 1 });
  for (const p of pts.slice(1)) await move(...p, ms / pts.length, true);
  await mouse('mouseReleased', mx, my, { button: 'left', clickCount: 1 });
  await sleep(120);
}
const CODES = { Escape: 27, Enter: 13, Backspace: 8 };
async function key(k, mods = 0) { // mods: 4 = ⌘
  const p = { key: k, code: k.length === 1 ? 'Key' + k.toUpperCase() : k, windowsVirtualKeyCode: CODES[k] ?? k.toUpperCase().charCodeAt(0), modifiers: mods };
  await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...p });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
  await sleep(80);
}
async function type(text, cps = 22) { for (const ch of text) { await cdp('Input.insertText', { text: ch }); await sleep(1000 / cps); } }

// Where things are on screen
const center = sel => js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
const item = id => center(`.item[data-id="${id}"]`);
const itemIdx = async (type, n = 0) => js(`board.items.filter(i => i.type === '${type}').at(${n}).id`);

// ---------- overlays: caption, terminal, title cards, a drawn cursor (headless shows none) ----------
const OVERLAY = `
addEventListener('DOMContentLoaded', () => {
  const css = document.createElement('style');
  css.textContent = \`
  #__cur { position: fixed; left: 0; top: 0; width: 22px; height: 22px; z-index: 2147483647; pointer-events: none; transform: translate(-3px,-2px); transition: scale .08s; }
  #__cur.down { scale: .86; }
  #__cap { position: fixed; left: 50%; bottom: 74px; translate: -50% 0; z-index: 2147483600; pointer-events: none; padding: 9px 18px; border-radius: 999px;
    background: rgba(29,29,31,.9); color: #fff; font: 600 16px/1.2 Allo, system-ui, sans-serif; letter-spacing: .1px; white-space: nowrap; opacity: 0; transition: opacity .35s, translate .35s; }
  #__cap.on { opacity: 1; translate: -50% -4px; }
  :root[data-dock=bottom] #__cap, :root:not([data-dock]) #__cap { bottom: 78px; }
  #__term { position: fixed; left: 28px; top: 96px; width: 470px; z-index: 2147483500; pointer-events: none; border-radius: 12px; overflow: hidden;
    background: #1e1e1e; color: #d4d4d4; box-shadow: 0 20px 60px rgba(0,0,0,.35); font: 13px/1.6 ui-monospace, "SF Mono", Menlo, monospace; opacity: 0; translate: -16px 0; transition: opacity .4s, translate .4s; }
  #__term.on { opacity: 1; translate: 0 0; }
  #__term header { height: 30px; background: #2d2d2d; display: flex; align-items: center; gap: 7px; padding: 0 12px; color: #9a9a9a; font: 12px system-ui, sans-serif; }
  #__term header b { width: 11px; height: 11px; border-radius: 50%; } #__term header span { margin-left: 10px; }
  #__term pre { margin: 0; padding: 12px 14px 14px; min-height: 120px; max-height: 420px; overflow: hidden; white-space: pre-wrap; word-break: break-word; font: inherit; display: flex; flex-direction: column; justify-content: flex-end; }
  #__term .u { color: #fff; } #__term .u::before { content: '> '; color: #c77dff; }
  #__term .t { color: #9cdcfe; } #__term .t::before { content: '● '; color: #4ec9b0; }
  #__term .o { color: #8a8a8a; padding-left: 16px; } #__term .ok { color: #6ccf6c; } #__term .ok::before { content: '✓ '; }
  #__term .caret::after { content: '▍'; color: #c77dff; animation: __b 1s steps(1) infinite; } @keyframes __b { 50% { opacity: 0; } }
  #__card { position: fixed; inset: 0; z-index: 2147483640; display: grid; place-content: center; text-align: center; gap: 14px; background: #f5f5f7; color: #1d1d1f;
    font-family: Allo, system-ui, sans-serif; opacity: 0; transition: opacity .6s; pointer-events: none; }
  #__card.on { opacity: 1; }
  #__card h1 { margin: 0; font-size: 84px; font-weight: 700; letter-spacing: -2px; } #__card p { margin: 0; font-size: 24px; color: #6e6e73; }
  #__card small { margin-top: 18px; font-size: 18px; color: #007aff; }\`;
  document.head.append(css);
  const cur = Object.assign(document.createElement('div'), { id: '__cur', innerHTML: '<svg viewBox="0 0 22 22"><path d="M3 2l15 9-6.6 1.4L8.3 19z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>' });
  const cap = Object.assign(document.createElement('div'), { id: '__cap' });
  const term = Object.assign(document.createElement('div'), { id: '__term', innerHTML: '<header><b style="background:#ff5f57"></b><b style="background:#febc2e"></b><b style="background:#28c840"></b><span>claude — ~/shop</span></header><pre></pre>' });
  const card = Object.assign(document.createElement('div'), { id: '__card' });
  document.body.append(term, cap, card, cur);
  addEventListener('pointermove', e => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
  addEventListener('pointerdown', () => cur.classList.add('down'), true);
  addEventListener('pointerup', () => cur.classList.remove('down'), true);
  const wait = ms => new Promise(r => setTimeout(r, ms)), pre = term.querySelector('pre');
  window.__cap = t => { if (!t) return cap.classList.remove('on'); cap.textContent = t; cap.classList.add('on'); };
  window.__card = html => { if (html) card.innerHTML = html; card.classList.toggle('on', !!html); };
  window.__term = {
    show: on => { term.classList.toggle('on', on); },
    clear: () => { pre.replaceChildren(); },
    line: (t, cls) => { const d = document.createElement('div'); d.className = cls; d.textContent = t; pre.append(d); },
    async type(t, cps = 30) {
      const d = document.createElement('div'); d.className = 'u caret'; pre.append(d);
      for (const ch of t) { d.textContent += ch; await wait(1000 / cps); }
      await wait(350); d.classList.remove('caret');
    },
  };
  // Camera move: ease the view so the world rectangle fills the area left of/right of the terminal
  window.__cam = (x, y, z, ms = 900) => new Promise(res => {
    const a = { ...view }, t0 = performance.now(), e = k => k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const step = t => { const k = e(Math.min(1, (t - t0) / ms)); view.x = a.x + (x - a.x) * k; view.y = a.y + (y - a.y) * k; view.z = a.z + (z - a.z) * k; applyView(); k < 1 ? requestAnimationFrame(step) : res(); };
    requestAnimationFrame(step);
  });
});`;

// Fit a world rectangle into a screen area {l,t,r,b}
async function frame([x0, y0, x1, y1], ms = 900, area = { l: 40, t: 70, r: W - 40, b: H - 120 }, zmax = 1.15) {
  const z = Math.min(zmax, (area.r - area.l) / (x1 - x0), (area.b - area.t) / (y1 - y0));
  const vx = area.l + ((area.r - area.l) - (x1 - x0) * z) / 2 - x0 * z, vy = area.t + ((area.b - area.t) - (y1 - y0) * z) / 2 - y0 * z;
  await js(`__cam(${vx}, ${vy}, ${z}, ${ms})`);
}
const RIGHT = { l: 530, t: 70, r: W - 30, b: H - 110 }; // the board area beside the terminal
const cap = t => js(`__cap(${JSON.stringify(t || '')})`);
const term = {
  show: on => js(`__term.show(${on})`), clear: () => js('__term.clear()'),
  user: t => js(`__term.type(${JSON.stringify(t)})`),
  tool: async t => { await js(`__term.line(${JSON.stringify(t)}, 't')`); await sleep(500); },
  out: async t => { await js(`__term.line(${JSON.stringify(t)}, 'o')`); await sleep(250); },
  ok: async t => { await js(`__term.line(${JSON.stringify(t)}, 'ok')`); await sleep(400); },
};
const openBoard = async n => {
  await click(...await center('#boardBtn'));
  await sleep(350);
  await click(...await js(`(() => { const b = [...document.querySelectorAll('#boardMenu button')].find(b => b.textContent === ${JSON.stringify(n)}); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`));
  await sleep(700);
};

// ---------- the film ----------
async function film() {
  // Title
  await js(`__card('<h1>Slate</h1><p>A local whiteboard your AI agent can draw on</p>')`);
  await sleep(2600);

  // 1. Drawing by hand
  await js(`__card('')`); await sleep(500);
  await cap('Draw shapes and connect them');
  await key('r'); await drag(170, 250, 330, 340);
  await click(250, 295, { count: 2 }); await type('Idea', 10); await key('Escape');
  await click(...await center('#bar button[title="Color #007aff"]')); await click(...await center('#bar button[title="Fill shape"]'));
  await key('d'); await drag(470, 238, 660, 352);
  await click(565, 295, { count: 2 }); await type('Works?', 10); await key('Escape');
  await click(...await center('#bar button[title="Color #ff9500"]')); await click(...await center('#bar button[title="Fill shape"]'));
  await key('o'); await drag(800, 255, 970, 335);
  await click(885, 295, { count: 2 }); await type('Ship', 10); await key('Escape');
  await click(...await center('#bar button[title="Color #34c759"]')); await click(...await center('#bar button[title="Fill shape"]'));
  await key('a'); await drag(250, 295, 560, 300);
  await key('a'); await drag(570, 295, 880, 300);
  await click(640, 520); await sleep(300);
  await cap('Arrows stay attached when things move');
  await drag(885, 295, 905, 470, 900); await sleep(300);
  await drag(250, 295, 230, 470, 900); await sleep(500);
  await cap('Notes, text, freehand and numbered pins');
  await key('n'); await click(1010, 140); await type('Ask the team\nabout pricing', 14); await key('Escape');
  await key('p');
  await stroke(Array.from({ length: 28 }, (_, i) => { const a = -Math.PI / 2 + i / 26 * Math.PI * 2.1; return [905 + Math.cos(a) * 120, 470 + Math.sin(a) * 62]; }), 900);
  await key('m'); await click(560, 230); await click(870, 410); await key('Escape');
  await sleep(1300);

  // 2. The demo board: every kind of item
  await cap(''); await openBoard('demo');
  await cap('The demo board shows every kind of item'); await sleep(2300);
  const tour = [
    [[60, 160, 1400, 430], 'Text, sticky notes and callouts'],
    [[50, 460, 1400, 680], 'Shapes, arrows, freehand strokes and pins'],
    [[60, 690, 1400, 1130], 'Annotate a screenshot with its endpoints and JSON'],
    [[60, 1150, 1400, 1660], 'Metric cards, tables and charts'],
    [[60, 1690, 1400, 2150], 'Tasks, kanban and timelines'],
    [[60, 2180, 1400, 2530], 'Links, embeds and video'],
    [[60, 2560, 1400, 2860], 'Mermaid flowcharts become shapes you can edit'],
  ];
  for (const [r, t] of tour) { await cap(t); await frame(r, 1000); await sleep(2100); }
  await cap('Write Mermaid, watch the preview, insert it');
  await frame([1480, 2340, 2400, 3060], 1000); // empty space beside the board: the insert lands in the middle of the screen
  await click(...await center('#tools button[popovertarget=ins]')); await sleep(500);
  await click(...await center('#ins [data-ins=mermaid]')); await sleep(700);
  await click(...await center('#mmInput'));
  await js(`(() => { const t = document.querySelector('#mmInput'); t.selectionStart = t.selectionEnd = t.value.length; })()`);
  await type('\n  home --> cart[Your cart]', 14); await sleep(900);
  await type('\n  cart --> pay{Pay?}', 14); await sleep(1200);
  await click(...await center('#mermaid button[value=ok]')); await sleep(700);
  await key('f'); await sleep(1600); // fit the inserted flowchart, still selected
  await cap('Every open task in one panel');
  await click(...await center('#tasksBtn')); await sleep(2200);
  await click(...await center('#tasksBtn')); await sleep(300);

  // 3. With an agent
  const fitAll = (ms = 900, zmax = .95) => js('(() => { const b = bounds(board.items); return [b.x - 30, b.y - 50, b.x + b.w + 30, b.y + b.h + 30]; })()').then(r => frame(r, ms, RIGHT, zmax));
  await cap(''); await openBoard('checkout');
  await js('view.x = 600; view.y = 140; view.z = .85; applyView()');
  await term.show(true); await sleep(500);
  await cap('Ask the agent you already use');
  await term.user("Put our checkout flow on my Slate board, with this week's numbers and what to fix");
  await term.tool('slate map checkout'); await term.out('(empty board)');
  await term.tool('slate mermaid checkout  · the flow');
  slate(['mermaid', 'checkout', 'flowchart LR\n  cart[Cart] --> pay[Payment]\n  pay --> paid{Paid?}\n  paid -- yes --> done([Confirmation])\n  paid -- no --> pay', '--x=0', '--y=0']);
  await sleep(700); await fitAll(); await sleep(300);
  await cap('It edits plain files. The open board updates live');
  await term.tool('slate add checkout --at=below  · numbers');
  slate(['add', 'checkout', '--at=below', JSON.stringify([
    { id: 'k-conv', type: 'stat', x: 0, y: 0, label: 'Conversion', value: '3.8%', delta: '+0.3 pts' },
    { id: 'k-cart', type: 'stat', x: 220, y: 0, label: 'Abandoned carts', value: '61%', delta: '-4%', color: '#ff9500' },
    { id: 'k-aov', type: 'stat', x: 440, y: 0, label: 'Average order', value: '$42', delta: '+$3', color: '#007aff' },
  ])]);
  await sleep(500); await fitAll(); await sleep(300);
  await term.tool('slate add checkout --at=below  · what to fix');
  slate(['add', 'checkout', '--at=below', JSON.stringify([
    { id: 'leak', type: 'callout', x: 0, y: 0, w: 400, title: 'Biggest leak', text: '1 in 4 mobile users leave at the payment step.', color: '#ff3b30' },
    { id: 'week', type: 'tasks', x: 440, y: 0, w: 260, title: 'This week', tasks: [{ text: 'Add Apple Pay', done: false }, { text: 'Shorten the card form', done: false }, { text: 'Save the cart on exit', done: true }] },
  ])]);
  await sleep(500); await fitAll(); await sleep(300);
  await term.tool('slate set checkout mm-pay  · red');
  slate(['set', 'checkout', 'mm-pay', '{"color":"#ff3b30","fill":true}']);
  await sleep(500);
  await term.ok('Marked the payment step as the problem'); await sleep(1300);

  await term.show(false);
  await cap('Still your board: drag, edit, undo');
  const [sx, sy] = await item('k-aov');
  await drag(sx, sy, sx + 60, sy + 90, 800); await sleep(600);
  await key('z', 4); await sleep(900);
  await click(...await item('k-conv'), { count: 2 }); await sleep(900);
  await click(...await js(`(() => { const r = document.querySelector('.item[data-id="week"]').getBoundingClientRect(); return [r.x + r.width - 30, r.y + 14]; })()`)); await sleep(400);
  await term.show(true);
  await cap('Select something and tell the agent “this”');
  await term.user('Turn this list into a kanban, with a short brief on each card');
  await term.tool('slate selection'); await term.out('week  tasks "This week"');
  await term.tool('slate add checkout --at=below  · kanban');
  slate(['rm', 'checkout', 'week']);
  slate(['add', 'checkout', '--at=below', JSON.stringify({ id: 'kb', type: 'kanban', x: 0, y: 0, w: 700, columns: [
    { title: 'To do', cards: ['Add Apple Pay\nButton above the card fields; the form stays as the fallback', 'Shorten the card form\nDrop the name field, detect the card type from the number'] },
    { title: 'Doing', cards: [] }, { title: 'Done', cards: ['Save the cart on exit'] }] })]);
  await sleep(500); await fitAll();
  await term.ok('Replaced the list with a kanban'); await sleep(1000);

  await cap('Cards carry the brief. The agent takes one and moves it to Done');
  await term.user('Take the first card');
  await term.tool('slate cards checkout'); await term.out('To do  Add Apple Pay · Button above the card fields…');
  await term.tool('slate move checkout "Add Apple Pay" Doing'); slate(['move', 'checkout', 'Add Apple Pay', 'Doing']); await sleep(900);
  await term.out('Editing src/checkout/PaymentForm.tsx…'); await sleep(1300);
  await term.out('Tests pass'); await sleep(400);
  await term.tool('slate move checkout "Add Apple Pay" Done'); slate(['move', 'checkout', 'Add Apple Pay', 'Done', '--note=Shipped behind the apple_pay flag']); await sleep(900);
  await term.ok('Done. Next up: Shorten the card form'); await sleep(1500);

  await term.show(false); await term.clear();
  await cap('Sketch by hand. The agent looks at the board');
  const B = await js('(() => { const b = bounds(board.items); return [b.x + b.w, b.y]; })()'), X = B[0] + 120, Y = B[1];
  await frame([X - 60, Y - 40, X + 760, Y + 520], 1000, RIGHT, .9);
  await key('p');
  const S = (x0, y0) => js(`[${x0} * view.z + view.x, ${y0} * view.z + view.y]`); // world → screen
  const box = async (x, y, w, h) => { const [a, b] = await S(x, y), [c, d] = await S(x + w, y + h); await stroke([[a, b], [c, b + 2], [c - 1, d], [a + 1, d - 1], [a, b + 3]], 650); };
  await box(X, Y, 240, 420);
  await box(X + 30, Y + 60, 180, 46);
  await box(X + 30, Y + 130, 80, 46); await box(X + 130, Y + 130, 80, 46);
  const [bx, by] = await S(X + 40, Y + 240), [bx2] = await S(X + 200, Y + 240);
  await stroke(Array.from({ length: 12 }, (_, i) => [bx + (bx2 - bx) * i / 11, by + (i % 2 ? 16 : 0)]), 700);
  await key('Escape');
  await term.show(true);
  await term.user('Build the form I sketched, next to it');
  await term.tool('slate shot checkout'); slate(['shot', 'checkout']); await term.out('data/shots/checkout.png');
  await term.tool('slate add checkout  · payment form');
  const F = X + 340;
  slate(['add', 'checkout', JSON.stringify([
    { id: 'pf', type: 'frame', x: F, y: Y, w: 320, h: 380, title: 'Payment' },
    { id: 'pf-card', type: 'shape', shape: 'rect', x: F + 40, y: Y + 50, w: 240, h: 46, text: 'Card number', align: 'left', color: '#8e8e93' },
    { id: 'pf-exp', type: 'shape', shape: 'rect', x: F + 40, y: Y + 116, w: 110, h: 46, text: 'MM / YY', align: 'left', color: '#8e8e93' },
    { id: 'pf-cvc', type: 'shape', shape: 'rect', x: F + 170, y: Y + 116, w: 110, h: 46, text: 'CVC', align: 'left', color: '#8e8e93' },
    { id: 'pf-pay', type: 'shape', shape: 'rect', x: F + 40, y: Y + 200, w: 240, h: 50, text: 'Pay $42', color: '#007aff', fill: true, bold: true },
  ])]);
  await sleep(400);
  await term.ok('Built it in a "Payment" frame'); await sleep(1300);

  await cap('Or direct it from the board');
  await term.user('Watch the board and do what my notes say');
  await term.tool('slate wait checkout');
  const waiting = new Promise(res => { const p = spawn('node', [path.join(ROOT, 'cli.js'), 'wait', 'checkout', '--quiet=1', '--timeout=40'], { env }); let o = ''; p.stdout.on('data', d => o += d); p.on('close', () => res(o)); });
  await sleep(600);
  const [px, py] = await item('pf-pay');
  await key('n'); await click(px + 150, py + 40); await type('Make this green', 12); await key('Escape');
  await click(...await S(F + 160, Y + 470));
  const changed = JSON.parse(await waiting), note = changed.added?.find(i => i.type === 'note');
  await term.out(`added: note "${note?.text ?? 'Make this green'}"`);
  await term.tool('slate set checkout pf-pay  · green');
  slate(['set', 'checkout', 'pf-pay', '{"color":"#34c759"}']);
  if (note) slate(['rm', 'checkout', note.id]);
  await sleep(600);
  await term.ok('Pay button is green; removed the note'); await sleep(1600);
  await term.show(false);

  // 4. Around the app
  await cap('Search every board with ⌘K');
  await key('k', 4); await sleep(500);
  await type('apple pay', 10); await sleep(1500);
  await key('Enter'); await sleep(1500);
  await cap('Share it as one HTML file, or a vector PDF');
  await move(...await center('#shareBtn'), 700); await sleep(1100);
  await move(...await center('#pdfBtn'), 500); await sleep(1100);
  await cap('Dock the toolbar on any side');
  for (let n = 0; n < 4; n++) { await click(...await center('#dockBtn')); await sleep(900); }
  await cap('One line to install. Works with Claude Code, Codex and Copilot'); // shown first: the dialog's backdrop covers it
  await move(...await center('#helpBtn'), 700); await sleep(1400);
  await click(...await center('#helpBtn'), { ms: 100 }); await sleep(3600);
  await key('Escape'); await cap(''); await sleep(400);

  // Outro
  await js(`__card('<h1>Slate</h1><p>Local. Plain JSON files. No account, no cloud.</p><small>admcilgin.github.io/slate</small>')`);
  await sleep(3500);
}

// ---------- record ----------
await connect();
await cdp('Page.enable'); await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false });
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: OVERLAY });
// the help dialog's install line shows the public address, not this throwaway server
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('load', () => document.querySelectorAll('code.install').forEach(c => c.textContent = 'curl -fsSL https://admcilgin.github.io/slate/install.sh | sh'))` });
for (let n = 0; n < 50; n++) { try { await fetch(`http://127.0.0.1:${PORT}/api/boards`); break; } catch { await sleep(100); } }
await cdp('Page.navigate', { url: `http://localhost:${PORT}/#sketch` });
await sleep(2500);
await js(`document.fonts.ready.then(() => true)`);

const stamps = [];
handlers['Page.screencastFrame'] = ({ data, metadata, sessionId }) => {
  fs.writeFileSync(path.join(FRAMES, String(stamps.length).padStart(6, '0') + '.jpg'), Buffer.from(data, 'base64'));
  stamps.push(metadata.timestamp);
  cdp('Page.screencastFrameAck', { sessionId });
};
await cdp('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W * DPR, maxHeight: H * DPR });
await sleep(300);
try { await film(); } finally { await cdp('Page.stopScreencast'); }
console.log(`${stamps.length} frames over ${(stamps.at(-1) - stamps[0]).toFixed(1)} s`);

// Frames arrive only when the screen changes, so each one is held until the next.
const list = stamps.map((t, n) => `file '${path.join(FRAMES, String(n).padStart(6, '0') + '.jpg')}'\nduration ${((stamps[n + 1] ?? t + .5) - t).toFixed(4)}`).join('\n');
fs.writeFileSync(path.join(TMP, 'frames.txt'), list + `\nfile '${path.join(FRAMES, String(stamps.length - 1).padStart(6, '0') + '.jpg')}'\n`);
const total = stamps.at(-1) - stamps[0] + .5;
const ff = ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(TMP, 'frames.txt')];
if (MUSIC) ff.push('-stream_loop', '-1', '-i', MUSIC);
ff.push('-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-movflags', '+faststart');
if (MUSIC) ff.push('-af', `volume=0.55,afade=t=in:d=1.5,afade=t=out:st=${(total - 3).toFixed(2)}:d=3`, '-c:a', 'aac', '-b:a', '160k', '-t', total.toFixed(2), '-shortest');
execFileSync('ffmpeg', [...ff, OUT], { stdio: 'inherit' });
execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '86', '-i', OUT, '-frames:v', '1', '-vf', 'scale=1280:-1', '-q:v', '3', POSTER]);
console.log(OUT, `${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
quit();
fs.rmSync(TMP, { recursive: true, force: true });
