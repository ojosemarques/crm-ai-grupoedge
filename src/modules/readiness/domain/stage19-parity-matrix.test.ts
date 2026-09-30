import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(currentDirectory, "../../../..");
const reportPath = resolve(repositoryRoot, "docs/STAGE19_PARITY_ACCEPTANCE.md");
const report = readFileSync(reportPath, "utf8");

const expectedStatuses = {
  C01: "PARCIAL",
  C02: "PAR",
  C03: "PAR",
  C04: "DIVERGENTE",
  C05: "BLOQUEADO",
  C06: "BLOQUEADO",
  C07: "BLOQUEADO",
  C08: "PARCIAL",
  C09: "BLOQUEADO",
  C10: "PARCIAL",
  C11: "PAR",
  C12: "PARCIAL",
  C13: "PARCIAL",
  C14: "PAR",
  C15: "BLOQUEADO",
} as const;

const requiredFacets = [
  "Funcional",
  "Integração",
  "Falha/retry",
  "RBAC/privacidade",
  "Acessibilidade/mobile",
  "Dados",
  "Clint",
] as const;

describe("matriz de paridade da etapa 19", () => {
  it("registra exatamente C01-C15 com status permitido, responsável e decisão", () => {
    const rows = [...report.matchAll(/^\| (C\d{2}) \| (PAR|PARCIAL|BLOQUEADO|DIVERGENTE) \| ([^|]+) \| ([^|]+) \|$/gm)];

    expect(rows).toHaveLength(15);
    expect(Object.fromEntries(rows.map((row) => [row[1], row[2]]))).toEqual(expectedStatuses);

    for (const row of rows) {
      expect(row[3]?.trim().length).toBeGreaterThan(3);
      expect(row[4]?.trim().length).toBeGreaterThan(20);
    }
  });

  it("anexa todas as facetas de evidência a cada capacidade", () => {
    for (const capability of Object.keys(expectedStatuses)) {
      const section = report.match(
        new RegExp(`### ${capability}\\n([\\s\\S]*?)(?=\\n### C\\d{2}|\\n## Jornadas integrais)`),
      )?.[1];

      expect(section, `${capability} deve possuir seção própria`).toBeDefined();
      for (const facet of requiredFacets) {
        expect(section, `${capability} deve anexar ${facet}`).toContain(`**${facet}:**`);
      }
    }
  });

  it("mantém todos os arquivos locais citados como evidência verificável", () => {
    const references = [...report.matchAll(/\]\((\.\.\/[^)#]+|\.\/[^)#]+)(?:#[^)]+)?\)/g)].map(
      (match) => match[1]!,
    );

    expect(references.length).toBeGreaterThan(50);
    for (const reference of new Set(references)) {
      expect(existsSync(resolve(dirname(reportPath), reference)), reference).toBe(true);
    }
  });

  it("declara explicitamente que bloqueios impedem o selo de 100%", () => {
    expect(report).toContain("abaixo de 100% de paridade funcional");
    expect(report).toContain("5 `BLOQUEADO`");
    expect(report).toContain("1 `DIVERGENTE`");
  });
});
