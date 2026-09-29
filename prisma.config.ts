import "dotenv/config";

import { defineConfig, env } from "prisma/config";

const appEnvironment = process.env.APP_ENV ?? (process.env.NODE_ENV === "test" ? "test" : "local");
const remoteEnvironment = appEnvironment === "staging" || appEnvironment === "production";
const processRole = process.env.PROCESS_ROLE ?? (remoteEnvironment ? undefined : "web");
const migrationProcess = processRole === "migration";

if (remoteEnvironment && migrationProcess && !process.env.DIRECT_URL) {
  throw new Error("DIRECT_URL é obrigatória para migrations em staging e produção.");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Builds and web/worker runtimes must never need the privileged direct URL.
    // Only the explicitly identified migration process is allowed to consume it.
    url: migrationProcess ? (process.env.DIRECT_URL ?? env("DATABASE_URL")) : env("DATABASE_URL"),
  },
});
