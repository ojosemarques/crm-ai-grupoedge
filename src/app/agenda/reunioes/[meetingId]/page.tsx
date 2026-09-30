import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { MeetingTranscriptPanel } from "@/app/agenda/reunioes/[meetingId]/meeting-transcript-panel";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader, Surface } from "@/components/ui/surface";
import { requirePageAuthentication } from "@/modules/auth/http/authentication-guards";
import { getMeetingService } from "@/modules/meetings/application/meeting-service";
import { pactoStatusLabels } from "@/modules/qualification/domain/pacto-contracts";
import { AccessDeniedError } from "@/modules/users/permissions/authorization-errors";
import { ApplicationError } from "@/shared/core/errors/application-error";

export const dynamic = "force-dynamic";

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}

function money(cents: number | null) {
  return cents === null ? "Não informado" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export default async function MeetingBriefingPage({ params }: Readonly<{ params: Promise<{ meetingId: string }> }>) {
  const context = await requirePageAuthentication();
  const { meetingId } = await params;
  let briefing;
  try {
    briefing = await getMeetingService().getBriefing(context, { meetingId });
  } catch (error) {
    if (error instanceof AccessDeniedError) redirect("/acesso-negado");
    if (error instanceof ApplicationError && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return (
    <main className="page-canvas">
      <PageHeader back={{ href: "/agenda", label: "Voltar à agenda" }} description={`${briefing.meeting.leadName} · ${formatDate(briefing.meeting.startsAt, briefing.meeting.timeZone)}`} eyebrow="Preparação da reunião" meta={context.displayName} title="Briefing do closer" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Surface className="p-5 lg:col-span-2" tone="accent"><SectionHeader eyebrow="Leia antes da reunião" title="Resumo em três linhas" /><p className="mt-3 whitespace-pre-line text-sm leading-7">{briefing.summary}</p><p className="mt-4 rounded-[var(--radius-control)] bg-card p-3 text-sm"><strong>Próxima ação recomendada:</strong> {briefing.recommendedNextAction}</p></Surface>

        <Surface className="p-5 lg:col-span-2" tone="subtle"><SectionHeader eyebrow="Continuidade comercial" title="Negócio e próxima ação" />{briefing.businessContext.opportunityId ? <div className="mt-4 flex flex-wrap items-center justify-between gap-4"><div><p className="font-semibold">{briefing.businessContext.opportunityName}</p>{briefing.businessContext.nextAction ? <p className="mt-1 text-sm text-muted-foreground">{briefing.businessContext.nextAction.title} · {formatDate(briefing.businessContext.nextAction.dueAt, briefing.meeting.timeZone)}</p> : <p className="mt-1 text-sm text-muted-foreground">Sem próxima ação aberta.</p>}</div><a className="text-sm font-semibold text-primary underline-offset-4 hover:underline" href={`/oportunidades?opportunityId=${briefing.businessContext.opportunityId}`}>Abrir oportunidade</a></div> : <EmptyState className="mt-4" compact description="Vincule a reunião a uma oportunidade aberta para projetar a próxima ação comercial." title="Reunião sem oportunidade" />}</Surface>

        <Surface className="p-5"><SectionHeader eyebrow="Origem" title="Respostas do formulário" /><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Atuação</dt><dd>{briefing.formAnswers.jobTitle ?? "Ausente"}</dd></div><div><dt className="text-xs text-muted-foreground">Organização</dt><dd>{briefing.formAnswers.organizationName ?? "Ausente"}</dd></div><div><dt className="text-xs text-muted-foreground">Localidade</dt><dd>{[briefing.formAnswers.city, briefing.formAnswers.stateCode].filter(Boolean).join(" / ") || "Ausente"}</dd></div><div><dt className="text-xs text-muted-foreground">Capacidade informada</dt><dd>{money(briefing.formAnswers.budgetCents)}</dd></div><div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Dor / interesse</dt><dd className="whitespace-pre-wrap">{briefing.formAnswers.interestSummary ?? "Ausente"}</dd></div></dl></Surface>

        <Surface className="p-5" tone="subtle"><SectionHeader eyebrow="Preparação" title="Contexto para a conversa" /><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-xs text-muted-foreground">Dor nas palavras do lead</dt><dd>{briefing.painInLeadWords ?? "Não registrada"}</dd></div><div><dt className="text-xs text-muted-foreground">Decisor</dt><dd>{briefing.decisionMaker ?? "Não investigado"}</dd></div><div><dt className="text-xs text-muted-foreground">Capacidade</dt><dd>{briefing.capacity ?? "Não investigada"}</dd></div><div><dt className="text-xs text-muted-foreground">Urgência</dt><dd>{briefing.urgency ?? "Não investigada"}</dd></div></dl></Surface>

        <Surface className="p-5 lg:col-span-2"><SectionHeader description="Status e evidências permanecem separados das sugestões de IA." eyebrow="Qualificação humana" title="PACTO validado" /><div className="mt-4 grid gap-3 md:grid-cols-5">{briefing.pacto.map((item) => <article className="pacto-dimension rounded-[0.875rem] border bg-[var(--surface-subtle)] p-3" data-pacto-status={item.status} key={item.dimension}><p className="text-sm font-semibold">{item.label}</p><p className="mt-2 text-xs">{pactoStatusLabels[item.status as keyof typeof pactoStatusLabels] ?? item.status}</p><p className="mt-2 text-xs text-muted-foreground">{item.evidence ?? "Sem evidência registrada"}</p></article>)}</div></Surface>

        <Surface className="p-5"><SectionHeader eyebrow="Lacunas" title="Perguntas sem resposta" />{briefing.unansweredQuestions.length ? <ul className="mt-4 list-disc space-y-2 pl-5 text-sm">{briefing.unansweredQuestions.map((question) => <li key={question}>{question}</li>)}</ul> : <EmptyState className="mt-4" compact description="As cinco dimensões possuem investigação registrada." title="PACTO sem lacunas" />}</Surface>

        <Surface className="p-5" tone="subtle"><SectionHeader eyebrow="Linha do tempo" title="Histórico recente" />{briefing.recentHistory.length ? <ol className="mt-4 space-y-3">{briefing.recentHistory.map((item, index) => <li className="border-l-2 border-[var(--brand-sky)] pl-3 text-sm" key={`${item.occurredAt}-${index}`}><p className="font-medium">{item.subject}</p><p className="text-xs text-muted-foreground">{formatDate(item.occurredAt, briefing.meeting.timeZone)}</p>{item.description ? <p className="mt-1 text-xs">{item.description}</p> : null}</li>)}</ol> : <EmptyState className="mt-4" compact description="O histórico aparecerá após a primeira atividade persistida." title="Nenhuma atividade anterior" />}</Surface>

        <MeetingTranscriptPanel meetingId={briefing.meeting.id} transcript={briefing.transcript} />
      </div>
    </main>
  );
}
