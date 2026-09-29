import { createHash } from "node:crypto";
import { z } from "zod";

import { contractStatuses } from "@/modules/contracts/domain/contract-shared-contracts";

const uuid = z.string().uuid();
const trimmed = z.string().trim();
const dateTime = z.string().datetime({ offset: true });

export const createContractInputSchema = z.object({
  opportunityId: uuid,
  offerId: uuid,
  templateVersionId: uuid,
  billingFrequency: z.enum(["ONE_TIME", "MONTHLY", "QUARTERLY", "ANNUAL", "CUSTOM"]),
  durationMonths: z.number().int().positive().max(240).nullable().optional(),
  proposedStartsAt: dateTime.nullable().optional(),
  proposedEndsAt: dateTime.nullable().optional(),
  renewalExpected: z.boolean().default(false),
  paymentTerms: trimmed.min(3).max(1000),
  commercialNotes: trimmed.max(4000).nullable().optional(),
  zeroValueJustification: trimmed.min(5).max(1000).nullable().optional(),
  idempotencyKey: trimmed.min(8).max(200),
}).strict();

const baseAction = z.object({ expectedRevision: z.number().int().positive(), idempotencyKey: trimmed.min(8).max(200) });
export const contractActionSchema = z.discriminatedUnion("action", [
  baseAction.extend({ action: z.literal("REQUEST_REVIEW"), reason: trimmed.min(5).max(1000), confirmed: z.literal(true) }),
  baseAction.extend({ action: z.literal("MARK_READY"), confirmed: z.literal(true) }),
  baseAction.extend({ action: z.literal("ISSUE"), confirmed: z.literal(true) }),
  baseAction.extend({ action: z.literal("SEND_SIMULATED"), confirmed: z.literal(true) }),
  baseAction.extend({ action: z.literal("ACCEPT_LOCAL"), acceptedByName: trimmed.min(2).max(200), acceptedByRole: trimmed.min(2).max(200), evidenceText: trimmed.min(5).max(2000), effectiveStartsAt: dateTime, effectiveEndsAt: dateTime.nullable().optional(), confirmed: z.literal(true) }),
  baseAction.extend({ action: z.literal("REJECT"), reason: trimmed.min(5).max(1000), confirmed: z.literal(true) }),
  baseAction.extend({ action: z.literal("VOID"), reason: trimmed.min(5).max(1000), confirmed: z.literal(true) }),
  baseAction.extend({ action: z.literal("CREATE_VERSION"), reason: trimmed.min(5).max(1000), confirmed: z.literal(true) }),
  baseAction.extend({ action: z.literal("EXPIRE"), reason: trimmed.min(5).max(1000), confirmed: z.literal(true) }),
]);

export const contractListQuerySchema = z.object({
  search: trimmed.max(200).default(""),
  status: z.union([z.literal("ALL"), z.enum(contractStatuses)]).default("ALL"),
}).strict();

export const allowedContractVariables = new Set(["contractNumber", "accountName", "contactName", "opportunityName", "total"]);

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalContractJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalContractJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalContractJson(item)}`).join(",")}}`;
  }
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  return JSON.stringify(value);
}

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function resolveTemplate(source: string, values: Readonly<Record<string, string>>): string {
  return source.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_match, key: string) => {
    if (!allowedContractVariables.has(key)) throw new Error(`Variável contratual não permitida: ${key}`);
    const value = values[key];
    if (!value) throw new Error(`Campo obrigatório ausente para o template: ${key}`);
    return value;
  });
}
