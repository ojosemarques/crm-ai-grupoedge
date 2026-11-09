import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import pg from "pg";

const project = "zbzztpzviyjxpprqcegs";
const releasePattern = /^20261109090[0-7]00_/;

async function main() {
  const connection = process.env.DIRECT_URL;
  if (!connection) throw new Error("DIRECT_URL é obrigatória.");
  const url = new URL(connection);
  const username = decodeURIComponent(url.username);
  const isProjectHost = url.hostname === `db.${project}.supabase.co` ||
    (url.hostname === "aws-0-ca-central-1.pooler.supabase.com" && username.endsWith(`.${project}`));
  if (!isProjectHost || url.port !== "5432" || url.searchParams.get("schema") !== "crm" ||
    url.searchParams.get("sslmode") !== "verify-full") {
    throw new Error("A conexão deve ser direta ou de sessão, com TLS e schema crm no projeto autorizado.");
  }
  const certificate = url.searchParams.get("sslrootcert");
  if (!certificate) throw new Error("A conexão exige o certificado CA do projeto.");
  const client = new pg.Client({
    host: url.hostname, port: 5432, user: username, password: decodeURIComponent(url.password),
    database: url.pathname.slice(1), ssl: { ca: await readFile(certificate), rejectUnauthorized: true },
    connectionTimeoutMillis: 10_000,
  });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const { rows } = await client.query<{ migration_name: string; checksum: string; finished_at: Date | null }>(
      "SELECT migration_name, checksum, finished_at FROM crm._prisma_migrations WHERE rolled_back_at IS NULL ORDER BY migration_name",
    );
    await client.query("COMMIT");
    if (!rows.length || rows.some((row) => !row.finished_at) || new Set(rows.map((row) => row.migration_name)).size !== rows.length) {
      throw new Error("Há histórico incompleto ou duplicado no ledger Prisma.");
    }
    const root = resolve("prisma/migrations");
    const names = await readdir(root);
    const targets = names.filter((name) => releasePattern.test(name)).sort();
    if (targets.length !== 8 || rows.some((row) => !names.includes(row.migration_name))) {
      throw new Error("A lista de migrations locais não corresponde ao release e ao histórico registrado.");
    }
    const applied = new Set(rows.map((row) => row.migration_name));
    const planned = targets.filter((name) => !applied.has(name));
    const checksums = await Promise.all([...new Set([...applied, ...targets])].sort().map(async (name) => [
      name, createHash("sha256").update(await readFile(join(root, name, "migration.sql"))).digest("hex"),
    ] as const));
    const byName = new Map(checksums);
    const changed = rows.filter((row) => byName.get(row.migration_name) !== row.checksum).map((row) => row.migration_name);
    if (changed.length) throw new Error(`Checksums registrados divergem dos arquivos: ${changed.join(", ")}.`);
    const fingerprint = createHash("sha256").update(JSON.stringify({ checksums, planned })).digest("hex");
    const apply = process.argv.includes("--apply");
    if (apply && !process.argv.includes(`--fingerprint=${fingerprint}`)) throw new Error("A impressão digital do preflight mudou.");
    console.log(JSON.stringify({ ledger: rows.length, planned, fingerprint, mode: apply ? "APPLY" : "STATUS" }));

    const scratch = await mkdtemp(join(tmpdir(), "crm-compensation-migrations-"));
    try {
      const migrations = join(scratch, "migrations");
      await cp(join(root, "migration_lock.toml"), join(migrations, "migration_lock.toml"), { force: false });
      for (const [name] of checksums) await cp(join(root, name), join(migrations, name), { recursive: true });
      const config = join(scratch, "prisma.config.mjs");
      await writeFile(config, `export default { schema: ${JSON.stringify(resolve("prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DIRECT_URL } };\n`);
      const result = spawnSync(resolve("node_modules/.bin/prisma"), ["migrate", apply ? "deploy" : "status", "--config", config], {
        encoding: "utf8", env: { ...process.env, DIRECT_URL: connection }, timeout: 120_000,
      });
      // A saída do Prisma inclui o host e o schema, mas nunca repasse uma mensagem que contenha a URL.
      const redact = (value: string) => value.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[conexão omitida]");
      process.stdout.write(redact(result.stdout ?? ""));
      process.stderr.write(redact(result.stderr ?? ""));
      if (result.error || (result.status !== 0 && (apply || !planned.length || !planned.every((name) => result.stdout?.includes(name))))) {
        throw new Error("O Prisma não confirmou o estado esperado para o conjunto do release.");
      }
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  } finally {
    await client.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[conexão omitida]") : "Falha inesperada.";
  console.error(message);
  process.exitCode = 1;
});
