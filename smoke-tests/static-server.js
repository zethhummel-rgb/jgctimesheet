const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const portFlag = process.argv.indexOf("--port");
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : process.env.JGC_SMOKE_PORT || 41738);

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

function send(response, status, body, headers = {}) {
  response.writeHead(status, Object.assign({
    "Cache-Control": "no-store"
  }, headers));
  response.end(body);
}

const server = http.createServer((request, response) => {
  if (!request.url || !["GET", "HEAD"].includes(request.method || "")) {
    send(response, 405, "Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
  } catch (error) {
    send(response, 400, "Bad request");
    return;
  }

  if (pathname === "/") {
    pathname = "/index.html";
  }

  const requestedPath = path.resolve(root, `.${pathname}`);
  if (requestedPath !== root && !requestedPath.startsWith(root + path.sep)) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.stat(requestedPath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      send(response, 404, "Not found");
      return;
    }

    const headers = {
      "Content-Type": mimeTypes[path.extname(requestedPath).toLowerCase()] || "application/octet-stream",
      "Content-Length": String(stats.size)
    };
    if (path.basename(requestedPath).toLowerCase() === "service-worker.js") {
      headers["Service-Worker-Allowed"] = "/";
    }

    if (request.method === "HEAD") {
      send(response, 200, "", headers);
      return;
    }

    response.writeHead(200, Object.assign({ "Cache-Control": "no-store" }, headers));
    fs.createReadStream(requestedPath).pipe(response);
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`JGC smoke server listening on http://127.0.0.1:${port}\n`);
});

function closeServer() {
  if (typeof server.closeAllConnections === "function") {
    server.closeAllConnections();
  }
  server.close();
  process.exit(0);
}

process.on("SIGINT", closeServer);
process.on("SIGTERM", closeServer);
