// Tiny static server that behaves like GitHub Pages, for the e2e test:
// - the site lives under /HIKE_SAFE/
// - an existing file is served as is
// - a missing path gets dist/404.html with status 404 (exactly what Pages does)
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const BASE = '/HIKE_SAFE';
const ROOT = join(import.meta.dirname, '..', 'dist');
const PORT = Number(process.env.PORT ?? 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.ttf': 'font/ttf', '.ico': 'image/x-icon',
};

function send(res, status, file) {
  res.writeHead(status, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
}

createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === BASE) { res.writeHead(301, { location: `${BASE}/` }); return res.end(); }
  if (!path.startsWith(`${BASE}/`)) { res.writeHead(404); return res.end('Not found'); }

  // normalize() + startsWith(ROOT) blocks "../" path traversal.
  let file = normalize(join(ROOT, path.slice(BASE.length)));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (existsSync(file)) return send(res, 200, file);

  const fallback = join(ROOT, '404.html');
  if (existsSync(fallback)) return send(res, 404, fallback);
  res.writeHead(404); res.end('Not found');
}).listen(PORT, () => console.log(`Serving dist/ at http://localhost:${PORT}${BASE}/`));
