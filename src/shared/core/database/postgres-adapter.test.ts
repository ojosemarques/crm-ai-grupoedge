import { describe, expect, it } from "vitest";

import { ConfigurationError } from "@/shared/core/errors/application-error";
import {
  getPostgresSchema,
  getPostgresStartupOptions,
} from "@/shared/core/database/postgres-adapter";

describe("adapter PostgreSQL", () => {
  it("usa o schema informado na URL", () => {
    expect(
      getPostgresSchema("postgresql://local:local@localhost:5432/crm?schema=crm_test"),
    ).toBe("crm_test");
  });

  it("usa public quando não há schema explícito", () => {
    expect(
      getPostgresSchema("postgresql://local:local@localhost:5432/crm"),
    ).toBe("public");
  });

  it("não envia search_path no startup para o schema público compatível com poolers", () => {
    expect(
      getPostgresStartupOptions(
        "postgresql://runtime:secret@pool.example/crm?schema=public&sslmode=require",
      ),
    ).toBeUndefined();
  });

  it("preserva search_path explícito para schemas isolados de teste", () => {
    expect(
      getPostgresStartupOptions(
        "postgresql://local:local@localhost:5432/crm?schema=crm_test",
      ),
    ).toBe("-c search_path=crm_test");
  });

  it("rejeita nome de schema inseguro", () => {
    expect(() =>
      getPostgresSchema(
        "postgresql://local:local@localhost:5432/crm?schema=crm-test",
      ),
    ).toThrow(ConfigurationError);
  });
});
