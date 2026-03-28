const http = require("http");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(process.cwd(), "dist");
const port = Number(process.env.FLASHCARDS_TEST_PORT || 4173);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

http
  .createServer((request, response) => {
    const pathname = decodeURIComponent((request.url || "/").split("?")[0] || "/");
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    const filePath = path.join(rootDir, relativePath);

    fs.readFile(filePath, (error, fileBuffer) => {
      if (error) {
        response.statusCode = 404;
        response.end("not found");
        return;
      }

      response.setHeader(
        "Content-Type",
        contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      );
      response.end(fileBuffer);
    });
  })
  .listen(port, "127.0.0.1", () => {
    console.log(`Flashcards test server listening on http://127.0.0.1:${port}`);
  });
