import "dotenv/config";

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { Client } from "pg";

import { recoveryManifestSchema, RESILIENCE_CONTRACT_VERSION } from "@/modules/resilience/domain/resilience-contracts";
import { recordLocalResilienceEvidence } from "./lib/resilience-evidence";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const RESTORE_PATTERN = /^politizai_resilience_restore_[0-9]{8}t[0-9]{6}z_[a-f0-9]{8}$/;
const fingerprintTables = ["_prisma_migrations", "workspaces", "users", "workspace_members", "leads", "activities", "opportunities", "audit_logs"] as const;

function command(name: string, args: readonly string[], input?: Buffer): Buffer {
  const result = spawnSync(name, [...args], { input, maxBuffer: 512 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${name} falhou (${result.status ?? 1}): ${result.stderr.toString().slice(0, 500)}`);
  return result.stdout;
}

async function fingerprint(url: string) {
  const client = new Client({ connectionString: url });
  try {
    await client.connect();
    const output: Record<string, number> = {};
    for (const table of fingerprintTables) {
      const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM public.${table}`);
      output[table] = Number(result.rows[0]?.count ?? 0);
    }
    return output;
  } finally { await client.end(); }
}

async function main() {
  const args = process.argv.slice(2);
  const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const execute = args.includes("--execute");
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória.");
  const parsed = new URL(databaseUrl); parsed.searchParams.delete("schema");
  if (!LOCAL_HOSTS.has(parsed.hostname) || decodeURIComponent(parsed.pathname.slice(1)) !== "politizai_crm" || process.env.NODE_ENV === "production") throw new Error("Restore rehearsal exige o banco local politizai_crm fora de produção.");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase();
  const temporaryDatabase = `politizai_resilience_restore_${stamp}_${randomBytes(4).toString("hex")}`;
  if (!RESTORE_PATTERN.test(temporaryDatabase)) throw new Error("Nome do banco temporário recusado.");
  const output = resolve(value("output") ?? `.cache/resilience/restore-${stamp}.json`);
  const backupPath = resolve(value("backup") ?? `.cache/resilience/backups/public-${stamp}.dump`);
  if (!execute) { process.stdout.write(`${JSON.stringify({ mode: "DRY_RUN", sourceDatabase: "politizai_crm", sourceSchema: "public", temporaryDatabase, backupPath, output, cleanup: true, localOnly: true }, null, 2)}\n`); return; }
  const container = command("docker", ["compose", "ps", "-q", "db"]).toString().trim();
  if (!container) throw new Error("Container PostgreSQL local não encontrado.");
  const user = decodeURIComponent(parsed.username);
  const sourceFingerprint = await fingerprint(parsed.toString());
  const versionClient = new Client({ connectionString: parsed.toString() }); await versionClient.connect();
  const postgresqlVersion = (await versionClient.query<{ server_version: string }>("SHOW server_version")).rows[0]!.server_version; await versionClient.end();
  const dump = command("docker", ["exec", container, "pg_dump", "-U", user, "-d", "politizai_crm", "-n", "public", "-Fc"]);
  command("docker", ["exec", "-i", container, "pg_restore", "--list"], dump);
  mkdirSync(dirname(backupPath), { recursive: true }); writeFileSync(backupPath, dump, { mode: 0o600 });
  const sha256 = createHash("sha256").update(dump).digest("hex");
  const admin = new URL(parsed); admin.pathname = "/postgres";
  const target = new URL(parsed); target.pathname = `/${temporaryDatabase}`;
  let removed = false;
  try {
    command("docker", ["exec", container, "psql", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", "postgres", "-c", `CREATE DATABASE ${temporaryDatabase}`]);
    command("docker", ["exec", "-i", container, "pg_restore", "-v", "--exit-on-error", "--clean", "--if-exists", "--no-owner", "-U", user, "-d", temporaryDatabase], dump);
    const restoredFingerprint = await fingerprint(target.toString());
    const reconciled = JSON.stringify(sourceFingerprint) === JSON.stringify(restoredFingerprint);
    if (!reconciled) throw new Error("Fingerprint restaurado diverge da origem.");
    const adminClient = new Client({ connectionString: admin.toString() }); await adminClient.connect();
    await adminClient.query(`DROP DATABASE ${temporaryDatabase} WITH (FORCE)`); await adminClient.end(); removed = true;
    const manifest = recoveryManifestSchema.parse({ contractVersion: RESILIENCE_CONTRACT_VERSION, sourceDatabase: "politizai_crm", sourceSchema: "public", temporaryDatabase, createdAt: new Date().toISOString(), postgresqlVersion, backupPath, backupSha256: sha256, backupBytes: dump.byteLength, sourceFingerprint, restoredFingerprint, reconciled, temporaryTargetRemoved: removed });
    mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 }); process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
    const recordWorkspace = value("record-workspace");
    if (recordWorkspace) await recordLocalResilienceEvidence({ databaseUrl: databaseUrl, workspaceSlug: recordWorkspace, operation: "resilience.restore.completed", outcome: "SUCCESS", metadata: { reconciled, backupBytes: dump.byteLength, postgresqlVersion, temporaryTargetRemoved: removed, publicTouchedByRestore: false } });
  } finally {
    if (!removed) {
      const adminClient = new Client({ connectionString: admin.toString() }); await adminClient.connect();
      await adminClient.query(`DROP DATABASE IF EXISTS ${temporaryDatabase} WITH (FORCE)`); await adminClient.end();
    }
  }
}

await main();
