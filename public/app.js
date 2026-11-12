// Slate — canvas logic. The board is plain JSON (see AGENTS.md); every item is one absolutely positioned DOM node.
const $ = s => document.querySelector(s);
const stage = $('#stage'), world = $('#world'), marq = $('#marq'), bar = $('#bar'), panel = $('#panel');

const PAL = ['', '#8e8e93', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de'];
const SERIES = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#ffcc00', '#8e8e93'];
const AUTO = new Set(['text', 'tasks', 'table', 'link', 'code']);   // height grows with content
const LIVE = new Set(['image', 'video', 'embed']);          // never rebuilt while moving/resizing (would reload media)
const TEXTY = new Set(['text', 'note', 'shape']);
const KEYS = { v: 'select', h: 'hand', p: 'draw', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', t: 'text', n: 'note', m: 'pin' };
const DEF = {
  text: { w: 240, h: 28, text: '' },
  note: { w: 200, h: 200, text: '', color: '#ffcc00' },
  shape: { w: 160, h: 100, shape: 'rect', text: '', align: 'center' },
  line: {}, draw: {},
  code: { w: 340, h: 60, title: '', text: '' },
  pin: { w: 28, h: 28, text: '1' },
  image: { w: 320, h: 220 }, video: { w: 400, h: 225 }, embed: { w: 480, h: 300 }, link: { w: 300, h: 62 },
  table: { w: 380, h: 110, rows: [['', '', ''], ['', '', ''], ['', '', '']] },
  tasks: { w: 260, h: 90, title: 'Tasks', tasks: [{ text: '', done: false }] },
  chart: { w: 340, h: 240, chart: 'bar', title: 'Chart', data: [{ label: 'A', value: 3 }, { label: 'B', value: 5 }, { label: 'C', value: 2 }] },
  timeline: { w: 560, h: 170, title: 'Timeline', events: [{ date: '2026-01-01', label: 'Start' }, { date: '2026-06-01', label: 'Milestone' }] },
};

let board = { items: [] }, sel = new Set(), editing = null, tool = 'select';
let view = { x: 0, y: 0, z: 1 }, name = ''; // name = current board (data/boards/<name>.json)
const api = n => '/api/board?b=' + encodeURIComponent(n);
const els = new Map();

const uid = () => Math.random().toString(36).slice(2, 9);
const r = n => Math.round(n * 10) / 10;
const byId = id => board.items.find(i => i.id === id);
const selected = () => board.items.filter(i => sel.has(i.id));
const isPts = i => i.type === 'line' || i.type === 'draw';
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const isHttp = u => /^https?:\/\//i.test(u || '');
const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const center = () => ({ x: r((innerWidth / 2 - view.x) / view.z), y: r((innerHeight / 2 - view.y) / view.z) });

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...kids.filter(k => k != null));
  return e;
}

// Fill defaults and, for lines/strokes, make x/y/w/h the bounding box of the points.
function norm(i) {
  i.id ??= uid();
  for (const [k, v] of Object.entries(DEF[i.type] || {})) i[k] ??= structuredClone(v);
  i.x ??= 0; i.y ??= 0;
  if (i.type === 'code' && typeof i.text !== 'string') i.text = JSON.stringify(i.text, null, 2); // agents may store raw JSON
  if (isPts(i)) {
    if (!Array.isArray(i.points) || !i.points.length) i.points = [[0, 0], [120, 0]];
    const xs = i.points.map(p => p[0]), ys = i.points.map(p => p[1]), mx = Math.min(...xs), my = Math.min(...ys);
    i.points = i.points.map(p => [r(p[0] - mx), r(p[1] - my)]);
    i.x = r(i.x + mx); i.y = r(i.y + my); i.w = r(Math.max(...xs) - mx); i.h = r(Math.max(...ys) - my);
  }
  i.w ??= 200; i.h ??= 120;
  return i;
}

// ---------- rendering ----------

const tstyle = i => `font-size:${+i.size || 15}px;font-weight:${i.bold ? 600 : 400};font-style:${i.italic ? 'italic' : 'normal'};text-align:${i.align || 'left'};line-height:1.35;`;

// Text bound to obj[key]; editable only while its item is being edited.
function bind(o, key, cls, ed) {
  const d = h('div', { className: cls, textContent: o[key] || '' });
  if (ed) { d.contentEditable = 'plaintext-only'; d.oninput = () => { o[key] = d.innerText.replace(/\n$/, ''); dirty(); }; }
  return d;
}

// "label, value" lines edited in a textarea — the whole data editor for charts and timelines.
function listEdit(b, lines, parse) {
  const ta = h('textarea', { value: lines.join('\n'), spellcheck: false });
  ta.oninput = () => { parse(ta.value.split('\n').map(l => l.trim()).filter(Boolean)); dirty(); };
  b.append(ta);
}

// Light syntax colouring for JSON (and passable for most code): keys, strings, numbers, literals.
const hl = s => s.replace(/("(?:[^"\\]|\\.)*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)|[&<>]/g,
  (m, str, colon, kw, num) => str ? `<span class="${colon ? 'k' : 's'}">${esc(str)}</span>${colon || ''}` : kw ? `<span class="b">${m}</span>` : num ? `<span class="n">${m}</span>` : esc(m));

function ptsSVG(i) {
  const c = esc(i.color || 'currentColor'), sw = +i.width || 2, p = i.points;
  let d = `M${p[0]}`;
  if (i.type === 'draw' && p.length > 2) { // smooth freehand through midpoints
    for (let k = 1; k < p.length - 1; k++) d += `Q${p[k]} ${(p[k][0] + p[k + 1][0]) / 2},${(p[k][1] + p[k + 1][1]) / 2}`;
    d += `L${p.at(-1)}`;
  } else d += p.slice(1).map(q => `L${q}`).join('');
  let head = '';
  if (i.arrow && p.length > 1) {
    const [x2, y2] = p.at(-1), [x1, y1] = p.at(-2), t = Math.atan2(y2 - y1, x2 - x1), L = 8 + sw * 2;
    head = `<path d="M${x2 - L * Math.cos(t - .45)},${y2 - L * Math.sin(t - .45)}L${x2},${y2}L${x2 - L * Math.cos(t + .45)},${y2 - L * Math.sin(t + .45)}" stroke="${c}" stroke-width="${sw}"/>`;
  }
  return `<svg width="${i.w || 1}" height="${i.h || 1}"><path class="hit" d="${d}"/><path d="${d}" stroke="${c}" stroke-width="${sw}"/>${head}</svg>`;
}

function chartSVG(i) {
  const W = Math.max(120, i.w - 32), H = Math.max(70, i.h - 62), d = i.data || [], c = esc(i.color || '#007aff'), n = d.length || 1;
  let s = '';
  if (i.chart === 'pie') {
    const tot = d.reduce((a, x) => a + Math.max(0, +x.value || 0), 0) || 1, rad = Math.min(W * .45, H) / 2 - 2, cx = rad + 2, cy = H / 2;
    let a = -Math.PI / 2;
    d.forEach((x, k) => {
      const b = a + Math.min(Math.max(0, +x.value || 0) / tot, .9999) * 2 * Math.PI, col = SERIES[k % SERIES.length], ly = cy - n * 9 + k * 18 + 12;
      s += `<path d="M${cx},${cy}L${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}A${rad},${rad} 0 ${b - a > Math.PI ? 1 : 0} 1 ${cx + rad * Math.cos(b)},${cy + rad * Math.sin(b)}Z" fill="${col}"/>`
        + `<circle cx="${cx * 2 + 16}" cy="${ly - 4}" r="4" fill="${col}"/><text class="l" x="${cx * 2 + 26}" y="${ly}">${esc(x.label)} · ${esc(x.value)}</text>`;
      a = b;
    });
  } else {
    const max = Math.max(...d.map(x => +x.value || 0), 1), bw = W / n, ph = H - 36;
    const X = k => bw * k + bw / 2, Y = v => 16 + ph - Math.max(0, +v || 0) / max * ph;
    if (i.chart === 'line') s += `<polyline fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" points="${d.map((x, k) => X(k) + ',' + Y(x.value)).join(' ')}"/>`;
    d.forEach((x, k) => {
      const y = Y(x.value), w = Math.min(bw * .62, 56);
      s += i.chart === 'line' ? `<circle cx="${X(k)}" cy="${y}" r="3.5" fill="${c}"/>` : `<rect x="${X(k) - w / 2}" y="${y}" width="${w}" height="${Math.max(0, 16 + ph - y)}" rx="${Math.min(5, w / 2)}" fill="${c}"/>`;
      s += `<text x="${X(k)}" y="${y - 6}">${esc(x.value)}</text><text x="${X(k)}" y="${H - 4}">${esc(x.label)}</text>`;
    });
  }
  return `<svg width="${W}" height="${H}">${s}</svg>`;
}

// One renderer per item type: (item, body, editing?, element)
const R = {
  text(i, b, ed) { b.style.cssText = tstyle(i) + (i.color ? `color:${i.color}` : ''); b.append(bind(i, 'text', 'txt', ed)); },
  note(i, b, ed) { b.style.cssText = tstyle(i) + `background:color-mix(in srgb, ${i.color || '#ffcc00'} 30%, var(--card))`; b.append(bind(i, 'text', 'txt', ed)); },
  shape(i, b, ed, e) {
    const c = i.color || 'var(--ink)';
    if (i.shape === 'ellipse') e.classList.add('ellipse');
    b.style.cssText = tstyle(i) + `border-color:${c};` + (i.fill ? `background:color-mix(in srgb, ${c} 16%, transparent)` : '');
    b.append(bind(i, 'text', 'txt', ed));
  },
  line(i, b, ed) {
    b.innerHTML = ptsSVG(i);
    if (!ed && !i.label) return;
    const p = i.points, a = p[Math.floor((p.length - 1) / 2)], c = p[Math.ceil((p.length - 1) / 2)], l = bind(i, 'label', 'lbl', ed);
    l.style.cssText = `left:${(a[0] + c[0]) / 2}px;top:${(a[1] + c[1]) / 2}px`; // label sits on the middle of the line
    b.append(l);
  },
  code(i, b, ed) {
    if (ed || i.title) b.append(bind(i, 'title', 'title', ed));
    if (!ed) {
      const lines = (i.text || '').split('\n'), long = lines.length > 8, cut = long && i.collapsed;
      b.append(h('pre', { className: 'txt', innerHTML: hl(cut ? lines.slice(0, 6).join('\n') : i.text || '') }));
      if (cut) b.append(h('div', { className: 'more', textContent: `… ${lines.length - 6} more lines` }));
      const copy = h('button', { textContent: 'Copy', title: 'Copy to clipboard', onclick: () => navigator.clipboard.writeText(i.text || '').then(() => { copy.textContent = 'Copied'; setTimeout(() => copy.textContent = 'Copy', 1200); }) });
      const fold = long ? h('button', { textContent: i.collapsed ? 'Expand' : 'Collapse', onclick: () => { if (i.collapsed) delete i.collapsed; else i.collapsed = true; refresh(i); relink(new Set([i.id])); commit(); } }) : null;
      return b.append(h('div', { className: 'tools' }, fold, copy));
    }
    const tx = bind(i, 'text', 'txt', ed);
    tx.onkeydown = ev => { if (ev.key === 'Tab') { ev.preventDefault(); document.execCommand('insertText', false, '  '); } };
    b.append(tx);
  },
  draw(i, b) { b.innerHTML = ptsSVG(i); },
  pin(i, b, ed) {
    b.style.cssText = `background:${i.color || '#ff3b30'};font-size:${Math.max(10, Math.min(i.w, i.h) * .5)}px`;
    b.append(bind(i, 'text', 'txt', ed));
  },
  image(i, b) { b.append(h('img', { src: i.src || '', alt: i.alt || '', draggable: false })); },
  video(i, b) { b.append(h('video', { src: i.src || '', controls: true, preload: 'metadata' })); },
  embed(i, b) {
    if (!isHttp(i.url)) return b.append(h('div', { className: 'bad', textContent: 'Embed needs an http(s) URL' }));
    b.append(h('iframe', { src: embedURL(i.url), loading: 'lazy', allow: 'fullscreen; autoplay; encrypted-media; picture-in-picture', title: host(i.url) }));
  },
  link(i, b, ed) {
    if (i.title == null) i.title = host(i.url);
    b.append(h('div', { className: 'meta' }, bind(i, 'title', 'title', ed), h('div', { className: 'url', textContent: i.url || '' })));
    if (isHttp(i.url)) b.append(h('a', { href: i.url, target: '_blank', rel: 'noopener', textContent: '↗', title: 'Open link' }));
  },
  table(i, b, ed) {
    const t = h('table');
    i.rows.forEach(row => {
      const tr = h('tr');
      row.forEach((c, ci) => {
        const td = h('td', { textContent: c ?? '' });
        if (ed) { td.contentEditable = 'plaintext-only'; td.oninput = () => { row[ci] = td.innerText.replace(/\n$/, ''); dirty(); }; }
        tr.append(td);
      });
      t.append(tr);
    });
    b.append(t);
  },
  tasks(i, b, ed) {
    const today = new Date().toLocaleDateString('sv');
    const focus = n => els.get(i.id).querySelectorAll('.task .txt')[n]?.focus();
    b.append(bind(i, 'title', 'title', ed));
    i.tasks.forEach((t, n) => {
      const cb = h('input', { type: 'checkbox', checked: !!t.done, ariaLabel: 'Done' });
      cb.onchange = () => { t.done = cb.checked; refresh(i); commit(); };
      const tx = bind(t, 'text', 'txt', ed);
      tx.onkeydown = ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); i.tasks.splice(n + 1, 0, { text: '', done: false }); refresh(i); focus(n + 1); dirty(); }
        else if (ev.key === 'Backspace' && !t.text && i.tasks.length > 1) { ev.preventDefault(); i.tasks.splice(n, 1); refresh(i); focus(Math.max(0, n - 1)); dirty(); }
      };
      const due = h('input', { type: 'date', value: t.due || '', className: 'due' + (t.due ? ' set' : '') + (t.due && !t.done && t.due < today ? ' late' : ''), ariaLabel: 'Due date' });
      due.onchange = () => { if (due.value) t.due = due.value; else delete t.due; refresh(i); commit(); };
      b.append(h('div', { className: 'task' + (t.done ? ' done' : '') }, cb, tx, due));
    });
  },
  chart(i, b, ed) {
    b.append(bind(i, 'title', 'title', ed));
    if (!ed) return b.append(h('div', { className: 'plot', innerHTML: chartSVG(i) }));
    listEdit(b, i.data.map(d => `${d.label}, ${d.value}`), ls => i.data = ls.map(l => {
      const k = l.lastIndexOf(',');
      return k < 0 ? { label: l, value: 0 } : { label: l.slice(0, k).trim(), value: +l.slice(k + 1) || 0 };
    }));
  },
  timeline(i, b, ed) {
    b.append(bind(i, 'title', 'title', ed));
    if (ed) return listEdit(b, i.events.map(e => `${e.date}, ${e.label}`), ls => i.events = ls.map(l => {
      const k = l.indexOf(',');
      return k < 0 ? { date: l, label: '' } : { date: l.slice(0, k).trim(), label: l.slice(k + 1).trim() };
    }));
    const ev = [...i.events].sort((a, c) => String(a.date) < String(c.date) ? -1 : 1), t = ev.map(e => Date.parse(e.date));
    const dated = t.every(x => !isNaN(x)), min = Math.min(...t), span = Math.max(...t) - min;
    const tl = h('div', { className: 'tl', style: `--c:${i.color || 'var(--accent)'}` });
    ev.forEach((e, k) => {
      const pos = ev.length < 2 ? 50 : (dated && span ? (t[k] - min) / span : k / (ev.length - 1)) * 100; // undated → evenly spaced
      tl.append(h('div', { className: 'ev ' + (k % 2 ? 'dn' : 'up'), style: `left:${pos}%` }, h('b', { textContent: e.label }), h('span', { textContent: e.date })));
    });
    b.append(tl);
  },
};

function embedURL(u) {
  let m;
  if (m = /(?:youtube\.com\/(?:watch\?.*?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/.exec(u)) return 'https://www.youtube.com/embed/' + m[1];
  if (m = /vimeo\.com\/(\d+)/.exec(u)) return 'https://player.vimeo.com/video/' + m[1];
  if (/figma\.com\/(file|design|board|proto)\//.test(u)) return 'https://www.figma.com/embed?embed_host=slate&url=' + encodeURIComponent(u);
  return u.replace('loom.com/share/', 'loom.com/embed/');
}

function place(i) {
  const e = els.get(i.id);
  if (!e) return;
  e.style.cssText = `left:${i.x}px;top:${i.y}px;width:${i.w}px;${AUTO.has(i.type) ? 'min-height' : 'height'}:${i.h}px`;
  e.classList.toggle('sel', sel.has(i.id));
  e.classList.toggle('editing', editing === i.id);
}

function refresh(i) {
  const e = h('div', { className: 'item ' + i.type }), b = h('div', { className: 'body' }), old = els.get(i.id);
  e.dataset.id = i.id;
  e.append(b);
  if (R[i.type]) R[i.type](i, b, editing === i.id, e); else b.textContent = `Unknown type: ${i.type}`;
  if (i.type === 'line') [0, 1].forEach(end => { // lines get a draggable handle on each end instead of a resize corner
    const q = i.points[end ? i.points.length - 1 : 0], d = h('div', { className: 'ep', style: `left:${q[0]}px;top:${q[1]}px` });
    d.dataset.end = end; e.append(d);
  });
  else e.append(h('div', { className: 'rz' }));
  els.set(i.id, e);
  old ? old.replaceWith(e) : world.append(e);
  place(i);
}

function render() {
  world.replaceChildren(marq);
  els.clear();
  board.items.forEach(refresh);
  for (const l of board.items) if (l.type === 'line' && (l.from || l.to) && route(l)) refresh(l); // real heights are known only now
  syncUI();
}

// ---------- connectors: a line's `from` / `to` hold the id of the item that end is attached to ----------

const box = i => ({ x: i.x, y: i.y, w: i.w, h: AUTO.has(i.type) ? Math.max(i.h, els.get(i.id)?.offsetHeight || 0) : i.h });
const mid = i => { const b = box(i); return [b.x + b.w / 2, b.y + b.h / 2]; };

// Where a ray from the item's centre towards point t leaves the item (plus a small gap).
function edge(i, t) {
  const b = box(i), cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = t[0] - cx, dy = t[1] - cy, hw = b.w / 2 + 6, hh = b.h / 2 + 6;
  if (!dx && !dy) return [cx, cy];
  const k = i.type === 'pin' || i.shape === 'ellipse' ? 1 / Math.hypot(dx / hw, dy / hh) : Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
  return [r(cx + dx * k), r(cy + dy * k)];
}

// Re-aim a line's attached ends at their items. Returns false if nothing is attached.
function route(l) {
  for (const k of ['from', 'to']) { const t = byId(l[k]); if (l[k] != null && (!t || isPts(t))) delete l[k]; }
  const a = byId(l.from), b = byId(l.to);
  if (!a && !b) return false;
  const P = l.points.map(q => [q[0] + l.x, q[1] + l.y]);
  if (P.length < 2) P.push([...P[0]]);
  const n = P.length;
  if (a) P[0] = edge(a, n > 2 || !b ? P[1] : mid(b));
  if (b) P[n - 1] = edge(b, n > 2 || !a ? P[n - 2] : mid(a));
  l.x = 0; l.y = 0; l.points = P;
  norm(l);
  return true;
}

// Items in `ids` moved or changed size: lines attached to them follow.
function relink(ids) { for (const l of board.items) if (l.type === 'line' && (ids.has(l.from) || ids.has(l.to)) && route(l)) refresh(l); }

let marked = null;
function mark(el) { if (marked === el) return; marked?.classList.remove('target'); el?.classList.add('target'); marked = el; }

// Drag one end of a line to p; if it is over another item, attach to it.
function setEnd(l, end, p, e) {
  const P = l.points.map(q => [q[0] + l.x, q[1] + l.y]), key = end ? 'to' : 'from', other = l[end ? 'from' : 'to'];
  P[end ? P.length - 1 : 0] = [p.x, p.y];
  l.x = 0; l.y = 0; l.points = P;
  const hit = document.elementsFromPoint(e.clientX, e.clientY).map(x => x.closest('.item'))
    .find(x => x && x.dataset.id !== l.id && x.dataset.id !== other && !isPts(byId(x.dataset.id) || l));
  if (hit) l[key] = hit.dataset.id; else delete l[key];
  mark(hit || null);
  if (!route(l)) norm(l);
  refresh(l);
}

function applyView() {
  world.style.transform = `translate(${view.x}px,${view.y}px) scale(${view.z})`;
  const g = 24 * view.z * (view.z < .5 ? 2 : 1);
  stage.style.backgroundSize = `${g}px ${g}px`;
  stage.style.backgroundPosition = `${view.x}px ${view.y}px`;
  $('#zoom').textContent = Math.round(view.z * 100) + '%';
  try { if (name) localStorage['view:' + name] = JSON.stringify(view); } catch {}
}

function focusItem(i) {
  view.x = innerWidth / 2 - (i.x + i.w / 2) * view.z;
  view.y = innerHeight / 2 - (i.y + i.h / 2) * view.z;
  sel = new Set([i.id]);
  applyView(); syncUI();
}

// ---------- history + persistence ----------

let hist = [], fut = [], last = '', saveT, dirtyT;

function commit() {
  clearTimeout(dirtyT);
  const s = JSON.stringify(board);
  if (s === last) return;
  hist.push(last); if (hist.length > 200) hist.shift();
  fut = []; last = s;
  save(); syncUI();
}
const dirty = () => { clearTimeout(dirtyT); dirtyT = setTimeout(commit, 500); };

// ponytail: whole-board last-write-wins; an agent write landing inside this 250ms window is overwritten. Per-item merge if that ever bites.
function save() { clearTimeout(saveT); saveT = setTimeout(flush, 250); }
function flush() {
  if (!saveT || !name) return;
  clearTimeout(saveT); saveT = null;
  return fetch(api(name), { method: 'PUT', body: last }).then(res => { $('#status').hidden = res.ok; }, () => { $('#status').hidden = false; });
}

function travel(from, to) {
  if (!from.length) return;
  to.push(last); last = from.pop();
  board = JSON.parse(last); sel.clear(); editing = null;
  render(); save();
}
const undo = () => travel(hist, fut), redo = () => travel(fut, hist);

async function load(remote) {
  if (drag) return setTimeout(() => load(remote), 300); // don't swap the board under an active gesture
  let b;
  const n = name;
  try { b = await (await fetch(api(n))).json(); } catch { return; }
  if (n !== name || !b || !Array.isArray(b.items)) return; // switched boards while fetching
  const seen = new Set();
  b.items = b.items.filter(i => i && i.type).map(norm);
  b.items.forEach(i => { if (seen.has(i.id)) i.id = uid(); seen.add(i.id); });
  const s = JSON.stringify(b);
  if (s === last) return;
  if (remote) hist.push(last); // agent edits are undoable too
  board = b; last = s; editing = null;
  sel = new Set([...sel].filter(byId));
  render();
}

// ---------- editing ----------

function add(props) {
  const i = norm({ ...props, id: uid() });
  board.items.push(i);
  refresh(i);
  sel = new Set([i.id]); tool = 'select';
  commit(); syncUI();
  return i;
}

function startEdit(i) {
  if (i.type === 'draw' || i.type === 'image') return;
  editing = i.id; sel = new Set([i.id]);
  LIVE.has(i.type) ? place(i) : refresh(i);
  const f = els.get(i.id).querySelector(i.type === 'code' ? '.txt' : '[contenteditable],textarea');
  // after the current click finishes: its default action would otherwise move focus to whatever was under the pointer
  if (f) setTimeout(() => { if (editing !== i.id || !f.isConnected) return; f.focus(); getSelection().selectAllChildren(f); getSelection().collapseToEnd(); });
  syncUI();
}

function stopEdit() {
  const i = byId(editing);
  editing = null;
  if (i) {
    if (i.type === 'code') try { i.text = JSON.stringify(JSON.parse(i.text), null, 2); } catch {} // valid JSON gets pretty-printed
    if (i.type === 'line' && !i.label?.trim()) delete i.label;
    if (i.type === 'text' && !i.text.trim()) { board.items = board.items.filter(x => x !== i); els.get(i.id)?.remove(); els.delete(i.id); sel.delete(i.id); }
    else { LIVE.has(i.type) ? place(i) : refresh(i); relink(new Set([i.id])); }
  }
  commit(); syncUI();
}

function apply(fn) { selected().forEach(i => { fn(i); refresh(i); }); commit(); syncUI(); }
function del() { if (!sel.size) return; board.items = board.items.filter(i => !sel.has(i.id)); sel.clear(); render(); commit(); }
// Add copies of items, shifted by dx/dy. Connectors between copied items stay connected; others are detached.
function insert(items, dx, dy) {
  if (!items.length) return;
  const ids = new Map(items.map(i => [i.id, uid()]));
  const copies = items.map(i => {
    const c = { ...structuredClone(i), id: ids.get(i.id), x: r(i.x + dx), y: r(i.y + dy) };
    for (const k of ['from', 'to']) if (c[k] != null) { if (ids.has(c[k])) c[k] = ids.get(c[k]); else delete c[k]; }
    return c;
  });
  board.items.push(...copies); sel = new Set(copies.map(i => i.id)); render(); commit();
}
const dup = () => insert(selected(), 24, 24);

function pasteItems(items) {
  items = items.filter(i => i && DEF[i.type]).map(i => norm(structuredClone(i)));
  if (!items.length) return;
  const x0 = Math.min(...items.map(i => i.x)), x1 = Math.max(...items.map(i => i.x + i.w));
  const y0 = Math.min(...items.map(i => i.y)), y1 = Math.max(...items.map(i => i.y + i.h)), c = center();
  insert(items, c.x - (x0 + x1) / 2, c.y - (y0 + y1) / 2); // land in the middle of the view, on whichever board is open
}
function reorder(front) {
  const S = selected(), rest = board.items.filter(i => !sel.has(i.id));
  board.items = front ? [...rest, ...S] : [...S, ...rest];
  render(); commit();
}
function setTool(t) { tool = t; syncUI(); }

function syncUI() {
  for (const [id, e] of els) { e.classList.toggle('sel', sel.has(id)); e.classList.toggle('editing', editing === id); }
  document.querySelectorAll('#tools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  stage.dataset.tool = tool;

  const S = selected(), f = S[0];
  bar.hidden = !S.length;
  bar.replaceChildren();
  if (f) {
    const has = t => S.some(t), sep = () => bar.append(h('i'));
    const btn = (label, title, fn, on, raw) => bar.append(h('button', { textContent: label, title, ariaLabel: title, className: on ? 'on' : '', onclick: raw ? fn : () => apply(fn) }));
    PAL.forEach(c => bar.append(h('button', { className: 'sw' + ((f.color || '') === c ? ' on' : ''), style: `--c:${c || 'var(--ink)'}`, title: c ? 'Color ' + c : 'Default color', ariaLabel: c ? 'Color ' + c : 'Default color', onclick: () => apply(i => { if (c) i.color = c; else delete i.color; }) })));
    if (has(i => TEXTY.has(i.type))) {
      sep();
      [['S', 13], ['M', 15], ['L', 24], ['XL', 40]].forEach(([l, s]) => btn(l, 'Text size ' + l, i => i.size = s, (f.size || 15) === s));
      btn('B', 'Bold', i => i.bold = !i.bold, f.bold);
      btn('I', 'Italic', i => i.italic = !i.italic, f.italic);
      btn({ left: '⇤', center: '↔', right: '⇥' }[f.align || 'left'], 'Alignment', i => i.align = { left: 'center', center: 'right', right: 'left' }[i.align || 'left']);
    }
    if (has(i => i.type === 'shape')) btn('Fill', 'Fill shape', i => { if (i.type === 'shape') i.fill = !i.fill; }, f.fill);
    if (has(isPts)) { sep(); btn({ 2: 'Thin', 4: 'Medium', 8: 'Thick' }[f.width || 2] || 'Thin', 'Stroke width', i => { if (isPts(i)) i.width = { 2: 4, 4: 8, 8: 2 }[i.width || 2] || 2; }); }
    if (has(i => i.type === 'line')) btn('Arrow', 'Arrowhead', i => { if (i.type === 'line') i.arrow = !i.arrow; }, f.arrow);
    if (S.length === 1) {
      if (f.type === 'chart') { sep(); ['bar', 'line', 'pie'].forEach(t => btn(t[0].toUpperCase() + t.slice(1), t + ' chart', i => i.chart = t, f.chart === t)); }
      if (f.type === 'table') {
        sep();
        btn('+ Row', 'Add row', i => i.rows.push(i.rows[0].map(() => '')));
        btn('+ Col', 'Add column', i => i.rows.forEach(row => row.push('')));
        btn('− Row', 'Remove last row', i => { if (i.rows.length > 1) i.rows.pop(); });
        btn('− Col', 'Remove last column', i => { if (i.rows[0].length > 1) i.rows.forEach(row => row.pop()); });
      }
      if (f.type === 'link' || f.type === 'embed') { sep(); btn(f.type === 'link' ? 'Embed' : 'As link', 'Switch between link card and embed', i => { i.type = i.type === 'link' ? 'embed' : 'link'; i.w = DEF[i.type].w; i.h = DEF[i.type].h; }); }
    }
    sep();
    btn('Front', 'Bring to front', () => reorder(true), false, true);
    btn('Back', 'Send to back', () => reorder(false), false, true);
    btn('Duplicate', 'Duplicate (⌘D). ⌘C / ⌘V also work, across boards', dup, false, true);
    btn('Delete', 'Delete (⌫)', del, false, true);
  }
  renderPanel();
}

function renderPanel() {
  const lists = board.items.filter(i => i.type === 'tasks'), today = new Date().toLocaleDateString('sv');
  const open = lists.flatMap(i => i.tasks).filter(t => !t.done && t.text).length;
  $('#tasksBtn').textContent = open ? `Tasks · ${open}` : 'Tasks';
  if (panel.hidden) return;
  panel.replaceChildren(h('h3', { textContent: open ? `${open} open` : 'All done' }));
  if (!lists.length) panel.append(h('p', { textContent: 'No task lists on this board yet. Add one from the + menu.' }));
  lists.forEach(i => {
    panel.append(h('h4', { textContent: i.title || 'Tasks', title: 'Show on board', onclick: () => focusItem(i) }));
    i.tasks.filter(t => t.text).forEach(t => {
      const cb = h('input', { type: 'checkbox', checked: !!t.done });
      cb.onchange = () => { t.done = cb.checked; refresh(i); commit(); };
      panel.append(h('label', { className: t.done ? 'done' : '' }, cb, h('span', { textContent: t.text }),
        t.due ? h('time', { textContent: t.due, className: !t.done && t.due < today ? 'late' : '' }) : null));
    });
  });
}

// ---------- pointer ----------

let drag = null, space = false, lastDown = { t: 0, id: null };
const toWorld = e => ({ x: r((e.clientX - view.x) / view.z), y: r((e.clientY - view.y) / view.z) });

stage.addEventListener('pointerdown', e => {
  const el = e.target.closest('.item'), it = el && byId(el.dataset.id);
  if (editing) { if (it?.id === editing) return; stopEdit(); }
  if (e.target.closest('input,button,a,textarea')) return; // checkboxes, dates and links stay natively clickable
  if (document.activeElement !== document.body) document.activeElement.blur();
  stage.setPointerCapture(e.pointerId);
  const p = toWorld(e), now = Date.now(), id = it?.id || null;
  const dbl = now - lastDown.t < 350 && lastDown.id === id; // click events retarget under pointer capture, so detect double-click here
  lastDown = { t: dbl ? 0 : now, id };

  if (e.button === 1 || space || tool === 'hand') { drag = { k: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; return; }

  if (tool === 'select') {
    if (it && e.target.classList.contains('ep')) { sel = new Set([id]); drag = { k: 'ep', it, end: +e.target.dataset.end }; return syncUI(); }
    if (it && e.target.classList.contains('rz')) { drag = { k: 'rz', it, p, o: structuredClone(it) }; return; }
    if (it) {
      if (dbl) return startEdit(it);
      if (e.shiftKey) sel.has(id) ? sel.delete(id) : sel.add(id);
      else if (!sel.has(id)) sel = new Set([id]);
      drag = { k: 'move', p, o: new Map(selected().map(i => [i.id, { x: i.x, y: i.y }])) };
    } else {
      if (dbl) return startEdit(add({ type: 'text', x: p.x, y: p.y - 12 }));
      if (!e.shiftKey) sel.clear();
      drag = { k: 'marq', p, base: new Set(sel) };
    }
    return syncUI();
  }

  sel.clear();
  if (tool === 'draw') {
    // points are absolute until pointerup, when norm() rebases them onto the bounding box
    const i = { id: uid(), type: 'draw', x: 0, y: 0, w: 0, h: 0, points: [[p.x, p.y]] };
    board.items.push(i); refresh(i);
    drag = { k: 'draw', it: i };
    return;
  }
  if (tool === 'line' || tool === 'arrow') {
    const i = { id: uid(), type: 'line', x: p.x, y: p.y, w: 0, h: 0, points: [[0, 0], [0, 0]] };
    if (tool === 'arrow') i.arrow = true;
    if (it && !isPts(it)) i.from = it.id; // started on an item: attach to it
    board.items.push(i); refresh(i);
    drag = { k: 'ep', it: i, end: 1, creating: true };
    return;
  }
  if (tool === 'pin') { // each click drops the next number; the tool stays active
    const n = Math.max(0, ...board.items.filter(x => x.type === 'pin').map(x => parseInt(x.text) || 0)) + 1;
    add({ type: 'pin', x: p.x - 14, y: p.y - 14, text: String(n) });
    tool = 'pin'; sel.clear();
    return syncUI();
  }
  const type = tool === 'rect' || tool === 'ellipse' ? 'shape' : tool;
  const i = { ...structuredClone(DEF[type]), id: uid(), type, x: p.x, y: p.y, w: 0, h: 0 };
  if (tool === 'ellipse') i.shape = 'ellipse';
  board.items.push(i); refresh(i);
  drag = { k: 'new', it: i, p };
});

stage.addEventListener('pointermove', e => {
  const d = drag;
  if (!d) return;
  if (d.k === 'pan') { view.x = d.vx + e.clientX - d.sx; view.y = d.vy + e.clientY - d.sy; return applyView(); }
  const p = toWorld(e), dx = p.x - (d.p?.x || 0), dy = p.y - (d.p?.y || 0);
  if (d.k === 'move') {
    d.moved = true;
    const ids = new Set(d.o.keys());
    for (const [id, o] of d.o) {
      const i = byId(id); i.x = r(o.x + dx); i.y = r(o.y + dy); place(i);
      if (i.type === 'line') for (const k of ['from', 'to']) if (i[k] != null && !ids.has(i[k])) delete i[k]; // dragging a connector away detaches it
    }
    relink(ids);
  } else if (d.k === 'rz') {
    const i = d.it, o = d.o, min = isPts(i) ? 1 : 24;
    d.moved = true;
    i.w = r(Math.max(min, o.w + dx)); i.h = r(Math.max(min, o.h + dy));
    if (isPts(i)) i.points = o.points.map(([x, y]) => [r(x * i.w / (o.w || 1)), r(y * i.h / (o.h || 1))]);
    LIVE.has(i.type) ? place(i) : refresh(i);
    relink(new Set([i.id]));
  } else if (d.k === 'marq') {
    const x = Math.min(p.x, d.p.x), y = Math.min(p.y, d.p.y), w = Math.abs(dx), hh = Math.abs(dy);
    marq.style.cssText = `display:block;left:${x}px;top:${y}px;width:${w}px;height:${hh}px`;
    sel = new Set(d.base);
    for (const i of board.items) if (i.x <= x + w && i.x + i.w >= x && i.y <= y + hh && i.y + Math.max(i.h, els.get(i.id)?.offsetHeight || 0) >= y) sel.add(i.id);
    for (const [id, el] of els) el.classList.toggle('sel', sel.has(id));
  } else if (d.k === 'draw') {
    const q = d.it.points.at(-1);
    // ponytail: rebuilds the whole stroke per point (O(n²) for very long strokes); append to the path if drawing ever lags
    if (Math.hypot(p.x - q[0], p.y - q[1]) > 2 / view.z) { d.it.points.push([p.x, p.y]); refresh(d.it); }
  } else if (d.k === 'ep') {
    setEnd(d.it, d.end, p, e);
  } else if (d.k === 'new') {
    const i = d.it;
    i.x = Math.min(p.x, d.p.x); i.y = Math.min(p.y, d.p.y); i.w = Math.abs(dx); i.h = Math.abs(dy);
    place(i);
  }
});

function endDrag() {
  const d = drag;
  drag = null;
  marq.style.display = 'none';
  if (!d) return;
  const drop = i => { board.items = board.items.filter(x => x !== i); els.get(i.id).remove(); els.delete(i.id); };
  if (d.k === 'draw') {
    const i = d.it;
    norm(i);
    if (i.w + i.h < 4) drop(i); else refresh(i);
    commit();
  } else if (d.k === 'ep') {
    const i = d.it;
    mark(null);
    if (d.creating && i.w + i.h < 4) drop(i);
    else if (d.creating) { sel = new Set([i.id]); tool = 'select'; }
    commit();
  } else if (d.k === 'new') {
    const i = d.it;
    if (i.w < 8 || i.h < 8) { i.w = DEF[i.type].w; i.h = DEF[i.type].h; }
    if (AUTO.has(i.type)) i.h = DEF[i.type].h;
    sel = new Set([i.id]); tool = 'select';
    refresh(i);
    if (i.type !== 'shape') startEdit(i);
    commit();
  } else if (d.moved) commit();
  syncUI();
}
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

stage.addEventListener('wheel', e => {
  if (editing && e.target.closest('.editing')) return; // let textareas scroll
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) { // pinch or ⌘-scroll zooms around the cursor
    const z = Math.min(5, Math.max(.1, view.z * Math.exp(-e.deltaY * .01)));
    view.x = e.clientX - (e.clientX - view.x) * z / view.z;
    view.y = e.clientY - (e.clientY - view.y) * z / view.z;
    view.z = z;
  } else { view.x -= e.deltaX; view.y -= e.deltaY; }
  applyView();
}, { passive: false });

// ---------- keyboard, paste, drop ----------

const typing = e => e.target.closest?.('input,textarea,[contenteditable]');

addEventListener('keydown', e => {
  if ($('#ask').open) return;
  if (e.key === 'Escape') { if (editing) stopEdit(); else { sel.clear(); setTool('select'); } return; }
  if (typing(e)) return;
  const m = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (k === ' ') { space = true; stage.classList.add('pan'); e.preventDefault(); }
  else if (k === 'backspace' || k === 'delete') del();
  else if (m && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (m && k === 'd') { e.preventDefault(); dup(); }
  else if (m && k === 'a') { e.preventDefault(); sel = new Set(board.items.map(i => i.id)); syncUI(); }
  else if (!m && !e.altKey && KEYS[k]) setTool(KEYS[k]);
});
addEventListener('keyup', e => { if (e.key === ' ') { space = false; stage.classList.remove('pan'); } });

async function addFiles(files, p) {
  let n = 0;
  for (const f of files) {
    const kind = f.type.split('/')[0];
    if (kind !== 'image' && kind !== 'video') continue;
    const res = await fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f }).catch(() => null);
    if (!res?.ok) { $('#status').hidden = false; continue; }
    addMedia(kind, (await res.json()).src, { x: p.x + n * 24, y: p.y + n * 24 });
    n++;
  }
}

function addMedia(type, src, p) {
  const it = add({ type, src, ...p });
  const fit = (w, hh) => { if (w && hh && byId(it.id)) { it.h = r(it.w * hh / w); place(it); commit(); } };
  if (type === 'image') { const im = new Image(); im.onload = () => fit(im.naturalWidth, im.naturalHeight); im.src = src; }
  else { const v = document.createElement('video'); v.onloadedmetadata = () => fit(v.videoWidth, v.videoHeight); v.src = src; }
}

function addURL(url, p) {
  if (/\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(url)) return addMedia('image', url, p);
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url)) return addMedia('video', url, p);
  add({ type: /youtube\.com|youtu\.be|vimeo\.com|figma\.com|loom\.com/.test(url) ? 'embed' : 'link', url, ...p });
}

addEventListener('paste', e => {
  if (typing(e)) return;
  const files = [...e.clipboardData.files], txt = e.clipboardData.getData('text').trim();
  let clip;
  try { clip = JSON.parse(txt); } catch {}
  if (files.length) addFiles(files, center());
  else if (clip?.slate && Array.isArray(clip.items)) pasteItems(clip.items);
  else if (clip && typeof clip === 'object') add({ ...centered('code'), text: clip }); // pasted JSON becomes a formatted block
  else if (/^https?:\/\/\S+$/i.test(txt)) addURL(txt, center());
  else if (txt) add({ type: 'text', text: txt, ...center() });
});

// ⌘C / ⌘X put the selected items on the system clipboard as JSON, so they paste into any board (or any text editor).
function onCopy(e) {
  if (typing(e) || !sel.size || String(getSelection())) return false;
  e.clipboardData.setData('text/plain', JSON.stringify({ slate: 1, items: selected() }));
  e.preventDefault();
  return true;
}
addEventListener('copy', onCopy);
addEventListener('cut', e => { if (onCopy(e)) del(); });
stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('drop', e => {
  e.preventDefault();
  const p = toWorld(e), u = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text')).trim();
  if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files], p);
  else if (isHttp(u)) addURL(u.split(/\s/)[0], p);
});

// ---------- chrome ----------

// Prompt dialog. Pass val = null for a plain confirmation (no input).
function ask(label, val = '', ok = 'Add') {
  return new Promise(res => {
    const d = $('#ask'), inp = d.querySelector('input');
    d.querySelector('label').textContent = label;
    d.querySelector('button[value=ok]').textContent = ok;
    inp.hidden = val == null; inp.value = val ?? ''; d.returnValue = '';
    d.onclose = () => res(d.returnValue !== 'ok' ? '' : val == null ? 'ok' : inp.value.trim());
    d.showModal();
    if (val) inp.select();
  });
}

const centered = type => { const c = center(); return { type, x: r(c.x - DEF[type].w / 2), y: r(c.y - DEF[type].h / 2) }; };

document.querySelectorAll('#tools [data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
$('#ins').onclick = async e => {
  const kind = e.target.dataset.ins;
  if (!kind) return;
  $('#ins').hidePopover();
  if (kind === 'media') return $('#file').click();
  if (kind !== 'link') return add(centered(kind));
  const u = await ask('Paste a link — a page, YouTube, Figma, an image or a video');
  if (u) { const c = centered('link'); addURL(isHttp(u) ? u : 'https://' + u, { x: c.x, y: c.y }); }
};
$('#file').onchange = e => { addFiles([...e.target.files], center()); e.target.value = ''; };
$('#zoom').onclick = () => { const c = center(); view.x = innerWidth / 2 - c.x; view.y = innerHeight / 2 - c.y; view.z = 1; applyView(); };
$('#tasksBtn').onclick = () => { panel.hidden = !panel.hidden; renderPanel(); };

// ---------- boards ----------

const boards = () => fetch('/api/boards').then(res => res.json());
const go = n => { location.hash = encodeURIComponent(n); }; // the URL hash is the source of truth for the open board

async function openBoard() {
  if (name) { if (editing) stopEdit(); else commit(); await flush(); } // nothing unsaved is left behind
  const list = await boards();
  let n = '';
  try { n = decodeURIComponent(location.hash.slice(1)); } catch {}
  if (!list.includes(n)) {
    n = list.includes(localStorage.board) ? localStorage.board : list[0];
    history.replaceState(null, '', '#' + encodeURIComponent(n));
  }
  name = n; localStorage.board = n; document.title = n + ' · Slate';
  board = { items: [] }; hist = []; fut = []; last = ''; sel.clear(); editing = null;
  view = { x: 0, y: 0, z: 1 };
  try { Object.assign(view, JSON.parse(localStorage['view:' + n])); } catch {}
  applyView(); renderBoards(list);
  await load(); hist = [];
}

async function askName(label, val) {
  for (;;) {
    const n = (await ask(label, val, 'Save')).replace(/[^\p{L}\p{N}_ -]/gu, '-').replace(/^[ -]+/, '').slice(0, 60).trim();
    if (!n) return '';
    if (!(await boards()).some(b => b.toLowerCase() === n.toLowerCase())) return n;
    label = `"${n}" already exists. Pick another name`;
  }
}

function renderBoards(list) {
  const m = $('#boardMenu'), item = (textContent, fn, on) => h('button', { textContent, className: on ? 'on' : '', onclick: () => { m.hidePopover(); fn(); } });
  $('#boardBtn').textContent = name;
  m.replaceChildren(...list.map(n => item(n, () => go(n), n === name)), h('i'),
    item('New board…', async () => {
      const n = await askName('New board name', '');
      if (!n) return;
      await fetch(api(n), { method: 'PUT', body: '{"items":[]}' });
      go(n);
    }),
    item('Rename…', async () => {
      const old = name, n = await askName('Rename board', old);
      if (!n) return;
      if (editing) stopEdit(); else commit();
      await flush();
      await fetch(api(n), { method: 'PUT', body: last });
      try { localStorage['view:' + n] = localStorage['view:' + old]; delete localStorage['view:' + old]; } catch {}
      go(n);
      await fetch(api(old), { method: 'DELETE' });
    }),
    item('Delete…', async () => {
      const old = name;
      if (!await ask(`Delete "${old}"? This cannot be undone.`, null, 'Delete')) return;
      clearTimeout(saveT); clearTimeout(dirtyT); saveT = null; name = '';
      await fetch(api(old), { method: 'DELETE' });
      try { delete localStorage['view:' + old]; } catch {}
      history.replaceState(null, '', '#');
      openBoard();
    }));
}

addEventListener('hashchange', openBoard);
async function onChange(changed) {
  if (!name) return;
  const list = await boards();
  if (!list.includes(name)) return openBoard(); // the open board was deleted elsewhere
  renderBoards(list);
  if (changed === name) load(true);
}
function listen() {
  const es = new EventSource('/api/events');
  es.onmessage = e => onChange(e.data);
  es.onopen = () => onChange(name); // (re)connected, e.g. after a server restart: catch up on anything missed
  es.onerror = () => { es.close(); setTimeout(listen, 2000); }; // don't rely on the browser's own retry: it stalls when the server is down
}
listen();
openBoard();
