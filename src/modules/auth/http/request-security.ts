import { isIP } from "node:net";

import type { NextRequest } from "next/server";

import type { RequestMetadata } from "@/modules/auth/application/authenticated-context";
import { InvalidRequestOriginError } from "@/modules/auth/domain/auth-errors";

function normalizeIpAddress(value: string | null): string | null {
  const candidate = value?.split(",").at(0)?.trim();
  return candidate && isIP(candidate) !== 0 ? candidate : null;
}

export function getRequestMetadata(request: NextRequest): RequestMetadata {
  return Object.freeze({
    ipAddress: normalizeIpAddress(
      request.headers.get("x-forwarded-for") ??
        request.headers.get("x-real-ip"),
    ),
    userAgent: request.headers.get("user-agent")?.slice(0, 512) ?? null,
  });
}

export function assertSameOrigin(
  request: NextRequest,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): void {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  const remote = environment.APP_ENV === "staging" || environment.APP_ENV === "production";

  if (!origin) {
    if (remote) throw new InvalidRequestOriginError();
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      throw new InvalidRequestOriginError();
    }
    return;
  }

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    throw new InvalidRequestOriginError();
  }

  const expectedHost =
    request.headers.get("x-forwarded-host")?.split(",").at(0)?.trim() ??
    request.headers.get("host") ??
    request.nextUrl.host;
  const expectedProtocol =
    request.headers.get("x-forwarded-proto")?.split(",").at(0)?.trim() ??
    request.nextUrl.protocol.replace(":", "");

  if (remote) {
    const trustedOrigins = new Set((environment.APP_TRUSTED_ORIGINS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
    const trustedHosts = new Set((environment.APP_TRUSTED_HOSTS ?? "").split(",").map((item) => item.trim()).filter(Boolean));
    if (
      originUrl.protocol !== "https:" ||
      !trustedOrigins.has(originUrl.origin) ||
      !trustedHosts.has(expectedHost) ||
      expectedProtocol !== "https"
    ) {
      throw new InvalidRequestOriginError();
    }
    return;
  }

  if (
    originUrl.host !== expectedHost ||
    originUrl.protocol !== `${expectedProtocol}:`
  ) {
    throw new InvalidRequestOriginError();
  }
}
