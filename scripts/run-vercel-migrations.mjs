import { spawnSync } from "node:child_process";

const source = process.env.DATABASE_URL;
if (!source) throw new Error("DATABASE_URL é obrigatória para migrations na Vercel.");

const databaseUrl = new URL(source);
if (databaseUrl.port === "6543") {
  databaseUrl.port = "5432";
  databaseUrl.searchParams.delete("pgbouncer");
}

const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl.toString(),
    PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK: "1",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
