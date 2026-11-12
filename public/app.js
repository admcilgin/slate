// Slate — canvas logic. The board is plain JSON (see AGENTS.md); every item is one absolutely positioned DOM node.
const $ = s => document.querySelector(s);
const stage = $('#stage'), world = $('#world'), marq = $('#marq'), bar = $('#bar'), panel = $('#panel');

const PAL = ['', '#8e8e93', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#007aff', '#af52de'];
const SERIES = ['#007aff', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#ffcc00', '#8e8e93'];
const AUTO = new Set(['text', 'tasks', 'table', 'link', 'code', 'callout', 'kanban']);   // height grows with content
const LIVE = new Set(['image', 'video', 'embed']);          // never rebuilt while moving/resizing (would reload media)
const TEXTY = new Set(['text', 'note', 'shape']);
const CARDS = new Set(['tasks', 'table', 'callout', 'kanban', 'stat', 'code', 'link']); // cards whose text takes size, bold, italic and align
const INK = new Set(['tasks', 'table', 'kanban', 'code', 'link']);                      // …and where color is the text colour
const KEYS = { v: 'select', h: 'hand', p: 'draw', l: 'line', a: 'arrow', r: 'rect', o: 'ellipse', d: 'diamond', t: 'text', n: 'note', m: 'pin' };
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
  stat: { w: 200, h: 112, label: 'Metric', value: '0', delta: '' },
  callout: { w: 300, h: 64, title: 'Note', text: '' },
  frame: { w: 640, h: 400, title: 'Frame' },
  kanban: { w: 600, h: 150, columns: [{ title: 'To do', cards: [''] }, { title: 'Doing', cards: [] }, { title: 'Done', cards: [] }] },
};

let board = { items: [] }, sel = new Set(), editing = null, tool = 'select';
let kdrag = null; // kanban card being dragged: { id, c, n }
let view = { x: 0, y: 0, z: 1 }, name = ''; // name = current board (data/boards/<name>.json)
const api = n => '/api/board?b=' + encodeURIComponent(n);
const els = new Map();
const gX = document.createElement('div'), gY = document.createElement('div'); // alignment guides
gX.className = gY.className = 'guide';
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const sbox = document.createElement('div'); // box around a multi-selection; its corners scale everything in it
sbox.className = 'selbox';
['nw', 'ne', 'se', 'sw'].forEach(c => sbox.append(Object.assign(document.createElement('div'), { className: 'rz ' + c })));
const pg = document.head.appendChild(document.createElement('style')); // page size and offset for printing, see printSetup()

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

// The polyline a line is drawn along. An elbow line turns its two ends into a right-angled route.
function path(i) {
  const p = i.points;
  if (!i.elbow || p.length !== 2) return p;
  const [a, b] = p, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const hz = i.elbow === 'h' || (i.elbow !== 'v' && Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]));
  return hz ? [a, [mx, a[1]], [mx, b[1]], b] : [a, [a[0], my], [b[0], my], b];
}

function ptsSVG(i) {
  const c = esc(i.color || 'currentColor'), sw = +i.width || 2, p = path(i), dash = i.dash ? ` stroke-dasharray="${sw * 3} ${sw * 3}"` : '';
  let d = `M${p[0]}`;
  if (i.type === 'draw' && p.length > 2) { // smooth freehand through midpoints
    for (let k = 1; k < p.length - 1; k++) d += `Q${p[k]} ${(p[k][0] + p[k + 1][0]) / 2},${(p[k][1] + p[k + 1][1]) / 2}`;
    d += `L${p.at(-1)}`;
  } else d += p.slice(1).map(q => `L${q}`).join('');
  const head = P => { // arrowhead on P[0], pointing away from the nearest point that differs from it
    const [x2, y2] = P[0], [x1, y1] = P.find(q => q[0] !== x2 || q[1] !== y2) || P[0], t = Math.atan2(y2 - y1, x2 - x1), L = 8 + sw * 2;
    return `<path d="M${x2 - L * Math.cos(t - .45)},${y2 - L * Math.sin(t - .45)}L${x2},${y2}L${x2 - L * Math.cos(t + .45)},${y2 - L * Math.sin(t + .45)}" stroke="${c}" stroke-width="${sw}"/>`;
  };
  const heads = i.arrow && p.length > 1 ? head([...p].reverse()) + (i.arrow === 'both' ? head(p) : '') : '';
  return `<svg width="${i.w || 1}" height="${i.h || 1}"><path class="hit" d="${d}"/><path d="${d}" stroke="${c}" stroke-width="${sw}"${dash}/>${heads}</svg>`;
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
    const tint = i.fill ? `color-mix(in srgb, ${c} 16%, transparent)` : '';
    if (i.shape && i.shape !== 'rect') e.classList.add(i.shape);
    b.style.cssText = tstyle(i) + `border-color:${c};` + (i.dash ? 'border-style:dashed;' : '') + (tint ? `background:${tint}` : '');
    if (i.shape === 'diamond') // a div cannot have a diamond border, so the outline is an SVG behind the text
      b.innerHTML = `<svg class="dia" viewBox="0 0 100 100" preserveAspectRatio="none"><polygon points="50,1 99,50 50,99 1,50" style="stroke:${esc(c)};fill:${esc(tint) || 'none'}"${i.dash ? ' stroke-dasharray="6 5"' : ''}/></svg>`;
    b.append(bind(i, 'text', 'txt', ed));
  },
  line(i, b, ed) {
    b.innerHTML = ptsSVG(i);
    if (!ed && !i.label) return;
    const p = path(i), a = p[Math.floor((p.length - 1) / 2)], c = p[Math.ceil((p.length - 1) / 2)], l = bind(i, 'label', 'lbl', ed);
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
  frame(i, b, ed) { b.style.cssText = `border-color:${i.color || 'var(--sub)'}`; b.append(bind(i, 'title', 'title', ed)); },
  stat(i, b, ed) {
    const v = bind(i, 'value', 'value', ed), d = bind(i, 'delta', 'delta', ed);
    if (i.color) v.style.color = i.color;
    d.classList.toggle('up', /^\s*\+/.test(i.delta));
    d.classList.toggle('down', /^\s*[-−]/.test(i.delta));
    b.append(bind(i, 'label', 'label', ed), v);
    if (ed || i.delta) b.append(d);
  },
  callout(i, b, ed) {
    b.style.cssText = `--c:${i.color || 'var(--accent)'}`;
    if (ed || i.title) b.append(bind(i, 'title', 'title', ed));
    b.append(bind(i, 'text', 'txt', ed));
  },
  kanban(i, b, ed) {
    const focus = (c, n) => els.get(i.id).querySelectorAll('.kcol')[c]?.querySelectorAll('.kcard')[n]?.focus();
    const redo = () => { refresh(i); relink(new Set([i.id])); };
    const drop = (c, n) => ev => { // n = card to insert before; none = end of the column
      ev.preventDefault(); ev.stopPropagation();
      if (kdrag?.id !== i.id) return;
      const [card] = i.columns[kdrag.c].cards.splice(kdrag.n, 1);
      i.columns[c].cards.splice(n == null ? i.columns[c].cards.length : n - (kdrag.c === c && kdrag.n < n), 0, card);
      kdrag = null; redo(); commit();
    };
    i.columns.forEach((col, c) => {
      col.cards ??= [];
      const el = h('div', { className: 'kcol' }, bind(col, 'title', 'title', ed));
      col.cards.forEach((_, n) => {
        const k = bind(col.cards, n, 'kcard', ed);
        if (ed) k.onkeydown = ev => {
          if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); col.cards.splice(n + 1, 0, ''); redo(); focus(c, n + 1); dirty(); }
          else if (ev.key === 'Backspace' && !col.cards[n]) { ev.preventDefault(); col.cards.splice(n, 1); redo(); focus(c, Math.max(0, n - 1)); dirty(); }
        };
        else if (!i.locked) {
          k.draggable = true;
          k.ondragstart = ev => { kdrag = { id: i.id, c, n }; ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', col.cards[n]); };
          k.ondragover = ev => ev.preventDefault();
          k.ondragend = () => kdrag = null;
          k.ondblclick = () => startEdit(i); // draggable cards skip the stage's own pointer handling
          k.ondrop = drop(c, n);
        }
        el.append(k);
      });
      if (ed) el.append(h('button', { textContent: '+ Card', onclick: () => { col.cards.push(''); redo(); focus(c, col.cards.length - 1); dirty(); } }));
      el.ondragover = ev => ev.preventDefault();
      el.ondrop = drop(c);
      b.append(el);
    });
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
  e.classList.toggle('locked', !!i.locked);
}

function refresh(i) {
  const e = h('div', { className: 'item ' + i.type }), b = h('div', { className: 'body' }), old = els.get(i.id);
  e.dataset.id = i.id;
  e.append(b);
  if (R[i.type]) R[i.type](i, b, editing === i.id, e); else b.textContent = `Unknown type: ${i.type}`;
  if (CARDS.has(i.type)) b.style.cssText += (i.size ? `;font-size:${+i.size}px` : '') + (i.bold ? ';font-weight:600' : '') + (i.italic ? ';font-style:italic' : '')
    + (i.align ? `;text-align:${i.align}` : '') + (i.color && INK.has(i.type) ? `;color:${i.color}` : '');
  if (i.type === 'line') [0, 1].forEach(end => { // lines get a draggable handle on each end instead of a resize corner
    const q = i.points[end ? i.points.length - 1 : 0], d = h('div', { className: 'ep', style: `left:${q[0]}px;top:${q[1]}px` });
    d.dataset.end = end; e.append(d);
  });
  else for (const d of i.type === 'pin' ? ['se'] : AUTO.has(i.type) ? ['e', 'se', 'w'] : HANDLES) e.append(h('div', { className: 'rz ' + d }));
  if (i.href && i.type !== 'link' && i.type !== 'embed') e.append(h('button', { className: 'go', textContent: '↗', title: i.href, ariaLabel: 'Open ' + i.href, onclick: () => follow(i.href) }));
  els.set(i.id, e);
  old ? old.replaceWith(e) : world.append(e);
  place(i);
}

function render() {
  world.replaceChildren(marq, gX, gY, sbox);
  els.clear();
  board.items.forEach(refresh);
  for (const l of board.items) if (l.type === 'line' && (l.from || l.to) && route(l)) refresh(l); // real heights are known only now
  syncUI();
}

// ---------- connectors: a line's `from` / `to` hold the id of the item that end is attached to ----------

const box = i => ({ x: i.x, y: i.y, w: i.w, h: AUTO.has(i.type) ? Math.max(i.h, els.get(i.id)?.offsetHeight || 0) : i.h });
const mid = i => { const b = box(i); return [b.x + b.w / 2, b.y + b.h / 2]; };
const bounds = S => {
  const B = S.map(box), x = Math.min(...B.map(b => b.x)), y = Math.min(...B.map(b => b.y));
  return { x, y, w: Math.max(...B.map(b => b.x + b.w)) - x, h: Math.max(...B.map(b => b.y + b.h)) - y };
};

// ---------- groups, snapping, fit ----------

const members = i => i.group ? board.items.filter(x => x.group === i.group && !x.locked).map(x => x.id) : [i.id];
function expand() { // selecting one member of a group selects the whole group
  const g = new Set(selected().map(i => i.group).filter(Boolean));
  if (g.size) for (const i of board.items) if (g.has(i.group) && !i.locked) sel.add(i.id);
}
function group() { const S = selected(); if (S.length < 2) return; const g = uid(); S.forEach(i => i.group = g); commit(); syncUI(); }
function ungroup() { selected().forEach(i => delete i.group); commit(); syncUI(); }

// A frame carries whatever lies fully inside it.
function carried(S) {
  const out = new Set(S);
  for (const f of S) if (f.type === 'frame') {
    const F = box(f);
    for (const i of board.items) {
      const b = box(i);
      if (!i.locked && b.x >= F.x && b.y >= F.y && b.x + b.w <= F.x + F.w && b.y + b.h <= F.y + F.h) out.add(i);
    }
  }
  return [...out];
}

function align(how) {
  const S = selected().filter(i => !i.locked && !(i.type === 'line' && (i.from || i.to))); // attached lines follow their items
  if (S.length < 2) return;
  const B = bounds(S);
  if (how === 'dh' || how === 'dv') { // equal gaps between the outermost two
    const ax = how === 'dh' ? 'x' : 'y', sz = how === 'dh' ? 'w' : 'h', T = [...S].sort((a, b) => a[ax] - b[ax]);
    const gap = (B[sz] - T.reduce((n, i) => n + box(i)[sz], 0)) / (T.length - 1);
    let at = B[ax];
    for (const i of T) { i[ax] = r(at); at += box(i)[sz] + gap; }
  } else for (const i of S) {
    const b = box(i);
    if (how === 'l') i.x = B.x; else if (how === 'c') i.x = r(B.x + (B.w - b.w) / 2); else if (how === 'r') i.x = r(B.x + B.w - b.w);
    else if (how === 't') i.y = B.y; else if (how === 'm') i.y = r(B.y + (B.h - b.h) / 2); else i.y = r(B.y + B.h - b.h);
  }
  S.forEach(place); relink(new Set(S.map(i => i.id))); commit(); syncUI();
}

function selBox() {
  const S = selected().filter(i => !i.locked);
  if (S.length < 2 || editing) return void (sbox.style.display = 'none');
  const b = bounds(S);
  sbox.style.cssText = `display:block;left:${b.x - 6}px;top:${b.y - 6}px;width:${b.w + 12}px;height:${b.h + 12}px`;
}

function guides(x, y) {
  gX.style.cssText = x == null ? '' : `display:block;left:${x}px;top:${-view.y / view.z}px;height:${innerHeight / view.z}px;width:${1 / view.z}px`;
  gY.style.cssText = y == null ? '' : `display:block;top:${y}px;left:${-view.x / view.z}px;width:${innerWidth / view.z}px;height:${1 / view.z}px`;
}

// Pull a moving box onto the nearest edge or centre line of another item. Returns the correction and draws the guides.
function snap(b, skip) {
  const t = 6 / view.z;
  let sx = 0, sy = 0, bx = t, by = t, gx = null, gy = null;
  for (const i of board.items) {
    if (skip.has(i.id) || isPts(i)) continue;
    const o = box(i);
    for (const a of [o.x, o.x + o.w / 2, o.x + o.w]) for (const m of [b.x, b.x + b.w / 2, b.x + b.w]) if (Math.abs(a - m) < bx) { bx = Math.abs(a - m); sx = a - m; gx = a; }
    for (const a of [o.y, o.y + o.h / 2, o.y + o.h]) for (const m of [b.y, b.y + b.h / 2, b.y + b.h]) if (Math.abs(a - m) < by) { by = Math.abs(a - m); sy = a - m; gy = a; }
  }
  guides(gx, gy);
  return { sx, sy };
}

function nudge(dx, dy) {
  const S = carried(selected().filter(i => !i.locked));
  for (const i of S) { i.x = r(i.x + dx); i.y = r(i.y + dy); place(i); }
  relink(new Set(S.map(i => i.id)));
  selBox(); dirty();
}

// Zoom out (never past 100%) until the selection, or the whole board, is on screen.
function fit() {
  const S = sel.size ? selected() : board.items;
  if (!S.length) return;
  const b = bounds(S), z = Math.min(1, Math.max(.1, Math.min((innerWidth - 160) / (b.w || 1), (innerHeight - 220) / (b.h || 1))));
  view.z = z; view.x = innerWidth / 2 - (b.x + b.w / 2) * z; view.y = innerHeight / 2 - (b.y + b.h / 2) * z;
  applyView();
}

// Where a ray from the item's centre towards point t leaves the item (plus a small gap).
function edge(i, t) {
  const b = box(i), cx = b.x + b.w / 2, cy = b.y + b.h / 2, dx = t[0] - cx, dy = t[1] - cy, hw = b.w / 2 + 6, hh = b.h / 2 + 6;
  if (!dx && !dy) return [cx, cy];
  const k = i.type === 'pin' || i.shape === 'ellipse' ? 1 / Math.hypot(dx / hw, dy / hh) : i.shape === 'diamond' ? 1 / (Math.abs(dx) / hw + Math.abs(dy) / hh) : Math.min(hw / Math.abs(dx || 1e-9), hh / Math.abs(dy || 1e-9));
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
  if (l.elbow && a && b && n === 2) { // an elbow leaves and enters through the middle of the sides that face each other
    const A = box(a), B = box(b), ca = mid(a), cb = mid(b), g = 6;
    const hz = Math.max(B.x - A.x - A.w, A.x - B.x - B.w) >= Math.max(B.y - A.y - A.h, A.y - B.y - B.h);
    l.elbow = hz ? 'h' : 'v'; // remembered so the drawing turns the same way the ends were placed
    P[0] = hz ? [ca[0] < cb[0] ? A.x + A.w + g : A.x - g, ca[1]] : [ca[0], ca[1] < cb[1] ? A.y + A.h + g : A.y - g];
    P[1] = hz ? [ca[0] < cb[0] ? B.x - g : B.x + B.w + g, cb[1]] : [cb[0], ca[1] < cb[1] ? B.y - g : B.y + B.h + g];
  } else {
    if (a) P[0] = edge(a, n > 2 || !b ? P[1] : mid(b));
    if (b) P[n - 1] = edge(b, n > 2 || !a ? P[n - 2] : mid(a));
  }
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
  if (l.elbow) l.elbow = true; // a dragged end picks its own direction again
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
  if (i.type === 'draw' || i.type === 'image' || i.locked) return;
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
function del() { if (!sel.size) return; board.items = board.items.filter(i => !sel.has(i.id) || i.locked); sel.clear(); render(); commit(); } // locked items must be unlocked first
// Add copies of items, shifted by dx/dy. Connectors between copied items stay connected; others are detached.
function insert(items, dx, dy, quiet) {
  if (!items.length) return;
  const ids = new Map(items.map(i => [i.id, uid()])), groups = new Map();
  const copies = items.map(i => {
    const c = { ...structuredClone(i), id: ids.get(i.id), x: r(i.x + dx), y: r(i.y + dy) };
    for (const k of ['from', 'to']) if (c[k] != null) { if (ids.has(c[k])) c[k] = ids.get(c[k]); else delete c[k]; }
    if (c.group) { if (!groups.has(c.group)) groups.set(c.group, uid()); c.group = groups.get(c.group); } // copies form their own group
    return c;
  });
  board.items.push(...copies); sel = new Set(copies.map(i => i.id)); render(); if (!quiet) commit();
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
// An item's `href` is a web address, or "#board" / "#board/item-id" to jump inside Slate.
function follow(u) {
  if (isHttp(u)) return void open(u, '_blank', 'noopener');
  const [b, id] = u.replace(/^#/, '').split('/');
  pendingFocus = id || null;
  !b || b === name ? showPending() : go(b);
}
async function editLink(i) {
  let u = await ask('Link: a web address, or #board (or #board/item-id) to jump there. Leave empty to remove', i.href || '', 'Save');
  if ($('#ask').returnValue !== 'ok') return;
  if (u && !u.startsWith('#') && !isHttp(u)) u = 'https://' + u;
  apply(x => { if (u) x.href = u; else delete x.href; });
}
function setTool(t) { tool = t; syncUI(); }

function syncUI() {
  for (const [id, e] of els) { e.classList.toggle('sel', sel.has(id)); e.classList.toggle('editing', editing === id); }
  document.querySelectorAll('#tools [data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === tool));
  stage.dataset.tool = tool;

  const S = selected(), f = S[0];
  bar.hidden = !S.length;
  bar.replaceChildren();
  if (f && S.every(i => i.locked)) {
    bar.append(h('button', { textContent: 'Unlock', title: 'Unlock so it can be moved, edited and deleted', onclick: () => apply(i => { delete i.locked; }) }));
  } else if (f) {
    const has = t => S.some(t), sep = () => bar.append(h('i'));
    const btn = (label, title, fn, on, raw) => bar.append(h('button', { textContent: label, title, ariaLabel: title, className: on ? 'on' : '', onclick: raw ? fn : () => apply(fn) }));
    PAL.forEach(c => bar.append(h('button', { className: 'sw' + ((f.color || '') === c ? ' on' : ''), style: `--c:${c || 'var(--ink)'}`, title: c ? 'Color ' + c : 'Default color', ariaLabel: c ? 'Color ' + c : 'Default color', onclick: () => apply(i => { if (c) i.color = c; else delete i.color; }) })));
    if (has(i => TEXTY.has(i.type) || CARDS.has(i.type))) {
      sep();
      [['S', 13], ['M', 15], ['L', 24], ['XL', 40]].forEach(([l, s]) => btn(l, 'Text size ' + l, i => i.size = s, (f.size || 15) === s));
      btn('B', 'Bold', i => i.bold = !i.bold, f.bold);
      btn('I', 'Italic', i => i.italic = !i.italic, f.italic);
      btn({ left: '⇤', center: '↔', right: '⇥' }[f.align || 'left'], 'Alignment', i => i.align = { left: 'center', center: 'right', right: 'left' }[i.align || 'left']);
    }
    const flip = (k, ok) => i => { if (!ok(i)) return; if (i[k]) delete i[k]; else i[k] = true; };
    const stroked = i => isPts(i) || i.type === 'shape';
    if (has(i => i.type === 'shape')) btn('Fill', 'Fill shape', i => { if (i.type === 'shape') i.fill = !i.fill; }, f.fill);
    if (has(isPts)) { sep(); btn({ 2: 'Thin', 4: 'Medium', 8: 'Thick' }[f.width || 2] || 'Thin', 'Stroke width', i => { if (isPts(i)) i.width = { 2: 4, 4: 8, 8: 2 }[i.width || 2] || 2; }); }
    if (has(stroked)) btn('Dashed', 'Dashed stroke', flip('dash', stroked), f.dash);
    if (has(i => i.type === 'line')) {
      btn(f.arrow === 'both' ? 'Arrow ↔' : 'Arrow →', 'Arrowhead: none, at the end, at both ends', i => { if (i.type !== 'line') return; if (!i.arrow) i.arrow = true; else if (i.arrow === 'both') delete i.arrow; else i.arrow = 'both'; }, f.arrow);
      btn('Elbow', 'Right-angled route instead of a straight line', i => { if (i.type !== 'line') return; if (i.elbow) delete i.elbow; else i.elbow = true; route(i); }, f.elbow);
    }
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
    if (S.length === 1) btn('Link', 'Link this item to a web address or to another board', () => editLink(f), f.href, true);
    if (S.length > 1) { const a = h('button', { textContent: 'Align', title: 'Align or distribute the selected items' }); a.popoverTargetElement = $('#alignMenu'); bar.append(a); }
    if (S.length > 1 && !(f.group && S.every(i => i.group === f.group))) btn('Group', 'Group (⌘G): move as one. Alt-click picks a single item inside', group, false, true);
    if (has(i => i.group)) btn('Ungroup', 'Ungroup (⇧⌘G)', ungroup, false, true);
    btn('Lock', 'Lock in place: cannot be moved, edited or deleted until unlocked', i => { i.locked = true; });
    btn('Front', 'Bring to front', () => reorder(true), false, true);
    btn('Back', 'Send to back', () => reorder(false), false, true);
    btn('Duplicate', 'Duplicate (⌘D). ⌘C / ⌘V also work, across boards', dup, false, true);
    btn('Delete', 'Delete (⌫)', del, false, true);
  }
  selBox();
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
  if (e.target.closest('input,button,a,textarea,[draggable=true]')) return; // checkboxes, dates and links stay natively clickable
  if (document.activeElement !== document.body) document.activeElement.blur();
  stage.setPointerCapture(e.pointerId);
  const p = toWorld(e), now = Date.now(), id = it?.id || null;
  const dbl = now - lastDown.t < 350 && lastDown.id === id; // click events retarget under pointer capture, so detect double-click here
  lastDown = { t: dbl ? 0 : now, id };

  if (e.button === 1 || space || tool === 'hand') { drag = { k: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; return; }

  if (tool === 'select') {
    if (e.target.parentNode === sbox) { // a corner of the multi-selection box
      const S = selected().filter(i => !i.locked);
      drag = { k: 'scale', p, hd: e.target.classList[1], b: bounds(S), o: new Map(S.map(i => [i.id, structuredClone(i)])) };
      return;
    }
    if (it && e.target.classList.contains('ep')) { sel = new Set([id]); drag = { k: 'ep', it, end: +e.target.dataset.end }; return syncUI(); }
    if (it && e.target.classList.contains('rz')) { drag = { k: 'rz', it, p, o: structuredClone(it), hd: e.target.classList[1] }; return; }
    if (it && !it.locked) {
      if (dbl) return startEdit(it);
      const ids = e.altKey ? [id] : members(it), on = sel.has(id); // Alt-click reaches one item inside a group
      if (e.shiftKey) ids.forEach(x => on ? sel.delete(x) : sel.add(x));
      else if (!on) sel = new Set(ids);
      const S = carried(selected().filter(i => !i.locked));
      drag = { k: 'move', p, o: new Map(S.map(i => [i.id, { x: i.x, y: i.y }])), b: bounds(S), alt: e.altKey && id };
    } else {
      if (dbl && !it) return startEdit(add({ type: 'text', x: p.x, y: p.y - 12 }));
      if (!e.shiftKey) sel.clear();
      drag = { k: 'marq', p, base: new Set(sel), hit: it?.id }; // a locked item acts like canvas when dragged; a plain click selects it
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
  const type = ['rect', 'ellipse', 'diamond'].includes(tool) ? 'shape' : tool;
  const i = { ...structuredClone(DEF[type]), id: uid(), type, x: p.x, y: p.y, w: 0, h: 0 };
  if (type === 'shape') i.shape = tool;
  board.items.push(i); refresh(i);
  drag = { k: 'new', it: i, p };
});

stage.addEventListener('pointermove', e => {
  const d = drag;
  if (!d) return;
  if (d.k === 'pan') { view.x = d.vx + e.clientX - d.sx; view.y = d.vy + e.clientY - d.sy; return applyView(); }
  const p = toWorld(e), dx = p.x - (d.p?.x || 0), dy = p.y - (d.p?.y || 0);
  if (d.k === 'move') {
    if (d.alt && !d.moved) { // Alt-drag leaves the originals where they are and drags copies
      if (Math.hypot(dx, dy) * view.z < 4) return;
      insert([...d.o.keys()].map(byId), 0, 0, true);
      const S = selected();
      d.o = new Map(S.map(i => [i.id, { x: i.x, y: i.y }])); d.b = bounds(S);
    }
    d.moved = true;
    const ids = new Set(d.o.keys());
    let sx = 0, sy = 0;
    if (e.metaKey || e.ctrlKey) guides(); // hold ⌘ to move freely
    else ({ sx, sy } = snap({ x: d.b.x + dx, y: d.b.y + dy, w: d.b.w, h: d.b.h }, ids));
    for (const [id, o] of d.o) {
      const i = byId(id); i.x = r(o.x + dx + sx); i.y = r(o.y + dy + sy); place(i);
      if (i.type === 'line') for (const k of ['from', 'to']) if (i[k] != null && !ids.has(i[k])) delete i[k]; // dragging a connector away detaches it
    }
    relink(ids);
  } else if (d.k === 'rz') {
    const i = d.it, o = d.o, min = isPts(i) ? 1 : 24, H = d.hd;
    d.moved = true;
    i.w = r(Math.max(min, H.includes('e') ? o.w + dx : H.includes('w') ? o.w - dx : o.w));
    i.h = r(Math.max(min, H.includes('s') ? o.h + dy : H.includes('n') ? o.h - dy : o.h));
    if (H.includes('w')) i.x = r(o.x + o.w - i.w); // the opposite side stays where it was
    if (H.includes('n')) i.y = r(o.y + o.h - i.h);
    if (isPts(i)) i.points = o.points.map(([x, y]) => [r(x * i.w / (o.w || 1)), r(y * i.h / (o.h || 1))]);
    LIVE.has(i.type) ? place(i) : refresh(i);
    relink(new Set([i.id]));
  } else if (d.k === 'scale') {
    // ponytail: positions and sizes scale, text size does not. Scale `size` too if that is ever wanted.
    const B = d.b, H = d.hd, w = Math.max(24, H.includes('e') ? B.w + dx : B.w - dx), hh = Math.max(24, H.includes('s') ? B.h + dy : B.h - dy);
    const x = H.includes('w') ? B.x + B.w - w : B.x, y = H.includes('n') ? B.y + B.h - hh : B.y, kx = w / (B.w || 1), ky = hh / (B.h || 1);
    d.moved = true;
    for (const [id, o] of d.o) {
      const i = byId(id), min = isPts(i) ? 1 : 8;
      i.x = r(x + (o.x - B.x) * kx); i.y = r(y + (o.y - B.y) * ky);
      i.w = r(Math.max(min, o.w * kx)); i.h = r(Math.max(min, o.h * ky));
      if (isPts(i)) i.points = o.points.map(([px, py]) => [r(px * i.w / (o.w || 1)), r(py * i.h / (o.h || 1))]);
      LIVE.has(i.type) ? place(i) : refresh(i);
    }
    relink(new Set(d.o.keys()));
  } else if (d.k === 'marq') {
    const x = Math.min(p.x, d.p.x), y = Math.min(p.y, d.p.y), w = Math.abs(dx), hh = Math.abs(dy);
    marq.style.cssText = `display:block;left:${x}px;top:${y}px;width:${w}px;height:${hh}px`;
    d.moved = true;
    sel = new Set(d.base);
    for (const i of board.items) if (!i.locked && (i.type !== 'frame' || (i.x >= x && i.y >= y && i.x + i.w <= x + w && i.y + i.h <= y + hh)) && i.x <= x + w && i.x + i.w >= x && i.y <= y + hh && i.y + Math.max(i.h, els.get(i.id)?.offsetHeight || 0) >= y) sel.add(i.id);
    expand();
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
  selBox();
});

function endDrag() {
  const d = drag;
  drag = null;
  marq.style.display = 'none';
  guides();
  if (!d) return;
  if (d.k === 'marq' && !d.moved && d.hit) sel = new Set([d.hit]);
  if (d.k === 'move' && !d.moved && d.alt) sel = new Set([d.alt]); // Alt-click picks one item out of its group
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
  if ($('#ask').open || $('#find').open) return;
  if (e.key === 'Escape') { if (editing) stopEdit(); else { sel.clear(); setTool('select'); } return; }
  if (typing(e)) return;
  const m = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (k === ' ') { space = true; stage.classList.add('pan'); e.preventDefault(); }
  else if (k === 'backspace' || k === 'delete') del();
  else if (m && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (m && k === 'd') { e.preventDefault(); dup(); }
  else if (m && k === 'a') { e.preventDefault(); sel = new Set(board.items.filter(i => !i.locked).map(i => i.id)); syncUI(); }
  else if (m && k === 'g') { e.preventDefault(); e.shiftKey ? ungroup() : group(); }
  else if (m && (k === 'k' || k === 'f')) { e.preventDefault(); openFind(); }
  else if (m && k === 'p') { e.preventDefault(); exportPDF(); }
  else if (k.startsWith('arrow') && sel.size) {
    e.preventDefault();
    const s = e.shiftKey ? 10 : 1;
    nudge(k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0, k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0);
  }
  else if (!m && k === 'f') fit();
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
  if (kdrag) return; // a kanban card let go outside its board
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
  if (kind === 'frame') { add(centered(kind)); return reorder(false); } // frames sit behind what they hold
  if (kind !== 'link') return add(centered(kind));
  const u = await ask('Paste a link — a page, YouTube, Figma, an image or a video');
  if (u) { const c = centered('link'); addURL(isHttp(u) ? u : 'https://' + u, { x: c.x, y: c.y }); }
};
$('#file').onchange = e => { addFiles([...e.target.files], center()); e.target.value = ''; };
$('#zoom').onclick = () => { const c = center(); view.x = innerWidth / 2 - c.x; view.y = innerHeight / 2 - c.y; view.z = 1; applyView(); };
$('#tasksBtn').onclick = () => { panel.hidden = !panel.hidden; renderPanel(); };

// ---------- search across boards ----------

let index = [], pendingFocus = null;
const textOf = i => [i.text, i.title, i.label, i.value, i.url, i.alt, ...(i.columns || []).flatMap(c => [c.title, ...(c.cards || [])]), ...(i.tasks || []).map(t => t.text), ...(i.rows || []).flat(), ...(i.data || []).map(d => d.label), ...(i.events || []).map(e => e.label)]
  .filter(x => x && typeof x === 'string').join(' · ');

function showPending() {
  const i = byId(pendingFocus);
  pendingFocus = null;
  if (i) { view.z = 1; focusItem(i); }
}

async function openFind() {
  const d = $('#find');
  if (d.open) return;
  if (editing) stopEdit(); else commit();
  await flush(); // so the open board's latest edits are searchable
  $('#findInput').value = ''; $('#findList').replaceChildren();
  d.showModal();
  index = (await Promise.all((await boards()).map(async n => {
    try { return (await (await fetch(api(n))).json()).items.map(i => ({ board: n, id: i.id, type: i.type, text: textOf(i) })); } catch { return []; }
  }))).flat().filter(x => x.text);
  findRender();
}

function findRender() {
  const q = $('#findInput').value.trim().toLocaleLowerCase(), list = $('#findList');
  const hits = q ? index.filter(x => x.text.toLocaleLowerCase().includes(q)).slice(0, 40) : [];
  list.replaceChildren(...hits.map(x => {
    const at = Math.max(0, x.text.toLocaleLowerCase().indexOf(q) - 30);
    return h('button', { onclick: () => { $('#find').close(); pendingFocus = x.id; x.board === name ? showPending() : go(x.board); } },
      h('span', { textContent: (at ? '…' : '') + x.text.slice(at, at + 90).replace(/\s+/g, ' ') }), h('small', { textContent: `${x.board} · ${x.type}` }));
  }));
  if (q && !hits.length) list.append(h('p', { textContent: 'No matches on any board' }));
}
$('#findInput').oninput = findRender;
$('#findInput').onkeydown = e => { if (e.key === 'Enter') $('#findList button')?.click(); };
$('#find').onclick = e => { if (e.target === $('#find')) $('#find').close(); }; // click outside closes
$('#findBtn').onclick = openFind;
$('#fitBtn').onclick = fit;
$('#alignMenu').onclick = e => { const k = e.target.dataset.al; if (k) { $('#alignMenu').hidePopover(); align(k); } };

// ---------- PDF ----------

// Printing gives a vector PDF. The page is sized to the selection (or the whole board) and everything else is hidden; see @media print.
function printSetup() {
  if (editing) stopEdit();
  const S = sel.size ? carried(selected()) : board.items;
  if (!S.length) return false;
  const b = bounds(S), pad = 32, keep = new Set(S.map(i => i.id));
  for (const [id, e] of els) e.classList.toggle('noprint', !keep.has(id));
  pg.textContent = `@page{size:${Math.ceil(b.w + pad * 2)}px ${Math.ceil(b.h + pad * 2)}px;margin:0}@media print{#world{transform:translate(${pad - b.x}px,${pad - b.y}px)!important}}`;
  return true;
}
const exportPDF = () => { if (printSetup()) print(); };
addEventListener('beforeprint', printSetup); // the browser's own Print command gets the same layout
$('#pdfBtn').onclick = exportPDF;

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
  if (pendingFocus) showPending();
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
openBoard().then(() => { if (new URLSearchParams(location.search).has('print')) printSetup(); }); // ?print lays the page out for a headless print-to-pdf
