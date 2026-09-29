import {
  LOCAL_MOCK_ADAPTER_KEY,
  LOCAL_MOCK_PROVIDER_KEY,
  localMockConfigurationSchema,
  type IntegrationAdapter,
  type IntegrationAdapterResult,
  type LocalMockConfiguration,
} from "@/modules/integrations/domain/integration-contracts";
import { LocalAdapterFault, redactSensitive } from "@/modules/integrations/domain/integration-policy";

function fail(config: LocalMockConfiguration): void {
  const faults = {
    TIMEOUT: ["TRANSIENT", "LOCAL_TIMEOUT", "O teste local excedeu o tempo controlado."],
    RATE_LIMIT: ["RATE_LIMIT", "LOCAL_RATE_LIMIT", "O limite local foi atingido; tente novamente depois."],
    TRANSIENT: ["TRANSIENT", "LOCAL_TRANSIENT", "Falha transitória simulada."],
    PERMANENT: ["PERMANENT", "LOCAL_PERMANENT", "Falha permanente simulada."],
    BEFORE_COMMIT: ["TRANSIENT", "LOCAL_BEFORE_COMMIT", "Queda simulada antes do commit."],
  } as const;
  const fault = config.fault === "NONE" || config.fault === "OUT_OF_ORDER" || config.fault === "AFTER_COMMIT" ? undefined : faults[config.fault];
  if (!fault) return;
  throw new LocalAdapterFault({
    classification: fault[0],
    code: fault[1],
    safeMessage: fault[2],
    ...(config.fault === "RATE_LIMIT" ? { retryAfterSeconds: 30 } : {}),
  });
}

export class LocalMockAdapter implements IntegrationAdapter {
  readonly providerKey = LOCAL_MOCK_PROVIDER_KEY;
  readonly adapterKey = LOCAL_MOCK_ADAPTER_KEY;
  readonly capabilityLevel = "VALIDATED_LOCALLY" as const;
  readonly capabilities = ["WEBHOOK_RECEIVE", "SYNC_PULL", "SYNC_PUSH", "OBJECT_MAPPING"] as const;

  validateConfiguration(input: unknown): LocalMockConfiguration {
    return localMockConfigurationSchema.parse(input);
  }

  async testLocal(config: LocalMockConfiguration): Promise<IntegrationAdapterResult> {
    fail(config);
    return {
      capabilityLevel: "VALIDATED_LOCALLY",
      facts: ["Contrato local validado", "Nenhum egress de rede foi realizado"],
    };
  }

  normalizeInbound(input: unknown): Readonly<Record<string, unknown>> {
    const value = input && typeof input === "object" ? input as Record<string, unknown> : {};
    return Object.freeze(redactSensitive(value) as Record<string, unknown>);
  }

  async pullPage(config: LocalMockConfiguration, cursor?: string): Promise<IntegrationAdapterResult> {
    fail(config);
    const offset = cursor ? Number.parseInt(cursor, 10) : 0;
    const safeOffset = Number.isFinite(offset) && offset >= 0 ? offset : 0;
    return {
      capabilityLevel: "VALIDATED_LOCALLY",
      facts: ["Página local determinística processada"],
      nextCursor: String(safeOffset + config.pageSize),
      readCount: config.pageSize,
      createdCount: 0,
      ignoredCount: config.pageSize,
    };
  }

  async push(
    config: LocalMockConfiguration,
    command: Readonly<Record<string, unknown>>,
  ): Promise<IntegrationAdapterResult> {
    fail(config);
    return {
      capabilityLevel: "VALIDATED_LOCALLY",
      facts: ["Comando entregue somente ao adaptador local", `Campos recebidos: ${Object.keys(command).length}`],
    };
  }

  classifyError(error: unknown) {
    if (error instanceof LocalAdapterFault) return error.failure;
    return {
      classification: "TRANSIENT" as const,
      code: "LOCAL_UNKNOWN",
      safeMessage: "Falha controlada no adaptador local.",
    };
  }
}

export const localMockAdapter = new LocalMockAdapter();
