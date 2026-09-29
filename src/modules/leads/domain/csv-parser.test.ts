import { describe, expect, it } from "vitest";

import { CsvParseError, parseCsv } from "@/modules/leads/domain/csv-parser";

describe("parser CSV local", () => {
  it("lê vírgula, BOM, CRLF, aspas e aspas escapadas", () => {
    const table = parseCsv('\uFEFFnome,telefone,interesse\r\n"Maria, Teste",11987654321,"Disse ""agora"""\r\n');

    expect(table).toMatchObject({
      delimiter: ",",
      headers: ["nome", "telefone", "interesse"],
      rows: [
        {
          rowNumber: 2,
          values: {
            nome: "Maria, Teste",
            telefone: "11987654321",
            interesse: 'Disse "agora"',
          },
        },
      ],
    });
  });

  it("detecta ponto e vírgula sem quebrar conteúdo entre aspas", () => {
    const table = parseCsv('nome;telefone;dor\nPessoa;11987654322;"dor, contexto"');
    expect(table.delimiter).toBe(";");
    expect(table.rows[0]?.values.dor).toBe("dor, contexto");
  });

  it.each([
    ["", "vazio"],
    ["nome,telefone\n\"Pessoa,11987654321", "aspas não finalizadas"],
    ["nome,nome\nA,B", "duplicados"],
    ["nome,telefone\nA,11987654321,extra", "3 colunas"],
  ])("rejeita CSV malformado: %s", (content, expectedMessage) => {
    expect(() => parseCsv(content)).toThrowError(CsvParseError);
    expect(() => parseCsv(content)).toThrow(expectedMessage);
  });
});
