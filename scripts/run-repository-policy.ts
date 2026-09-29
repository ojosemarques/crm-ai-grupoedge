import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";

import {
  inspectRepositoryFiles,
  type RepositoryFile,
} from "@/shared/core/security/repository-policy";

const MAX_SCANNABLE_BYTES = 5 * 1024 * 1024;
const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const files: RepositoryFile[] = [];

for (const path of tracked) {
  const metadata = await stat(path);
  if (metadata.size > MAX_SCANNABLE_BYTES) {
    throw new Error(`Arquivo versionado excede o limite seguro de varredura: ${path}`);
  }
  const contents = await readFile(path);
  if (contents.includes(0)) continue;
  files.push({ path, content: contents.toString("utf8") });
}

const violations = inspectRepositoryFiles(files);
if (violations.length > 0) {
  process.stderr.write("POLÍTICA DO REPOSITÓRIO: BLOQUEADA\n");
  for (const violation of violations) {
    process.stderr.write(`${violation.path}:${violation.line} [${violation.code}] ${violation.message}\n`);
  }
  process.exitCode = 1;
} else {
  process.stdout.write(`POLÍTICA DO REPOSITÓRIO: APROVADA (${tracked.length} arquivos rastreados).\n`);
}
