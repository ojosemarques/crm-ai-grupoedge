import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getAuthenticationService } from "@/modules/auth/application/authentication-service";
import {
  AuthenticationRequiredError,
  SessionExpiredError,
} from "@/modules/auth/domain/auth-errors";
import { SESSION_COOKIE_NAME } from "@/modules/auth/http/session-cookie";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import {
  getAuthorizationService,
  type ResourceScope,
} from "@/modules/users/permissions/authorization-service";
import type { PermissionKey } from "@/modules/users/permissions/permission-keys";

export async function requireApiAuthentication(
  request: NextRequest,
): Promise<AuthenticatedContext> {
  return getAuthenticationService().validateSession(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
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
    return await getAuthenticationService().validateSession(
      cookieStore.get(SESSION_COOKIE_NAME)?.value,
    );
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
