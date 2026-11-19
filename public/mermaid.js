// Mermaid flowchart text -> Slate items: shapes for nodes, attached elbow lines for edges, laid out in ranks.
// Used by the app (paste) and by `slate mermaid`. Covers `graph`/`flowchart` only; subgraphs, styles and classes are skipped.
function mermaidItems(src, prefix = 'mm-') {
  const lines = String(src).replace(/^\s*```\s*(mermaid)?\s*$/gm, '').replace(/%%.*$/gm, '').split(/\n|;/).map(s => s.trim()).filter(Boolean);
  const head = /^(?:graph|flowchart)\b\s*(TB|TD|BT|LR|RL)?/i.exec(lines[0] || '');
  if (!head) throw new Error('not a Mermaid flowchart: it must start with "flowchart" or "graph"');
  const dir = (head[1] || 'TD').toUpperCase();
  const nodes = new Map(), edges = [];
  const SHAPES = [['(((', ')))', 'ellipse'], ['((', '))', 'ellipse'], ['([', '])', 'ellipse'], ['[[', ']]', 'rect'], ['[(', ')]', 'rect'],
    ['{{', '}}', 'diamond'], ['[/', '/]', 'rect'], ['[\\', '\\]', 'rect'], ['[/', '\\]', 'rect'], ['[\\', '/]', 'rect'],
    ['[', ']', 'rect'], ['(', ')', 'rect'], ['{', '}', 'diamond'], ['>', ']', 'rect']];
  const clean = t => t.trim().replace(/^"([^]*)"$/, '$1').replace(/<br\s*\/?>/gi, '\n').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

  // One node at the start of `s`: its id, and its shape and text when they are given here. Returns [id, rest] or null.
  function node(s) {
    const m = /^([\p{L}\p{N}_]+)/u.exec(s);
    if (!m) return null;
    const id = m[1];
    let rest = s.slice(id.length);
    const sh = SHAPES.find(([o, c]) => rest.startsWith(o) && rest.indexOf(c, o.length) >= 0);
    if (!nodes.has(id)) nodes.set(id, { text: id, shape: 'rect' });
    if (sh) {
      const [o, c, shape] = sh, q = rest[o.length] === '"' ? rest.indexOf('"', o.length + 1) + 1 : o.length; // a quoted label may hold the closing brackets
      const end = rest.indexOf(c, q);
      Object.assign(nodes.get(id), { text: clean(rest.slice(o.length, end)), shape });
      rest = rest.slice(end + c.length);
    }
    return [id, rest.replace(/^:::[\w-]+/, '').trimStart()];
  }
  // `A & B`: one or more nodes.
  function group(s) {
    const ids = [];
    for (let r; (r = node(s)); ) { ids.push(r[0]); s = r[1]; const a = /^&\s*/.exec(s); if (!a) break; s = s.slice(a[0].length); }
    return ids.length ? [ids, s] : null;
  }
  // An edge at the start of `s`: `-- text -->` first, then `-->|text|`, `---`, `-.->`, `==>`, `<-->`.
  function edge(s) {
    let m = /^(<?)(?:--|==|-\.)\s*([^\-=.>|\s][^]*?)\s*(-{2,}|={2,}|\.+-)([>xo]?)\s*/.exec(s);
    if (m) return [{ back: m[1], line: m[3], head: m[4], label: m[2] }, s.slice(m[0].length)];
    m = /^(<?)(-{2,}|={2,}|-?\.+-?)([>xo]?)\s*(?:\|([^|]*)\|)?\s*/.exec(s);
    return m ? [{ back: m[1], line: m[2], head: m[3], label: m[4] }, s.slice(m[0].length)] : null;
  }

  for (const l of lines.slice(1)) {
    if (/^(subgraph|end|direction|classDef|class|style|linkStyle|click|accTitle|accDescr|title)\b/.test(l)) continue;
    let g = group(l);
    while (g) {
      const e = edge(g[1]);
      if (!e) break;
      const n = group(e[1]);
      if (!n) break;
      for (const a of g[0]) for (const b of n[0]) edges.push({ a, b, ...e[0] });
      g = n;
    }
  }
  if (!nodes.size) throw new Error('the flowchart has no nodes');

  // Ranks: longest path from the roots, ignoring edges that close a cycle.
  const ids = [...nodes.keys()], out = new Map(ids.map(i => [i, []])), state = new Map(), forward = [];
  for (const e of edges) out.get(e.a).push(e);
  const visit = v => { state.set(v, 1); for (const e of out.get(v)) { if (state.get(e.b) === 1) continue; forward.push(e); if (!state.has(e.b)) visit(e.b); } state.set(v, 2); };
  const hasIn = new Set(edges.map(e => e.b));
  for (const v of [...ids.filter(i => !hasIn.has(i)), ...ids]) if (!state.has(v)) visit(v);
  const rank = new Map(ids.map(i => [i, 0]));
  for (let k = 0, moved = true; moved && k < ids.length; k++) {
    moved = false;
    for (const e of forward) if (rank.get(e.b) < rank.get(e.a) + 1) { rank.set(e.b, rank.get(e.a) + 1); moved = true; }
  }
  const layers = [];
  for (const v of ids) (layers[rank.get(v)] ||= []).push(v);
  // Order each layer by where its parents sit, so edges cross less.
  const pos = new Map();
  layers.forEach(L => L.forEach((v, i) => pos.set(v, i)));
  for (let pass = 0; pass < 2; pass++) for (const L of layers.slice(1)) {
    const bc = v => { const p = forward.filter(e => e.b === v).map(e => pos.get(e.a)); return p.length ? p.reduce((a, b) => a + b) / p.length : pos.get(v); };
    const key = new Map(L.map(v => [v, bc(v)]));
    L.sort((a, b) => key.get(a) - key.get(b)).forEach((v, i) => pos.set(v, i));
  }

  // Sizes from the text, then place layer by layer along the flow and centre each layer across it.
  const size = v => {
    const { text, shape } = nodes.get(v), rows = text.split('\n'), long = Math.max(...rows.map(r => r.length));
    const w = Math.min(280, Math.max(140, long * 8 + 40)), wrap = rows.reduce((n, r) => n + Math.max(1, Math.ceil(r.length * 8 / (w - 32))), 0);
    const h = 40 + wrap * 20;
    return shape === 'diamond' ? [Math.max(170, w + 40), Math.max(110, h + 40)] : shape === 'ellipse' ? [w + 20, h + 10] : [w, h];
  };
  const across = dir === 'LR' || dir === 'RL', gapAlong = across ? 100 : 80, gapAcross = across ? 40 : 50;
  const sz = new Map(ids.map(v => [v, size(v)])), A = v => sz.get(v)[across ? 0 : 1], C = v => sz.get(v)[across ? 1 : 0];
  const spans = layers.map(L => L.reduce((n, v) => n + C(v), 0) + gapAcross * (L.length - 1)), widest = Math.max(...spans);
  const items = [], at = new Map();
  let along = 0;
  layers.forEach((L, k) => {
    const deep = Math.max(...L.map(A));
    let c = (widest - spans[k]) / 2;
    for (const v of L) {
      const a = along + (deep - A(v)) / 2;
      at.set(v, across ? [a, c] : [c, a]);
      c += C(v) + gapAcross;
    }
    along += deep + gapAlong;
  });
  if (dir === 'BT' || dir === 'RL') for (const [v, [x, y]] of at) at.set(v, across ? [along - gapAlong - x - A(v), y] : [x, along - gapAlong - y - A(v)]);
  for (const v of ids) {
    const [x, y] = at.get(v), [w, h] = sz.get(v);
    const { text, shape } = nodes.get(v);
    items.push({ id: prefix + v, type: 'shape', x: Math.round(x), y: Math.round(y), w, h, shape, text, ...(shape === 'diamond' ? { color: '#ff9500', fill: true } : {}) });
  }
  const mid = v => { const [x, y] = at.get(v), [w, h] = sz.get(v); return [x + w / 2, y + h / 2]; };
  edges.forEach((e, k) => {
    const p = mid(e.a), q = mid(e.b), x = Math.round(Math.min(p[0], q[0])), y = Math.round(Math.min(p[1], q[1]));
    items.push({
      id: `${prefix}e${k + 1}`, type: 'line', x, y, points: [[Math.round(p[0]) - x, Math.round(p[1]) - y], [Math.round(q[0]) - x, Math.round(q[1]) - y]],
      from: prefix + e.a, to: prefix + e.b, ...(forward.includes(e) ? { elbow: true } : {}), // a cycle's way back goes straight, off the elbow it would retrace
      ...(e.head ? { arrow: e.back ? 'both' : true } : {}), ...(e.line.includes('.') ? { dash: true } : {}), ...(e.line.startsWith('=') ? { width: 4 } : {}),
      ...(e.label?.trim() ? { label: clean(e.label) } : {}),
    });
  });
  return items;
}
if (typeof module === 'object') module.exports = mermaidItems;
