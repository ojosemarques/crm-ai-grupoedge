import { ApplicationError } from "@/shared/core/errors/application-error";

export class InvalidCredentialsError extends ApplicationError {
  constructor() {
    super("Workspace, e-mail ou senha inválidos.", {
      code: "INVALID_CREDENTIALS",
      statusCode: 401,
      expose: true,
    });
    this.name = "InvalidCredentialsError";
  }
}

export class AuthenticationRequiredError extends ApplicationError {
  constructor() {
    super("É necessário entrar para acessar este recurso.", {
      code: "AUTHENTICATION_REQUIRED",
      statusCode: 401,
      expose: true,
    });
    this.name = "AuthenticationRequiredError";
  }
}

export class SessionExpiredError extends ApplicationError {
  constructor() {
    super("Sua sessão expirou. Entre novamente.", {
      code: "SESSION_EXPIRED",
      statusCode: 401,
      expose: true,
    });
    this.name = "SessionExpiredError";
  }
}

export class InvalidAuthenticationInputError extends ApplicationError {
  constructor() {
    super("Revise os dados informados e tente novamente.", {
      code: "INVALID_AUTHENTICATION_INPUT",
      statusCode: 400,
      expose: true,
    });
    this.name = "InvalidAuthenticationInputError";
  }
}

export class InvalidRequestOriginError extends ApplicationError {
  constructor() {
    super("A origem desta solicitação não é permitida.", {
      code: "INVALID_REQUEST_ORIGIN",
      statusCode: 403,
      expose: true,
    });
    this.name = "InvalidRequestOriginError";
  }
}

export class PasswordPolicyError extends ApplicationError {
  constructor() {
    super("A senha deve ter entre 12 e 128 caracteres.", {
      code: "PASSWORD_POLICY_VIOLATION",
      statusCode: 400,
      expose: true,
    });
    this.name = "PasswordPolicyError";
  }
}
