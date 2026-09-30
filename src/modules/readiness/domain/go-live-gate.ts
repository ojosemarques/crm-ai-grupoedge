import { z } from "zod";

export const GO_LIVE_GATE_CODES = [
  "IDENTITY_MFA_RECOVERY",
  "LEGAL_DPO",
  "BACKUP_PITR_RESTORE",
  "SECOND_OPERATOR",
  "OBSERVABILITY_ON_CALL",
  "INDEPENDENT_PENTEST",
  "PRODUCTION_DOMAIN",
  "WORKER",
  "COST_CONTROL",
  "AUTHORIZED_PROVIDERS_AND_DATA",
  "FORMAL_APPROVALS",
] as const;

export type GoLiveGateCode = (typeof GO_LIVE_GATE_CODES)[number];

const gateEvidenceSchema = z.object({
  status: z.enum(["PASS", "BLOCKED"]),
  owner: z.string().trim().min(3),
  verifiedAt: z.string().datetime({ offset: true }),
  evidence: z.array(z.string().trim().min(1)).min(1),
});

const goLiveEvidenceSchema = z.object({
  schemaVersion: z.literal("stage19.go-live.v1"),
  release: z.object({
    commit: z.string().regex(/^[0-9a-f]{40}$/),
    deploymentId: z.string().trim().min(1),
    migration: z.string().trim().min(1),
    productionUrl: z.string().url().refine((value) => value.startsWith("https://")),
  }),
  gates: z.record(z.enum(GO_LIVE_GATE_CODES), gateEvidenceSchema),
  approvals: z.object({
    business: z.string().trim().min(3).nullable(),
    security: z.string().trim().min(3).nullable(),
    privacy: z.string().trim().min(3).nullable(),
    operations: z.string().trim().min(3).nullable(),
  }),
});

export type GoLiveEvidence = z.infer<typeof goLiveEvidenceSchema>;

export type GoLiveGateResult = Readonly<{
  code: GoLiveGateCode;
  status: "PASS" | "BLOCKED";
  reason: string;
}>;

export type GoLiveDecision = Readonly<{
  schemaVersion: "stage19.go-live.v1";
  decision: "GO" | "NO_GO";
  release: GoLiveEvidence["release"] | null;
  results: readonly GoLiveGateResult[];
}>;

export function evaluateGoLiveEvidence(input: unknown): GoLiveDecision {
  const parsed = goLiveEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    return Object.freeze({
      schemaVersion: "stage19.go-live.v1",
      decision: "NO_GO",
      release: null,
      results: Object.freeze([
        Object.freeze({
          code: "IDENTITY_MFA_RECOVERY",
          status: "BLOCKED",
          reason: "Manifesto ausente ou inválido; nenhum gate recebe aprovação implícita.",
        }),
      ]),
    });
  }

  const results = GO_LIVE_GATE_CODES.map((code): GoLiveGateResult => {
    const gate = parsed.data.gates[code];
    if (!gate) {
      return Object.freeze({ code, status: "BLOCKED", reason: "Gate sem evidência nomeada." });
    }
    const approvalsComplete = Object.values(parsed.data.approvals).every((owner) => owner !== null);
    const status = code === "FORMAL_APPROVALS" && !approvalsComplete ? "BLOCKED" : gate.status;
    return Object.freeze({
      code,
      status,
      reason: status === "PASS"
        ? "Evidência e responsável registrados."
        : code === "FORMAL_APPROVALS" && !approvalsComplete
          ? "Aprovações nomeadas de negócio, segurança, privacidade e operações estão incompletas."
          : "Gate explicitamente bloqueado.",
    });
  });

  return Object.freeze({
    schemaVersion: "stage19.go-live.v1",
    decision: results.every(({ status }) => status === "PASS") ? "GO" : "NO_GO",
    release: parsed.data.release,
    results: Object.freeze(results),
  });
}
