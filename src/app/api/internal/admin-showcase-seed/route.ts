import { timingSafeEqual } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import type { AuthenticatedContext } from "@/modules/auth/application/authenticated-context";
import { getOperationalHistoryService } from "@/modules/activities/application/operational-history-service";
import { getDailyGoalService } from "@/modules/goals/application/daily-goal-service";
import { getLeadDistributionService } from "@/modules/leads/application/lead-distribution-service";
import { getLeadEntryService } from "@/modules/leads/application/lead-entry-service";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { getPreSalesPipelineService } from "@/modules/pipelines/application/pre-sales-pipeline-service";
import { getPactoQualificationService } from "@/modules/qualification/application/pacto-qualification-service";
import { getDatabaseClient } from "@/shared/core/database/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const targetEmail = "ejosemarquess@gmail.com";
const demoEmail = "mariana.costa.demo@grupoedge.invalid";
const markerAction = "showcase.admin_seed.completed";

function authorized(request: NextRequest) {
  const expected = process.env.ADMIN_SHOWCASE_SEED_TOKEN;
  const received = request.headers.get("x-admin-showcase-token");
  if (!expected || !received) return false;
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

export async function POST(request: NextRequest) {
  if (
    process.env.APP_ENV !== "production" ||
    process.env.VERCEL_ENV !== "production" ||
    !authorized(request)
  ) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 404 });
  }

  const database = getDatabaseClient();
  const user = await database.user.findUnique({
    where: { normalizedEmail: targetEmail },
    select: {
      id: true,
      displayName: true,
      status: true,
      memberships: {
        where: { status: "ACTIVE", deletedAt: null, workspace: { status: "ACTIVE", deletedAt: null } },
        select: {
          id: true,
          workspaceId: true,
          roleId: true,
          workspace: { select: { slug: true, name: true } },
          role: { select: { key: true, name: true } },
        },
      },
      actors: { where: { type: "HUMAN" }, select: { id: true, workspaceId: true } },
    },
  });
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ error: "Conta administrativa ativa não encontrada." }, { status: 404 });
  }
  const membership =
    user.memberships.find((item) => item.workspace.slug === "politizai") ??
    (user.memberships.length === 1 ? user.memberships[0] : undefined);
  if (!membership) {
    return NextResponse.json({ error: "Workspace alvo não pôde ser determinado com segurança." }, { status: 409 });
  }
  const actor = user.actors.find((item) => item.workspaceId === membership.workspaceId);
  if (!actor) {
    return NextResponse.json({ error: "Ator humano da conta não encontrado." }, { status: 409 });
  }
  const context: AuthenticatedContext = {
    workspaceId: membership.workspaceId,
    workspaceSlug: membership.workspace.slug,
    sessionId: "production-admin-showcase-seed",
    userId: user.id,
    memberId: membership.id,
    actorId: actor.id,
    roleId: membership.roleId,
    roleKey: membership.role.key,
    roleName: membership.role.name,
    displayName: user.displayName,
    email: targetEmail,
    workspaceCount: user.memberships.length,
    workspaceName: membership.workspace.name,
  };
  const automationActor = await database.actor.findFirst({
    where: { workspaceId: context.workspaceId, type: "AUTOMATION", userId: null },
    select: { id: true },
  });
  if (!automationActor) {
    await database.actor.create({
      data: {
        workspaceId: context.workspaceId,
        type: "AUTOMATION",
        key: "automation:production",
        displayName: "Automação do CRM",
      },
    });
  }

  let lead = await database.lead.findFirst({
    where: { workspaceId: context.workspaceId, normalizedEmail: demoEmail, deletedAt: null },
    select: { id: true },
  });
  if (!lead) {
    const created = await getLeadEntryService().createManual(
      {
        idempotencyKey: "admin-showcase-mariana-costa-2026-10-02-v1",
        lead: {
          fullName: "Mariana Costa",
          phone: "+55 11 90000-0202",
          email: demoEmail,
          jobTitle: "Candidata a deputada estadual",
          organizationName: "Mandato Mariana Costa",
          city: "São Paulo",
          stateCode: "SP",
          interestSummary:
            "Estruturar pré-campanha, organizar base de apoiadores, profissionalizar comunicação digital e acompanhar intenção de voto por região.",
          budgetBrl: "18000,00",
          sourceKey: "manual",
          consent: true,
          priorityBandCode: "P1",
        },
      },
      context,
    );
    if (created.outcome === "REJECTED") {
      return NextResponse.json({ error: "Falha ao criar lead demonstrativo.", details: created.issues }, { status: 409 });
    }
    lead = { id: created.leadId };
  }

  const leadId = lead.id;
  const memberFunctions = await database.teamMember.findMany({
    where: {
      workspaceId: context.workspaceId,
      workspaceMemberId: context.memberId,
      deletedAt: null,
    },
    select: { function: true, teamId: true },
  });
  let sdrTeamId = memberFunctions.find((item) => item.function === "SDR")?.teamId;
  let closerTeamId = memberFunctions.find((item) => item.function === "CLOSER")?.teamId;
  if (!sdrTeamId || !closerTeamId) {
    await database.$transaction(async (transaction) => {
      async function ensureFunction(teamName: string, teamFunction: "SDR" | "CLOSER") {
        const existingMembership = await transaction.teamMember.findFirst({
          where: {
            workspaceId: context.workspaceId,
            workspaceMemberId: context.memberId,
            function: teamFunction,
            deletedAt: null,
          },
          select: { teamId: true },
        });
        if (existingMembership) return existingMembership.teamId;
        let team = await transaction.team.findFirst({
          where: { workspaceId: context.workspaceId, name: teamName, deletedAt: null },
          select: { id: true },
        });
        if (!team) {
          team = await transaction.team.create({
            data: {
              workspaceId: context.workspaceId,
              name: teamName,
              description: "Equipe operacional configurada para o cenário demonstrativo autorizado.",
              createdByActorId: context.actorId,
              updatedByActorId: context.actorId,
            },
            select: { id: true },
          });
        }
        const archived = await transaction.teamMember.findFirst({
          where: { workspaceId: context.workspaceId, teamId: team.id, workspaceMemberId: context.memberId },
          select: { id: true },
        });
        if (archived) {
          await transaction.teamMember.update({
            where: { id: archived.id },
            data: { function: teamFunction, deletedAt: null, updatedByActorId: context.actorId },
          });
        } else {
          await transaction.teamMember.create({
            data: {
              workspaceId: context.workspaceId,
              teamId: team.id,
              workspaceMemberId: context.memberId,
              function: teamFunction,
              createdByActorId: context.actorId,
              updatedByActorId: context.actorId,
            },
          });
        }
        return team.id;
      }
      sdrTeamId = await ensureFunction("Pré-vendas", "SDR");
      closerTeamId = await ensureFunction("Vendas", "CLOSER");
      const generalQueue = await transaction.queue.findFirst({
        where: { workspaceId: context.workspaceId, isGeneral: true, deletedAt: null },
        select: { id: true, teamId: true },
      });
      if (!generalQueue) throw new Error("Fila Geral não encontrada após a criação do lead.");
      if (!generalQueue.teamId) {
        await transaction.queue.update({
          where: { id: generalQueue.id },
          data: { teamId: sdrTeamId, updatedByActorId: context.actorId },
        });
      }
    });
  } else {
    const generalQueue = await database.queue.findFirst({
      where: { workspaceId: context.workspaceId, isGeneral: true, deletedAt: null },
      select: { id: true, teamId: true },
    });
    if (generalQueue && !generalQueue.teamId) {
      await database.queue.update({
        where: { id: generalQueue.id },
        data: { teamId: sdrTeamId, updatedByActorId: context.actorId },
      });
    }
  }
  const currentOwner = await database.lead.findUniqueOrThrow({ where: { id: leadId }, select: { ownerMemberId: true } });
  if (currentOwner.ownerMemberId !== context.memberId) {
    await getLeadDistributionService().redistribute(context, {
      leadId,
      target: { type: "MEMBER", memberId: context.memberId },
      reason: "Lead demonstrativo atribuído exclusivamente à conta administrativa solicitada.",
    });
  }

  const history = getOperationalHistoryService();
  const slaCycle = await database.leadSlaCycle.findFirstOrThrow({
    where: { workspaceId: context.workspaceId, leadId },
    orderBy: { receivedAt: "asc" },
    select: { receivedAt: true },
  });
  const activityTime = (offsetSeconds: number) =>
    new Date(slaCycle.receivedAt.getTime() + offsetSeconds * 1_000);
  const activitySpecs = [
    {
      subject: "Ligação de descoberta realizada",
      type: "CALL_CONNECTED" as const,
      result: "CONNECTED" as const,
      direction: "OUTBOUND" as const,
      occurredAt: activityTime(1),
      durationSeconds: 740,
      observation:
        "Mariana confirmou interesse em organizar a operação digital da pré-campanha. A principal dor é a falta de visão única sobre apoiadores, agenda e desempenho por região.",
      nextTask: {
        title: "Preparar diagnóstico para a reunião",
        description: "Consolidar canais atuais, metas de captação e proposta inicial antes da reunião.",
        kind: "FOLLOW_UP" as const,
        priority: "HIGH" as const,
        dueAt: new Date("2026-10-02T16:30:00.000Z"),
      },
    },
    {
      subject: "Resumo enviado pelo WhatsApp",
      type: "MESSAGE_SENT" as const,
      result: "SENT" as const,
      direction: "OUTBOUND" as const,
      occurredAt: activityTime(2),
      observation:
        "Enviado resumo do diagnóstico, confirmação dos participantes e pedido dos dados dos canais digitais atuais.",
    },
    {
      subject: "E-mail com pauta da reunião enviado",
      type: "EMAIL" as const,
      result: "SENT" as const,
      direction: "OUTBOUND" as const,
      occurredAt: activityTime(3),
      observation:
        "Pauta enviada: cenário político, metas da pré-campanha, equipe envolvida, investimento disponível e próximos passos.",
    },
  ];
  for (const spec of activitySpecs) {
    const exists = await database.activity.findFirst({
      where: { workspaceId: context.workspaceId, leadId, subject: spec.subject },
      select: { id: true },
    });
    if (!exists) await history.recordActivity(context, { leadId, ...spec });
  }

  const noteBody =
    "Cenário demonstrativo: equipe de 6 pessoas; pré-campanha em organização; prioridade em captação de apoiadores, segmentação municipal e cadência de relacionamento. Decisão final com a candidata e o coordenador-geral.";
  const existingNote = await database.note.findFirst({
    where: { workspaceId: context.workspaceId, leadId, body: noteBody, deletedAt: null },
    select: { id: true },
  });
  if (!existingNote) {
    await database.note.create({
      data: {
        workspaceId: context.workspaceId,
        leadId,
        body: noteBody,
        createdByActorId: context.actorId,
        updatedByActorId: context.actorId,
      },
    });
  }

  const qualification = await database.leadQualification.findUnique({
    where: { workspaceId_leadId: { workspaceId: context.workspaceId, leadId } },
    select: { status: true, revision: true },
  });
  if (qualification?.status !== "COMPLETED") {
    await getPactoQualificationService().validate(context, {
      leadId,
      expectedRevision: qualification?.revision ?? 0,
      dimensions: [
        { dimension: "POLITICAL_CONTEXT", status: "POSITIVE", origin: "SDR", evidence: "Pré-candidatura estadual em fase de estruturação, com equipe própria e atuação concentrada na capital e região metropolitana.", note: "Contexto político mapeado na ligação de descoberta." },
        { dimension: "AFFLICTION", status: "POSITIVE", origin: "SDR", evidence: "Informações de apoiadores estão dispersas em planilhas e WhatsApp, sem rotina clara de acompanhamento.", note: "Dor com impacto operacional e perda de velocidade." },
        { dimension: "CAPACITY", status: "POSITIVE", origin: "SDR", evidence: "Faixa de investimento declarada de R$ 18 mil por mês para tecnologia, operação e comunicação.", note: "Orçamento compatível com o escopo inicial." },
        { dimension: "DECISION", status: "POSITIVE", origin: "SDR", evidence: "A candidata decide em conjunto com o coordenador-geral; ambos participarão da reunião.", note: "Processo decisório e influenciadores identificados." },
        { dimension: "OPPORTUNITY_NOW", status: "POSITIVE", origin: "SDR", evidence: "Objetivo de iniciar a operação ainda em outubro para preparar a base antes do próximo ciclo de mobilização.", note: "Janela de decisão ativa e prazo confirmado." },
      ],
    });
  }

  const refreshedLead = await database.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { pipelineId: true, currentStage: { select: { leadStageCode: true } }, updatedAt: true },
  });
  if (refreshedLead.currentStage.leadStageCode !== "QUALIFIED" && refreshedLead.currentStage.leadStageCode !== "MEETING_SCHEDULED") {
    const qualifiedStage = await database.pipelineStage.findFirstOrThrow({
      where: { workspaceId: context.workspaceId, pipelineId: refreshedLead.pipelineId, leadStageCode: "QUALIFIED", deletedAt: null },
      select: { id: true },
    });
    await getPreSalesPipelineService().transition(context, {
      leadId,
      targetStageId: qualifiedStage.id,
      expectedUpdatedAt: refreshedLead.updatedAt,
      reason: "Qualificação PACTO concluída no cenário demonstrativo.",
      origin: "LEAD_CARD",
      managerCorrection: true,
      confirmed: true,
    });
  }

  const activeMeeting = await database.meeting.findFirst({
    where: { workspaceId: context.workspaceId, leadId, status: { in: ["SCHEDULED", "CONFIRMED"] }, deletedAt: null },
    select: { id: true, startsAt: true, ownerMemberId: true },
  });
  let meeting = activeMeeting;
  if (!meeting) {
    const closer = await database.workspaceMember.findFirst({
      where: {
        workspaceId: context.workspaceId,
        status: "ACTIVE",
        deletedAt: null,
        id: context.memberId,
        teamMemberships: { some: { function: "CLOSER", deletedAt: null } },
      },
      select: { id: true },
    }) ?? await database.workspaceMember.findFirst({
      where: {
        workspaceId: context.workspaceId,
        status: "ACTIVE",
        deletedAt: null,
        teamMemberships: { some: { function: "CLOSER", deletedAt: null } },
      },
      orderBy: { joinedAt: "asc" },
      select: { id: true },
    });
    if (!closer) return NextResponse.json({ error: "Nenhum closer ativo está configurado." }, { status: 409 });
    const candidateTimes = ["15:00", "16:00", "17:00"];
    let startsAtLocal: string | undefined;
    for (const time of candidateTimes) {
      const startsAt = new Date(`2026-10-02T${time}:00-03:00`);
      const endsAt = new Date(startsAt.getTime() + 40 * 60_000);
      const conflict = await database.meeting.findFirst({
        where: { workspaceId: context.workspaceId, ownerMemberId: closer.id, status: { in: ["SCHEDULED", "CONFIRMED"] }, deletedAt: null, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } },
        select: { id: true },
      });
      if (!conflict) { startsAtLocal = `2026-10-02T${time}`; break; }
    }
    if (!startsAtLocal) return NextResponse.json({ error: "Não há horário livre entre 15h e 18h em 02/10/2026." }, { status: 409 });
    const scheduled = await getMeetingService().schedule(context, {
      leadId,
      closerId: closer.id,
      title: "Diagnóstico estratégico da pré-campanha",
      startsAtLocal,
      durationMinutes: 40,
      observation:
        "Reunião demonstrativa. Pauta: cenário atual, metas da pré-campanha, organização da base, canais de aquisição, cronograma de implantação e próximos passos. Participantes: Mariana Costa, coordenador-geral e consultor comercial.",
    });
    meeting = {
      id: scheduled.meetingId,
      startsAt: new Date(`${startsAtLocal}:00-03:00`),
      ownerMemberId: closer.id,
    };
  }

  const currentGoals = await database.dailyGoalProfile.findUnique({
    where: { workspaceId_memberId: { workspaceId: context.workspaceId, memberId: context.memberId } },
    select: { revision: true },
  });
  await getDailyGoalService().save(context, {
    memberId: context.memberId,
    expectedRevision: currentGoals?.revision ?? null,
    callsTarget: 50,
    messagesTarget: 40,
    effectiveContactsTarget: 10,
    qualificationsTarget: 5,
    meetingsScheduledTarget: 3,
    proposalsTarget: 2,
    salesValueTargetCents: 5_000_000,
  });

  const marker = await database.auditLog.findFirst({
    where: { workspaceId: context.workspaceId, action: markerAction, entityType: "Lead", entityId: leadId },
    select: { id: true },
  });
  if (!marker) {
    await database.auditLog.create({
      data: {
        workspaceId: context.workspaceId,
        actorId: context.actorId,
        action: markerAction,
        entityType: "Lead",
        entityId: leadId,
        changes: { targetEmail, demoEmail, meetingId: meeting.id, requestedDate: "2026-10-02", simulation: true },
        metadata: { source: "authorized_production_showcase_seed", reversible: true },
      },
    });
  }

  const [activityCount, noteCount, taskCount, finalLead, finalGoals] = await Promise.all([
    database.activity.count({ where: { workspaceId: context.workspaceId, leadId } }),
    database.note.count({ where: { workspaceId: context.workspaceId, leadId, deletedAt: null } }),
    database.task.count({ where: { workspaceId: context.workspaceId, leadId, deletedAt: null } }),
    database.lead.findUniqueOrThrow({ where: { id: leadId }, select: { fullName: true, status: true, currentStage: { select: { name: true, leadStageCode: true } }, ownerMemberId: true } }),
    database.dailyGoalProfile.findUniqueOrThrow({ where: { workspaceId_memberId: { workspaceId: context.workspaceId, memberId: context.memberId } }, select: { callsTarget: true, messagesTarget: true, effectiveContactsTarget: true, qualificationsTarget: true, meetingsScheduledTarget: true, proposalsTarget: true, salesValueTargetCents: true } }),
  ]);
  return NextResponse.json({
    ok: true,
    workspace: membership.workspace.name,
    account: targetEmail,
    lead: { id: leadId, ...finalLead, activities: activityCount, notes: noteCount, tasks: taskCount },
    meeting: { id: meeting.id, startsAt: meeting.startsAt.toISOString(), ownerMemberId: meeting.ownerMemberId },
    dailyGoals: { ...finalGoals, salesValueTargetCents: finalGoals.salesValueTargetCents.toString() },
  });
}
