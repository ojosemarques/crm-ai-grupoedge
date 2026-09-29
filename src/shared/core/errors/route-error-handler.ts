import { NextResponse } from "next/server";

import { ApplicationError } from "@/shared/core/errors/application-error";
import { resolveCorrelationId } from "@/shared/core/http/correlation";
import { logger } from "@/shared/core/logging/logger";

export function handleRouteError(error: unknown, request?: Request): NextResponse {
  const requestId = resolveCorrelationId(request?.headers ?? new Headers());
  const applicationError =
    error instanceof ApplicationError ? error : undefined;

  const statusCode = applicationError?.statusCode ?? 500;
  const log = statusCode >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log(
    {
      errorCode: applicationError?.code ?? "INTERNAL_ERROR",
      errorName: error instanceof Error ? error.name : "UnknownError",
      correlationId: requestId,
      requestId,
      statusCode,
    },
    statusCode >= 500
      ? "Falha interna em uma rota da aplicação"
      : "Solicitação rejeitada de forma controlada",
  );

  return NextResponse.json(
    {
      error: {
        code: applicationError?.code ?? "INTERNAL_ERROR",
        message:
          applicationError?.expose === true
            ? applicationError.message
            : "Não foi possível concluir a solicitação.",
        requestId,
      },
    },
    {
      status: statusCode,
      headers: {
        "Cache-Control": "no-store",
        "X-Correlation-Id": requestId,
        ...applicationError?.responseHeaders,
      },
    },
  );
}
