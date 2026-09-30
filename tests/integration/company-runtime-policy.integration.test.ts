import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it } from "vitest";

it("políticas privadas aceitam empresas ativas e continuam negando acesso público e empresas inativas", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) throw new Error("Local database required");
  const schema = url.searchParams.get("schema")!;
  if (!/^[a-z][a-z0-9_]+$/.test(schema) || !schema.includes("test")) throw new Error("Temporary test schema required");
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL search_path TO "${schema}"`);
    // Cluster roles and fixture grants are transactional and rolled back below.
    for (const role of ["crm_politizai_runtime", "company_hub_public_test"]) {
      if (!(await client.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rowCount) await client.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`);
    }
    const existing = await client.query("SELECT 1 FROM pg_policies WHERE schemaname=$1 AND policyname='company_runtime_select'", [schema]);
    if (!existing.rowCount) await client.query(await readFile("prisma/migrations/20261001040000_company_hub_private_runtime/migration.sql", "utf8"));
    const policies = await client.query("SELECT roles::text[] AS roles, cmd, qual, with_check FROM pg_policies WHERE schemaname=$1 AND policyname LIKE 'company_runtime_%'", [schema]);
    expect(policies.rows).toHaveLength(39);
    expect(policies.rows.every(row => JSON.stringify(row.roles) === '["crm_politizai_runtime"]')).toBe(true);
    await client.query(`GRANT USAGE ON SCHEMA "${schema}" TO crm_politizai_runtime, company_hub_public_test`);
    await client.query("GRANT SELECT ON workspaces TO crm_politizai_runtime, company_hub_public_test");
    await client.query("GRANT SELECT, INSERT, UPDATE ON financial_categories TO crm_politizai_runtime, company_hub_public_test");
    const a = randomUUID(), b = randomUUID(), inactive = randomUUID();
    for (const [id, status] of [[a, "ACTIVE"], [b, "ACTIVE"], [inactive, "SUSPENDED"]]) {
      await client.query('INSERT INTO workspaces (id,slug,name,status,"updatedAt") VALUES ($1,$3,$3,$2,now())', [id,status,id]);
    }
    const actor = randomUUID();
    await client.query('INSERT INTO actors (id,"workspaceId",type,key,"displayName") VALUES ($1,$2,\'SYSTEM\',\'system\',\'Test\')', [actor,a]);
    await client.query("SET LOCAL ROLE crm_politizai_runtime");
    const insert = 'INSERT INTO financial_categories (id,"workspaceId",key,name,kind,"createdByActorId","updatedByActorId","updatedAt") VALUES ($1,$2,\'test_category\',\'Test\',\'EXPENSE\',$3,$3,now())';
    await client.query(insert,[randomUUID(),a,actor]);
    const actorB = randomUUID();
    await client.query("RESET ROLE");
    await client.query('INSERT INTO actors (id,"workspaceId",type,key,"displayName") VALUES ($1,$2,\'SYSTEM\',\'system\',\'Test\')', [actorB,b]);
    await client.query("SET LOCAL ROLE crm_politizai_runtime");
    await client.query(insert,[randomUUID(),b,actorB]);
    expect((await client.query('SELECT count(*)::int AS count FROM financial_categories WHERE "workspaceId"=ANY($1::uuid[])',[[a,b]])).rows[0].count).toBe(2);
    await client.query("SAVEPOINT deny_inactive");
    await expect(client.query(insert,[randomUUID(),inactive,actor])).rejects.toMatchObject({ code:"42501" });
    await client.query("ROLLBACK TO SAVEPOINT deny_inactive");
    await client.query("RESET ROLE");
    await client.query("SET LOCAL ROLE company_hub_public_test");
    expect((await client.query('SELECT count(*)::int AS count FROM financial_categories')).rows[0].count).toBe(0);
    await client.query("SAVEPOINT deny_public");
    await expect(client.query(insert,[randomUUID(),a,actor])).rejects.toMatchObject({ code:"42501" });
    await client.query("ROLLBACK TO SAVEPOINT deny_public");
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
},30000);
