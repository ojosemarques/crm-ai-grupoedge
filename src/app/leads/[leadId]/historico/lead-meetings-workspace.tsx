"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { LeadMeetingsScreen } from "@/modules/meetings/domain/meeting-contracts";
import { MeetingActions } from "@/modules/meetings/ui/meeting-actions";

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const statusLabels = {
  SCHEDULED: "Agendada",
  CONFIRMED: "Confirmada",
  COMPLETED: "Realizada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No-show",
  PENDING_STATUS: "Resultado pendente",
} as const;
const historyLabels = {
  SCHEDULED: "Agendada",
  CONFIRMED: "Confirmada",
  RESCHEDULED: "Remarcada",
  CANCELLED: "Cancelada",
  ATTENDED: "Comparecimento",
  NO_SHOW: "No-show",
} as const;

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

async function readResponse(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "message" in body.error
      ? String(body.error.message)
      : "Não foi possível concluir a operação.";
    throw new Error(message);
  }
  return body;
}

export function LeadMeetingsWorkspace({
  initialMeetings,
  onCommitted,
}: Readonly<{ initialMeetings: LeadMeetingsScreen; onCommitted: () => Promise<void> }>) {
  const [screen, setScreen] = useState(initialMeetings);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const response = await fetch(`/api/leads/${screen.leadId}/meetings`, { cache: "no-store" });
    const body = await readResponse(response);
    if (!body || typeof body !== "object" || !("result" in body)) throw new Error("Resposta inválida ao atualizar reuniões.");
    setScreen(body.result as LeadMeetingsScreen);
    await onCommitted();
  }

  async function schedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setNotice(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: screen.leadId,
          opportunityId: data.get("opportunityId") || null,
          closerId: data.get("closerId"),
          title: data.get("title"),
          startsAtLocal: data.get("startsAtLocal"),
          durationMinutes: Number(data.get("durationMinutes")),
          observation: data.get("observation") || null,
        }),
      });
      await readResponse(response);
      form.reset();
      setNotice("Reunião agendada e contexto encaminhado ao closer.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div aria-labelledby="tab-meetings" className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]" id="panel-meetings" role="tabpanel">
      <section className="surface-panel p-5">
        <h2 className="text-lg font-semibold">Agendar reunião</h2>
        {screen.canSchedule ? (
          <form className="mt-4 grid gap-4" onSubmit={schedule}>
            <label className="text-sm">Closer<select className={inputClass} name="closerId" required><option value="">Selecione</option>{screen.closerOptions.map((closer) => <option key={closer.id} value={closer.id}>{closer.name}</option>)}</select></label>
            <label className="text-sm">Oportunidade<select className={inputClass} defaultValue={screen.opportunityOptions.length === 1 ? screen.opportunityOptions[0]!.id : ""} name="opportunityId"><option value="">Sem vínculo explícito</option>{screen.opportunityOptions.map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.name}</option>)}</select></label>
            <label className="text-sm">Título<input className={inputClass} name="title" required /></label>
            <label className="text-sm">Data e horário<input className={inputClass} name="startsAtLocal" required type="datetime-local" /></label>
            <label className="text-sm">Duração<select className={inputClass} defaultValue={screen.defaultDurationMinutes} name="durationMinutes"><option value="30">30 minutos</option><option value="40">40 minutos</option></select></label>
            <label className="text-sm">Observação<textarea className={inputClass} name="observation" /></label>
            <Button disabled={pending} type="submit">{pending ? "Agendando…" : "Agendar reunião"}</Button>
          </form>
        ) : <p className="mt-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">Para agendar, o lead precisa estar Qualificado, sem reunião ativa, e seu perfil deve ter permissão.</p>}
        {notice ? <p className="mt-3 text-sm" role="status">{notice}</p> : null}
      </section>

      <section className="surface-panel bg-[var(--surface-subtle)] p-5">
        <h2 className="text-lg font-semibold">Histórico de reuniões</h2>
        {screen.meetings.length === 0 ? (
          <p className="mt-4 rounded-md border border-dashed p-6 text-sm text-muted-foreground">Nenhuma reunião registrada para este lead.</p>
        ) : (
          <ol className="mt-4 space-y-4">
            {screen.meetings.map((meeting) => (
              <li className="rounded-md border p-4" key={meeting.id}>
                <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{meeting.title}</p><p className="mt-1 text-sm">{meeting.closerName} · {formatDate(meeting.startsAt, screen.timeZone)} · {meeting.durationMinutes} min</p><p className="mt-1 text-xs text-muted-foreground">Calendário: {meeting.calendarSync.state === "NOT_LINKED" ? "não ligado" : meeting.calendarSync.state.toLowerCase().replaceAll("_", " ")}</p></div><span className="rounded-full border px-2.5 py-1 text-xs">{statusLabels[meeting.operationalStatus]}</span></div>
                {meeting.observation ? <p className="mt-3 whitespace-pre-wrap text-sm">{meeting.observation}</p> : null}
                {meeting.outcome ? <p className="mt-3 text-sm"><strong>Resultado:</strong> {meeting.outcome}</p> : null}
                <div className="mt-3 flex flex-wrap gap-3 text-sm font-medium"><Link className="underline" href={`/agenda/reunioes/${meeting.id}`}>Ver detalhes e briefing</Link><Link className="underline" href={`/agenda?meetingId=${meeting.id}`}>Abrir na agenda</Link>{meeting.opportunityId ? <Link className="underline" href={`/oportunidades?opportunityId=${meeting.opportunityId}`}>Abrir oportunidade</Link> : null}</div>
                <MeetingActions meeting={meeting} onCommitted={refresh} />
                <details className="mt-4"><summary className="cursor-pointer text-sm font-medium">Ver histórico ({meeting.history.length})</summary><ol className="mt-3 space-y-2">{meeting.history.map((item) => <li className="border-l-2 pl-3 text-sm" key={item.id}><p>{historyLabels[item.action]} · {formatDate(item.occurredAt, screen.timeZone)}</p><p className="text-xs text-muted-foreground">{item.actorName}{item.reason ? ` · ${item.reason}` : ""}</p>{item.previousStartsAt && item.previousStartsAt !== item.newStartsAt ? <p className="text-xs text-muted-foreground">De {formatDate(item.previousStartsAt, screen.timeZone)} para {formatDate(item.newStartsAt, screen.timeZone)}</p> : null}</li>)}</ol></details>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
