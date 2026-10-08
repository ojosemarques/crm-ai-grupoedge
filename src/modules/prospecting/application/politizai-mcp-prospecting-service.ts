import { createHash } from "node:crypto";

import { z } from "zod";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { McpAuthExtra } from "@/modules/prospecting/application/politizai-mcp-oauth-service";
import { createProspectingStagingService } from "@/modules/prospecting/application/prospecting-staging-service";
import { PROSPECTING_CONTRACT_VERSION } from "@/modules/prospecting/domain/prospecting-contracts";
import { PROSPECTING_SOURCE_SNAPSHOTS } from "@/modules/prospecting/domain/politizai-mcp-config";
import type { OpenDotPrincipal } from "@/modules/prospecting/domain/open-dot-policy";
import { normalizePhoneIdentity } from "@/modules/leads/domain/phone-normalizer";
import { getDatabaseClient } from "@/shared/core/database/client";
import { ApplicationError } from "@/shared/core/errors/application-error";

const LEASE_MINUTES = 45;
const AGENT_VERSION = "politizai-dot-mcp/1.5.1";
const PROMPT_VERSION = "political-prospect-production/v7";
const BRAZILIAN_CAPITALS = [
  "Aracaju", "Belém", "Belo Horizonte", "Boa Vista", "Campo Grande", "Cuiabá", "Curitiba",
  "Florianópolis", "Fortaleza", "Goiânia", "João Pessoa", "Macapá", "Maceió", "Manaus",
  "Natal", "Palmas", "Porto Alegre", "Porto Velho", "Recife", "Rio Branco", "Rio de Janeiro",
  "Salvador", "São Luís", "São Paulo", "Teresina", "Vitória",
];

const researchSourceSchema = z.object({
  field: z.enum(["role", "mandate", "phone", "email", "politician_phone", "politician_email", "advisor_phone", "advisor_email", "whatsapp", "instagram"]),
  type: z.enum(["TSE", "CITY_HALL", "CITY_COUNCIL", "OFFICIAL_GAZETTE", "INSTITUTIONAL_PROFILE"]),
  url: z.string().url().max(2_000),
  observedAt: z.string().datetime({ offset: true }),
  contactScope: z.enum(["POLITICIAN", "ADVISOR", "OFFICE"]).optional(),
  originalValue: z.string().trim().max(2_000).optional(),
  normalizedValue: z.string().trim().max(2_000).optional(),
  validationMethod: z.string().trim().min(3).max(160).default("OFFICIAL_SOURCE_CHECK"),
}).strict();

const checkedAtSchema = z.string().datetime({ offset: true });
const publicUrlSchema = z.string().url().max(2_000);
const researchChecksSchema = z.object({
  municipalOffice: z.object({
    status: z.enum(["INDIVIDUAL_CONTACTS_CAPTURED", "SHARED_CONTACT_ONLY", "CONTACTS_NOT_PUBLISHED", "SOURCE_UNAVAILABLE"]),
    url: publicUrlSchema,
    checkedAt: checkedAtSchema,
  }).strict(),
  tse2024Candidate: z.object({
    status: z.enum(["CONTACTS_CAPTURED", "CONTACTS_NOT_PUBLIC", "SOURCE_UNAVAILABLE"]),
    url: publicUrlSchema.refine((value) => {
      const host = new URL(value).hostname.toLowerCase();
      return host === "tse.jus.br" || host.endsWith(".tse.jus.br");
    }, "A consulta de contatos eleitorais deve apontar para o TSE/DivulgaCandContas."),
    checkedAt: checkedAtSchema,
  }).strict(),
  instagram: z.object({
    status: z.enum(["PROFILE_CAPTURED", "PROFILE_NOT_FOUND", "SOURCE_UNAVAILABLE"]),
    url: publicUrlSchema.optional(),
    checkedAt: checkedAtSchema,
  }).strict(),
}).strict();

function describesSharedInstitutionalContact(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return [
    "central compartilhada",
    "contato compartilhado",
    "telefone compartilhado",
    "geral/protocolo",
    "geral da camara",
    "central da camara",
    "nao exclusivo",
    "intermediado",
  ].some((marker) => normalized.includes(marker));
}

export const registerCandidateSchema = z.object({
  targetId: z.string().uuid(),
  leaseOwner: z.string().min(10).max(240),
  politician: z.object({
    mandateStatus: z.enum(["CURRENT", "INCONCLUSIVE"]),
    mandateVerifiedAt: z.string().datetime({ offset: true }),
  }).strict(),
  contact: z.object({
    phone: z.string().trim().min(8).max(80).nullable().optional(),
    phoneScope: z.literal("OFFICE").nullable().optional(),
    email: z.string().trim().toLowerCase().email().max(320).nullable().optional(),
    emailScope: z.literal("OFFICE").nullable().optional(),
    politicianPhone: z.string().trim().min(8).max(80).nullable().optional(),
    politicianEmail: z.string().trim().toLowerCase().email().max(320).nullable().optional(),
    advisorPhone: z.string().trim().min(8).max(80).nullable().optional(),
    advisorEmail: z.string().trim().toLowerCase().email().max(320).nullable().optional(),
    whatsapp: z.string().trim().min(8).max(80).nullable().optional(),
    whatsappScope: z.enum(["POLITICIAN", "ADVISOR", "OFFICE"]).nullable().optional(),
    instagram: z.string().trim().min(2).max(160).nullable().optional(),
    instagramScope: z.enum(["POLITICIAN", "ADVISOR", "OFFICE"]).nullable().optional(),
  }).strict(),
  researchChecks: researchChecksSchema,
  sources: z.array(researchSourceSchema).min(3).max(38),
}).strict().superRefine((value, context) => {
  for (const [field, scopeField, raw, scope] of [
    ["phone", "phoneScope", value.contact.phone, value.contact.phoneScope],
    ["email", "emailScope", value.contact.email, value.contact.emailScope],
    ["whatsapp", "whatsappScope", value.contact.whatsapp, value.contact.whatsappScope],
    ["instagram", "instagramScope", value.contact.instagram, value.contact.instagramScope],
  ] as const) {
    if (raw && !scope) context.addIssue({ code: "custom", path: ["contact", scopeField], message: `O escopo de ${field} é obrigatório quando o contato é informado.` });
    if (!raw && scope) context.addIssue({ code: "custom", path: ["contact", scopeField], message: `Não informe escopo de ${field} sem o contato.` });
  }
  const officeContacts = [value.contact.phone, value.contact.email, value.contact.advisorPhone, value.contact.advisorEmail].filter(Boolean);
  const officeStatus = value.researchChecks.municipalOffice.status;
  if (officeStatus === "INDIVIDUAL_CONTACTS_CAPTURED" && officeContacts.length === 0) {
    context.addIssue({ code: "custom", path: ["researchChecks", "municipalOffice", "status"], message: "O status informa contato individual, mas nenhum contato de gabinete ou assessor foi enviado." });
  }
  if (officeStatus !== "INDIVIDUAL_CONTACTS_CAPTURED" && officeContacts.length > 0) {
    context.addIssue({ code: "custom", path: ["contact", "phone"], message: "Contato geral ou compartilhado da Câmara não pode ser cadastrado como gabinete individual." });
  }
  const officePhoneSources = value.sources.filter((source) => source.field === "phone" && source.contactScope === "OFFICE");
  if (value.contact.phone && officePhoneSources.some((source) => describesSharedInstitutionalContact(source.originalValue))) {
    context.addIssue({ code: "custom", path: ["contact", "phone"], message: "A evidência identifica central geral/compartilhada, não telefone ou ramal individual do gabinete." });
  }

  const tseContactSources = value.sources.filter((source) => source.type === "TSE" && ["politician_phone", "politician_email"].includes(source.field));
  if (value.researchChecks.tse2024Candidate.status === "CONTACTS_CAPTURED") {
    if (!value.contact.politicianPhone && !value.contact.politicianEmail) {
      context.addIssue({ code: "custom", path: ["researchChecks", "tse2024Candidate", "status"], message: "O status informa contatos do DivulgaCandContas, mas telefone/e-mail do candidato não foi enviado." });
    }
    if (tseContactSources.length === 0) {
      context.addIssue({ code: "custom", path: ["sources"], message: "Contato eleitoral capturado exige evidência específica do TSE/DivulgaCandContas 2024." });
    }
  }

  if (value.researchChecks.instagram.status === "PROFILE_CAPTURED" && !value.contact.instagram) {
    context.addIssue({ code: "custom", path: ["contact", "instagram"], message: "O status informa Instagram validado, mas o perfil não foi enviado." });
  }
  if (value.contact.instagram && value.researchChecks.instagram.status !== "PROFILE_CAPTURED") {
    context.addIssue({ code: "custom", path: ["researchChecks", "instagram", "status"], message: "Instagram informado exige pesquisa concluída e perfil validado." });
  }
  for (const [contactField, sourceField, raw] of [
    ["phone", "phone", value.contact.phone],
    ["email", "email", value.contact.email],
    ["politicianPhone", "politician_phone", value.contact.politicianPhone],
    ["politicianEmail", "politician_email", value.contact.politicianEmail],
    ["advisorPhone", "advisor_phone", value.contact.advisorPhone],
    ["advisorEmail", "advisor_email", value.contact.advisorEmail],
    ["whatsapp", "whatsapp", value.contact.whatsapp],
    ["instagram", "instagram", value.contact.instagram],
  ] as const) {
    if (raw && !value.sources.some((source) => source.field === sourceField)) {
      context.addIssue({ code: "custom", path: ["sources"], message: `Falta fonte verificável para ${contactField}.` });
    }
  }
});

type RegisterCandidateContact = z.infer<typeof registerCandidateSchema>["contact"];
type RegisterCandidateSource = z.infer<typeof registerCandidateSchema>["sources"][number];

export function normalizeRegisterCandidateSources(
  contact: RegisterCandidateContact,
  sources: readonly RegisterCandidateSource[],
): RegisterCandidateSource[] {
  const scopeByField: Partial<Record<RegisterCandidateSource["field"], "POLITICIAN" | "ADVISOR" | "OFFICE">> = {
    phone: "OFFICE",
    email: "OFFICE",
    politician_phone: "POLITICIAN",
    politician_email: "POLITICIAN",
    advisor_phone: "ADVISOR",
    advisor_email: "ADVISOR",
    ...(contact.whatsappScope ? { whatsapp: contact.whatsappScope } : {}),
    ...(contact.instagramScope ? { instagram: contact.instagramScope } : {}),
  };

  return sources
    .filter((source) => source.type !== "TSE" || ["politician_phone", "politician_email"].includes(source.field))
    .map((source) => {
      const contactScope = scopeByField[source.field];
      const validationMethod = source.type === "TSE" && !source.validationMethod.includes("2024")
        ? `TSE_RESULTADOS_2024_${source.validationMethod}`
        : source.validationMethod;
      return {
        ...source,
        validationMethod,
        ...(contactScope ? { contactScope } : {}),
      };
    });
}

export const inconclusiveTargetSchema = z.object({
  targetId: z.string().uuid(),
  leaseOwner: z.string().min(10).max(240),
  reasonCode: z.enum(["CAPTCHA", "CONTACT_NOT_FOUND", "CONFLICTING_SOURCES", "MUNICIPAL_SOURCE_UNAVAILABLE", "OTHER"]),
  evidence: z.array(z.object({ url: z.string().url().max(2_000), note: z.string().trim().min(3).max(500) }).strict()).max(20).default([]),
}).strict();

type Options = Readonly<{ database: PrismaClient; now: () => Date }>;

function fail(message: string, code: string, statusCode = 409): never {
  throw new ApplicationError(message, { code, statusCode, expose: true });
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function contactScopeLabel(scope: "POLITICIAN" | "ADVISOR" | "OFFICE"): string {
  if (scope === "POLITICIAN") return "Direto";
  if (scope === "ADVISOR") return "Assessoria";
  return "Gabinete";
}

function normalizeInstagram(value: string): string {
  return value.trim().toLocaleLowerCase("pt-BR");
}

function storedPhoneIdentity(rawValue: string | null, normalizedValue: string | null) {
  const parsed = rawValue ? normalizePhoneIdentity(rawValue) : normalizedValue ? normalizePhoneIdentity(normalizedValue) : null;
  return parsed?.success ? parsed : null;
}

function phoneContactLabel(label: string, rawValue: string): string {
  const parsed = normalizePhoneIdentity(rawValue);
  return parsed.success && parsed.extension ? `${label} · ramal ${parsed.extension}` : label;
}

export function createPolitizaiMcpProspectingService(options: Options) {
  const staging = createProspectingStagingService({ database: options.database, now: options.now });

  async function principal(transaction: Prisma.TransactionClient, auth: McpAuthExtra, actorKey: "open-dot-research" | "open-dot-auditor"): Promise<OpenDotPrincipal> {
    const actor = await transaction.actor.findFirst({
      where: { workspaceId: auth.workspaceId, key: actorKey, type: "AI_AGENT", userId: null },
      select: { id: true },
    });
    if (!actor) fail("Ator técnico de prospecção não configurado.", "PROSPECTING_ACTOR_NOT_CONFIGURED", 503);
    return {
      clientId: "politizai-mcp",
      workspaceId: auth.workspaceId,
      actorId: actor.id,
      scopes: actorKey === "open-dot-auditor" ? ["RESEARCH_REVIEW", "RESEARCH_READ"] : ["RESEARCH_WRITE", "RESEARCH_READ"],
    };
  }

  async function getContext(auth: McpAuthExtra) {
    const [workspace, settings, sellerConfigs, targets] = await Promise.all([
      options.database.workspace.findFirst({ where: { id: auth.workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, name: true, slug: true } }),
      options.database.prospectingSettings.findUnique({ where: { workspaceId: auth.workspaceId }, select: { releaseEnabled: true, emailEgressEnabled: true } }),
      options.database.prospectingSellerConfig.findMany({
        where: { workspaceId: auth.workspaceId, active: true },
        select: { memberId: true },
        orderBy: [{ rotationPosition: "asc" }, { memberId: "asc" }],
      }),
      options.database.prospectingResearchTarget.groupBy({ by: ["status"], where: { workspaceId: auth.workspaceId }, _count: { _all: true } }),
    ]);
    if (!workspace) fail("Workspace MCP não encontrado.", "MCP_WORKSPACE_NOT_FOUND", 404);
    const activeSellerMembers = await options.database.workspaceMember.findMany({
      where: { id: { in: sellerConfigs.map((seller) => seller.memberId) }, workspaceId: auth.workspaceId, status: "ACTIVE", deletedAt: null, user: { deletedAt: null, status: "ACTIVE" } },
      select: { id: true, userId: true },
    });
    const activeSellerUsers = await options.database.user.findMany({
      where: { id: { in: activeSellerMembers.map((seller) => seller.userId) }, status: "ACTIVE", deletedAt: null },
      select: { id: true, displayName: true },
    });
    const namesByUserId = new Map(activeSellerUsers.map((user) => [user.id, user.displayName]));
    const sellersById = new Map(activeSellerMembers.flatMap((seller) => {
      const name = namesByUserId.get(seller.userId);
      return name ? [[seller.id, name] as const] : [];
    }));
    return {
      workspace,
      rules: {
        roles: ["MAYOR", "COUNCILOR"],
        minimumPopulation: 30_000,
        currentMandateRequired: true,
        acceptanceRule: "PUBLIC_PHONE_OR_WHATSAPP_OR_VALIDATED_INSTAGRAM",
        rejectWhen: "EMAIL_ONLY_OR_NO_USABLE_PUBLIC_CHANNEL",
        requiredResearchChecks: ["individualMunicipalOffice", "DivulgaCandContas2024", "validatedInstagram"],
        exhaustiveResearch: true,
        optionalContactsWhenAvailable: ["individualOfficePhoneOrExtension", "individualOfficeEmail", "politicianPhone", "politicianEmail", "advisorPhone", "advisorEmail", "whatsapp", "instagram"],
        rejectSharedInstitutionalContact: true,
        queuePriority: ["allNonCapitalsBeforeCapitals", "smallerMunicipalityPopulation", "councilorBeforeMayor"],
        publicContactSources: ["TSE_2024", "DIVULGACANDCONTAS", "CITY_HALL", "CITY_COUNCIL", "OFFICIAL_GAZETTE", "INSTITUTIONAL_PROFILE"],
        researchSequence: ["TSE_2024_ELECTED_MATCH", "CURRENT_MUNICIPAL_MANDATE", "INDIVIDUAL_OFFICE_CONTACT", "DIVULGACANDCONTAS_2024_ALWAYS", "GOOGLE_TO_VALIDATED_INSTAGRAM_ALWAYS"],
        stopAfterFirstContact: false,
        inferContactData: false,
        directLeadCreation: false,
        emailSending: false,
      },
      automation: { leadReleaseEnabled: settings?.releaseEnabled ?? false, emailEgressEnabled: settings?.emailEgressEnabled ?? false },
      sellers: sellerConfigs.flatMap((seller) => {
        const name = sellersById.get(seller.memberId);
        return name ? [{ memberId: seller.memberId, name }] : [];
      }),
      targetsByStatus: Object.fromEntries(targets.map((item) => [item.status, item._count._all])),
      sourceSnapshots: PROSPECTING_SOURCE_SNAPSHOTS,
    };
  }

  async function openBatch(auth: McpAuthExtra) {
    return options.database.$transaction(async (transaction) => {
      const researchPrincipal = await principal(transaction, auth, "open-dot-research");
      const targetWithWork = await transaction.prospectingResearchTarget.findFirst({
        where: { workspaceId: auth.workspaceId, status: { in: ["PENDING", "CLAIMED", "REVIEW_REQUIRED"] } },
        orderBy: { createdAt: "desc" },
        select: { batchId: true },
      });
      const active = targetWithWork ? await transaction.prospectingResearchBatch.findFirst({
        where: { id: targetWithWork.batchId, workspaceId: auth.workspaceId, status: { in: ["DRAFT", "RUNNING"] } },
        select: { id: true, status: true, horizonStart: true, horizonEnd: true },
      }) : null;
      if (active) return { batch: { ...active, horizonStart: isoDate(active.horizonStart), horizonEnd: isoDate(active.horizonEnd) }, reused: true };
      const start = options.now();
      const batch = await staging.createResearchBatch(transaction, researchPrincipal, {
        idempotencyKey: `dot-${isoDate(start).slice(0, 7)}-${PROSPECTING_SOURCE_SNAPSHOTS.population.hash.slice(0, 12)}`,
        horizonStart: isoDate(start),
        horizonEnd: isoDate(addDays(start, 29)),
        sourcePopulationEdition: PROSPECTING_SOURCE_SNAPSHOTS.population.edition,
        sourcePopulationHash: PROSPECTING_SOURCE_SNAPSHOTS.population.hash,
        sourcePopulationImportedAt: PROSPECTING_SOURCE_SNAPSHOTS.population.observedAt,
        sourceElectionEdition: PROSPECTING_SOURCE_SNAPSHOTS.election.edition,
        sourceElectionHash: PROSPECTING_SOURCE_SNAPSHOTS.election.hash,
        sourceElectionImportedAt: PROSPECTING_SOURCE_SNAPSHOTS.election.observedAt,
        agentVersion: AGENT_VERSION,
        promptVersion: PROMPT_VERSION,
      });
      return { ...batch, reused: false, note: "O lote precisa receber a fila oficial de alvos antes da pesquisa." };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
  }

  async function claimNextTarget(auth: McpAuthExtra, batchId?: string) {
    return options.database.$transaction(async (transaction) => {
      await principal(transaction, auth, "open-dot-research");
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`politizai-mcp-claim:${auth.workspaceId}`}, 0))`;
      const now = options.now();
      const batch = await transaction.prospectingResearchBatch.findFirst({
        where: { workspaceId: auth.workspaceId, status: { in: ["DRAFT", "RUNNING"] }, ...(batchId ? { id: batchId } : {}) },
        orderBy: { startedAt: "desc" },
        select: { id: true },
      });
      if (!batch) return { target: null, queueEmpty: true };
      const queueWhere = {
        workspaceId: auth.workspaceId,
        batchId: batch.id,
        OR: [{ status: "PENDING" as const }, { status: "CLAIMED" as const, leaseExpiresAt: { lte: now } }],
      };
      const orderBy = [{ population: "asc" as const }, { role: "desc" as const }, { stateCode: "asc" as const }, { municipalityName: "asc" as const }, { politicianName: "asc" as const }];
      let target = await transaction.prospectingResearchTarget.findFirst({
        where: { ...queueWhere, municipalityName: { notIn: BRAZILIAN_CAPITALS } },
        orderBy,
      });
      target ??= await transaction.prospectingResearchTarget.findFirst({ where: queueWhere, orderBy });
      if (!target) return { target: null, queueEmpty: true };
      const leaseOwner = `dot:${auth.authorizingActorId}:${crypto.randomUUID()}`;
      const leaseExpiresAt = new Date(now.getTime() + LEASE_MINUTES * 60_000);
      const claimed = await transaction.prospectingResearchTarget.update({
        where: { id: target.id },
        data: { status: "CLAIMED", leaseOwner, leaseExpiresAt, attemptCount: { increment: 1 }, lastReasonCode: null },
        select: { id: true, batchId: true, candidateId: true, tseCandidateId: true, externalIdentityKey: true, role: true, politicianName: true, ballotName: true, municipalityName: true, municipalityIbgeCode: true, stateCode: true, population: true },
      });
      const existingContact = claimed.candidateId ? await transaction.prospectCandidate.findFirst({
        where: { id: claimed.candidateId, workspaceId: auth.workspaceId },
        select: { phone: true, politicianPhone: true, advisorPhone: true, whatsapp: true, instagram: true },
      }) : null;
      const enrichmentInstruction = claimed.candidateId
        ? "Este alvo já existe no CRM e deve ser ENRIQUECIDO sem remover nenhum contato atual. Encontre e envie ao menos um novo telefone individual do político, assessor, gabinete/ramal exclusivo ou WhatsApp. Quando a fonte publicar um ramal individual, envie o telefone completo no formato `(DDD) NNNN-NNNN ramal NNN`; ramais diferentes da mesma central são contatos distintos. Não repita a central compartilhada já cadastrada; o Instagram continua obrigatório como frente de pesquisa, mas sozinho não conclui este enriquecimento."
        : "Este é um cadastro novo.";
      return { target: { ...claimed, mode: claimed.candidateId ? "ENRICH_EXISTING_CANDIDATE" : "CREATE_CANDIDATE", existingContact, leaseOwner, leaseExpiresAt: leaseExpiresAt.toISOString(), instructions: `${enrichmentInstruction} Conclua obrigatoriamente todas as etapas antes de registrar, mesmo após encontrar o primeiro contato: (1) cruze o eleito no Resultados TSE 2024 e valide o mandato atual; (2) procure telefone/ramal e e-mail do gabinete individual ou assessor em página nominal da Prefeitura/Câmara; nunca grave central geral, protocolo, recepção ou número compartilhado como gabinete; (3) consulte sempre o candidato no DivulgaCandContas 2024 e capture todo telefone/e-mail que ainda esteja publicamente exibido; (4) pesquise sempre no Google por NOME + PREFEITO ou VEREADOR + MUNICÍPIO e valide o Instagram no próprio perfil por nome, município e cargo. Informe o resultado das três frentes em researchChecks. Google é somente descoberta, não evidência final. Cadastre quando houver telefone/WhatsApp público ou Instagram validado; e-mail isolado deve ser descartado. Nunca use dado vazado, restrito, oculto ou inferido; registre uma fonte específica para cada contato.` }, queueEmpty: false };
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
  }

  async function registerCandidate(auth: McpAuthExtra, raw: unknown) {
    const input = registerCandidateSchema.parse(raw);
    const normalizedSources = normalizeRegisterCandidateSources(input.contact, input.sources);
    const requestFingerprint = createHash("sha256").update(JSON.stringify({ ...input, sources: normalizedSources })).digest("hex");
    return options.database.$transaction(async (transaction) => {
      const researchPrincipal = await principal(transaction, auth, "open-dot-research");
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`politizai-target:${auth.workspaceId}:${input.targetId}`}, 0))`;
      const target = await transaction.prospectingResearchTarget.findFirst({ where: { id: input.targetId, workspaceId: auth.workspaceId } });
      const now = options.now();
      if (!target) fail("Alvo de pesquisa não encontrado.", "PROSPECTING_TARGET_NOT_FOUND", 404);
      if (target.status !== "CLAIMED" || target.leaseOwner !== input.leaseOwner || !target.leaseExpiresAt || target.leaseExpiresAt <= now) {
        const previousEvidence = target.lastEvidence && typeof target.lastEvidence === "object" && !Array.isArray(target.lastEvidence)
          ? target.lastEvidence as Record<string, unknown>
          : null;
        if (target.status === "INGESTED" && target.candidateId && previousEvidence?.requestFingerprint === requestFingerprint) {
          const candidate = await transaction.prospectCandidate.findFirst({ where: { id: target.candidateId, workspaceId: auth.workspaceId }, select: { id: true, fingerprint: true, status: true, revision: true } });
          if (candidate) return { candidate, duplicate: true, enriched: previousEvidence.enrichment === true };
        }
        fail("A concessão deste alvo expirou ou pertence a outra execução.", "PROSPECTING_TARGET_LEASE_INVALID");
      }
      const officialMandateSourceTypes = target.role === "MAYOR"
        ? new Set(["CITY_HALL", "OFFICIAL_GAZETTE"])
        : new Set(["CITY_COUNCIL", "OFFICIAL_GAZETTE"]);
      if (!normalizedSources.some((source) => (source.field === "role" || source.field === "mandate") && officialMandateSourceTypes.has(source.type))) {
        fail("O mandato atual exige fonte municipal oficial compatível com o cargo.", "PROSPECTING_MANDATE_SOURCE_REQUIRED", 400);
      }
      const submittedPhones = [input.contact.phone, input.contact.politicianPhone, input.contact.advisorPhone, input.contact.whatsapp]
        .flatMap((value) => {
          if (!value) return [];
          const normalized = normalizePhoneIdentity(value);
          return normalized.success ? [normalized] : [];
        });
      if (submittedPhones.length > 0) {
        const submittedPhoneValues = [...new Set(submittedPhones.map((phone) => phone.normalizedPhone))];
        const candidatesWithSameBase = await transaction.prospectCandidate.findMany({
          where: {
            workspaceId: auth.workspaceId,
            municipalityIbgeCode: target.municipalityIbgeCode,
            externalIdentityKey: { not: target.externalIdentityKey },
            OR: [
              { normalizedPhone: { in: submittedPhoneValues } },
              { normalizedPoliticianPhone: { in: submittedPhoneValues } },
              { normalizedAdvisorPhone: { in: submittedPhoneValues } },
              { normalizedWhatsapp: { in: submittedPhoneValues } },
            ],
          },
          select: {
            politicianName: true,
            phone: true,
            normalizedPhone: true,
            politicianPhone: true,
            normalizedPoliticianPhone: true,
            advisorPhone: true,
            normalizedAdvisorPhone: true,
            whatsapp: true,
            normalizedWhatsapp: true,
          },
        });
        const sameNumberForAnotherPolitician = candidatesWithSameBase.find((candidate) => {
          const existingPhones = [
            storedPhoneIdentity(candidate.phone, candidate.normalizedPhone),
            storedPhoneIdentity(candidate.politicianPhone, candidate.normalizedPoliticianPhone),
            storedPhoneIdentity(candidate.advisorPhone, candidate.normalizedAdvisorPhone),
            storedPhoneIdentity(candidate.whatsapp, candidate.normalizedWhatsapp),
          ].filter((phone): phone is NonNullable<typeof phone> => Boolean(phone));
          return submittedPhones.some((submitted) => existingPhones.some((existing) =>
            submitted.normalizedPhone === existing.normalizedPhone
            && (!submitted.extension || submitted.extension === existing.extension),
          ));
        });
        if (sameNumberForAnotherPolitician) {
          fail(`O telefone já está associado a ${sameNumberForAnotherPolitician.politicianName} no mesmo município e aparenta ser compartilhado. Reenvie sem esse telefone e conclua TSE/DivulgaCandContas e Instagram.`, "PROSPECTING_SHARED_OFFICE_PHONE", 400);
        }
      }
      if (target.candidateId) {
        const candidate = await transaction.prospectCandidate.findFirst({
          where: { id: target.candidateId, workspaceId: auth.workspaceId, externalIdentityKey: target.externalIdentityKey },
        });
        if (!candidate) fail("O candidato existente deste alvo não foi encontrado.", "PROSPECTING_ENRICHMENT_CANDIDATE_NOT_FOUND", 404);

        const normalizedOfficePhone = input.contact.phone ? normalizePhoneIdentity(input.contact.phone) : null;
        const normalizedPoliticianPhone = input.contact.politicianPhone ? normalizePhoneIdentity(input.contact.politicianPhone) : null;
        const normalizedAdvisorPhone = input.contact.advisorPhone ? normalizePhoneIdentity(input.contact.advisorPhone) : null;
        const normalizedWhatsapp = input.contact.whatsapp ? normalizePhoneIdentity(input.contact.whatsapp) : null;
        const incomingPhoneContacts = [
          normalizedOfficePhone?.success ? normalizedOfficePhone.identity : null,
          normalizedPoliticianPhone?.success ? normalizedPoliticianPhone.identity : null,
          normalizedAdvisorPhone?.success ? normalizedAdvisorPhone.identity : null,
          normalizedWhatsapp?.success ? normalizedWhatsapp.identity : null,
        ].filter((value): value is string => Boolean(value));
        const incomingUsableContacts = [
          normalizedOfficePhone?.success ? normalizedOfficePhone.normalizedPhone : null,
          normalizedPoliticianPhone?.success ? normalizedPoliticianPhone.normalizedPhone : null,
          normalizedAdvisorPhone?.success ? normalizedAdvisorPhone.normalizedPhone : null,
          normalizedWhatsapp?.success ? normalizedWhatsapp.normalizedPhone : null,
          input.contact.instagram ? normalizeInstagram(input.contact.instagram) : null,
        ].filter((value): value is string => Boolean(value));
        const currentUsableContacts = new Set([
          storedPhoneIdentity(candidate.phone, candidate.normalizedPhone)?.identity,
          storedPhoneIdentity(candidate.politicianPhone, candidate.normalizedPoliticianPhone)?.identity,
          storedPhoneIdentity(candidate.advisorPhone, candidate.normalizedAdvisorPhone)?.identity,
          storedPhoneIdentity(candidate.whatsapp, candidate.normalizedWhatsapp)?.identity,
          candidate.instagram ? normalizeInstagram(candidate.instagram) : null,
        ].filter((value): value is string => Boolean(value)));
        if (!incomingPhoneContacts.some((value) => !currentUsableContacts.has(value))) {
          fail("O enriquecimento precisa acrescentar ao menos um novo telefone individual ou WhatsApp.", "PROSPECTING_ENRICHMENT_NO_NEW_PHONE", 400);
        }

        const incomingEmails = [input.contact.email, input.contact.politicianEmail, input.contact.advisorEmail].filter((value): value is string => Boolean(value));
        const [blockedPoint, blockedEmail] = await Promise.all([
          transaction.contactPoint.findFirst({
            where: { workspaceId: auth.workspaceId, normalizedValue: { in: [...incomingUsableContacts, ...incomingEmails] }, doNotContact: true, deletedAt: null },
            select: { id: true },
          }),
          incomingEmails.length === 0 ? null : transaction.emailSuppression.findFirst({
            where: { workspaceId: auth.workspaceId, normalizedEmail: { in: incomingEmails }, action: "APPLIED" },
            orderBy: { effectiveAt: "desc" },
            select: { id: true },
          }),
        ]);
        if (blockedPoint || blockedEmail) fail("Um dos novos contatos está bloqueado para comunicação.", "PROSPECTING_ENRICHMENT_DO_NOT_CONTACT", 409);

        const mergedContact = {
          phone: input.contact.phone ?? candidate.phone,
          phoneScope: input.contact.phone ? input.contact.phoneScope ?? null : candidate.phoneScope,
          email: input.contact.email ?? candidate.email,
          emailScope: input.contact.email ? input.contact.emailScope ?? null : candidate.emailScope,
          politicianPhone: input.contact.politicianPhone ?? candidate.politicianPhone,
          politicianEmail: input.contact.politicianEmail ?? candidate.politicianEmail,
          advisorPhone: input.contact.advisorPhone ?? candidate.advisorPhone,
          advisorEmail: input.contact.advisorEmail ?? candidate.advisorEmail,
          whatsapp: input.contact.whatsapp ?? candidate.whatsapp,
          whatsappScope: input.contact.whatsapp ? input.contact.whatsappScope ?? null : candidate.whatsappScope,
          instagram: input.contact.instagram ?? candidate.instagram,
          instagramScope: input.contact.instagram ? input.contact.instagramScope ?? null : candidate.instagramScope,
        };
        const updatedFingerprint = JSON.stringify({
          identity: candidate.externalIdentityKey,
          role: candidate.role,
          term: candidate.mandate,
          municipality: candidate.municipalityIbgeCode,
          phone: normalizedOfficePhone?.success ? normalizedOfficePhone.identity : storedPhoneIdentity(candidate.phone, candidate.normalizedPhone)?.identity ?? candidate.normalizedPhone,
          email: mergedContact.email,
          politicianPhone: normalizedPoliticianPhone?.success ? normalizedPoliticianPhone.identity : storedPhoneIdentity(candidate.politicianPhone, candidate.normalizedPoliticianPhone)?.identity ?? candidate.normalizedPoliticianPhone,
          politicianEmail: mergedContact.politicianEmail,
          advisorPhone: normalizedAdvisorPhone?.success ? normalizedAdvisorPhone.identity : storedPhoneIdentity(candidate.advisorPhone, candidate.normalizedAdvisorPhone)?.identity ?? candidate.normalizedAdvisorPhone,
          advisorEmail: mergedContact.advisorEmail,
          whatsapp: normalizedWhatsapp?.success ? normalizedWhatsapp.identity : storedPhoneIdentity(candidate.whatsapp, candidate.normalizedWhatsapp)?.identity ?? candidate.normalizedWhatsapp,
          whatsappScope: mergedContact.whatsappScope,
          instagram: mergedContact.instagram,
          instagramScope: mergedContact.instagramScope,
        });
        const updated = await transaction.prospectCandidate.update({
          where: { id: candidate.id },
          data: {
            phone: mergedContact.phone,
            normalizedPhone: input.contact.phone ? normalizedOfficePhone?.success ? normalizedOfficePhone.normalizedPhone : candidate.normalizedPhone : candidate.normalizedPhone,
            phoneScope: mergedContact.phoneScope,
            email: mergedContact.email,
            normalizedEmail: mergedContact.email,
            emailScope: mergedContact.emailScope,
            politicianPhone: mergedContact.politicianPhone,
            normalizedPoliticianPhone: input.contact.politicianPhone ? normalizedPoliticianPhone?.success ? normalizedPoliticianPhone.normalizedPhone : candidate.normalizedPoliticianPhone : candidate.normalizedPoliticianPhone,
            politicianEmail: mergedContact.politicianEmail,
            normalizedPoliticianEmail: mergedContact.politicianEmail,
            advisorPhone: mergedContact.advisorPhone,
            normalizedAdvisorPhone: input.contact.advisorPhone ? normalizedAdvisorPhone?.success ? normalizedAdvisorPhone.normalizedPhone : candidate.normalizedAdvisorPhone : candidate.normalizedAdvisorPhone,
            advisorEmail: mergedContact.advisorEmail,
            normalizedAdvisorEmail: mergedContact.advisorEmail,
            whatsapp: mergedContact.whatsapp,
            normalizedWhatsapp: input.contact.whatsapp ? normalizedWhatsapp?.success ? normalizedWhatsapp.normalizedPhone : candidate.normalizedWhatsapp : candidate.normalizedWhatsapp,
            whatsappScope: mergedContact.whatsappScope,
            instagram: mergedContact.instagram,
            instagramScope: mergedContact.instagramScope,
            mandateVerifiedAt: new Date(input.politician.mandateVerifiedAt),
            fingerprint: createHash("sha256").update(updatedFingerprint).digest("hex"),
            revision: { increment: 1 },
          },
          select: { id: true, status: true, revision: true, fingerprint: true, leadId: true },
        });
        for (const source of normalizedSources) {
          const canonicalUrl = new URL(source.url);
          canonicalUrl.hash = "";
          canonicalUrl.hostname = canonicalUrl.hostname.toLowerCase();
          if (canonicalUrl.pathname !== "/") canonicalUrl.pathname = canonicalUrl.pathname.replace(/\/$/, "");
          const canonicalUrlValue = canonicalUrl.toString();
          const sourceData = {
            sourceUrl: source.url,
            sourceDomain: canonicalUrl.hostname,
            sourceType: source.type,
            contactScope: source.contactScope ?? null,
            originalValue: source.originalValue ?? null,
            normalizedValue: source.normalizedValue ?? null,
            validationMethod: source.validationMethod,
            validationStatus: "VALID" as const,
            evidenceHash: createHash("sha256").update(JSON.stringify({ field: source.field, url: canonicalUrlValue, value: source.normalizedValue ?? source.originalValue ?? null })).digest("hex"),
            observedAt: new Date(source.observedAt),
            agentVersion: AGENT_VERSION,
            promptVersion: PROMPT_VERSION,
          };
          await transaction.prospectCandidateSource.upsert({
            where: { workspaceId_candidateId_field_canonicalUrl: { workspaceId: auth.workspaceId, candidateId: candidate.id, field: source.field, canonicalUrl: canonicalUrlValue } },
            create: { workspaceId: auth.workspaceId, candidateId: candidate.id, field: source.field, canonicalUrl: canonicalUrlValue, ...sourceData },
            update: sourceData,
          });
        }
        if (updated.leadId) {
          const lead = await transaction.lead.findFirst({
            where: { id: updated.leadId, workspaceId: auth.workspaceId, deletedAt: null },
            select: { contactId: true, contactPreference: true },
          });
          if (lead?.contactId) {
            const points = [
              input.contact.phone && normalizedOfficePhone?.success ? { type: "PHONE" as const, originalValue: input.contact.phone, normalizedValue: normalizedOfficePhone.normalizedPhone, label: phoneContactLabel("Gabinete", input.contact.phone), hasExtension: Boolean(normalizedOfficePhone.extension) } : null,
              input.contact.politicianPhone && normalizedPoliticianPhone?.success ? { type: "PHONE" as const, originalValue: input.contact.politicianPhone, normalizedValue: normalizedPoliticianPhone.normalizedPhone, label: phoneContactLabel("Direto", input.contact.politicianPhone), hasExtension: Boolean(normalizedPoliticianPhone.extension) } : null,
              input.contact.advisorPhone && normalizedAdvisorPhone?.success ? { type: "PHONE" as const, originalValue: input.contact.advisorPhone, normalizedValue: normalizedAdvisorPhone.normalizedPhone, label: phoneContactLabel("Assessoria", input.contact.advisorPhone), hasExtension: Boolean(normalizedAdvisorPhone.extension) } : null,
              input.contact.whatsapp && normalizedWhatsapp?.success && input.contact.whatsappScope ? { type: "PHONE" as const, originalValue: input.contact.whatsapp, normalizedValue: normalizedWhatsapp.normalizedPhone, label: phoneContactLabel(`WhatsApp · ${contactScopeLabel(input.contact.whatsappScope)}`, input.contact.whatsapp), hasExtension: Boolean(normalizedWhatsapp.extension) } : null,
              input.contact.whatsapp && normalizedWhatsapp?.success && input.contact.whatsappScope ? { type: "WHATSAPP" as const, originalValue: input.contact.whatsapp, normalizedValue: normalizedWhatsapp.normalizedPhone, label: contactScopeLabel(input.contact.whatsappScope), hasExtension: Boolean(normalizedWhatsapp.extension) } : null,
              input.contact.instagram && input.contact.instagramScope ? { type: "INSTAGRAM" as const, originalValue: input.contact.instagram, normalizedValue: normalizeInstagram(input.contact.instagram), label: contactScopeLabel(input.contact.instagramScope), hasExtension: false } : null,
              input.contact.email ? { type: "EMAIL" as const, originalValue: input.contact.email, normalizedValue: input.contact.email, label: "Gabinete", hasExtension: false } : null,
              input.contact.politicianEmail ? { type: "EMAIL" as const, originalValue: input.contact.politicianEmail, normalizedValue: input.contact.politicianEmail, label: "Direto", hasExtension: false } : null,
              input.contact.advisorEmail ? { type: "EMAIL" as const, originalValue: input.contact.advisorEmail, normalizedValue: input.contact.advisorEmail, label: "Assessoria", hasExtension: false } : null,
            ].filter((point): point is NonNullable<typeof point> => Boolean(point));
            for (const point of points) {
              const existingPoint = await transaction.contactPoint.findFirst({
                where: {
                  workspaceId: auth.workspaceId,
                  contactId: lead.contactId,
                  type: point.type,
                  normalizedValue: point.normalizedValue,
                  deletedAt: null,
                },
                select: { id: true, label: true, originalValue: true },
              });
              if (existingPoint) {
                await transaction.contactPoint.update({
                  where: { id: existingPoint.id },
                  data: {
                    originalValue: point.hasExtension ? point.originalValue : existingPoint.originalValue,
                    label: point.hasExtension ? point.label : existingPoint.label ?? point.label,
                    verificationStatus: "VERIFIED",
                    quality: "VALID",
                    verifiedAt: new Date(input.politician.mandateVerifiedAt),
                    updatedByActorId: researchPrincipal.actorId,
                  },
                });
              } else {
                await transaction.contactPoint.create({ data: { workspaceId: auth.workspaceId, contactId: lead.contactId, type: point.type, originalValue: point.originalValue, normalizedValue: point.normalizedValue, label: point.label, isPrimary: false, verificationStatus: "VERIFIED", quality: "VALID", source: "LEAD_INTAKE", doNotContact: lead.contactPreference === "DO_NOT_CONTACT", verifiedAt: new Date(input.politician.mandateVerifiedAt), createdByActorId: researchPrincipal.actorId, updatedByActorId: researchPrincipal.actorId } });
              }
            }
          }
        }
        await transaction.prospectingResearchTarget.update({
          where: { id: target.id },
          data: { status: "INGESTED", leaseOwner: null, leaseExpiresAt: null, completedAt: now, lastEvidence: asJson({ sourceCount: normalizedSources.length, researchChecks: input.researchChecks, enrichment: true, requestFingerprint }) },
        });
        await transaction.auditLog.create({
          data: { workspaceId: auth.workspaceId, actorId: researchPrincipal.actorId, action: "prospecting.candidate.enriched", origin: "API", entityType: "ProspectCandidate", entityId: candidate.id, changes: { revision: { from: candidate.revision, to: updated.revision } }, metadata: { targetId: target.id, addedUsableContacts: incomingPhoneContacts.filter((value) => !currentUsableContacts.has(value)), sourceCount: normalizedSources.length, leadSynchronized: Boolean(updated.leadId) } },
        });
        return { candidate: { id: updated.id, fingerprint: updated.fingerprint, status: updated.status, revision: updated.revision }, duplicate: false, enriched: true };
      }
      const result = await staging.ingestCandidate(transaction, researchPrincipal, {
        schemaVersion: PROSPECTING_CONTRACT_VERSION,
        idempotencyKey: `dot-target-${target.id}`,
        batchId: target.batchId,
        externalIdentityKey: target.externalIdentityKey,
        politician: { name: target.politicianName, role: target.role, term: "2025-2028", ...input.politician },
        municipality: { ibgeCode: target.municipalityIbgeCode, name: target.municipalityName, stateCode: target.stateCode, population: target.population, populationEdition: PROSPECTING_SOURCE_SNAPSHOTS.population.edition },
        contact: input.contact,
        sources: [
          { field: "role", type: "TSE", url: PROSPECTING_SOURCE_SNAPSHOTS.election.url, observedAt: PROSPECTING_SOURCE_SNAPSHOTS.election.observedAt, originalValue: target.tseCandidateId, validationMethod: "TSE_RESULTADOS_2024_SQ_CANDIDATO" },
          { field: "population", type: "IBGE", url: PROSPECTING_SOURCE_SNAPSHOTS.population.url, observedAt: PROSPECTING_SOURCE_SNAPSHOTS.population.observedAt, originalValue: String(target.population), normalizedValue: String(target.population), validationMethod: "IBGE_ESTIMATIVA_2026_CODIGO_MUNICIPIO" },
          ...normalizedSources,
        ],
        agentVersion: AGENT_VERSION,
        promptVersion: PROMPT_VERSION,
      });
      await transaction.prospectingResearchTarget.update({
        where: { id: target.id },
        data: { status: result.candidate.status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "INGESTED", candidateId: result.candidate.id, leaseOwner: null, leaseExpiresAt: null, completedAt: now, lastEvidence: asJson({ sourceCount: normalizedSources.length + 2, researchChecks: input.researchChecks, requestFingerprint }) },
      });
      return result;
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 30_000 });
  }

  async function markInconclusive(auth: McpAuthExtra, raw: unknown) {
    const input = inconclusiveTargetSchema.parse(raw);
    return options.database.$transaction(async (transaction) => {
      const actor = await principal(transaction, auth, "open-dot-research");
      const target = await transaction.prospectingResearchTarget.findFirst({ where: { id: input.targetId, workspaceId: auth.workspaceId } });
      const now = options.now();
      if (!target) fail("Alvo de pesquisa não encontrado.", "PROSPECTING_TARGET_NOT_FOUND", 404);
      if (target.status !== "CLAIMED" || target.leaseOwner !== input.leaseOwner || !target.leaseExpiresAt || target.leaseExpiresAt <= now) fail("A concessão deste alvo expirou ou pertence a outra execução.", "PROSPECTING_TARGET_LEASE_INVALID");
      const updated = await transaction.prospectingResearchTarget.update({ where: { id: target.id }, data: { status: "SKIPPED", lastReasonCode: input.reasonCode, lastEvidence: asJson(input.evidence), leaseOwner: null, leaseExpiresAt: null, completedAt: now } });
      await transaction.auditLog.create({ data: { workspaceId: auth.workspaceId, actorId: actor.actorId, action: "prospecting.target.inconclusive", origin: "API", entityType: "ProspectingResearchTarget", entityId: target.id, changes: { status: { from: "CLAIMED", to: "SKIPPED" } }, metadata: { reasonCode: input.reasonCode, evidenceCount: input.evidence.length } } });
      return { target: { id: updated.id, status: updated.status, reasonCode: updated.lastReasonCode } };
    });
  }

  async function getBatch(auth: McpAuthExtra, batchId?: string) {
    return options.database.$transaction(async (transaction) => {
      const researchPrincipal = await principal(transaction, auth, "open-dot-research");
      const resolvedBatchId = batchId ?? (await transaction.prospectingResearchBatch.findFirst({
        where: { workspaceId: auth.workspaceId, status: { in: ["DRAFT", "RUNNING"] } },
        orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
        select: { id: true },
      }))?.id;
      if (!resolvedBatchId) fail("Nenhum lote de pesquisa ativo foi encontrado.", "PROSPECTING_BATCH_NOT_FOUND", 404);
      const [batch, targets, reviews] = await Promise.all([
        staging.getResearchBatch(transaction, researchPrincipal, resolvedBatchId),
        transaction.prospectingResearchTarget.groupBy({ by: ["status"], where: { workspaceId: auth.workspaceId, batchId: resolvedBatchId }, _count: { _all: true } }),
        transaction.prospectCandidate.findMany({ where: { workspaceId: auth.workspaceId, batchId: resolvedBatchId, status: "REVIEW_REQUIRED" }, select: { id: true, politicianName: true, role: true, municipalityName: true, stateCode: true, revision: true, reviewReasonCode: true }, take: 25, orderBy: { createdAt: "asc" } }),
      ]);
      const reviewSources = reviews.length === 0 ? [] : await transaction.prospectCandidateSource.findMany({
        where: { workspaceId: auth.workspaceId, candidateId: { in: reviews.map((candidate) => candidate.id) } },
        select: { id: true, candidateId: true, field: true, sourceUrl: true, sourceType: true, validationStatus: true, observedAt: true },
        orderBy: [{ observedAt: "desc" }, { id: "asc" }],
      });
      return {
        ...batch,
        targetsByStatus: Object.fromEntries(targets.map((item) => [item.status, item._count._all])),
        reviewQueue: reviews.map((candidate) => ({
          ...candidate,
          sources: reviewSources.filter((source) => source.candidateId === candidate.id).map((source) => ({
            id: source.id,
            field: source.field,
            sourceUrl: source.sourceUrl,
            sourceType: source.sourceType,
            validationStatus: source.validationStatus,
            observedAt: source.observedAt,
          })),
        })),
      };
    });
  }

  async function reviewCandidate(auth: McpAuthExtra, candidateId: string, input: unknown) {
    return options.database.$transaction(async (transaction) => {
      const auditor = await principal(transaction, auth, "open-dot-auditor");
      const result = await staging.reviewCandidate(transaction, auditor, candidateId, input);
      await transaction.prospectingResearchTarget.updateMany({ where: { workspaceId: auth.workspaceId, candidateId }, data: { status: result.candidate.status === "REVIEW_REQUIRED" ? "REVIEW_REQUIRED" : "INGESTED", lastReasonCode: result.candidate.status === "READY" ? null : "AUDITOR_DECISION", completedAt: options.now() } });
      return result;
    });
  }

  async function completeBatch(auth: McpAuthExtra, batchId: string, status: "COMPLETED" | "CANCELLED" | "FAILED") {
    return options.database.$transaction(async (transaction) => {
      const researchPrincipal = await principal(transaction, auth, "open-dot-research");
      if (status === "COMPLETED") {
        const pending = await transaction.prospectingResearchTarget.count({ where: { workspaceId: auth.workspaceId, batchId, status: { in: ["PENDING", "CLAIMED", "REVIEW_REQUIRED"] } } });
        if (pending > 0) fail(`O lote ainda possui ${pending} alvo(s) pendente(s).`, "PROSPECTING_BATCH_TARGETS_PENDING");
      }
      return staging.completeResearchBatch(transaction, researchPrincipal, batchId, { status });
    }, { isolationLevel: "Serializable", maxWait: 10_000, timeout: 20_000 });
  }

  return Object.freeze({ getContext, openBatch, claimNextTarget, registerCandidate, markInconclusive, getBatch, reviewCandidate, completeBatch });
}

let singleton: ReturnType<typeof createPolitizaiMcpProspectingService> | undefined;
export function getPolitizaiMcpProspectingService() {
  singleton ??= createPolitizaiMcpProspectingService({ database: getDatabaseClient(), now: () => new Date() });
  return singleton;
}
