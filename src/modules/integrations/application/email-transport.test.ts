import { describe, expect, it, vi } from "vitest";

import { EmailExternalDisabledError, LocalEmailSinkTransport, SmtpEmailTransport } from "@/modules/integrations/application/email-transport";

const command = { from: "crm@demo.politizai.local", to: ["lead@example.invalid"], subject: "Assunto", text: "Olá", messageId: "<fixture@demo.politizai.local>", idempotencyKey: "email-fixture-001" };

describe("CRM-45 transportes de e-mail", () => {
  it("mantém o sink local determinístico e sem egress", async () => {
    const transport = new LocalEmailSinkTransport();
    expect(await transport.send(command)).toEqual(await transport.send(command));
    expect(transport.externalEgress).toBe(false);
  });

  it("bloqueia o SMTP por padrão sem executar adapter", async () => {
    const sendImpl = vi.fn();
    const transport = new SmtpEmailTransport({ host: "smtp.example.test", port: 587, allowedHosts: ["smtp.example.test"], sendImpl });
    await expect(transport.send(command, "fixture-secret")).rejects.toBeInstanceOf(EmailExternalDisabledError);
    expect(sendImpl).not.toHaveBeenCalled();
  });

  it("exige host e porta allowlisted mesmo com egress injetado", async () => {
    const transport = new SmtpEmailTransport({ host: "evil.invalid", port: 25, allowedHosts: ["smtp.example.test"], externalEgress: true, sendImpl: vi.fn() });
    await expect(transport.send(command, "fixture-secret")).rejects.toThrow("EMAIL_SMTP_DESTINATION_NOT_ALLOWLISTED");
  });
});
