"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { SectionHeader, Surface } from "@/components/ui/surface";
import type { AgendaScreen } from "@/modules/meetings/domain/meeting-contracts";
import { MeetingActions } from "@/modules/meetings/ui/meeting-actions";

const inputClass = "mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm";
const statusLabels = {
  SCHEDULED: "Agendada",
  CONFIRMED: "Confirmada",
  COMPLETED: "Realizada",
  CANCELLED: "Cancelada",
  NO_SHOW: "No-show",
  PENDING_STATUS: "Horário passou · resultado pendente",
} as const;

function statusTone(value: keyof typeof statusLabels): StatusTone {
  if (value === "COMPLETED") return "success";
  if (value === "CANCELLED" || value === "NO_SHOW") return "danger";
  if (value === "PENDING_STATUS") return "warning";
  return "info";
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

async function responseMessage(response: Response) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object" && "message" in body.error) {
      throw new Error(String(body.error.message));
    }
    throw new Error("Não foi possível salvar a reunião.");
  }
  return body;
}

export function AgendaWorkspace({ initialScreen }: Readonly<{ initialScreen: AgendaScreen }>) {
  const router = useRouter();
  const [screen, setScreen] = useState(initialScreen);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    const query = new URLSearchParams({ view: screen.view, date: screen.selectedDate });
    if (screen.closerId) query.set("closerId", screen.closerId);
    const response = await fetch(`/api/meetings?${query.toString()}`, { cache: "no-store" });
    const body: unknown = await response.json();
    if (!response.ok || !body || typeof body !== "object" || !("result" in body)) throw new Error("Falha ao atualizar a agenda.");
    setScreen(body.result as AgendaScreen);
    router.refresh();
  }

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const query = new URLSearchParams({
      view: String(data.get("view")),
      date: String(data.get("date")),
    });
    const closerId = String(data.get("closerId") ?? "");
    if (closerId) query.set("closerId", closerId);
    router.push(`/agenda?${query.toString()}`);
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
          leadId: data.get("leadId"),
          closerId: data.get("closerId"),
          title: data.get("title"),
          startsAtLocal: data.get("startsAtLocal"),
          durationMinutes: Number(data.get("durationMinutes")),
          observation: data.get("observation") || null,
        }),
      });
      await responseMessage(response);
      form.reset();
      setNotice("Reunião agendada, tarefa criada e pipeline atualizado.");
      await refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha inesperada.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="agenda-sidebar space-y-6">
        <Surface className="p-5" tone="subtle">
          <SectionHeader description="Defina a janela e o closer permitido." eyebrow="Visualização" title="Período" />
          <form className="mt-4 grid gap-4" onSubmit={applyFilters}>
            <label className="text-sm">Visualização<select className={inputClass} defaultValue={screen.view} name="view"><option value="day">Dia</option><option value="week">Semana</option></select></label>
            <label className="text-sm">Data<input className={inputClass} defaultValue={screen.selectedDate} name="date" required type="date" /></label>
            {screen.canFilterCloser ? <label className="text-sm">Closer<select className={inputClass} defaultValue={screen.closerId} name="closerId"><option value="">Todos permitidos</option>{screen.closerOptions.map((closer) => <option key={closer.id} value={closer.id}>{closer.name}</option>)}</select></label> : <input name="closerId" type="hidden" value={screen.closerId} />}
            <Button type="submit">Aplicar filtros</Button>
          </form>
        </Surface>

        <Surface className="p-5">
          <SectionHeader description="O conflito de horário é validado antes da gravação." eyebrow="Nova reunião" title="Agendar reunião" />
          {screen.canSchedule ? (
            <form className="mt-4 grid gap-4" onSubmit={schedule}>
              <label className="text-sm">Lead qualificado<select className={inputClass} name="leadId" required><option value="">Selecione</option>{screen.leadOptions.map((lead) => <option key={lead.id} value={lead.id}>{lead.name}</option>)}</select></label>
              <label className="text-sm">Closer<select className={inputClass} name="closerId" required><option value="">Selecione</option>{screen.closerOptions.map((closer) => <option key={closer.id} value={closer.id}>{closer.name}</option>)}</select></label>
              <label className="text-sm">Título<input className={inputClass} name="title" required /></label>
              <label className="text-sm">Data e horário<input className={inputClass} name="startsAtLocal" required type="datetime-local" /></label>
              <label className="text-sm">Duração<select className={inputClass} defaultValue={screen.defaultDurationMinutes} name="durationMinutes"><option value="30">30 minutos</option><option value="40">40 minutos</option></select></label>
              <label className="text-sm">Observação<textarea className={inputClass} name="observation" /></label>
              <Button disabled={pending} type="submit">{pending ? "Agendando…" : "Agendar"}</Button>
            </form>
          ) : <EmptyState className="mt-3" compact description="Qualifique um lead ou selecione outro closer permitido." title="Nenhuma combinação disponível" />}
          {notice ? <p className="mt-3 text-sm" role="status">{notice}</p> : null}
        </Surface>
      </aside>

      <Surface className="p-5">
        <SectionHeader action={<StatusBadge tone="info">{screen.meetings.length} reunião(ões)</StatusBadge>} description={`${screen.rangeLabel} · ${screen.timeZone}`} eyebrow="Compromissos" title="Agenda" />
        {screen.meetings.length === 0 ? (
          <EmptyState className="mt-5" description="Altere o período ou o closer para consultar outro recorte autorizado." title="Nenhuma reunião encontrada" />
        ) : (
          <ol className="mt-5 space-y-4">
            {screen.meetings.map((meeting) => (
              <li className="rounded-md border p-4" key={meeting.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="font-semibold">{meeting.title}</p><p className="mt-1 text-sm">{meeting.leadName} · {meeting.closerName}</p><p className="mt-1 text-sm text-muted-foreground">{formatDate(meeting.startsAt, screen.timeZone)} · {meeting.durationMinutes} min</p></div>
                  <div className="flex flex-wrap items-center gap-2"><StatusBadge tone={statusTone(meeting.operationalStatus)}>{statusLabels[meeting.operationalStatus]}</StatusBadge><StatusBadge tone={meeting.calendarSync.state === "SYNCED" ? "success" : meeting.calendarSync.state === "CONFLICT" || meeting.calendarSync.state === "FAILED" ? "danger" : "info"}>Calendário: {meeting.calendarSync.state === "NOT_LINKED" ? "não ligado" : meeting.calendarSync.state.toLowerCase().replaceAll("_", " ")}</StatusBadge></div>
                </div>
                {meeting.observation ? <p className="mt-3 whitespace-pre-wrap text-sm">{meeting.observation}</p> : null}
                <div className="mt-3 flex flex-wrap gap-3 text-sm font-medium"><Link className="underline" href={`/agenda/reunioes/${meeting.id}`}>Abrir briefing do closer</Link><Link className="underline" href={`/integracoes/calendario?meetingId=${meeting.id}`}>Calendário</Link></div>
                <MeetingActions meeting={meeting} onCommitted={refresh} />
              </li>
            ))}
          </ol>
        )}
      </Surface>
    </div>
  );
}
