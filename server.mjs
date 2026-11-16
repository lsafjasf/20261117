import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const initialPort = Number(process.env.PORT || 4173);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".csv": "text/csv; charset=utf-8"
};

const requestHandler = async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://local").pathname);
  const safePath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);
  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "Content-Type": types[extname(filePath)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
};

function startServer(port) {
  const server = createServer(requestHandler);
  server.once("error", (error) => {
    if (error.code === "EADDRINUSE" && port < initialPort + 20) {
      startServer(port + 1);
      return;
    }
    throw error;
  });
  server.listen(port, () => {
    console.log(`Station density field: http://localhost:${port}`);
  });
}

startServer(initialPort);
