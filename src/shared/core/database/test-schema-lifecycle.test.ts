import { describe, expect, it } from "vitest";

import {
  assertSafeTestSchemaName,
  createUniqueTestSchemaName,
  quoteSafeSchemaIdentifier,
  resolveTestSchemaTarget,
  selectEligibleCleanupCandidates,
  shouldKeepTestSchema,
} from "@/shared/core/database/test-schema-lifecycle";

describe("ciclo de vida dos schemas de teste", () => {
  const now = new Date("2026-09-12T01:02:03.000Z");

  it("gera um nome único, restrito e reproduzível", () => {
    expect(createUniqueTestSchemaName("integration", now, "a1b2c3d4")).toBe(
      "politizai_test_integration_20260912t010203z_a1b2c3d4",
    );
  });

  it("recusa public, nomes livres e sufixos inválidos", () => {
    expect(() => assertSafeTestSchemaName("public")).toThrow(/fora do padrão/);
    expect(() => assertSafeTestSchemaName("crm_test")).toThrow(/fora do padrão/);
    expect(() => createUniqueTestSchemaName("e2e", now, 'x";drop schema public')).toThrow(
      /fora do padrão/,
    );
  });

  it("recusa host remoto, outro banco e produção", () => {
    expect(() =>
      resolveTestSchemaTarget("postgresql://user:pass@db.example.com/politizai_crm", "e2e"),
    ).toThrow(/local conhecido/);
    expect(() =>
      resolveTestSchemaTarget("postgresql://user:pass@localhost/outro_banco", "e2e"),
    ).toThrow(/politizai_crm/);
    expect(() =>
      resolveTestSchemaTarget("postgresql://user:pass@localhost/politizai_crm", "e2e", {
        nodeEnv: "production",
      }),
    ).toThrow(/NODE_ENV=production/);
  });

  it("mantém schema somente com confirmação literal", () => {
    expect(shouldKeepTestSchema({ KEEP_TEST_SCHEMA: "1" })).toBe(true);
    expect(shouldKeepTestSchema({ KEEP_TEST_SCHEMA: "true" })).toBe(false);
    expect(shouldKeepTestSchema({})).toBe(false);
  });

  it("seleciona apenas padrão controlado ou allowlist explícita", () => {
    expect(
      selectEligibleCleanupCandidates([
        { name: "public", sizeBytes: 10 },
        { name: "cliente_permanente", sizeBytes: 20 },
        { name: "crm07_final", sizeBytes: 30 },
        {
          name: "politizai_test_crm29_20260912t010203z_a1b2c3d4",
          sizeBytes: 40,
        },
      ]),
    ).toEqual([
      { name: "crm07_final", sizeBytes: 30, evidence: "legacy-explicit-allowlist" },
      {
        name: "politizai_test_crm29_20260912t010203z_a1b2c3d4",
        sizeBytes: 40,
        evidence: "controlled-ephemeral-name",
      },
    ]);
    expect(() => quoteSafeSchemaIdentifier("cliente_permanente")).toThrow(/allowlist/);
  });

  it("reconhece somente nomes legados individualmente aprovados pelo inventário forense", () => {
    expect(quoteSafeSchemaIdentifier("crm27_final2")).toBe('"crm27_final2"');
    expect(quoteSafeSchemaIdentifier("politizai_demo_design01_e2e")).toBe(
      '"politizai_demo_design01_e2e"',
    );
    expect(() => quoteSafeSchemaIdentifier("crm27_final6")).toThrow(/allowlist/);
    expect(() => quoteSafeSchemaIdentifier("politizai_demo_design02_e2e")).toThrow(
      /allowlist/,
    );
  });
});
