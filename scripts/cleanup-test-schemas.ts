import "dotenv/config";

import {
  listLocalSchemas,
  removeEligibleLocalSchemas,
  selectEligibleCleanupCandidates,
} from "@/shared/core/database/test-schema-lifecycle";

const CONFIRMATION = "--confirm=DROP_LOCAL_TEST_SCHEMAS";
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória para inspecionar schemas locais.");

const schemas = await listLocalSchemas(databaseUrl);
const candidates = selectEligibleCleanupCandidates(schemas);
const candidateNames = new Set(candidates.map((candidate) => candidate.name));
const preserved = schemas.filter((schema) => !candidateNames.has(schema.name));
const totalBytes = candidates.reduce((sum, candidate) => sum + candidate.sizeBytes, 0);

process.stdout.write("DRY-RUN DE SCHEMAS DE TESTE LOCAIS\n");
for (const candidate of candidates) {
  process.stdout.write(
    `REMOVÍVEL | ${candidate.name} | ${candidate.sizeBytes} bytes | ${candidate.evidence}\n`,
  );
}
for (const schema of preserved) {
  process.stdout.write(`PRESERVADO | ${schema.name} | ${schema.sizeBytes} bytes | sem evidência suficiente\n`);
}
process.stdout.write(`Total removível estimado: ${totalBytes} bytes em ${candidates.length} schemas.\n`);

if (!process.argv.includes(CONFIRMATION)) {
  process.stdout.write(`Nenhuma alteração realizada. Para confirmar: pnpm db:test:cleanup -- ${CONFIRMATION}\n`);
} else {
  await removeEligibleLocalSchemas(databaseUrl, candidates, (candidate) => {
    process.stdout.write(`REMOVIDO | ${candidate.name} | ${candidate.sizeBytes} bytes\n`);
  });
  process.stdout.write(`Limpeza concluída: ${candidates.length} schemas removidos.\n`);
}
