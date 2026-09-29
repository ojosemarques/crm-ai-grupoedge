import { ApplicationError } from "@/shared/core/errors/application-error";

export class AccessDeniedError extends ApplicationError {
  constructor() {
    super("Você não tem permissão para realizar esta ação.", {
      code: "ACCESS_DENIED",
      statusCode: 403,
      expose: true,
    });
    this.name = "AccessDeniedError";
  }
}
