export type CsvTable = Readonly<{
  delimiter: "," | ";";
  headers: readonly string[];
  rows: readonly Readonly<{
    rowNumber: number;
    values: Readonly<Record<string, string>>;
  }>[];
}>;

export class CsvParseError extends Error {
  readonly rowNumber: number;

  constructor(message: string, rowNumber: number) {
    super(message);
    this.name = "CsvParseError";
    this.rowNumber = rowNumber;
  }
}

function countDelimiter(line: string, delimiter: "," | ";"): number {
  let insideQuotes = false;
  let count = 0;

  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') {
      if (insideQuotes && line[index + 1] === '"') {
        index += 1;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (!insideQuotes && line[index] === delimiter) {
      count += 1;
    }
  }

  return count;
}

function detectDelimiter(content: string): "," | ";" {
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  return countDelimiter(firstLine, ";") > countDelimiter(firstLine, ",")
    ? ";"
    : ",";
}

function parseRows(content: string, delimiter: "," | ";"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let insideQuotes = false;
  let physicalLine = 1;

  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];

    if (insideQuotes) {
      if (character === '"') {
        if (content[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          insideQuotes = false;
        }
      } else {
        field += character;
        if (character === "\n") physicalLine += 1;
      }
      continue;
    }

    if (character === '"') {
      if (field.length > 0) {
        throw new CsvParseError(
          "Aspas só podem iniciar no começo de um campo CSV.",
          physicalLine,
        );
      }
      insideQuotes = true;
    } else if (character === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (character === "\n") {
      row.push(field.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
      physicalLine += 1;
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (insideQuotes) {
    throw new CsvParseError("Campo CSV com aspas não finalizadas.", physicalLine);
  }

  row.push(field.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

export function parseCsv(content: string): CsvTable {
  const normalizedContent = content.replace(/^\uFEFF/, "");
  if (!normalizedContent.trim()) {
    throw new CsvParseError("O arquivo CSV está vazio.", 1);
  }

  const delimiter = detectDelimiter(normalizedContent);
  const parsedRows = parseRows(normalizedContent, delimiter);
  const rawHeaders = parsedRows.shift();

  if (!rawHeaders || rawHeaders.length < 2) {
    throw new CsvParseError(
      "O CSV precisa de um cabeçalho com pelo menos duas colunas.",
      1,
    );
  }

  const headers = rawHeaders.map((header) => header.trim());
  if (headers.some((header) => !header)) {
    throw new CsvParseError("O cabeçalho possui uma coluna sem nome.", 1);
  }

  const normalizedHeaders = headers.map((header) => header.toLocaleLowerCase("pt-BR"));
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) {
    throw new CsvParseError("O cabeçalho possui nomes de coluna duplicados.", 1);
  }

  return {
    delimiter,
    headers,
    rows: parsedRows.map((values, index) => {
      if (values.length !== headers.length) {
        throw new CsvParseError(
          `A linha possui ${values.length} colunas, mas o cabeçalho possui ${headers.length}.`,
          index + 2,
        );
      }

      return {
        rowNumber: index + 2,
        values: Object.fromEntries(
          headers.map((header, columnIndex) => [header, values[columnIndex] ?? ""]),
        ),
      };
    }),
  };
}
