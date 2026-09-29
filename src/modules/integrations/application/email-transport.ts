import { createHash } from "node:crypto";

import { assertSafeHeader, EMAIL_MAX_BODY_BYTES, EMAIL_MAX_RECIPIENTS, normalizeEmailAddress } from "@/modules/integrations/domain/email-contracts";

export type EmailSendCommand = Readonly<{
  from: string;
  replyTo?: string | null;
  to: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
  subject: string;
  text: string;
  html?: string | null;
  messageId: string;
  inReplyTo?: string | null;
  references?: readonly string[];
  idempotencyKey: string;
}>;
export type EmailTransportResult = Readonly<{ providerMessageId: string; requestId: string; acceptedAt: Date; simulated: boolean }>;
export interface EmailTransportAdapter { readonly externalEgress: boolean; send(command: EmailSendCommand, secret?: string): Promise<EmailTransportResult>; }
type SmtpSendImplementation = (command: EmailSendCommand, options: Readonly<{ host: string; port: number; timeoutMs: number; requireTls: true; secret: string }>) => Promise<EmailTransportResult>;

export class EmailExternalDisabledError extends Error {
  readonly code = "EMAIL_EXTERNAL_EGRESS_DISABLED";
  constructor() { super("O transporte externo de e-mail está desativado. Use o sink local."); this.name = "EmailExternalDisabledError"; }
}

function validateCommand(command: EmailSendCommand) {
  assertSafeHeader(command.subject, "subject");
  assertSafeHeader(command.from, "from");
  if (command.replyTo) assertSafeHeader(command.replyTo, "reply-to");
  const recipients = [...command.to, ...(command.cc ?? []), ...(command.bcc ?? [])];
  if (!recipients.length || recipients.length > EMAIL_MAX_RECIPIENTS) throw new Error("EMAIL_RECIPIENT_LIMIT");
  if (recipients.some((value) => !normalizeEmailAddress(assertSafeHeader(value, "recipient")).success)) throw new Error("EMAIL_RECIPIENT_INVALID");
  if (Buffer.byteLength(command.text, "utf8") > EMAIL_MAX_BODY_BYTES) throw new Error("EMAIL_BODY_TOO_LARGE");
}

export class LocalEmailSinkTransport implements EmailTransportAdapter {
  readonly externalEgress = false;
  async send(command: EmailSendCommand): Promise<EmailTransportResult> {
    validateCommand(command);
    const digest = createHash("sha256").update(command.idempotencyKey).digest("hex").slice(0, 28);
    return { providerMessageId: `local-email-${digest}`, requestId: `local:${digest}`, acceptedAt: new Date(0), simulated: true };
  }
}

export class SmtpEmailTransport implements EmailTransportAdapter {
  readonly externalEgress: boolean;
  readonly #allowedHosts: ReadonlySet<string>;
  readonly #host: string;
  readonly #port: number;
  readonly #timeoutMs: number;
  readonly #sendImpl: SmtpSendImplementation | undefined;

  constructor(options: Readonly<{ host: string; port: number; allowedHosts: readonly string[]; externalEgress?: boolean; timeoutMs?: number; sendImpl?: SmtpSendImplementation }>) {
    this.externalEgress = options.externalEgress === true;
    this.#host = options.host.toLowerCase();
    this.#port = options.port;
    this.#allowedHosts = new Set(options.allowedHosts.map((item) => item.toLowerCase()));
    this.#timeoutMs = Math.max(1_000, Math.min(options.timeoutMs ?? 12_000, 30_000));
    this.#sendImpl = options.sendImpl;
  }

  async send(command: EmailSendCommand, secret?: string): Promise<EmailTransportResult> {
    if (!this.externalEgress) throw new EmailExternalDisabledError();
    validateCommand(command);
    if (!this.#allowedHosts.has(this.#host) || ![465, 587].includes(this.#port)) throw new Error("EMAIL_SMTP_DESTINATION_NOT_ALLOWLISTED");
    if (!secret?.trim()) throw new Error("EMAIL_SMTP_SECRET_MISSING");
    if (!this.#sendImpl) throw new Error("EMAIL_SMTP_PROVIDER_NOT_CONFIGURED");
    return this.#sendImpl(command, { host: this.#host, port: this.#port, timeoutMs: this.#timeoutMs, requireTls: true, secret });
  }
}

export const localEmailSinkTransport = new LocalEmailSinkTransport();
export const externalEmailTransport = new SmtpEmailTransport({ host: "disabled.invalid", port: 587, allowedHosts: [] });
