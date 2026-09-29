import { describe, expect, it } from "vitest";

import { inspectRepositoryFiles } from "@/shared/core/security/repository-policy";

describe("política versionável do repositório", () => {
  it.each([
    [".env", "DATABASE_URL=placeholder", "FORBIDDEN_ENV_FILE"],
    ["backups/public.dump", "binário", "FORBIDDEN_ARTIFACT"],
    ["test-results/failure.json", "{}", "FORBIDDEN_ARTIFACT"],
    ["config.txt", ["gh", "p_", "a".repeat(24)].join(""), "TOKEN"],
    ["config.txt", ["-----BEGIN", "PRIVATE KEY-----"].join(" "), "PRIVATE_KEY"],
    ["config.txt", "NEXT_PUBLIC_DATABASE_TOKEN=exposto", "PUBLIC_SECRET"],
    ["config.txt", ["DATABASE_URL=postgresql://app:secret@", "database.vendor.tld/crm"].join(""), "REMOTE_DATABASE_URL"],
  ])("bloqueia %s sem ecoar o conteúdo", (filePath, content, expectedCode) => {
    const result = inspectRepositoryFiles([{ path: filePath, content }]);
    expect(result.map((violation) => violation.code)).toContain(expectedCode);
    expect(JSON.stringify(result)).not.toContain("exposto");
    expect(JSON.stringify(result)).not.toContain("vendor.tld/crm");
  });

  it("aceita inventários vazios e URLs locais ou documentais", () => {
    const result = inspectRepositoryFiles([
      { path: ".env.example", content: "DATABASE_URL=postgresql://user:local@localhost:5432/politizai_crm\nNEXT_PUBLIC_API_TOKEN=\n" },
      { path: ".env.staging.example", content: "DATABASE_URL=\n" },
      { path: "example.ts", content: "postgresql://runtime:placeholder@pool.staging.example/politizai_staging?schema=public" },
    ]);
    expect(result).toEqual([]);
  });
});
