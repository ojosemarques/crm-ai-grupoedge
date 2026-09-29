import "dotenv/config";

import { createDefaultWorkerBatchRunner } from "@/modules/automations/application/worker-runtime";
import { getApplicationConfig } from "@/shared/core/config/application-config";
import { logger } from "@/shared/core/logging/logger";

const config = getApplicationConfig();
const workerLogger = logger.child({ processRole: "worker", workerId: config.AUTOMATION_WORKER_ID });
const runtimeWorker = createDefaultWorkerBatchRunner(config);
const database = runtimeWorker.database;
let stopping = false;

function stop(): void {
  stopping = true;
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

workerLogger.info(
  {},
  "Worker persistente de automações iniciado",
);

while (!stopping) {
  let processed = 0;
  try {
    const result = await runtimeWorker.runner.run({
      workerId: config.AUTOMATION_WORKER_ID,
      maxJobs: config.AUTOMATION_BATCH_SIZE,
      // O processo persistente continua limitado pelo tamanho do lote, não pelo
      // orçamento curto da função serverless.
      maxDurationMs: 86_400_000,
    });
    processed = result.processed;
    if (result.published > 0) workerLogger.info(result, "Scanner de saúde comercial publicou automações");
  } catch (error) {
    workerLogger.error({ error }, "Lote do worker falhou sem interromper o processo");
  }
  if (!stopping && processed === 0) {
    await new Promise((resolve) => setTimeout(resolve, config.AUTOMATION_POLL_INTERVAL_MS));
  }
}

await database.$disconnect();
workerLogger.info({}, "Worker persistente de automações encerrado");
