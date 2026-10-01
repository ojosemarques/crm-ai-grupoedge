import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { cache } from "react";

import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthenticationService } from "@/modules/auth/application/authentication-service";
import {
  AuthenticationRequiredError,
  SessionExpiredError,
} from "@/modules/auth/domain/auth-errors";
import { SESSION_COOKIE_NAME } from "@/modules/auth/http/session-cookie";
import { ApplicationError } from "@/shared/core/errors/application-error";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import {
  getAuthorizationService,
  type ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";

export async function requireApiAuthentication(
  request: NextRequest,
): Promise<AuthenticatedContext> {
  const context = await getAuthenticationService().validateSession(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
  const expectedSession = request.headers.get("x-crm-session");
  if (expectedSession && expectedSession !== context.sessionId) {
    throw new ApplicationError("A empresa ou sessão mudou em outra aba. Abra o hub novamente.", { code: "COMPANY_SESSION_CHANGED", statusCode: 409, expose: true });
  }
  return context;
}

export async function requireApiPermission(
  request: NextRequest,
  permission: PermissionKey,
  resource: ResourceScope,
): Promise<AuthenticatedContext> {
  const context = await requireApiAuthentication(request);
  await getAuthorizationService().assertAuthorized(
    context,
    permission,
    resource,
  );
  return context;
}

export async function requirePageAuthentication(): Promise<AuthenticatedContext> {
  const cookieStore = await cookies();

  try {
    return await validatePageSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  } catch (error) {
    if (error instanceof SessionExpiredError) {
      redirect("/sessao-expirada");
    }

    if (error instanceof AuthenticationRequiredError) {
      redirect("/login");
    }

    throw error;
  }
}

const validatePageSession = cache((token: string | undefined) =>
  getAuthenticationService().validateSession(token),
);

export async function getOptionalPageAuthentication(): Promise<AuthenticatedContext | null> {
  const cookieStore = await cookies();
  try {
    return await validatePageSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  } catch (error) {
    if (error instanceof SessionExpiredError || error instanceof AuthenticationRequiredError) return null;
    throw error;
  }
}

export async function requirePagePermission(
  permission: PermissionKey,
  resource: ResourceScope,
): Promise<AuthenticatedContext> {
  const context = await requirePageAuthentication();

  try {
    await getAuthorizationService().assertAuthorized(
      context,
      permission,
      resource,
    );
    return context;
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      redirect("/acesso-negado");
    }
    throw error;
  }
}
