import { spawnSync } from "node:child_process";

if (process.env.VERCEL_ENV !== "production") process.exit(0);

if (!process.env.DIRECT_URL) {
  process.stderr.write("DIRECT_URL é obrigatória para aplicar migrations no build de produção.\n");
  process.exit(1);
}

const result = spawnSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
  env: {
    ...process.env,
    APP_ENV: "production",
    PROCESS_ROLE: "migration",
  },
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
