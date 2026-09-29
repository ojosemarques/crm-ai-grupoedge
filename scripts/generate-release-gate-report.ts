import { mkdir, writeFile } from "node:fs/promises";

const outputDirectory = ".cache/release-gate";
const status = process.env.RELEASE_GATE_STATUS === "success" ? "APPROVED" : "BLOCKED";
const report = {
  schemaVersion: "prod04.release-gate.v1",
  status,
  repository: process.env.GITHUB_REPOSITORY ?? "local",
  commit: process.env.RELEASE_COMMIT ?? process.env.GITHUB_SHA ?? "local",
  event: process.env.GITHUB_EVENT_NAME ?? "local",
  runId: process.env.GITHUB_RUN_ID ?? null,
  runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
  generatedAt: new Date().toISOString(),
  gates: [
    "deterministic-install",
    "repository-policy",
    "prisma-generate",
    "migrations-from-zero",
    "lint",
    "next-typegen-and-typecheck",
    "unit-tests",
    "critical-integrations",
    "dependency-audit",
    "webpack-build",
    "essential-smoke",
    "sbom",
  ],
  guarantees: {
    deploymentPerformed: false,
    remoteDatabaseAccess: false,
    productionMigrationApplied: false,
    secretsIncluded: false,
  },
} as const;

await mkdir(outputDirectory, { recursive: true });
await writeFile(`${outputDirectory}/report.json`, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(
  `${outputDirectory}/summary.md`,
  [
    "# Release gate — CRM Politizai",
    "",
    `- Status: **${status}**`,
    `- Commit: \`${report.commit}\``,
    `- Execução: \`${report.runId ?? "local"}\` (tentativa ${report.runAttempt ?? "local"})`,
    "- Deploy: não executado",
    "- Banco remoto: não acessado",
    "- Migration remota: não aplicada",
    "",
  ].join("\n"),
  "utf8",
);

process.stdout.write(`RELATÓRIO DE RELEASE: ${status}.\n`);
