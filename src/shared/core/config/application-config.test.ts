import { describe, expect, it } from "vitest";

import {
  loadApplicationConfig,
  type ApplicationConfig,
} from "@/shared/core/config/application-config";
import { ConfigurationError } from "@/shared/core/errors/application-error";

const validEnvironment = {
  DATABASE_URL:
    "postgresql://politizai:politizai_local_only@localhost:5432/politizai_crm?schema=public",
} satisfies Record<string, string>;

describe("loadApplicationConfig", () => {
  it("carrega a configuracao valida com defaults seguros", () => {
    const config: ApplicationConfig = loadApplicationConfig(validEnvironment);

    expect(config).toMatchObject({
      APP_NAME: "Grupo Edge CRM",
      APP_TIME_ZONE: "America/Sao_Paulo",
      AUTOMATION_BACKOFF_BASE_SECONDS: 5,
      AUTOMATION_BATCH_SIZE: 10,
      AUTOMATION_LOCK_TIMEOUT_SECONDS: 60,
      AUTOMATION_POLL_INTERVAL_MS: 1_000,
      AUTOMATION_WORKER_ID: "worker-local-1",
      AUTH_LOCK_MINUTES: 15,
      AUTH_MAX_FAILED_ATTEMPTS: 5,
      AUTH_SESSION_TTL_HOURS: 8,
      DATABASE_URL: validEnvironment.DATABASE_URL,
      LOG_LEVEL: "info",
      NODE_ENV: "development",
      PORT: 3000,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("falha de forma explicita sem a conexao com o banco", () => {
    expect(() => loadApplicationConfig({})).toThrow(ConfigurationError);
    expect(() => loadApplicationConfig({})).toThrow(/DATABASE_URL/);
  });

  it("rejeita uma URL de banco que nao seja PostgreSQL", () => {
    expect(() =>
      loadApplicationConfig({ DATABASE_URL: "mysql://localhost/crm" }),
    ).toThrow(/DATABASE_URL/);
  });
});
