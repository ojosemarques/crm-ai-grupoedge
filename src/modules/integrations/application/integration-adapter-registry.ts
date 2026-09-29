import type { IntegrationAdapter } from "@/modules/integrations/domain/integration-contracts";
import { localMockAdapter } from "@/modules/integrations/application/local-mock-adapter";
import { ApplicationError } from "@/shared/core/errors/application-error";

export class IntegrationAdapterRegistry {
  readonly #adapters: ReadonlyMap<string, IntegrationAdapter>;

  constructor(adapters: ReadonlyArray<IntegrationAdapter> = [localMockAdapter]) {
    this.#adapters = new Map(adapters.map((adapter) => [adapter.adapterKey, adapter]));
  }

  get(adapterKey: string): IntegrationAdapter {
    const adapter = this.#adapters.get(adapterKey);
    if (!adapter) {
      throw new ApplicationError("Adaptador não implementado neste ambiente.", {
        code: "INTEGRATION_ADAPTER_NOT_IMPLEMENTED",
        statusCode: 409,
        expose: true,
      });
    }
    return adapter;
  }
}

export const integrationAdapterRegistry = new IntegrationAdapterRegistry();
