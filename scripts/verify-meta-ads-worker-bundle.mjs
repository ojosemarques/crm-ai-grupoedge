import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const outputRoot = path.join(process.cwd(), ".cloudflare", "output");
const requiredMarkers = new Set([
  "BUSINESS_MISSING",
  "ACCOUNT_ALLOWLIST_MISSING",
  "ACCOUNT_SELECTION_MISSING",
  "ACCOUNT_MISMATCH",
]);
const legacyMarker = "META_REPORTING_TARGET_MISMATCH";
let legacyMarkerFound = false;

async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await inspect(entryPath);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;

    const source = await readFile(entryPath, "utf8");
    if (source.includes(legacyMarker)) legacyMarkerFound = true;
    for (const marker of requiredMarkers) {
      if (source.includes(marker)) requiredMarkers.delete(marker);
    }
  }
}

await inspect(outputRoot);

if (legacyMarkerFound || requiredMarkers.size > 0) {
  const missing = [...requiredMarkers].join(", ") || "nenhum";
  throw new Error(`Bundle Meta Ads obsoleto: legado=${legacyMarkerFound}; ausentes=${missing}.`);
}

console.log("Bundle Meta Ads validado sem o validador legado.");
