import { ensureProductionFoundation } from "@/modules/settings/application/production-foundation-service";
import { loadEnvironmentContract } from "@/shared/core/config/environment-contract";
import { getDatabaseClient } from "@/shared/core/database/client";

const expectedProjectRef = "zbzztpzviyjxpprqcegs";
const workspaceSlug = "politizai";
const contract = loadEnvironmentContract(process.env);
const databaseIdentity = contract.databaseUrl.username.endsWith(`.${expectedProjectRef}`)
  || contract.databaseUrl.hostname === `db.${expectedProjectRef}.supabase.co`;

if (contract.APP_ENV !== "production" || contract.PROCESS_ROLE !== "bootstrap" || !databaseIdentity) {
  throw new Error("Inicialização permitida apenas para o banco de produção Politizai identificado.");
}
if (!new Set(["--dry-run", "--apply"]).has(process.argv[2] ?? "") || process.argv.length !== 3) {
  throw new Error("Uso: tsx scripts/run-production-foundation.ts --dry-run|--apply");
}

const database = getDatabaseClient();
try {
  const dryRun = process.argv[2] === "--dry-run";
  const created = await ensureProductionFoundation(database, workspaceSlug, dryRun);
  process.stdout.write(`${JSON.stringify({ workspace: workspaceSlug, dryRun, created })}\n`);
} finally {
  await database.$disconnect();
}
