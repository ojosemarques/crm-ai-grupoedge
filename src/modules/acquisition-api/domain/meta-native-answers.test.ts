import { describe, expect, it } from "vitest";
import { metaNativeAnswers, metaNativeResponseSchema } from "./meta-native-answers";

describe("respostas nativas", () => {
  it("preserva perguntas de qualificação e evita duplicar identidade ou copiar segredos", () => {
    const form = { name: "Mandato", questions: [{ key: "full_name", type: "FULL_NAME", label: "Nome" }, { key: "phone", type: "PHONE", label: "Telefone" }, { key: "qual_é_o_desafio/atual?", type: "CUSTOM", label: "Qual é o desafio?" }, { key: "access_token", type: "CUSTOM", label: "Token" }] };
    const result = metaNativeAnswers(form, { full_name: "Nome privado", phone: "+5511999999999", "qual_é_o_desafio/atual?": "Organizar gabinete", access_token: "secret-fixture" }, "Forms Nativo");
    expect(result).toEqual({ formName: "Mandato", answers: [{ questionKey: "qual_é_o_desafio/atual?", question: "Qual é o desafio?", displayValue: "Organizar gabinete" }] });
    expect(metaNativeResponseSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret-fixture");
  });
  it("limita o tamanho e aceita somente valores escalares", () => {
    expect(metaNativeAnswers({ questions: [{ key: "a", type: "CUSTOM" }, { key: "b", type: "CUSTOM" }] }, { a: "x".repeat(3000), b: { token: "secret" } }, "Nativo").answers).toEqual([{ questionKey: "a", question: "a", displayValue: "x".repeat(2000) }]);
  });
});
