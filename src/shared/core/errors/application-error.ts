export type ApplicationErrorOptions = {
  code: string;
  statusCode: number;
  expose?: boolean;
  cause?: unknown;
  responseHeaders?: Readonly<Record<string, string>>;
};

export class ApplicationError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly expose: boolean;
  readonly responseHeaders: Readonly<Record<string, string>>;

  constructor(message: string, options: ApplicationErrorOptions) {
    super(message, { cause: options.cause });
    this.name = "ApplicationError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.expose = options.expose ?? false;
    this.responseHeaders = options.responseHeaders ?? {};
  }
}

export class ConfigurationError extends ApplicationError {
  constructor(variableNames: readonly string[]) {
    super(
      `Configuração inválida nas variáveis: ${variableNames.join(", ")}`,
      {
        code: "CONFIGURATION_ERROR",
        statusCode: 500,
      },
    );
    this.name = "ConfigurationError";
  }
}
