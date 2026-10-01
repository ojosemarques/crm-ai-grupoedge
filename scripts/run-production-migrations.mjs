import { spawnSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "production") process.exit(0);

function migrationConnection() {
  if (process.env.DIRECT_URL) return process.env.DIRECT_URL;
  if (!process.env.DATABASE_URL) return undefined;
  const value = new URL(process.env.DATABASE_URL);
  if (value.port === "6543") value.port = "5432";
  value.searchParams.delete("pgbouncer");
  return value.toString();
}

const migrationUrl = migrationConnection();
if (!migrationUrl) {
  process.stderr.write("DIRECT_URL ou DATABASE_URL é obrigatória para aplicar migrations no build de produção.\n");
  process.exit(1);
}

if (!process.env.DIRECT_URL) {
  process.stdout.write("DIRECT_URL não configurada; usando a conexão de sessão derivada exclusivamente no processo de migration.\n");
}

const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
  env: {
    ...process.env,
    APP_ENV: "production",
    DIRECT_URL: migrationUrl,
    PROCESS_ROLE: "migration",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
