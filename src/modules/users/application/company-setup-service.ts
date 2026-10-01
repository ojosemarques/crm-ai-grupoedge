import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { companySetupCommandSchema, type CompanySetupScreen, type CompanySetupStep, type CompanySetupStepKey } from "@/modules/users/domain/company-setup-contracts";
import { defaultRoleDefinitions } from "@/modules/users/permissions/default-role-definitions";
import { createAuthorizationService, getAuthorizationService } from "@/modules/users/permissions/authorization-service";
import { PermissionKeys } from "@/modules/users/permissions/permission-keys";
import { getDatabaseClient } from "@/shared/core/database/client";

const auditAction = "company.setup.step_state_changed";
const skippable = new Set<CompanySetupStepKey>(["TEAM", "INTEGRATIONS"]);

type SetupServiceOptions = Readonly<{
  database: PrismaClient;
  authorization: ReturnType<typeof createAuthorizationService>;
}>;

function metadataObject(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function createCompanySetupService(options: SetupServiceOptions) {
  async function authorize(context: AuthenticatedContext) {
    await options.authorization.assertAuthorized(context, PermissionKeys.WORKSPACE_MANAGE, {
      workspaceId: context.workspaceId,
      resourceType: "WorkspaceSetup",
      resourceId: context.workspaceId,
    });
  }

  async function screen(context: AuthenticatedContext): Promise<CompanySetupScreen> {
    await authorize(context);
    const workspaceId = context.workspaceId;
    const [workspace, members, roles, pipelines, stages, categories, publishedGoals, integrations, decisions] = await Promise.all([
      options.database.workspace.findFirstOrThrow({ where: { id: workspaceId, status: "ACTIVE", deletedAt: null }, select: { id: true, name: true, slug: true, timeZone: true } }),
      options.database.workspaceMember.count({ where: { workspaceId, status: "ACTIVE", deletedAt: null, user: { status: "ACTIVE", deletedAt: null } } }),
      options.database.role.findMany({ where: { workspaceId, deletedAt: null }, select: { key: true, _count: { select: { permissions: true } } } }),
      options.database.pipeline.count({ where: { workspaceId, deletedAt: null } }),
      options.database.pipelineStage.count({ where: { workspaceId, deletedAt: null, pipeline: { deletedAt: null } } }),
      options.database.financialCategory.count({ where: { workspaceId, active: true } }),
      options.database.goalPlan.count({ where: { workspaceId, status: "PUBLISHED" } }),
      options.database.integrationConnection.count({ where: { workspaceId, enabled: true, disabledAt: null, status: { in: ["ACTIVE_LOCAL", "CONNECTED", "SYNCING"] } } }),
      options.database.auditLog.findMany({ where: { workspaceId, action: auditAction, entityType: "Workspace", entityId: workspaceId }, select: { metadata: true }, orderBy: { occurredAt: "desc" }, take: 30 }),
    ]);

    const latestDecision = new Map<CompanySetupStepKey, string>();
    for (const decision of decisions) {
      const metadata = metadataObject(decision.metadata);
      const key = metadata.stepKey;
      if ((key === "TEAM" || key === "INTEGRATIONS") && !latestDecision.has(key)) latestDecision.set(key, String(metadata.state));
    }
    const roleGrants = new Map(roles.map(role => [role.key, role._count.permissions]));
    const permissionsReady = defaultRoleDefinitions.every(role => (roleGrants.get(role.key) ?? 0) > 0);
    const state = (key: CompanySetupStepKey, ready: boolean, optional = false) => {
      if (ready) return "READY" as const;
      if (skippable.has(key) && latestDecision.get(key) === "SKIPPED") return "SKIPPED" as const;
      return optional ? "OPTIONAL" as const : "ACTION_REQUIRED" as const;
    };
    const steps: CompanySetupStep[] = [
      { key: "TEAM", title: "Equipe", description: "Convide vendedores, SDRs e gestores e defina quem trabalha em cada função.", detail: members > 1 ? `${members} pessoas ativas na empresa.` : "Você é a única pessoa ativa. Convide a equipe ou confirme que começará sozinho.", href: "/administracao", actionLabel: "Configurar equipe", state: state("TEAM", members > 1), optional: false, canSkip: true },
      { key: "PERMISSIONS", title: "Permissões", description: "Revise os papéis de administrador, gestor, SDR, vendedor e pós-venda.", detail: permissionsReady ? `${defaultRoleDefinitions.length} papéis padrão estão prontos para uso.` : "Os papéis padrão precisam ser revisados.", href: "/administracao", actionLabel: "Revisar permissões", state: state("PERMISSIONS", permissionsReady), optional: false, canSkip: false },
      { key: "PIPELINE", title: "Pipelines", description: "Ajuste as etapas de pré-vendas e vendas para refletir seu processo comercial.", detail: pipelines >= 2 && stages > 0 ? `${pipelines} pipelines e ${stages} etapas disponíveis.` : "Configure ao menos os funis de pré-vendas e vendas.", href: "/configuracoes", actionLabel: "Ajustar pipelines", state: state("PIPELINE", pipelines >= 2 && stages > 0), optional: false, canSkip: false },
      { key: "CATEGORIES", title: "Categorias financeiras", description: "Organize receitas, despesas e linhas da DRE desde o primeiro lançamento.", detail: categories > 0 ? `${categories} categorias financeiras ativas.` : "Crie as categorias usadas pelo financeiro.", href: "/financeiro?section=categorias", actionLabel: "Revisar categorias", state: state("CATEGORIES", categories > 0), optional: false, canSkip: false },
      { key: "GOALS", title: "Metas", description: "Publique um plano com objetivos para a equipe e acompanhe o progresso diário.", detail: publishedGoals > 0 ? `${publishedGoals} plano${publishedGoals > 1 ? "s" : ""} de metas publicado${publishedGoals > 1 ? "s" : ""}.` : "Nenhum plano de metas foi publicado.", href: "/metas", actionLabel: "Definir metas", state: state("GOALS", publishedGoals > 0), optional: false, canSkip: false },
      { key: "INTEGRATIONS", title: "Integrações", description: "Conecte WhatsApp, e-mail, agenda e outros canais quando sua operação precisar.", detail: integrations > 0 ? `${integrations} ${integrations > 1 ? "integrações ativas" : "integração ativa"}.` : "Você pode operar o CRM agora e conectar canais depois.", href: "/integracoes", actionLabel: "Conectar canais", state: state("INTEGRATIONS", integrations > 0, true), optional: true, canSkip: true },
    ];
    const completed = steps.filter(step => step.state === "READY" || step.state === "SKIPPED");
    const requiredComplete = steps.filter(step => !step.optional).every(step => step.state === "READY" || step.state === "SKIPPED");
    const next = steps.find(step => !step.optional && step.state === "ACTION_REQUIRED") ?? steps.find(step => step.state === "OPTIONAL");
    return { workspace, steps, completedCount: completed.length, totalCount: steps.length, progressPercent: Math.round(completed.length / steps.length * 100), requiredComplete, nextStepKey: next?.key ?? null };
  }

  async function execute(context: AuthenticatedContext, raw: unknown) {
    const input = companySetupCommandSchema.parse(raw);
    await authorize(context);
    await options.database.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`company-setup:${context.workspaceId}:${input.stepKey}`}))`;
      const replay = await tx.auditLog.findFirst({ where: { workspaceId: context.workspaceId, action: auditAction, metadata: { path: ["idempotencyKey"], equals: input.idempotencyKey } } });
      if (!replay) await tx.auditLog.create({ data: { workspaceId: context.workspaceId, actorId: context.actorId, action: auditAction, entityType: "Workspace", entityId: context.workspaceId, origin: "API", changes: { state: input.state }, metadata: { stepKey: input.stepKey, state: input.state, idempotencyKey: input.idempotencyKey } } });
    });
    return screen(context);
  }

  return Object.freeze({ screen, execute });
}

let singleton: ReturnType<typeof createCompanySetupService> | undefined;
export function getCompanySetupService() {
  singleton ??= createCompanySetupService({ database: getDatabaseClient(), authorization: getAuthorizationService() });
  return singleton;
}
