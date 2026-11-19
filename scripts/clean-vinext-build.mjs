import { rm } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const generatedPaths = [
  ".cloudflare/output",
  ".vinext/cache",
  "dist",
];

for (const generatedPath of generatedPaths) {
  await rm(path.join(projectRoot, generatedPath), { recursive: true, force: true });
}
