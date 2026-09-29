import type { NextRequest } from "next/server";

import { ApplicationError } from "@/shared/core/errors/application-error";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function assertLocalOnly(request: NextRequest): void {
  if (process.env.NODE_ENV === "production" || !LOCAL_HOSTS.has(request.nextUrl.hostname)) {
    throw new ApplicationError("Este endpoint existe somente no ambiente local.", {
      code: "LOCAL_ENDPOINT_ONLY",
      statusCode: 404,
      expose: true,
    });
  }
}
