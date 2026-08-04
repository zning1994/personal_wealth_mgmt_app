import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ignored = new Set([".git", "node_modules", "out", "release", "dist", ".superpowers"]);
const forbidden = [
  /sk-[A-Za-z0-9]{16,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:password|secret|api[_-]?key)\s*[:=]\s*["'][^"']{16,}["']/i,
];
const extensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".csv", ".md", ".yml", ".yaml", ".txt"]);

function scan(root, current = root, hits = []) {
  if (!existsSync(current)) return hits;
  const stat = lstatSync(current);
  if (stat.isSymbolicLink()) return hits;
  if (stat.isDirectory()) {
    for (const name of readdirSync(current)) if (!ignored.has(name)) scan(root, join(current, name), hits);
    return hits;
  }
  if (!extensions.has(current.slice(current.lastIndexOf(".")))) return hits;
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(current)) return hits;
  const text = readFileSync(current, "utf8");
  for (const pattern of forbidden) if (pattern.test(text)) hits.push({ path: relative(root, current), pattern: pattern.source });
  return hits;
}

const hits = scan(process.cwd());
if (hits.length > 0) {
  console.error(JSON.stringify({ hits }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ status: "clean" }));
}
