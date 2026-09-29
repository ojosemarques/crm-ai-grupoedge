import { describe, expect, it } from "vitest";

import { assertDemoSeedEnvironment } from "@/modules/settings/application/demo-seed-service";

describe("proteção do seed de demonstração", () => {
  it("aceita somente PostgreSQL local fora de produção", () => {
    expect(() =>
      assertDemoSeedEnvironment({
        NODE_ENV: "development",
        DATABASE_URL: "postgresql://local:local@localhost:5432/politizai",
      }),
    ).not.toThrow();
  });

  it("recusa produção mesmo quando o host é local", () => {
    expect(() =>
      assertDemoSeedEnvironment({
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://local:local@localhost:5432/politizai",
      }),
    ).toThrowError(/só pode rodar localmente/i);
  });

  it("recusa staging e a desativação explícita do seed", () => {
    const databaseUrl = "postgresql://local:local@localhost:5432/politizai";
    expect(() => assertDemoSeedEnvironment({
      APP_ENV: "staging",
      NODE_ENV: "development",
      DATABASE_URL: databaseUrl,
    })).toThrowError(/só pode rodar localmente/i);
    expect(() => assertDemoSeedEnvironment({
      APP_ENV: "local",
      NODE_ENV: "development",
      DEMO_SEED_ENABLED: "false",
      DATABASE_URL: databaseUrl,
    })).toThrowError(/só pode rodar localmente/i);
  });

  it("recusa banco remoto", () => {
    expect(() =>
      assertDemoSeedEnvironment({
        NODE_ENV: "test",
        DATABASE_URL: "postgresql://user:password@database.example/politizai",
      }),
    ).toThrowError(/recusou um banco não local/i);
  });
});
