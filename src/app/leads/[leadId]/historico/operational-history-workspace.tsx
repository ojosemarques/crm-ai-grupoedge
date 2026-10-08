"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, type KeyboardEvent } from "react";

import styles from "./lead-detail.module.css";
import { Icon } from "@/components/ui/icon";
import { leadStageCodes, leadStageLabels } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";
import { Button } from "@/components/ui/button";
import { FreeQualificationWorkspace } from "@/app/leads/[leadId]/historico/free-qualification-workspace";
import { ScoringWorkspace } from "@/app/leads/[leadId]/historico/scoring-workspace";
import { LeadStageWorkspace } from "@/app/leads/[leadId]/historico/lead-stage-workspace";
import { LeadMeetingsWorkspace } from "@/app/leads/[leadId]/historico/lead-meetings-workspace";
import { LeadOpportunitiesWorkspace } from "@/app/leads/[leadId]/historico/lead-opportunities-workspace";
import type { LeadCardOperations } from "@/modules/leads/domain/lead-card-contracts";
import type { LeadMeetingsScreen } from "@/modules/meetings/domain/meeting-contracts";
import type { LeadOpportunityScreen } from "@/modules/opportunities/domain/opportunity-contracts";
import type { FreeQualificationScreen } from "@/modules/qualification/domain/free-qualification-contracts";
import type { LeadScoreView } from "@/modules/qualification/domain/scoring-contracts";
import type { LeadPipelineState } from "@/modules/pipelines/domain/pre-sales-pipeline-contracts";
import type { ContactPointView, LeadContactView } from "@/modules/contacts/domain/contact-contracts";
import { JourneyPanel } from "@/components/lifecycle/journey-panel";
import type { JourneySnapshot } from "@/modules/lifecycle/domain/lifecycle-contracts";
import type { getOmnichannelService } from "@/modules/communications/application/omnichannel-service";

type LeadCommunicationSummary = Awaited<ReturnType<ReturnType<typeof getOmnichannelService>["getLeadSummary"]>>;

type Notice = Readonly<{
  kind: "success" | "error";
  message: string;
}> | null;

type NextQueueLead = Readonly<{
  id: string;
  fullName: string;
  href: string;
}>;

type TabKey =
  | "summary"
  | "identity"
  | "qualification"
  | "timeline"
  | "meetings"
  | "opportunity";

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

const taskKindLabels: Readonly<Record<string, string>> = {
  GENERAL: "Tarefa geral",
  CALL: "Ligação",
  IMMEDIATE_CALL: "Ligação imediata",
  MESSAGE: "Mensagem",
  EMAIL: "E-mail",
  MEETING: "Reunião",
  FOLLOW_UP: "Acompanhamento",
};

const taskPriorityPresentation: Readonly<Record<string, Readonly<{
  label: string;
  detail: string;
  cardClassName: string;
  badgeClassName: string;
}>>> = {
  URGENT: {
    label: "Urgente",
    detail: "Maior urgência",
    cardClassName: "border-red-300 border-l-4 bg-red-50/60",
    badgeClassName: "border-red-300 bg-red-100 text-red-800",
  },
  HIGH: {
    label: "Alta",
    detail: "Acima da prioridade padrão",
    cardClassName: "border-orange-300 border-l-4 bg-orange-50/60",
    badgeClassName: "border-orange-300 bg-orange-100 text-orange-800",
  },
  MEDIUM: {
    label: "Média",
    detail: "Prioridade padrão",
    cardClassName: "border-amber-300 border-l-4 bg-amber-50/50",
    badgeClassName: "border-amber-300 bg-amber-100 text-amber-900",
  },
  LOW: {
    label: "Baixa",
    detail: "Menor urgência",
    cardClassName: "border-sky-300 border-l-4 bg-sky-50/50",
    badgeClassName: "border-sky-300 bg-sky-100 text-sky-800",
  },
};

const taskStatusPresentation: Readonly<Record<string, Readonly<{ label: string; className: string }>>> = {
  OPEN: { label: "Aberta", className: "border-slate-300 bg-slate-100 text-slate-700" },
  IN_PROGRESS: { label: "Em andamento", className: "border-blue-300 bg-blue-100 text-blue-800" },
  COMPLETED: { label: "Concluída", className: "border-emerald-300 bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "Cancelada", className: "border-slate-300 bg-slate-100 text-slate-600" },
};

const actorLabels: Readonly<Record<string, string>> = {
  HUMAN: "Pessoa",
  SYSTEM: "Sistema",
  AUTOMATION: "Automação",
  AI_AGENT: "Agente de IA",
};

const contactPointLabels: Readonly<Record<ContactPointView["type"], string>> = {
  PHONE: "Telefone",
  EMAIL: "E-mail",
  WHATSAPP: "WhatsApp",
  INSTAGRAM: "Instagram",
};

const tabs: readonly Readonly<{ key: TabKey; label: string }>[] = [
  { key: "timeline", label: "Atividades" },
  { key: "summary", label: "Resumo" },
  { key: "identity", label: "Contato" },
  { key: "qualification", label: "Qualificação" },
  { key: "meetings", label: "Reuniões" },
  { key: "opportunity", label: "Negócios" },
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

function NextActionFields({ required = false }: Readonly<{ required?: boolean }>) {
  return (
    <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
      <legend className="px-1 text-sm font-semibold">Próxima ação explícita</legend>
      <label className="text-sm">
        Título
        <input className={inputClass} name="nextTitle" placeholder="Retornar ao lead" required={required} />
      </label>
      <label className="text-sm">
        Prazo
        <input className={inputClass} name="nextDueAt" required={required} type="datetime-local" />
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

function ContactChannelsForm({
  showWhatsapp,
  showInstagram,
  pending,
  onSubmit,
}: Readonly<{
  showWhatsapp: boolean;
  showInstagram: boolean;
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}>) {
  if (!showWhatsapp && !showInstagram) return null;
  return (
    <form aria-label="Adicionar WhatsApp e Instagram" className="mt-4 grid gap-3 rounded-xl border border-dashed bg-background p-4 sm:grid-cols-2" onSubmit={onSubmit}>
      <div className="sm:col-span-2">
        <h4 className="text-sm font-semibold">Adicionar ponto de contato</h4>
        <p className="mt-1 text-xs text-muted-foreground">Cadastre somente os canais confirmados para este lead.</p>
      </div>
      {showWhatsapp ? <label className="text-sm">WhatsApp<input autoComplete="tel" className={inputClass} inputMode="tel" maxLength={40} name="whatsapp" placeholder="+55 11 99999-9999" required={!showInstagram} /></label> : null}
      {showInstagram ? <label className="text-sm">Instagram<input autoComplete="off" className={inputClass} maxLength={160} name="instagram" placeholder="@usuario ou link do perfil" required={!showWhatsapp} /></label> : null}
      <Button className="sm:col-span-2" disabled={pending} type="submit">{pending ? "Salvando…" : "Salvar contatos"}</Button>
    </form>
  );
}

export function OperationalHistoryWorkspace({
  initialOperations,
  initialQualifications,
  initialPipeline,
  initialScore,
  initialMeetings,
  initialOpportunities,
  showJourneyAndScoring = true,
  showOpportunities = true,
  initialContactIdentity,
  contactIdentityForbidden,
  initialJourney,
  initialPrivacy,
  privacyForbidden,
  initialCommunications,
  communicationsForbidden,
}: Readonly<{
  initialOperations: LeadCardOperations;
  initialQualifications: FreeQualificationScreen;
  initialPipeline: LeadPipelineState;
  initialScore: LeadScoreView;
  initialMeetings: LeadMeetingsScreen;
  initialOpportunities: LeadOpportunityScreen;
  showJourneyAndScoring?: boolean;
  showOpportunities?: boolean;
  initialContactIdentity: LeadContactView | null;
  contactIdentityForbidden: boolean;
  initialJourney: JourneySnapshot | null;
  initialPrivacy: Readonly<{ outcome: "ALLOW" | "DENY" | "REVIEW_REQUIRED"; consentState: string; reasonCodes: readonly string[]; missingEvidence: readonly string[]; mode: string; purpose: Readonly<{ name: string; version: number | null; status: string | null }> | null }> | null;
  privacyForbidden: boolean;
  initialCommunications: LeadCommunicationSummary | null;
  communicationsForbidden: boolean;
}>) {
  const router = useRouter();
  const [operations, setOperations] = useState(initialOperations);
  const [pipeline, setPipeline] = useState(initialPipeline);
  const [score, setScore] = useState(initialScore);
  const [activeTab, setActiveTab] = useState<TabKey>("timeline");
  const [activityType, setActivityType] = useState("CALL_UNANSWERED");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [correctionId, setCorrectionId] = useState<string | null>(null);
  const [clock, setClock] = useState(() => new Date(initialOperations.generatedAt).getTime());
  const [contactIdentity, setContactIdentity] = useState(initialContactIdentity);
  const [nextQueueLead, setNextQueueLead] = useState<NextQueueLead | null>(null);
  const [nextQueueLeadLoadedForId, setNextQueueLeadLoadedForId] = useState<string | null>(null);
  const [quickStageId, setQuickStageId] = useState("");
  const [quickOperationCompletedForId, setQuickOperationCompletedForId] = useState<string | null>(null);
  const [quickFlowOpen, setQuickFlowOpen] = useState(false);
  const [sellerMemberId, setSellerMemberId] = useState(initialOperations.lead.ownerMemberId ?? "");
  const [sellerTargetsLoading, setSellerTargetsLoading] = useState(false);
  const hasWhatsapp = Boolean(contactIdentity?.contact?.points.some((point) => point.type === "WHATSAPP"));
  const hasInstagram = Boolean(contactIdentity?.contact?.points.some((point) => point.type === "INSTAGRAM"));

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/leads/${operations.lead.id}/next`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => (await readResponse(response)) as NextQueueLead | null)
      .then((nextLead) => {
        setNextQueueLead(nextLead);
        setNextQueueLeadLoadedForId(operations.lead.id);
        if (nextLead) router.prefetch(nextLead.href);
      })
      .catch(() => {
        if (!controller.signal.aborted) setNextQueueLeadLoadedForId(operations.lead.id);
      });
    return () => controller.abort();
  }, [operations.lead.id, router]);

  useEffect(() => {
    const openLinkedPanel = () => {
      if (["#registrar-atividade", "#criar-tarefa", "#tarefas"].includes(window.location.hash)) {
        setActiveTab("timeline");
        window.setTimeout(() => {
          const target = document.getElementById(window.location.hash.slice(1));
          if (target instanceof HTMLDetailsElement) target.open = true;
          target?.scrollIntoView({ block: "start" });
        }, 0);
      } else if (showOpportunities && window.location.hash === "#oportunidade") {
        setActiveTab("opportunity");
      } else if (window.location.hash === "#reunioes") {
        setActiveTab("meetings");
      }
    };
    openLinkedPanel();
    window.addEventListener("hashchange", openLinkedPanel);
    return () => window.removeEventListener("hashchange", openLinkedPanel);
  }, [showOpportunities]);

  async function refresh() {
    const [operationsResponse, scoreResponse, pipelineResponse, contactResponse] = await Promise.all([
      fetch(`/api/leads/${operations.lead.id}/operations?pageSize=20`, { cache: "no-store" }),
      fetch(`/api/leads/${operations.lead.id}/score`, { cache: "no-store" }),
      fetch(`/api/leads/${operations.lead.id}/stage`, { cache: "no-store" }),
      contactIdentityForbidden
        ? Promise.resolve(null)
        : fetch(`/api/leads/${operations.lead.id}/contact`, { cache: "no-store" }),
    ]);
    const result = (await readResponse(operationsResponse)) as LeadCardOperations;
    const scoreResult = (await readResponse(scoreResponse)) as LeadScoreView;
    const pipelineResult = (await readResponse(pipelineResponse)) as LeadPipelineState;
    setOperations(result);
    setSellerMemberId(result.lead.ownerMemberId ?? "");
    setScore(scoreResult);
    setPipeline(pipelineResult);
    if (contactResponse) {
      setContactIdentity((await readResponse(contactResponse)) as LeadContactView);
    }
    setClock(new Date(result.generatedAt).getTime());
  }

  async function refreshSellerTargets() {
    setSellerTargetsLoading(true);
    try {
      const response = await fetch(
        `/api/leads/${operations.lead.id}/operations?pageSize=20`,
        { cache: "no-store" },
      );
      const result = (await readResponse(response)) as LeadCardOperations;
      setOperations(result);
      setSellerMemberId(result.lead.ownerMemberId ?? "");
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error
          ? error.message
          : "Não foi possível atualizar a lista de vendedores.",
      });
    } finally {
      setSellerTargetsLoading(false);
    }
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

  async function concludeAndOpenNext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    setNotice(null);
    let operationSaved = quickOperationCompletedForId === operations.lead.id;
    try {
      const nextTask = nextTaskFromForm(form);
      if (!nextTask) throw new Error("Defina a próxima ação antes de concluir este atendimento.");
      const currentTask = operations.tasks.find(
        (task) => task.id === operations.lead.nextAction?.taskId,
      );
      const resultDescription = formText(form, "resultDescription");
      if (!resultDescription) throw new Error("Descreva o resultado do atendimento.");
      const action = currentTask && currentTask.kind !== "IMMEDIATE_CALL"
        ? "COMPLETE_TASK"
        : "RECORD_ACTIVITY";
      const data = action === "COMPLETE_TASK"
        ? {
            taskId: currentTask!.id,
            result: resultDescription,
            nextTask,
          }
        : {
            type: formText(form, "activityType"),
            direction: "OUTBOUND",
            result: formText(form, "activityResult"),
            subject: formText(form, "subject"),
            observation: resultDescription,
            nextTask,
          };
      if (!operationSaved) {
        const operationResponse = await fetch(`/api/leads/${operations.lead.id}/operations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, data }),
        });
        await readResponse(operationResponse);
        operationSaved = true;
        setQuickOperationCompletedForId(operations.lead.id);
      }

      if (quickStageId) {
        const currentStateResponse = await fetch(`/api/leads/${operations.lead.id}/stage`, {
          cache: "no-store",
        });
        const currentState = (await readResponse(currentStateResponse)) as LeadPipelineState;
        const stageOption = currentState.transitions.find((option) => option.stageId === quickStageId);
        if (!stageOption) throw new Error("A etapa escolhida não está mais disponível para este lead.");
        const stageResponse = await fetch(`/api/leads/${operations.lead.id}/stage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetStageId: quickStageId,
            expectedUpdatedAt: currentState.updatedAt,
            reason: formText(form, "stageReason"),
            origin: "LEAD_CARD",
            managerCorrection: false,
            confirmed: form.get("stageConfirmed") === "on",
            disqualificationReasonId: formText(form, "disqualificationReasonId") ?? null,
          }),
        });
        await readResponse(stageResponse);
        setQuickStageId("");
      }

      let nextLead = nextQueueLeadLoadedForId === operations.lead.id ? nextQueueLead : null;
      if (!nextLead) {
        const nextLeadResponse = await fetch(`/api/leads/${operations.lead.id}/next`, {
          cache: "no-store",
        });
        nextLead = (await readResponse(nextLeadResponse)) as NextQueueLead | null;
      }
      if (nextLead) {
        formElement.reset();
        setQuickStageId("");
        setQuickOperationCompletedForId(null);
        router.replace(nextLead.href);
        return;
      }
      formElement.reset();
      setQuickStageId("");
      await refresh();
      setQuickOperationCompletedForId(null);
      setNotice({
        kind: "success",
        message: "Atendimento concluído. Não há outro lead disponível na sua fila agora.",
      });
    } catch (error) {
      setNotice({
        kind: "error",
        message: `${operationSaved ? "O resultado e a próxima ação foram salvos. " : ""}${error instanceof Error ? error.message : "Não foi possível concluir o atendimento."}`,
      });
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
    setActiveTab("timeline");
    window.setTimeout(() => {
      document.getElementById("alterar-etapa")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  function openContactEditor() {
    setActiveTab("identity");
    window.setTimeout(() => {
      document.getElementById("editar-informacoes")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  async function submitContactChannels(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    const whatsapp = formText(form, "whatsapp");
    const instagram = formText(form, "instagram");
    if (!whatsapp && !instagram) {
      setNotice({ kind: "error", message: "Informe WhatsApp ou Instagram." });
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/leads/${operations.lead.id}/contact`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(whatsapp ? { whatsapp } : {}), ...(instagram ? { instagram } : {}) }),
      });
      setContactIdentity((await readResponse(response)) as LeadContactView);
      element.reset();
      setNotice({ kind: "success", message: "Pontos de contato salvos." });
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "Não foi possível salvar os contatos.",
      });
    } finally {
      setPending(false);
    }
  }

  async function submitSellerAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sellerMemberId || sellerMemberId === operations.lead.ownerMemberId) return;
    await mutate("REDISTRIBUTE", {
      target: { type: "MEMBER", memberId: sellerMemberId },
      reason: "Vendedor alterado no card do pipeline.",
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
        ...(formText(form, "resultReason") ? { resultReason: formText(form, "resultReason") } : {}),
        ...(formText(form, "stopReason") ? { stopReason: formText(form, "stopReason") } : {}),
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

  const visibleTabs = showOpportunities ? tabs : tabs.filter((tab) => tab.key !== "opportunity");
  const nextQueueLeadLoaded = nextQueueLeadLoadedForId === operations.lead.id;
  const currentNextQueueLead = nextQueueLeadLoaded ? nextQueueLead : null;
  const quickOperationCompleted = quickOperationCompletedForId === operations.lead.id;
  const quickStage = pipeline.transitions.find((option) => option.stageId === quickStageId) ?? null;
  const quickCurrentTask = operations.tasks.find(
    (task) => task.id === operations.lead.nextAction?.taskId,
  ) ?? null;

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
              {operations.lead.jobTitle ?? "Atuação não informada"} · {operations.lead.organizationName ?? operations.lead.account?.name ?? "Partido, mandato ou equipe não informado"}
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
          <Button disabled={!operations.permissions.canWrite} onClick={() => openOperationalAction("CALL_UNANSWERED")} size="sm" type="button">Registrar ligação</Button>
          <Button disabled={!operations.permissions.canWrite} onClick={() => openOperationalAction("MESSAGE_SENT")} size="sm" type="button" variant="secondary">Registrar mensagem</Button>
          <Button disabled={!operations.permissions.canWrite} onClick={() => openOperationalAction("NOTE")} size="sm" type="button" variant="secondary">Adicionar nota</Button>
          <Button disabled={!operations.permissions.canManageTasks} onClick={() => openOperationalAction("NOTE", "criar-tarefa")} size="sm" type="button" variant="secondary">Criar tarefa</Button>
          <Button disabled={!operations.permissions.canAssign} onClick={() => { const panel = document.getElementById("vendedor-do-lead"); if (panel instanceof HTMLDetailsElement) panel.open = true; panel?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }} size="sm" type="button" variant="secondary">Alterar vendedor</Button>
          <Button disabled={!pipeline.canWrite} onClick={openStagePanel} size="sm" type="button" variant="secondary">Alterar etapa</Button>
          <Button disabled={!pipeline.canWrite} onClick={openStagePanel} size="sm" type="button" variant="secondary">Desqualificar</Button>
          <Button disabled={!pipeline.canWrite} onClick={openStagePanel} size="sm" type="button" variant="secondary">Colocar em nutrição</Button>
          <Button disabled={!initialQualifications.canWrite} key="Qualificar" onClick={() => setActiveTab("qualification")} size="sm" type="button" variant="secondary">Qualificar</Button>
          <Button disabled={!initialMeetings.canSchedule} onClick={() => setActiveTab("meetings")} size="sm" type="button" variant="secondary">Agendar reunião</Button>
          {showOpportunities ? <Button disabled={!initialOpportunities.canCreate} onClick={() => setActiveTab("opportunity")} size="sm" type="button" variant="secondary">Criar oportunidade</Button> : null}
        </div>
        {!operations.permissions.canWrite ? (
          <p className="mt-3 text-sm text-muted-foreground">Seu perfil possui acesso somente para leitura neste lead.</p>
        ) : null}
      </details>

      {operations.permissions.canWrite && operations.permissions.canManageTasks ? (
        <article className="surface-panel border-2 border-primary/30 p-5" aria-labelledby="complete-next-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-primary">Fluxo rápido</p>
              <h2 className="mt-1 text-lg font-semibold" id="complete-next-title">Concluir atendimento e abrir próximo</h2>
              <p className="mt-1 text-sm text-muted-foreground">Registre o resultado, defina a próxima ação e avance sem voltar para a fila.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm" data-next-lead-id={currentNextQueueLead?.id}>
                <span className="block text-xs text-muted-foreground">Próximo na fila</span>
                <strong>{nextQueueLeadLoaded ? currentNextQueueLead?.fullName ?? "Fila concluída" : "Preparando…"}</strong>
              </div>
              <Button
                aria-controls="complete-next-content"
                aria-expanded={quickFlowOpen}
                onClick={() => setQuickFlowOpen((current) => !current)}
                size="sm"
                type="button"
                variant="secondary"
              >
                {quickFlowOpen ? "Fechar fluxo" : "Abrir fluxo"}
              </Button>
            </div>
          </div>
          <div hidden={!quickFlowOpen} id="complete-next-content">
            {quickCurrentTask ? (
              <p className="mt-4 rounded-md border bg-muted/20 p-3 text-sm">
                Ação atual: <strong>{quickCurrentTask.title}</strong>. Ao concluir, ela será encerrada com o resultado abaixo.
              </p>
            ) : null}
            <form className="mt-4 grid gap-4" onSubmit={concludeAndOpenNext}>
            {!quickCurrentTask || quickCurrentTask.kind === "IMMEDIATE_CALL" ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="text-sm">Atividade realizada<select className={inputClass} defaultValue="CALL_UNANSWERED" name="activityType"><option value="CALL_UNANSWERED">Ligação não atendida</option><option value="CALL_CONNECTED">Ligação atendida</option><option value="MESSAGE_SENT">Mensagem enviada</option><option value="EMAIL">E-mail enviado</option><option value="NOTE">Nota interna</option></select></label>
                <label className="text-sm">Resultado<select className={inputClass} defaultValue="NOT_CONNECTED" name="activityResult"><option value="NOT_CONNECTED">Não conectado</option><option value="CONNECTED">Conectado</option><option value="SENT">Enviado</option><option value="INFORMATION">Informativo</option><option value="OTHER">Outro</option></select></label>
                <label className="text-sm">Assunto<input className={inputClass} defaultValue="Atendimento concluído" name="subject" required /></label>
              </div>
            ) : null}
            <label className="text-sm">Resultado do atendimento<textarea className={textareaClass} name="resultDescription" placeholder="Ex.: não atendeu; retornar amanhã às 10h" required /></label>
            <NextActionFields required />
            {pipeline.canWrite ? (
              <fieldset className="grid gap-3 rounded-md border p-3 sm:grid-cols-2">
                <legend className="px-1 text-sm font-semibold">Mover etapa (opcional)</legend>
                <label className="text-sm sm:col-span-2">Nova etapa<select className={inputClass} name="targetStageId" onChange={(event) => setQuickStageId(event.target.value)} value={quickStageId}><option value="">Manter em {pipeline.currentStageName}</option>{pipeline.transitions.map((option) => <option disabled={!option.allowed} key={option.stageId} value={option.stageId}>{option.name}{option.allowed ? "" : ` — ${option.blockReason}`}</option>)}</select></label>
                {quickStageId ? <label className="text-sm sm:col-span-2">Motivo da mudança<textarea className={textareaClass} name="stageReason" required /></label> : null}
                {quickStage?.requiresDisqualificationReason ? <label className="text-sm sm:col-span-2">Motivo da desqualificação<select className={inputClass} name="disqualificationReasonId" required><option value="">Selecione</option>{pipeline.disqualificationReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.name}</option>)}</select></label> : null}
                {quickStage?.requiresConfirmation ? <label className="flex items-start gap-2 text-sm sm:col-span-2"><input className="mt-1" name="stageConfirmed" required type="checkbox" /><span>Confirmo a movimentação para {quickStage.name}.</span></label> : null}
              </fieldset>
            ) : null}
            {quickOperationCompleted ? <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">O resultado e a próxima ação já foram salvos. Corrija somente a etapa e tente novamente.</p> : null}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">O próximo lead já está sendo preparado em segundo plano.</p>
              <Button disabled={pending} type="submit"><Icon name="seta-direita" size={14} />{pending ? "Concluindo…" : "Concluir e próximo"}</Button>
            </div>
            </form>
          </div>
        </article>
      ) : null}

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

          <div className="grid gap-3">
            <Button onClick={openContactEditor} size="sm" type="button" variant="secondary">Editar informações</Button>
            {operations.permissions.canAssign ? (
              <details
                className={styles.sellerAssignment}
                id="vendedor-do-lead"
                onToggle={(event) => {
                  if (event.currentTarget.open) void refreshSellerTargets();
                }}
              >
                <summary>
                  <span>Vendedor</span>
                  <small>{operations.lead.operationalOwner}</small>
                </summary>
                <form className="mt-3 grid gap-3" onSubmit={submitSellerAssignment}>
                  <label className="text-xs">
                    Dono do card
                    <select
                      aria-label="Vendedor dono do card"
                      className={inputClass}
                      disabled={pending || sellerTargetsLoading || operations.assignmentTargets.length === 0}
                      onChange={(event) => setSellerMemberId(event.target.value)}
                      required
                      value={sellerMemberId}
                    >
                      <option disabled value="">
                        {sellerTargetsLoading ? "Atualizando vendedores…" : "Selecione um vendedor"}
                      </option>
                      {operations.assignmentTargets.map((target) => (
                        <option key={target.id} value={target.id}>{target.name}</option>
                      ))}
                    </select>
                  </label>
                  {!sellerTargetsLoading && operations.assignmentTargets.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum vendedor ativo está disponível para sua permissão de acesso.</p>
                  ) : null}
                  <Button
                    disabled={pending || sellerTargetsLoading || !sellerMemberId || sellerMemberId === operations.lead.ownerMemberId}
                    size="sm"
                    type="submit"
                  >
                    {pending ? "Salvando…" : operations.lead.ownerMemberId ? "Alterar vendedor" : "Vincular vendedor"}
                  </Button>
                </form>
              </details>
            ) : null}
          </div>
        </aside>
        <div className={styles.content}>
      {activeTab === "summary" ? (
        <div aria-labelledby="tab-summary" className="grid gap-6" id="panel-summary" role="tabpanel">
          <section className="surface-panel surface-panel--soft p-5" aria-label="Resumo de comunicações">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Comunicações</h2>
                <p className="mt-1 text-sm text-muted-foreground">Conversas e mensagens vinculadas a este lead.</p>
              </div>
              <Button asChild size="sm" variant="secondary"><Link href={initialCommunications?.recent[0] ? `/inbox?conversationId=${initialCommunications.recent[0].id}` : "/inbox"}>Abrir inbox</Link></Button>
            </div>
            {communicationsForbidden ? (
              <p className="mt-4 text-sm text-muted-foreground">Sem permissão para consultar conversas deste lead.</p>
            ) : initialCommunications ? (
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <div><dt className="text-xs text-muted-foreground">Conversas</dt><dd className="mt-1 text-xl font-semibold">{initialCommunications.conversationCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Abertas</dt><dd className="mt-1 text-xl font-semibold">{initialCommunications.openCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Aguardando time</dt><dd className="mt-1 text-xl font-semibold">{initialCommunications.waitingTeamCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Não lidas</dt><dd className="mt-1 text-xl font-semibold">{initialCommunications.unreadCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Entradas</dt><dd className="mt-1 text-xl font-semibold">{initialCommunications.inboundMessageCount}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Saídas</dt><dd className="mt-1 text-xl font-semibold">{initialCommunications.outboundMessageCount}</dd></div>
              </dl>
            ) : <p className="mt-4 text-sm text-muted-foreground">Resumo de comunicação indisponível.</p>}
            {!communicationsForbidden && initialCommunications?.conversationCount === 0 ? <p className="mt-4 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">Ainda não há conversa para este lead.</p> : null}
          </section>

          <section className="surface-panel p-5" aria-label="Resumo de atividades">
            <div>
              <h2 className="text-lg font-semibold">Atividades realizadas</h2>
              <p className="mt-1 text-sm text-muted-foreground">Totais de todo o histórico operacional do lead até agora.</p>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl border bg-[var(--surface-subtle)] p-4"><dt className="text-xs text-muted-foreground">Atividades registradas</dt><dd className="mt-1 text-2xl font-semibold">{operations.summary.activities.total}</dd></div>
              <div className="rounded-xl border bg-[var(--surface-subtle)] p-4"><dt className="text-xs text-muted-foreground">Retornos concluídos</dt><dd className="mt-1 text-2xl font-semibold">{operations.summary.activities.completedFollowUps}</dd></div>
              <div className="rounded-xl border bg-[var(--surface-subtle)] p-4"><dt className="text-xs text-muted-foreground">Tarefas concluídas</dt><dd className="mt-1 text-2xl font-semibold">{operations.summary.activities.completedTasks}</dd></div>
              <div className="rounded-xl border bg-[var(--surface-subtle)] p-4"><dt className="text-xs text-muted-foreground">Ligações</dt><dd className="mt-1 text-2xl font-semibold">{operations.summary.activities.calls}</dd></div>
              <div className="rounded-xl border bg-[var(--surface-subtle)] p-4"><dt className="text-xs text-muted-foreground">Contatos efetivos</dt><dd className="mt-1 text-2xl font-semibold">{operations.summary.activities.connectedCalls}</dd></div>
              <div className="rounded-xl border bg-[var(--surface-subtle)] p-4"><dt className="text-xs text-muted-foreground">Mensagens</dt><dd className="mt-1 text-2xl font-semibold">{operations.summary.activities.messages}</dd></div>
              <div className="rounded-xl border bg-[var(--surface-subtle)] p-4"><dt className="text-xs text-muted-foreground">E-mails</dt><dd className="mt-1 text-2xl font-semibold">{operations.summary.activities.emails}</dd></div>
              <div className="rounded-xl border bg-[var(--surface-subtle)] p-4"><dt className="text-xs text-muted-foreground">Reuniões</dt><dd className="mt-1 text-2xl font-semibold">{operations.summary.activities.meetings}</dd></div>
            </dl>
          </section>
        </div>
      ) : null}

      {activeTab === "identity" ? (
        <section aria-labelledby="tab-identity" className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]" id="panel-identity" role="tabpanel">
          <article className="surface-panel p-5 lg:col-span-2" id="editar-informacoes">
            <h2 className="text-lg font-semibold">Editar informações</h2>
            {operations.permissions.canWrite ? (
              <form className="mt-4 grid gap-4 sm:grid-cols-2" key={operations.lead.updatedAt} onSubmit={submitSummary}>
                <label className="text-sm sm:col-span-2">Nome<input className={inputClass} defaultValue={operations.lead.fullName} name="fullName" required /></label>
                <label className="text-sm sm:col-span-2">E-mail<input className={inputClass} defaultValue={operations.lead.normalizedEmail ?? ""} name="normalizedEmail" type="email" /></label>
                <label className="text-sm">Cargo ou atuação<input className={inputClass} defaultValue={operations.lead.jobTitle ?? ""} name="jobTitle" /></label>
                <label className="text-sm">Partido, mandato ou equipe<input className={inputClass} defaultValue={operations.lead.organizationName ?? ""} name="organizationName" /></label>
                <label className="text-sm">Cidade<input className={inputClass} defaultValue={operations.lead.city ?? ""} name="city" /></label>
                <label className="text-sm">Estado<input className={inputClass} defaultValue={operations.lead.stateCode ?? ""} maxLength={2} name="stateCode" placeholder="SP" /></label>
                <label className="text-sm sm:col-span-2">Dor ou interesse<textarea className={textareaClass} defaultValue={operations.lead.interestSummary ?? ""} name="interestSummary" /></label>
                <p className="text-xs text-muted-foreground sm:col-span-2">Campos opcionais vazios são removidos ao salvar. O telefone identifica duplicidades e não é editado aqui.</p>
                <Button className="sm:col-span-2" disabled={pending} type="submit">{pending ? "Salvando…" : "Salvar informações"}</Button>
              </form>
            ) : <p className="mt-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Sem permissão para alterar os dados deste lead.</p>}
          </article>
          {contactIdentityForbidden ? (
            <article className="surface-panel border-dashed p-6 lg:col-span-2">
              <h2 className="text-lg font-semibold">Identidade canônica protegida</h2>
              <p className="mt-2 text-sm text-muted-foreground">Seu perfil não possui permissão para consultar Contact e ContactPoint deste lead.</p>
            </article>
          ) : !contactIdentity?.contact ? (
            <article className="surface-panel border-dashed p-6 lg:col-span-2">
              <h2 className="text-lg font-semibold">Contato ainda não vinculado</h2>
              <p className="mt-2 text-sm text-muted-foreground">Os campos legados do lead continuam disponíveis. Um administrador pode executar o backfill controlado; nenhuma identidade será inferida ou mesclada automaticamente.</p>
              {operations.permissions.canWrite ? <ContactChannelsForm onSubmit={submitContactChannels} pending={pending} showInstagram showWhatsapp /> : null}
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
                          <p className="font-medium">{contactPointLabels[point.type]}{point.isPrimary ? " principal" : ""}</p>
                          <p className="mt-0.5 break-all text-muted-foreground">{point.value}</p>
                          {point.label ? <p className="mt-1 text-xs text-muted-foreground">{point.label}</p> : null}
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <p>{point.verificationStatus === "UNVERIFIED" ? "Não verificado" : point.verificationStatus}</p>
                          {point.doNotContact ? <p className="mt-1 font-semibold text-red-700">Não contatar</p> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-3 text-sm text-muted-foreground">Nenhum ponto de contato utilizável.</p>}
                {operations.permissions.canWrite ? <ContactChannelsForm onSubmit={submitContactChannels} pending={pending} showInstagram={!hasInstagram} showWhatsapp={!hasWhatsapp} /> : null}
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
            <LeadStageWorkspace
              onCommitted={refresh}
              onUpdated={setPipeline}
              pipeline={pipeline}
              timeZone={operations.timeZone}
            />
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
                <ul className="mt-4 space-y-3">
                  {operations.tasks.map((task) => {
                    const priority = taskPriorityPresentation[task.priority] ?? taskPriorityPresentation.MEDIUM!;
                    const status = task.overdue
                      ? { label: "Vencida", className: "border-red-300 bg-red-100 text-red-800" }
                      : taskStatusPresentation[task.status] ?? { label: task.status, className: "border-slate-300 bg-slate-100 text-slate-700" };
                    return (
                      <li className={`rounded-lg border p-4 ${priority.cardClassName}`} key={task.id}>
                        <details className="group">
                          <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                            <div>
                              <p className="font-semibold">{task.title}</p>
                              <p className="mt-1 text-xs text-muted-foreground">{taskKindLabels[task.kind] ?? task.kind}</p>
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${priority.badgeClassName}`} title={priority.detail}>
                                Prioridade {priority.label}
                              </span>
                              <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${status.className}`}>
                                {status.label}
                              </span>
                              <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full border bg-background/80 text-sm transition-transform group-open:rotate-180">⌄</span>
                            </div>
                          </summary>
                          <div className="pt-3">
                            <dl className="grid gap-3 rounded-md border border-black/5 bg-background/70 p-3 text-sm sm:grid-cols-2">
                              <div><dt className="text-xs text-muted-foreground">Prazo</dt><dd className="mt-1 font-medium">{formatDate(task.dueAt, operations.timeZone)}</dd></div>
                              <div><dt className="text-xs text-muted-foreground">Nível de prioridade</dt><dd className="mt-1 font-medium">{priority.label} · {priority.detail}</dd></div>
                              {task.completedAt ? <div><dt className="text-xs text-muted-foreground">Concluída em</dt><dd className="mt-1 font-medium">{formatDate(task.completedAt, operations.timeZone)}</dd></div> : null}
                            </dl>
                            {task.description ? <p className="mt-3 text-sm text-muted-foreground">{task.description}</p> : null}
                            {task.result ? <p className="mt-3 rounded-md border bg-background/70 p-3 text-sm"><strong>Resultado:</strong> {task.result}</p> : null}
                            {operations.permissions.canManageTasks && (task.status === "OPEN" || task.status === "IN_PROGRESS") && task.kind !== "IMMEDIATE_CALL" ? <form className="mt-3 grid gap-3" onSubmit={(event) => submitCompletion(event, task.id)}>{task.sourceKey?.startsWith("active-prospecting:") ? <><label className="text-sm">Resultado da conclusão<select className={inputClass} name="result" required>{task.kind === "CALL" ? <><option value="">Selecione</option><option value="CONNECTED">Conectou</option><option value="NO_ANSWER">Não atendeu</option><option value="BUSY">Ocupado</option><option value="VOICEMAIL">Caixa postal</option><option value="WRONG_NUMBER">Número incorreto</option><option value="CHANNEL_UNAVAILABLE">Canal indisponível</option></> : task.kind === "INSTAGRAM_MESSAGE" ? <><option value="">Selecione</option><option value="SENT">Enviada</option><option value="FAILED">Falhou</option><option value="PROFILE_NOT_FOUND">Perfil não encontrado</option><option value="CHANNEL_UNAVAILABLE">Canal indisponível</option></> : <><option value="">Selecione</option><option value="COMPLETED">Concluído</option><option value="ALREADY_FOLLOWING">Já seguia</option><option value="FAILED">Falhou</option><option value="CHANNEL_UNAVAILABLE">Canal indisponível</option></>}</select></label><label className="text-sm">Motivo/observação<input className={inputClass} name="resultReason" placeholder="Opcional; o CRM registra o resultado automaticamente" /></label><label className="text-sm">Interromper cadência<select className={inputClass} defaultValue="" name="stopReason"><option value="">Não interromper</option><option value="REFUSAL">Recusa</option><option value="DO_NOT_CONTACT">Pedido de não contato</option></select></label></> : <label className="text-sm">Resultado da conclusão<input className={inputClass} name="result" required /></label>}<NextActionFields /><Button disabled={pending} size="sm" type="submit">Concluir tarefa</Button></form> : null}
                            {task.kind === "IMMEDIATE_CALL" && (task.status === "OPEN" || task.status === "IN_PROGRESS") ? <p className="mt-3 text-xs text-muted-foreground">Conclua registrando a ligação, com a próxima ação quando necessária.</p> : null}
                          </div>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>

            <details className="group surface-panel bg-[var(--surface-subtle)] p-5" id="timeline" key={operations.lead.id}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span className="text-lg font-semibold">Timeline</span>
                <span className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                  <span className="group-open:hidden">Abrir</span>
                  <span className="hidden group-open:inline">Fechar</span>
                  <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full border bg-background transition-transform group-open:rotate-180">⌄</span>
                </span>
              </summary>
              <div className="pt-4">
                {operations.timeline.length === 0 ? <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Nenhum fato histórico registrado.</p> : (
                  <ol className="space-y-3">{operations.timeline.map((entry) => <li className="rounded-md border p-3" key={entry.id}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{entry.subject}</p><p className="mt-1 text-xs text-muted-foreground">{activityLabels[entry.type] ?? entry.type} · {formatDate(entry.occurredAt, operations.timeZone)}</p></div><span className="rounded-full border px-2 py-0.5 text-xs">{actorLabels[entry.actor.type] ?? entry.actor.type}: {entry.actor.name}</span></div>{entry.description ? <p className="mt-2 text-sm">{entry.description}</p> : null}{entry.result ? <p className="mt-2 text-xs">Resultado: {entry.result}</p> : null}{entry.nextActionDescription && entry.nextActionAt ? <p className="mt-2 text-xs text-muted-foreground">Próxima ação registrada: {entry.nextActionDescription} · {formatDate(entry.nextActionAt, operations.timeZone)}</p> : null}{entry.correctsActivityId ? <p className="mt-2 text-xs text-amber-800">Evento corretivo de {entry.correctsActivityId}</p> : null}{operations.permissions.canWrite ? <Button className="mt-3" onClick={() => setCorrectionId(entry.id)} size="sm" type="button" variant="secondary">Registrar correção</Button> : null}</li>)}</ol>
                )}
                {operations.nextCursor ? <Button className="mt-4" disabled={pending} onClick={loadMore} type="button" variant="secondary">Carregar mais</Button> : null}
              </div>
            </details>

            {showJourneyAndScoring ? (
              <>
                <JourneyPanel journey={initialJourney} />
                <ScoringWorkspace initialScore={score} onCommitted={refresh} onUpdated={setScore} />
              </>
            ) : null}

            {correctionId ? (
              <article className="rounded-lg border border-amber-300 bg-amber-50 p-5 text-amber-950">
                <h2 className="text-lg font-semibold">Evento corretivo</h2><p className="mt-1 text-xs">O fato original não será alterado nem apagado.</p>
                <form className="mt-4 grid gap-3" onSubmit={submitCorrection}><label className="text-sm">Motivo da correção<textarea className={textareaClass} name="reason" required /></label><label className="text-sm">Assunto corrigido<input className={inputClass} name="correctedSubject" required /></label><label className="text-sm">Observação corrigida<textarea className={textareaClass} name="correctedObservation" /></label><div className="flex gap-2"><Button disabled={pending} type="submit">Registrar correção</Button><Button onClick={() => setCorrectionId(null)} type="button" variant="secondary">Cancelar</Button></div></form>
              </article>
            ) : null}
          </section>
        </div>
      ) : null}

      {activeTab === "qualification" ? (
        <FreeQualificationWorkspace initialScreen={initialQualifications} onCommitted={refresh} />
      ) : null}
      {activeTab === "meetings" ? <LeadMeetingsWorkspace initialMeetings={initialMeetings} onCommitted={refresh} /> : null}
      {showOpportunities && activeTab === "opportunity" ? (
        <div aria-labelledby="tab-opportunity" id="panel-opportunity" role="tabpanel">
          <LeadOpportunitiesWorkspace initialScreen={initialOpportunities} onCommitted={refresh} />
        </div>
      ) : null}
        </div>
        <aside className={styles.context}>
          <section><h2>Contexto político</h2><p>{operations.lead.organizationName ?? operations.lead.account?.name ?? "Partido, mandato ou equipe não informado"}</p></section>
          <section><h2>Próxima atividade</h2>{operations.lead.nextAction ? <><strong>{operations.lead.nextAction.title}</strong><p>{formatDate(operations.lead.nextAction.dueAt, operations.timeZone)}</p><Button variant="secondary" size="sm" onClick={() => openOperationalAction("NOTE", "tarefas")}>Ver atividade</Button></> : <p>Nenhuma atividade agendada.</p>}</section>
          {showOpportunities ? <section><h2>Negócios</h2>{initialOpportunities.canRead ? <Button onClick={() => setActiveTab("opportunity")} size="sm" variant="secondary">Ver negócios do contato</Button> : <p>Acesso restrito ao seu perfil.</p>}</section> : null}
          <section><h2>Conversas</h2>{communicationsForbidden ? <p>Acesso restrito ao seu perfil.</p> : <><p>{initialCommunications?.conversationCount ?? 0} conversas vinculadas</p><Link href={initialCommunications?.recent[0] ? `/inbox?conversationId=${initialCommunications.recent[0].id}` : "/inbox"}>Abrir conversa <Icon name="seta-direita" size={14} /></Link></>}</section>
          <section><h2>Privacidade</h2><span className="status-badge" data-tone={initialPrivacy?.outcome === "ALLOW" ? "success" : initialPrivacy?.outcome === "DENY" ? "danger" : "warning"}>{privacyForbidden ? "Acesso restrito" : initialPrivacy?.outcome === "ALLOW" ? "Autorizado" : initialPrivacy?.outcome === "DENY" ? "Contato bloqueado" : "Revisão necessária"}</span></section>
        </aside>
      </div>
    </div>
  );
}
