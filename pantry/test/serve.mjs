// A tiny static server for the browser tests: serves the repo root, so the app is at /pantry/ (the design kit comes
// from its live address). Optional offline switch for sw.js checks: srv.swOffline = true
// drops requests for pantry/sw.js as if there were no signal.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
export function serve(port = 0) {
  const state = { swOffline: false, hits: [] };
  const srv = createServer(async (req, res) => {
    let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    state.hits.push(p);
    if (state.swOffline && p.endsWith('/sw.js')) return req.socket.destroy();
    if (p.endsWith('/')) p += 'index.html';
    const f = join(root, p);
    try {
      if (!f.startsWith(root) || (await stat(f)).isDirectory()) throw 0;
      const body = await readFile(f);
      res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'cache-control': 'no-cache' });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise(r => srv.listen(port, '127.0.0.1', () => r(Object.assign(state, { url: `http://localhost:${srv.address().port}`, close: () => srv.close() }))));
}
