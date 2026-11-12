// Slate — local whiteboard server. No dependencies. `node server.js`
const http = require('http'), fs = require('fs'), path = require('path');

const PORT = process.env.PORT || 4747;
const PUB = path.join(__dirname, 'public');
const { ASSETS, BOARDS, RUN, NAME, EMPTY, file, list, format } = require('./lib');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4',
};

// Live reload: tell browsers which board someone else (an agent, an editor) changed, created or deleted.
const lastWritten = new Map(list().map(n => [n, fs.readFileSync(file(n), 'utf8')])), timers = new Map();
const clients = new Set();
const broadcast = n => { for (const c of clients) c.write(`data: ${n}\n\n`); };
fs.watch(BOARDS, (_, f) => {
  const n = f && f.endsWith('.json') ? f.slice(0, -5) : '';
  if (!NAME.test(n)) return;
  clearTimeout(timers.get(n));
  timers.set(n, setTimeout(() => {
    let s = null;
    try { s = fs.readFileSync(file(n), 'utf8'); JSON.parse(s); }
    catch (e) { if (e.code !== 'ENOENT') return; s = null; } // half-written or invalid: wait for the next event
    if (s === (lastWritten.get(n) ?? null)) return; // our own write
    s === null ? lastWritten.delete(n) : lastWritten.set(n, s);
    broadcast(n);
  }, 80));
});

const readBody = req => new Promise((res, rej) => {
  const chunks = [];
  req.on('data', d => chunks.push(d)).on('end', () => res(Buffer.concat(chunks))).on('error', rej);
});

const safe = (root, p) => {
  const f = path.join(root, path.normalize('/' + p));
  return f.startsWith(root) ? f : null;
};

function sendFile(req, res, file) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return res.writeHead(404).end('Not found');
    const head = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || ''); // range requests so videos can seek
    if (m && (m[1] || m[2])) {
      const start = m[1] ? +m[1] : Math.max(0, st.size - +m[2]);
      const end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      if (start > end) return res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
      res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { ...head, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

http.createServer(async (req, res) => {
  try {
    // Local only: reject DNS-rebinding hosts and writes coming from other websites.
    if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) return res.writeHead(403).end();
    const origin = req.headers.origin;
    if (req.method !== 'GET' && origin && new URL(origin).host !== req.headers.host) return res.writeHead(403).end();

    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);

    if (p === '/api/boards' && req.method === 'GET') return res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(list()));

    if (p === '/api/board') {
      const name = url.searchParams.get('b') || '';
      if (!NAME.test(name)) return res.writeHead(400).end('Bad board name');
      if (req.method === 'GET') return sendFile(req, res, file(name));
      if (req.method === 'PUT') {
        const b = JSON.parse(await readBody(req));
        if (!Array.isArray(b.items)) return res.writeHead(400).end('items must be an array');
        const out = format(b), isNew = !lastWritten.has(name);
        lastWritten.set(name, out);
        fs.writeFileSync(file(name) + '.tmp', out);
        fs.renameSync(file(name) + '.tmp', file(name)); // atomic: readers never see a half-written board
        if (isNew) broadcast(name); // other tabs refresh their board list
        return res.writeHead(204).end();
      }
      if (req.method === 'DELETE') {
        fs.rmSync(file(name), { force: true });
        lastWritten.delete(name);
        if (!list().length) { fs.writeFileSync(file('main'), EMPTY); lastWritten.set('main', EMPTY); } // always keep one board
        broadcast(name);
        return res.writeHead(204).end();
      }
    }

    if (p === '/api/upload' && req.method === 'POST') {
      const name = Date.now().toString(36) + '-' + path.basename(url.searchParams.get('name') || 'file').replace(/[^\w.-]/g, '_');
      if (!MIME[path.extname(name).toLowerCase()]) return res.writeHead(415).end('Unsupported file type');
      const out = fs.createWriteStream(path.join(ASSETS, name));
      req.pipe(out);
      out.on('finish', () => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ src: '/assets/' + name })));
      out.on('error', () => res.writeHead(500).end());
      return;
    }

    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 1000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method !== 'GET') return res.writeHead(405).end();
    const target = p.startsWith('/assets/') ? safe(ASSETS, p.slice(8)) : safe(PUB, p === '/' ? 'index.html' : p);
    if (!target) return res.writeHead(403).end();
    sendFile(req, res, target);
  } catch (e) {
    res.writeHead(400).end(String(e.message || e));
  }
}).listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  fs.writeFileSync(RUN, JSON.stringify({ port: +PORT, pid: process.pid, url })); // lets the CLI and agents find a running server
  console.log(`Slate → ${url}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { fs.rmSync(RUN, { force: true }); process.exit(); });
