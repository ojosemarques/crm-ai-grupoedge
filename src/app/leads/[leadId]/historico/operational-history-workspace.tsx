"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState, type KeyboardEvent } from "react";

import styles from "./lead-detail.module.css";
import { Icon } from "@/components/ui/icon";
import { leadStageCodes, leadStageLabels } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";
import { Button } from "@/components/ui/button";
import { PactoWorkspace } from "@/app/leads/[leadId]/historico/pacto-workspace";
import { ScoringWorkspace } from "@/app/leads/[leadId]/historico/scoring-workspace";
import { LeadStageWorkspace } from "@/app/leads/[leadId]/historico/lead-stage-workspace";
import { LeadMeetingsWorkspace } from "@/app/leads/[leadId]/historico/lead-meetings-workspace";
import { LeadOpportunitiesWorkspace } from "@/app/leads/[leadId]/historico/lead-opportunities-workspace";
import { LeadIntelligencePanel } from "@/app/leads/[leadId]/historico/lead-intelligence-panel";
import type { LeadCardOperations } from "@/modules/leads/domain/lead-card-contracts";
import type { LeadMeetingsScreen } from "@/modules/meetings/domain/meeting-contracts";
import type { LeadOpportunityScreen } from "@/modules/opportunities/domain/opportunity-contracts";
import type { PactoQualificationView } from "@/modules/qualification/domain/pacto-contracts";
import type { LeadScoreView } from "@/modules/qualification/domain/scoring-contracts";
import type { LeadPipelineState } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";
import type { LeadIntelligenceScreen } from "@/modules/ai/domain/lead-intelligence-contracts";
import type { LeadContactView } from "@/modules/contacts/domain/contact-contracts";
import { JourneyPanel } from "@/components/lifecycle/journey-panel";
import type { JourneySnapshot } from "@/modules/lifecycle/domain/lifecycle-contracts";
import type { getOmnichannelService } from "@/modules/communications/application/omnichannel-service";

type LeadCommunicationSummary = Awaited<ReturnType<ReturnType<typeof getOmnichannelService>["getLeadSummary"]>>;

type Notice = Readonly<{
  kind: "success" | "error";
  message: string;
}> | null;

type TabKey =
  | "summary"
  | "identity"
  | "pacto"
  | "timeline"
  | "meetings"
  | "opportunity"
  | "intelligence"
  | "audit";

const inputClass =
  "mt-1.5 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const textareaClass =
  "mt-1.5 min-h-20 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

const activityOptions = [
  ["CALL", "Ligação"],
  ["CALL_CONNECTED", "Ligação atendida"],
  ["CALL_UNANSWERED", "Ligação não atendida"],
  ["MESSAGE_SENT", "Mensagem enviada"],
  ["MESSAGE_RECEIVED", "Mensagem recebida"],
  ["AUDIO", "Áudio"],
  ["EMAIL", "E-mail"],
  ["NOTE", "Nota"],
] as const;

const activityLabels: Readonly<Record<string, string>> = {
  ...Object.fromEntries(activityOptions),
  TASK: "Tarefa",
  MEETING: "Reunião",
  STAGE_CHANGE: "Alteração de etapa",
  RESPONSIBLE_CHANGE: "Alteração de responsável",
  STATUS_CHANGE: "Alteração cadastral",
  AUTOMATION: "Automação",
  AI_ACTION: "Ação da IA",
  PROPOSAL: "Proposta",
  WON: "Ganho",
  LOST: "Perda",
};

const actorLabels: Readonly<Record<string, string>> = {
  HUMAN: "Pessoa",
  SYSTEM: "Sistema",
  AUTOMATION: "Automação",
  AI_AGENT: "Agente de IA",
};

const tabs: readonly Readonly<{ key: TabKey; label: string }>[] = [
  { key: "timeline", label: "Atividades" },
  { key: "summary", label: "Resumo" },
  { key: "identity", label: "Contato" },
  { key: "pacto", label: "PACTO" },
  { key: "meetings", label: "Reuniões" },
  { key: "opportunity", label: "Negócios" },
  { key: "intelligence", label: "Inteligência" },
];

function formText(form: FormData, name: string): string | undefined {
  const value = String(form.get(name) ?? "").trim();
  return value || undefined;
}

function nullableFormText(form: FormData, name: string): string | null {
  return formText(form, name) ?? null;
}

function isoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function nextTaskFromForm(form: FormData) {
  const title = formText(form, "nextTitle");
  const dueAt = isoDate(formText(form, "nextDueAt"));
  if (!title && !dueAt) return undefined;
  if (!title || !dueAt) {
    throw new Error("Informe título e prazo da próxima ação.");
  }
  return {
    title,
    dueAt,
    kind: formText(form, "nextKind") ?? "FOLLOW_UP",
    priority: formText(form, "nextPriority") ?? "MEDIUM",
  };
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}

function formatMoney(cents: string | null) {
  if (cents === null) return "Não informado";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(cents) / 100);
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) return `${minutes}min ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}min`;
}

function slaPresentation(
  seconds: number,
  healthyMaxSeconds: number,
  attentionMaxSeconds: number,
) {
  if (seconds <= healthyMaxSeconds) {
    return { label: "Saudável", className: "border-emerald-300 bg-emerald-50 text-emerald-950" };
  }
  if (seconds <= attentionMaxSeconds) {
    return { label: "Atenção", className: "border-amber-300 bg-amber-50 text-amber-950" };
  }
  return { label: "Crítico", className: "border-red-300 bg-red-50 text-red-950" };
}

async function readResponse(response: Response) {
  const body = (await response.json().catch(() => ({}))) as {
    result?: unknown;
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? "Não foi possível concluir a operação.");
  }
  return body.result;
}

function NextActionFields() {
  return (
    <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
      <legend className="px-1 text-sm font-semibold">Próxima ação explícita</legend>
      <label className="text-sm">
        Título
        <input className={inputClass} name="nextTitle" placeholder="Retornar ao lead" />
      </label>
      <label className="text-sm">
        Prazo
        <input className={inputClass} name="nextDueAt" type="datetime-local" />
      </label>
      <label className="text-sm">
        Tipo
        <select className={inputClass} defaultValue="FOLLOW_UP" name="nextKind">
          <option value="FOLLOW_UP">Retorno</option>
          <option value="CALL">Ligação</option>
          <option value="MESSAGE">Mensagem</option>
          <option value="EMAIL">E-mail</option>
          <option value="MEETING">Reunião</option>
          <option value="GENERAL">Geral</option>
        </select>
      </label>
      <label className="text-sm">
        Prioridade
        <select className={inputClass} defaultValue="MEDIUM" name="nextPriority">
          <option value="LOW">Baixa</option>
          <option value="MEDIUM">Média</option>
          <option value="HIGH">Alta</option>
          <option value="URGENT">Urgente</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        A tarefa seguinte só é criada quando estes campos forem preenchidos e a operação for confirmada.
      </p>
    </fieldset>
  );
}

function EmptyIntegration({ title, description }: Readonly<{ title: string; description: string }>) {
  return (
    <section className="surface-panel border-dashed p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
    </section>
  );
}

export function OperationalHistoryWorkspace({
  initialOperations,
  initialPacto,
  initialPipeline,
  initialScore,
  initialMeetings,
  initialOpportunities,
  initialIntelligence,
  intelligenceForbidden,
  initialContactIdentity,
  contactIdentityForbidden,
  initialJourney,
  initialPrivacy,
  privacyForbidden,
  initialCommunications,
  communicationsForbidden,
}: Readonly<{
  initialOperations: LeadCardOperations;
  initialPacto: PactoQualificationView;
  initialPipeline: LeadPipelineState;
  initialScore: LeadScoreView;
  initialMeetings: LeadMeetingsScreen;
  initialOpportunities: LeadOpportunityScreen;
  initialIntelligence: LeadIntelligenceScreen | null;
  intelligenceForbidden: boolean;
  initialContactIdentity: LeadContactView | null;
  contactIdentityForbidden: boolean;
  initialJourney: JourneySnapshot | null;
  initialPrivacy: Readonly<{ outcome: "ALLOW" | "DENY" | "REVIEW_REQUIRED"; consentState: string; reasonCodes: readonly string[]; missingEvidence: readonly string[]; mode: string; purpose: Readonly<{ name: string; version: number | null; status: string | null }> | null }> | null;
  privacyForbidden: boolean;
  initialCommunications: LeadCommunicationSummary | null;
  communicationsForbidden: boolean;
}>) {
  const [operations, setOperations] = useState(initialOperations);
  const [pacto, setPacto] = useState(initialPacto);
  const [pipeline, setPipeline] = useState(initialPipeline);
  const [score, setScore] = useState(initialScore);
  const [activeTab, setActiveTab] = useState<TabKey>("timeline");
  const [activityType, setActivityType] = useState("CALL_UNANSWERED");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [correctionId, setCorrectionId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date(initialOperations.generatedAt).getTime());
  const [contactIdentity, setContactIdentity] = useState(initialContactIdentity);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const openLinkedPanel = () => {
      if (["#registrar-atividade", "#criar-tarefa", "#tarefas"].includes(window.location.hash)) {
        setActiveTab("timeline");
        window.setTimeout(() => {
          const target = document.getElementById(window.location.hash.slice(1));
          if (target instanceof HTMLDetailsElement) target.open = true;
          target?.scrollIntoView({ block: "start" });
        }, 0);
      } else if (window.location.hash === "#oportunidade") {
        setActiveTab("opportunity");
      }
    };
    openLinkedPanel();
    window.addEventListener("hashchange", openLinkedPanel);
    return () => window.removeEventListener("hashchange", openLinkedPanel);
  }, []);

  async function refresh() {
    const [operationsResponse, scoreResponse, pipelineResponse, pactoResponse, contactResponse] = await Promise.all([
      fetch(`/api/leads/${operations.lead.id}/operations?pageSize=20`, { cache: "no-store" }),
      fetch(`/api/leads/${operations.lead.id}/score`, { cache: "no-store" }),
      fetch(`/api/leads/${operations.lead.id}/stage`, { cache: "no-store" }),
      fetch(`/api/leads/${operations.lead.id}/qualification`, { cache: "no-store" }),
      contactIdentityForbidden
        ? Promise.resolve(null)
        : fetch(`/api/leads/${operations.lead.id}/contact`, { cache: "no-store" }),
    ]);
    const result = (await readResponse(operationsResponse)) as LeadCardOperations;
    const scoreResult = (await readResponse(scoreResponse)) as LeadScoreView;
    const pipelineResult = (await readResponse(pipelineResponse)) as LeadPipelineState;
    const pactoResult = (await readResponse(pactoResponse)) as PactoQualificationView;
    setOperations(result);
    setScore(scoreResult);
    setPipeline(pipelineResult);
    setPacto(pactoResult);
    if (contactResponse) {
      setContactIdentity((await readResponse(contactResponse)) as LeadContactView);
    }
    setClock(new Date(result.generatedAt).getTime());
  }

  async function resolveIdentityReview(reviewId: string, decision: "KEEP_SEPARATE" | "DISMISS") {
    const reason = window.prompt(
      decision === "KEEP_SEPARATE"
        ? "Por que estas identidades devem permanecer separadas?"
        : "Por que esta pendência pode ser descartada?",
    )?.trim();
    if (!reason) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/contacts/reviews/${reviewId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, reason }),
      });
      await readResponse(response);
      await refresh();
      setNotice({ kind: "success", message: "Revisão de identidade encerrada e auditada." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Falha ao resolver a revisão.",
      });
    } finally {
      setPending(false);
    }
  }

  async function mutate(action: string, data: Record<string, unknown>) {
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${operations.lead.id}/operations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, data }),
      });
      await readResponse(response);
      await refresh();
      setNotice({ kind: "success", message: "Operação registrada com sucesso." });
      return true;
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Falha inesperada.",
      });
      return false;
    } finally {
      setPending(false);
    }
  }

  function openOperationalAction(type: string, targetId = "registrar-atividade") {
    setActivityType(type);
    setActiveTab("timeline");
    window.setTimeout(() => {
      const target = document.getElementById(targetId);
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function openStagePanel() {
    setActiveTab("summary");
    window.setTimeout(() => {
      document.getElementById("alterar-etapa")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  async function submitSummary(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await mutate("UPDATE_SUMMARY", {
      expectedUpdatedAt: operations.lead.updatedAt,
      fullName: formText(form, "fullName"),
      normalizedEmail: nullableFormText(form, "normalizedEmail"),
      jobTitle: nullableFormText(form, "jobTitle"),
      organizationName: nullableFormText(form, "organizationName"),
      city: nullableFormText(form, "city"),
      stateCode: nullableFormText(form, "stateCode"),
      interestSummary: nullableFormText(form, "interestSummary"),
    });
  }

  async function submitRedistribution(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const destination = formText(form, "destination");
    if (!destination) return;
    const target = destination === "general"
      ? { type: "GENERAL_QUEUE" }
      : { type: "MEMBER", memberId: destination.replace("member:", "") };
    await mutate("REDISTRIBUTE", {
      target,
      reason: formText(form, "reason"),
    });
  }

  async function submitActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      const nextTask = nextTaskFromForm(form);
      const duration = formText(form, "durationSeconds");
      const saved = await mutate("RECORD_ACTIVITY", {
        type: formText(form, "type"),
        direction: formText(form, "direction"),
        ...(formText(form, "result") ? { result: formText(form, "result") } : {}),
        subject: formText(form, "subject"),
        ...(formText(form, "observation")
          ? { observation: formText(form, "observation") }
          : {}),
        ...(duration ? { durationSeconds: Number(duration) } : {}),
        ...(nextTask ? { nextTask } : {}),
      });
      if (saved) element.reset();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Revise a próxima ação.",
      });
    }
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const saved = await mutate("CREATE_TASK", {
      title: formText(form, "title"),
      ...(formText(form, "description")
        ? { description: formText(form, "description") }
        : {}),
      kind: formText(form, "kind"),
      priority: formText(form, "priority"),
      dueAt: isoDate(formText(form, "dueAt")),
    });
    if (saved) element.reset();
  }

  async function submitCompletion(event: FormEvent<HTMLFormElement>, taskId: string) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    try {
      const nextTask = nextTaskFromForm(form);
      const saved = await mutate("COMPLETE_TASK", {
        taskId,
        result: formText(form, "result"),
        ...(nextTask ? { nextTask } : {}),
      });
      if (saved) element.reset();
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Revise a próxima ação.",
      });
    }
  }

  async function submitCorrection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!correctionId) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    const saved = await mutate("CORRECT_ACTIVITY", {
      activityId: correctionId,
      reason: formText(form, "reason"),
      correctedSubject: formText(form, "correctedSubject"),
      ...(formText(form, "correctedObservation")
        ? { correctedObservation: formText(form, "correctedObservation") }
        : {}),
    });
    if (saved) {
      element.reset();
      setCorrectionId(null);
    }
  }

  async function loadMore() {
    if (!operations.nextCursor) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/leads/${operations.lead.id}/operations?pageSize=20&cursor=${operations.nextCursor}`,
        { cache: "no-store" },
      );
      const result = (await readResponse(response)) as LeadCardOperations;
      setOperations((current) => ({
        ...current,
        timeline: [...current.timeline, ...result.timeline],
        nextCursor: result.nextCursor,
      }));
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Falha ao carregar a timeline.",
      });
    } finally {
      setPending(false);
    }
  }

  const runningSlaSeconds = operations.lead.sla.firstHumanAttemptSeconds ??
    operations.lead.sla.elapsedSeconds + Math.max(
      0,
      Math.floor((clock - new Date(operations.generatedAt).getTime()) / 1_000),
    );
  const sla = slaPresentation(
    runningSlaSeconds,
    operations.lead.sla.healthyMaxSeconds,
    operations.lead.sla.attentionMaxSeconds,
  );
  const timeSinceEntry = Math.max(
    0,
    Math.floor((clock - new Date(operations.lead.receivedAt).getTime()) / 1_000),
  );

  const visibleTabs = operations.permissions.canReadAudit
    ? [...tabs, { key: "audit" as const, label: "Auditoria" }]
    : tabs;

  function moveTabFocus(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const keyToIndex: Readonly<Record<string, number>> = {
      ArrowRight: (index + 1) % visibleTabs.length,
      ArrowLeft: (index - 1 + visibleTabs.length) % visibleTabs.length,
      Home: 0,
      End: visibleTabs.length - 1,
    };
    const nextIndex = keyToIndex[event.key];
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = visibleTabs[nextIndex]!;
    setActiveTab(nextTab.key);
    document.getElementById(`tab-${nextTab.key}`)?.focus();
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.header}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className={styles.avatar} aria-hidden="true">{operations.lead.fullName.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("")}</span><h1>{operations.lead.fullName}</h1>
              {operations.lead.priorityCode ? (
                <span className="priority-badge" data-priority={operations.lead.priorityCode}>
                  {operations.lead.priorityCode}
                </span>
              ) : null}
              {operations.lead.awaitingHumanResponse ? (
                <span className="rounded-full border border-blue-300 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-900">
                  Respondeu · atender agora
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {operations.lead.jobTitle ?? "Atuação não informada"} · {operations.lead.account ? (
                <Link className="font-medium text-primary underline-offset-4 hover:underline" href={`/contas/${operations.lead.account.id}`}>{operations.lead.account.name}</Link>
              ) : operations.lead.organizationName ? `${operations.lead.organizationName} · vínculo aguardando revisão humana` : "Organização não informada"}
            </p>
          </div>
          <div className={`rounded-md border px-3 py-2 text-right ${sla.className}`}>
            <p className="text-xs font-semibold">SLA · {sla.label}</p>
            <p className="font-mono text-lg font-bold">{runningSlaSeconds}s</p>
            <p className="text-[11px]">{operations.lead.sla.policyName}</p>
          </div>
        </div>


        {operations.lead.nextActionIssue ? (
          <p className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
            Erro operacional: {operations.lead.nextActionIssue}
          </p>
        ) : null}
        {operations.lead.contactPreference === "DO_NOT_CONTACT" ? (
          <p className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900" role="alert">
            Não contatar: tentativas de contato estão bloqueadas no serviço de domínio.
          </p>
        ) : null}
      </section>

      <details className={styles.quickActions}><summary><Icon name="mais" size={14} /> Ações do contato</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="secondary"><Link href={`/integracoes/telefonia?leadId=${operations.lead.id}`}>Abrir telefonia</Link></Button>
          <Button disabled={!operations.permissions.canWrite} onClick={() => openOperationalAction("CALL_UNANSWERED")} size="sm" type="button">Registrar ligação</Button>
          <Button disabled={!operations.permissions.canWrite} onClick={() => openOperationalAction("MESSAGE_SENT")} size="sm" type="button" variant="secondary">Registrar mensagem</Button>
          <Button disabled={!operations.permissions.canWrite} onClick={() => openOperationalAction("NOTE")} size="sm" type="button" variant="secondary">Adicionar nota</Button>
          <Button disabled={!operations.permissions.canManageTasks} onClick={() => openOperationalAction("NOTE", "criar-tarefa")} size="sm" type="button" variant="secondary">Criar tarefa</Button>
          <Button disabled={!operations.permissions.canAssign} onClick={() => { setActiveTab("summary"); window.setTimeout(() => document.getElementById("alterar-responsavel")?.scrollIntoView({ behavior: "smooth" }), 0); }} size="sm" type="button" variant="secondary">Alterar responsável</Button>
          <Button disabled={!pipeline.canWrite} onClick={openStagePanel} size="sm" type="button" variant="secondary">Alterar etapa</Button>
          <Button disabled={!pipeline.canWrite} onClick={openStagePanel} size="sm" type="button" variant="secondary">Desqualificar</Button>
          <Button disabled={!pipeline.canWrite} onClick={openStagePanel} size="sm" type="button" variant="secondary">Colocar em nutrição</Button>
          <Button disabled={!pacto.canWrite} key="Qualificar" onClick={() => setActiveTab("pacto")} size="sm" type="button" variant="secondary">Qualificar</Button>
          <Button disabled={!initialMeetings.canSchedule} onClick={() => setActiveTab("meetings")} size="sm" type="button" variant="secondary">Agendar reunião</Button>
          <Button disabled={!initialOpportunities.canCreate} onClick={() => setActiveTab("opportunity")} size="sm" type="button" variant="secondary">Criar oportunidade</Button>
          <Button disabled size="sm" title="Integração futura ainda não implementada" type="button" variant="secondary">Pedir análise da IA</Button>
        </div>
        {!operations.permissions.canWrite ? (
          <p className="mt-3 text-sm text-muted-foreground">Seu perfil possui acesso somente para leitura neste lead.</p>
        ) : null}
      </details>

      {notice ? (
        <div className={`flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm ${notice.kind === "error" ? "border-red-300 bg-red-50 text-red-900" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`} role={notice.kind === "error" ? "alert" : "status"}>
          <p>{notice.message}</p>
          {notice.kind === "error" ? <Button disabled={pending} onClick={() => void refresh()} size="sm" type="button" variant="secondary">Recarregar dados</Button> : null}
        </div>
      ) : null}

      <div aria-label="Seções do cartão do lead" className={`${styles.tabs} lead-tabs`} role="tablist">
        {visibleTabs.map((tab, index) => (
          <button
            aria-controls={`panel-${tab.key}`}
            aria-selected={activeTab === tab.key}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${activeTab === tab.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground"}`}
            id={`tab-${tab.key}`}
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            onKeyDown={(event) => moveTabFocus(event, index)}
            role="tab"
            tabIndex={activeTab === tab.key ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>

      <ol className={styles.stages} aria-label="Etapas de pré-vendas">
        {leadStageCodes.map((code, index) => <li key={code} aria-current={pipeline.currentStageCode === code ? "step" : undefined}><span>{index + 1}</span><strong>{code === pipeline.currentStageCode ? pipeline.currentStageName : pipeline.transitions.find((stage) => stage.code === code)?.name ?? leadStageLabels[code]}</strong></li>)}
      </ol>
      <div className={styles.layout}>
        <aside className={styles.profile}>
          <h2>Informações do contato</h2>
        <dl className={styles.facts}>
          <div><dt className="text-xs text-muted-foreground">Telefone</dt><dd className="mt-1 font-medium">{operations.lead.normalizedPhone ?? "Não informado"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">E-mail</dt><dd className="mt-1 break-all font-medium">{operations.lead.normalizedEmail ?? "Não informado"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Cidade / estado</dt><dd className="mt-1 font-medium">{[operations.lead.city, operations.lead.stateCode].filter(Boolean).join(" / ") || "Não informado"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Etapa</dt><dd className="mt-1 font-medium"><span className="stage-badge">{operations.lead.stageName}</span></dd></div>
          <div><dt className="text-xs text-muted-foreground">Pontuação</dt><dd className="mt-1 font-medium">{operations.lead.score ?? "Não calculada"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Responsável</dt><dd className="mt-1 font-medium">{operations.lead.operationalOwner}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Origem</dt><dd className="mt-1 font-medium">{operations.lead.sourceName}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Tempo desde a entrada</dt><dd className="mt-1 font-medium">{formatElapsed(timeSinceEntry)}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Última atividade</dt><dd className="mt-1 font-medium">{operations.lead.lastActivity ? `${operations.lead.lastActivity.subject} · ${formatDate(operations.lead.lastActivity.occurredAt, operations.timeZone)}` : "Nenhuma atividade"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Próxima atividade</dt><dd className="mt-1 font-medium">{operations.lead.nextAction ? `${operations.lead.nextAction.title} · ${formatDate(operations.lead.nextAction.dueAt, operations.timeZone)}` : "Nenhuma próxima ação ativa"}</dd></div>
        </dl>

          <Button onClick={() => setActiveTab("summary")} size="sm" type="button" variant="secondary">Editar informações</Button>
        </aside>
        <div className={styles.content}>
      {activeTab === "summary" ? (
        <div aria-labelledby="tab-summary" className="grid gap-6 xl:grid-cols-2" id="panel-summary" role="tabpanel">
          <section className="surface-panel surface-panel--soft p-5 xl:col-span-2" aria-label="Resumo de comunicações">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-lg font-semibold">Comunicações</h2><p className="mt-1 text-sm text-muted-foreground">Resumo relacional do inbox; a timeline mantém apenas a referência ao fato canônico.</p></div>
              <Button asChild size="sm" variant="secondary"><Link href={initialCommunications?.recent[0] ? `/inbox?conversationId=${initialCommunications.recent[0].id}` : "/inbox"}>Abrir inbox</Link></Button>
            </div>
            {communicationsForbidden ? <p className="mt-4 text-sm text-muted-foreground">Sem permissão para consultar conversas deste lead.</p> : initialCommunications ? <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6"><div><dt className="text-xs text-muted-foreground">Conversas</dt><dd className="mt-1 font-semibold">{initialCommunications.conversationCount}</dd></div><div><dt className="text-xs text-muted-foreground">Abertas</dt><dd className="mt-1 font-semibold">{initialCommunications.openCount}</dd></div><div><dt className="text-xs text-muted-foreground">Aguardando time</dt><dd className="mt-1 font-semibold">{initialCommunications.waitingTeamCount}</dd></div><div><dt className="text-xs text-muted-foreground">Não lidas</dt><dd className="mt-1 font-semibold">{initialCommunications.unreadCount}</dd></div><div><dt className="text-xs text-muted-foreground">Entradas</dt><dd className="mt-1 font-semibold">{initialCommunications.inboundMessageCount}</dd></div><div><dt className="text-xs text-muted-foreground">Saídas</dt><dd className="mt-1 font-semibold">{initialCommunications.outboundMessageCount}</dd></div></dl> : <p className="mt-4 text-sm text-muted-foreground">Resumo de comunicação indisponível.</p>}
            {!communicationsForbidden && initialCommunications?.conversationCount === 0 ? <p className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Ainda não há conversa canônica para este lead.</p> : null}
          </section>
          <section className="surface-panel xl:col-span-2 p-5" aria-label="Situação de privacidade">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><h2 className="text-lg font-semibold">Privacidade para contato</h2><p className="mt-1 text-sm text-muted-foreground">Decisão determinística por finalidade, canal e ponto de contato.</p></div>
              {privacyForbidden ? <span className="status-badge">Sem permissão</span> : initialPrivacy ? <span className="status-badge" data-tone={initialPrivacy.outcome === "ALLOW" ? "success" : initialPrivacy.outcome === "DENY" ? "danger" : "warning"}>{initialPrivacy.outcome === "ALLOW" ? "Autorizado" : initialPrivacy.outcome === "DENY" ? "Contato bloqueado" : "Revisão necessária"}</span> : <span className="status-badge">Sem avaliação</span>}
            </div>
            {initialPrivacy ? <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3"><p><strong>Estado:</strong> {initialPrivacy.consentState}</p><p><strong>Finalidade:</strong> {initialPrivacy.purpose?.name ?? "Não configurada"}</p><p><strong>Modo:</strong> {initialPrivacy.mode === "SHADOW_LOCAL" ? "Local conservador" : "Aplicado"}</p><p className="sm:col-span-3 text-muted-foreground">Motivos: {initialPrivacy.reasonCodes.join(", ")}. {initialPrivacy.missingEvidence.length ? `Faltam: ${initialPrivacy.missingEvidence.join(", ")}.` : "Evidência suficiente para a regra vigente."}</p></div> : null}
          </section>
          <div className="xl:col-span-2"><JourneyPanel journey={initialJourney} /></div>
          <div className="xl:col-span-2">
            <ScoringWorkspace
              initialScore={score}
              onCommitted={refresh}
              onUpdated={setScore}
            />
          </div>
          <div className="xl:col-span-2">
            <LeadStageWorkspace
              onCommitted={refresh}
              onUpdated={setPipeline}
              pipeline={pipeline}
              timeZone={operations.timeZone}
            />
          </div>
          <section className="space-y-6">
            <article className="surface-panel p-5">
              <h2 className="text-lg font-semibold">Contexto atual</h2>
              <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-xs text-muted-foreground">Dor ou interesse</dt><dd className="mt-1 whitespace-pre-wrap">{operations.lead.interestSummary ?? "Não informado"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Capacidade / orçamento</dt><dd className="mt-1">{formatMoney(operations.lead.budgetCents)}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Prioridade vigente</dt><dd className="mt-1">{operations.lead.priorityCode ? <span className="priority-badge" data-priority={operations.lead.priorityCode}>{operations.lead.priorityCode}</span> : "Não classificada"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Motivo disponível</dt><dd className="mt-1">{operations.lead.priorityReason ?? "Sem explicação persistida"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Campanha</dt><dd className="mt-1">{operations.lead.campaignName ?? "Não informada"}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Criativo</dt><dd className="mt-1">{operations.lead.creativeName ?? "Não informado"}</dd></div>
                <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Próxima ação</dt><dd className="mt-1">{operations.lead.nextAction ? `${operations.lead.nextAction.title} · ${formatDate(operations.lead.nextAction.dueAt, operations.timeZone)}` : "Ausente"}</dd></div>
              </dl>
            </article>

            <article className="surface-panel bg-[var(--surface-subtle)] p-5">
              <h2 className="text-lg font-semibold">Respostas do formulário mais recente</h2>
              {operations.summary.latestSubmission ? (
                <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-muted-foreground">Recebido em</dt><dd className="mt-1">{formatDate(operations.summary.latestSubmission.submittedAt, operations.timeZone)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Canal</dt><dd className="mt-1">{operations.summary.latestSubmission.channel ?? "Não classificado"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Nome enviado</dt><dd className="mt-1">{operations.summary.latestSubmission.fullName ?? "Ausente"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Telefone enviado</dt><dd className="mt-1">{operations.summary.latestSubmission.phone ?? "Ausente"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">E-mail enviado</dt><dd className="mt-1 break-all">{operations.summary.latestSubmission.email ?? "Ausente"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Atuação enviada</dt><dd className="mt-1">{operations.summary.latestSubmission.jobTitle ?? "Ausente"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Organização enviada</dt><dd className="mt-1">{operations.summary.latestSubmission.organizationName ?? "Ausente"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Localidade enviada</dt><dd className="mt-1">{[operations.summary.latestSubmission.city, operations.summary.latestSubmission.stateCode].filter(Boolean).join(" / ") || "Ausente"}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground">Dor / interesse enviado</dt><dd className="mt-1 whitespace-pre-wrap">{operations.summary.latestSubmission.interestSummary ?? "Ausente"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Origem</dt><dd className="mt-1">{operations.summary.latestSubmission.sourceName}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Campanha / criativo</dt><dd className="mt-1">{[operations.summary.latestSubmission.campaignName, operations.summary.latestSubmission.creativeName].filter(Boolean).join(" / ") || "Ausente"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Capacidade enviada</dt><dd className="mt-1">{formatMoney(operations.summary.latestSubmission.budgetCents)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Consentimento / contato</dt><dd className="mt-1">{operations.summary.latestSubmission.contactPreference ?? "Ausente"}</dd></div>
                </dl>
              ) : (
                <p className="mt-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhuma submissão de formulário foi encontrada.</p>
              )}
            </article>

            <article className="surface-panel p-5">
              <h2 className="text-lg font-semibold">Alertas e campos faltantes</h2>
              {operations.summary.alerts.length > 0 ? (
                <ul className="mt-4 space-y-2">
                  {operations.summary.alerts.map((alert) => <li className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" key={alert.key}><p className="font-semibold">{alert.title}</p><p className="mt-1">{alert.message}</p></li>)}
                </ul>
              ) : <p className="mt-3 text-sm text-muted-foreground">Nenhum alerta operacional aberto.</p>}
              {operations.summary.missingFields.length > 0 ? (
                <div className="mt-4"><p className="text-sm font-semibold">Campos ainda ausentes</p><ul className="mt-2 flex flex-wrap gap-2">{operations.summary.missingFields.map((field) => <li className="rounded-full border px-2.5 py-1 text-xs" key={field}>{field}</li>)}</ul></div>
              ) : <p className="mt-4 text-sm text-emerald-800">Os campos de contexto deste resumo estão preenchidos.</p>}
            </article>
          </section>

          <section className="space-y-6">
            <article className="surface-panel p-5">
              <h2 className="text-lg font-semibold">Editar resumo</h2>
              {operations.permissions.canWrite ? (
                <form className="mt-4 grid gap-4 sm:grid-cols-2" key={operations.lead.updatedAt} onSubmit={submitSummary}>
                  <label className="text-sm sm:col-span-2">Nome<input className={inputClass} defaultValue={operations.lead.fullName} name="fullName" required /></label>
                  <label className="text-sm sm:col-span-2">E-mail<input className={inputClass} defaultValue={operations.lead.normalizedEmail ?? ""} name="normalizedEmail" type="email" /></label>
                  <label className="text-sm">Cargo ou atuação<input className={inputClass} defaultValue={operations.lead.jobTitle ?? ""} name="jobTitle" /></label>
                  <label className="text-sm">Organização<input className={inputClass} defaultValue={operations.lead.organizationName ?? ""} name="organizationName" /></label>
                  <label className="text-sm">Cidade<input className={inputClass} defaultValue={operations.lead.city ?? ""} name="city" /></label>
                  <label className="text-sm">Estado<input className={inputClass} defaultValue={operations.lead.stateCode ?? ""} maxLength={2} name="stateCode" placeholder="SP" /></label>
                  <label className="text-sm sm:col-span-2">Dor ou interesse<textarea className={textareaClass} defaultValue={operations.lead.interestSummary ?? ""} name="interestSummary" /></label>
                  <p className="text-xs text-muted-foreground sm:col-span-2">Campos opcionais vazios são limpos explicitamente. O telefone não é editado aqui porque identifica duplicidades.</p>
                  <Button className="sm:col-span-2" disabled={pending} type="submit">{pending ? "Salvando…" : "Salvar resumo"}</Button>
                </form>
              ) : <p className="mt-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Sem permissão para alterar os dados deste lead.</p>}
            </article>

            {operations.permissions.canAssign ? (
              <article className="surface-panel scroll-mt-4 p-5" id="alterar-responsavel">
                <h2 className="text-lg font-semibold">Alterar responsável</h2>
                <form className="mt-4 grid gap-4" onSubmit={submitRedistribution}>
                  <label className="text-sm">Destino<select className={inputClass} defaultValue={operations.lead.ownerMemberId ? `member:${operations.lead.ownerMemberId}` : "general"} name="destination">{operations.assignmentTargets.map((target) => <option key={target.id} value={`member:${target.id}`}>{target.name}</option>)}<option value="general">Fila Geral</option></select></label>
                  <label className="text-sm">Motivo<textarea className={textareaClass} name="reason" required /></label>
                  <Button disabled={pending} type="submit">Redistribuir</Button>
                </form>
              </article>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeTab === "identity" ? (
        <section aria-labelledby="tab-identity" className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]" id="panel-identity" role="tabpanel">
          {contactIdentityForbidden ? (
            <article className="surface-panel border-dashed p-6 lg:col-span-2">
              <h2 className="text-lg font-semibold">Identidade canônica protegida</h2>
              <p className="mt-2 text-sm text-muted-foreground">Seu perfil não possui permissão para consultar Contact e ContactPoint deste lead.</p>
            </article>
          ) : !contactIdentity?.contact ? (
            <article className="surface-panel border-dashed p-6 lg:col-span-2">
              <h2 className="text-lg font-semibold">Contato ainda não vinculado</h2>
              <p className="mt-2 text-sm text-muted-foreground">Os campos legados do lead continuam disponíveis. Um administrador pode executar o backfill controlado; nenhuma identidade será inferida ou mesclada automaticamente.</p>
            </article>
          ) : (
            <>
              <article className="surface-panel p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">Contato canônico</p>
                    <h2 className="mt-1 text-xl font-semibold">{contactIdentity.contact.preferredName}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{contactIdentity.contact.jobTitle ?? "Atuação não informada"}</p>
                  </div>
                  <span className="status-badge" data-tone={contactIdentity.contact.quality === "NEEDS_REVIEW" ? "warning" : "success"}>
                    {contactIdentity.contact.quality === "NEEDS_REVIEW" ? "Revisão pendente" : "Identidade estruturada"}
                  </span>
                </div>
                <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-muted-foreground">ID canônico</dt><dd className="mt-1 break-all font-mono text-xs">{contactIdentity.contact.id}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Origem</dt><dd className="mt-1">{contactIdentity.contact.origin === "LEAD_BACKFILL" ? "Backfill de leads" : "Entrada de lead"}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Status</dt><dd className="mt-1">{contactIdentity.contact.status}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Compatibilidade</dt><dd className="mt-1">Campos antigos preservados</dd></div>
                </dl>
                <h3 className="mt-6 text-sm font-semibold">Pontos de contato</h3>
                {contactIdentity.contact.points.length > 0 ? (
                  <ul className="mt-3 divide-y rounded-xl border bg-[var(--surface-subtle)]">
                    {contactIdentity.contact.points.map((point) => (
                      <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm" key={point.id}>
                        <div>
                          <p className="font-medium">{point.type === "PHONE" ? "Telefone" : "E-mail"}{point.isPrimary ? " principal" : ""}</p>
                          <p className="mt-0.5 break-all text-muted-foreground">{point.value}</p>
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <p>{point.verificationStatus === "UNVERIFIED" ? "Não verificado" : point.verificationStatus}</p>
                          {point.doNotContact ? <p className="mt-1 font-semibold text-red-700">Não contatar</p> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-3 text-sm text-muted-foreground">Nenhum ponto de contato utilizável.</p>}
              </article>

              <article className="surface-panel bg-[var(--surface-subtle)] p-5">
                <h2 className="text-lg font-semibold">Revisões de identidade</h2>
                <p className="mt-1 text-sm text-muted-foreground">Colisões são evidências para decisão humana; o CRM não faz merge automático.</p>
                {contactIdentity.openReviews.length === 0 ? (
                  <p className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Nenhuma pendência aberta para este contato.</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {contactIdentity.openReviews.map((review) => (
                      <li className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" key={review.id}>
                        <p className="font-semibold">{review.reason.replaceAll("_", " ")}</p>
                        <p className="mt-1 text-xs">Evidência minimizada e separada de inferência. Nenhuma alteração automática foi aplicada.</p>
                        {review.candidateContactId ? <p className="mt-2 break-all font-mono text-[11px]">Candidato: {review.candidateContactId}</p> : null}
                        {contactIdentity.canResolveReviews ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button disabled={pending} onClick={() => void resolveIdentityReview(review.id, "KEEP_SEPARATE")} size="sm" type="button">Manter separados</Button>
                            <Button disabled={pending} onClick={() => void resolveIdentityReview(review.id, "DISMISS")} size="sm" type="button" variant="secondary">Descartar pendência</Button>
                          </div>
                        ) : <p className="mt-3 text-xs">Somente gestor ou administrador pode resolver.</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            </>
          )}
        </section>
      ) : null}

      {activeTab === "timeline" ? (
        <div aria-labelledby="tab-timeline" className="grid gap-6 xl:grid-cols-[minmax(360px,0.8fr)_minmax(0,1.2fr)]" id="panel-timeline" role="tabpanel">
          <section className="space-y-6">
            {operations.permissions.canWrite ? (
              <details className={styles.actionForm} id="registrar-atividade"><summary><Icon name="mais" size={15} />Registrar atividade</summary>
                <form className="mt-4 grid gap-4" onSubmit={submitActivity}>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="text-sm">Tipo<select className={inputClass} name="type" onChange={(event) => setActivityType(event.target.value)} value={activityType}>{activityOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="text-sm">Direção<select className={inputClass} defaultValue="OUTBOUND" name="direction"><option value="OUTBOUND">Saída</option><option value="INBOUND">Entrada</option><option value="INTERNAL">Interna</option></select></label>
                    <label className="text-sm">Resultado<select className={inputClass} defaultValue="" name="result"><option value="">Pelo tipo</option><option value="CONNECTED">Conectado</option><option value="NOT_CONNECTED">Não conectado</option><option value="SENT">Enviado</option><option value="RECEIVED">Recebido</option><option value="INFORMATION">Informativo</option><option value="OTHER">Outro</option></select></label>
                  </div>
                  <label className="text-sm">Assunto<input className={inputClass} name="subject" required /></label>
                  <label className="text-sm">Observação<textarea className={textareaClass} name="observation" /></label>
                  <label className="max-w-xs text-sm">Duração em segundos<input className={inputClass} min="1" name="durationSeconds" type="number" /></label>
                  <NextActionFields />
                  <Button disabled={pending} type="submit">{pending ? "Salvando…" : "Registrar atividade"}</Button>
                </form>
              </details>
            ) : <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Sem permissão para registrar atividades.</p>}

            {operations.permissions.canManageTasks ? (
              <details className={styles.actionForm} id="criar-tarefa"><summary><Icon name="agenda" size={15} />Criar tarefa</summary>
                <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={submitTask}>
                  <label className="text-sm sm:col-span-2">Título<input className={inputClass} name="title" required /></label>
                  <label className="text-sm sm:col-span-2">Descrição<textarea className={textareaClass} name="description" /></label>
                  <label className="text-sm">Tipo<select className={inputClass} defaultValue="FOLLOW_UP" name="kind"><option value="FOLLOW_UP">Retorno</option><option value="CALL">Ligação</option><option value="MESSAGE">Mensagem</option><option value="EMAIL">E-mail</option><option value="MEETING">Reunião</option><option value="GENERAL">Geral</option></select></label>
                  <label className="text-sm">Prioridade<select className={inputClass} defaultValue="MEDIUM" name="priority"><option value="LOW">Baixa</option><option value="MEDIUM">Média</option><option value="HIGH">Alta</option><option value="URGENT">Urgente</option></select></label>
                  <label className="text-sm sm:col-span-2">Prazo<input className={inputClass} name="dueAt" required type="datetime-local" /></label>
                  <Button className="sm:col-span-2" disabled={pending} type="submit">{pending ? "Salvando…" : "Criar tarefa"}</Button>
                </form>
              </details>
            ) : null}
          </section>

          <section className="space-y-6">
            <article className="surface-panel scroll-mt-4 p-5" id="tarefas">
              <h2 className="text-lg font-semibold">Tarefas</h2>
              {operations.tasks.length === 0 ? <p className="mt-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhuma tarefa registrada para este lead.</p> : (
                <ul className="mt-4 space-y-3">{operations.tasks.map((task) => <li className="rounded-md border p-3" key={task.id}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-medium">{task.title}</p><span className={task.overdue ? "text-xs font-semibold text-red-700" : "text-xs text-muted-foreground"}>{task.overdue ? "Vencida" : task.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{formatDate(task.dueAt, operations.timeZone)} · {task.priority}</p>{task.result ? <p className="mt-2 text-sm">Resultado: {task.result}</p> : null}{operations.permissions.canManageTasks && (task.status === "OPEN" || task.status === "IN_PROGRESS") && task.kind !== "IMMEDIATE_CALL" ? <form className="mt-3 grid gap-3" onSubmit={(event) => submitCompletion(event, task.id)}><label className="text-sm">Resultado da conclusão<input className={inputClass} name="result" required /></label><NextActionFields /><Button disabled={pending} size="sm" type="submit">Concluir tarefa</Button></form> : null}{task.kind === "IMMEDIATE_CALL" && (task.status === "OPEN" || task.status === "IN_PROGRESS") ? <p className="mt-2 text-xs text-muted-foreground">Conclua registrando a ligação, com a próxima ação quando necessária.</p> : null}</li>)}</ul>
              )}
            </article>

            <article className="surface-panel bg-[var(--surface-subtle)] p-5">
              <h2 className="text-lg font-semibold">Timeline</h2>
              {operations.timeline.length === 0 ? <p className="mt-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhum fato histórico registrado.</p> : (
                <ol className="mt-4 space-y-3">{operations.timeline.map((entry) => <li className="rounded-md border p-3" key={entry.id}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{entry.subject}</p><p className="mt-1 text-xs text-muted-foreground">{activityLabels[entry.type] ?? entry.type} · {formatDate(entry.occurredAt, operations.timeZone)}</p></div><span className="rounded-full border px-2 py-0.5 text-xs">{actorLabels[entry.actor.type] ?? entry.actor.type}: {entry.actor.name}</span></div>{entry.description ? <p className="mt-2 text-sm">{entry.description}</p> : null}{entry.result ? <p className="mt-2 text-xs">Resultado: {entry.result}</p> : null}{entry.nextActionDescription && entry.nextActionAt ? <p className="mt-2 text-xs text-muted-foreground">Próxima ação registrada: {entry.nextActionDescription} · {formatDate(entry.nextActionAt, operations.timeZone)}</p> : null}{entry.correctsActivityId ? <p className="mt-2 text-xs text-amber-800">Evento corretivo de {entry.correctsActivityId}</p> : null}{operations.permissions.canWrite ? <Button className="mt-3" onClick={() => setCorrectionId(entry.id)} size="sm" type="button" variant="secondary">Registrar correção</Button> : null}</li>)}</ol>
              )}
              {operations.nextCursor ? <Button className="mt-4" disabled={pending} onClick={loadMore} type="button" variant="secondary">Carregar mais</Button> : null}
            </article>

            {correctionId ? (
              <article className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950">
                <h2 className="text-lg font-semibold">Evento corretivo</h2><p className="mt-1 text-xs">O fato original não será alterado nem apagado.</p>
                <form className="mt-4 grid gap-3" onSubmit={submitCorrection}><label className="text-sm">Motivo da correção<textarea className={textareaClass} name="reason" required /></label><label className="text-sm">Assunto corrigido<input className={inputClass} name="correctedSubject" required /></label><label className="text-sm">Observação corrigida<textarea className={textareaClass} name="correctedObservation" /></label><div className="flex gap-2"><Button disabled={pending} type="submit">Registrar correção</Button><Button onClick={() => setCorrectionId(null)} type="button" variant="secondary">Cancelar</Button></div></form>
              </article>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeTab === "pacto" ? <PactoWorkspace initialPacto={pacto} onCommitted={refresh} onUpdated={setPacto} /> : null}
      {activeTab === "meetings" ? <LeadMeetingsWorkspace initialMeetings={initialMeetings} onCommitted={refresh} /> : null}
      {activeTab === "opportunity" ? (
        <div aria-labelledby="tab-opportunity" id="panel-opportunity" role="tabpanel">
          <LeadOpportunitiesWorkspace initialScreen={initialOpportunities} onCommitted={refresh} />
        </div>
      ) : null}
      {activeTab === "intelligence" ? <LeadIntelligencePanel initialForbidden={intelligenceForbidden} initialScreen={initialIntelligence} leadId={operations.lead.id} onCommitted={refresh} /> : null}
      {activeTab === "audit" && operations.permissions.canReadAudit ? <EmptyIntegration description="Seu perfil pode consultar auditoria. A visualização detalhada e pesquisável será implementada na CRM-24; os logs já continuam sendo gravados pelas operações suportadas." title="Visualização de auditoria ainda não implementada" /> : null}
        </div>
        <aside className={styles.context}>
          <section><h2>Empresa</h2>{operations.lead.account ? <Link href={`/contas/${operations.lead.account.id}`}><Icon name="vendas" size={17} /><strong>{operations.lead.account.name}</strong></Link> : <p>{operations.lead.organizationName ?? "Sem empresa vinculada"}</p>}</section>
          <section><h2>Próxima atividade</h2>{operations.lead.nextAction ? <><strong>{operations.lead.nextAction.title}</strong><p>{formatDate(operations.lead.nextAction.dueAt, operations.timeZone)}</p><Button variant="secondary" size="sm" onClick={() => openOperationalAction("NOTE", "tarefas")}>Ver atividade</Button></> : <p>Nenhuma atividade agendada.</p>}</section>
          <section><h2>Negócios</h2>{initialOpportunities.canRead ? <Button onClick={() => setActiveTab("opportunity")} size="sm" variant="secondary">Ver negócios do contato</Button> : <p>Acesso restrito ao seu perfil.</p>}</section>
          <section><h2>Conversas</h2>{communicationsForbidden ? <p>Acesso restrito ao seu perfil.</p> : <><p>{initialCommunications?.conversationCount ?? 0} conversas vinculadas</p><Link href={initialCommunications?.recent[0] ? `/inbox?conversationId=${initialCommunications.recent[0].id}` : "/inbox"}>Abrir atendimento <Icon name="seta-direita" size={14} /></Link></>}</section>
          <section><h2>Privacidade</h2><span className="status-badge" data-tone={initialPrivacy?.outcome === "ALLOW" ? "success" : initialPrivacy?.outcome === "DENY" ? "danger" : "warning"}>{privacyForbidden ? "Acesso restrito" : initialPrivacy?.outcome === "ALLOW" ? "Autorizado" : initialPrivacy?.outcome === "DENY" ? "Contato bloqueado" : "Revisão necessária"}</span></section>
        </aside>
      </div>
    </div>
  );
}
