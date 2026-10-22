export type SecurityHeaderOptions = Readonly<{
  nonce?: string;
  development?: boolean;
  https?: boolean;
  imageSources?: readonly string[];
  metaPixel?: boolean;
  allowEmbedding?: boolean;
}>;

export function buildContentSecurityPolicy({
  nonce,
  development = false,
  https = false,
  imageSources = [],
  metaPixel = false,
  allowEmbedding = false,
}: SecurityHeaderOptions = {}): string {
  const scriptSources = ["'self'"];
  if (nonce) scriptSources.push(`'nonce-${nonce}'`, "'strict-dynamic'");
  if (development) scriptSources.push("'unsafe-eval'");
  if (metaPixel) scriptSources.push("https://connect.facebook.net");
  const styleSources = ["'self'", ...(nonce ? [`'nonce-${nonce}'`] : [])];
  const allowedImageSources = [...imageSources, ...(metaPixel ? ["https://www.facebook.com"] : [])];
  const connectSources = ["'self'", ...(metaPixel ? ["https://connect.facebook.net", "https://www.facebook.com"] : [])];
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `style-src ${styleSources.join(" ")}`,
    "style-src-attr 'none'",
    `img-src 'self' data: blob:${allowedImageSources.length ? ` ${allowedImageSources.join(" ")}` : ""}`,
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${allowEmbedding ? "*" : "'none'"}`,
    ...(https ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

export function createStaticSecurityHeaders({
  https = false,
  includeFrameProtection = true,
}: Readonly<{ https?: boolean; includeFrameProtection?: boolean }> = {}) {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    ...(includeFrameProtection ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
    { key: "Referrer-Policy", value: "same-origin" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "Origin-Agent-Cluster", value: "?1" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
    ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
  ] as const;
}
