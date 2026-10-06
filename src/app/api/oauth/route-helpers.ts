import { OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { ApplicationError } from "@/shared/core/errors/application-error";

export function oauthErrorResponse(error: unknown): NextResponse {
  const normalized = error instanceof OAuthError
    ? error
    : error instanceof ZodError || (error instanceof ApplicationError && error.statusCode < 500)
      ? new OAuthError(OAuthErrorCode.InvalidRequest, "Solicitação OAuth inválida.")
      : new OAuthError(OAuthErrorCode.ServerError, "Não foi possível concluir a solicitação OAuth.");
  const status = normalized.code === OAuthErrorCode.InvalidClient ? 401
    : normalized.code === OAuthErrorCode.ServerError ? 500
      : 400;
  return NextResponse.json(normalized.toResponseObject(), {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

export async function readForm(request: Request, maxBytes = 16 * 1024): Promise<URLSearchParams> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new OAuthError(OAuthErrorCode.InvalidRequest, "Use application/x-www-form-urlencoded.");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new OAuthError(OAuthErrorCode.InvalidRequest, "Corpo da solicitação excede o limite.");
  }
  const body = await request.text();
  if (Buffer.byteLength(body) > maxBytes) {
    throw new OAuthError(OAuthErrorCode.InvalidRequest, "Corpo da solicitação excede o limite.");
  }
  return new URLSearchParams(body);
}

export function uniqueParam(params: URLSearchParams, name: string, required = true): string | undefined {
  const values = params.getAll(name);
  if (values.length > 1 || (required && values.length !== 1) || (values[0]?.length ?? 0) > 4_096) {
    throw new OAuthError(OAuthErrorCode.InvalidRequest, `Parâmetro OAuth inválido: ${name}.`);
  }
  return values[0];
}
