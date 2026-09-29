import "dotenv/config";

import { evaluateProductionPreflight, type ReadinessTarget } from "@/modules/readiness/domain/production-preflight";

const targetArgument = process.argv.find((argument) => argument.startsWith("--target="));
const target = (targetArgument?.slice("--target=".length) ?? "local") as ReadinessTarget;
if (!(["local", "test", "staging", "production"] as const).includes(target)) {
  process.stderr.write("Target inválido. Use local, test, staging ou production.\n");
  process.exitCode = 2;
} else {
  const report = evaluateProductionPreflight(process.env, { target });
  process.stdout.write(`Preflight ${report.contractVersion} — alvo ${report.target}\n`);
  for (const item of report.findings) process.stdout.write(`[${item.status}] ${item.code}: ${item.message}\n`);
  process.stdout.write(`Decisão: ${report.decision}\n`);
  if (report.decision === "BLOCKED") process.exitCode = 1;
}
