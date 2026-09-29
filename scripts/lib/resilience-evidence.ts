import { randomUUID } from "node:crypto";

import { Client } from "pg";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export async function recordLocalResilienceEvidence(input: Readonly<{
  databaseUrl: string;
  workspaceSlug: string;
  operation: "resilience.restore.completed" | "resilience.load.completed" | "resilience.invariants.completed";
  outcome: "SUCCESS" | "ERROR";
  durationMs?: number;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
}>) {
  if (!/^[a-z0-9-]{2,80}$/.test(input.workspaceSlug)) throw new Error("Workspace de evidência inválido.");
  const parsed = new URL(input.databaseUrl); parsed.searchParams.delete("schema");
  if (!LOCAL_HOSTS.has(parsed.hostname) || decodeURIComponent(parsed.pathname.slice(1)) !== "politizai_crm" || process.env.NODE_ENV === "production") throw new Error("Evidência de resiliência só pode ser gravada no banco local politizai_crm.");
  const client = new Client({ connectionString: parsed.toString() });
  try {
    await client.connect();
    const owner = await client.query<{ workspace_id: string; actor_id: string }>(`
      SELECT w.id AS workspace_id, a.id AS actor_id
      FROM public.workspaces w
      JOIN public.actors a ON a."workspaceId" = w.id AND a.type = 'SYSTEM' AND a."userId" IS NULL
      WHERE w.slug = $1
      ORDER BY a."createdAt", a.id
      LIMIT 1
    `, [input.workspaceSlug]);
    if (!owner.rows[0]) throw new Error("Workspace ou ator Sistema não encontrado para registrar evidência.");
    await client.query(`
      INSERT INTO public.telemetry_records
        (id, "workspaceId", "contractVersion", kind, operation, outcome, "durationMs", "correlationId", "actorId", labels, metadata, "occurredAt")
      VALUES
        (gen_random_uuid(), $1::uuid, 'telemetry.v1', 'TRACE', $2, $3, $4, $5, $6::uuid, $7::jsonb, $8::jsonb, now())
    `, [owner.rows[0].workspace_id, input.operation, input.outcome, input.durationMs ?? null, `crm63:${randomUUID()}`, owner.rows[0].actor_id, JSON.stringify({ mode: "local", contract: "resilience.v1" }), JSON.stringify(input.metadata)]);
  } finally { await client.end(); }
}
