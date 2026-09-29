import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";

import {
  createEphemeralTestSchema,
  dropEphemeralTestSchema,
  listLocalSchemas,
  removeEligibleLocalSchemas,
  resolveTestSchemaTarget,
  selectEligibleCleanupCandidates,
  type TestSchemaTarget,
} from "@/shared/core/database/test-schema-lifecycle";

describe("limpeza segura de schemas temporários", () => {
  let childTarget: TestSchemaTarget | undefined;

  afterEach(async () => {
    if (childTarget) await dropEphemeralTestSchema(childTarget);
    childTarget = undefined;
  });

  it("remove somente o schema efêmero selecionado e preserva public", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL ausente no teste de integração.");

    childTarget = resolveTestSchemaTarget(databaseUrl, "e2e", {
      now: new Date("2026-09-12T02:03:04.000Z"),
      suffix: "a1b2c3d4",
    });
    await dropEphemeralTestSchema(childTarget);
    await createEphemeralTestSchema(childTarget);

    const schemas = await listLocalSchemas(databaseUrl);
    const candidate = selectEligibleCleanupCandidates(schemas).find(
      (schema) => schema.name === childTarget?.schema,
    );
    expect(candidate).toBeDefined();
    await removeEligibleLocalSchemas(databaseUrl, candidate ? [candidate] : []);

    const client = new Client({ connectionString: childTarget.adminDatabaseUrl });
    try {
      await client.connect();
      const result = await client.query<{ public_exists: boolean; child_exists: boolean }>(`
        SELECT
          EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'public') AS public_exists,
          EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1) AS child_exists
      `, [childTarget.schema]);
      expect(result.rows[0]).toEqual({ public_exists: true, child_exists: false });
    } finally {
      await client.end();
    }
  });

  it("recusa a limpeza enquanto outra conexão cliente usa o banco local", async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL ausente no teste de integração.");

    childTarget = resolveTestSchemaTarget(databaseUrl, "integration", {
      now: new Date("2026-09-12T02:03:05.000Z"),
      suffix: "b1c2d3e4",
    });
    await dropEphemeralTestSchema(childTarget);
    await createEphemeralTestSchema(childTarget);

    const schemas = await listLocalSchemas(databaseUrl);
    const candidate = selectEligibleCleanupCandidates(schemas).find(
      (schema) => schema.name === childTarget?.schema,
    );
    expect(candidate).toBeDefined();

    const blocker = new Client({ connectionString: childTarget.adminDatabaseUrl });
    await blocker.connect();
    try {
      await expect(removeEligibleLocalSchemas(databaseUrl, candidate ? [candidate] : [])).rejects.toThrow(
        /conexão cliente/,
      );
    } finally {
      await blocker.end();
    }
  });
});
