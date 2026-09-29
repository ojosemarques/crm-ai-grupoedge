import "dotenv/config";

import { createAdministrativeBootstrapService, parseAdministrativeBootstrapEnvironment } from "@/modules/auth/application/administrative-bootstrap-service";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const database = getDatabaseClient();
try {
  const input = parseAdministrativeBootstrapEnvironment(process.env);
  const result = await createAdministrativeBootstrapService(database).execute(input);
  process.stdout.write(`Bootstrap administrativo: ${result.status}. Identificadores gravados com auditoria.\n`);
} catch (error) {
  const code = error instanceof ApplicationError ? error.code : "INTERNAL_ERROR";
  process.stderr.write(`Bootstrap administrativo bloqueado (${code}). Nenhum valor de configuração foi exibido.\n`);
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
