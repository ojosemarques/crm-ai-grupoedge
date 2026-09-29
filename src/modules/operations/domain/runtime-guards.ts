import { loadEnvironmentContract } from "@/shared/core/config/environment-contract";
import { ApplicationError } from "@/shared/core/errors/application-error";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "db"]);

export function assertSafeOperationalRuntime(env: NodeJS.ProcessEnv = process.env) {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new ApplicationError("DATABASE_URL ausente.", { code: "UNSAFE_RUNTIME_CONFIGURATION", statusCode: 503, expose: true });
  const parsed = new URL(databaseUrl);
  const applicationEnvironment = env.APP_ENV ?? (env.NODE_ENV === "test" ? "test" : "local");
  const remoteEnvironment = applicationEnvironment === "staging" || applicationEnvironment === "production";

  if (remoteEnvironment) {
    try {
      const contract = loadEnvironmentContract(env);
      if (!contract.isRemote) throw new Error("Contrato remoto ausente.");
    } catch {
      throw new ApplicationError("Configuração operacional remota insegura.", {
        code: "UNSAFE_RUNTIME_CONFIGURATION",
        statusCode: 503,
        expose: true,
      });
    }
  } else if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new ApplicationError("Banco remoto bloqueado para operações locais.", {
      code: "REMOTE_DATABASE_BLOCKED",
      statusCode: 503,
      expose: true,
    });
  }
  for (const [key, value] of Object.entries(env)) {
    if (/(PROVIDER|ADAPTER)_MODE$/i.test(key) && value && !["local", "mock", "simulated", "disabled"].includes(value.toLowerCase())) {
      throw new ApplicationError("Adapter externo bloqueado pela política local.", { code: "EXTERNAL_ADAPTER_BLOCKED", statusCode: 503, expose: true });
    }
  }
  return { localDatabase: LOOPBACK_HOSTS.has(parsed.hostname), externalAdapters: false as const };
}
