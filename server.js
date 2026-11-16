"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT) || 4321;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".otf": "font/otf",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml"
};

const server = http.createServer(function (request, response) {
  const url = new URL(request.url, "http://" + (request.headers.host || "localhost"));
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.resolve(root, "." + pathname);

  if (!filePath.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.stat(filePath, function (statError, stat) {
    if (statError || !stat.isFile()) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mime[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache"
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    fs.createReadStream(filePath).pipe(response);
  });
});

server.listen(port, "0.0.0.0", function () {
  console.log("Flow control simulator: http://localhost:" + port);
});
