import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT) || 8710;
const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json'
};

createServer(async (req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const filePath = normalize(join(root, urlPath === '/' ? 'index.html' : urlPath));
  if (!filePath.startsWith(root)) {
    res.writeHead(403); res.end('forbidden'); return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
}).listen(port, () => {
  console.log(`strat column app: http://localhost:${port}/`);
});
