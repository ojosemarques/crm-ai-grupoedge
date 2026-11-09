import "dotenv/config";

import { readFile, stat } from "node:fs/promises";
import { legacyManifestSchema, previewLegacyCompensation } from "@/modules/finance/application/legacy-compensation-preview";
import { applyLegacyCompensation } from "@/modules/finance/application/legacy-compensation-import";
import { getDatabaseClient } from "@/shared/core/database/client";

async function main() {
  const connection = process.env.DATABASE_URL;
  const manifestPath = process.argv.find((argument) => argument.startsWith("--manifest="))?.slice("--manifest=".length);
  if (!connection || !manifestPath) throw new Error("Informe DATABASE_URL e --manifest=<arquivo restrito>.");
  const host = new URL(connection).hostname;
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(host);
  if (!local && !process.argv.includes("--allow-production")) throw new Error("Banco remoto exige --allow-production.");
  const manifestFile = await stat(manifestPath);
  if (!manifestFile.isFile() || (!local && (manifestFile.mode & 0o077) !== 0)) {
    throw new Error("O manifesto remoto deve ser um arquivo privado (0600).");
  }
  const manifest = legacyManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  const database = getDatabaseClient();
  try {
    if (process.argv.includes("--apply")) {
      const actor = process.argv.find((value) => value.startsWith("--actor="))?.slice(8);
      const fingerprint = process.argv.find((value) => value.startsWith("--fingerprint="))?.slice(14);
      if (!actor || !fingerprint || !/^[0-9a-f]{64}$/.test(fingerprint)) {
        throw new Error("A aplicação exige ator e impressão digital da prévia.");
      }
      const result = await applyLegacyCompensation(database, manifest, actor, fingerprint);
      process.stdout.write(JSON.stringify(result) + "\n");
      return;
    }
    const preview = await database.$transaction((tx) => previewLegacyCompensation(tx, manifest), {
      isolationLevel: "RepeatableRead",
    });
    process.stdout.write(`${JSON.stringify({
      fingerprint: preview.fingerprint,
      sales: preview.sales.length,
      invoices: preview.sales.reduce((sum, sale) => sum + sale.contract.invoices.length, 0),
      withoutD0: preview.sales.filter((sale) => !sale.d0).length,
      reportedPayments: preview.sales.filter((sale) => sale.planned.reported).length,
      stagesForReview: preview.sales.reduce((sum, sale) => sum + sale.stages.filter((stage) => stage.reason).length, 0),
    })}\n`);
  } finally {
    await database.$disconnect();
  }
}

void main().catch(() => {
  process.stderr.write("Não foi possível conferir o manifesto histórico. Revise o arquivo, o ambiente e os vínculos em sessão restrita.\n");
  process.exitCode = 1;
});
