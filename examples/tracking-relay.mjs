import { createHmac } from "node:crypto";

/** Install on the website's backend. All configuration, especially secret, stays server-side. */
export function createTrackingRelay({ siteOrigin, crmEndpoint, secret, rateLimit }) {
  if (new URL(siteOrigin).origin !== siteOrigin || new URL(crmEndpoint).protocol !== "https:" || !secret || typeof rateLimit !== "function") {
    throw new Error("Configure an exact site origin, HTTPS CRM endpoint, server secret and shared rate limiter.");
  }
  return async function POST(request) {
    if (request.headers.get("origin") !== siteOrigin) return new Response(null, { status: 403 });
    if (!await rateLimit(request)) return new Response(null, { status: 429 });
    if (!request.headers.get("content-type")?.startsWith("application/json") || !request.body) return new Response(null, { status: 415 });
    const reader = request.body.getReader();
    const chunks = []; let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 32768) { await reader.cancel(); return new Response(null, { status: 413 }); }
      chunks.push(Buffer.from(part.value));
    }
    let payload;
    try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return new Response(null, { status: 400 }); }
    if (payload?.consent !== true || payload?.origin !== siteOrigin || !Array.isArray(payload.events) || payload.events.length > 50) return new Response(null, { status: 422 });
    const rawBody = JSON.stringify(payload);
    const timestamp = new Date().toISOString();
    const signature = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
    const upstream = await fetch(crmEndpoint, { method: "POST", headers: { "Content-Type": "application/json", "x-politizai-timestamp": timestamp, "x-politizai-signature": signature }, body: rawBody, signal: AbortSignal.timeout(5000), redirect: "error" });
    return new Response(null, { status: upstream.ok ? 204 : upstream.status, headers: { "Cache-Control": "no-store" } });
  };
}
