import { spawnSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "production") process.exit(0);

const migrationUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!migrationUrl) {
  process.stderr.write("DIRECT_URL ou DATABASE_URL é obrigatória para aplicar migrations no build de produção.\n");
  process.exit(1);
}

if (!process.env.DIRECT_URL) {
  process.stdout.write("DIRECT_URL não configurada; usando a conexão de produção existente exclusivamente no processo de migration.\n");
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
