// Production build: the site is plain HTML, CSS and ES modules, so the export is src/ copied
// verbatim into dist/. The build also refuses root-relative asset URLs, which would break
// the site when it is served from a gateway subpath.
import { cpSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const dist = join(root, "dist");

rmSync(dist, { recursive: true, force: true });
cpSync(src, dist, { recursive: true });

/** @param {string} dir @returns {string[]} */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(dist);
const html = readFileSync(join(dist, "index.html"), "utf8");
const rootRelative = [...html.matchAll(/\s(?:src|href|content)="(\/[^/"][^"]*)"/g)].map((m) => m[1]);
if (rootRelative.length) {
  console.error(`Root-relative URLs in index.html: ${rootRelative.join(", ")}`);
  process.exit(1);
}
for (const ref of html.matchAll(/\s(?:src|href)="\.\/([^"#?]+)"/g)) {
  if (!files.includes(join(dist, ref[1]))) {
    console.error(`index.html references a missing file: ./${ref[1]}`);
    process.exit(1);
  }
}

let bytes = 0;
for (const file of files) {
  const size = statSync(file).size;
  bytes += size;
  console.log(`  ${relative(root, file).padEnd(24)} ${size.toLocaleString("en-US").padStart(8)} B`);
}
console.log(`Built ${files.length} files, ${bytes.toLocaleString("en-US")} bytes, into dist/`);
