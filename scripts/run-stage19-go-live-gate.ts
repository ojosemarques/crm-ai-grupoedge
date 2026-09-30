import { readFile } from "node:fs/promises";

import { evaluateGoLiveEvidence } from "@/modules/readiness/domain/go-live-gate";

const evidenceArgument = process.argv.find((argument) => argument.startsWith("--evidence="));
const evidencePath = evidenceArgument?.slice("--evidence=".length);

if (!evidencePath) {
  process.stderr.write("Informe --evidence=<manifesto.json>. O gate falha fechado sem evidência.\n");
  process.exitCode = 2;
} else {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(evidencePath, "utf8"));
  } catch {
    process.stderr.write("O manifesto não pôde ser lido como JSON.\n");
    process.exitCode = 2;
  }

  if (input !== undefined) {
    const report = evaluateGoLiveEvidence(input);
    process.stdout.write(`Gate ${report.schemaVersion}: ${report.decision}\n`);
    if (report.release) {
      process.stdout.write(`Release: ${report.release.commit} / ${report.release.deploymentId} / ${report.release.migration}\n`);
    }
    for (const result of report.results) {
      process.stdout.write(`[${result.status}] ${result.code}: ${result.reason}\n`);
    }
    if (report.decision !== "GO") process.exitCode = 1;
  }
}
