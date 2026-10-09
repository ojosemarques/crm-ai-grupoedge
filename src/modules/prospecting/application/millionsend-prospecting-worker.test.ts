import { describe, expect, it, vi } from "vitest";

import { createMillionSendProspectingWorker } from "@/modules/prospecting/application/millionsend-prospecting-worker";

const jobId = "00000000-0000-4000-8000-000000000001";
const environment = {
  MILLIONSEND_ENABLED: "true",
  MILLIONSEND_API_KEY: "ms_fixture_key",
  MILLIONSEND_OPEN_DOT_CLIENT_ID: "open-dot-email",
  MILLIONSEND_OPEN_DOT_SECRET: "fixture-open-dot-secret-with-more-than-32-chars",
  APP_CANONICAL_URL: "https://crm.example.test",
  NODE_ENV: "test",
};
const job = {
  id: jobId,
  recipient: "contato@politizai.com",
  sender: "jhoncunha@politizai.com",
  replyTo: "jhoncunha@politizai.com",
  subject: "Teste",
  body: "Corpo",
  idempotencyKey: "email-job-fixture-001",
};

describe("worker de prospecção MillionSend", () => {
  it("revalida antes de enviar e registra o ID real do provedor", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/claim")) return new Response(JSON.stringify({ jobs: [job] }), { status: 200 });
      if (url.endsWith("/revalidate")) return new Response(JSON.stringify({ authorized: true, disposition: "AUTHORIZED" }), { status: 200 });
      if (url === "https://api.millionsend.com/emails") return new Response(JSON.stringify({ id: "provider-message-001" }), { status: 200 });
      if (url.endsWith("/receipt")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({ outcome: "SENT", providerMessageId: "provider-message-001" });
        return new Response(JSON.stringify({ job: { id: jobId, status: "SENT" } }), { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    await expect(createMillionSendProspectingWorker({ environment, fetchImpl: fetcher }).processNext()).resolves.toEqual({ status: "SENT" });
    expect(calls.map((url) => url.replace(/^https:\/\/[^/]+/, ""))).toEqual([
      "/api/integrations/open-dot/v1/email-jobs/claim",
      `/api/integrations/open-dot/v1/email-jobs/${jobId}/revalidate`,
      "/emails",
      `/api/integrations/open-dot/v1/email-jobs/${jobId}/receipt`,
    ]);
  });

  it("não chama a MillionSend quando a revalidação nega o envio", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/claim")) return new Response(JSON.stringify({ jobs: [job] }), { status: 200 });
      return new Response(JSON.stringify({ authorized: false, disposition: "BLOCKED" }), { status: 200 });
    });

    await expect(createMillionSendProspectingWorker({ environment, fetchImpl: fetcher }).processNext()).resolves.toEqual({ status: "BLOCKED" });
    expect(fetcher.mock.calls.some(([input]) => String(input) === "https://api.millionsend.com/emails")).toBe(false);
  });

  it("marca reconciliação quando o resultado do provedor é incerto", async () => {
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/claim")) return new Response(JSON.stringify({ jobs: [job] }), { status: 200 });
      if (url.endsWith("/revalidate")) return new Response(JSON.stringify({ authorized: true, disposition: "AUTHORIZED" }), { status: 200 });
      if (url === "https://api.millionsend.com/emails") throw new TypeError("network unavailable");
      expect(JSON.parse(String(init?.body))).toMatchObject({ outcome: "RECONCILIATION_REQUIRED" });
      return new Response(JSON.stringify({ job: { id: jobId, status: "RECONCILIATION_REQUIRED" } }), { status: 200 });
    });

    await expect(createMillionSendProspectingWorker({ environment, fetchImpl: fetcher }).processNext()).resolves.toEqual({ status: "RECONCILIATION_REQUIRED" });
  });
});
