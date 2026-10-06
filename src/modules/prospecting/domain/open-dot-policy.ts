import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  OPEN_DOT_SIGNATURE_TOLERANCE_SECONDS,
  openDotScopeSchema,
  type OpenDotScopeValue,
} from "@/modules/prospecting/domain/prospecting-contracts";
import { ApplicationError } from "@/shared/core/errors/application-error";

const clientSchema = z.object({
  clientId: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
  workspaceId: z.string().uuid(),
  actorId: z.string().uuid(),
  scopes: z.array(openDotScopeSchema).min(1).refine((items) => new Set(items).size === items.length),
  currentSecret: z.string().min(32).max(500),
  previousSecret: z.string().min(32).max(500).optional(),
}).strict();

const clientsSchema = z.array(clientSchema).max(100).refine(
  (items) => new Set(items.map((item) => item.clientId)).size === items.length,
  "clientId duplicado em OPEN_DOT_CLIENTS_JSON.",
);

export type OpenDotPrincipal = Readonly<{
  clientId: string;
  workspaceId: string;
  actorId: string;
  scopes: readonly OpenDotScopeValue[];
}>;

type ConfiguredClient = z.infer<typeof clientSchema>;

function configurationError(): never {
  throw new ApplicationError("A integração Open-Dot não está configurada.", {
    code: "OPEN_DOT_CONFIGURATION_UNAVAILABLE",
    statusCode: 503,
    expose: true,
  });
}

export function loadOpenDotClients(environment: NodeJS.ProcessEnv = process.env): readonly ConfiguredClient[] {
  const raw = environment.OPEN_DOT_CLIENTS_JSON;
  if (!raw) return [];
  try {
    return clientsSchema.parse(JSON.parse(raw));
  } catch {
    configurationError();
  }
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function openDotSignaturePayload(input: Readonly<{
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}>): string {
  return [input.method.toUpperCase(), input.path, input.timestamp, input.nonce, sha256(input.rawBody)].join("\n");
}

export function signOpenDotRequest(input: Readonly<{
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
}>): string {
  return `sha256=${createHmac("sha256", input.secret).update(openDotSignaturePayload(input)).digest("hex")}`;
}

function signatureMatches(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function authenticateOpenDotRequest(input: Readonly<{
  clients: readonly ConfiguredClient[];
  clientId: string;
  requiredScope: OpenDotScopeValue;
  method: string;
  path: string;
  timestamp: string;
  nonce: string;
  rawBody: string;
  signature: string;
  now: Date;
}>): OpenDotPrincipal {
  const client = input.clients.find((item) => item.clientId === input.clientId);
  if (!client) {
    throw new ApplicationError("Credencial Open-Dot inválida.", { code: "OPEN_DOT_UNAUTHENTICATED", statusCode: 401, expose: true });
  }
  const timestamp = new Date(input.timestamp);
  if (Number.isNaN(timestamp.getTime()) || Math.abs(input.now.getTime() - timestamp.getTime()) > OPEN_DOT_SIGNATURE_TOLERANCE_SECONDS * 1_000) {
    throw new ApplicationError("Assinatura Open-Dot fora da janela temporal.", { code: "OPEN_DOT_SIGNATURE_EXPIRED", statusCode: 401, expose: true });
  }
  if (!client.scopes.includes(input.requiredScope)) {
    throw new ApplicationError("Escopo Open-Dot insuficiente.", { code: "OPEN_DOT_SCOPE_DENIED", statusCode: 403, expose: true });
  }
  const signatureInput = {
    method: input.method,
    path: input.path,
    timestamp: input.timestamp,
    nonce: input.nonce,
    rawBody: input.rawBody,
  };
  const valid = [client.currentSecret, client.previousSecret]
    .filter((secret): secret is string => Boolean(secret))
    .some((secret) => signatureMatches(signOpenDotRequest({ ...signatureInput, secret }), input.signature));
  if (!valid) {
    throw new ApplicationError("Assinatura Open-Dot inválida.", { code: "OPEN_DOT_SIGNATURE_INVALID", statusCode: 401, expose: true });
  }
  return { clientId: client.clientId, workspaceId: client.workspaceId, actorId: client.actorId, scopes: client.scopes };
}
