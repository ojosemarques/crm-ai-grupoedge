import { describe, expect, it } from "vitest";

import { assertSafeDemoResetTarget } from "@/modules/settings/application/crm29-demo-data-service";
import { ApplicationError } from "@/shared/core/errors/application-error";

describe("proteção do reset da base CRM-29", () => {
  it("aceita somente schema local explicitamente reservado e confirmado", () => {
    expect(assertSafeDemoResetTarget({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:password@localhost:5432/politizai?schema=politizai_demo_local",
      DEMO_RESET_CONFIRM: "RESET politizai_demo_local",
    })).toEqual({
      databaseUrl: "postgresql://user:password@localhost:5432/politizai?schema=politizai_demo_local",
      schema: "politizai_demo_local",
    });
  });

  it.each([
    ["public", "RESET public"],
    ["politizai_demo_local", undefined],
    ["politizai_demo_local", "RESET outro_schema"],
    ["crm29_integration", "RESET crm29_integration"],
  ])("recusa alvo ou confirmação insegura (%s)", (schema, confirmation) => {
    expect(() => assertSafeDemoResetTarget({
      NODE_ENV: "development",
      DATABASE_URL: `postgresql://user:password@localhost:5432/politizai?schema=${schema}`,
      DEMO_RESET_CONFIRM: confirmation,
    })).toThrowError(ApplicationError);
  });

  it("recusa banco remoto mesmo com schema reservado", () => {
    expect(() => assertSafeDemoResetTarget({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:password@db.example.com:5432/politizai?schema=politizai_demo_local",
      DEMO_RESET_CONFIRM: "RESET politizai_demo_local",
    })).toThrowError(/banco não local/i);
  });
});
