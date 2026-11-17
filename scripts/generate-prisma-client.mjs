import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const supportedRuntimes = new Set(["workerd"]);
const runtime = process.argv[2];
if (!runtime || !supportedRuntimes.has(runtime)) {
  throw new Error(`Runtime Prisma inválido: ${runtime ?? "ausente"}.`);
}

const projectRoot = process.cwd();
const sourcePath = path.join(projectRoot, "prisma", "schema.prisma");
const outputPath = path.join(projectRoot, "src", "generated", "prisma");
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "crm-prisma-"));
const temporarySchemaPath = path.join(temporaryDirectory, "schema.prisma");

try {
  const source = await readFile(sourcePath, "utf8");
  const temporarySchema = source
    .replace(/output\s+=\s+"\.\.\/src\/generated\/prisma"/, `output   = ${JSON.stringify(outputPath)}`)
    .replace(/runtime\s+=\s+"nodejs"/, `runtime  = ${JSON.stringify(runtime)}`);

  if (temporarySchema === source) {
    throw new Error("Não foi possível preparar o schema Prisma temporário.");
  }

  await writeFile(temporarySchemaPath, temporarySchema, { mode: 0o600 });

  await new Promise((resolve, reject) => {
    const prisma = spawn(path.join(projectRoot, "node_modules", ".bin", "prisma"), [
      "generate",
      "--schema",
      temporarySchemaPath,
    ], { cwd: projectRoot, env: process.env, stdio: "inherit" });
    prisma.once("error", reject);
    prisma.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`prisma generate falhou (${signal ?? `código ${code}`}).`));
    });
  });
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
