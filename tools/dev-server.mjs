import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const viewerRoot = path.resolve("app/src/main/assets/viewer");
const generatedViewerRoot = path.resolve("app/build/generated/hangul4u/assets/viewer");
const sampleRoot = path.resolve("samples");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".hwpx": "application/octet-stream",
  ".hwp": "application/octet-stream",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function resolveUnder(root, requestPath) {
  const relative = decodeURIComponent(requestPath).replace(/^\/+/, "");
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) && file !== root) return null;
  return file;
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const sample = url.pathname.startsWith("/samples/");
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname.replace(/^\/samples\//, "/");
  const requestPath = sample ? url.pathname.slice("/samples".length) : pathname;
  let file = resolveUnder(sample ? sampleRoot : viewerRoot, requestPath);
  // 빌드가 만든 build-info.json 은 generated 쪽을 우선한다.
  if (!sample && pathname === "/build-info.json") {
    const generated = resolveUnder(generatedViewerRoot, "/build-info.json");
    if (generated && fs.existsSync(generated)) file = generated;
  }
  if (!file) {
    response.writeHead(403);
    response.end();
    return;
  }
  fs.readFile(file, (error, data) => {
    if (error) {
      response.writeHead(404);
      response.end("not found");
      return;
    }
    const type = types[path.extname(file).toLowerCase()] ?? "application/octet-stream";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
    response.end(data);
  });
});

server.listen(8765, "127.0.0.1", () => {
  console.log("viewer http://127.0.0.1:8765/");
});
