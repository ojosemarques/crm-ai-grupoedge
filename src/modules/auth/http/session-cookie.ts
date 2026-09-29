export const SESSION_COOKIE_NAME = "politizai_session";

export type SessionCookie = Readonly<{
  name: typeof SESSION_COOKIE_NAME;
  value: string;
  httpOnly: true;
  secure: boolean;
  sameSite: "lax";
  path: "/";
  priority: "high";
  expires: Date;
  maxAge?: number;
}>;

function cookieSecure(source: Readonly<Record<string, string | undefined>>): boolean {
  const remote = source.APP_ENV === "staging" || source.APP_ENV === "production";
  if (remote && source.SESSION_COOKIE_SECURE !== "true") {
    throw new Error("Configuração insegura: SESSION_COOKIE_SECURE deve ser true fora do ambiente local.");
  }
  if (source.SESSION_COOKIE_HTTP_ONLY && source.SESSION_COOKIE_HTTP_ONLY !== "true") {
    throw new Error("Configuração insegura: SESSION_COOKIE_HTTP_ONLY deve ser true.");
  }
  if (source.SESSION_COOKIE_SAME_SITE && source.SESSION_COOKIE_SAME_SITE !== "lax") {
    throw new Error("Configuração insegura: SESSION_COOKIE_SAME_SITE deve ser lax.");
  }
  return remote || source.SESSION_COOKIE_SECURE === "true";
}

export function createSessionCookie(
  token: string,
  expiresAt: Date,
  source: Readonly<Record<string, string | undefined>> = process.env,
): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: cookieSecure(source),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
    priority: "high",
  };
}

export function createExpiredSessionCookie(
  source: Readonly<Record<string, string | undefined>> = process.env,
): SessionCookie {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    secure: cookieSecure(source),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
    priority: "high",
  };
}
