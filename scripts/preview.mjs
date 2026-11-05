// Serve dist/ locally under a subpath (/squeek/) so broken relative URLs show up the way they
// would on an IPFS gateway. Usage: npm run preview [-- --port 4173]. Stop it with Ctrl+C.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const portFlag = process.argv.indexOf("--port");
const port = portFlag > -1 ? Number(process.argv[portFlag + 1]) : 4173;
const base = "/squeek/";
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname === "/" || url.pathname === base.slice(0, -1)) {
    res.writeHead(302, { Location: base });
    res.end();
    return;
  }
  if (!url.pathname.startsWith(base)) {
    res.writeHead(404).end("Not found");
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname.slice(base.length)) || "index.html");
  if (rel.startsWith("..")) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  let file = join(root, rel);
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": types[/** @type {keyof typeof types} */ (extname(file))] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}).listen(port, () => {
  console.log(`Previewing dist/ at http://localhost:${port}${base}`);
});
