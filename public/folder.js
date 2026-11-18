// Slate without its server. On any host but localhost (public/ copied to a static web host, say) the boards live in a
// folder the user picks: the same data/ folder that cli.js and agents edit. Like the shared HTML export, this stands in
// for server.js by answering the app's /api calls. Needs the File System Access API (Chrome, Edge, Brave on a computer).
(() => {
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return; // server.js is serving us
  const NAME = /^[\p{L}\p{N}_][\p{L}\p{N}_ -]{0,59}$/u, EMPTY = '{"items":[\n]}\n'; // as in lib.js
  const MEDIA = /\.(png|jpe?g|gif|webp|svg|avif|mp4|webm|mov|m4v)$/i;
  const format = ({ items, ...rest }) => // lib.js format: one item per line
    JSON.stringify(rest).slice(0, -1) + (Object.keys(rest).length ? ',' : '') +
    '"items":[\n' + items.map(i => JSON.stringify(i)).join(',\n') + '\n]}\n';
  const realFetch = fetch.bind(window);
  const written = new Map(), stamps = new Map(), assets = new Map(); // board → last text seen, board → mtime, /assets/x → blob URL
  let root, boards, es, open, hinted = false; // hinted: the user closed the note below
  const hint = document.getElementById('agentHint'); // shown while the slate command keeps its boards in another folder (lib.js writes .cli.json)
  const ready = new Promise(r => open = r);

  const idb = (mode, fn) => new Promise((res, rej) => {
    const o = indexedDB.open('slate', 1);
    o.onupgradeneeded = () => o.result.createObjectStore('kv');
    o.onerror = () => rej(o.error);
    o.onsuccess = () => { const q = fn(o.result.transaction('kv', mode).objectStore('kv')); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); };
  });
  const sub = (d, n, create = false) => d.getDirectoryHandle(n, { create }).catch(e => { if (create) throw e; return null; });
  const text = async n => (await (await boards.getFileHandle(n + '.json')).getFile()).text();
  async function names() {
    const out = [];
    for await (const [f, h] of boards) if (h.kind === 'file' && f.endsWith('.json') && NAME.test(f.slice(0, -5))) out.push(f.slice(0, -5));
    return out.sort((a, b) => a.localeCompare(b));
  }
  async function put(dir, f, data) { // close() swaps the finished file in, so agents never read a half-written board
    const w = await (await dir.getFileHandle(f, { create: true })).createWritable();
    await w.write(data); await w.close();
  }
  async function scanAssets() {
    const d = await sub(root, 'assets');
    if (d) for await (const [f, h] of d) if (h.kind === 'file' && !assets.has('/assets/' + f)) assets.set('/assets/' + f, URL.createObjectURL(await h.getFile()));
  }
  const res = (status, body = null, type) => new Response(body, { status, headers: type ? { 'Content-Type': type } : {} });
  const json = v => res(200, JSON.stringify(v), 'application/json');

  // The routes of server.js, same answers.
  async function api(url, o = {}) {
    const p = url.pathname.replace(/^.*(?=\/api\/)/, ''), m = o.method || 'GET', n = url.searchParams.get('b') || '';
    if (p === '/api/boards') return json(await names());
    if (p === '/api/board') {
      if (!NAME.test(n)) return res(400, 'Bad board name');
      if (m === 'GET') return res(200, await text(n), 'application/json');
      if (m === 'PUT') {
        const b = JSON.parse(o.body);
        if (!Array.isArray(b.items)) return res(400, 'items must be an array');
        const s = format(b);
        await put(boards, n + '.json', s);
        written.set(n, s);
        return res(204);
      }
      if (m === 'DELETE') {
        await boards.removeEntry(n + '.json').catch(() => {});
        written.delete(n); stamps.delete(n);
        if (!(await names()).length) await put(boards, 'main.json', EMPTY); // always keep one board
        return res(204);
      }
    }
    if (p === '/api/cursor' && m === 'PUT') { // what the user has selected, for `cli.js selection`
      const c = JSON.parse(o.body);
      await put(root, '.cursor.json', JSON.stringify({ board: String(c.board), selected: [].concat(c.selected || []).map(String), at: new Date().toISOString() }));
      return res(204);
    }
    if (p === '/api/upload' && m === 'POST') {
      const f = Date.now().toString(36) + '-' + (url.searchParams.get('name') || 'file').split(/[\\/]/).pop().replace(/[^\w.-]/g, '_');
      if (!MEDIA.test(f)) return res(415, 'Unsupported file type');
      await put(await sub(root, 'assets', true), f, o.body);
      assets.set('/assets/' + f, URL.createObjectURL(o.body));
      return json({ src: '/assets/' + f });
    }
    if (p === '/api/export' && NAME.test(n)) return res(200, await exportHTML(n), 'text/html; charset=utf-8');
    return res(404, 'Not found');
  }

  // lib.js exportHTML, done in the page: keep the two in step.
  async function exportHTML(n) {
    const [page, css, js] = await Promise.all(['index.html', 'style.css', 'app.js'].map(f => realFetch(f).then(r => r.text())));
    const board = JSON.parse(await text(n));
    for (const i of board.items) if (assets.has(i.src)) {
      const blob = await (await realFetch(assets.get(i.src))).blob();
      i.src = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
    }
    const shim = `(() => {
  const name = ${JSON.stringify(n)}, board = ${JSON.stringify(board).replace(/</g, '\\u003c')};
  window.fetch = async (u, o) => o ? new Response(null, { status: 503 }) : new Response(JSON.stringify(String(u).startsWith('/api/boards') ? [name] : board));
  window.EventSource = function () {};
  document.getElementById('status').textContent = 'Shared copy: changes are not saved';
})();`;
    return page
      .replace('<script src="folder.js"></script>\n', '')
      .replace('<link rel="stylesheet" href="style.css">', () => `<style>${css}\n#shareBtn, #boardMenu { display: none !important; }</style>`)
      .replace('<script src="app.js"></script>', () => `<script>${shim}</script>\n<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);
  }

  window.fetch = async (u, o) => {
    const url = new URL(u, location.href);
    if (url.origin !== location.origin || !url.pathname.includes('/api/')) return realFetch(u, o);
    await ready;
    try { return await api(url, o); }
    catch (e) { return res(e.name === 'NotFoundError' ? 404 : 500, String(e.message || e)); }
  };
  window.slateAsset = s => assets.get(s); // app.js shows /assets/… media through this

  // Live reload: what server.js gets from fs.watch, by polling. Tells the app which board someone else changed.
  async function changes() {
    const now = new Set(await names()), out = [];
    for (const n of now) {
      const f = await (await boards.getFileHandle(n + '.json')).getFile();
      if (f.lastModified === stamps.get(n)) continue;
      const s = await f.text();
      try { JSON.parse(s); } catch { continue; } // half-written or invalid: look again next time
      stamps.set(n, f.lastModified);
      if (s !== written.get(n)) { written.set(n, s); out.push(n); } // skips our own writes
    }
    for (const n of stamps.keys()) if (!now.has(n)) { stamps.delete(n); written.delete(n); out.push(n); }
    return out;
  }
  async function watch() {
    try {
      hint.hidden = hinted || !!(await root.getFileHandle('.cli.json').catch(() => null)); // gone as soon as `slate use` marks this folder
      const out = await changes();
      if (out.length) { await scanAssets(); out.forEach(n => es?.onmessage?.({ data: n })); } // an agent adds the file first, then the item
    } catch {}
    setTimeout(watch, 1000); // shortcut: reads every board's mtime each second; use FileSystemObserver if folders grow to hundreds of boards
  }
  window.EventSource = function () { es = this; ready.then(() => this.onopen?.()); };
  window.EventSource.prototype.close = function () { if (es === this) es = null; };

  async function start(dir) {
    const data = await sub(dir, 'data');
    root = !(await sub(dir, 'boards')) && data && await sub(data, 'boards') ? data : dir; // the Slate folder, its data/, or a folder of our own
    boards = await sub(root, 'boards', true);
    if (!(await names()).length) await put(boards, 'main.json', EMPTY);
    await scanAssets(); await changes();
    await idb('readwrite', s => s.put(dir, 'dir')).catch(() => {});
    open(); watch();
    const f = document.getElementById('helpFolder'), change = document.createElement('button');
    change.textContent = 'Change folder';
    change.onclick = document.getElementById('hintPick').onclick = async () => { // the next visit opens the new folder; a reload starts clean
      try { const next = await showDirectoryPicker({ id: 'slate', mode: 'readwrite' }); await idb('readwrite', s => s.put(next, 'dir')); location.reload(); } catch {}
    };
    document.getElementById('hintX').onclick = () => { hinted = true; hint.hidden = true; };
    f.replaceChildren('This tab keeps boards in the folder “', Object.assign(document.createElement('b'), { textContent: dir.name }), '”.', change);
    f.hidden = false;
    beat(); setInterval(beat, 30000);
  }
  // Tells `cli.js status` this folder is open on the web, and where, so agents can hand out the link.
  const beat = () => put(root, '.web.json', JSON.stringify({ url: location.origin + location.pathname.replace(/\/(index\.html)?$/, ''), at: new Date().toISOString() })).catch(() => {});

  // Asking for the folder. The browser remembers the choice; it may still ask once per visit.
  const d = document.getElementById('folder'), note = document.getElementById('folderNote');
  const go = document.getElementById('folderGo'), other = document.getElementById('folderOther');
  document.getElementById('status').textContent = 'Not saved. Is the folder still there?';
  d.oncancel = e => e.preventDefault(); // nothing works without a folder
  function ask(saved) {
    if (!window.showDirectoryPicker) {
      note.textContent = 'This needs Chrome, Edge or Brave on a computer. Other browsers cannot open a folder.';
      go.hidden = other.hidden = true;
    } else if (saved) { go.textContent = 'Open ' + saved.name; other.hidden = false; }
    go.onclick = async () => {
      try {
        const dir = saved || await showDirectoryPicker({ id: 'slate', mode: 'readwrite' });
        if (await dir.requestPermission({ mode: 'readwrite' }) !== 'granted') return;
        d.close(); await start(dir);
      } catch (e) {
        if (e.name === 'AbortError') return;
        note.textContent = 'Could not open that folder: ' + e.message;
        if (!d.open) d.showModal();
      }
    };
    other.onclick = () => { saved = null; go.click(); };
    d.showModal();
  }
  (async () => {
    let saved = null;
    try { saved = await idb('readonly', s => s.get('dir')) || null; } catch {}
    if (saved && await saved.queryPermission({ mode: 'readwrite' }).catch(() => '') === 'granted') return start(saved).catch(() => ask(saved));
    ask(saved);
  })();
})();
