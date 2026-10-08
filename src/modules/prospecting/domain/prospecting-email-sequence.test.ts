import { describe, expect, it } from "vitest";

import {
  PROSPECTING_EMAIL_ALLOWED_VARIABLES,
  PROSPECTING_EMAIL_SEQUENCE,
  PROSPECTING_EMAIL_STEP_KEYS,
  PROSPECTING_EMAIL_TEMPLATE_COUNT,
} from "@/modules/prospecting/domain/prospecting-email-sequence";

describe("sequência de e-mails da prospecção política", () => {
  it("mantém exatamente seis modelos nos offsets aprovados", () => {
    expect(PROSPECTING_EMAIL_TEMPLATE_COUNT).toBe(6);
    expect(PROSPECTING_EMAIL_SEQUENCE.map((template) => template.stepKey)).toEqual(PROSPECTING_EMAIL_STEP_KEYS);
    expect(PROSPECTING_EMAIL_SEQUENCE.map((template) => template.dayOffset)).toEqual([0, 3, 7, 12, 18, 25]);
  });

  it("converte todos os marcadores editoriais para variáveis renderizáveis", () => {
    for (const template of PROSPECTING_EMAIL_SEQUENCE) {
      const content = `${template.subject}\n${template.body}`;
      expect(content).not.toMatch(/\[[A-Z_]+\]/);
      const placeholders = [...content.matchAll(/\{([a-z_]+)\}/g)].map((match) => match[1]);
      expect(placeholders.every((placeholder) => PROSPECTING_EMAIL_ALLOWED_VARIABLES.includes(placeholder as never))).toBe(true);
      expect(template.body).toContain("{assinatura}");
    }
  });

  it("preserva o assunto alternativo do primeiro contato sem criar um sétimo envio", () => {
    expect(PROSPECTING_EMAIL_SEQUENCE[0].subject).toBe("posso colocar um sistema com IA no seu gabinete?");
    expect(PROSPECTING_EMAIL_SEQUENCE[0].alternateSubjects).toEqual(["Trabalhamos com 450 políticos em 2026. agora quero trabalhar com você"]);
  });
});
