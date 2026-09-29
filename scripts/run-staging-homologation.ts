import "dotenv/config";

import {
  createStagingHomologationService,
  parseStagingHomologationEnvironment,
} from "@/modules/settings/application/staging-homologation-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { redactTelemetryValue } from "@/shared/core/security/redaction";

const database = getDatabaseClient();
try {
  const environment = parseStagingHomologationEnvironment(process.env);
  const result = await createStagingHomologationService(database).run(environment);
  process.stdout.write(`${JSON.stringify({
    status: "STAGING_HOMOLOGATED",
    dataset: "PROD-06",
    leadFingerprint: result.leadFingerprint,
    leadCount: result.leadCount,
    userCount: result.userCount,
    teamCount: result.teamCount,
    migrationCount: result.migrationCount,
    idempotentReplay: result.idempotentReplay,
    rbac: result.rbac,
    invariants: result.invariants,
  }, null, 2)}\n`);
} catch (error) {
  const code = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
  const detail = error instanceof Error
    ? String(redactTelemetryValue(error.message))
    : "Falha não identificada.";
  process.stderr.write(
    `Homologação de staging bloqueada (${code}): ${detail} Nenhum segredo foi exibido.\n`,
  );
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
