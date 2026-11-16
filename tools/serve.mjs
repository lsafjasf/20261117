// Tiny zero-dependency static server with correct MIME types for ES modules.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = createServer(async (req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const relative = normalize(urlPath === '/' ? '/web/index.html' : urlPath);
  const filePath = join(root, relative);
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

function listen(port) {
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`port ${port} busy, trying ${port + 1}`);
      listen(port + 1);
    } else {
      throw error;
    }
  });
  server.listen(port, () => {
    console.log(`serving ${root} at http://localhost:${port}/web/index.html`);
  });
}

listen(Number(process.env.PORT) || 8123);
