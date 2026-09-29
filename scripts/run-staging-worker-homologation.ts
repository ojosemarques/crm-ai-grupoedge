import "dotenv/config";

import {
  createStagingWorkerHomologationService,
  parseStagingWorkerHomologationEnvironment,
} from "@/modules/automations/application/staging-worker-homologation-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const mode = process.argv.includes("--verify") ? "verify" : "prepare";
const database = getDatabaseClient();

try {
  const environment = parseStagingWorkerHomologationEnvironment(process.env);
  const service = createStagingWorkerHomologationService(database);
  const result = mode === "verify"
    ? await service.verify(environment)
    : await service.prepare(environment);
  process.stdout.write(`${JSON.stringify({
    status: mode === "verify" ? "STAGING_WORKER_VERIFIED" : "STAGING_WORKER_PREPARED",
    task: "PROD-08",
    mode,
    ...result,
  }, null, 2)}\n`);
} catch (error) {
  const code = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
  process.stderr.write(`Homologação do worker bloqueada (${code}). Nenhum segredo foi exibido.\n`);
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
