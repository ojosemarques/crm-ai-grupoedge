import { randomBytes } from "node:crypto";

import { Client } from "pg";

const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const EXPECTED_LOCAL_DATABASE = "politizai_crm";
const TEST_SCHEMA_NAME_PATTERN =
  /^politizai_test_(integration|crm29|e2e|resilience)_[0-9]{8}t[0-9]{6}z_[a-f0-9]{8}$/;

export type TestSchemaKind = "integration" | "crm29" | "e2e" | "resilience";

export type TestSchemaTarget = Readonly<{
  adminDatabaseUrl: string;
  databaseUrl: string;
  schema: string;
}>;

export type TestSchemaCleanupCandidate = Readonly<{
  name: string;
  sizeBytes: number;
  evidence: "controlled-ephemeral-name" | "legacy-explicit-allowlist";
}>;

// Every legacy name below was observed locally during PROD-01 and also appears
// literally in an executor or docs/EXECUTION_STATUS.md. Names that lacked that
// second source of evidence are deliberately absent and must be preserved.
export const LEGACY_TEST_SCHEMA_ALLOWLIST = new Set([
  "crm02_integration",
  "crm07_final",
  "crm08_final2",
  "crm09_final",
  "crm09_final2",
  "crm10_final2",
  "crm11_final",
  "crm12_e2e",
  "crm12_final",
  "crm12_final2",
  "crm13_e2e2",
  "crm13_final",
  "crm13_final4",
  "crm14_e2e1",
  "crm14_full1",
  "crm15_e2e",
  "crm15_e2e_final",
  "crm15_final",
  "crm16_e2e",
  "crm16_e2e_final",
  "crm16_final",
  "crm16_migration_retry",
  "crm18_e2e",
  "crm18_e2e_full",
  "crm18_queue_isolated",
  "crm18_target",
  "crm19_full1",
  "crm19_target2",
  "crm20_e2efull1",
  "crm20_full1",
  "crm21_final",
  "crm21_final2",
  "crm22_final",
  "crm22_final4",
  "crm23_final",
  "crm24_directed_final",
  "crm24_e2e",
  "crm24_e2e_b",
  "crm24_full",
  "crm24_full_final",
  "crm25_final1",
  "crm25_full1",
  "crm25_full2",
  "crm26_e2e",
  "crm26_final",
  "crm27_checkpoint",
  "crm28_integration_final",
  "crm28_integration_final2",
  "crm28_prod_final",
  "crm28_prod_regression",
  "politizai_crm30_integration_test",
  "politizai_demo_crm29_test",
  "politizai_demo_crm30_e2e",
  "politizai_demo_reset_validation",
  "politizai_design02_e2e",
  "politizai_design03_e2e",
  "politizai_design03_integration",
  "politizai_design04_integration",
  // Segundo lote forense da PROD-01. Cada nome foi conferido no PostgreSQL
  // local em 2026-09-12: proprietário `politizai`, `_prisma_migrations`
  // presente, conjunto de tabelas contido em `public`, migrations aplicadas na
  // sequência cronológica da task indicada pelo nome e nenhuma conexão ativa.
  "crm02_empty_validation",
  "crm06_empty_validation",
  "crm06_final_empty",
  "crm07_integration",
  "crm08_devcheck",
  "crm08_full1",
  "crm08_integration",
  "crm09_dev1",
  "crm09_dev2",
  "crm10_dev2",
  "crm12_validation",
  "crm13_final2",
  "crm13_regression",
  "crm13_regression2",
  "crm13_regression3",
  "crm14_dev1",
  "crm14_test1",
  "crm15_e2e2",
  "crm15_smoke",
  "crm15_target",
  "crm15_target2",
  "crm15_target3",
  "crm15_target4",
  "crm16_full",
  "crm17_e2e",
  "crm17_final",
  "crm17_full",
  "crm17_migration_check",
  "crm17_settings_current3",
  "crm17_settings_reorder",
  "crm17_targeted",
  "crm17_targeted_current",
  "crm17_targeted_current2",
  "crm18_final",
  "crm18_final_check",
  "crm19_target1",
  "crm20_e2e1",
  "crm20_e2e2",
  "crm20_metrics1",
  "crm20_metrics2",
  "crm20_metrics3",
  "crm21_integration",
  "crm21_integration2",
  "crm21_integration3",
  "crm21_integration4",
  "crm21_integration5",
  "crm21_migration_check",
  "crm21_migration_check2",
  "crm22_dev",
  "crm22_final2",
  "crm22_final3",
  "crm23_e2e",
  "crm23_e2e_full",
  "crm23_full",
  "crm23_full2",
  "crm23_full3",
  "crm23_target",
  "crm23_target2",
  "crm23_target3",
  "crm23_target4",
  "crm23_target5",
  "crm23_work",
  "crm23_work2",
  "crm24_check",
  "crm24_integration",
  "crm24_integration_b",
  "crm24_integration_c",
  "crm24_integration_d",
  "crm27_final",
  "crm27_final2",
  "crm27_final3",
  "crm27_final4",
  "crm27_final5",
  "crm28_dashboard_isolated",
  "crm28_e2e_final",
  "crm28_e2e_final2",
  "crm28_e2e_full_final",
  "crm28_e2e_prod_final",
  "crm28_e2e_regression_final",
  "crm28_visual_final",
  "politizai_demo_crm30_e2e_baseline",
  "politizai_demo_design01_e2e",
]);

function parseLocalDatabaseUrl(
  databaseUrl: string,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): URL {
  if (nodeEnv === "production") {
    throw new Error("Schemas de teste são proibidos com NODE_ENV=production.");
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL inválida para schema de teste.");
  }

  if (!LOCAL_DATABASE_HOSTS.has(parsed.hostname)) {
    throw new Error("Schemas de teste só podem operar em PostgreSQL local conhecido.");
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error("Schemas de teste exigem uma URL PostgreSQL.");
  }
  if (decodeURIComponent(parsed.pathname.replace(/^\//, "")) !== EXPECTED_LOCAL_DATABASE) {
    throw new Error(`Schemas de teste só podem operar no banco ${EXPECTED_LOCAL_DATABASE}.`);
  }

  return parsed;
}

export function isControlledTestSchemaName(schema: string): boolean {
  return TEST_SCHEMA_NAME_PATTERN.test(schema);
}

export function assertSafeTestSchemaName(schema: string): string {
  if (schema === "public" || !isControlledTestSchemaName(schema)) {
    throw new Error("Nome de schema de teste fora do padrão controlado.");
  }
  return schema;
}

export function createUniqueTestSchemaName(
  kind: TestSchemaKind,
  now = new Date(),
  suffix = randomBytes(4).toString("hex"),
): string {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase();
  const schema = `politizai_test_${kind}_${timestamp}_${suffix.toLowerCase()}`;
  return assertSafeTestSchemaName(schema);
}

export function resolveTestSchemaTarget(
  databaseUrl: string,
  kind: TestSchemaKind,
  options: Readonly<{ now?: Date; suffix?: string; nodeEnv?: string }> = {},
): TestSchemaTarget {
  const parsed = parseLocalDatabaseUrl(databaseUrl, options.nodeEnv);
  const schema = createUniqueTestSchemaName(kind, options.now, options.suffix);
  const adminUrl = new URL(parsed);
  adminUrl.searchParams.delete("schema");
  const schemaUrl = new URL(adminUrl);
  schemaUrl.searchParams.set("schema", schema);

  return {
    adminDatabaseUrl: adminUrl.toString(),
    databaseUrl: schemaUrl.toString(),
    schema,
  };
}

export function shouldKeepTestSchema(
  environment: Readonly<Record<string, string | undefined>>,
): boolean {
  return environment.KEEP_TEST_SCHEMA === "1";
}

export function quoteSafeSchemaIdentifier(schema: string): string {
  if (!isControlledTestSchemaName(schema) && !LEGACY_TEST_SCHEMA_ALLOWLIST.has(schema)) {
    throw new Error("Schema fora da allowlist de limpeza.");
  }
  return `"${schema}"`;
}

export async function createEphemeralTestSchema(target: TestSchemaTarget): Promise<void> {
  assertSafeTestSchemaName(target.schema);
  parseLocalDatabaseUrl(target.adminDatabaseUrl);
  const client = new Client({ connectionString: target.adminDatabaseUrl });
  try {
    await client.connect();
    await client.query(`CREATE SCHEMA ${quoteSafeSchemaIdentifier(target.schema)}`);
  } finally {
    await client.end();
  }
}

export async function dropEphemeralTestSchema(target: TestSchemaTarget): Promise<void> {
  assertSafeTestSchemaName(target.schema);
  parseLocalDatabaseUrl(target.adminDatabaseUrl);
  const client = new Client({ connectionString: target.adminDatabaseUrl });
  try {
    await client.connect();
    await client.query(`DROP SCHEMA IF EXISTS ${quoteSafeSchemaIdentifier(target.schema)} CASCADE`);
  } finally {
    await client.end();
  }
}

export function selectEligibleCleanupCandidates(
  schemas: readonly Readonly<{ name: string; sizeBytes: number }>[],
): TestSchemaCleanupCandidate[] {
  const candidates: TestSchemaCleanupCandidate[] = [];
  for (const schema of schemas) {
    if (isControlledTestSchemaName(schema.name)) {
      candidates.push({ ...schema, evidence: "controlled-ephemeral-name" });
    } else if (LEGACY_TEST_SCHEMA_ALLOWLIST.has(schema.name)) {
      candidates.push({ ...schema, evidence: "legacy-explicit-allowlist" });
    }
  }
  return candidates;
}

export async function listLocalSchemas(databaseUrl: string): Promise<
  ReadonlyArray<Readonly<{ name: string; sizeBytes: number }>>
> {
  const parsed = parseLocalDatabaseUrl(databaseUrl);
  parsed.searchParams.delete("schema");
  const client = new Client({ connectionString: parsed.toString() });
  try {
    await client.connect();
    const result = await client.query<{ name: string; size_bytes: string }>(`
      SELECT
        n.nspname AS name,
        COALESCE(SUM(
          CASE
            WHEN c.relkind IN ('r', 'm', 'S') THEN pg_total_relation_size(c.oid)
            ELSE 0
          END
        ), 0)::bigint::text AS size_bytes
      FROM pg_namespace n
      LEFT JOIN pg_class c ON c.relnamespace = n.oid
      WHERE n.nspname <> 'public'
        AND n.nspname <> 'information_schema'
        AND n.nspname NOT LIKE 'pg_%'
      GROUP BY n.nspname
      ORDER BY COALESCE(SUM(
        CASE
          WHEN c.relkind IN ('r', 'm', 'S') THEN pg_total_relation_size(c.oid)
          ELSE 0
        END
      ), 0) DESC, n.nspname
    `);
    return result.rows.map((row) => ({ name: row.name, sizeBytes: Number(row.size_bytes) }));
  } finally {
    await client.end();
  }
}

export async function removeEligibleLocalSchemas(
  databaseUrl: string,
  candidates: readonly TestSchemaCleanupCandidate[],
  onRemoved?: (candidate: TestSchemaCleanupCandidate) => void,
): Promise<void> {
  const parsed = parseLocalDatabaseUrl(databaseUrl);
  parsed.searchParams.delete("schema");
  const client = new Client({ connectionString: parsed.toString() });
  try {
    await client.connect();
    const active = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND backend_type = 'client backend'
    `);
    if (Number(active.rows[0]?.count ?? "0") > 0) {
      throw new Error("Há conexão cliente no banco local; limpeza cancelada.");
    }

    const publicSchema = await client.query<{ exists: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public') AS exists",
    );
    if (!publicSchema.rows[0]?.exists) throw new Error("Schema public ausente; limpeza cancelada.");

    // One schema can own hundreds of relations. PostgreSQL needs one lock per
    // relation during DROP, so combining many schemas in one transaction can
    // exceed max_locks_per_transaction. Each allowlisted schema is therefore
    // removed in its own atomic transaction.
    for (const candidate of candidates) {
      await client.query("BEGIN");
      try {
        await client.query(`DROP SCHEMA IF EXISTS ${quoteSafeSchemaIdentifier(candidate.name)} CASCADE`);
        await client.query("COMMIT");
        onRemoved?.(candidate);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}
